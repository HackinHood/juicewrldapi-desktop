const API_BASE = 'http://juicewrldapi.com/juicewrld'
const API_ORIGIN = 'http://juicewrldapi.com'

const ERA_LABELS = {
  'jute':'JUICED UP THE EP','afflictions':'Affliction',
  'HIH 999':'Heartbroken In Hollywood 999','jw 999':'Juice WRLD 999',
  'bdm':'BINGEDRINKINGMUSIC','ND':"NOTHING'S DIFFERENT </3",
  'GB&GR':'Goodbye & Good Riddance','WOD':'WRLD On Drugs',
  'DRFL':'Death Race For Love','OUT':'Outsiders','POST':'Posthumous',
  'LND':'Legends Never Die','LND (5YAE)':'Legends Never Die (5 Year Anniversary Edition)',
  'TPP':'The Pre Party','TPP (EE)':'The Pre Party (Extended)',
  'TPNE':'The Party Never Ends','TPNE 2.0':'The Party Never Ends 2.0',
  'FD':'Fighting Demons','FD (DDE)':'Fighting Demons (Digital Deluxe Edition)',
  'FD (CE)':'Fighting Demons (Collector\'s Edition)',
  'GB&GR (AE)':'Goodbye & Good Riddance (Anniversary Edition)',
  'GB&GR (5YAE)':'Goodbye & Good Riddance (5 Year Anniversary Edition)',
  'Mainstream':'Mainstream','UNS: JW':'Live','Smule':'Smule',
  'YouTube':'YouTube','SoundCloud':'SoundCloud'
}

const CATEGORY_NAMES = {
  released:'Released', unreleased:'Unreleased',
  unsurfaced:'Unsurfaced', recording_session:'Studio Sessions'
}

const state = {
  songs: [],
  currentPage: 1,
  hasMore: true,
  loading: false,
  totalSongs: 0,
  categoryStats: {},
  categories: [],
  eras: [],
  selectedCategory: '',
  selectedEra: '',
  searchTerm: '',
  searchTimeout: null,
  dataSource: 'Checking',
  useApi: false,
  apiChecked: false
}

const $ = id => document.getElementById(id)

async function apiFetch(path, params = {}) {
  const url = new URL(`${API_BASE}${path}`)
  Object.entries(params).forEach(([k, v]) => {
    if (v !== null && v !== undefined && v !== '') url.searchParams.set(k, v)
  })
  const res = await fetch(url.toString(), { signal: AbortSignal.timeout(15000) })
  if (!res.ok) throw new Error(`API ${res.status}`)
  return res.json()
}

async function checkApiHealth() {
  if (state.apiChecked) return state.useApi
  try {
    await apiFetch('/')
    state.useApi = true
  } catch {
    state.useApi = false
  }
  state.apiChecked = true
  return state.useApi
}

async function fetchStats() {
  const data = await apiFetch('/stats/')
  state.totalSongs = data.total_songs || 0
  state.categoryStats = data.category_stats || {}
}

async function fetchCategories() {
  const data = await apiFetch('/categories/')
  state.categories = (data.categories || []).map(c => c.value)
}

async function fetchEras() {
  const names = new Set()
  let page = 1, hasNext = true
  while (hasNext) {
    const data = await apiFetch('/eras/', { page, page_size: 200 })
    ;(data.results || []).forEach(e => names.add(e.name))
    hasNext = !!data.next
    page++
  }
  state.eras = Array.from(names)
}

async function fetchSongs(reset = false) {
  if (state.loading || (!state.hasMore && !reset)) return
  state.loading = true
  showLoading(true)

  try {
    const pg = reset ? 1 : state.currentPage
    const params = { page: pg }
    if (state.selectedCategory) params.category = state.selectedCategory
    if (state.selectedEra) params.era = state.selectedEra
    if (state.searchTerm) params.search = state.searchTerm

    const data = await apiFetch('/songs/', params)
    const results = data.results || []
    const count = data.count || 0
    const pageSize = 20

    if (reset) {
      state.songs = results
      state.currentPage = 1
    } else {
      state.songs = state.songs.concat(results)
    }
    state.hasMore = !!data.next
    state.currentPage = (reset ? 1 : state.currentPage) + 1

    renderCards(reset)
    $('endOfResults').style.display = (!state.hasMore && state.songs.length > 0) ? 'block' : 'none'
  } catch (err) {
    console.error('Error fetching songs:', err)
  } finally {
    state.loading = false
    showLoading(false)
  }
}

