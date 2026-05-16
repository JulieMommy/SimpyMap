require('dotenv').config();
const express = require('express');
const fs = require('fs');
const path = require('path');
const sqlite3 = require('sqlite3').verbose();
const countries = require('i18n-iso-countries');

const app = express();
const PORT = process.env.PORT || 3000;

const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: {
    rejectUnauthorized: false
  }
});

app.listen(PORT, "0.0.0.0", () => {
  console.log("Serveur lancé");
});

// Middleware
app.use(express.json());

// API routes that must run before static (so POST /api/unlock-drone is never 404)
const DRONE_EXTERNAL_BASE = 'https://juliemommy.pythonanywhere.com';
const EXTERNAL_UNLOCK_SKIN_ID = 'Drone';
// Skins affichés comme payants (verrouillés avec "5 €" sauf Drone qui a son propre flux)
const PAID_SKINS = ['Drone', 'blacked', 'Spiral'];

// DB SQLite
const db = new sqlite3.Database(path.join(__dirname, 'data.db'));

app.get('/api/drone-url', (req, res) => {
  res.json({ url: `${DRONE_EXTERNAL_BASE}/update` });
});
app.post('/api/unlock-drone', (req, res) => {
  const userId = (req.body && req.body.userId || '').toString().trim();
  if (!userId) return res.status(400).json({ error: 'userId required' });
  db.run('INSERT OR IGNORE INTO external_unlocks (userId, skinId, unlockedAt) VALUES (?, ?, datetime("now"))', [userId, EXTERNAL_UNLOCK_SKIN_ID], (err) => {
    if (err) return res.status(500).json({ error: 'DB error' });
    res.json({ ok: true });
  });
});

app.use(express.static(path.join(__dirname, 'public')));

db.serialize(() => {
  db.run(`
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      lat REAL,
      lng REAL,
      username TEXT,
      visits INTEGER DEFAULT 0,
      country TEXT,
      createdAt TEXT,
      updatedAt TEXT
    )
  `);

  // Try to add columns if the table already existed (ignore errors if they already exist)
  db.run('ALTER TABLE users ADD COLUMN username TEXT', (err) => {
    if (err && !String(err.message).includes('duplicate column')) {
      console.warn('ALTER TABLE users (username) failed (might already exist):', err.message);
    }
  });
  db.run('ALTER TABLE users ADD COLUMN visits INTEGER DEFAULT 0', (err) => {
    if (err && !String(err.message).includes('duplicate column')) {
      console.warn('ALTER TABLE users (visits) failed (might already exist):', err.message);
    }
  });
  db.run('ALTER TABLE users ADD COLUMN country TEXT', (err) => {
    if (err && !String(err.message).includes('duplicate column')) {
      console.warn('ALTER TABLE users (country) failed (might already exist):', err.message);
    }
  });
  db.run('ALTER TABLE users ADD COLUMN city TEXT', (err) => {
    if (err && !String(err.message).includes('duplicate column')) {
      console.warn('ALTER TABLE users (city) failed (might already exist):', err.message);
    }
  });
  db.run('ALTER TABLE users ADD COLUMN skin TEXT', (err) => {
    if (err && !String(err.message).includes('duplicate column')) {
      console.warn('ALTER TABLE users (skin) failed (might already exist):', err.message);
    }
  });
  db.run('ALTER TABLE users ADD COLUMN lastVisitDate TEXT', (err) => {
    if (err && !String(err.message).includes('duplicate column')) {
      console.warn('ALTER TABLE users (lastVisitDate) failed (might already exist):', err.message);
    }
  });

  db.run(`
    CREATE TABLE IF NOT EXISTS external_unlocks (
      userId TEXT NOT NULL,
      skinId TEXT NOT NULL,
      unlockedAt TEXT,
      PRIMARY KEY (userId, skinId)
    )
  `);

  // Nettoyer toute donnée de test / seed restante dans une ancienne base
  db.run(`
    DELETE FROM users WHERE
      id = 'fake-paris' OR id = 'julie' OR id LIKE 'test%'
      OR username IN ('Paris visitor', 'Test2', 'Test3')
      OR username GLOB 'Test [0-9]*'
  `);
});

