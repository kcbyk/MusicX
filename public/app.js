/* ===== MusicX App.js — Clean & Error-Free ===== */

'use strict';

/* ─── State ─── */
let library        = [];
let currentSongIndex = 0;
let previewData    = null;
let libSearchTimer = null;

/* ─── Safe DOM helper ─── */
function $id(id) { return document.getElementById(id); }

/* ─── DOM refs (resolved after DOMContentLoaded) ─── */
let audioPlayer, playBtn, playIcon, progressBar, progressFill,
    currentTimeEl, totalTimeEl, volumeBar, volumeFill,
    likeBtn, playerCover, playerTitle, playerArtist,
    libraryGrid, emptyLibrary, songCountEl,
    downloadBtn, songPreviewEl, previewCoverEl,
    previewTitleEl, previewArtistEl, previewDurEl,
    loadingStateEl, loadingTextEl,
    searchInput, libClearBtn,
    prevBtn, nextBtn, playerBar, closePlayerBtn,
    unifiedInput, unifiedBtn, clearInputBtn,
    searchResultsEl, resultsGridEl;

/* ─── Init ─── */
document.addEventListener('DOMContentLoaded', async () => {
  // Resolve all DOM refs safely
  audioPlayer    = $id('audio-player');
  playBtn        = $id('play-btn');
  playIcon       = $id('play-icon');
  progressBar    = $id('progress-bar');
  progressFill   = $id('progress-fill');
  currentTimeEl  = $id('current-time');
  totalTimeEl    = $id('total-time');
  volumeBar      = $id('volume-bar');
  volumeFill     = $id('volume-fill');
  likeBtn        = $id('like-btn');
  playerCover    = $id('player-cover');
  playerTitle    = $id('player-title');
  playerArtist   = $id('player-artist');
  libraryGrid    = $id('library-grid');
  emptyLibrary   = $id('empty-library');
  songCountEl    = $id('song-count');
  downloadBtn    = $id('download-btn');
  songPreviewEl  = $id('song-preview');
  previewCoverEl = $id('preview-cover');
  previewTitleEl = $id('preview-title');
  previewArtistEl= $id('preview-artist');
  previewDurEl   = $id('preview-duration');
  loadingStateEl = $id('loading-state');
  loadingTextEl  = $id('loading-text');
  searchInput    = $id('search-input');
  libClearBtn    = $id('lib-clear-btn');
  prevBtn        = $id('prev-btn');
  nextBtn        = $id('next-btn');
  playerBar      = $id('player-bar');
  closePlayerBtn = $id('close-player-btn');
  unifiedInput   = $id('unified-input');
  unifiedBtn     = $id('unified-btn');
  clearInputBtn  = $id('clear-input-btn');
  searchResultsEl= $id('search-results');
  resultsGridEl  = $id('results-grid');

  initSidebarToggle();
  initNavigation();
  initMobileNav();
  initPlayer();
  initLibrarySearch();
  initUnifiedInput();
  initDownload();
  await loadLibrary();
});

/* ═══════════════════════ SIDEBAR ═══════════════════════ */
function initSidebarToggle() {
  const sidebar  = $id('sidebar');
  const overlay  = $id('sidebar-overlay');
  if (!sidebar || !overlay) return;

  const isMobile = () => window.innerWidth <= 768;

  // Always ensure sidebar is interactive on desktop when window resizes
  window.addEventListener('resize', () => {
    if (!isMobile()) {
      sidebar.classList.remove('no-pointer');
      overlay.classList.remove('active');
      sidebar.classList.remove('mobile-open');
    }
  });

  document.querySelectorAll('.hamburger-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      if (isMobile()) {
        const open = sidebar.classList.contains('mobile-open');
        sidebar.classList.toggle('mobile-open', !open);
        overlay.classList.toggle('active', !open);
        // Toggle class instead of inline style
        sidebar.classList.toggle('no-pointer', open);
      } else {
        // Desktop: collapse/expand — always remove no-pointer
        sidebar.classList.remove('no-pointer');
        const collapsed = sidebar.classList.toggle('collapsed');
        document.querySelector('.app-container')?.classList.toggle('sidebar-collapsed', collapsed);
      }
    });
  });

  overlay.addEventListener('click', closeMobileSidebar);

  function closeMobileSidebar() {
    sidebar.classList.remove('mobile-open');
    overlay.classList.remove('active');
    // Use class for pointer-events control
    if (isMobile()) {
      sidebar.classList.add('no-pointer');
    } else {
      sidebar.classList.remove('no-pointer');
    }
  }
  window._closeMobileSidebar = closeMobileSidebar;
}

