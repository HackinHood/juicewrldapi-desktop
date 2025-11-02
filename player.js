let libraryItems = []
let filtered = []
let albums = new Map()
let artists = new Map()
let metaCache = new Map()
let thumbCache = new Map()
let enhanceInProgress = false
let rerenderQueued = false
let enhancementsEnabled = false
let playlists = []
let queue = []
let currentIndex = -1
let currentView = 'home'
let repeatAll = false
let queuePanelEl = null
let historyPanelEl = null
let roomsPanelEl = null
let currentRoom = null
let roomsWS = null
let lastLocalControlAt = 0
let lastRemoteSyncTs = 0
let currentServerPath = ''
let intendedPosition = 0
let contextMenuEl = null
let modal = null
let pipMode = false
let thumbObserver = null
let enhanceQueue = []
let enhanceActive = 0
const ENHANCE_CONCURRENCY = Math.max(1, Math.min(3, (navigator.hardwareConcurrency||2)))
let playHistory = []
let currentVirtualizer = null
let inDetailView = false
let pendingCollections = false
let collectionsRebuildTimer = null
let collectionsCacheKey = null
let nowPlayingUpdateInterval = null
let authState = null

function computeCollectionsCacheKey(){
  let maxM = 0
  for(const it of libraryItems){ if(typeof it.mtimeMs==='number' && it.mtimeMs>maxM) maxM = it.mtimeMs }
  return String(libraryItems.length)+'|'+String(maxM)
}

function saveCollectionsCache(){
  try{
    const key = computeCollectionsCacheKey()
    const artistsObj = {}
    const albumsObj = {}
    artists.forEach((arr, name)=>{ artistsObj[name] = (arr||[]).map(x=>x.localPath) })
    albums.forEach((arr, name)=>{ albumsObj[name] = (arr||[]).map(x=>x.localPath) })
    const payload = { key, artists: artistsObj, albums: albumsObj }
    localStorage.setItem('collectionsCache', JSON.stringify(payload))
    collectionsCacheKey = key
  }catch(_){ }
}

function tryLoadCollectionsCache(){
  try{
    const raw = localStorage.getItem('collectionsCache')
    if(!raw) return false
    const data = JSON.parse(raw)
    const expected = computeCollectionsCacheKey()
    if(!data || !data.key || data.key !== expected) return false
    const byPath = new Map()
    for(const it of libraryItems){ if(it && typeof it.localPath==='string') byPath.set(it.localPath, it) }
    const newArtists = new Map()
    const newAlbums = new Map()
    if(data.artists && typeof data.artists==='object'){
      for(const name of Object.keys(data.artists)){
        const list = []
        const paths = data.artists[name]||[]
        for(const p of paths){ const it = byPath.get(p); if(it) list.push(it) }
        if(list.length) newArtists.set(name, list)
      }
    }
    if(data.albums && typeof data.albums==='object'){
      for(const name of Object.keys(data.albums)){
        const list = []
        const paths = data.albums[name]||[]
        for(const p of paths){ const it = byPath.get(p); if(it) list.push(it) }
        if(list.length) newAlbums.set(name, list)
      }
    }
    if(newArtists.size || newAlbums.size){
      artists = newArtists
      albums = newAlbums
      collectionsCacheKey = expected
      return true
    }
    return false
  }catch(_){ return false }
}

const els = {
  library: document.getElementById('library'),
  search: document.getElementById('searchInput'),
  backToApp: document.getElementById('backToApp'),
  audio: document.getElementById('audio'),
  video: document.getElementById('video'),
  videoContainer: document.getElementById('videoContainer'),
  videoPip: document.getElementById('videoPip'),
  pipClose: document.getElementById('pipClose'),
  pipExpand: document.getElementById('pipExpand'),
  artwork: document.getElementById('artwork'),
  title: document.getElementById('trackTitle'),
  subtitle: document.getElementById('trackSubtitle'),
  playPause: document.getElementById('playPauseBtn'),
  prev: document.getElementById('prevBtn'),
  next: document.getElementById('nextBtn'),
  seek: document.getElementById('seekBar'),
  currentTime: document.getElementById('currentTime'),
  duration: document.getElementById('duration'),
  volume: document.getElementById('volumeBar')
}

function formatTime(sec){
  if(!isFinite(sec)) return '0:00'
  const m = Math.floor(sec/60)
  const s = Math.floor(sec%60).toString().padStart(2,'0')
  return `${m}:${s}`
}

function guessTags(filename, localPath){
  const nameOnly = filename.replace(/\.[^.]+$/, '')
  const patterns = [
    /^(.+?)\s*-\s*(.+)$/,
    /^(.+?)\s*–\s*(.+)$/,
    /^(.+?)\s*—\s*(.+)$/,
    /^(.+?)\s*\(feat\.?\s*(.+?)\)\s*-\s*(.+)$/,
    /^(.+?)\s*\(featuring\s*(.+?)\)\s*-\s*(.+)$/,
    /^(.+?)\s*:\s*(.+)$/,
    /^(.+?)\s*_\s*(.+)$/,
    /^(.+?)\s*\.\s*(.+)$/
  ]
  let artist = 'Unknown Artist'
  let title = nameOnly
  
  for(const pattern of patterns){
    const match = nameOnly.match(pattern)
    if(match){
      if(match.length === 3){
        const potentialArtist = match[1].trim()
        const potentialTitle = match[2].trim()
        if(potentialArtist.length > 0 && potentialTitle.length > 0){
          artist = potentialArtist
          title = potentialTitle
          break
        }
      } else if(match.length === 4){
        const potentialArtist = match[1].trim()
        const potentialTitle = match[3].trim()
        const feat = match[2].trim()
        if(potentialArtist.length > 0 && potentialTitle.length > 0){
          artist = potentialArtist
          title = `${potentialTitle} (feat. ${feat})`
          break
        }
      }
    }
  }
  
  if(artist === 'Unknown Artist'){
    const commonArtists = ['Juice WRLD', 'JuiceWRLD', 'Juice', 'WRLD']
    const lowerName = nameOnly.toLowerCase()
    for(const common of commonArtists){
      if(lowerName.includes(common.toLowerCase())){
        artist = common
        title = nameOnly.replace(new RegExp(common, 'gi'), '').replace(/^[\s\-_\.:]+|[\s\-_\.:]+$/g, '')
        break
      }
    }
  }
  
  let album = 'Unknown Album'
  const folderParts = String(localPath||'').split(/[\\\/]/)
  if(folderParts.length>=2){ 
    album = folderParts[folderParts.length-2] || album
    if(album === 'Unknown Album' && folderParts.length>=3){
      album = folderParts[folderParts.length-3] || album
    }
  }
  return { artist, title, album }
}

async function loadLibrary(){
  const res = await window.electronAPI.getLocalFiles()
  const files = (res&&res.files)||[]
  
  libraryItems = files.map(f=>{
    const ext = (f.filename||'').toLowerCase().split('.').pop()
    const isVideo = ['mp4','webm','mkv','mov'].includes(ext)
    const isAudio = ['mp3','wav','flac','aac','m4a','ogg'].includes(ext)
    const tags = {
      artist: (f.displayArtist || null) || guessTags(f.filename||'Unknown', f.localPath).artist,
      title: (f.displayTitle || null) || guessTags(f.filename||'Unknown', f.localPath).title,
      album: (f.displayAlbum || null) || guessTags(f.filename||'Unknown', f.localPath).album
    }
    return {
      title: tags.title || f.filename || 'Unknown',
      path: f.filepath,
      localPath: f.localPath,
      isVideo,
      isAudio,
      album: tags.album,
      artist: tags.artist,
      year: null,
      genre: null,
      albumArtist: null,
      track: null,
      thumbnail: null,
      mtimeMs: f.mtimeMs
    }
  })
  
  libraryItems = libraryItems.filter(it=>it.isAudio||it.isVideo)
  filtered = [...libraryItems]
  albums = new Map()
  artists = new Map()
  if(!tryLoadCollectionsCache()){
    for(const item of libraryItems){
      const aKey = (item.album && String(item.album).trim()) ? String(item.album).trim() : 'Unknown Album'
      const rKey = (item.albumArtist && String(item.albumArtist).trim()) ? String(item.albumArtist).trim() : (item.artist||'Unknown Artist')
      if(!albums.has(aKey)) albums.set(aKey, [])
      if(!artists.has(rKey)) artists.set(rKey, [])
      albums.get(aKey).push(item)
      artists.get(rKey).push(item)
    }
    saveCollectionsCache()
  }
  
  await loadPlaylists()
  try{
    const h = await window.electronAPI.getPlayHistory()
    if(h && h.success && Array.isArray(h.history)) playHistory = h.history
  }catch(_){}
  
  await (async function hydrateThumbnailsFromCache(){
    const items = libraryItems
    const limit = Math.max(4, Math.min(16, (navigator.hardwareConcurrency||8)))
    let idx = 0
    async function run(){
      while(true){
        const i = idx++
        if(i >= items.length) return
        const it = items[i]
        try{
          const p = await window.electronAPI.getThumbnailPath(it.localPath, it.mtimeMs)
          if(p) it.thumbnail = p
        }catch(_){ }
      }
    }
    const workers = []
    for(let i=0;i<limit;i++) workers.push(run())
    await Promise.all(workers)
  })()
  render()
}

function rebuildCollections(){
  if(collectionsRebuildTimer){
    pendingCollections = true
    return
  }
  collectionsRebuildTimer = setTimeout(()=>{
    collectionsRebuildTimer = null
    const newAlbums = new Map()
    const newArtists = new Map()
    for(const item of libraryItems){
      const albumKey = (item.album && String(item.album).trim()) ? String(item.album).trim() : 'Unknown Album'
      const artistKey = (item.albumArtist && String(item.albumArtist).trim()) ? String(item.albumArtist).trim() : (item.artist||'Unknown Artist')
      if(!newAlbums.has(albumKey)) newAlbums.set(albumKey, [])
      if(!newArtists.has(artistKey)) newArtists.set(artistKey, [])
      newAlbums.get(albumKey).push(item)
      newArtists.get(artistKey).push(item)
    }
    albums = newAlbums
    artists = newArtists
    saveCollectionsCache()
    if(pendingCollections){
      pendingCollections = false
      rebuildCollections()
    }
  }, 750)
}

function scheduleRerender(){
  if(inDetailView) return
  if(rerenderQueued) return
  rerenderQueued = true
  if(!scheduleRerender.__timer){
    scheduleRerender.__timer = setTimeout(()=>{
      scheduleRerender.__timer = null
      rerenderQueued = false
      const prev = lastView
      render()
      if(prev === lastView){
        updateExistingCards()
      }
    }, 300)
  }
}

let updateCardsQueued = false
let lastCardUpdateAt = 0
let pendingCardUpdateTimer = null
function scheduleCardUpdate(){
  const now = (typeof performance !== 'undefined' && performance && performance.now) ? performance.now() : Date.now()
  const minInterval = 250
  if(updateCardsQueued) return
  const elapsed = now - lastCardUpdateAt
  if(elapsed < minInterval){
    if(pendingCardUpdateTimer) return
    pendingCardUpdateTimer = setTimeout(()=>{
      pendingCardUpdateTimer = null
      updateCardsQueued = true
      requestAnimationFrame(()=>{
        updateCardsQueued = false
        lastCardUpdateAt = (typeof performance !== 'undefined' && performance && performance.now) ? performance.now() : Date.now()
        updateExistingCards()
      })
    }, Math.max(0, minInterval - elapsed))
    return
  }
  updateCardsQueued = true
  requestAnimationFrame(()=>{
    updateCardsQueued = false
    lastCardUpdateAt = (typeof performance !== 'undefined' && performance && performance.now) ? performance.now() : Date.now()
    updateExistingCards()
  })
}

let cachedCards = null
let lastView = null

function updateExistingCards(){
  if(currentView === 'albums' || currentView === 'home' || currentView === 'music' || currentView === 'videos'){
    if(!cachedCards || lastView !== currentView){
      cachedCards = document.querySelectorAll('.card')
      lastView = currentView
    }
    
    let updated = 0
    const maxUpdates = 20 // Limit updates per frame to prevent blocking
    
    for(const card of cachedCards){
      if(updated >= maxUpdates) break
      
      if(card.__updateThumbnail){
        if(card.__kind === 'album'){
          if(card.__updateThumbnail()) updated++
        } else if(card.__itemRef){
          if(card.__updateThumbnail()) updated++
        }
      }
    }
  }
}