function showLoading(on) {
  $('loadingSpinner').style.display = on ? 'flex' : 'none'
}

async function initData() {
  try {
    await checkApiHealth()
    updateDataSource()

    if (state.useApi) {
      await Promise.all([fetchStats(), fetchCategories(), fetchEras()])
    } else {
      state.dataSource = 'Unavailable'
      updateDataSource()
      return
    }

    updateHero()
    renderStatChips()
    populateFilters()
    await fetchSongs(true)
  } catch (err) {
    console.error('Init error:', err)
  }
}

function updateDataSource() {
  const chip = $('dataSourceChip')
  chip.className = 'data-source-chip ' + (state.useApi ? 'api' : 'local')
  chip.innerHTML = `<i class="fas fa-cloud"></i> Data Source: ${state.useApi ? 'API' : 'Unavailable'}`
}

function updateHero() {
  $('heroTitle').textContent = 'The Juice WRLD API'
  $('heroSubtitle').textContent = `${state.totalSongs} songs across all eras and categories`
}

function renderStatChips() {
  const container = $('statsSection')
  container.innerHTML = ''
  Object.entries(state.categoryStats).forEach(([cat, count]) => {
    const chip = document.createElement('span')
    const isActive = state.selectedCategory === cat
    chip.className = `stat-chip cat-${cat} ${isActive ? 'filled' : 'outline'}`
    chip.textContent = `${CATEGORY_NAMES[cat] || cat}: ${count}`
    chip.onclick = () => {
      state.selectedCategory = state.selectedCategory === cat ? '' : cat
      $('categoryFilter').value = state.selectedCategory
      applyFilters()
    }
    container.appendChild(chip)
  })
}

function populateFilters() {
  const catSel = $('categoryFilter')
  catSel.innerHTML = '<option value="">All Categories</option>'
  state.categories.forEach(cat => {
    const opt = document.createElement('option')
    opt.value = cat
    opt.textContent = CATEGORY_NAMES[cat] || cat
    catSel.appendChild(opt)
  })

  const eraSel = $('eraFilter')
  eraSel.innerHTML = '<option value="">All Eras</option>'
  state.eras.forEach(era => {
    const opt = document.createElement('option')
    opt.value = era
    opt.textContent = ERA_LABELS[era] || era
    eraSel.appendChild(opt)
  })
}

function applyFilters() {
  state.currentPage = 1
  state.hasMore = true
  state.songs = []
  $('cardsGrid').innerHTML = ''
  $('endOfResults').style.display = 'none'
  renderStatChips()
  fetchSongs(true)
}

function renderCards(reset) {
  const grid = $('cardsGrid')
  if (reset) grid.innerHTML = ''

  const startIdx = reset ? 0 : state.songs.length - (state.songs.length - grid.children.length)
  const songsToRender = reset ? state.songs : state.songs.slice(grid.children.length)

  songsToRender.forEach(song => {
    grid.appendChild(buildCard(song))
  })
}

