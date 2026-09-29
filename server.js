const express = require('express');
const path = require('path');
const fs = require('fs-extra');
const axios = require('axios');
const cors = require('cors');
const { spawn } = require('child_process');
const ytdlSearch = require('yt-dlp-exec'); // search (works fine)
const ytdlExec   = require('yt-dlp-exec'); // download with cookies
const ffmpegPath = require('@ffmpeg-installer/ffmpeg').path;
const os = require('os');

process.env.PATH = path.dirname(ffmpegPath) + path.delimiter + process.env.PATH;

// Download YouTube audio to MP3 using yt-dlp (emulating Android player client, no cookies needed)
async function downloadAsMp3(videoUrl, outputPath) {
  const options = {
    extractAudio: true,
    audioFormat: 'mp3',
    audioQuality: '5',
    format: 'bestaudio/best',
    noPlaylist: true,
    noPart: true,
    ffmpegLocation: path.dirname(ffmpegPath),
    output: outputPath,
    extractorArgs: 'youtube:player_client=android', // Simulates Android app player (no bot block / no cookies needed)
    jsRuntimes: 'node'                            // Uses local Node.js for signature decryption
  };

  await ytdlExec(videoUrl, options);
}

const app = express();
const PORT = process.env.PORT || 8000;

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

const LIBRARY_DIR = path.join(__dirname, 'library');
const MUSIC_DIR = path.join(LIBRARY_DIR, 'music');
const COVERS_DIR = path.join(LIBRARY_DIR, 'covers');
const DB_FILE = path.join(LIBRARY_DIR, 'songs.json');

// ===== In-memory search cache (5 min TTL) =====
const searchCache = new Map();
const CACHE_TTL = 5 * 60 * 1000; // 5 minutes

function getCached(key) {
  const entry = searchCache.get(key);
  if (!entry) return null;
  if (Date.now() - entry.time > CACHE_TTL) {
    searchCache.delete(key);
    return null;
  }
  return entry.data;
}

function setCache(key, data) {
  if (searchCache.size > 50) {
    const firstKey = searchCache.keys().next().value;
    searchCache.delete(firstKey);
  }
  searchCache.set(key, { data, time: Date.now() });
}

// Automatic cleanup for ephemeral Render storage (runs every 5 mins, deletes files older than 10 mins)
async function cleanOldFiles() {
  try {
    const now = Date.now();
    const cleanDir = async (dir) => {
      if (!await fs.pathExists(dir)) return;
      const files = await fs.readdir(dir);
      for (const file of files) {
        const filePath = path.join(dir, file);
        const stat = await fs.stat(filePath);
        if (now - stat.mtimeMs > 10 * 60 * 1000) { // 10 minutes
          await fs.remove(filePath);
          console.log('Cleaned up file:', file);
        }
      }
    };
    await cleanDir(MUSIC_DIR);
    await cleanDir(COVERS_DIR);
  } catch (err) {
    console.error('Cleanup error:', err.message);
  }
}
setInterval(cleanOldFiles, 5 * 60 * 1000); // Check every 5 minutes

async function init() {
  await fs.ensureDir(MUSIC_DIR);
  await fs.ensureDir(COVERS_DIR);
  if (!await fs.pathExists(DB_FILE)) {
    await fs.writeJson(DB_FILE, []);
  }

  // Grant execution permissions to yt-dlp and ffmpeg binaries on Linux (Render)
  try {
    if (process.platform !== 'win32') {
      const ytdlpBinPath = path.join(__dirname, 'node_modules', 'yt-dlp-exec', 'bin', 'yt-dlp');
      if (await fs.pathExists(ytdlpBinPath)) {
        await fs.chmod(ytdlpBinPath, '755');
        console.log('Granted 755 permissions to yt-dlp binary.');
      }
      const ffmpegBinPath = require('@ffmpeg-installer/ffmpeg').path;
      if (await fs.pathExists(ffmpegBinPath)) {
        await fs.chmod(ffmpegBinPath, '755');
        console.log('Granted 755 permissions to ffmpeg binary.');
      }
    }
  } catch (err) {
    console.warn('Could not set permissions on binaries:', err.message);
  }
}

