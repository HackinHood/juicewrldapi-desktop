let RPC = null
try { RPC = require('discord-rpc') } catch(_) { RPC = null }

const state = {
  client: null,
  applicationId: null,
  connected: false,
  lastActivity: null,
  lastActivityString: null,
  enabled: true,
  reconnectTimer: null,
  retryDelayMs: 5000,
  lastErrorMessage: null,
  setActivityPromise: Promise.resolve(),
  lastSetActivityAtMs: 0,
  minUpdateIntervalMs: 1500
}

function sleep(ms){
  return new Promise((resolve)=> setTimeout(resolve, Math.max(0, ms||0)))
}

function clampString(v, maxLen){
  if(v === undefined || v === null) return undefined
  const s = String(v)
  if(!s) return undefined
  return s.length > maxLen ? s.slice(0, maxLen) : s
}

function sanitizeActivity(activity){
  if(!activity || typeof activity !== 'object') return null
  const clean = {}
  const details = clampString(activity.details, 128)
  const stateText = clampString(activity.state, 128)
  if(details) clean.details = details
  if(stateText) clean.state = stateText
  clean.instance = !!activity.instance
  clean.type = (typeof activity.type === 'number') ? activity.type : 0

  const startTimestamp = activity.startTimestamp
  const endTimestamp = activity.endTimestamp
  if(typeof startTimestamp === 'number' || typeof endTimestamp === 'number'){
    clean.startTimestamp = (typeof startTimestamp === 'number' && Number.isFinite(startTimestamp)) ? startTimestamp : undefined
    clean.endTimestamp = (typeof endTimestamp === 'number' && Number.isFinite(endTimestamp)) ? endTimestamp : undefined
    if(clean.startTimestamp === undefined) delete clean.startTimestamp
    if(clean.endTimestamp === undefined) delete clean.endTimestamp
  }

  const badImageKey = (k)=>{
    if(!k) return true
    const s = String(k)
    if(!s) return true
    if(s.length > 256) return true
    const lower = s.toLowerCase()
    if(lower.startsWith('https://') || lower.startsWith('http://')) return false
    return false
  }
  const largeImageKey = activity.largeImageKey
  const smallImageKey = activity.smallImageKey
  if(!badImageKey(largeImageKey)) clean.largeImageKey = String(largeImageKey)
  if(!badImageKey(smallImageKey)) clean.smallImageKey = String(smallImageKey)
  const largeImageText = clampString(activity.largeImageText, 128)
  const smallImageText = clampString(activity.smallImageText, 128)
  if(largeImageText) clean.largeImageText = largeImageText
  if(smallImageText) clean.smallImageText = smallImageText

  if(Array.isArray(activity.buttons)){
    const buttons = activity.buttons
      .map((b)=>{
        if(!b || typeof b !== 'object') return null
        const label = clampString(b.label, 32)
        const url = clampString(b.url, 512)
        if(!label || !url) return null
        if(!(url.startsWith('https://') || url.startsWith('http://'))) return null
        return { label, url }
      })
      .filter(Boolean)
      .slice(0, 2)
    if(buttons.length) clean.buttons = buttons
  }

  return clean
}

function queueSetActivity(activity){
  if(!state.client || !state.connected) return Promise.resolve(false)
  const clean = sanitizeActivity(activity)
  if(!clean) return Promise.resolve(false)
  const s = JSON.stringify(clean)
  if(state.lastActivityString && state.lastActivityString === s) return Promise.resolve(true)
  state.lastActivityString = s
  const doSet = async ()=>{
    const now = Date.now()
    const waitMs = (state.lastSetActivityAtMs + (state.minUpdateIntervalMs||0)) - now
    if(waitMs > 0) await sleep(waitMs)
    state.lastSetActivityAtMs = Date.now()
    return state.client.setActivity(clean).then(()=>{
      try{ console.log('[DiscordRPC] activity updated successfully') }catch(_){ }
      return true
    }).catch((e)=>{
      try{
        const code = (e && (e.code || e.errorCode)) ? (e.code || e.errorCode) : ''
        console.log('[DiscordRPC] setActivity error', e && e.message ? e.message : e, code)
      }catch(_){ }
      return false
    })
  }
  state.setActivityPromise = state.setActivityPromise.then(doSet, doSet).then(()=>undefined)
  return state.setActivityPromise.then(()=>true).catch(()=>false)
}

function setEnabled(enabled){
  state.enabled = !!enabled
  if(!state.enabled){
    try{ console.log('[DiscordRPC] Disabled') }catch(_){ }
    if(state.reconnectTimer){ try{ clearTimeout(state.reconnectTimer) }catch(_){ } state.reconnectTimer = null }
    state.lastActivity = null
    state.lastActivityString = null
    const c = state.client
    const conn = state.connected
    state.client = null
    state.connected = false
    if(c){
      const after = ()=>{
        try{ c.destroy() }catch(_){ }
      }
      if(conn){
        state.setActivityPromise = state.setActivityPromise
          .then(()=>c.clearActivity().catch(()=>{}), ()=>c.clearActivity().catch(()=>{}))
          .then(after, after)
          .then(()=>undefined)
      } else {
        state.setActivityPromise = state.setActivityPromise.then(after, after).then(()=>undefined)
      }
    }
  }
  if(state.enabled && state.applicationId && RPC){ try{ init(state.applicationId) }catch(_){ } }
}