async function enhanceLibrary(){
  if(enhanceInProgress) return
  enhanceInProgress = true
  
  const batchSize = 6
  const visible = libraryItems.slice(0, batchSize)
  const remaining = libraryItems.slice(batchSize)
  
  for(const item of visible){ queueEnhancement(item) }
  
  let index = 0
  const processBatch = () => {
    if(!(currentView==='albums' || currentView==='home' || currentView==='music' || currentView==='videos')){
      setTimeout(processBatch, 250)
      return
    }
    if(index >= remaining.length) {
      enhanceInProgress = false
      return
    }
    
    const batch = remaining.slice(index, index + batchSize)
    for(const item of batch){ queueEnhancement(item) }
    
    index += batchSize
    setTimeout(processBatch, 250)
  }
  
  setTimeout(processBatch, 100)
}


function setNavActive(key){
  document.querySelectorAll('.nav-btn').forEach(b=>{
    const v = b.getAttribute('data-view')
    if(v===key) b.classList.add('active'); else b.classList.remove('active')
  })
}

function render(){
  setNavActive(currentView)
  inDetailView = false
  cachedCards = null // Clear cache on view change
  if(currentView==='home') return renderHome()
  if(currentView==='search') return renderSearch()
  if(currentView==='albums') return renderAlbums()
  if(currentView==='artists') return renderArtists()
  if(currentView==='playlists') return renderPlaylists()
  if(currentView==='folders') return renderFolders()
  if(currentView==='music') return renderMusic()
  if(currentView==='videos') return renderVideos()
  return renderMusic()
}

function teardownVirtualizer(){
  if(currentVirtualizer){
    try{ els.library.removeEventListener('scroll', currentVirtualizer.onScroll) }catch(_){ }
    try{ window.removeEventListener('resize', currentVirtualizer.onResize) }catch(_){ }
    currentVirtualizer = null
  }
}

function renderVirtualGrid(items, buildOptions){
  teardownVirtualizer()
  const prevScroll = els.library.scrollTop
  els.library.innerHTML = ''
  els.library.style.display = 'block'
  els.library.style.scrollBehavior = 'auto'
  const topSpacer = document.createElement('div')
  const grid = document.createElement('div'); grid.className='row'
  const bottomSpacer = document.createElement('div')
  els.library.appendChild(topSpacer)
  els.library.appendChild(grid)
  els.library.appendChild(bottomSpacer)
  const state = { items, rowH: 320, perRow: 1, buffer: 3, start:-1, end:-1, measured: false }
  
  const calc = ()=>{
    const width = els.library.clientWidth || 800
    state.perRow = Math.max(1, Math.floor(width / 220))
    requestAnimationFrame(render)
  }
  const render = ()=>{
    const scrollTop = els.library.scrollTop
    const viewH = els.library.clientHeight || 600
    const totalRows = Math.max(1, Math.ceil(items.length / state.perRow))
    const maxScrollTop = Math.max(0, (totalRows * state.rowH) - viewH)
    const clampedScrollTop = Math.max(0, Math.min(scrollTop, maxScrollTop))
    const firstRow = Math.max(0, Math.min(totalRows-1, Math.floor(clampedScrollTop / state.rowH) - state.buffer))
    const visibleRows = Math.ceil(viewH / state.rowH) + state.buffer*2
    const lastRow = Math.min(totalRows, firstRow + Math.max(1, visibleRows))
    const start = firstRow * state.perRow
    const end = Math.min(items.length, lastRow * state.perRow)
    if(start===state.start && end===state.end) return
    state.start = start; state.end = end
    grid.innerHTML = ''
    const frag = document.createDocumentFragment()
    for(let i=start;i<end;i++){
      frag.appendChild(buildCard(items[i], items, buildOptions||{ playScope:'single' }))
    }
    grid.appendChild(frag)
    topSpacer.style.height = (firstRow * state.rowH) + 'px'
    bottomSpacer.style.height = Math.max(0, (totalRows - lastRow) * state.rowH) + 'px'
    
    if(!state.measured && grid.children.length > 0){
      requestAnimationFrame(()=>{
        if(grid.children.length > 0){
          const firstCard = grid.children[0]
          const rect = firstCard.getBoundingClientRect()
          if(rect.height > 0){
            const styles = getComputedStyle(grid)
            const gap = parseFloat(styles.rowGap||styles.gridRowGap||'20')||20
            const newHeight = Math.round(rect.height + gap)
            if(Math.abs(newHeight - state.rowH) > 1){
              const oldTotalHeight = totalRows * state.rowH
              const itemsBeforeViewport = Math.floor(scrollTop / state.rowH) * state.perRow
              state.rowH = newHeight
              state.measured = true
              const newTotalRows = Math.max(1, Math.ceil(items.length / state.perRow))
              const newTotalHeight = newTotalRows * state.rowH
              const scrollRatio = itemsBeforeViewport / Math.max(1, items.length)
              const targetScroll = scrollRatio * newTotalHeight
              state.start = -1
              state.end = -1
              els.library.scrollTop = targetScroll
              requestAnimationFrame(render)
            } else {
              state.measured = true
            }
          }
        }
      })
    }
  }
  let scrollTimeout = null
  const onScroll = ()=>{
    if(scrollTimeout) clearTimeout(scrollTimeout)
    scrollTimeout = setTimeout(()=>{
      requestAnimationFrame(render)
      scrollTimeout = null
    }, 16)
  }
  const onResize = ()=>{ 
    state.measured = false
    requestAnimationFrame(calc)
  }
  currentVirtualizer = { onScroll, onResize }
  els.library.addEventListener('scroll', onScroll, { passive:true })
  window.addEventListener('resize', onResize, { passive:true })
  calc()
  try{ els.library.scrollTop = prevScroll }catch(_){ }
}

function renderLibraryGrid(items){
  renderVirtualGrid(items, { playScope:'list' })
}

function renderIncrementalGrid(items, buildOptions){
  teardownVirtualizer()
  els.library.innerHTML = ''
  els.library.style.display = ''
  els.library.style.scrollBehavior = ''
  const grid = document.createElement('div'); grid.className='row'
  els.library.appendChild(grid)
  const chunk = 60
  let i = 0
  function append(){
    const end = Math.min(items.length, i+chunk)
    const frag = document.createDocumentFragment()
    for(; i<end; i++){
      frag.appendChild(buildCard(items[i], items, buildOptions||{ playScope: 'single' }))
    }
    grid.appendChild(frag)
    if(i < items.length) requestAnimationFrame(append)
  }
  append()
}

function renderIncrementalCollections(entries, kind){
  teardownVirtualizer()
  els.library.innerHTML = ''
  els.library.style.display = ''
  els.library.style.scrollBehavior = ''
  const title = document.createElement('div'); title.className='section-title'; title.textContent = kind==='album'?'All Albums':'All Artists'
  const grid = document.createElement('div'); grid.className='row grid-compact'
  els.library.appendChild(title); els.library.appendChild(grid)
  const chunk = 60
  let i = 0
  function append(){
    const end = Math.min(entries.length, i+chunk)
    const frag = document.createDocumentFragment()
    for(; i<end; i++){
      const [name, items] = entries[i]
      frag.appendChild(buildCollectionCard(name, items, kind))
    }
    grid.appendChild(frag)
    if(i < entries.length) requestAnimationFrame(append)
  }
  append()
}

function renderVirtualCollections(entries, kind){
  teardownVirtualizer()
  els.library.innerHTML = ''
  els.library.style.display = 'block'
  els.library.style.scrollBehavior = 'auto'
  const title = document.createElement('div'); title.className='section-title'; title.textContent = kind==='album'?'All Albums':'All Artists'
  const topSpacer = document.createElement('div')
  const grid = document.createElement('div'); grid.className='row grid-compact'
  const bottomSpacer = document.createElement('div')
  els.library.appendChild(title)
  els.library.appendChild(topSpacer)
  els.library.appendChild(grid)
  els.library.appendChild(bottomSpacer)
  const state = { rowH: 300, perRow: 1, buffer: 3, start:-1, end:-1, measured: false }
  
  const calc = ()=>{
    const width = els.library.clientWidth || 800
    state.perRow = Math.max(1, Math.floor(width / 200))
    render()
  }
  const render = ()=>{
    const scrollTop = els.library.scrollTop
    const viewH = els.library.clientHeight || 600
    const totalRows = Math.max(1, Math.ceil(entries.length / state.perRow))
    const maxScrollTop = Math.max(0, (totalRows * state.rowH) - viewH)
    const clampedScrollTop = Math.max(0, Math.min(scrollTop, maxScrollTop))
    const firstRow = Math.max(0, Math.min(totalRows-1, Math.floor(clampedScrollTop / state.rowH) - state.buffer))
    const visibleRows = Math.ceil(viewH / state.rowH) + state.buffer*2
    const lastRow = Math.min(totalRows, firstRow + Math.max(1, visibleRows))
    const start = firstRow * state.perRow
    const end = Math.min(entries.length, lastRow * state.perRow)
    if(start===state.start && end===state.end) return
    state.start = start; state.end = end
    grid.innerHTML = ''
    const frag = document.createDocumentFragment()
    for(let i=start;i<end;i++){
      const [name, items] = entries[i]
      frag.appendChild(buildCollectionCard(name, items, kind))
    }
    grid.appendChild(frag)
    topSpacer.style.height = (firstRow * state.rowH) + 'px'
    bottomSpacer.style.height = Math.max(0, (totalRows - lastRow) * state.rowH) + 'px'
    
    if(!state.measured && grid.children.length > 0){
      requestAnimationFrame(()=>{
        if(grid.children.length > 0){
          const firstCard = grid.children[0]
          const rect = firstCard.getBoundingClientRect()
          if(rect.height > 0){
            const styles = getComputedStyle(grid)
            const gap = parseFloat(styles.rowGap||styles.gridRowGap||'20')||20
            const newHeight = Math.round(rect.height + gap)
            if(Math.abs(newHeight - state.rowH) > 1){
              const oldTotalHeight = totalRows * state.rowH
              const itemsBeforeViewport = Math.floor(scrollTop / state.rowH) * state.perRow
              state.rowH = newHeight
              state.measured = true
              const newTotalRows = Math.max(1, Math.ceil(entries.length / state.perRow))
              const newTotalHeight = newTotalRows * state.rowH
              const scrollRatio = itemsBeforeViewport / Math.max(1, entries.length)
              const targetScroll = scrollRatio * newTotalHeight
              state.start = -1
              state.end = -1
              els.library.scrollTop = targetScroll
              requestAnimationFrame(render)
            } else {
              state.measured = true
            }
          }
        }
      })
    }
  }
  let scrollTimeout = null
  const onScroll = ()=>{
    if(scrollTimeout) clearTimeout(scrollTimeout)
    scrollTimeout = setTimeout(()=>{
      requestAnimationFrame(render)
      scrollTimeout = null
    }, 16)
  }
  const onResize = ()=>{ 
    state.measured = false
    requestAnimationFrame(calc)
  }
  currentVirtualizer = { onScroll, onResize }
  els.library.addEventListener('scroll', onScroll, { passive:true })
  window.addEventListener('resize', onResize, { passive:true })
  calc()
}