// Extract Video ID
function getVideoId(url) {
  const regExp = /^.*(youtu.be\/|v\/|u\/\w\/|embed\/|watch\?v=|&v=)([^#&?]*).*/;
  const match = url.match(regExp);
  return match && match[2].length === 11 ? match[2] : null;
}

// ===== Song API integration =====
const MUSIC_API_URL = (process.env.MUSIC_API_URL || 'https://mp3-apisi.onrender.com').replace(/\/$/, '');
const MUSIC_API_KEY = process.env.MUSIC_API_KEY;
if (!MUSIC_API_KEY) console.warn('⚠️ MUSIC_API_KEY tanımlı değil. .env/hosting secret olarak ekleyin.');

function apiParams(extra = {}) {
  return new URLSearchParams({ ...extra, key: MUSIC_API_KEY || '' });
}

async function musicApi(pathname, params = {}, options = {}) {
  const url = `${MUSIC_API_URL}${pathname}?${apiParams(params)}`;
  const response = await axios({ url, timeout: options.timeout || 30000, ...options });
  return response.data;
}

function youtubeCover(url) {
  const match = String(url || '').match(/(?:v=|youtu\.be\/|youtube\.com\/(?:shorts\/|embed\/))([A-Za-z0-9_-]{11})/);
  return match ? `https://i.ytimg.com/vi/${match[1]}/hqdefault.jpg` : null;
}

// Search is delegated to the personal Song API (YouTube/SoundCloud/Archive/TikTok).
app.get('/api/search', async (req, res) => {
  try {
    const q = String(req.query.q || '').trim();
    if (!q) return res.status(400).json({ error: 'Arama sorgusu gerekli' });
    const data = await musicApi('/api/v1/search', { q, limit: 20 });
    const results = (data.sonuclar || []).map((item, index) => ({
      id: String(item.id ?? `${item.kaynak}-${index}`),
      title: item.baslik || 'Bilinmeyen Başlık',
      artist: item.kanal || item.sanatci || item.kaynak || 'Bilinmeyen Sanatçı',
      duration: Number(item.sure || 0),
      coverUrl: item.kapak || item.kapak_url || youtubeCover(item.url) || '',
      url: item.url
    }));
    res.json(results);
  } catch (error) {
    console.error('Music API arama hatası:', error.response?.data || error.message);
    res.status(error.response?.status || 502).json({ error: 'Müzik API araması başarısız' });
  }
});

// Convert selected URL through the external API, then save the returned file locally.
app.post('/api/download', async (req, res) => {
  try {
    const { url, title: requestedTitle, artist: requestedArtist } = req.body || {};
    if (!url && !requestedTitle) return res.status(400).json({ error: 'Geçerli bir müzik URL\'si veya başlık gerekli.' });

    const safeBase = String(requestedTitle || 'music').replace(/[^\w\-ğüşöçıİĞÜŞÖÇ ]/gi, '').trim().slice(0, 80) || 'music';
    const id = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const musicFileName = `${id}.mp3`;
    const musicPath = path.join(MUSIC_DIR, musicFileName);
    const searchQuery = `${requestedArtist || ''} ${requestedTitle || ''}`.trim();

    // 1. Önce HIZLI direkt CDN link çözümlemeyi dene (~0.2 - 0.8 sn)
    let audioStreamUrl = null;
    try {
      const linkData = await musicApi('/api/v1/link', {
        q: searchQuery || undefined,
        url: url || undefined,
        hizli: 1,
        format: 'mp3',
        kalite: '320'
      }, { timeout: 8000 });
      if (linkData && linkData.link) {
        audioStreamUrl = linkData.link;
      }
    } catch (fastErr) {
      console.warn('Hızlı link çözümü olamadı, kuyruklu convert yöntemine geçiliyor:', fastErr.message);
    }

    // 2. Hızlı link bulunamadıysa -> Convert API ile dene
    if (!audioStreamUrl) {
      const started = await musicApi('/api/v1/convert', {}, {
        method: 'POST',
        data: { url: url || searchQuery, baslik: requestedTitle || '', kaynak: 'music-api' },
        headers: { 'Content-Type': 'application/json' },
        timeout: 30000
      });
      if (!started.job_id) throw new Error('API job_id döndürmedi');

      let status;
      for (let i = 0; i < 45; i++) {
        await new Promise(resolve => setTimeout(resolve, 800));
        status = await musicApi(`/api/v1/status/${encodeURIComponent(started.job_id)}`);
        if (status.durum === 'bitti' || status.durum === 'hata') break;
      }
      if (!status || status.durum !== 'bitti' || !status.dosya_url) {
        return res.status(504).json({ error: status?.mesaj || 'İndirme zaman aşımına uğradı' });
      }

      const fileUrl = new URL(status.dosya_url, MUSIC_API_URL).toString();
      audioStreamUrl = `${fileUrl}${fileUrl.includes('?') ? '&' : '?'}key=${encodeURIComponent(MUSIC_API_KEY || '')}`;
    }

    // 3. SES VE KAPAK İNDİRMESİNİ PARALEL (Promise.all) BAŞLAT (Maksimum Hız)
    let coverFile = null;
    let coverUrl = youtubeCover(url);

    const downloadAudioPromise = async () => {
      const audio = await axios.get(audioStreamUrl, { responseType: 'stream', timeout: 45000 });
      await new Promise((resolve, reject) => {
        const out = fs.createWriteStream(musicPath);
        audio.data.pipe(out);
        out.on('finish', resolve);
        out.on('error', reject);
      });
    };

    const downloadCoverPromise = async () => {
      try {
        if (!coverUrl && searchQuery) {
          const kapakData = await musicApi('/api/v1/kapak', { q: searchQuery }).catch(() => null);
          if (kapakData && kapakData.kapak_url) coverUrl = kapakData.kapak_url;
        }
        if (coverUrl) {
          coverFile = `${id}.jpg`;
          const coverResponse = await axios.get(coverUrl, { responseType: 'stream', timeout: 10000 });
          const coverOut = fs.createWriteStream(path.join(COVERS_DIR, coverFile));
          await new Promise((resolve, reject) => {
            coverResponse.data.pipe(coverOut);
            coverOut.on('finish', resolve);
            coverOut.on('error', reject);
          });
        }
      } catch (coverError) {
        console.warn('Kapak indirilemedi:', coverError.message);
        coverFile = null;
      }
    };

    // İkisini aynı anda indir:
    await Promise.all([downloadAudioPromise(), downloadCoverPromise()]);

    const song = { id, title: safeBase, artist: requestedArtist || 'Music API', duration: 0, musicFile: musicFileName, coverFile, addedAt: new Date().toISOString() };
    const songs = await fs.readJson(DB_FILE); songs.unshift(song); await fs.writeJson(DB_FILE, songs);
    res.json(song);
  } catch (error) {
    console.error('Music API indirme hatası:', error.response?.data || error.message);
    res.status(error.response?.status || 502).json({ error: 'İndirme başarısız oldu' });
  }
});

// ===== LIBRARY API =====
app.get('/api/library', async (req, res) => {
  try {
    const songs = await fs.readJson(DB_FILE);
    res.json(songs);
  } catch (error) {
    res.status(500).json({ error: 'Kütüphane yüklenemedi' });
  }
});

// ===== FILE SERVING =====
app.get('/api/music/:filename', (req, res) => {
  const filePath = path.join(MUSIC_DIR, req.params.filename);
  res.setHeader('Cache-Control', 'public, max-age=86400');
  res.setHeader('Accept-Ranges', 'bytes');
  res.sendFile(filePath, (err) => {
    if (err && !res.headersSent) {
      res.status(404).json({ error: 'Dosya bulunamadı' });
    }
  });
});

app.get('/api/covers/:filename', (req, res) => {
  const filePath = path.join(COVERS_DIR, req.params.filename);
  res.setHeader('Cache-Control', 'public, max-age=86400');
  res.sendFile(filePath, (err) => {
    if (err && !res.headersSent) {
      res.status(404).json({ error: 'Kapak bulunamadı' });
    }
  });
});

// ===== DELETE SONG =====
app.delete('/api/song/:id', async (req, res) => {
  try {
    const songId = req.params.id;
    let songs = await fs.readJson(DB_FILE);
    const songIndex = songs.findIndex(s => s.id === songId);
    if (songIndex === -1) return res.status(404).json({ error: 'Şarkı bulunamadı' });
    const song = songs[songIndex];
    try {
      await fs.remove(path.join(MUSIC_DIR, song.musicFile));
      if (song.coverFile) await fs.remove(path.join(COVERS_DIR, song.coverFile));
    } catch (e) {}
    songs.splice(songIndex, 1);
    await fs.writeJson(DB_FILE, songs);
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: 'Şarkı silinemedi' });
  }
});

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

init().then(() => {
  app.listen(PORT, '0.0.0.0', () => {
    console.log('🎵 MusicX running at http://localhost:' + PORT);
  });
});
