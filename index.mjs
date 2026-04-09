#!/usr/bin/env node

import { spawn } from 'child_process';
import FFT from 'fft.js';
import blessed from 'blessed';
import os from 'os';
import fs from 'fs';

// --- Config ---
const SAMPLE_RATE = 16000;
const FFT_SIZE = 1024;
const CHANNELS = 1;

// --- Args ---
const args = process.argv.slice(2);

const bgColors = ['black', 'grey', 'blue', 'magenta', 'cyan'];
let bgIndex = 0;

let mode = 'bars';
let audioFile = null;

args.forEach(arg => {
    if (arg.startsWith('--mode=')) {
        mode = arg.split('=')[1];
    } else if (!arg.startsWith('--')) {
        audioFile = arg;
    }
});

// --- Validate file ---
if (audioFile && !fs.existsSync(audioFile)) {
    console.error(`❌ File not found: ${audioFile}`);
    process.exit(1);
}

// --- State ---
let volume = 0;
let peakVolume = 0;
let sensitivity = 1.0;
let isPaused = false;

let frequencies = new Float32Array(FFT_SIZE / 2).fill(0);
let timeData = new Float32Array(FFT_SIZE).fill(0);

// --- FFT ---
const fft = new FFT(FFT_SIZE);
const fftInput = new Float32Array(FFT_SIZE);
const fftOutput = fft.createComplexArray();

// --- UI ---
const screen = blessed.screen({
    smartCSR: true,
    title: 'CLI Audio Visualizer',
    fullUnicode: true,
});

const container = blessed.box({
    parent: screen,
    width: '100%',
    height: '100%',
    style: { bg: bgColors[bgIndex] }
});

// --- Audio ---
function startAudio(file) {
    let audioProcess;

    if (file) {
        audioProcess = spawn('ffmpeg', [
            '-i', file,
            '-f', 's16le',
            '-ac', CHANNELS.toString(),
            '-ar', SAMPLE_RATE.toString(),
            '-'
        ]);
    } else if (os.platform() === 'darwin') {
        audioProcess = spawn('ffmpeg', [
            '-f', 'avfoundation',
            '-i', ':0',
            '-f', 's16le',
            '-ac', CHANNELS.toString(),
            '-ar', SAMPLE_RATE.toString(),
            '-'
        ]);
    } else {
        audioProcess = spawn('rec', [
            '-b', '16',
            '--endian', 'little',
            '-c', CHANNELS.toString(),
            '-r', SAMPLE_RATE.toString(),
            '-e', 'signed-integer',
            '-t', 'raw',
            '-'
        ]);
    }

    let buffer = Buffer.alloc(0);
    const bytesPerFrame = FFT_SIZE * 2;

    audioProcess.stdout.on('data', (chunk) => {
        if (isPaused) return;

        buffer = Buffer.concat([buffer, chunk]);

        while (buffer.length >= bytesPerFrame) {
            const frame = buffer.slice(0, bytesPerFrame);
            buffer = buffer.slice(bytesPerFrame);

            for (let i = 0; i < FFT_SIZE; i++) {
                const val = frame.readInt16LE(i * 2) / 32768.0;
                fftInput[i] = val;
                timeData[i] = val;
            }

            let sum = 0;
            for (let i = 0; i < FFT_SIZE; i++) {
                sum += timeData[i] * timeData[i];
            }
            volume = Math.sqrt(sum / FFT_SIZE);

            peakVolume *= 0.97;
            if (volume > peakVolume) peakVolume = volume;

            fft.realTransform(fftOutput, fftInput);

            for (let i = 0; i < FFT_SIZE / 2; i++) {
                const re = fftOutput[i * 2];
                const im = fftOutput[i * 2 + 1];
                const mag = Math.sqrt(re * re + im * im) * sensitivity;
                frequencies[i] = frequencies[i] * 0.4 + mag * 0.6;
            }
        }
    });
}

// --- Renderers ---
function renderBars(w, h) {
    const barW = Math.max(1, Math.floor(w / 64));
    const count = Math.min(64, w);

    for (let i = 0; i < count; i++) {
        const mag = frequencies[i] || 0;
        const barH = Math.min(h - 2, Math.floor(mag * (h - 2) * 5));

        if (barH > 0) {
            blessed.box({
                parent: container,
                left: i * barW,
                bottom: 1,
                width: barW,
                height: barH,
                style: {
                    bg: i < count / 3 ? 'green' :
                        i < 2 * count / 3 ? 'yellow' : 'red'
                }
            });
        }
    }
}

function renderWave(w, h) {
    const midY = Math.floor(h / 2);
    const step = Math.floor(timeData.length / w) || 1;

    for (let x = 0; x < w; x++) {
        const val = timeData[x * step] * sensitivity;
        const y = midY + Math.floor(val * (h / 2));

        blessed.box({
            parent: container,
            left: x,
            top: Math.max(0, Math.min(h - 1, y)),
            width: 1,
            height: 1,
            style: { bg: 'cyan' }
        });
    }
}

function renderCircle(w, h) {
    const cx = Math.floor(w / 2);
    const cy = Math.floor(h / 2);
    const rBase = Math.min(cx, cy) * 0.4;

    const numPoints = 40;

    for (let i = 0; i < numPoints; i++) {
        const angle = (i / numPoints) * Math.PI * 2;
        const mag = frequencies[i % (frequencies.length / 4)] || 0;

        const r = rBase + (mag * rBase * 4);
        const x = cx + Math.floor(Math.cos(angle) * r * 2.2);
        const y = cy + Math.floor(Math.sin(angle) * r);

        if (x >= 0 && x < w && y >= 0 && y < h) {
            blessed.box({
                parent: container,
                left: x,
                top: y,
                width: 1,
                height: 1,
                style: { bg: 'magenta' }
            });
        }
    }
}

const renderers = {
    bars: renderBars,
    wave: renderWave,
    circle: renderCircle
};

// --- Render loop ---
function render() {
    if (isPaused) return;

    const { width, height } = screen;

    container.children.forEach(c => c.detach());

    // 🔥 BACKGROUND CHANGE HERE
    container.style.bg = bgColors[bgIndex];

    renderers[mode]?.(width, height);

    blessed.text({
        parent: container,
        bottom: 0,
        left: 0,
        content: `[${audioFile ? audioFile : 'MIC'}] Mode: ${mode} | Sens: ${sensitivity.toFixed(1)} | B: bg | Q: quit`,
        style: { fg: 'white', bg: '#222' }
    });

    screen.render();
}

// --- Controls ---
screen.key(['q', 'C-c'], () => process.exit(0));

screen.key(['m'], () => {
    const keys = Object.keys(renderers);
    const idx = keys.indexOf(mode);
    mode = keys[(idx + 1) % keys.length];
});

screen.key(['+', '='], () => sensitivity *= 1.2);
screen.key(['-', '_'], () => sensitivity /= 1.2);

screen.key(['space'], () => isPaused = !isPaused);

// 🔥 CHANGE BACKGROUND
screen.key(['b', 'B'], () => {
    bgIndex = (bgIndex + 1) % bgColors.length;
});

// --- Start ---
startAudio(audioFile);
setInterval(render, 50);