function renderHome(){
  teardownVirtualizer()
  els.library.innerHTML = ''
  els.library.style.display = ''
  els.library.style.scrollBehavior = ''
  const title1 = document.createElement('div'); title1.className='section-title'; title1.textContent='Recently Added'
  const row1 = document.createElement('div'); row1.className='row'
  const recent = [...libraryItems].sort((a,b)=> (b.mtimeMs||0)-(a.mtimeMs||0)).slice(0,24)
  els.library.appendChild(title1)
  els.library.appendChild(row1)
  let i1 = 0
  function fillRecent(){
    const end = Math.min(recent.length, i1+8)
    for(; i1<end; i1++) row1.appendChild(buildCard(recent[i1], recent, { playScope: 'single' }))
    if(i1<recent.length) requestAnimationFrame(fillRecent)
  }
  fillRecent()

  const title2 = document.createElement('div'); title2.className='section-title'; title2.textContent='Albums'
  const row2 = document.createElement('div'); row2.className='row grid-compact'
  els.library.appendChild(title2)
  els.library.appendChild(row2)
  const albumNames = Array.from(albums.keys()).slice(0,8)
  let i2=0
  function fillAlbums(){
    const end = Math.min(albumNames.length, i2+4)
    for(; i2<end; i2++){
      const name = albumNames[i2]
      const items = albums.get(name)
      row2.appendChild(buildCollectionCard(name, items, 'album'))
    }
    if(i2<albumNames.length) requestAnimationFrame(fillAlbums)
  }
  fillAlbums()

  const title3 = document.createElement('div'); title3.className='section-title'; title3.textContent='Artists'
  const row3 = document.createElement('div'); row3.className='row grid-compact'
  els.library.appendChild(title3)
  els.library.appendChild(row3)
  const artistNames = Array.from(artists.keys()).slice(0,8)
  let i3=0
  function fillArtists(){
    const end = Math.min(artistNames.length, i3+4)
    for(; i3<end; i3++){
      const name = artistNames[i3]
      const items = artists.get(name)
      row3.appendChild(buildCollectionCard(name, items, 'artist'))
    }
    if(i3<artistNames.length) requestAnimationFrame(fillArtists)
  }
  fillArtists()

  const title4 = document.createElement('div'); title4.className='section-title'; title4.textContent='Playlists'
  const row4 = document.createElement('div'); row4.className='row grid-compact'
  els.library.appendChild(title4)
  els.library.appendChild(row4)
  playlists.slice(0,12).forEach(pl=>{
    const items = pl.items || []
    const card = buildCollectionCard(pl.name, items, 'album')
    row4.appendChild(card)
  })
}

function buildCard(it, list, options){
  const card = document.createElement('div')
  card.className = 'card'
  const thumb = document.createElement('div')
  thumb.className = 'thumb'
  const placeIcon = ()=>{ thumb.innerHTML = it.isVideo?'<i class="fas fa-film"></i>':'<i class="fas fa-music"></i>' }
  placeIcon()
  
  const updateThumbnail = () => {
    if(it.thumbnail && typeof it.thumbnail === 'string'){
      const currentImg = thumb.querySelector('img')
      if(currentImg && currentImg.src === it.thumbnail) return false
      const img = document.createElement('img')
      img.loading = 'lazy'
      img.decoding = 'async'
      img.src = it.thumbnail
      img.style.width = '100%'
      img.style.height = '100%'
      img.style.objectFit = 'cover'
      thumb.innerHTML = ''
      thumb.appendChild(img)
      return true
    }
    return false
  }
  
  updateThumbnail()
  
  card.__updateThumbnail = updateThumbnail
  card.__itemRef = it
  
  const io = getIntersectionObserver()
  if(enhancementsEnabled) io.observe(card)
  const t = document.createElement('div')
  t.className = 'title'; t.textContent = it.title
  const s = document.createElement('div')
  s.className = 'subtitle'; s.textContent = it.isVideo?'Video':`${it.artist} • ${it.album}`
  card.appendChild(thumb); card.appendChild(t); card.appendChild(s)
  card.onclick = (e)=>{
    e.preventDefault()
    e.stopPropagation()
    const applyReplacement = ()=>{
      const playScope = (options && options.playScope) || 'list'
      if(playScope === 'single'){
        queue = [it]
      } else {
        const start = list.indexOf(it)
        queue = list.slice(start)
      }
      repeatAll = false
      playIndex(0)
      refreshQueuePanel()
    }
    if(hasQueueToProtect()){
      modal.open({
        title: 'Replace Queue?',
        message: 'This will clear your current queue and play the selected item. Continue?',
        onConfirm: applyReplacement
      })
    } else {
      applyReplacement()
    }
  }
  card.oncontextmenu = (e)=>{
    e.preventDefault();
    openContextMenu(e.clientX, e.clientY, it, list)
  }
  return card
}

function getIntersectionObserver(){
  if(thumbObserver) return thumbObserver
  thumbObserver = new IntersectionObserver((entries)=>{
    entries.forEach(e=>{
      if(e.isIntersecting && e.target && e.target.__itemRef){
        const item = e.target.__itemRef
        queueEnhancement(item)
        thumbObserver.unobserve(e.target)
      }
    })
  },{root:document.querySelector('.library'),rootMargin:'200px 0px',threshold:0})
  return thumbObserver
}

function queueEnhancement(item){
  const key = item.localPath+':'+(item.mtimeMs||0)
  if(enhanceQueue.find(q=>q.key===key)) return
  enhanceQueue.push({ item, key })
  pumpEnhancers()
}

async function pumpEnhancers(){
  while(enhanceActive < ENHANCE_CONCURRENCY && enhanceQueue.length){
    const task = enhanceQueue.shift()
    enhanceActive++
    ;(async()=>{
      try{
        if(task.item.isAudio && !metaCache.has(task.key)){
          try{
            const r = await window.electronAPI.readAudioMetadata(task.item.localPath)
            if(r&&r.success&&r.metadata){
              const m = r.metadata
              metaCache.set(task.key, m)
              const prevTitle = task.item.title
              const prevAlbum = task.item.album
              const prevArtist = task.item.artist
              const prevAlbumArtist = task.item.albumArtist
              task.item.title = m.title || task.item.title
              task.item.album = m.album || task.item.album
              task.item.artist = m.artist || task.item.artist
              task.item.albumArtist = m.albumArtist || task.item.albumArtist
              if(
                task.item.title !== prevTitle ||
                task.item.album !== prevAlbum ||
                task.item.artist !== prevArtist ||
                task.item.albumArtist !== prevAlbumArtist
              ){
                rebuildCollections()
                scheduleRerender()
              }
            }
          }catch(_){ }
        }
        if((task.item.isVideo || !task.item.thumbnail) && !thumbCache.has(task.key)){
          try{
            const meta = metaCache.get(task.key) || {}
            const th = await extractThumbnail(task.item.localPath, task.item.isVideo, meta.albumArt || null, task.item.mtimeMs || null)
            if(th){ 
              thumbCache.set(task.key, th)
              task.item.thumbnail = th
            }
          }catch(_){ }
        }
      } finally {
        enhanceActive--
        scheduleCardUpdate()
        pumpEnhancers()
      }
    })()
  }
}

function buildCollectionCard(name, items, kind){
  const card = document.createElement('div')
  card.className = 'card'
  const thumb = document.createElement('div')
  thumb.className = 'thumb'
  const place = ()=>{ thumb.innerHTML = kind==='album'?'<i class="fas fa-compact-disc"></i>':'<i class="fas fa-user"></i>' }
  place()
  
  const updateThumbnail = () => {
    if(kind==='album' && items.length>0){
      const itemWithThumbnail = items.find(x=>x.thumbnail && typeof x.thumbnail === 'string')
      if(itemWithThumbnail && itemWithThumbnail.thumbnail){
        const src = itemWithThumbnail.thumbnail
        const currentImg = thumb.querySelector('img')
        if(currentImg && currentImg.src === src) return false
        const img = document.createElement('img')
        img.loading='lazy'; img.decoding='async'
        img.src = src
        img.style.width = '100%'
        img.style.height = '100%'
        img.style.objectFit = 'cover'
        thumb.innerHTML=''
        thumb.appendChild(img)
        return true
      }
    }
    return false
  }
  
  updateThumbnail()
  
  card.__updateThumbnail = updateThumbnail
  card.__items = items
  card.__kind = kind
  
  const t = document.createElement('div'); t.className='title'; t.textContent=name
  const s = document.createElement('div'); s.className='subtitle'; s.textContent=`${items.length} items`
  const pill = document.createElement('div'); pill.className='pill'; pill.innerHTML='<i class="fas fa-play"></i> Play'
  pill.onclick = (e)=>{
    e.stopPropagation()
    const doIt = ()=>{ queue=[...items]; playIndex(0); refreshQueuePanel() }
    if(hasQueueToProtect()){
      modal.open({ title:'Replace Queue?', message:'This will replace your current queue with this collection. Continue?', onConfirm: doIt })
    } else { doIt() }
  }
  card.appendChild(thumb); card.appendChild(t); card.appendChild(s); card.appendChild(pill)
  card.onclick = ()=>{ renderCollectionDetail(name, items, kind) }
  return card
}

function extractThumbnail(filePath, isVideo, albumArtData = null, mtimeMs = null){
  return new Promise(async (resolve) => {
    try{
      const existing = await window.electronAPI.getThumbnailPath(filePath, mtimeMs)
      if(existing){ resolve(existing); return }
    }catch(_){ }
    if(isVideo){
      const video = document.createElement('video')
      video.crossOrigin = 'anonymous'
      video.preload = 'metadata'
      video.onloadedmetadata = () => {
        video.currentTime = 1
        video.onseeked = async () => {
          try{
            const canvas = document.createElement('canvas')
            canvas.width = 200
            canvas.height = 200
            const ctx = canvas.getContext('2d')
            ctx.drawImage(video, 0, 0, canvas.width, canvas.height)
            const dataURL = canvas.toDataURL('image/jpeg', 0.8)
            const res = await window.electronAPI.saveThumbnail(filePath, mtimeMs, dataURL)
            resolve((res&&res.success&&res.url)||null)
          }catch(_){ resolve(null) }
        }
      }
      video.onerror = () => resolve(null)
      video.src = fileURL(filePath)
    } else {
      const saveFromCanvas = async (canvas) => {
        try{
          const dataURL = canvas.toDataURL('image/jpeg', 0.8)
          const res = await window.electronAPI.saveThumbnail(filePath, mtimeMs, dataURL)
          return (res&&res.success&&res.url)||null
        }catch(_){ return null }
      }
      const createFallbackThumbnail = () => {
        setTimeout(async () => {
          try {
            const canvas = document.createElement('canvas')
            canvas.width = 200
            canvas.height = 200
            const ctx = canvas.getContext('2d')
            const gradient = ctx.createLinearGradient(0, 0, 200, 200)
            gradient.addColorStop(0, '#1db954')
            gradient.addColorStop(1, '#191414')
            ctx.fillStyle = gradient
            ctx.fillRect(0, 0, 200, 200)
            ctx.fillStyle = '#fff'
            ctx.font = 'bold 24px Arial'
            ctx.textAlign = 'center'
            ctx.textBaseline = 'middle'
            ctx.fillText('♪', 100, 100)
            const url = await saveFromCanvas(canvas)
            resolve(url)
          } catch (e) {
            resolve(null)
          }
        }, 0)
      }
      if(albumArtData && typeof albumArtData === 'string' && albumArtData.startsWith('data:')){
        try {
          const img = new Image()
          img.onload = async () => {
            try{
              const canvas = document.createElement('canvas')
              canvas.width = 200
              canvas.height = 200
              const ctx = canvas.getContext('2d')
              ctx.drawImage(img, 0, 0, 200, 200)
              const url = await saveFromCanvas(canvas)
              resolve(url)
            }catch(_){ resolve(null) }
          }
          img.onerror = () => createFallbackThumbnail()
          img.src = albumArtData
        } catch (e) {
          createFallbackThumbnail()
        }
      } else {
        createFallbackThumbnail()
      }
    }
  })
}

function renderCollectionDetail(name, items, kind){
  inDetailView = true
  els.library.innerHTML=''
  els.library.style.display = ''
  els.library.style.scrollBehavior = ''
  const header = document.createElement('div'); header.className='section-title'; header.textContent = kind==='album'?`Album: ${name}`:`Artist: ${name}`
  const actions = document.createElement('div'); actions.className='collection-actions';
  const playAll = document.createElement('div'); playAll.className='pill'; playAll.innerHTML='<i class="fas fa-play"></i> Play All'
  playAll.onclick = ()=>{ 
    const doIt = ()=>{ queue=[...items]; repeatAll=false; playIndex(0); refreshQueuePanel() }
    if(queue.length>0){ modal.open({ title:'Replace Queue?', message:'This will replace your current queue with this collection. Continue?', onConfirm: doIt }) }
    else doIt()
  }
  actions.appendChild(playAll)
  const shuffle = document.createElement('div'); shuffle.className='pill'; shuffle.innerHTML='<i class="fas fa-random"></i> Shuffle'
  shuffle.onclick = ()=>{ 
    const doIt = ()=>{ const shuffled = [...items].sort(() => Math.random() - 0.5); queue = shuffled; repeatAll=false; playIndex(0); refreshQueuePanel() }
    if(queue.length>0){ modal.open({ title:'Replace Queue?', message:'This will replace your current queue with a shuffled order. Continue?', onConfirm: doIt }) }
    else doIt()
  }
  actions.appendChild(shuffle)
  const grid = document.createElement('div'); grid.className='row collection-grid'
  els.library.appendChild(header); els.library.appendChild(actions); els.library.appendChild(grid)
  const chunk = 60
  let i=0
  function appendChunk(){
    const frag = document.createDocumentFragment()
    const end = Math.min(i+chunk, items.length)
    for(; i<end; i++) frag.appendChild(buildCard(items[i], items, { playScope: 'single' }))
    grid.appendChild(frag)
    if(i<items.length) requestAnimationFrame(appendChunk)
  }
  appendChunk()
}