function buildCard(song) {
  const card = document.createElement('div')
  card.className = 'song-card'

  const categoryClass = `badge-${song.category}`
  const categoryLabel = CATEGORY_NAMES[song.category] || song.category
  const eraName = song.era?.name || 'Unknown'
  const artists = song.credited_artists || song.creditedArtists || ''
  const producers = song.producers || ''
  const length = song.length || ''
  const leakType = song.leak_type || ''
  const dateLeaked = song.date_leaked || ''
  const imageUrl = resolveImageUrl(song.image_url || '')
  const trackTitles = song.track_titles || song.trackTitles || []
  const engineers = song.engineers || ''
  const recLocations = song.recording_locations || song.recordingLocations || ''
  const recDates = song.record_dates || song.recordDates || ''
  const sessionTitles = song.session_titles || song.sessionTitles || ''
  const sessionTracking = song.session_tracking || song.sessionTracking || ''
  const fileNames = song.file_names || song.fileNames || ''
  const instrumentals = song.instrumentals || ''
  const instrumentalNames = song.instrumental_names || song.instrumentalNames || ''
  const additionalInfo = song.additional_information || song.additionalInformation || ''
  const previewDate = song.preview_date || song.previewDate || ''
  const releaseDate = song.release_date || song.releaseDate || ''
  const otherDates = song.dates || ''
  const lyrics = song.lyrics || ''

  let html = `
    <div class="card-image-wrap">
      <img src="${escHtml(imageUrl)}" alt="" loading="lazy" onerror="this.style.display='none'">
      <span class="card-category-badge ${categoryClass}">${escHtml(categoryLabel)}</span>
    </div>
    <div class="card-body">
      <div class="card-title">${escHtml(song.name)}</div>
      <div class="card-meta meta-era"><i class="fas fa-clock"></i> Era: ${escHtml(eraName)}</div>`

  if (artists && artists !== 'Unknown')
    html += `<div class="card-meta meta-artist"><i class="fas fa-user"></i> ${escHtml(artists)}</div>`
  if (producers && producers !== 'Unknown')
    html += `<div class="card-meta meta-producer"><i class="fas fa-music"></i> Produced by: ${escHtml(producers)}</div>`
  if (length)
    html += `<div class="card-meta meta-length"><i class="fas fa-stopwatch"></i> ${escHtml(length)}</div>`

  html += `<div class="card-meta meta-leak"><i class="fas fa-info-circle"></i> ${escHtml(leakType)}`
  if (dateLeaked) html += ` <span>(${escHtml(fmtDate(dateLeaked))})</span>`
  html += `</div>`

  if (trackTitles.length > 1)
    html += buildExpansion('fas fa-list', 'Alternative Titles', trackTitles.slice(1).map(t => `&bull; ${escHtml(t)}`).join('<br>'))

  if (engineers && engineers !== 'Unknown')
    html += buildExpansion('fas fa-wrench', 'Engineers', escHtml(engineers))

  if (recLocations || recDates) {
    let content = ''
    if (recLocations) content += `<strong>Location:</strong> ${escHtml(recLocations)}<br>`
    if (recDates) content += `<strong>Date:</strong> ${escHtml(recDates)}`
    html += buildExpansion('fas fa-map-marker-alt', 'Recording Details', content)
  }

  if (sessionTitles || sessionTracking) {
    let content = ''
    if (sessionTitles) content += `<strong>Session Titles:</strong> ${escHtml(sessionTitles)}<br>`
    if (sessionTracking) content += `<strong>Tracking:</strong> ${escHtml(sessionTracking)}`
    html += buildExpansion('fas fa-microphone', 'Session Info', content)
  }

  if (fileNames)
    html += buildExpansion('fas fa-folder', 'File Names', escHtml(fileNames))

  if (instrumentals || instrumentalNames) {
    let content = ''
    if (instrumentals) content += `<strong>Info:</strong> ${escHtml(instrumentals)}<br>`
    if (instrumentalNames) content += `<strong>Names:</strong> ${escHtml(instrumentalNames)}`
    html += buildExpansion('fas fa-guitar', 'Instrumentals', content)
  }

  if (additionalInfo)
    html += buildExpansion('fas fa-info', 'Additional Info', escHtml(additionalInfo))

  if (previewDate || releaseDate || otherDates) {
    let content = ''
    if (previewDate) content += `<strong>Preview Date:</strong> ${escHtml(fmtDate(previewDate))}<br>`
    if (releaseDate) content += `<strong>Release Date:</strong> ${escHtml(fmtDate(releaseDate))}<br>`
    if (otherDates) content += `<strong>Other Dates:</strong> ${escHtml(fmtDate(otherDates))}`
    html += buildExpansion('fas fa-calendar', 'Important Dates', content)
  }

  if (lyrics.trim()) {
    html += `<div class="card-actions">`
    html += `<button class="card-btn btn-lyrics" data-lyrics="${escAttr(lyrics)}" data-name="${escAttr(song.name)}"><i class="fas fa-music"></i> Lyrics</button>`
    html += `</div>`
  }

  html += `</div>`
  card.innerHTML = html

  card.querySelectorAll('.expansion-header').forEach(h => {
    h.addEventListener('click', () => {
      h.classList.toggle('open')
      h.nextElementSibling.classList.toggle('open')
    })
  })

  const lyricsBtn = card.querySelector('.btn-lyrics')
  if (lyricsBtn) {
    lyricsBtn.addEventListener('click', () => {
      $('lyricsModalTitle').textContent = lyricsBtn.dataset.name
      $('lyricsModalText').textContent = lyricsBtn.dataset.lyrics
      $('lyricsModal').style.display = 'flex'
    })
  }

  return card
}