/* ═══════════════════════ NAVIGATION ═══════════════════════ */
function initNavigation() {
  document.querySelectorAll('.nav-item').forEach(item => {
    item.addEventListener('click', e => {
      e.preventDefault();
      navigateTo(item.dataset.page);
    });
  });
}

function initMobileNav() {
  document.querySelectorAll('.mobile-nav-item').forEach(item => {
    item.addEventListener('click', e => {
      e.preventDefault();
      navigateTo(item.dataset.page);
    });
  });
}

function navigateTo(page) {
  if (!page) return;

  // Sidebar nav highlight
  document.querySelectorAll('.nav-item').forEach(i => i.classList.remove('active'));
  document.querySelector(`.nav-item[data-page="${page}"]`)?.classList.add('active');

  // Mobile nav highlight
  document.querySelectorAll('.mobile-nav-item').forEach(i => i.classList.remove('active'));
  document.querySelector(`.mobile-nav-item[data-page="${page}"]`)?.classList.add('active');

  // Page switch
  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
  $id(page + '-page')?.classList.add('active');

  // Scroll page body to top
  $id(page + '-page')?.querySelector('.page-body')?.scrollTo(0, 0);

  // Close mobile sidebar
  window._closeMobileSidebar?.();
}

/* ═══════════════════════ PLAYER ═══════════════════════ */
function initPlayer() {
  if (!audioPlayer) return;

  playBtn?.addEventListener('click', togglePlay);
  audioPlayer.addEventListener('timeupdate', updateProgress);
  audioPlayer.addEventListener('loadedmetadata', updateDuration);
  audioPlayer.addEventListener('ended', playNext);
  audioPlayer.addEventListener('play',  () => {
    if (playIcon) playIcon.innerHTML = '<path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z"/>';
  });
  audioPlayer.addEventListener('pause', () => {
    if (playIcon) playIcon.innerHTML = '<path d="M8 5v14l11-7z"/>';
  });

  progressBar?.addEventListener('click', seekTo);
  volumeBar?.addEventListener('click', setVolume);
  audioPlayer.volume = 0.7;

  prevBtn?.addEventListener('click', playPrev);
  nextBtn?.addEventListener('click', playNext);
  closePlayerBtn?.addEventListener('click', hidePlayer);
  likeBtn?.addEventListener('click', () => likeBtn.classList.toggle('liked'));

  // Touch seek on progress bar
  if (progressBar) {
    let seeking = false;
    progressBar.addEventListener('touchstart', () => { seeking = true; }, { passive: true });
    progressBar.addEventListener('touchmove', e => {
      if (!seeking || !audioPlayer.duration) return;
      const r = progressBar.getBoundingClientRect();
      const pct = Math.max(0, Math.min(1, (e.touches[0].clientX - r.left) / r.width));
      audioPlayer.currentTime = pct * audioPlayer.duration;
    }, { passive: true });
    progressBar.addEventListener('touchend', () => { seeking = false; }, { passive: true });
  }
}

/* ── Library ── */
async function loadLibrary() {
  try {
    const res = await fetch('/api/library');
    if (!res.ok) throw new Error('HTTP ' + res.status);
    library = await res.json();
  } catch (e) {
    console.error('Library load error:', e);
    library = [];
  }
  renderLibrary();
  renderHomeLibrary();
}

function renderLibrary() {
  if (!libraryGrid || !emptyLibrary) return;
  libraryGrid.innerHTML = '';
  const isEmpty = library.length === 0;
  emptyLibrary.style.display = isEmpty ? 'flex' : 'none';
  libraryGrid.style.display  = isEmpty ? 'none' : 'grid';
  if (!isEmpty) {
    library.forEach((song, i) => libraryGrid.appendChild(createSongCard(song, i)));
  }
  if (songCountEl) songCountEl.textContent = `${library.length} şarkı`;
}

function renderHomeLibrary() {
  const section = $id('home-library-section');
  const grid    = $id('home-library-grid');
  if (!section || !grid) return;
  section.style.display = library.length === 0 ? 'none' : 'block';
  grid.innerHTML = '';
  // FIX: pass real library index so playSong() works correctly
  library.slice(0, 6).forEach((song, sliceIdx) => {
    const realIdx = sliceIdx; // slice(0,6) → indices 0-5 = same as library indices
    grid.appendChild(createSongCard(song, realIdx));
  });
}