function renderSearch(){
  const q = (els.search.value||'').toLowerCase().trim()
  const songMatches = libraryItems.filter(it=> it.isAudio && ((it.title||'').toLowerCase().includes(q) || (it.artist||'').toLowerCase().includes(q) || (it.album||'').toLowerCase().includes(q)))
  const videoMatches = libraryItems.filter(it=> it.isVideo && ((it.title||'').toLowerCase().includes(q) || (it.artist||'').toLowerCase().includes(q) || (it.album||'').toLowerCase().includes(q)))
  const albumEntries = Array.from(albums.entries())
  const albumMatches = albumEntries.filter(([name, items])=> String(name||'').toLowerCase().includes(q))
  const artistEntries = Array.from(artists.entries())
  const artistMatches = artistEntries.filter(([name, items])=> String(name||'').toLowerCase().includes(q))
  const playlistMatches = (playlists||[]).filter(pl=> String(pl.name||'').toLowerCase().includes(q))

  teardownVirtualizer()
  els.library.innerHTML = ''
  els.library.style.display = ''
  els.library.style.scrollBehavior = ''

  const addSection = (titleText, contentBuilder) => {
    const has = contentBuilder()
    if(!has) return false
    return true
  }

  addSection('Songs', ()=>{
    if(songMatches.length===0) return false
    const header = document.createElement('div'); header.className='section-title'; header.textContent='Songs'
    const grid = document.createElement('div'); grid.className='row'
    els.library.appendChild(header); els.library.appendChild(grid)
    let i=0; const chunk=60
    function append(){
      const end = Math.min(i+chunk, songMatches.length)
      for(; i<end; i++) grid.appendChild(buildCard(songMatches[i], songMatches, { playScope:'single' }))
      if(i<songMatches.length) requestAnimationFrame(append)
    }
    append();
    return true
  })

  addSection('Videos', ()=>{
    if(videoMatches.length===0) return false
    const header = document.createElement('div'); header.className='section-title'; header.textContent='Videos'
    const grid = document.createElement('div'); grid.className='row'
    els.library.appendChild(header); els.library.appendChild(grid)
    let i=0; const chunk=60
    function append(){
      const end = Math.min(i+chunk, videoMatches.length)
      for(; i<end; i++) grid.appendChild(buildCard(videoMatches[i], videoMatches, { playScope:'single' }))
      if(i<videoMatches.length) requestAnimationFrame(append)
    }
    append();
    return true
  })

  addSection('Albums', ()=>{
    if(albumMatches.length===0) return false
    const header = document.createElement('div'); header.className='section-title'; header.textContent='Albums'
    const grid = document.createElement('div'); grid.className='row grid-compact'
    els.library.appendChild(header); els.library.appendChild(grid)
    let i=0; const chunk=40
    function append(){
      const end = Math.min(i+chunk, albumMatches.length)
      for(; i<end; i++){
        const [name, items] = albumMatches[i]
        grid.appendChild(buildCollectionCard(name, items, 'album'))
      }
      if(i<albumMatches.length) requestAnimationFrame(append)
    }
    append();
    return true
  })

  addSection('Artists', ()=>{
    if(artistMatches.length===0) return false
    const header = document.createElement('div'); header.className='section-title'; header.textContent='Artists'
    const grid = document.createElement('div'); grid.className='row grid-compact'
    els.library.appendChild(header); els.library.appendChild(grid)
    let i=0; const chunk=40
    function append(){
      const end = Math.min(i+chunk, artistMatches.length)
      for(; i<end; i++){
        const [name, items] = artistMatches[i]
        grid.appendChild(buildCollectionCard(name, items, 'artist'))
      }
      if(i<artistMatches.length) requestAnimationFrame(append)
    }
    append();
    return true
  })

  addSection('Playlists', ()=>{
    if(!Array.isArray(playlistMatches) || playlistMatches.length===0) return false
    const header = document.createElement('div'); header.className='section-title'; header.textContent='Playlists'
    const grid = document.createElement('div'); grid.className='row grid-compact'
    els.library.appendChild(header); els.library.appendChild(grid)
    playlistMatches.forEach(pl=>{
      const items = pl.items||[]
      grid.appendChild(buildCollectionCard(pl.name, items, 'album'))
    })
    return true
  })
}

function renderMusic(){ renderIncrementalGrid(libraryItems.filter(i=>i.isAudio), { playScope:'single' }) }
function renderVideos(){
  teardownVirtualizer()
  const videos = libraryItems.filter(i=>i.isVideo)
  els.library.innerHTML = ''
  els.library.style.display = ''
  els.library.style.scrollBehavior = ''
  const header = document.createElement('div'); header.className='section-title'; header.textContent='Videos'
  const actions = document.createElement('div'); actions.className='collection-actions'
  const playAll = document.createElement('div'); playAll.className='pill'; playAll.innerHTML='<i class="fas fa-play"></i> Play All'
  const shuffle = document.createElement('div'); shuffle.className='pill secondary'; shuffle.innerHTML='<i class="fas fa-random"></i> Shuffle'
  playAll.onclick = (e)=>{ e.stopPropagation(); if(videos.length){ queue=[...videos]; repeatAll=false; playIndex(0); refreshQueuePanel() } }
  shuffle.onclick = (e)=>{ e.stopPropagation(); if(videos.length){ const arr=[...videos]; for(let i=arr.length-1;i>0;i--){ const j=Math.floor(Math.random()*(i+1)); [arr[i],arr[j]]=[arr[j],arr[i]] } queue=arr; repeatAll=false; playIndex(0); refreshQueuePanel() } }
  actions.appendChild(playAll); actions.appendChild(shuffle)
  const grid = document.createElement('div'); grid.className='row'
  els.library.appendChild(header); els.library.appendChild(actions); els.library.appendChild(grid)
  const chunk = 60
  let i = 0
  function appendChunk(){
    const end = Math.min(videos.length, i+chunk)
    for(; i<end; i++){
      grid.appendChild(buildCard(videos[i], videos, { playScope: 'single' }))
    }
    if(i < videos.length) requestAnimationFrame(appendChunk)
  }
  appendChunk()
}

function renderAlbums(){
  teardownVirtualizer()
  els.library.style.display = ''
  els.library.style.scrollBehavior = ''
  const entries = Array.from(albums.entries()).filter(([name, items]) => Array.isArray(items) && items.length > 0)
  entries.sort(([aName],[bName]) => {
    const a = String(aName)
    const b = String(bName)
    if (a === 'Unknown Album' && b !== 'Unknown Album') return 1
    if (b === 'Unknown Album' && a !== 'Unknown Album') return -1
    return a.localeCompare(b)
  })
  if(entries.length > 60){
    renderIncrementalCollections(entries, 'album')
    return
  }
  els.library.innerHTML = ''
  const title = document.createElement('div'); title.className='section-title'; title.textContent='All Albums'
  const grid = document.createElement('div'); grid.className='row grid-compact'
  els.library.appendChild(title); els.library.appendChild(grid)
  let i=0
  function appendAlbums(){
    const frag = document.createDocumentFragment()
    const end = Math.min(i+60, entries.length)
    for(; i<end; i++){
      const [name, items] = entries[i]
      frag.appendChild(buildCollectionCard(name, items, 'album'))
    }
    grid.appendChild(frag)
    if(i<entries.length) requestAnimationFrame(appendAlbums)
  }
  appendAlbums()
}

function renderArtists(){
  teardownVirtualizer()
  els.library.style.display = ''
  els.library.style.scrollBehavior = ''
  const names = Array.from(artists.keys()).sort((a,b)=>String(a).localeCompare(String(b)))
  const entries = names.map(n=>[n, artists.get(n)||[]])
  if(entries.length > 60){
    renderIncrementalCollections(entries, 'artist')
    return
  }
  const draw = () => {
    els.library.innerHTML = ''
    const title = document.createElement('div'); title.className='section-title'; title.textContent='All Artists'
    const grid = document.createElement('div'); grid.className='row grid-compact'
    els.library.appendChild(title); els.library.appendChild(grid)
    let i=0
    function appendArtists(){
      const frag = document.createDocumentFragment()
      const end = Math.min(i+60, entries.length)
      for(; i<end; i++){
        const [name, items] = entries[i]
        frag.appendChild(buildCollectionCard(name, items, 'artist'))
      }
      grid.appendChild(frag)
      if(i<entries.length) requestAnimationFrame(appendArtists)
    }
    appendArtists()
  }
  draw()
}

function renderPlaylists(){
  teardownVirtualizer()
  els.library.innerHTML = ''
  els.library.style.display = ''
  els.library.style.scrollBehavior = ''
  const header = document.createElement('div'); header.className='section-title'; header.textContent='Playlists'
  const actions = document.createElement('div'); actions.className='playlist-actions'
  const createBtn = document.createElement('div'); createBtn.className='pill secondary'; createBtn.innerHTML = '<i class="fas fa-plus"></i> New Playlist'
  createBtn.onclick = ()=>{
    const form = document.createElement('div'); form.className='playlist-form'
    const label = document.createElement('label'); label.textContent='Playlist name'
    const nameInput = document.createElement('input'); nameInput.type='text'; nameInput.placeholder='Enter playlist name'
    form.appendChild(label); form.appendChild(nameInput)
    modal.open({
      title:'Create New Playlist',
      message: form,
      confirmText: 'Create',
      onConfirm: async ()=>{
        const name = (nameInput.value||'').trim()
        if(!name) return
        playlists.push({ id: Date.now(), name, items: [] })
        await savePlaylists()
        renderPlaylists()
      }
    })
  }
  actions.appendChild(createBtn)
  els.library.appendChild(header); els.library.appendChild(actions)
  const grid = document.createElement('div'); grid.className='row grid-compact'
  els.library.appendChild(grid)
  if(playlists.length===0){
    const empty = document.createElement('div'); empty.className='subtitle'; empty.textContent='No playlists yet'
    els.library.appendChild(empty)
    return
  }
  playlists.forEach((pl, idx)=>{
    const card = buildCollectionCard(pl.name, pl.items||[], 'album')
    card.onclick = ()=> renderCollectionDetail(pl.name, pl.items||[], 'album')
    card.oncontextmenu = (e)=>{
      e.preventDefault()
      openPlaylistContextMenu(e.clientX, e.clientY, idx)
    }
    grid.appendChild(card)
  })
}

