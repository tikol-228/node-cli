import { spawn } from 'child_process';
import FFT from 'fft.js';
import blessed from 'blessed';
import os from 'os';

/**
 * CLI-Viz Node.js Implementation
 * Replicates functionality of https://github.com/sam1am/cli-viz
 * Features: Spectrum Bars, Waveform, Circular Viz
 */

// --- Configuration ---
const SAMPLE_RATE = 16000;
const FFT_SIZE = 1024;
const CHANNELS = 1;

// --- FFT Setup ---
const fft = new FFT(FFT_SIZE);
const fftInput = new Float32Array(FFT_SIZE);
const fftOutput = fft.createComplexArray();

// --- UI Setup (Blessed) ---
const screen = blessed.screen({
    smartCSR: true,
    title: 'CLI Audio Visualizer',
    fullUnicode: true,
    dockable: true
});

const container = blessed.box({
    parent: screen,
    width: '100%',
    height: '100%',
    style: { bg: 'black' }
});

// --- State Management ---
let mode = 'bars';
const modes = ['bars', 'wave', 'circle'];
let sensitivity = 1.0;
let isPaused = false;

let frequencies = new Float32Array(FFT_SIZE / 2).fill(0);
let timeData = new Float32Array(FFT_SIZE).fill(0);

function initStates() {
    // No mode-specific global state needed for bars, wave, circle
}

// --- Audio Input Handling ---
function startAudio() {
    let audioProcess;

    if (os.platform() === 'darwin') {
        // macOS: Use FFmpeg with avfoundation
        audioProcess = spawn('ffmpeg', [
            '-f', 'avfoundation',
            '-i', ':0',
            '-f', 's16le',
            '-ac', CHANNELS.toString(),
            '-ar', SAMPLE_RATE.toString(),
            '-'
        ]);
    } else {
        // Linux/Others: Try to use 'rec' (from sox) as a fallback
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
    const bytesPerFrame = FFT_SIZE * 2; // 16-bit = 2 bytes

    audioProcess.stdout.on('data', (chunk) => {
        if (isPaused) return;

        buffer = Buffer.concat([buffer, chunk]);
        while (buffer.length >= bytesPerFrame) {
            const frame = buffer.slice(0, bytesPerFrame);
            buffer = buffer.slice(bytesPerFrame);

            // PCM -> Float [-1, 1]
            for (let i = 0; i < FFT_SIZE; i++) {
                const val = frame.readInt16LE(i * 2) / 32768.0;
                fftInput[i] = val;
                timeData[i] = val;
            }

            // Perform FFT
            fft.realTransform(fftOutput, fftInput);

            // Calculate Magnitudes
            for (let i = 0; i < FFT_SIZE / 2; i++) {
                const re = fftOutput[i * 2];
                const im = fftOutput[i * 2 + 1];
                const mag = Math.sqrt(re * re + im * im) * sensitivity;
                // Exponential smoothing
                frequencies[i] = frequencies[i] * 0.4 + mag * 0.6;
            }
        }
    });

    audioProcess.on('error', (err) => {
        screen.destroy();
        console.error("Audio capture error. Make sure 'ffmpeg' (macOS) or 'sox' (Linux) is installed.");
        console.error(err.message);
        process.exit(1);
    });
}

// --- Rendering Logic ---
function render() {
    if (isPaused) return;

    const { width, height } = screen;
    
    // Clear and redraw container
    container.children.forEach(c => c.detach());
    
    switch (mode) {
        case 'bars': renderBars(width, height); break;
        case 'wave': renderWave(width, height); break;
        case 'circle': renderCircle(width, height); break;
    }

    // Controls Help
    blessed.text({
        parent: container,
        bottom: 0,
        left: 0,
        content: ` [M]ode: ${mode.toUpperCase()} | [+/-] Sens: ${sensitivity.toFixed(1)} | [Space] Pause | [Q]uit `,
        style: { fg: 'white', bg: '#222222' }
    });

    screen.render();
}

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
                style: { bg: i < count / 3 ? 'green' : (i < 2 * count / 3 ? 'yellow' : 'red') }
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
        const safeY = Math.max(0, Math.min(h - 1, y));

        blessed.box({
            parent: container,
            left: x,
            top: safeY,
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
        const x = cx + Math.floor(Math.cos(angle) * r * 2.2); // Aspect ratio
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

// --- Keyboard Controls ---
screen.key(['q', 'C-c'], () => process.exit(0));
screen.key(['m'], () => {
    const idx = modes.indexOf(mode);
    mode = modes[(idx + 1) % modes.length];
});
screen.key(['+', '='], () => sensitivity *= 1.2);
screen.key(['-', '_'], () => sensitivity /= 1.2);
screen.key(['space'], () => isPaused = !isPaused);

screen.on('resize', () => initStates());

// --- Start ---
initStates();
startAudio();
setInterval(render, 40); // 25 FPS