function createSongCard(song, index) {
  const card = document.createElement('div');
  card.className = 'song-card';

  const cover = document.createElement('div');
  cover.className = 'song-cover';
  if (song.coverFile) {
    cover.style.backgroundImage = `url('/api/covers/${song.coverFile}')`;
  } else {
    cover.style.background = 'linear-gradient(135deg,#ff6b6b,#feca57)';
  }

  const playSmall = document.createElement('button');
  playSmall.className = 'play-btn-small';
  playSmall.setAttribute('aria-label', 'Oynat');
  playSmall.innerHTML = '<svg fill="currentColor" viewBox="0 0 24 24"><path d="M8 5v14l11-7z"/></svg>';
  playSmall.addEventListener('click', e => { e.stopPropagation(); playSong(index); });

  const title = document.createElement('h4');
  title.className = 'song-title';
  title.textContent = song.title;
  title.title = song.title;

  const artist = document.createElement('p');
  artist.className = 'song-artist';
  artist.textContent = song.artist;

  // Options (More) Button
  const moreBtn = document.createElement('button');
  moreBtn.className = 'more-btn';
  moreBtn.setAttribute('aria-label', 'Seçenekler');
  moreBtn.innerHTML = '<svg fill="currentColor" viewBox="0 0 24 24"><path d="M12 8c1.1 0 2-.9 2-2s-.9-2-2-2-2 .9-2 2 .9 2 2 2zm0 2c-1.1 0-2 .9-2 2s.9 2 2 2 2-.9 2-2-.9-2-2-2zm0 6c-1.1 0-2 .9-2 2s.9 2 2 2 2-.9 2-2-.9-2-2-2z"/></svg>';

  // Options Dropdown Menu
  const dropdown = document.createElement('div');
  dropdown.className = 'song-dropdown';

  // Download Option
  const downloadItem = document.createElement('button');
  downloadItem.className = 'dropdown-item download-item';
  downloadItem.innerHTML = '<svg fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4"/></svg> Cihaza İndir (MP3)';
  downloadItem.addEventListener('click', e => {
    e.stopPropagation();
    dropdown.classList.remove('active');
    moreBtn.classList.remove('active');
    
    // Trigger forced browser download
    const downloadUrl = `/api/music/${song.musicFile}?download=true&title=${encodeURIComponent(song.title)}`;
    const link = document.createElement('a');
    link.href = downloadUrl;
    link.download = `${song.title}.mp3`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    
    toast('📥 İndirme başlatıldı...');
  });

  // Delete Option
  const deleteItem = document.createElement('button');
  deleteItem.className = 'dropdown-item delete-item';
  deleteItem.innerHTML = '<svg fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"/></svg> Kütüphaneden Sil';
  deleteItem.addEventListener('click', e => {
    e.stopPropagation();
    dropdown.classList.remove('active');
    moreBtn.classList.remove('active');
    deleteSong(song.id);
  });

  dropdown.append(downloadItem, deleteItem);

  moreBtn.addEventListener('click', e => {
    e.stopPropagation();
    
    // Close other active dropdowns
    document.querySelectorAll('.song-dropdown.active').forEach(openDropdown => {
      if (openDropdown !== dropdown) {
        openDropdown.classList.remove('active');
        openDropdown.previousElementSibling?.classList.remove('active'); // closes moreBtn
      }
    });

    const isActive = dropdown.classList.toggle('active');
    moreBtn.classList.toggle('active', isActive);
  });

  // Close dropdown on click outside
  document.addEventListener('click', () => {
    if (dropdown.classList.contains('active')) {
      dropdown.classList.remove('active');
      moreBtn.classList.remove('active');
    }
  });

  card.append(cover, playSmall, title, artist, moreBtn, dropdown);
  card.addEventListener('click', () => {
    // Only play if options dropdown is not active
    if (!dropdown.classList.contains('active')) {
      playSong(index);
    }
  });
  return card;
}

function playSong(index) {
  if (index < 0 || index >= library.length) return;
  const song = library[index];
  if (!song || !song.musicFile) return;
  currentSongIndex = index;
  audioPlayer.src = '/api/music/' + song.musicFile;
  audioPlayer.play().catch(err => console.warn('Play error:', err));
  updatePlayerUI(song);
  showPlayer();
}

function showPlayer() { playerBar?.classList.remove('hidden'); }
function hidePlayer() {
  playerBar?.classList.add('hidden');
  audioPlayer?.pause();
}

