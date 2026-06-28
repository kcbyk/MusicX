const express = require('express');
const path = require('path');
const fs = require('fs-extra');
const axios = require('axios');
const cors = require('cors');
const { spawn } = require('child_process');
const ytdlSearch = require('yt-dlp-exec');        // search only (works fine)
const ytdlCore  = require('@distube/ytdl-core');  // download (no binary, InnerTube API)
const ffmpegPath = require('@ffmpeg-installer/ffmpeg').path;

process.env.PATH = path.dirname(ffmpegPath) + path.delimiter + process.env.PATH;

// Helper: stream YouTube audio → pipe through ffmpeg → save as MP3
function downloadAsMp3(videoUrl, outputPath) {
  return new Promise((resolve, reject) => {
    const audioStream = ytdlCore(videoUrl, {
      filter: 'audioonly',
      quality: 'highestaudio',
      requestOptions: {
        headers: {
          'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1',
          'Accept-Language': 'tr-TR,tr;q=0.9,en-US;q=0.8,en;q=0.7'
        }
      }
    });

    const ffmpegProc = spawn(ffmpegPath, [
      '-i', 'pipe:0',
      '-vn',
      '-acodec', 'libmp3lame',
      '-ab', '128k',
      '-ar', '44100',
      '-y',
      outputPath
    ]);

    audioStream.pipe(ffmpegProc.stdin);

    let ffmpegStderr = '';
    ffmpegProc.stderr.on('data', d => { ffmpegStderr += d.toString(); });

    audioStream.on('error', err => {
      ffmpegProc.kill();
      reject(err);
    });

    ffmpegProc.on('close', code => {
      if (code === 0) resolve();
      else reject(new Error('ffmpeg error (code ' + code + '): ' + ffmpegStderr.slice(-300)));
    });

    ffmpegProc.on('error', reject);
  });
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

// ===== SEARCH API =====
app.get('/api/search', async (req, res) => {
  try {
    const { q } = req.query;
    if (!q || !q.trim()) {
      return res.status(400).json({ error: 'Arama sorgusu gerekli' });
    }

    const cacheKey = q.toLowerCase().trim();
    const cached = getCached(cacheKey);
    if (cached) {
      console.log('Cache hit:', q);
      return res.json(cached);
    }

    console.log('Arama yapılıyor:', q);

    // Search uses yt-dlp-exec (works fine on Render)
    const searchResult = await ytdlSearch(`ytsearch8:${q.replace(/"/g, '')}`, {
      dumpSingleJson: true,
      noWarnings: true,
      flatPlaylist: true,
      extractorArgs: 'youtube:player_client=ios,android'
    });

    const results = [];
    const entries = searchResult.entries || [];

    for (const entry of entries) {
      const id = entry.id;
      if (!id || id.length !== 11) continue;

      results.push({
        id,
        title:    entry.title    || 'Bilinmeyen Başlık',
        artist:   entry.channel  || entry.uploader || 'Bilinmeyen Sanatçı',
        duration: entry.duration || 0,
        coverUrl: `https://i.ytimg.com/vi/${id}/mqdefault.jpg`,
        url:      entry.url || `https://www.youtube.com/watch?v=${id}`
      });
    }

    console.log(`Bulunan sonuç sayısı: ${results.length}`);

    if (results.length > 0) {
      setCache(cacheKey, results);
    }

    res.json(results);
  } catch (error) {
    console.error('Arama hatası:', error.message);
    res.status(500).json({ error: 'Arama başarısız: ' + error.message });
  }
});

// ===== SONG INFO API =====
app.get('/api/song-info', async (req, res) => {
  try {
    const { url } = req.query;
    if (!url) {
      return res.status(400).json({ error: 'Geçerli bir YouTube URL\'si girin.' });
    }

    const videoId = getVideoId(url);
    if (!videoId) {
      return res.status(400).json({ error: 'Geçerli bir YouTube URL\'si girin.' });
    }

    const cacheKey = 'info_' + videoId;
    const cached = getCached(cacheKey);
    if (cached) return res.json(cached);

    console.log('Bilgi alınıyor:', url);

    const oembedRes = await axios.get(
      `https://www.youtube.com/oembed?url=${encodeURIComponent(url)}&format=json`,
      { timeout: 8000 }
    );

    const result = {
      id: videoId,
      title: oembedRes.data.title,
      artist: oembedRes.data.author_name,
      duration: 0,
      coverUrl: `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`,
      url: url
    };
    
    setCache(cacheKey, result);
    res.json(result);
  } catch (error) {
    console.error('Şarkı bilgisi hatası:', error.message);
    res.status(500).json({ error: 'Şarkı bilgileri alınamadı: ' + error.message });
  }
});

// ===== DOWNLOAD API =====
app.post('/api/download', async (req, res) => {
  try {
    const { url } = req.body;
    if (!url) {
      return res.status(400).json({ error: 'Geçerli bir YouTube URL\'si girin.' });
    }

    const videoId = getVideoId(url);
    if (!videoId) {
      return res.status(400).json({ error: 'Geçerli bir YouTube URL\'si girin.' });
    }

    const musicFileName = `${videoId}.mp3`;
    const coverFileName = `${videoId}.jpg`;
    const musicPath = path.join(MUSIC_DIR, musicFileName);
    const coverPath = path.join(COVERS_DIR, coverFileName);

    // Zaten var mı?
    const existingSongs = await fs.readJson(DB_FILE);
    const existingSong = existingSongs.find(s => s.id === videoId);
    if (existingSong && await fs.pathExists(musicPath)) {
      console.log('Şarkı zaten mevcut:', existingSong.title);
      return res.json(existingSong);
    }

    const coverUrl = `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`;

    const [coverResult, infoResult] = await Promise.allSettled([
      new Promise((resolve, reject) => {
        axios({
          url: coverUrl,
          responseType: 'stream',
          timeout: 8000
        }).then(coverResponse => {
          const writeStream = fs.createWriteStream(coverPath);
          coverResponse.data.pipe(writeStream);
          writeStream.on('finish', () => resolve(true));
          writeStream.on('error', err => {
            coverResponse.data.destroy();
            reject(err);
          });
        }).catch(reject);
      }),
      axios.get(
        `https://www.youtube.com/oembed?url=${encodeURIComponent(url)}&format=json`,
        { timeout: 8000 }
      )
    ]);

    const coverDownloaded = coverResult.status === 'fulfilled';
    let title = videoId;
    let artist = 'Unknown';
    
    if (infoResult.status === 'fulfilled') {
      title = infoResult.value.data.title || videoId;
      artist = infoResult.value.data.author_name || 'Unknown';
    }

    console.log('Şarkı indiriliyor:', title);

    // Download with @distube/ytdl-core (InnerTube API, no binary, no bot block)
    await downloadAsMp3(url, musicPath);

    const newSong = {
      id: videoId,
      title,
      artist,
      duration: 0,
      musicFile: musicFileName,
      coverFile: coverDownloaded ? coverFileName : null,
      addedAt: new Date().toISOString()
    };

    // Save to ephemeral memory database
    const songs = await fs.readJson(DB_FILE);
    songs.unshift(newSong);
    await fs.writeJson(DB_FILE, songs);

    console.log('Şarkı başarıyla indirildi:', title);
    res.json(newSong);
  } catch (error) {
    console.error('İndirme hatası:', error.message);
    res.status(500).json({ error: 'İndirme başarısız oldu: ' + error.message });
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