function renderFolders(){
  teardownVirtualizer()
  els.library.innerHTML = ''
  els.library.style.display = ''
  els.library.style.scrollBehavior = ''
  const header = document.createElement('div'); header.className='section-title'; header.textContent='Folders'
  els.library.appendChild(header)
  
  const folders = new Map()
  
  libraryItems.forEach(item => {
    const path = item.localPath || item.path || ''
    const parts = path.split(/[/\\]/).filter(p => p.trim())
    if(parts.length === 0) return
    
    const folderPath = parts.slice(0, -1).join('/')
    const folderName = folderPath || 'Root'
    
    if(!folders.has(folderName)) {
      folders.set(folderName, [])
    }
    folders.get(folderName).push(item)
  })
  
  if(folders.size === 0) {
    const empty = document.createElement('div'); empty.className='subtitle'; empty.textContent='No folders found'
    els.library.appendChild(empty)
    return
  }
  
  const grid = document.createElement('div'); grid.className='row grid-compact'
  els.library.appendChild(grid)
  
  Array.from(folders.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .forEach(([folderName, items]) => {
      const card = buildCollectionCard(folderName, items, 'album')
      card.onclick = () => renderCollectionDetail(folderName, items, 'album')
      grid.appendChild(card)
    })
}

async function loadPlaylists(){
  try {
    const result = await window.electronAPI.getPlaylists()
    if(result && result.success) {
      playlists = result.playlists || []
    } else {
      console.error('[Playlists] Failed to load:', result?.error)
      playlists = []
    }
  } catch (error) {
    console.error('[Playlists] Error loading playlists:', error)
    playlists = []
  }
}

async function savePlaylists(){
  try {
    const result = await window.electronAPI.savePlaylists(playlists)
    if(!result || !result.success) {
      console.error('[Playlists] Failed to save:', result?.error)
    }
  } catch (error) {
    console.error('[Playlists] Error saving playlists:', error)
  }
}


function updateNowPlaying(meta){
  els.title.textContent = meta?.title||'—'
  if(meta && meta.isVideo){
    els.subtitle.textContent = 'Video'
  } else {
    const artist = meta?.artist || 'Unknown Artist'
    const album = meta?.album || 'Unknown Album'
    els.subtitle.textContent = `${artist} • ${album}`
  }
  if(meta && typeof meta.thumbnail === 'string' && meta.thumbnail){
    els.artwork.src = meta.thumbnail
  } else {
    els.artwork.src = 'assets/icon_128x128.png'
  }
}

function setPlayingState(isPlaying){
  els.playPause.innerHTML = isPlaying?'<i class="fas fa-pause"></i>':'<i class="fas fa-play"></i>'
}

function clearPlaybar(){
  try{ els.audio.pause() }catch(_){ }
  try{ els.video.pause() }catch(_){ }
  try{ els.videoDisplay.pause() }catch(_){ }
  
  els.videoContainer.classList.add('hidden')
  els.videoPip.classList.add('hidden')
  els.library.classList.remove('video-mode')
  
  setPlayingState(false)
  currentIndex = -1
  
  els.title.textContent = '—'
  els.subtitle.textContent = '—'
  els.artwork.src = 'assets/icon_128x128.png'
  
  els.currentTime.textContent = '0:00'
  els.duration.textContent = '0:00'
  els.seek.value = '0'
  
  els.audio.src = ''
  els.video.src = ''
  if(els.videoDisplay) {
    els.videoDisplay.src = ''
  }
  if(els.videoPipDisplay) {
    els.videoPipDisplay.src = ''
  }
  
  stopNowPlayingUpdates()
  try{ window.electronAPI.discordClear() }catch(_){ }
  refreshQueuePanel()
}

function getMedia(){
  return isCurrentVideo()?els.video:els.audio
}

function safePositionMs(){
  const media = getMedia()
  const t = Number.isFinite(media.currentTime) ? media.currentTime : (Number.isFinite(intendedPosition) ? intendedPosition : 0)
  return Math.floor(Math.max(0, t) * 1000)
}

function hasQueueToProtect(){
  const playingCount = currentIndex>=0 ? 1 : 0
  const upcoming = Math.max(0, queue.length - playingCount)
  return upcoming > 0
}

function isCurrentVideo(){
  return currentIndex>=0 && queue[currentIndex]?.isVideo
}

function switchElementVisibility(){
  if(isCurrentVideo()){
    try{ els.audio.pause() }catch(_){ }
    if(pipMode){
      els.videoContainer.classList.add('hidden')
      els.videoPip.classList.remove('hidden')
      els.library.classList.remove('video-mode')
      if(els.video.parentElement !== els.videoPip){
        els.video.style.width = '100%'
        els.video.style.height = 'calc(100% - 40px)'
        els.video.style.objectFit = 'cover'
        els.video.classList.remove('hidden') // Make sure video is visible
        els.videoPip.appendChild(els.video)
      }
    } else {
      els.videoContainer.classList.remove('hidden')
      els.videoPip.classList.add('hidden')
      els.library.classList.add('video-mode')
      if(els.video.parentElement !== els.videoContainer){
        els.video.style.width = '100%'
        els.video.style.height = '100%'
        els.video.style.objectFit = 'contain'
        els.video.classList.remove('hidden') // Make sure video is visible
        els.videoContainer.appendChild(els.video)
      }
    }
  } else {
    try{ els.video.pause() }catch(_){ }
    els.videoContainer.classList.add('hidden')
    els.videoPip.classList.add('hidden')
    els.library.classList.remove('video-mode')
  }
}

function fileURL(localPath){
  return window.electronAPI.pathToFileURL(localPath)
}

async function getApiBase(){
  try{
    const s = await window.electronAPI.getSettings()
    const base = (s && s.serverUrl) ? String(s.serverUrl).trim() : 'https://m.juicewrldapi.com'
    return base.endsWith('/') ? base.slice(0,-1) : base
  }catch(_){ return 'https://m.juicewrldapi.com' }
}

async function makeAuthRequest(endpoint, method = 'GET', data = null){
  const base = await getApiBase()
  const url = `${base}${endpoint}`
  const headers = { 'Content-Type': 'application/json' }
  if(authState && authState.token){ headers['Authorization'] = `Token ${authState.token}` }
  const options = { method, headers }
  if(method !== 'GET' && data){ options.body = JSON.stringify(data) }
  const res = await fetch(url + (method==='GET' && data ? ('?' + new URLSearchParams(data).toString()) : ''), options)
  const json = await res.json().catch(()=>({}))
  if(!res.ok){ return { error: json.error || json.message || `HTTP ${res.status}` } }
  return json
}

async function createListeningRoom(name = 'Listening Room', isPrivate = false){
  const res = await makeAuthRequest('/rooms/create', 'POST', { name, is_private: isPrivate })
  if(res && !res.error){ currentRoom = { id: res.id, code: res.code, name: res.name } }
  return res
}

async function joinListeningRoomByCode(code){
  const res = await makeAuthRequest('/rooms/join', 'POST', { code })
  if(res && !res.error){ currentRoom = { id: res.room_id, code } }
  return res
}

async function loadAuthState(){
  try{
    const settings = await window.electronAPI.getSettings()
    if(settings && settings.authData){
      authState = settings.authData
    } else {
      authState = null
    }
  }catch(e){
    console.error('[NowPlaying] Failed to load auth state:', e)
    authState = null
  }
}

async function updateNowPlayingOnServer(item, isPlaying = true){
  try{
    if(!authState || !authState.token || !authState.deviceId) return
    
    const media = getMedia()
    const serverPath = item.path || item.localPath || ''
    
    const trackData = {
      device_id: authState.deviceId,
      track_name: item.title || 'Unknown',
      artist_name: item.artist || 'Unknown Artist',
      album_name: item.album || 'Unknown Album',
      track_id: serverPath,
      duration_ms: Math.floor((media.duration || 0) * 1000),
      position_ms: Math.floor((media.currentTime || 0) * 1000),
      is_playing: isPlaying,
      is_repeat: repeatAll,
      is_shuffle: false
    }
    
    if(serverPath){
      try{
        const settings = await window.electronAPI.getSettings()
        const base = (settings && settings.serverUrl) ? String(settings.serverUrl).trim() : 'https://m.juicewrldapi.com'
        const norm = base.endsWith('/') ? base.slice(0,-1) : base
        const albumArtUrl = `${norm}/album-art?filepath=${encodeURIComponent(serverPath)}`
        trackData.album_art_url = albumArtUrl
      }catch(_){ }
    }
    
    let base = 'https://m.juicewrldapi.com'
    try{
      const s = await window.electronAPI.getSettings();
      base = (s && s.serverUrl) ? String(s.serverUrl).trim() : base
    }catch(_){ }
    if(base.endsWith('/')) base = base.slice(0,-1)
    const url = `${base}/analytics/now-playing/update`
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Token ${authState.token}`
      },
      body: JSON.stringify(trackData)
    })
    
    if(response.ok){
      console.log('[NowPlaying] Updated successfully')
    } else {
      console.warn('[NowPlaying] Update failed:', response.status)
    }
  }catch(e){
    console.error('[NowPlaying] Update error:', e)
  }
}

async function stopNowPlayingOnServer(){
  try{
    if(!authState || !authState.token || !authState.deviceId) return
    
    let base = 'https://m.juicewrldapi.com'
    try{
      const s = await window.electronAPI.getSettings();
      base = (s && s.serverUrl) ? String(s.serverUrl).trim() : base
    }catch(_){ }
    if(base.endsWith('/')) base = base.slice(0,-1)
    const url = `${base}/analytics/now-playing/stop`
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Token ${authState.token}`
      },
      body: JSON.stringify({
        device_id: authState.deviceId
      })
    })
    
    if(response.ok){
      console.log('[NowPlaying] Stopped successfully')
    }
  }catch(e){
    console.error('[NowPlaying] Stop error:', e)
  }
}

function setDiscordPresenceForItem(item, isPlaying){
  try{
    if(!item) return
    const media = getMedia()
    const durationMs = Math.floor((media && media.duration ? media.duration : 0) * 1000)
    const positionMs = Math.floor((media && media.currentTime ? media.currentTime : 0) * 1000)
    const payload = { 
      title: item.title || 'Unknown', 
      artist: item.artist || 'Unknown Artist', 
      album: item.album || 'Unknown Album',
      largeImageKey: 'logo',
      largeImageText: 'JuiceWRLD API'
    }
    if(isPlaying && durationMs > 0){
      const now = Date.now()
      payload.startTimestamp = now - positionMs
      payload.endTimestamp = now + Math.max(0, durationMs - positionMs)
    }
    window.electronAPI.discordUpdate(payload)
  }catch(_){ }
}

function startNowPlayingUpdates(item){
  if(nowPlayingUpdateInterval){
    clearInterval(nowPlayingUpdateInterval)
  }
  
  updateNowPlayingOnServer(item, true)
  try{ setDiscordPresenceForItem(item, true) }catch(_){ }
  
  nowPlayingUpdateInterval = setInterval(()=>{
    if(currentIndex >= 0 && currentIndex < queue.length){
      const media = getMedia()
      updateNowPlayingOnServer(queue[currentIndex], !media.paused)
      try{
        if(!media.paused){ setDiscordPresenceForItem(queue[currentIndex], true) }
      }catch(_){ }
    }
  }, 30000)
}

function stopNowPlayingUpdates(){
  if(nowPlayingUpdateInterval){
    clearInterval(nowPlayingUpdateInterval)
    nowPlayingUpdateInterval = null
  }
  stopNowPlayingOnServer()
  try{ window.electronAPI.discordClear() }catch(_){ }
}

async function playIndex(idx){
  if(idx<0||idx>=queue.length) return
  currentIndex = idx
  const item = queue[currentIndex]
  switchElementVisibility()
  const media = getMedia()
  const url = fileURL(item.localPath)
  const serverPath = item.path || item.localPath || ''
  if(!url){ return }
  if(media.src !== url){ media.src = url }
  try{ media.load() }catch(_){ }
  media.preload = 'auto'
  media.muted = false
  media.playsInline = true
  intendedPosition = 0
  
  if(isCurrentVideo()) {
    try{ media.play().catch(()=>{}) }catch(_){ }
  }
  
  updateNowPlaying(item)
  pushPlayHistory(item)
  media.play().then(()=>{
    setPlayingState(true)
    updateQueueUIOnPlay()
    startNowPlayingUpdates(item)
    lastLocalControlAt = Date.now()
    try{ broadcastRoomSync({ is_playing: true, position_ms: safePositionMs(), server_path: serverPath, track_title: item.title||'Unknown', artist_name: item.artist||'', album_name: item.album||'' }) }catch(_){ }
    try{ setDiscordPresenceForItem(item, true) }catch(_){ }
  }).catch(()=>{
    setPlayingState(false)
    updateQueueUIOnPlay()
  })
}

function pushPlayHistory(item){
  try{
    const entry = {
      title: item.title,
      artist: item.artist,
      album: item.album,
      isVideo: !!item.isVideo,
      localPath: item.localPath,
      thumbnail: item.thumbnail || null,
      ts: Date.now()
    }
    playHistory.unshift(entry)
    if(playHistory.length>50) playHistory.length = 50
    window.electronAPI.savePlayHistory(playHistory)
  }catch(_){ }
}

