const { parentPort, workerData } = require('worker_threads')

let intervalMs = Math.max(60000, parseInt((workerData && workerData.intervalMs) || 300000))
let timer = null

function schedule() {
  if (timer) clearInterval(timer)
  timer = setInterval(() => {
    try { parentPort.postMessage({ type: 'run-sync' }) } catch (_) {}
  }, intervalMs)
}

parentPort.on('message', (msg) => {
  if (!msg || typeof msg !== 'object') return
  if (msg.type === 'update-settings') {
    if (typeof msg.intervalMs === 'number') intervalMs = Math.max(60000, msg.intervalMs|0)
    schedule()
  } else if (msg.type === 'run-now') {
    try { parentPort.postMessage({ type: 'run-sync' }) } catch (_) {}
  }
})

schedule()