function buildExpansion(icon, label, content) {
  return `<div class="card-expansion">
    <div class="expansion-header">
      <i class="${icon}"></i> ${escHtml(label)}
      <i class="fas fa-chevron-down expansion-chevron"></i>
    </div>
    <div class="expansion-body">${content}</div>
  </div>`
}

function resolveImageUrl(url) {
  if (!url) return ''
  if (url.startsWith('http://') || url.startsWith('https://')) return url
  if (url.startsWith('/')) return API_ORIGIN + url
  return API_ORIGIN + '/' + url
}

function escHtml(str) {
  if (!str) return ''
  return String(str).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;')
}

function escAttr(str) {
  if (!str) return ''
  return String(str).replace(/&/g,'&amp;').replace(/"/g,'&quot;').replace(/'/g,'&#39;').replace(/</g,'&lt;').replace(/>/g,'&gt;')
}

function fmtDate(str) {
  if (!str) return ''
  return String(str).replace(/\n/g, ' ').replace(/\r/g, ' ').trim()
}

async function fullRefresh(btn) {
  if (btn) btn.classList.add('spinning')
  try {
    state.apiChecked = false
    await checkApiHealth()
    updateDataSource()
    if (state.useApi) {
      await Promise.all([fetchStats(), fetchCategories(), fetchEras()])
      updateHero()
      renderStatChips()
      populateFilters()
      await fetchSongs(true)
    }
    try { await window.electronAPI.refreshTrackerIndex() } catch (_) {}
  } catch (err) {
    console.error('Refresh error:', err)
  } finally {
    if (btn) btn.classList.remove('spinning')
  }
}

function setupEventListeners() {
  $('tbMin').onclick = () => window.electronAPI.minimizeWindow()
  $('tbMax').onclick = () => window.electronAPI.maximizeWindow()
  $('tbClose').onclick = () => window.electronAPI.closeWindow()

  $('backToApp').onclick = () => window.electronAPI.openMainUI()

  $('categoryFilter').onchange = e => {
    state.selectedCategory = e.target.value
    applyFilters()
  }
  $('eraFilter').onchange = e => {
    state.selectedEra = e.target.value
    applyFilters()
  }
  $('searchInput').oninput = e => {
    state.searchTerm = e.target.value
    if (state.searchTimeout) clearTimeout(state.searchTimeout)
    state.searchTimeout = setTimeout(() => applyFilters(), 500)
  }

  $('refreshBtn').onclick = () => fullRefresh($('refreshBtn'))

  $('topbarRefreshBtn').onclick = () => fullRefresh($('topbarRefreshBtn'))

  const body = document.querySelector('.tracker-body')
  body.addEventListener('scroll', () => {
    const scrollPos = body.scrollTop + body.clientHeight
    const threshold = body.scrollHeight - 300
    if (scrollPos >= threshold && state.hasMore && !state.loading) {
      fetchSongs()
    }
  })

  $('lyricsModalClose').onclick = () => { $('lyricsModal').style.display = 'none' }
  $('lyricsModal').onclick = e => {
    if (e.target === $('lyricsModal')) $('lyricsModal').style.display = 'none'
  }

  document.addEventListener('keydown', e => {
    if (e.key === 'Escape') $('lyricsModal').style.display = 'none'
    if ((e.ctrlKey || e.metaKey) && e.key === 'h') {
      e.preventDefault()
      window.electronAPI.openMainUI()
    }
  })
}

document.addEventListener('DOMContentLoaded', () => {
  setupEventListeners()
  initData()
})