function updatePlayerUI(song) {
  if (!song) return;
  if (playerCover) {
    if (song.coverFile) {
      playerCover.style.background = `url('/api/covers/${song.coverFile}') center/cover no-repeat`;
    } else {
      playerCover.style.background = 'linear-gradient(135deg,#ff6b6b,#feca57)';
    }
  }
  if (playerTitle)  playerTitle.textContent  = song.title  || 'Bilinmeyen';
  if (playerArtist) playerArtist.textContent = song.artist || '-';
}

function togglePlay() {
  if (!audioPlayer) return;
  // FIX: check src properly (empty string is falsy)
  if (!audioPlayer.src || audioPlayer.src === window.location.href) {
    if (library.length > 0) playSong(0);
    return;
  }
  audioPlayer.paused ? audioPlayer.play().catch(console.warn) : audioPlayer.pause();
}

function updateProgress() {
  if (!audioPlayer?.duration) return;
  const pct = (audioPlayer.currentTime / audioPlayer.duration) * 100;
  if (progressFill) progressFill.style.width = `${pct}%`;
  if (currentTimeEl) currentTimeEl.textContent = fmt(audioPlayer.currentTime);
}

function updateDuration() {
  if (totalTimeEl) totalTimeEl.textContent = fmt(audioPlayer?.duration);
}

function seekTo(e) {
  if (!progressBar || !audioPlayer?.duration) return;
  const r = progressBar.getBoundingClientRect();
  const pct = Math.max(0, Math.min(1, (e.clientX - r.left) / r.width));
  audioPlayer.currentTime = pct * audioPlayer.duration;
}

function setVolume(e) {
  if (!volumeBar || !audioPlayer) return;
  const r = volumeBar.getBoundingClientRect();
  const v = Math.max(0, Math.min(1, (e.clientX - r.left) / r.width));
  audioPlayer.volume = v;
  if (volumeFill) volumeFill.style.width = `${v * 100}%`;
}