function togglePlay(){
  const media = getMedia()
  if(media.src && !media.src.startsWith('blob:') && media.readyState < 2){ try{ media.load() }catch(_){ } }
  if(media.paused){ 
    media.play(); 
    setPlayingState(true)
    if(currentIndex >= 0 && currentIndex < queue.length){
      updateNowPlayingOnServer(queue[currentIndex], true)
      try{ setDiscordPresenceForItem(queue[currentIndex], true) }catch(_){ }
    }
    lastLocalControlAt = Date.now()
    try{ 
      const item = (currentIndex>=0 && currentIndex<queue.length) ? queue[currentIndex] : null
      const serverPath = item ? (item.path || item.localPath || '') : ''
      const posMs = safePositionMs()
      intendedPosition = (Number.isFinite(media.currentTime)?media.currentTime:intendedPosition)||0
      broadcastRoomSync({ 
        is_playing: true, 
        position_ms: posMs,
        server_path: serverPath,
        track_title: item ? (item.title||'Unknown') : undefined,
        artist_name: item ? (item.artist||'') : undefined,
        album_name: item ? (item.album||'') : undefined
      }) 
    }catch(_){ }
  } else { 
    media.pause(); 
    setPlayingState(false)
    if(currentIndex >= 0 && currentIndex < queue.length){
      updateNowPlayingOnServer(queue[currentIndex], false)
    }
    lastLocalControlAt = Date.now()
    try{ 
      const item = (currentIndex>=0 && currentIndex<queue.length) ? queue[currentIndex] : null
      const serverPath = item ? (item.path || item.localPath || '') : ''
      const posMs = safePositionMs()
      intendedPosition = (Number.isFinite(media.currentTime)?media.currentTime:intendedPosition)||0
      broadcastRoomSync({ 
        is_playing: false, 
        position_ms: posMs,
        server_path: serverPath,
        track_title: item ? (item.title||'Unknown') : undefined,
        artist_name: item ? (item.artist||'') : undefined,
        album_name: item ? (item.album||'') : undefined
      }) 
    }catch(_){ }
    try{ window.electronAPI.discordClear() }catch(_){ }
  }
}

function next(){
  if(queue.length===0) return
  
  const removed = currentIndex >= 0 && currentIndex < queue.length
  if(removed){
    queue.splice(currentIndex, 1)
    refreshQueuePanel()
  }
  
  if(queue.length === 0){
    clearPlaybar()
    return
  }
  
  if(currentIndex >= queue.length){
    if(repeatAll){
      currentIndex = 0
      playIndex(0)
    } else {
      clearPlaybar()
    }
    return
  }
  
  playIndex(currentIndex)
}

function prev(){
  if(queue.length===0) return
  if(currentIndex<=0){
    playIndex(0)
    return
  }
  playIndex(currentIndex-1)
}

function bindMediaEvents(media){
  media.addEventListener('timeupdate',()=>{
    els.currentTime.textContent = formatTime(media.currentTime)
    els.duration.textContent = formatTime(media.duration)
    if(media.duration>0){ 
      els.seek.value = String((media.currentTime/media.duration)*100)
      intendedPosition = media.currentTime
    }
  })
  media.addEventListener('loadedmetadata',()=>{
    els.duration.textContent = formatTime(media.duration)
  })
  media.addEventListener('ended',()=>{ next() })
  media.addEventListener('error',()=>{ next() })
}

function onSeek(e){
  const media = getMedia()
  if(media.duration>0){ 
    const newTime = (parseFloat(e.target.value)/100)*media.duration
    media.currentTime = newTime
    intendedPosition = newTime
    lastLocalControlAt = Date.now()
    try{ 
      const item = (currentIndex>=0 && currentIndex<queue.length) ? queue[currentIndex] : null
      const serverPath = item ? (item.path || item.localPath || '') : ''
      broadcastRoomSync({ 
        position_ms: Math.floor(Math.max(0, Number.isFinite(newTime)?newTime:0)*1000), 
        is_playing: !media.paused,
        server_path: serverPath,
        track_title: item ? (item.title||'Unknown') : undefined,
        artist_name: item ? (item.artist||'') : undefined,
        album_name: item ? (item.album||'') : undefined
      })
    }catch(_){ }
  }
}

function onVolume(e){
  const volume = parseFloat(e.target.value)
  els.audio.volume = volume
  els.video.volume = volume
  if(els.videoDisplay) {
    els.videoDisplay.volume = volume
  }
  if(els.videoPipDisplay) {
    els.videoPipDisplay.volume = volume
  }
}

function applySearch(){
  const q = (els.search.value||'').toLowerCase().trim()
  if(q.length===0){
    if(currentView==='search') currentView = 'music'
    render()
    return
  }
  currentView = 'search'
  render()
}

function init(){
  try{
    const isMac = /Mac/i.test(navigator.platform) || /Mac OS X/i.test(navigator.userAgent)
    document.body.classList.toggle('is-mac', !!isMac)
  }catch(_){ }
  els.backToApp.onclick = async ()=>{
    try{
      const hasCurrent = currentIndex>=0 && currentIndex<queue.length
      const media = getMedia()
      const state = hasCurrent ? {
        index: currentIndex,
        time: (media && !isNaN(media.currentTime)) ? media.currentTime : 0,
        paused: media ? media.paused : true,
        volume: media ? media.volume : 1,
        isVideo: isCurrentVideo(),
        queue: queue.map(it=>({ title: it.title, localPath: it.localPath, isVideo: it.isVideo, isAudio: it.isAudio }))
      } : null
      await window.electronAPI.savePlaybackState(state)
    }catch(_){ }
    window.electronAPI.openMainUI()
  }
  els.playPause.onclick = togglePlay
  els.next.onclick = next
  els.prev.onclick = prev
  els.seek.oninput = (e)=>{
    const media = getMedia()
    if(media.duration>0){ 
      const newTime = (parseFloat(e.target.value)/100)*media.duration
      media.currentTime = newTime
      intendedPosition = newTime
    }
  }
  els.seek.onchange = onSeek
  els.volume.oninput = onVolume
  els.volume.onchange = onVolume
  els.search.oninput = applySearch
  bindMediaEvents(els.audio)
  bindMediaEvents(els.video)
  try{ 
    els.video.muted = false; 
    els.video.playsInline = true;
    els.video.controls = false; // Hide default controls since we have custom ones
  }catch(_){ }
  
  if(els.pipClose) {
    els.pipClose.onclick = (e) => {
      try{ e.preventDefault(); e.stopPropagation(); e.stopImmediatePropagation && e.stopImmediatePropagation() }catch(_){ }
      const hasCurrent = currentIndex>=0 && currentIndex < queue.length
      pipMode = false
      if(hasCurrent){
        next()
      } else {
        clearPlaybar()
      }
    }
  }
  
  if(els.pipExpand) {
    els.pipExpand.onclick = (e) => {
      try{ e.preventDefault(); e.stopPropagation() }catch(_){ }
      pipMode = false
      if(isCurrentVideo()) {
        switchElementVisibility()
      }
    }
  }
  
  if(els.videoPip) {
    makePipDraggable()
  }
  const roomsBtn = document.getElementById('roomsBtn')
  if(roomsBtn){
    roomsBtn.onclick = ()=>{
      if(!roomsPanelEl){ mountRoomsUI() }
      if(historyPanelEl) historyPanelEl.style.display='none'
      if(queuePanelEl) queuePanelEl.style.display='none'
      roomsPanelEl.style.display = roomsPanelEl.style.display==='none'||!roomsPanelEl.style.display?'block':'none'
    }
  }
  modal = {
    overlay: document.getElementById('modalOverlay'),
    title: document.getElementById('modalTitle'),
    msg: document.getElementById('modalMessage'),
    cancel: document.getElementById('modalCancel'),
    confirm: document.getElementById('modalConfirm'),
    open(opts){
      this.title.textContent = opts.title || 'Confirm'
      this.msg.innerHTML = ''
      if(typeof opts.message === 'string'){ this.msg.textContent = opts.message }
      else if(opts.message instanceof Node){ this.msg.appendChild(opts.message) }
      this.cancel.textContent = opts.cancelText || 'Cancel'
      this.confirm.textContent = opts.confirmText || 'Confirm'
      this.overlay.style.display = 'flex'
      this.cancel.onclick = ()=>{ this.overlay.style.display='none'; opts.onCancel && opts.onCancel() }
      this.confirm.onclick = ()=>{ this.overlay.style.display='none'; opts.onConfirm && opts.onConfirm() }
    }
  }
  const queueBtn = document.getElementById('queueBtn')
  const historyBtn = document.getElementById('historyBtn')
  if(queueBtn){
    queueBtn.onclick = ()=>{
      if(!queuePanelEl){ mountQueueUI() }
      if(historyPanelEl) historyPanelEl.style.display='none'
      if(queuePanelEl){
        queuePanelEl.style.display = queuePanelEl.style.display==='none'||!queuePanelEl.style.display?'block':'none'
        refreshQueuePanel()
      }
    }
    const observer = new MutationObserver(()=>{
      if(!queuePanelEl) return
      const open = queuePanelEl.style.display==='block'
      if(open) queueBtn.classList.add('primary')
      else queueBtn.classList.remove('primary')
    })
    observer.observe(document.body,{attributes:true,subtree:true,attributeFilter:['style']})
  }
  if(historyBtn){
    historyBtn.onclick = ()=>{
      if(!historyPanelEl){ mountHistoryUI() }
      if(queuePanelEl) queuePanelEl.style.display='none'
      if(historyPanelEl){
        historyPanelEl.style.display = historyPanelEl.style.display==='none'||!historyPanelEl.style.display?'block':'none'
        refreshHistoryPanel()
      }
    }
  }
  document.querySelectorAll('.nav-btn').forEach(b=>{
    b.onclick = (e)=>{
      e.preventDefault()
      const newView = b.getAttribute('data-view')
      
      if(isCurrentVideo() && currentView !== newView) {
        pipMode = true
        switchElementVisibility()
      }
      
      currentView = newView
      render()
    }
  })
  document.addEventListener('keydown',(e)=>{
    if(e.target && (e.target.tagName==='INPUT' || e.target.tagName==='TEXTAREA')) return
    if(e.code==='Space'){ e.preventDefault(); togglePlay() }
    if(e.code==='ArrowRight'){ const m=getMedia(); if(m.duration>0){ m.currentTime = Math.min(m.duration, m.currentTime+5) } }
    if(e.code==='ArrowLeft'){ const m=getMedia(); if(m.duration>0){ m.currentTime = Math.max(0, m.currentTime-5) } }
    if(e.code==='ArrowUp'){ const v=Math.min(1,(els.audio.volume+0.05)); els.audio.volume=v; els.video.volume=v; els.volume.value=String(v) }
    if(e.code==='ArrowDown'){ const v=Math.max(0,(els.audio.volume-0.05)); els.audio.volume=v; els.video.volume=v; els.volume.value=String(v) }
    if(e.ctrlKey && String(e.key).toLowerCase()==='h'){ e.preventDefault(); window.electronAPI.openMainUI() }
  })
  
  document.addEventListener('dragover', (e) => e.preventDefault())
  document.addEventListener('drop', (e) => e.preventDefault())
  
  const min = document.getElementById('tbMin')
  const max = document.getElementById('tbMax')
  const cls = document.getElementById('tbClose')
  if(min) min.onclick = ()=> window.electronAPI.minimizeWindow()
  if(max) max.onclick = ()=> window.electronAPI.maximizeWindow()
  if(cls) cls.onclick = ()=> window.electronAPI.closeWindow()

  loadAuthState()
  loadLibrary()
  mountQueueUI()
  try{
    const settingsInit = ()=>{
      window.electronAPI.getSettings().then(s=>{
        const enabled = !!(s && s.discordRpcEnabled !== false)
        const cid = (s && s.discordRpcClientId) ? String(s.discordRpcClientId) : '1401436107765452860'
        window.electronAPI.discordSetEnabled(enabled)
        if(enabled){ window.electronAPI.discordInit(cid) }
      }).catch(()=>{})
    }
    settingsInit()
  }catch(_){ }
}

function makePipDraggable() {
  let isDragging = false
  let startX, startY, startLeft, startTop
  
  els.videoPip.addEventListener('mousedown', (e) => {
    if(e.target.closest('.pip-btn')) return
    
    isDragging = true
    els.videoPip.classList.add('dragging')
    
    startX = e.clientX
    startY = e.clientY
    const rect = els.videoPip.getBoundingClientRect()
    startLeft = rect.left
    startTop = rect.top
    
    e.preventDefault()
  })
  
  document.addEventListener('mousemove', (e) => {
    if(!isDragging) return
    
    const deltaX = e.clientX - startX
    const deltaY = e.clientY - startY
    
    let newLeft = startLeft + deltaX
    let newTop = startTop + deltaY
    
    const maxLeft = window.innerWidth - els.videoPip.offsetWidth
    const maxTop = window.innerHeight - els.videoPip.offsetHeight
    
    newLeft = Math.max(0, Math.min(newLeft, maxLeft))
    newTop = Math.max(0, Math.min(newTop, maxTop))
    
    els.videoPip.style.left = newLeft + 'px'
    els.videoPip.style.top = newTop + 'px'
    els.videoPip.style.right = 'auto'
    els.videoPip.style.bottom = 'auto'
  })
  
  document.addEventListener('mouseup', () => {
    if(isDragging) {
      isDragging = false
      els.videoPip.classList.remove('dragging')
    }
  })
}

