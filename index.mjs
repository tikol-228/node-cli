import asciichart from 'asciichart'

let t = 0

let data = Array.from({ length: 30 }, () => 0)

function generateSignal(time) {
    // простая “волна” (как звук)
    return Math.sin(time) * 5 + Math.random() * 2
}

function render() {
    console.clear()
    console.log(asciichart.plot(data))
}

setInterval(() => {
    // сдвигаем массив
    data.shift()

    // добавляем новое значение “сигнала”
    data.push(generateSignal(t))

    t += 0.2

    render()
}, 100)