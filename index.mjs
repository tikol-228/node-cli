import asciichart from 'asciichart'
import mic from 'mic'

// буфер для графика
let data = Array.from({ length: 60 }, () => 0)

// микрофон (ВАЖНО: твой device)
const microphone = mic({
    rate: '16000',
    channels: '1',
    device: 'plughw:2,0',
    debug: false
})

const stream = microphone.getAudioStream()

microphone.start()

console.log("🎤 listening... press Ctrl+C to stop")

// рисование
function render() {
    console.clear()
    console.log(asciichart.plot(data, {
        height: 20
    }))
}

// обработка аудио
stream.on('data', (chunk) => {

    let sum = 0

    // RMS (энергия сигнала)
    for (let i = 0; i < chunk.length; i++) {
        const v = chunk[i] - 128
        sum += v * v
    }

    let rms = Math.sqrt(sum / chunk.length)

    // усиление (чтобы график был живой)
    let volume = rms * 2

    // ограничение (чтобы не улетало)
    if (volume > 100) volume = 100

    // сдвиг графика
    data.shift()
    data.push(volume)

    render()
})