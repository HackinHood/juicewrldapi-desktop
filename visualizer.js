const canvas = document.getElementById('canvas')
const ctx = canvas.getContext('2d')
const titleEl = document.getElementById('title')
const artistEl = document.getElementById('artist')

let audioContext = null
let analyser = null
let dataArray = null
let timeDataArray = null
let audioElement = null
let audioSource = null
let currentAudioSrc = null
let visualizationMode = 0
let lastUpdateTime = 0

function resizeCanvas() {
  canvas.width = window.innerWidth
  canvas.height = window.innerHeight
}
resizeCanvas()
window.addEventListener('resize', resizeCanvas)

function initAudio(audioSrc, currentTime = 0) {
  if (!audioSrc) return
  
  if (audioElement && audioSrc === currentAudioSrc) {
    if (Math.abs(audioElement.currentTime - currentTime) > 0.5) {
      audioElement.currentTime = currentTime
    }
    return
  }
  
  if (audioElement) {
    try {
      audioElement.pause()
      audioElement.src = ''
      if (audioSource) audioSource.disconnect()
      if (analyser) analyser.disconnect()
      if (audioContext) audioContext.close()
    } catch (_) {}
  }

  try {
    audioElement = new Audio(audioSrc)
    audioElement.crossOrigin = 'anonymous'
    audioElement.volume = 0.01
    
    audioContext = new (window.AudioContext || window.webkitAudioContext)()
    analyser = audioContext.createAnalyser()
    analyser.fftSize = 512
    analyser.smoothingTimeConstant = 0.3

    audioSource = audioContext.createMediaElementSource(audioElement)
    audioSource.connect(analyser)
    analyser.connect(audioContext.destination)

    const bufferLength = analyser.frequencyBinCount
    dataArray = new Uint8Array(bufferLength)
    timeDataArray = new Uint8Array(bufferLength)
    
    currentAudioSrc = audioSrc
    
    audioElement.currentTime = currentTime || 0
    audioElement.play().catch(() => {})
  } catch (error) {
    console.error('[Visualizer] Audio init error:', error)
  }
}

function drawBars() {
  const barCount = 64
  const barWidth = canvas.width / barCount
  const centerY = canvas.height / 2
  const time = Date.now() * 0.001

  analyser.getByteFrequencyData(dataArray)

  for (let i = 0; i < barCount; i++) {
    const dataIndex = Math.floor((i / barCount) * dataArray.length)
    const barHeight = (dataArray[dataIndex] / 255) * canvas.height * 0.7

    const hue = (i / barCount) * 360 + (time * 30) % 360
    const alpha = 0.8 + (dataArray[dataIndex] / 255) * 0.2
    ctx.fillStyle = `hsla(${hue}, 100%, 60%, ${alpha})`

    const x = i * barWidth
    ctx.fillRect(x, centerY - barHeight / 2, barWidth - 1, barHeight)
  }
}

function drawCircle() {
  const centerX = canvas.width / 2
  const centerY = canvas.height / 2
  const radius = Math.min(canvas.width, canvas.height) * 0.3
  const time = Date.now() * 0.001

  analyser.getByteFrequencyData(dataArray)
  analyser.getByteTimeDomainData(timeDataArray)

  ctx.strokeStyle = `hsl(${(time * 50) % 360}, 100%, 60%)`
  ctx.lineWidth = 2
  ctx.beginPath()

  for (let i = 0; i < dataArray.length; i++) {
    const angle = (i / dataArray.length) * Math.PI * 2
    const amplitude = (dataArray[i] / 255) * radius * 0.5
    const x = centerX + Math.cos(angle) * (radius + amplitude)
    const y = centerY + Math.sin(angle) * (radius + amplitude)

    if (i === 0) {
      ctx.moveTo(x, y)
    } else {
      ctx.lineTo(x, y)
    }
  }
  ctx.closePath()
  ctx.stroke()

  for (let i = 0; i < 32; i++) {
    const angle = (i / 32) * Math.PI * 2
    const dataIndex = Math.floor((i / 32) * dataArray.length)
    const amplitude = (dataArray[dataIndex] / 255) * radius * 0.6
    const x = centerX + Math.cos(angle) * (radius + amplitude)
    const y = centerY + Math.sin(angle) * (radius + amplitude)

    const hue = (i / 32) * 360 + (time * 50) % 360
    ctx.fillStyle = `hsl(${hue}, 100%, 60%)`
    ctx.beginPath()
    ctx.arc(x, y, 4, 0, Math.PI * 2)
    ctx.fill()
  }
}