function fmt(s) {
  if (!isFinite(s) || s < 0) return '0:00';
  return `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
}

function playNext() {
  if (library.length === 0) return;
  playSong((currentSongIndex + 1) % library.length);
}

function playPrev() {
  if (library.length === 0) return;
  if (audioPlayer?.currentTime > 3) {
    audioPlayer.currentTime = 0;
    return;
  }
  playSong(currentSongIndex === 0 ? library.length - 1 : currentSongIndex - 1);
}

/* ═══════════════════════ LIBRARY SEARCH ═══════════════════════ */
function initLibrarySearch() {
  if (!searchInput) return;

  searchInput.addEventListener('input', () => {
    const q = searchInput.value;
    if (libClearBtn) libClearBtn.style.display = q ? 'flex' : 'none';
    clearTimeout(libSearchTimer);
    libSearchTimer = setTimeout(() => filterLibrary(q.toLowerCase().trim()), 80);
  });

  libClearBtn?.addEventListener('click', () => {
    searchInput.value = '';
    if (libClearBtn) libClearBtn.style.display = 'none';
    filterLibrary('');
    searchInput.focus();
  });
}

function filterLibrary(query) {
  if (!libraryGrid) return;
  const cards = libraryGrid.querySelectorAll('.song-card');
  let anyVisible = false;

  cards.forEach((card, i) => {
    const song = library[i];
    const match = !query || (song && (
      (song.title  || '').toLowerCase().includes(query) ||
      (song.artist || '').toLowerCase().includes(query)
    ));
    card.style.display = match ? '' : 'none';
    if (match) anyVisible = true;
  });

  // No results message
  let noRes = libraryGrid.querySelector('.no-result');
  if (query && !anyVisible) {
    if (!noRes) {
      noRes = document.createElement('p');
      noRes.className = 'no-result';
      noRes.style.cssText = 'color:var(--text-secondary);grid-column:1/-1;text-align:center;padding:40px 0;font-size:14px;';
      libraryGrid.appendChild(noRes);
    }
    noRes.textContent = `"${query}" için sonuç bulunamadı.`;
  } else {
    noRes?.remove();
  }
}

/* ═══════════════════════ DOWNLOAD SEARCH ═══════════════════════ */
function isYTUrl(text) {
  return /(?:youtube\.com\/(?:[^/]+\/.+\/|(?:v|e(?:mbed)?)\/|.*[?&]v=)|youtu\.be\/)([^"&?/\s]{11})/.test(text);
}

function initUnifiedInput() {
  if (!unifiedInput) return;

  unifiedInput.addEventListener('input', () => {
    if (clearInputBtn) clearInputBtn.style.display = unifiedInput.value ? 'flex' : 'none';
  });

  clearInputBtn?.addEventListener('click', () => {
    unifiedInput.value = '';
    if (clearInputBtn) clearInputBtn.style.display = 'none';
    if (songPreviewEl)   songPreviewEl.style.display   = 'none';
    if (searchResultsEl) searchResultsEl.style.display = 'none';
    previewData = null;
    unifiedInput.focus();
  });

  unifiedBtn?.addEventListener('click', handleSearch);
  unifiedInput.addEventListener('keydown', e => {
    if (e.key === 'Enter') handleSearch();
  });
}

async function handleSearch() {
  const val = unifiedInput?.value.trim();
  if (!val) return;

  if (songPreviewEl)   songPreviewEl.style.display   = 'none';
  if (searchResultsEl) searchResultsEl.style.display = 'none';
  previewData = null;

  if (isYTUrl(val)) {
    showLoading('Şarkı bilgileri alınıyor...');
    try {
      const res = await fetch('/api/song-info?url=' + encodeURIComponent(val));
      if (!res.ok) throw new Error(await res.text());
      previewData = await res.json();
      hideLoading();
      showPreview();
    } catch (err) {
      console.error('Song info error:', err);
      hideLoading();
      toast('❌ Şarkı bilgisi alınamadı.', true);
    }
  } else {
    showLoading("YouTube'da aranıyor...");
    try {
      const res = await fetch(`/api/search?q=${encodeURIComponent(val)}`);
      if (!res.ok) throw new Error(await res.text());
      const results = await res.json();
      hideLoading();
      renderResults(results);
    } catch (err) {
      console.error('Search error:', err);
      hideLoading();
      toast('❌ Arama başarısız oldu!', true);
    }
  }
}

function showPreview() {
  if (!previewData || !songPreviewEl) return;
  if (previewCoverEl) previewCoverEl.style.backgroundImage = `url('${previewData.coverUrl}')`;
  if (previewTitleEl)  previewTitleEl.textContent  = previewData.title  || 'Bilinmeyen';
  if (previewArtistEl) previewArtistEl.textContent = previewData.artist || '-';
  if (previewDurEl)    previewDurEl.textContent    = previewData.duration ? fmt(previewData.duration) : '--:--';
  songPreviewEl.style.display = 'flex';
  if (searchResultsEl) searchResultsEl.style.display = 'none';
}

function renderResults(results) {
  if (!resultsGridEl || !searchResultsEl) return;
  resultsGridEl.innerHTML = '';

  if (!results || results.length === 0) {
    resultsGridEl.innerHTML = '<p style="color:var(--text-secondary);text-align:center;padding:40px 0;grid-column:1/-1;font-size:14px;">Sonuç bulunamadı.</p>';
  } else {
    results.forEach(v => resultsGridEl.appendChild(createResultCard(v)));
  }
  searchResultsEl.style.display = 'block';
}

function createResultCard(video) {
  const card = document.createElement('div');
  card.className = 'result-card';

  const cover = document.createElement('div');
  cover.className = 'result-cover';
  if (video.coverUrl) cover.style.backgroundImage = `url(${video.coverUrl})`;

  const overlay = document.createElement('div');
  overlay.className = 'result-play-overlay';
  overlay.innerHTML = '<svg fill="white" viewBox="0 0 24 24"><path d="M8 5v14l11-7z"/></svg>';
  cover.appendChild(overlay);

  const info = document.createElement('div');
  info.className = 'result-info';

  const title = document.createElement('h4');
  title.className = 'result-title';
  title.textContent = video.title || 'Bilinmeyen';
  title.title = video.title || '';

  const artist = document.createElement('p');
  artist.className = 'result-artist';
  artist.textContent = video.artist || '-';

  info.append(title, artist);
  card.append(cover, info);
  card.addEventListener('click', () => selectResult(video));
  return card;
}

function selectResult(video) {
  previewData = { ...video };
  showPreview();
  songPreviewEl?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

/* ═══════════════════════ DOWNLOAD ═══════════════════════ */
function initDownload() {
  if (!downloadBtn) return;

  downloadBtn.addEventListener('click', async () => {
    if (!previewData?.url) {
      toast('❌ Önce bir şarkı seçin!', true);
      return;
    }

    downloadBtn.disabled = true;
    downloadBtn.innerHTML = '<svg fill="currentColor" viewBox="0 0 24 24" width="18" height="18"><path d="M12 4V1L8 5l4 4V6c3.31 0 6 2.69 6 6 0 1.01-.25 1.97-.7 2.8l1.46 1.46C19.54 14.03 20 12.57 20 11c0-4.42-3.58-8-8-8zm0 14c-3.31 0-6-2.69-6-6 0-1.01.25-1.97.7-2.8L5.24 7.74C4.46 8.97 4 10.43 4 12c0 4.42 3.58 8 8 8v3l4-4-4-4v3z"/></svg><span>İndiriliyor...</span>';

    showLoading('Şarkı indiriliyor... Lütfen bekleyin.');
    if (songPreviewEl) songPreviewEl.style.display = 'none';

    try {
      const res = await fetch('/api/download', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: previewData.url })
      });

      if (!res.ok) {
        const errData = await res.json().catch(() => ({ error: 'Sunucu hatası' }));
        throw new Error(errData.error || 'İndirme başarısız');
      }

      await loadLibrary();
      resetDownload();
      navigateTo('library');
      toast('✅ Şarkı başarıyla indirildi!');
    } catch (err) {
      console.error('Download error:', err);
      toast('❌ İndirme başarısız: ' + err.message, true);
      hideLoading();
      if (previewData) showPreview();
    } finally {
      downloadBtn.disabled = false;
      downloadBtn.innerHTML = '<svg fill="currentColor" viewBox="0 0 24 24"><path d="M19 9h-4V3H9v6H5l7 7 7-7zM5 18v2h14v-2H5z"/></svg><span>İndir</span>';
    }
  });
}

function resetDownload() {
  if (songPreviewEl)   songPreviewEl.style.display   = 'none';
  if (searchResultsEl) searchResultsEl.style.display = 'none';
  hideLoading();
  if (unifiedInput)   unifiedInput.value = '';
  if (clearInputBtn)  clearInputBtn.style.display = 'none';
  previewData = null;
}

/* ═══════════════════════ DELETE ═══════════════════════ */
async function deleteSong(id) {
  if (!id) return;
  if (!confirm('Bu şarkıyı silmek istediğinize emin misiniz?')) return;
  try {
    const res = await fetch('/api/song/' + id, { method: 'DELETE' });
    if (res.ok) {
      await loadLibrary();
      toast('🗑️ Şarkı silindi.');
    } else {
      toast('❌ Şarkı silinemedi!', true);
    }
  } catch (err) {
    console.error('Delete error:', err);
    toast('❌ Bağlantı hatası!', true);
  }
}

/* ═══════════════════════ HELPERS ═══════════════════════ */
function showLoading(text = 'İşlem yapılıyor...') {
  if (loadingTextEl)  loadingTextEl.textContent       = text;
  if (loadingStateEl) loadingStateEl.style.display    = 'flex';
  if (songPreviewEl)  songPreviewEl.style.display     = 'none';
  if (searchResultsEl) searchResultsEl.style.display  = 'none';
}

function hideLoading() {
  if (loadingStateEl) loadingStateEl.style.display = 'none';
}

function toast(msg, isError = false) {
  // Remove any existing toast
  document.querySelectorAll('.toast-notification').forEach(t => t.remove());

  const el = document.createElement('div');
  el.className = 'toast-notification';
  el.textContent = msg;

  Object.assign(el.style, {
    position:     'fixed',
    bottom:       '100px',
    left:         '50%',
    transform:    'translateX(-50%) translateY(16px)',
    background:   isError ? '#c0392b' : '#1DB954',
    color:        '#fff',
    padding:      '12px 24px',
    borderRadius: '100px',
    fontSize:     '13px',
    fontWeight:   '700',
    fontFamily:   "'Inter', sans-serif",
    zIndex:       '9999',
    boxShadow:    '0 8px 28px rgba(0,0,0,.55)',
    opacity:      '0',
    transition:   'opacity 0.25s ease, transform 0.25s ease',
    whiteSpace:   'nowrap',
    maxWidth:     '88vw',
    overflow:     'hidden',
    textOverflow: 'ellipsis',
    pointerEvents:'none',
  });

  document.body.appendChild(el);

  // Animate in
  requestAnimationFrame(() => {
    el.style.opacity   = '1';
    el.style.transform = 'translateX(-50%) translateY(0)';
  });

  // Animate out
  setTimeout(() => {
    el.style.opacity   = '0';
    el.style.transform = 'translateX(-50%) translateY(10px)';
    setTimeout(() => el.remove(), 300);
  }, 3000);
}