document.addEventListener('DOMContentLoaded', init)

window.addEventListener('focus', ()=>{
  loadAuthState()
})

window.electronAPI.onLibraryUpdated(async ()=>{
  try{
    const prevIndex = currentIndex
    const prevQueue = [...queue]
    await loadLibrary()
    
    if(prevQueue.length > 0){
      const newQueue = []
      let newCurrentIndex = -1
      
      for(let i = 0; i < prevQueue.length; i++){
        const prevItem = prevQueue[i]
        const matchIdx = libraryItems.findIndex(it=> it.localPath===prevItem.localPath)
        if(matchIdx>=0){
          newQueue.push(libraryItems[matchIdx])
          if(i === prevIndex){
            newCurrentIndex = newQueue.length - 1
          }
        }
      }
      
      if(newQueue.length > 0){
        queue = newQueue
        currentIndex = newCurrentIndex
        if(newCurrentIndex < 0 && newQueue.length > 0){
          currentIndex = 0
        }
      } else {
        currentIndex = -1
        clearPlaybar()
      }
    }
    
    if(currentView==='home' || currentView==='music' || currentView==='videos' || currentView==='albums' || currentView==='artists' || currentView==='playlists' || currentView==='folders'){
      render()
    }
    refreshQueuePanel()
  }catch(_){ }
})
function mountQueueUI(){
  if(queuePanelEl) return
  queuePanelEl = document.createElement('div'); queuePanelEl.className='queue-panel'
  queuePanelEl.innerHTML = `<div class="queue-header">Up Next<button class="btn" id="clearQueueBtn"><i class="fas fa-trash"></i> Clear</button></div><div class="queue-list" id="queueList"></div>`
  document.body.appendChild(queuePanelEl)
  queuePanelEl.querySelector('#clearQueueBtn').onclick = ()=>{ queue=[]; clearPlaybar() }
}

function mountRoomsUI(){
  if(roomsPanelEl) return
  roomsPanelEl = document.createElement('div'); roomsPanelEl.className='rooms-panel'
  roomsPanelEl.innerHTML = `
    <div class="queue-header" style="position:sticky; top:0; background:#181818; z-index:1;">Rooms
      <div style="display:flex; gap:.5rem; align-items:center; float:right;">
        <input type="text" id="roomName" placeholder="Room name" style="width: 160px;">
        <button class="btn" id="createRoomBtn">Create</button>
        <input type="text" id="joinRoomCode" placeholder="Code" style="width: 100px; text-transform: uppercase;">
        <button class="btn" id="joinRoomBtn">Join</button>
      </div>
    </div>
    <div class="history-list" id="roomsInfo" style="padding:8px;">
      <div id="roomStatus">Not connected</div>
    </div>`
  document.body.appendChild(roomsPanelEl)
  const roomStatusEl = roomsPanelEl.querySelector('#roomStatus')
  const createRoomBtn = roomsPanelEl.querySelector('#createRoomBtn')
  const joinRoomBtn = roomsPanelEl.querySelector('#joinRoomBtn')
  createRoomBtn.onclick = async ()=>{
    try{
      await loadAuthState()
      if(!authState || !authState.token){ showToast && showToast('error','Login first'); return }
      const name = (roomsPanelEl.querySelector('#roomName')?.value||'').trim()||'Listening Room'
      const res = await createListeningRoom(name, false)
      if(res && !res.error){
        roomStatusEl.textContent = `Created ${res.name} (${res.code}). Connecting...`
        connectRoomWebSocket()
      } else {
        showToast && showToast('error', res?.error || 'Failed to create room')
      }
    }catch(_){ }
  }
  joinRoomBtn.onclick = async ()=>{
    try{
      await loadAuthState()
      if(!authState || !authState.token){ showToast && showToast('error','Login first'); return }
      const code = (roomsPanelEl.querySelector('#joinRoomCode')?.value||'').trim().toUpperCase()
      if(!code){ showToast && showToast('error','Enter a code'); return }
      const res = await joinListeningRoomByCode(code)
      if(res && !res.error){
        roomStatusEl.textContent = `Joined ${code}. Connecting...`
        connectRoomWebSocket()
      } else {
        showToast && showToast('error', res?.error || 'Failed to join room')
      }
    }catch(_){ }
  }
}

async function connectRoomWebSocket(){
  try{
    if(!currentRoom || !authState || !authState.token) return
    let base = 'wss://m.juicewrldapi.com'
    try{
      const s = await window.electronAPI.getSettings()
      const apiBase = (s && s.serverUrl) ? String(s.serverUrl).trim() : 'https://m.juicewrldapi.com'
      const norm = apiBase.endsWith('/') ? apiBase.slice(0,-1) : apiBase
      base = norm.replace('https','wss').replace('http','ws')
    }catch(_){ }
    const wsUrl = `${base}/rooms/ws?room_id=${encodeURIComponent(currentRoom.id)}&token=${encodeURIComponent(authState.token)}`
    if(roomsWS){ try{ roomsWS.close() }catch(_){ } }
    roomsWS = new WebSocket(wsUrl)
    roomsWS.onopen = ()=>{}
    roomsWS.onmessage = async (ev)=>{
      try{
        const msg = JSON.parse(ev.data)
        if(msg.type==='sync'){
          const p = msg.payload||{}
          if(typeof p.ts==='number'){
            if(p.ts <= lastRemoteSyncTs) return
            lastRemoteSyncTs = p.ts
          }
          if(p.origin_device_id && authState && authState.deviceId && String(p.origin_device_id)===String(authState.deviceId)) return
          const media = getMedia && getMedia()
          if(media){
            try{
              let apiBase = 'https://m.juicewrldapi.com'
              try{ const s = await window.electronAPI.getSettings(); apiBase = (s && s.serverUrl) ? String(s.serverUrl).trim() : apiBase }catch(_){ }
              if(apiBase.endsWith('/')) apiBase = apiBase.slice(0,-1)
              if(Array.isArray(p.queue)){
                queue = p.queue.map(it=>({ title:it.title, artist:it.artist, album:it.album, localPath:it.localPath, path:it.path, isVideo:!!it.isVideo }))
                if(typeof p.current_index==='number' && p.current_index>=0 && p.current_index<queue.length){
                  currentIndex = p.current_index
                }
                refreshQueuePanel()
              }
              if(p.track_title || p.artist_name || p.album_name || p.server_path){
                const thumb = p.server_path ? `${apiBase}/album-art?filepath=${encodeURIComponent(p.server_path)}` : null
                updateNowPlaying({ title: p.track_title||'—', artist: p.artist_name||'', album: p.album_name||'', thumbnail: thumb })
              }
              if(p.server_path){
                const streamUrl = `${apiBase}/download?filepath=${encodeURIComponent(p.server_path)}`
                const itemObj = (currentIndex>=0 && currentIndex<queue.length) ? queue[currentIndex] : { title: p.track_title||'Unknown', artist: p.artist_name||'', album: p.album_name||'', path: p.server_path, localPath: p.server_path, isVideo:false }
                const applyPos = ()=>{
                  if(typeof p.position_ms==='number'){
                    const addDrift = p.is_playing===true
                    const driftMs = addDrift && (typeof p.ts==='number') ? Math.max(0, Date.now() - p.ts) : 0
                    const target = Math.max(0, ((p.position_ms||0)+driftMs)/1000)
                    intendedPosition = target
                    const setTime = ()=>{ try{ media.currentTime = target }catch(_){ } }
                    if(isNaN(media.duration) || media.readyState < 1){
                      try{ media.addEventListener('loadedmetadata', function once(){ try{ media.removeEventListener('loadedmetadata', once) }catch(_){ } setTime() }, { once:true }) }catch(_){ }
                    } else {
                      setTime()
                    }
                  }
                  if(p.is_playing===true && media.paused){ try{ media.play() }catch(_){ } }
                  if(p.is_playing===false && !media.paused){ try{ media.pause() }catch(_){ } }
                  setPlayingState(!!p.is_playing)
                  try{ if(p.is_playing){ startNowPlayingUpdates(itemObj); updateNowPlayingOnServer(itemObj, true); setDiscordPresenceForItem && setDiscordPresenceForItem(itemObj, true) } else { updateNowPlayingOnServer(itemObj, false); window.electronAPI && window.electronAPI.discordClear && window.electronAPI.discordClear() } }catch(_){ }
                }
                if(media.src !== streamUrl){
                  media.src = streamUrl
                  media.preload = 'auto'
                  try{ media.load() }catch(_){ }
                  const onMeta = ()=>{
                    try{ media.removeEventListener('loadedmetadata', onMeta) }catch(_){ }
                    if(typeof p.position_ms==='number'){
                      const addDrift = p.is_playing===true
                      const driftMs = addDrift && (typeof p.ts==='number') ? Math.max(0, Date.now() - p.ts) : 0
                      const target = Math.max(0, ((p.position_ms||0)+driftMs)/1000)
                      intendedPosition = target
                      try{ 
                        media.currentTime = target
                      }catch(_){ }
                    }
                    setPlayingState(!!p.is_playing)
                    try{ 
                      const playPromise = p.is_playing===true ? media.play() : Promise.resolve()
                      if(playPromise && typeof playPromise.then==='function'){ 
                        playPromise.then(()=>{
                          try{ if(p.is_playing){ startNowPlayingUpdates(itemObj); updateNowPlayingOnServer(itemObj, true); setDiscordPresenceForItem && setDiscordPresenceForItem(itemObj, true) } }catch(_){ }
                        }).catch(()=>{})
                      }
                    }catch(_){ }
                    if(!p.is_playing){
                      try{ updateNowPlayingOnServer(itemObj, false); window.electronAPI && window.electronAPI.discordClear && window.electronAPI.discordClear() }catch(_){ }
                    }
                  }
                  try{ media.addEventListener('loadedmetadata', onMeta, { once:true }) }catch(_){ }
                } else {
                  applyPos()
                }
              } else {
                const itemObj = (currentIndex>=0 && currentIndex<queue.length) ? queue[currentIndex] : { title: p.track_title||'Unknown', artist: p.artist_name||'', album: p.album_name||'', path: p.server_path, localPath: p.server_path, isVideo:false }
                if(typeof p.position_ms==='number'){
                  const addDrift = p.is_playing===true
                  const driftMs = addDrift && (typeof p.ts==='number') ? Math.max(0, Date.now() - p.ts) : 0
                  const target = Math.max(0, ((p.position_ms||0)+driftMs)/1000)
                  intendedPosition = target
                  const setTime = ()=>{ try{ media.currentTime = target }catch(_){ } }
                  if(isNaN(media.duration) || media.readyState < 1){
                    try{ media.addEventListener('loadedmetadata', function once(){ try{ media.removeEventListener('loadedmetadata', once) }catch(_){ } setTime() }, { once:true }) }catch(_){ }
                  } else {
                    setTime()
                  }
                }
                if(p.is_playing===true && media.paused){ try{ media.play() }catch(_){ } }
                if(p.is_playing===false && !media.paused){ try{ media.pause() }catch(_){ } }
                setPlayingState(!!p.is_playing)
                try{ if(p.is_playing){ startNowPlayingUpdates(itemObj); updateNowPlayingOnServer(itemObj, true); setDiscordPresenceForItem && setDiscordPresenceForItem(itemObj, true) } else { updateNowPlayingOnServer(itemObj, false); window.electronAPI && window.electronAPI.discordClear && window.electronAPI.discordClear() } }catch(_){ }
              }
            }catch(_){ }
          }
        } else if(msg.type==='queue_add'){
          try{
            const payload = msg.payload||{}
            if(Array.isArray(payload.items)){
              queue = payload.items.map(it=>({ title:it.title, artist:it.artist, album:it.album, localPath:it.localPath, path:it.path, isVideo:!!it.isVideo }))
              playIndex(0)
            } else if(payload.item){
              const idx = typeof payload.index==='number' ? Math.min(Math.max(0,payload.index), queue.length) : queue.length
              const it = payload.item
              queue.splice(idx,0,{ title:it.title, artist:it.artist, album:it.album, localPath:it.localPath, path:it.path, isVideo:!!it.isVideo })
              refreshQueuePanel()
            }
          }catch(_){ }
        } else if(msg.type==='queue_move'){
          try{
            const f = msg.payload?.from|0, t = msg.payload?.to|0
            if(f>=0 && f<queue.length){
              const it = queue.splice(f,1)[0]
              const to = Math.min(Math.max(0,t), queue.length)
              queue.splice(to,0,it)
              refreshQueuePanel()
            }
          }catch(_){ }
        } else if(msg.type==='queue_remove'){
          try{
            const i = msg.payload?.index|0
            if(i>=0 && i<queue.length){ queue.splice(i,1); refreshQueuePanel() }
          }catch(_){ }
        }
      }catch(_){ }
    }
    roomsWS.onclose = ()=>{ roomsWS = null }
    roomsWS.onerror = ()=>{}
  }catch(_){ }
}

