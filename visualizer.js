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
  const centerX = canvas.width / 2
  const time = Date.now() * 0.001

  analyser.getByteFrequencyData(dataArray)

  const halfBars = barCount / 2
  for (let i = 0; i < halfBars; i++) {
    const dataIndex = Math.floor((i / halfBars) * dataArray.length)
    const barHeight = (dataArray[dataIndex] / 255) * canvas.height * 0.7

    const hue = (i / halfBars) * 360 + (time * 30) % 360
    const alpha = 0.8 + (dataArray[dataIndex] / 255) * 0.2
    ctx.fillStyle = `hsla(${hue}, 100%, 60%, ${alpha})`

    const offset = i * barWidth
    ctx.fillRect(centerX - offset - barWidth, centerY - barHeight / 2, barWidth - 1, barHeight)
    ctx.fillRect(centerX + offset, centerY - barHeight / 2, barWidth - 1, barHeight)
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
  const centerX = canvas.width / 2
  const time = Date.now() * 0.001

  analyser.getByteTimeDomainData(timeDataArray)

  ctx.strokeStyle = `hsl(${(time * 50) % 360}, 100%, 60%)`
  ctx.lineWidth = 3
  ctx.beginPath()

  const halfLength = Math.floor(timeDataArray.length / 2)
  const sliceWidth = (canvas.width / 2) / halfLength

  for (let i = 0; i < halfLength; i++) {
    const v = timeDataArray[i] / 128.0
    const y = centerY + (v * canvas.height * 0.4)
    const x = centerX + (i * sliceWidth)

    if (i === 0) {
      ctx.moveTo(centerX, y)
    } else {
      ctx.lineTo(x, y)
    }
  }

  for (let i = halfLength - 1; i >= 0; i--) {
    const v = timeDataArray[i] / 128.0
    const y = centerY + (v * canvas.height * 0.4)
    const x = centerX - ((halfLength - i) * sliceWidth)
    ctx.lineTo(x, y)
  }

  ctx.closePath()
  ctx.stroke()

  analyser.getByteFrequencyData(dataArray)
  const halfDataLength = Math.floor(dataArray.length / 2)
  const barWidth = (canvas.width / 2) / halfDataLength
  for (let i = 0; i < halfDataLength; i++) {
    const barHeight = (dataArray[i] / 255) * canvas.height * 0.3
    const hue = (i / halfDataLength) * 360 + (time * 50) % 360
    ctx.fillStyle = `hsla(${hue}, 100%, 60%, 0.3)`
    const offset = i * barWidth
    ctx.fillRect(centerX - offset - barWidth, centerY - barHeight / 2, barWidth, barHeight)
    ctx.fillRect(centerX + offset, centerY - barHeight / 2, barWidth, barHeight)
  }
}

function drawParticles() {
  const time = Date.now() * 0.001
  const centerX = canvas.width / 2
  const centerY = canvas.height / 2
  analyser.getByteFrequencyData(dataArray)

  const particleCount = 50
  const halfParticles = particleCount / 2
  for (let i = 0; i < halfParticles; i++) {
    const dataIndex = Math.floor((i / halfParticles) * dataArray.length)
    const intensity = dataArray[dataIndex] / 255
    const offset = (i / halfParticles) * (canvas.width / 2)
    const y = centerY + Math.sin(time * 2 + i) * canvas.height * 0.2 * intensity

    const hue = (i / halfParticles) * 360 + (time * 50) % 360
    const size = 3 + intensity * 7
    ctx.fillStyle = `hsl(${hue}, 100%, 60%)`
    ctx.beginPath()
    ctx.arc(centerX - offset, y, size, 0, Math.PI * 2)
    ctx.fill()
    ctx.beginPath()
    ctx.arc(centerX + offset, y, size, 0, Math.PI * 2)
    ctx.fill()

    ctx.strokeStyle = `hsla(${hue}, 100%, 60%, 0.3)`
    ctx.lineWidth = 1
    ctx.beginPath()
    ctx.arc(centerX - offset, y, size * 2, 0, Math.PI * 2)
    ctx.stroke()
    ctx.beginPath()
    ctx.arc(centerX + offset, y, size * 2, 0, Math.PI * 2)
    ctx.stroke()
  }
}

function drawVerticalStacks() {
  const barCount = 30
  const barWidth = canvas.width / barCount
  const bottomY = canvas.height
  const centerX = canvas.width / 2
  const time = Date.now() * 0.001

  analyser.getByteFrequencyData(dataArray)

  const halfBars = barCount / 2

  for (let i = 0; i < halfBars; i++) {
    const dataIndex = Math.floor((i / halfBars) * dataArray.length)
    const barHeight = (dataArray[dataIndex] / 255) * canvas.height * 0.8
    const offset = i * barWidth
    const barTop = bottomY - barHeight

    const hue = (i / halfBars) * 360 + (time * 30) % 360
    
    const gradientLeft = ctx.createLinearGradient(centerX - offset - barWidth, barTop, centerX - offset - barWidth, bottomY)
    gradientLeft.addColorStop(0, `hsl(${hue}, 100%, 70%)`)
    gradientLeft.addColorStop(1, `hsl(${hue}, 100%, 50%)`)
    ctx.fillStyle = gradientLeft
    ctx.fillRect(centerX - offset - barWidth + 1, barTop, barWidth - 2, barHeight)

    const gradientRight = ctx.createLinearGradient(centerX + offset, barTop, centerX + offset, bottomY)
    gradientRight.addColorStop(0, `hsl(${hue}, 100%, 70%)`)
    gradientRight.addColorStop(1, `hsl(${hue}, 100%, 50%)`)
    ctx.fillStyle = gradientRight
    ctx.fillRect(centerX + offset + 1, barTop, barWidth - 2, barHeight)
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
    const centerX = canvas.width / 2

    const halfBars = barCount / 2
    for (let i = 0; i < halfBars; i++) {
      const wave = Math.sin(time * 2 + (i / halfBars) * Math.PI * 4) * 0.5 + 0.5
      const barHeight = wave * canvas.height * 0.4 + canvas.height * 0.1

      const hue = (i / halfBars) * 360 + (time * 50) % 360
      ctx.fillStyle = `hsl(${hue}, 100%, 60%)`

      const offset = i * barWidth
      ctx.fillRect(centerX - offset - barWidth, centerY - barHeight / 2, barWidth - 1, barHeight)
      ctx.fillRect(centerX + offset, centerY - barHeight / 2, barWidth - 1, barHeight)
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