// Fixed image skins: read from public/skins folder (any .png, .jpg, .jpeg, .gif, .webp)
// Add images in public/skins/ and they appear automatically in the skin panel.
// Preferred skins (explicit id/name). Use fileBaseName when the image filename differs from the skin id (e.g. SpiralEye.png → skin "Spiral").
const PREFERRED_IMAGE_SKINS = [
  { id: 'Drone', name: 'Drone' },
  { id: 'Spiral', name: 'Spiral', fileBaseName: 'SpiralEye' }
];

const SKINS_DIR = path.join(__dirname, 'public', 'skins');
const IMAGE_EXT = /\.(png|jpe?g|gif|webp)$/i;

function getFixedImageSkins() {
  try {
    if (!fs.existsSync(SKINS_DIR)) return [];
    const files = fs.readdirSync(SKINS_DIR).filter((f) => IMAGE_EXT.test(f));
    const used = new Set();
    const result = [];
    for (const prefs of PREFERRED_IMAGE_SKINS) {
      const { id, name, fileBaseName } = Object.assign({ fileBaseName: null }, prefs);
      const matchName = (fileBaseName || id).toLowerCase();
      const found = files.find((f) => path.basename(f, path.extname(f)).toLowerCase() === matchName);
      if (found) {
        result.push({ id, name, imageUrl: `/skins/${found}` });
        used.add(found);
      }
    }
    files.forEach((filename) => {
      if (used.has(filename)) return;
      const base = path.basename(filename, path.extname(filename));
      const name = base.replace(/[-_]+/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
      result.push({ id: base, name, imageUrl: `/skins/${filename}` });
    });
    return result;
  } catch (e) {
    console.warn('getFixedImageSkins:', e.message);
    return [];
  }
}

// Skin unlock rules (minVisits = minimum score to use this skin)
// URLs (http/https) and unknown ids are allowed. Fixed image skin ids (from folder) are allowed.
const SKIN_REQUIREMENTS = {
  red: {},
  blue: {},
  green: { minVisits: 2 },
  yellow: { minVisits: 2 },
  violet: { minVisits: 4 },
  magenta: { minVisits: 4 },
  white: { minVisits: 4 },
  roulette: { minVisits: 10 },
  blacked: {}
};

function canUseSkin(skinId, userScore, userId, cb) {
  if (typeof userId === 'function') {
    cb = userId;
    userId = null;
  }
  if (!skinId) return cb ? cb(true) : true;
  const id = String(skinId).trim();
  if (id.startsWith('http://') || id.startsWith('https://')) return cb ? cb(false) : false;
  if (PAID_SKINS.includes(id)) {
    if (!userId) return cb ? cb(false) : false;
    return db.get('SELECT 1 FROM external_unlocks WHERE userId = ? AND skinId = ?', [userId, id], (err, row) => {
      if (cb) return cb(!err && !!row);
      return !err && !!row;
    });
  }
  if (getFixedImageSkins().some((s) => s.id === id)) return cb ? cb(true) : true;
  const req = SKIN_REQUIREMENTS[id];
  if (!req || req.minVisits == null) return cb ? cb(true) : true;
  const score = typeof userScore === 'number' ? userScore : 0;
  const ok = score >= req.minVisits;
  return cb ? cb(ok) : ok;
}

// Expose fixed image skins + which external skins are unlocked for this user
app.get('/api/skins', (req, res) => {
  const userId = (req.query.userId || '').toString().trim();
  const fixedImageSkins = getFixedImageSkins();
  if (!userId) return res.json({ fixedImageSkins, unlockedExternalSkins: [] });
  db.all('SELECT skinId FROM external_unlocks WHERE userId = ?', [userId], (err, rows) => {
    const unlockedExternalSkins = err || !rows ? [] : rows.map((r) => r.skinId);
    res.json({ fixedImageSkins, unlockedExternalSkins });
  });
});

// Reverse geocode: get country and city from lat/lng (Nominatim, cache by rounded coords)
const placeCache = new Map();
function getCacheKey(lat, lng) {
  return `${Math.round(lat * 10) / 10},${Math.round(lng * 10) / 10}`;
}
function fetchPlace(lat, lng) {
  const key = getCacheKey(lat, lng);
  if (placeCache.has(key)) return Promise.resolve(placeCache.get(key));
  return fetch(
    `https://nominatim.openstreetmap.org/reverse?lat=${lat}&lon=${lng}&format=json`,
    { headers: { 'User-Agent': 'Juliemap/1.0', 'Accept-Language': 'en' } }
  )
    .then((r) => r.json())
    .then((data) => {
      const addr = (data && data.address) ? data.address : {};
      const country = addr.country || 'Unknown';
      const city = addr.city || addr.town || addr.village || addr.municipality || addr.county || '';
      const place = { country, city };
      placeCache.set(key, place);
      return place;
    })
    .catch(() => ({ country: 'Unknown', city: '' }));
}
function fetchCountry(lat, lng) {
  return fetchPlace(lat, lng).then((p) => p.country);
}

// Background update of country for points still "Unknown" (1 req/s Nominatim)
function fillUnknownCountries() {
  db.all("SELECT id, lat, lng FROM users WHERE country IS NULL OR country = '' OR country = 'Unknown'", (err, rows) => {
    if (err || !rows || rows.length === 0) return;
    const next = (index) => {
      if (index >= rows.length) return;
      const u = rows[index];
      fetchCountry(u.lat, u.lng).then((country) => {
        if (country && country !== 'Unknown') {
          db.run('UPDATE users SET country = ?, updatedAt = ? WHERE id = ?', [country, new Date().toISOString(), u.id]);
        }
        setTimeout(() => next(index + 1), 1100);
      }).catch(() => setTimeout(() => next(index + 1), 1100));
    };
    next(0);
  });
}

// Save/update position (optional skin, subject to unlock rules)
app.post('/api/position', async (req, res) => {
  const { userId, lat, lng, username, skin } = req.body;

  if (!userId || typeof lat !== 'number' || typeof lng !== 'number' || !username || !username.trim()) {
    return res.status(400).json({ error: 'Invalid data' });
  }

  const cleanUsername = String(username).trim().slice(0, 40);
  let cleanSkin = skin != null && String(skin).trim() ? String(skin).trim().slice(0, 500) : null;

  const now = new Date().toISOString();
  let country = 'Unknown';
  let city = '';
  try {
    const place = await fetchPlace(lat, lng);
    country = place.country;
    city = place.city || '';
  } catch (e) {
    console.warn('Geocode failed:', e.message);
  }

  const today = now.slice(0, 10);
  const applyUpdate = (row) => {
    const currentVisits = row && typeof row.visits === 'number' ? row.visits : 0;
    const lastDate = row && row.lastVisitDate ? String(row.lastVisitDate).slice(0, 10) : '';
    const alreadyCountedToday = lastDate === today;
    const newVisits = alreadyCountedToday ? currentVisits : currentVisits + 1;
    const previousSkin = row && row.skin != null ? String(row.skin).trim() : null;
    if (cleanSkin && PAID_SKINS.includes(cleanSkin)) {
      return canUseSkin(cleanSkin, newVisits, userId, (ok) => {
        if (!ok) {
          doApplyUpdate(row, previousSkin || null);
        } else {
          doApplyUpdate(row, cleanSkin);
        }
      });
    }
    let resolvedSkin = cleanSkin;
    if (cleanSkin && !canUseSkin(cleanSkin, newVisits)) resolvedSkin = previousSkin || null;
    doApplyUpdate(row, resolvedSkin);
  };
  function doApplyUpdate(row, skinToUse) {
    const sql = `
      INSERT INTO users (id, lat, lng, username, visits, country, city, skin, lastVisitDate, createdAt, updatedAt)
      VALUES (?, ?, ?, ?, 1, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        lat = excluded.lat,
        lng = excluded.lng,
        username = excluded.username,
        visits = CASE WHEN COALESCE(users.lastVisitDate, '') = ? THEN users.visits ELSE users.visits + 1 END,
        country = excluded.country,
        city = excluded.city,
        skin = COALESCE(excluded.skin, users.skin),
        lastVisitDate = CASE WHEN COALESCE(users.lastVisitDate, '') = ? THEN users.lastVisitDate ELSE ? END,
        updatedAt = excluded.updatedAt
    `;
    db.run(sql, [userId, lat, lng, cleanUsername, country, city, skinToUse, today, now, now, today, today, today], (err) => {
      if (err) {
        console.error('DB error:', err);
        return res.status(500).json({ error: 'DB error' });
      }
      const nextPointAt = getNextPointAtUtc(today);
      res.json({ ok: true, nextPointAt });
    });
  }

  db.get('SELECT visits, skin, lastVisitDate FROM users WHERE id = ?', [userId], (err, row) => {
    if (err) return res.status(500).json({ error: 'DB error' });
    applyUpdate(row || null);
  });
});

function getNextPointAtUtc(todayYYYYMMDD) {
  const [y, m, d] = todayYYYYMMDD.split('-').map(Number);
  const next = new Date(Date.UTC(y, m - 1, d + 1, 0, 0, 0, 0));
  return next.toISOString();
}

// Next chance to earn a point (next day UTC midnight if already scored today)
app.get('/api/next-point', (req, res) => {
  const userId = req.query.userId;
  if (!userId) return res.status(400).json({ error: 'userId required' });
  const today = new Date().toISOString().slice(0, 10);
  db.get('SELECT lastVisitDate FROM users WHERE id = ?', [userId], (err, row) => {
    if (err) return res.status(500).json({ error: 'DB error' });
    const lastDate = row && row.lastVisitDate ? String(row.lastVisitDate).slice(0, 10) : '';
    const nextPointAt = lastDate === today ? getNextPointAtUtc(today) : null;
    res.json({ nextPointAt });
  });
});

// Update skin only (no position) — subject to unlock rules
app.post('/api/set-skin', (req, res) => {
  const { userId, skin } = req.body;
  if (!userId) {
    return res.status(400).json({ error: 'Invalid data: userId required' });
  }
  const cleanSkin = skin != null && String(skin).trim() ? String(skin).trim().slice(0, 500) : null;
  if (!cleanSkin) {
    const now = new Date().toISOString();
    return db.run('UPDATE users SET skin = NULL, updatedAt = ? WHERE id = ?', [now, userId], (err) => {
      if (err) return res.status(500).json({ error: 'DB error' });
      res.json({ ok: true });
    });
  }
  db.get('SELECT visits FROM users WHERE id = ?', [userId], (err, row) => {
    if (err) return res.status(500).json({ error: 'DB error' });
    const score = row && typeof row.visits === 'number' ? row.visits : 0;
    canUseSkin(cleanSkin, score, userId, (ok) => {
      if (!ok) {
        const req = SKIN_REQUIREMENTS[cleanSkin];
        let required = req && req.minVisits != null ? `Score ${req.minVisits}+` : 'Required';
        if (PAID_SKINS.includes(cleanSkin)) {
          required = cleanSkin === EXTERNAL_UNLOCK_SKIN_ID ? 'Unlock on external site' : '5 €';
        }
        return res.status(403).json({ error: 'Skin locked', required });
      }
      const now = new Date().toISOString();
      db.run('UPDATE users SET skin = ?, updatedAt = ? WHERE id = ?', [cleanSkin, now, userId], (err2) => {
        if (err2) return res.status(500).json({ error: 'DB error' });
        res.json({ ok: true });
      });
    });
  });
});

// Score (visits) is only updated by the server: +1 per day on POST /api/position (no public endpoint to change it).

// Top 10 scores + "you" info if not in top 10 (global rank, score)
app.get('/api/top-scores', (req, res) => {
  const userId = (req.query.userId || '').toString().trim();
  db.all(
    'SELECT id, username, visits, skin FROM users ORDER BY visits DESC LIMIT 10',
    (err, rows) => {
      if (err) {
        console.error('DB error:', err);
        return res.status(500).json({ users: [], you: null });
      }
      const users = (rows || []).map((r) => ({
        id: r.id,
        username: r.username || 'Guest',
        score: typeof r.visits === 'number' ? r.visits : 0,
        skin: (r.skin != null && String(r.skin).trim()) ? String(r.skin).trim() : 'red'
      }));
      if (!userId) return res.json({ users, you: null });

      db.get('SELECT username, visits, skin FROM users WHERE id = ?', [userId], (errU, u) => {
        if (errU || !u) return res.json({ users, you: null });
        const myScore = typeof u.visits === 'number' ? u.visits : 0;
        db.get(
          'SELECT COUNT(*) AS n FROM users WHERE visits > ?',
          [myScore],
          (errR, r) => {
            const rank = errR || r == null ? 0 : (r.n || 0) + 1;
            const inTop10 = users.some((x) => x.id === userId);
            if (inTop10) return res.json({ users, you: null });
            res.json({
              users,
              you: { rank, score: myScore, username: u.username || 'Guest', skin: (u.skin != null && String(u.skin).trim()) ? String(u.skin).trim() : 'red' }
            });
          }
        );
      });
    }
  );
});

// Last 3 users who joined/updated (for "Last joined" panel)
app.get('/api/last-joined', (req, res) => {
  db.all(
    'SELECT username, city, updatedAt FROM users ORDER BY updatedAt DESC LIMIT 3',
    (err, rows) => {
      if (err) {
        console.error('DB error:', err);
        return res.status(500).json({ users: [] });
      }
      res.json({ users: (rows || []).map((r) => ({ username: r.username || 'Guest', city: r.city || '', updatedAt: r.updatedAt })) });
    }
  );
});

// Get all positions
app.get('/api/positions', (req, res) => {
  db.all('SELECT * FROM users', (err, rows) => {
    if (err) {
      console.error('DB error:', err);
      return res.status(500).json({ error: 'DB error' });
    }
    res.json(rows);
  });
});

// Translate country name to short English for leaderboard (alias if available, e.g. "United States", "China")
function countryToEnglish(name) {
  if (!name || name === 'Unknown') return name;
  const langs = countries.getSupportedLanguages();
  for (const lang of ['en', ...langs]) {
    const code = countries.getAlpha2Code(name, lang);
    if (code) {
      const shortName = countries.getName(code, 'en', { select: 'alias' });
      return shortName || countries.getName(code, 'en') || name;
    }
  }
  return name;
}

// Leaderboard: top 10 countries + "you" info if userId provided (user's country for highlight / You row)
app.get('/api/leaderboard', (req, res) => {
  const userId = (req.query.userId || '').toString().trim();
  db.all(
    `SELECT country, count FROM (
       SELECT COALESCE(NULLIF(TRIM(country), ''), 'Unknown') AS country, COUNT(*) AS count
       FROM users
       GROUP BY 1
     ) WHERE country != 'Unknown'
     ORDER BY count DESC
     LIMIT 10`,
    (err, rows) => {
      if (err) {
        console.error('DB error:', err);
        return res.status(500).json({ error: 'DB error', rows: [], you: null });
      }
      const hideUnknown = (name) => (name === 'Unknown' ? '' : name);
      const out = (rows || []).map((r) => ({
        country: hideUnknown(countryToEnglish(r.country)),
        count: r.count
      }));
      if (!userId) return res.json({ rows: out, you: null });

      db.get('SELECT country FROM users WHERE id = ?', [userId], (errUser, u) => {
        if (errUser || !u || !u.country) return res.json({ rows: out, you: null });
        const rawCountry = (u.country || '').toString().trim() || 'Unknown';
        if (rawCountry === 'Unknown') return res.json({ rows: out, you: null });
        db.get(
          'SELECT COUNT(*) AS count FROM users WHERE COALESCE(NULLIF(TRIM(country), ""), "Unknown") = ?',
          [rawCountry],
          (errCount, countRow) => {
            const youCount = errCount || !countRow ? 0 : countRow.count;
            res.json({
              rows: out,
              you: { country: hideUnknown(countryToEnglish(rawCountry)), count: youCount }
            });
          }
        );
      });
    }
  );
});

app.listen(PORT, () => {
  console.log(`Server at http://localhost:${PORT}`);
  // Fill countries for "Unknown" points in background (delayed start + periodic)
  setTimeout(fillUnknownCountries, 3000);
  setInterval(fillUnknownCountries, 5 * 60 * 1000);
});

