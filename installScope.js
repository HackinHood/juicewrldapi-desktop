const { app } = require('electron')
const path = require('path')
const os = require('os')

function isWindows() {
  return process.platform === 'win32'
}

function normalize(p) {
  try { return path.resolve(p).toLowerCase() } catch (_) { return String(p || '').toLowerCase() }
}

function isSystemInstallWindows() {
  try {
    const exe = normalize(process.execPath)
    const programFiles = [process.env['ProgramFiles'], process.env['ProgramFiles(x86)'], process.env['ProgramW6432']]
      .filter(Boolean)
      .map(normalize)
    if (programFiles.some(root => exe.startsWith(normalize(path.join(root, ''))))) return true
    if (exe.includes('programdata') || exe.includes('c:\\programdata')) return true
    const userProfile = normalize(process.env['USERPROFILE'] || os.homedir() || '')
    if (userProfile && exe.startsWith(userProfile)) return false
    const localAppData = normalize(process.env['LOCALAPPDATA'] || '')
    if (localAppData && exe.startsWith(localAppData)) return false
    return app.isPackaged && !normalize(app.getPath('userData')).startsWith(userProfile)
  } catch (_) {
    return false
  }
}

function detectScope() {
  try {
    if (!app || !app.getPath) return { platform: process.platform, scope: 'unknown' }
    if (isWindows()) {
      return { platform: 'win32', scope: isSystemInstallWindows() ? 'system' : 'user' }
    }
    const userData = String(app.getPath('userData') || '')
    const home = String(os.homedir() || '')
    if (userData && home && userData.indexOf(home) === 0) return { platform: process.platform, scope: 'user' }
    return { platform: process.platform, scope: 'system' }
  } catch (_) {
    return { platform: process.platform, scope: 'unknown' }
  }
}

function isSystemWideInstall() {
  const d = detectScope()
  return d.scope === 'system'
}

module.exports = { detectScope, isSystemWideInstall }


