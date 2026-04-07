import { spawn } from 'child_process';
import FFT from 'fft.js';
import blessed from 'blessed';
import os from 'os';

/**
 * CLI Audio Visualizer (with Volume + Peak Meter)
 */

// --- Configuration ---
const SAMPLE_RATE = 16000;
const FFT_SIZE = 1024;
const CHANNELS = 1;

// --- Params ---
let volume = 0;
let peakVolume = 0;

// --- FFT Setup ---
const fft = new FFT(FFT_SIZE);
const fftInput = new Float32Array(FFT_SIZE);
const fftOutput = fft.createComplexArray();

// --- UI Setup ---
const screen = blessed.screen({
    smartCSR: true,
    title: 'CLI Audio Visualizer',
    fullUnicode: true,
});

const container = blessed.box({
    parent: screen,
    width: '100%',
    height: '100%',
    style: { bg: 'black' }
});

// --- State ---
let mode = 'bars';
const modes = ['bars', 'wave', 'circle'];
let sensitivity = 1.0;
let isPaused = false;

let frequencies = new Float32Array(FFT_SIZE / 2).fill(0);
let timeData = new Float32Array(FFT_SIZE).fill(0);

// --- Audio ---
function startAudio() {
    let audioProcess;

    if (os.platform() === 'darwin') {
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

            // --- RMS Volume ---
            let sum = 0;
            for (let i = 0; i < FFT_SIZE; i++) {
                sum += timeData[i] * timeData[i];
            }
            volume = Math.sqrt(sum / FFT_SIZE);

            // --- Peak with decay ---
            peakVolume *= 0.97;
            if (volume > peakVolume) peakVolume = volume;

            // --- FFT ---
            fft.realTransform(fftOutput, fftInput);

            for (let i = 0; i < FFT_SIZE / 2; i++) {
                const re = fftOutput[i * 2];
                const im = fftOutput[i * 2 + 1];
                const mag = Math.sqrt(re * re + im * im) * sensitivity;
                frequencies[i] = frequencies[i] * 0.4 + mag * 0.6;
            }
        }
    });

    audioProcess.on('error', (err) => {
        screen.destroy();
        console.error("Install ffmpeg (macOS) or sox (Linux)");
        console.error(err.message);
        process.exit(1);
    });
}

// --- Rendering ---
function render() {
    if (isPaused) return;

    const { width, height } = screen;

    container.children.forEach(c => c.detach());

    if (mode === 'bars') renderBars(width, height);
    if (mode === 'wave') renderWave(width, height);
    if (mode === 'circle') renderCircle(width, height);

    // --- Controls ---
    blessed.text({
        parent: container,
        bottom: 0,
        left: 0,
        content: ` [M]ode: ${mode.toUpperCase()} | [+/-] Sens: ${sensitivity.toFixed(1)} | [Space] Pause | [Q]uit `,
        style: { fg: 'white', bg: '#222222' }
    });

    // --- Volume Meter ---
    const barWidth = 20;

    const volBars = Math.round(volume * barWidth);
    const volBar = '█'.repeat(volBars) + '░'.repeat(barWidth - volBars);

    const peakBars = Math.round(peakVolume * barWidth);

    let peakLine = '';
    for (let i = 0; i < barWidth; i++) {
        peakLine += (i === peakBars) ? '|' : ' ';
    }

    blessed.text({
        parent: container,
        top: 1,
        right: 2,
        width: barWidth + 10,
        content:
            `Vol : [${volBar}]\n` +
            `Peak:  ${peakLine}`,
        style: { fg: 'green' }
    });

    screen.render();
}

// --- Visualizations ---
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
                        (i < 2 * count / 3 ? 'yellow' : 'red')
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

// --- Controls ---
screen.key(['q', 'C-c'], () => process.exit(0));

screen.key(['m'], () => {
    const idx = modes.indexOf(mode);
    mode = modes[(idx + 1) % modes.length];
});

screen.key(['+', '='], () => sensitivity *= 1.2);
screen.key(['-', '_'], () => sensitivity /= 1.2);
screen.key(['space'], () => isPaused = !isPaused);

// --- Start ---
startAudio();
setInterval(render, 40);