function drawWaveform() {
  const centerY = canvas.height / 2
  const time = Date.now() * 0.001

  analyser.getByteTimeDomainData(timeDataArray)

  ctx.strokeStyle = `hsl(${(time * 50) % 360}, 100%, 60%)`
  ctx.lineWidth = 3
  ctx.beginPath()

  const sliceWidth = canvas.width / timeDataArray.length
  let x = 0

  for (let i = 0; i < timeDataArray.length; i++) {
    const v = timeDataArray[i] / 128.0
    const y = centerY + (v * canvas.height * 0.4)

    if (i === 0) {
      ctx.moveTo(x, y)
    } else {
      ctx.lineTo(x, y)
    }

    x += sliceWidth
  }

  ctx.stroke()

  analyser.getByteFrequencyData(dataArray)
  for (let i = 0; i < dataArray.length; i++) {
    const barHeight = (dataArray[i] / 255) * canvas.height * 0.3
    const hue = (i / dataArray.length) * 360 + (time * 50) % 360
    ctx.fillStyle = `hsla(${hue}, 100%, 60%, 0.3)`
    ctx.fillRect(i * (canvas.width / dataArray.length), centerY - barHeight / 2, canvas.width / dataArray.length, barHeight)
  }
}

function drawParticles() {
  const time = Date.now() * 0.001
  analyser.getByteFrequencyData(dataArray)

  for (let i = 0; i < 50; i++) {
    const dataIndex = Math.floor((i / 50) * dataArray.length)
    const intensity = dataArray[dataIndex] / 255
    const x = (i / 50) * canvas.width
    const y = canvas.height / 2 + Math.sin(time * 2 + i) * canvas.height * 0.2 * intensity

    const hue = (i / 50) * 360 + (time * 50) % 360
    const size = 3 + intensity * 7
    ctx.fillStyle = `hsl(${hue}, 100%, 60%)`
    ctx.beginPath()
    ctx.arc(x, y, size, 0, Math.PI * 2)
    ctx.fill()

    ctx.strokeStyle = `hsla(${hue}, 100%, 60%, 0.3)`
    ctx.lineWidth = 1
    ctx.beginPath()
    ctx.arc(x, y, size * 2, 0, Math.PI * 2)
    ctx.stroke()
  }
}

function drawVerticalStacks() {
  const barCount = 30
  const barWidth = canvas.width / barCount
  const bottomY = canvas.height
  const time = Date.now() * 0.001

  analyser.getByteFrequencyData(dataArray)
  analyser.getByteTimeDomainData(timeDataArray)

  const barHeights = []
  const dotYPositions = []

  for (let i = 0; i < barCount; i++) {
    const dataIndex = Math.floor((i / barCount) * dataArray.length)
    const barHeight = (dataArray[dataIndex] / 255) * canvas.height * 0.8
    barHeights.push(barHeight)

    const timeIndex = Math.floor((i / barCount) * timeDataArray.length)
    const timeValue = timeDataArray[timeIndex] / 128.0
    const dotY = bottomY - barHeight - (timeValue * canvas.height * 0.15) - 20
    dotYPositions.push(dotY)
  }

  for (let i = 0; i < barCount; i++) {
    const x = i * barWidth + barWidth / 2
    const barHeight = barHeights[i]
    const barTop = bottomY - barHeight

    const gradient = ctx.createLinearGradient(x - barWidth / 2, barTop, x - barWidth / 2, bottomY)
    const hue = (i / barCount) * 360 + (time * 30) % 360
    gradient.addColorStop(0, `hsl(${hue}, 100%, 70%)`)
    gradient.addColorStop(1, `hsl(${hue}, 100%, 50%)`)
    ctx.fillStyle = gradient

    ctx.fillRect(x - barWidth / 2 + 1, barTop, barWidth - 2, barHeight)
  }

  ctx.strokeStyle = `hsl(${(time * 50) % 360}, 100%, 60%)`
  ctx.lineWidth = 2
  ctx.beginPath()

  for (let i = 0; i < barCount; i++) {
    const x = i * barWidth + barWidth / 2
    const y = dotYPositions[i]

    if (i === 0) {
      ctx.moveTo(x, y)
    } else {
      ctx.lineTo(x, y)
    }
  }

  ctx.stroke()

  for (let i = 0; i < barCount; i++) {
    const x = i * barWidth + barWidth / 2
    const y = dotYPositions[i]
    const hue = (i / barCount) * 360 + (time * 50) % 360

    ctx.fillStyle = `hsl(${hue}, 100%, 60%)`
    ctx.beginPath()
    ctx.arc(x, y, 4, 0, Math.PI * 2)
    ctx.fill()
  }
}