function scheduleReconnect(){
  try{ if(state.reconnectTimer){ clearTimeout(state.reconnectTimer); state.reconnectTimer = null } }catch(_){ }
  if(!state.enabled || !RPC || !state.applicationId) return
  const delay = Math.min(state.retryDelayMs || 5000, 60000)
  try{ console.log('[DiscordRPC] scheduling reconnect in', delay, 'ms') }catch(_){ }
  state.reconnectTimer = setTimeout(()=>{
    state.reconnectTimer = null
    try{ init(state.applicationId) }catch(_){ }
    state.retryDelayMs = Math.min((state.retryDelayMs||5000) * 2, 60000)
  }, delay)
}

function init(applicationId, transport){
  try{
    if(!state.enabled) return false
    if(!RPC) return false
    const chosenTransport = transport || 'ipc'
    try{ console.log('[DiscordRPC] init', applicationId, chosenTransport) }catch(_){ }
    if(state.applicationId === applicationId && state.connected) {
      console.log('[DiscordRPC] already connected with this client ID')
      return true
    }
    state.applicationId = String(applicationId||'').trim()
    if(!state.applicationId) return false
    if(state.client){ 
      console.log('[DiscordRPC] destroying old client')
      try{ state.client.destroy() }catch(_){ } 
      state.client = null 
    }
    state.connected = false
    const client = new RPC.Client({ transport: chosenTransport })
    state.client = client
    client.on('ready', ()=>{
      state.connected = true
      try{ console.log('[DiscordRPC] ready, connected successfully') }catch(_){ }
      state.retryDelayMs = 5000
      if(state.lastActivity){
        try{ 
          console.log('[DiscordRPC] setting queued activity on ready')
          queueSetActivity(state.lastActivity).then((ok)=>{
            if(ok){ try{ console.log('[DiscordRPC] activity set successfully') }catch(_){ } }
          }).catch(()=>{})
        }catch(_){ }
      }
    })
    const onDrop = (tag, err)=>{
      state.connected = false
      try{ console.log('[DiscordRPC]', tag, err && err.message ? err.message : '') }catch(_){ }
      try{ state.lastErrorMessage = (err && err.message) ? err.message : String(tag||'') }catch(_){ }
      if(chosenTransport === 'ipc'){
        setTimeout(()=>{
          try{ console.log('[DiscordRPC] retrying with websocket transport') }catch(_){ }
          try{ init(state.applicationId, 'websocket') }catch(_){ }
        }, 1000)
      } else {
        scheduleReconnect()
      }
    }
    client.on('disconnected', (e)=> onDrop('disconnected', e))
    client.on('close', (e)=> onDrop('close', e))
    client.on('error', (e)=> onDrop('error', e))
    client.login({ 
      clientId: state.applicationId
    }).catch((e)=>{ 
      try{ console.log('[DiscordRPC] login error', e && e.message) }catch(_){ }
      try{ state.lastErrorMessage = e && e.message ? e.message : 'login error' }catch(_){ }
      if(chosenTransport === 'ipc'){ 
        setTimeout(()=>{
          try{ init(state.applicationId, 'websocket') }catch(_){ }
        }, 1000)
      } else { 
        scheduleReconnect() 
      } 
    })
    return true
  }catch(_){ return false }
}

function buildActivity(payload){
  if(!payload || typeof payload !== 'object') return null
  const details = payload.title || 'Listening'
  const stateText = payload.artist || ''
  const activity = { 
    details, 
    state: stateText,
    instance: false,
    type: 2
  }
  if(typeof payload.startTimestamp === 'number' && typeof payload.endTimestamp === 'number'){
    activity.startTimestamp = payload.startTimestamp
    activity.endTimestamp = payload.endTimestamp
  }
  if(payload.largeImageKey){ activity.largeImageKey = payload.largeImageKey }
  activity.largeImageText = payload.album || payload.largeImageText || undefined
  if(payload.smallImageKey){ activity.smallImageKey = payload.smallImageKey }
  if(payload.smallImageText){ activity.smallImageText = payload.smallImageText }
  if(payload.buttons && Array.isArray(payload.buttons)) activity.buttons = payload.buttons.slice(0,2)
  return activity
}

function updatePresence(payload){
  try{
    if(!state.enabled) return false
    const activity = buildActivity(payload)
    if(!activity) return false
    try{ console.log('[DiscordRPC] update', activity) }catch(_){ }
    state.lastActivity = activity
    if(state.client && state.connected){
      queueSetActivity(activity)
      return true
    }
    if(!state.client && state.applicationId && RPC){ try{ init(state.applicationId) }catch(_){ } }
    console.log('[DiscordRPC] update called but not connected (connected=' + state.connected + '), queued for when ready')
    return false
  }catch(_){ return false }
}

function clear(){
  try{
    state.lastActivity = null
    state.lastActivityString = null
    if(state.client && state.connected){
      try{ console.log('[DiscordRPC] clear') }catch(_){ }
      const doClear = async ()=>{
        const now = Date.now()
        const waitMs = (state.lastSetActivityAtMs + (state.minUpdateIntervalMs||0)) - now
        if(waitMs > 0) await sleep(waitMs)
        state.lastSetActivityAtMs = Date.now()
        try{ await state.client.clearActivity() }catch(_){ }
      }
      state.setActivityPromise = state.setActivityPromise.then(doClear, doClear).then(()=>undefined)
      return true
    }
    return false
  }catch(_){ return false }
}

function getStatus(){
  return {
    rpcAvailable: !!RPC,
    enabled: !!state.enabled,
    connected: !!state.connected,
    applicationId: state.applicationId || null,
    lastErrorMessage: state.lastErrorMessage || null
  }
}

module.exports = { init, updatePresence, clear, setEnabled, getStatus }