function broadcastRoomSync(payload){
  try{
    if(roomsWS && roomsWS.readyState===1){
      const snapshot = queue.map(q=>({ title:q.title, artist:q.artist, album:q.album, localPath:q.localPath, path:q.path, isVideo:!!q.isVideo }))
      const enriched = Object.assign({ ts: Date.now(), queue: snapshot, current_index: currentIndex }, payload)
      roomsWS.send(JSON.stringify({ type:'sync', payload: enriched }))
    }
  }catch(_){ }
}


function refreshQueuePanel(){
  if(!queuePanelEl) return
  const list = queuePanelEl.querySelector('#queueList')
  if(!list) return
  list.innerHTML = ''
  queue.forEach((it, idx)=>{
    if(idx === currentIndex) return
    
    const row = document.createElement('div'); row.className='queue-item'
    const thumb = document.createElement('div'); thumb.className='thumb'; thumb.style.width='48px'; thumb.style.height='48px'
    if(it.thumbnail){ const img = document.createElement('img'); img.src=it.thumbnail; thumb.appendChild(img) }
    const meta = document.createElement('div'); meta.className='qi-meta'
    const ti = document.createElement('div'); ti.className='qi-title'; ti.textContent = it.title
    const sb = document.createElement('div'); sb.className='qi-sub'; sb.textContent = it.isVideo?'Video':`${it.artist} • ${it.album}`
    meta.appendChild(ti); meta.appendChild(sb)
    const actions = document.createElement('div'); actions.className='queue-actions'
    const up = document.createElement('button'); up.className='btn'; up.textContent='↑'; up.onclick=(e)=>{ e.preventDefault(); e.stopPropagation(); moveInQueue(idx, Math.max(0, idx-1)); try{ broadcastRoomSync({ type:'queue_move', from: idx, to: Math.max(0, idx-1) }) }catch(_){ } }
    const down = document.createElement('button'); down.className='btn'; down.textContent='↓'; down.onclick=(e)=>{ e.preventDefault(); e.stopPropagation(); moveInQueue(idx, Math.min(queue.length-1, idx+1)); try{ broadcastRoomSync({ type:'queue_move', from: idx, to: Math.min(queue.length-1, idx+1) }) }catch(_){ } }
    const rem = document.createElement('button'); rem.className='btn'; rem.textContent='✕'; rem.onclick=(e)=>{ e.preventDefault(); e.stopPropagation(); removeFromQueue(idx); try{ broadcastRoomSync({ type:'queue_remove', index: idx }) }catch(_){ } }
    actions.appendChild(up); actions.appendChild(down); actions.appendChild(rem)
    row.appendChild(thumb); row.appendChild(meta); row.appendChild(actions)
    row.onclick = ()=> playIndex(idx)
    list.appendChild(row)
  })
  
  const header = queuePanelEl.querySelector('.queue-header')
  if(header) {
    const remainingCount = Math.max(0, queue.length - (currentIndex >= 0 ? 1 : 0))
    header.innerHTML = `Up Next (${remainingCount})<button class="btn" id="clearQueueBtn"><i class="fas fa-trash"></i> Clear</button>`
    const clearBtn = queuePanelEl.querySelector('#clearQueueBtn')
    if(clearBtn) {
      clearBtn.onclick = ()=>{ queue=[]; clearPlaybar() }
    }
  }
}

function mountHistoryUI(){
  if(historyPanelEl) return
  historyPanelEl = document.createElement('div'); historyPanelEl.className='history-panel'
  historyPanelEl.innerHTML = `<div class="queue-header">History<button class="btn" id="clearHistoryBtn"><i class="fas fa-trash"></i> Clear</button></div><div class="history-list" id="historyList"></div>`
  document.body.appendChild(historyPanelEl)
  historyPanelEl.querySelector('#clearHistoryBtn').onclick = async ()=>{
    playHistory = []
    await window.electronAPI.savePlayHistory(playHistory)
    refreshHistoryPanel()
  }
}

function refreshHistoryPanel(){
  if(!historyPanelEl) return
  const list = historyPanelEl.querySelector('#historyList')
  if(!list) return
  list.innerHTML = ''
  playHistory.forEach((it)=>{
    const row = document.createElement('div'); row.className='history-item'
    const thumb = document.createElement('div'); thumb.className='thumb'; thumb.style.width='48px'; thumb.style.height='48px'
    if(it.thumbnail){ const img = document.createElement('img'); img.src=it.thumbnail; thumb.appendChild(img) }
    const meta = document.createElement('div'); meta.className='qi-meta'
    const ti = document.createElement('div'); ti.className='qi-title'; ti.textContent = it.title
    const sb = document.createElement('div'); sb.className='qi-sub'; sb.textContent = it.isVideo?'Video':`${it.artist} • ${it.album}`
    meta.appendChild(ti); meta.appendChild(sb)
    const actions = document.createElement('div'); actions.className='queue-actions'
    const playBtn = document.createElement('button'); playBtn.className='btn'; playBtn.textContent='Play'
    playBtn.onclick = ()=>{
      const idx = libraryItems.findIndex(x=>x.localPath===it.localPath)
      if(idx>=0){ queue=[libraryItems[idx]]; playIndex(0) }
    }
    actions.appendChild(playBtn)
    row.appendChild(thumb); row.appendChild(meta); row.appendChild(actions)
    list.appendChild(row)
  })
}

function moveInQueue(from, to){
  if(from===to) return
  const item = queue.splice(from,1)[0]
  queue.splice(to,0,item)
  if(currentIndex===from) currentIndex = to
  else if(from<currentIndex && to>=currentIndex) currentIndex--
  else if(from>currentIndex && to<=currentIndex) currentIndex++
  refreshQueuePanel()
}

function removeFromQueue(index){
  queue.splice(index,1)
  if(index < currentIndex) currentIndex = currentIndex - 1
  if(currentIndex>=queue.length) currentIndex = queue.length-1
  refreshQueuePanel()
}

function openContextMenu(x, y, item, list){
  if(!contextMenuEl){
    contextMenuEl = document.createElement('div'); contextMenuEl.className='context-menu'
    document.body.appendChild(contextMenuEl)
  }
  contextMenuEl.innerHTML = ''
  const addNext = document.createElement('button'); addNext.textContent = 'Play Next'
  addNext.onclick = ()=>{ addNextInQueue(item); hideContextMenu() }
  const addEnd = document.createElement('button'); addEnd.textContent = 'Add to Queue'
  addEnd.onclick = ()=>{ queue.push(item); refreshQueuePanel(); hideContextMenu() }
  const addToPlaylist = document.createElement('button'); addToPlaylist.textContent = 'Add to Playlist'
  addToPlaylist.onclick = ()=>{
    hideContextMenu()
    const form = document.createElement('div'); form.className='playlist-form'
    const label1 = document.createElement('label'); label1.textContent='Choose playlist'
    const select = document.createElement('select')
    const optNew = document.createElement('option'); optNew.value='__new__'; optNew.textContent='— New Playlist —'
    select.appendChild(optNew)
    playlists.forEach((pl, i)=>{
      const opt = document.createElement('option'); opt.value=String(i); opt.textContent = pl.name
      select.appendChild(opt)
    })
    const label2 = document.createElement('label'); label2.textContent='Playlist name'
    const nameInput = document.createElement('input'); nameInput.type='text'; nameInput.placeholder='Enter new playlist name'
    nameInput.disabled = true
    select.onchange = ()=>{ nameInput.disabled = (select.value !== '__new__') }
    nameInput.disabled = (select.value !== '__new__')
    form.appendChild(label1); form.appendChild(select); form.appendChild(label2); form.appendChild(nameInput)
    modal.open({
      title:'Add to Playlist',
      message: form,
      confirmText: 'Add',
      onConfirm: async ()=>{
        if(select.value==='__new__'){
          const name = (nameInput.value||'').trim()
          if(!name) return
          playlists.push({ id: Date.now(), name, items:[item] })
        } else {
          const idx = parseInt(select.value,10)
          if(!isNaN(idx) && playlists[idx]){
            playlists[idx].items = (playlists[idx].items||[]).concat(item)
          }
        }
        await savePlaylists()
        if(currentView==='playlists') renderPlaylists()
      }
    })
  }
  contextMenuEl.appendChild(addNext); contextMenuEl.appendChild(addEnd)
  contextMenuEl.appendChild(addToPlaylist)
  contextMenuEl.style.left = x+'px'
  contextMenuEl.style.top = y+'px'
  contextMenuEl.style.display = 'block'
  setTimeout(()=>{
    document.addEventListener('click', hideContextMenu, { once:true })
  },0)
}

function hideContextMenu(){ if(contextMenuEl) contextMenuEl.style.display='none' }

function openPlaylistContextMenu(x, y, playlistIndex){
  if(!contextMenuEl){
    contextMenuEl = document.createElement('div'); contextMenuEl.className='context-menu'
    document.body.appendChild(contextMenuEl)
  }
  contextMenuEl.innerHTML = ''

  const renameBtn = document.createElement('button'); renameBtn.textContent = 'Rename Playlist'
  const deleteBtn = document.createElement('button'); deleteBtn.textContent = 'Delete Playlist'

  renameBtn.onclick = ()=>{
    hideContextMenu()
    const pl = playlists[playlistIndex]
    if(!pl) return
    const form = document.createElement('div'); form.className='playlist-form'
    const label = document.createElement('label'); label.textContent='New name'
    const nameInput = document.createElement('input'); nameInput.type='text'; nameInput.value = pl.name || ''
    form.appendChild(label); form.appendChild(nameInput)
    modal.open({
      title:'Rename Playlist',
      message: form,
      confirmText: 'Rename',
      onConfirm: async ()=>{
        const name = (nameInput.value||'').trim()
        if(!name) return
        pl.name = name
        await savePlaylists()
        renderPlaylists()
      }
    })
  }

  deleteBtn.onclick = ()=>{
    hideContextMenu()
    const pl = playlists[playlistIndex]
    if(!pl) return
    modal.open({
      title:'Delete Playlist?',
      message:`Are you sure you want to delete "${pl.name}"? This cannot be undone.`,
      confirmText:'Delete',
      onConfirm: async ()=>{
        playlists.splice(playlistIndex,1)
        await savePlaylists()
        renderPlaylists()
      }
    })
  }

  contextMenuEl.appendChild(renameBtn)
  contextMenuEl.appendChild(deleteBtn)
  contextMenuEl.style.left = x+'px'
  contextMenuEl.style.top = y+'px'
  contextMenuEl.style.display = 'block'
  setTimeout(()=>{ document.addEventListener('click', hideContextMenu, { once:true }) },0)
}

function addNextInQueue(item){
  if(currentIndex<0){ queue=[item]; playIndex(0); try{ broadcastRoomSync({ type:'queue_set', items: queue.map(q=>({ title:q.title, artist:q.artist, album:q.album, localPath:q.localPath, path:q.path, isVideo:q.isVideo })) }) }catch(_){ } return }
  queue.splice(currentIndex+1, 0, item)
  try{ broadcastRoomSync({ type:'queue_add', index: currentIndex+1, item: { title:item.title, artist:item.artist, album:item.album, localPath:item.localPath, path:item.path, isVideo:item.isVideo } }) }catch(_){ }
  refreshQueuePanel()
}

function updateQueueUIOnPlay(){
  refreshQueuePanel()
}