function draw() {
  if (!canvas || !ctx) {
    requestAnimationFrame(draw)
    return
  }
  
  ctx.fillStyle = 'rgba(0, 0, 0, 0.1)'
  ctx.fillRect(0, 0, canvas.width, canvas.height)

  const time = Date.now() * 0.001

  if (analyser && dataArray) {
    switch (visualizationMode) {
      case 0:
        drawBars()
        break
      case 1:
        drawCircle()
        break
      case 2:
        drawWaveform()
        break
      case 3:
        drawParticles()
        break
      case 4:
        drawVerticalStacks()
        break
      default:
        drawBars()
    }
  } else {
    const barCount = 64
    const barWidth = canvas.width / barCount
    const centerY = canvas.height / 2

    for (let i = 0; i < barCount; i++) {
      const wave = Math.sin(time * 2 + (i / barCount) * Math.PI * 4) * 0.5 + 0.5
      const barHeight = wave * canvas.height * 0.4 + canvas.height * 0.1

      const hue = (i / barCount) * 360 + (time * 50) % 360
      ctx.fillStyle = `hsl(${hue}, 100%, 60%)`

      const x = i * barWidth
      ctx.fillRect(x, centerY - barHeight / 2, barWidth - 1, barHeight)
    }
  }

  requestAnimationFrame(draw)
}

draw()

canvas.addEventListener('click', () => {
  visualizationMode = (visualizationMode + 1) % 5
})

if (window.electronAPI) {
  window.electronAPI.onVisualizerUpdate((data) => {
    if (data && data.audioSrc) {
      initAudio(data.audioSrc, data.currentTime || 0)
      if (audioContext && audioContext.state === 'suspended') {
        audioContext.resume()
      }
    }
    if (data && data.title) {
      if (titleEl) titleEl.textContent = data.title || '—'
      if (artistEl) artistEl.textContent = data.artist || '—'
    }
    if (data && audioElement) {
      if (data.isPlaying && audioElement.paused) {
        audioElement.play().catch(() => {})
      } else if (!data.isPlaying && !audioElement.paused) {
        audioElement.pause()
      }
      if (typeof data.currentTime === 'number' && Math.abs(audioElement.currentTime - data.currentTime) > 0.3) {
        audioElement.currentTime = data.currentTime
      }
    }
  })

  window.electronAPI.onVisualizerClose(() => {
    if (audioElement) {
      try {
        audioElement.pause()
        audioElement.src = ''
      } catch (_) {}
      audioElement = null
    }
    if (audioContext) {
      try {
        if (audioSource) audioSource.disconnect()
        if (analyser) analyser.disconnect()
        audioContext.close()
      } catch (_) {}
      audioContext = null
      analyser = null
      dataArray = null
      timeDataArray = null
      audioSource = null
    }
    currentAudioSrc = null
  })
}
