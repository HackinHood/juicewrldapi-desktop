let RPC = null
try { RPC = require('discord-rpc') } catch(_) { RPC = null }

const state = {
  client: null,
  applicationId: null,
  connected: false,
  lastActivity: null,
  enabled: true,
  reconnectTimer: null,
  retryDelayMs: 5000,
  lastErrorMessage: null
}

function setEnabled(enabled){
  state.enabled = !!enabled
  if(!state.enabled){
    try{ console.log('[DiscordRPC] Disabled') }catch(_){ }
    try{ clear() }catch(_){ }
    try{ if(state.client){ state.client.destroy() } }catch(_){ }
    state.client = null
    state.connected = false
    if(state.reconnectTimer){ try{ clearTimeout(state.reconnectTimer) }catch(_){ } state.reconnectTimer = null }
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
          client.setActivity(state.lastActivity).then(()=>{
            console.log('[DiscordRPC] activity set successfully')
          }).catch((e)=>{
            console.log('[DiscordRPC] setActivity error', e && e.message)
          })
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
  const stateText = payload.artist ? (payload.album ? `${payload.artist} • ${payload.album}` : payload.artist) : (payload.album||'')
  const activity = { 
    details, 
    state: stateText,
    instance: false,
    type: 2
  }
  if(typeof payload.startTimestamp === 'number' && typeof payload.endTimestamp === 'number'){
    activity.timestamps = {
      start: Math.floor(payload.startTimestamp/1000),
      end: Math.floor(payload.endTimestamp/1000)
    }
  }
  if(payload.largeImageKey){ activity.largeImageKey = payload.largeImageKey }
  if(payload.largeImageText){ activity.largeImageText = payload.largeImageText }
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
      try{ 
        state.client.setActivity(activity).then(()=>{
          console.log('[DiscordRPC] activity updated successfully')
        }).catch((e)=>{
          console.log('[DiscordRPC] setActivity error', e && e.message)
        })
      }catch(_){ }
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
    if(state.client && state.connected){
      try{ console.log('[DiscordRPC] clear') }catch(_){ }
      try{ state.client.clearActivity() }catch(_){ }
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


