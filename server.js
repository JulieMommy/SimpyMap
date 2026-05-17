require('dotenv').config();
const express = require('express');
const fs = require('fs');
const path = require('path');
const countries = require('i18n-iso-countries');
const { pool, initSchema } = require('./db.js');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());

const DRONE_EXTERNAL_BASE = 'https://juliemommy.pythonanywhere.com';
const EXTERNAL_UNLOCK_SKIN_ID = 'Drone';
const PAID_SKINS = ['Drone', 'blacked', 'Spiral'];

app.get('/api/drone-url', (req, res) => {
  res.json({ url: `${DRONE_EXTERNAL_BASE}/update` });
});

app.post('/api/unlock-drone', async (req, res) => {
  const userId = (req.body && req.body.userId || '').toString().trim();
  if (!userId) return res.status(400).json({ error: 'userId required' });
  try {
    await pool.query(
      `INSERT INTO external_unlocks ("userId", "skinId", "unlockedAt")
       VALUES ($1, $2, NOW())
       ON CONFLICT ("userId", "skinId") DO NOTHING`,
      [userId, EXTERNAL_UNLOCK_SKIN_ID]
    );
    res.json({ ok: true });
  } catch (err) {
    console.error('DB error:', err);
    res.status(500).json({ error: 'DB error' });
  }
});

app.use(express.static(path.join(__dirname, 'public')));

const PREFERRED_IMAGE_SKINS = [
  { id: 'Drone', name: 'Drone' },
  { id: 'Spiral', name: 'Spiral', fileBaseName: 'SpiralEye' }
];

const SKINS_DIR = path.join(__dirname, 'public', 'skins');
const HIDDEN_SKINS_DIR = path.join(SKINS_DIR, 'hidden');
const IMAGE_EXT = /\.(png|jpe?g|gif|webp)$/i;
const HIDDEN_SKIN_EXTS = ['.png', '.webp', '.jpg', '.jpeg', '.gif'];

/** Skins in public/skins/hidden/ — not listed in /api/skins; use skin = hidden:FileName in Supabase */
function resolveHiddenSkinUrl(skinId) {
  const raw = String(skinId || '').trim();
  if (!raw) return null;
  if (raw.startsWith('/skins/hidden/')) {
    const rel = raw.replace(/^\/skins\/hidden\//, '').replace(/\\/g, '/');
    if (!rel || rel.includes('..') || rel.includes('/')) return null;
    const filePath = path.join(HIDDEN_SKINS_DIR, path.basename(rel));
    if (fs.existsSync(filePath) && IMAGE_EXT.test(filePath)) return `/skins/hidden/${path.basename(rel)}`;
    return null;
  }
  if (!raw.startsWith('hidden:')) return null;
  let base = raw.slice(7).trim();
  if (!base || /[/\\]/.test(base)) return null;
  base = base.replace(/[^a-zA-Z0-9._-]/g, '');
  if (!base) return null;
  const tryNames = IMAGE_EXT.test(base) ? [base] : HIDDEN_SKIN_EXTS.map((ext) => base + ext);
  for (const name of tryNames) {
    const filePath = path.join(HIDDEN_SKINS_DIR, name);
    if (fs.existsSync(filePath)) return `/skins/hidden/${name}`;
  }
  return null;
}

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

async function canUseSkin(skinId, userScore, userId) {
  if (!skinId) return true;
  const id = String(skinId).trim();
  if (id.startsWith('http://') || id.startsWith('https://')) return false;
  if (resolveHiddenSkinUrl(id)) return true;
  if (PAID_SKINS.includes(id)) {
    if (!userId) return false;
    const { rows } = await pool.query(
      'SELECT 1 FROM external_unlocks WHERE "userId" = $1 AND "skinId" = $2',
      [userId, id]
    );
    return rows.length > 0;
  }
  if (getFixedImageSkins().some((s) => s.id === id)) return true;
  const req = SKIN_REQUIREMENTS[id];
  if (!req || req.minVisits == null) return true;
  const score = typeof userScore === 'number' ? userScore : 0;
  return score >= req.minVisits;
}

app.get('/api/skins', async (req, res) => {
  const userId = (req.query.userId || '').toString().trim();
  const fixedImageSkins = getFixedImageSkins();
  if (!userId) return res.json({ fixedImageSkins, unlockedExternalSkins: [] });
  try {
    const { rows } = await pool.query(
      'SELECT "skinId" FROM external_unlocks WHERE "userId" = $1',
      [userId]
    );
    res.json({
      fixedImageSkins,
      unlockedExternalSkins: rows.map((r) => r.skinId)
    });
  } catch (err) {
    console.error('DB error:', err);
    res.status(500).json({ error: 'DB error' });
  }
});

const placeCache = new Map();
const countryBboxCache = new Map();
let lastNominatimAt = 0;

function getCacheKey(lat, lng) {
  return `${Math.round(lat * 10) / 10},${Math.round(lng * 10) / 10}`;
}

async function waitNominatimSlot() {
  const wait = Math.max(0, 1100 - (Date.now() - lastNominatimAt));
  if (wait > 0) await new Promise((r) => setTimeout(r, wait));
  lastNominatimAt = Date.now();
}

function parsePlaceFromNominatim(data) {
  const addr = (data && data.address) ? data.address : {};
  return {
    country: addr.country || 'Unknown',
    countryCode: (addr.country_code || '').toUpperCase(),
    city: addr.city || addr.town || addr.village || addr.municipality || addr.county || ''
  };
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
      const place = parsePlaceFromNominatim(data);
      placeCache.set(key, place);
      return place;
    })
    .catch(() => ({ country: 'Unknown', countryCode: '', city: '' }));
}

/** Reverse geocode without cache — used to validate random candidates. */
async function fetchPlaceFresh(lat, lng) {
  await waitNominatimSlot();
  try {
    const res = await fetch(
      `https://nominatim.openstreetmap.org/reverse?lat=${lat}&lon=${lng}&format=json`,
      { headers: { 'User-Agent': 'Juliemap/1.0', 'Accept-Language': 'en' } }
    );
    const data = await res.json();
    return parsePlaceFromNominatim(data);
  } catch (e) {
    console.warn('fetchPlaceFresh:', e.message);
    return { country: 'Unknown', countryCode: '', city: '' };
  }
}

async function getCountryBoundingBox(countryName, countryCode) {
  const code = (countryCode || '').trim().toUpperCase();
  const name = (countryName || '').trim();
  if (!name || name === 'Unknown') return null;
  const cacheKey = code || name;
  if (countryBboxCache.has(cacheKey)) return countryBboxCache.get(cacheKey);
  await waitNominatimSlot();
  try {
    let url =
      `https://nominatim.openstreetmap.org/search?format=json&limit=5&featuretype=country&country=${encodeURIComponent(name)}`;
    if (code) url += `&countrycodes=${encodeURIComponent(code.toLowerCase())}`;
    const res = await fetch(url, {
      headers: { 'User-Agent': 'Juliemap/1.0', 'Accept-Language': 'en' }
    });
    const data = await res.json();
    const hits = Array.isArray(data) ? data : [];
    const hit =
      hits.find((h) => code && (h.country_code || '').toUpperCase() === code) ||
      hits.find((h) => String(h.type || '').toLowerCase() === 'country') ||
      hits[0];
    const bbox = hit && hit.boundingbox ? hit.boundingbox.map(Number) : null;
    if (bbox && bbox.length === 4 && bbox.every((n) => Number.isFinite(n))) {
      countryBboxCache.set(cacheKey, bbox);
      return bbox;
    }
  } catch (e) {
    console.warn('getCountryBoundingBox:', e.message);
  }
  countryBboxCache.set(cacheKey, null);
  return null;
}

function randomLatLngInBbox(bbox) {
  const [south, north, west, east] = bbox;
  return {
    lat: south + Math.random() * (north - south),
    lng: west + Math.random() * (east - west)
  };
}

function haversineKm(lat1, lng1, lat2, lng2) {
  const R = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLng = ((lng2 - lng1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function maxRadiusKmForCountry(bbox) {
  if (!bbox) return 450;
  const [south, north, west, east] = bbox;
  const midLat = (south + north) / 2;
  const heightKm = Math.abs(north - south) * 111;
  const widthKm = Math.abs(east - west) * 111 * Math.cos((midLat * Math.PI) / 180);
  return Math.min(2800, Math.max(180, Math.max(heightKm, widthKm) * 0.6));
}

function isSameCountry(place, targetCode, targetCountry) {
  if (targetCode && place.countryCode === targetCode) return true;
  if (!targetCode && targetCountry && place.country === targetCountry) return true;
  return false;
}

function isCandidateAllowed(realLat, realLng, lat, lng, targetCode, targetCountry, bbox) {
  if (!isFinite(lat) || !isFinite(lng)) return false;
  const maxKm = maxRadiusKmForCountry(bbox);
  if (haversineKm(realLat, realLng, lat, lng) > maxKm) return false;
  if (bbox) {
    const [south, north, west, east] = bbox;
    if (lat < south || lat > north) return false;
    if (west <= east) {
      if (lng < west || lng > east) return false;
    } else if (lng > east && lng < west) {
      return false;
    }
  }
  return true;
}

async function tryAcceptCandidate(realLat, realLng, lat, lng, targetCode, targetCountry, bbox) {
  if (!isCandidateAllowed(realLat, realLng, lat, lng, targetCode, targetCountry, bbox)) {
    return null;
  }
  const check = await fetchPlaceFresh(lat, lng);
  if (!isSameCountry(check, targetCode, targetCountry)) return null;
  return { lat, lng, country: targetCountry, city: '' };
}

/** Random point guaranteed (by reverse geocode) to stay in the user's country. */
async function randomPointInCountry(realLat, realLng) {
  const place = await fetchPlace(realLat, realLng);
  const targetCode = place.countryCode;
  const targetCountry = place.country;
  if (!targetCode && (!targetCountry || targetCountry === 'Unknown')) {
    return { lat: realLat, lng: realLng, country: 'Unknown', city: '' };
  }

  const bbox = await getCountryBoundingBox(targetCountry, targetCode);
  const maxKm = maxRadiusKmForCountry(bbox);

  if (bbox) {
    for (let i = 0; i < 15; i++) {
      const { lat, lng } = randomLatLngInBbox(bbox);
      const accepted = await tryAcceptCandidate(
        realLat, realLng, lat, lng, targetCode, targetCountry, bbox
      );
      if (accepted) return accepted;
    }
  }

  for (let i = 0; i < 12; i++) {
    const distKm = 15 + Math.random() * Math.min(maxKm * 0.85, 750);
    const angle = Math.random() * Math.PI * 2;
    const dLat = (distKm / 111) * Math.cos(angle);
    const dLng = (distKm / (111 * Math.cos((realLat * Math.PI) / 180))) * Math.sin(angle);
    const lat = realLat + dLat;
    const lng = realLng + dLng;
    const accepted = await tryAcceptCandidate(
      realLat, realLng, lat, lng, targetCode, targetCountry, bbox
    );
    if (accepted) return accepted;
  }

  console.warn('randomPointInCountry: fallback to approximate GPS for', targetCode || targetCountry);
  return { lat: realLat, lng: realLng, country: targetCountry, city: '' };
}

function isManualOverrideRow(row) {
  return row && (row.manualOverride === true || row.manualOverride === 't');
}

async function fillUnknownCountries() {
  try {
    const { rows } = await pool.query(
      `SELECT id, lat, lng FROM users
       WHERE (country IS NULL OR country = '' OR country = 'Unknown')
         AND COALESCE("manualOverride", false) = false
         AND COALESCE("anonymousLocation", false) = false`
    );
    if (!rows.length) return;
    for (const u of rows) {
      const country = await fetchPlace(u.lat, u.lng).then((p) => p.country);
      if (country && country !== 'Unknown') {
        await pool.query('UPDATE users SET country = $1, "updatedAt" = $2 WHERE id = $3', [
          country,
          new Date().toISOString(),
          u.id
        ]);
      }
      await new Promise((r) => setTimeout(r, 1100));
    }
  } catch (err) {
    console.warn('fillUnknownCountries:', err.message);
  }
}

function getNextPointAtUtc(todayYYYYMMDD) {
  const [y, m, d] = todayYYYYMMDD.split('-').map(Number);
  const next = new Date(Date.UTC(y, m - 1, d + 1, 0, 0, 0, 0));
  return next.toISOString();
}

/** Wait after point 1→2, 2→3, 3→4, 4→5 (ms). From 5 points onward: daily UTC. */
const EARLY_POINT_DELAYS_MS = [
  5 * 60 * 1000,
  10 * 60 * 1000,
  15 * 60 * 1000,
  60 * 60 * 1000
];

function getLastPointEarnedAt(row) {
  if (!row || !row.lastPointEarnedAt) return null;
  const t = String(row.lastPointEarnedAt).trim();
  return t || null;
}

function canEarnPointNow(visits, lastPointEarnedAt, lastVisitDate, today) {
  const v = typeof visits === 'number' ? visits : 0;
  if (v >= 5) {
    const lastDate = lastVisitDate ? String(lastVisitDate).slice(0, 10) : '';
    return lastDate !== today;
  }
  if (v === 0) return true;
  if (!lastPointEarnedAt) return true;
  const earned = new Date(lastPointEarnedAt).getTime();
  if (!Number.isFinite(earned)) return true;
  const delay = EARLY_POINT_DELAYS_MS[Math.min(v - 1, EARLY_POINT_DELAYS_MS.length - 1)];
  return Date.now() >= earned + delay;
}

function computeNextPointAt(visits, lastPointEarnedAt, lastVisitDate, today) {
  const v = typeof visits === 'number' ? visits : 0;
  if (v >= 5) {
    const lastDate = lastVisitDate ? String(lastVisitDate).slice(0, 10) : '';
    if (lastDate === today) return getNextPointAtUtc(today);
    return null;
  }
  if (v === 0) return null;
  if (!lastPointEarnedAt) return null;
  const earned = new Date(lastPointEarnedAt).getTime();
  if (!Number.isFinite(earned)) return null;
  const delay = EARLY_POINT_DELAYS_MS[Math.min(v - 1, EARLY_POINT_DELAYS_MS.length - 1)];
  const nextMs = earned + delay;
  if (Date.now() >= nextMs) return null;
  return new Date(nextMs).toISOString();
}

app.post('/api/position', async (req, res) => {
  const { userId, lat, lng, username, skin, anonymous } = req.body;

  if (!userId || typeof lat !== 'number' || typeof lng !== 'number' || !username || !username.trim()) {
    return res.status(400).json({ error: 'Invalid data' });
  }

  const cleanUsername = String(username).trim().slice(0, 40);
  let cleanSkin = skin != null && String(skin).trim() ? String(skin).trim().slice(0, 500) : null;
  const wantAnonymous = anonymous === true || anonymous === 'true' || anonymous === 1;

  const now = new Date().toISOString();
  const today = now.slice(0, 10);

  try {
    const { rows: existing } = await pool.query(
      `SELECT visits, skin, "lastVisitDate", "lastPointEarnedAt", "createdAt", "manualOverride",
              "anonymousLocation", lat, lng, country, city
       FROM users WHERE id = $1`,
      [userId]
    );
    const row = existing[0] || null;
    const manualOverride = isManualOverrideRow(row);
    const alreadyAnonymous = row && (row.anonymousLocation === true || row.anonymousLocation === 't');
    const hasStoredPosition =
      row && typeof row.lat === 'number' && typeof row.lng === 'number' && Number.isFinite(row.lat);

    let latUse = lat;
    let lngUse = lng;
    let country = 'Unknown';
    let city = '';
    let setAnonymous = false;

    if ((alreadyAnonymous || manualOverride) && hasStoredPosition) {
      latUse = row.lat;
      lngUse = row.lng;
      country = row.country || 'Unknown';
      city = row.city || '';
    } else if (wantAnonymous && !hasStoredPosition) {
      const randomPt = await randomPointInCountry(lat, lng);
      latUse = randomPt.lat;
      lngUse = randomPt.lng;
      country = randomPt.country;
      city = randomPt.city;
      setAnonymous = true;
    } else {
      try {
        const place = await fetchPlace(lat, lng);
        country = place.country;
        city = place.city || '';
      } catch (e) {
        console.warn('Geocode failed:', e.message);
      }
    }

    const currentVisits = row && typeof row.visits === 'number' ? row.visits : 0;
    const lastDate = row && row.lastVisitDate ? String(row.lastVisitDate).slice(0, 10) : '';
    const lastEarned = getLastPointEarnedAt(row);
    const canEarn = manualOverride ? false : canEarnPointNow(currentVisits, lastEarned, lastDate, today);
    let visitsToStore;
    let lastPointEarnedAtToStore;
    let lastVisitDateToStore;
    if (manualOverride && row) {
      visitsToStore = currentVisits;
      lastPointEarnedAtToStore = row.lastPointEarnedAt || null;
      lastVisitDateToStore = lastDate;
    } else if (!row) {
      visitsToStore = 1;
      lastPointEarnedAtToStore = now;
      lastVisitDateToStore = today;
    } else {
      visitsToStore = canEarn ? currentVisits + 1 : currentVisits;
      lastPointEarnedAtToStore = canEarn ? now : row.lastPointEarnedAt || null;
      lastVisitDateToStore = lastDate || '';
      if (canEarn) {
        if (visitsToStore >= 5) lastVisitDateToStore = today;
        else if (visitsToStore >= 1) lastVisitDateToStore = today;
      }
    }

    const previousSkin = row && row.skin != null ? String(row.skin).trim() : null;
    const scoreForSkin = visitsToStore;

    let skinToUse = cleanSkin;
    if (cleanSkin && PAID_SKINS.includes(cleanSkin)) {
      const ok = await canUseSkin(cleanSkin, scoreForSkin, userId);
      skinToUse = ok ? cleanSkin : (previousSkin || null);
    } else if (cleanSkin) {
      const ok = await canUseSkin(cleanSkin, scoreForSkin, userId);
      if (!ok) skinToUse = previousSkin || null;
    } else {
      skinToUse = previousSkin || null;
    }

    await pool.query(
      `INSERT INTO users (id, lat, lng, username, visits, country, city, skin, "lastVisitDate", "lastPointEarnedAt", "createdAt", "updatedAt", "anonymousLocation")
       VALUES ($1, $2, $3, $4, 1, $5, $6, $7, $8, $9, $10, $11, $14)
       ON CONFLICT (id) DO UPDATE SET
         lat = CASE WHEN COALESCE(users."manualOverride", false) = true THEN users.lat WHEN COALESCE(users."anonymousLocation", false) = true THEN users.lat ELSE EXCLUDED.lat END,
         lng = CASE WHEN COALESCE(users."manualOverride", false) = true THEN users.lng WHEN COALESCE(users."anonymousLocation", false) = true THEN users.lng ELSE EXCLUDED.lng END,
         username = EXCLUDED.username,
         visits = CASE WHEN COALESCE(users."manualOverride", false) = true THEN users.visits ELSE $12 END,
         country = CASE WHEN COALESCE(users."manualOverride", false) = true THEN users.country WHEN COALESCE(users."anonymousLocation", false) = true THEN users.country ELSE EXCLUDED.country END,
         city = CASE WHEN COALESCE(users."manualOverride", false) = true THEN users.city WHEN COALESCE(users."anonymousLocation", false) = true THEN users.city ELSE EXCLUDED.city END,
         skin = COALESCE(EXCLUDED.skin, users.skin),
         "lastVisitDate" = CASE WHEN COALESCE(users."manualOverride", false) = true THEN users."lastVisitDate" ELSE $13 END,
         "lastPointEarnedAt" = CASE WHEN COALESCE(users."manualOverride", false) = true THEN users."lastPointEarnedAt" ELSE $15 END,
         "updatedAt" = EXCLUDED."updatedAt",
         "anonymousLocation" = COALESCE(users."anonymousLocation", EXCLUDED."anonymousLocation")`,
      [
        userId,
        latUse,
        lngUse,
        cleanUsername,
        country,
        city,
        skinToUse,
        lastVisitDateToStore,
        now,
        now,
        now,
        visitsToStore,
        lastVisitDateToStore,
        setAnonymous,
        lastPointEarnedAtToStore
      ]
    );

    const nextPointAt = manualOverride
      ? null
      : computeNextPointAt(visitsToStore, lastPointEarnedAtToStore, lastVisitDateToStore, today);

    res.json({
      ok: true,
      pointEarned: !manualOverride && (canEarn || !row),
      nextPointAt,
      visits: visitsToStore,
      pointsFrozen: !!manualOverride,
      anonymousLocation: alreadyAnonymous || setAnonymous,
      manualOverride: !!manualOverride,
      lat: latUse,
      lng: lngUse
    });
  } catch (err) {
    console.error('DB error:', err);
    res.status(500).json({ error: 'DB error' });
  }
});

app.get('/api/next-point', async (req, res) => {
  const userId = req.query.userId;
  if (!userId) return res.status(400).json({ error: 'userId required' });
  const today = new Date().toISOString().slice(0, 10);
  try {
    const { rows } = await pool.query(
      `SELECT visits, "lastVisitDate", "lastPointEarnedAt", "manualOverride" FROM users WHERE id = $1`,
      [userId]
    );
    const row = rows[0];
    if (!row) return res.json({ nextPointAt: null, visits: 0, canEarn: true, manualOverride: false });
    const visits = typeof row.visits === 'number' ? row.visits : 0;
    const manualOverride = isManualOverrideRow(row);
    if (manualOverride) {
      return res.json({ nextPointAt: null, visits, canEarn: false, manualOverride: true, pointsFrozen: true });
    }
    const lastDate = row.lastVisitDate ? String(row.lastVisitDate).slice(0, 10) : '';
    const lastEarned = getLastPointEarnedAt(row);
    const nextPointAt = computeNextPointAt(visits, lastEarned, lastDate, today);
    const canEarn = canEarnPointNow(visits, lastEarned, lastDate, today);
    res.json({ nextPointAt, visits, canEarn, manualOverride: false, pointsFrozen: false });
  } catch (err) {
    console.error('DB error:', err);
    res.status(500).json({ error: 'DB error' });
  }
});

app.post('/api/set-skin', async (req, res) => {
  const { userId, skin } = req.body;
  if (!userId) return res.status(400).json({ error: 'Invalid data: userId required' });

  const cleanSkin = skin != null && String(skin).trim() ? String(skin).trim().slice(0, 500) : null;
  const now = new Date().toISOString();

  try {
    const { rows: lockRows } = await pool.query(
      'SELECT "manualOverride" FROM users WHERE id = $1',
      [userId]
    );
    if (isManualOverrideRow(lockRows[0])) {
      return res.json({ ok: true, manualOverride: true });
    }

    if (!cleanSkin) {
      await pool.query('UPDATE users SET skin = NULL, "updatedAt" = $1 WHERE id = $2', [now, userId]);
      return res.json({ ok: true });
    }

    const { rows } = await pool.query('SELECT visits FROM users WHERE id = $1', [userId]);
    const score = rows[0] && typeof rows[0].visits === 'number' ? rows[0].visits : 0;
    const ok = await canUseSkin(cleanSkin, score, userId);
    if (!ok) {
      const req = SKIN_REQUIREMENTS[cleanSkin];
      let required = req && req.minVisits != null ? `Score ${req.minVisits}+` : 'Required';
      if (PAID_SKINS.includes(cleanSkin)) {
        required = cleanSkin === EXTERNAL_UNLOCK_SKIN_ID ? 'Unlock on external site' : '5 €';
      }
      return res.status(403).json({ error: 'Skin locked', required });
    }

    await pool.query('UPDATE users SET skin = $1, "updatedAt" = $2 WHERE id = $3', [cleanSkin, now, userId]);
    res.json({ ok: true });
  } catch (err) {
    console.error('DB error:', err);
    res.status(500).json({ error: 'DB error' });
  }
});

app.get('/api/top-scores', async (req, res) => {
  const userId = (req.query.userId || '').toString().trim();
  try {
    const { rows } = await pool.query(
      'SELECT id, username, visits, skin FROM users ORDER BY visits DESC LIMIT 10'
    );
    const users = rows.map((r) => ({
      id: r.id,
      username: r.username || 'Guest',
      score: typeof r.visits === 'number' ? r.visits : 0,
      skin: (r.skin != null && String(r.skin).trim()) ? String(r.skin).trim() : 'red'
    }));
    if (!userId) return res.json({ users, you: null });

    const { rows: meRows } = await pool.query(
      'SELECT username, visits, skin FROM users WHERE id = $1',
      [userId]
    );
    const u = meRows[0];
    if (!u) return res.json({ users, you: null });

    const myScore = typeof u.visits === 'number' ? u.visits : 0;
    const { rows: rankRows } = await pool.query(
      'SELECT COUNT(*)::int AS n FROM users WHERE visits > $1',
      [myScore]
    );
    const rank = (rankRows[0] && rankRows[0].n) + 1;
    const inTop10 = users.some((x) => x.id === userId);
    if (inTop10) return res.json({ users, you: null });

    res.json({
      users,
      you: {
        rank,
        score: myScore,
        username: u.username || 'Guest',
        skin: (u.skin != null && String(u.skin).trim()) ? String(u.skin).trim() : 'red'
      }
    });
  } catch (err) {
    console.error('DB error:', err);
    res.status(500).json({ users: [], you: null });
  }
});

app.get('/api/last-joined', async (req, res) => {
  try {
    const { rows } = await pool.query(
      'SELECT username, city, "updatedAt" FROM users ORDER BY "updatedAt" DESC NULLS LAST LIMIT 3'
    );
    res.json({
      users: rows.map((r) => ({
        username: r.username || 'Guest',
        city: r.city || '',
        updatedAt: r.updatedAt
      }))
    });
  } catch (err) {
    console.error('DB error:', err);
    res.status(500).json({ users: [] });
  }
});

app.get('/api/positions', async (req, res) => {
  try {
    const { rows } = await pool.query('SELECT * FROM users');
    res.json(rows);
  } catch (err) {
    console.error('DB error:', err);
    res.status(500).json({ error: 'DB error' });
  }
});

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

app.get('/api/leaderboard', async (req, res) => {
  const userId = (req.query.userId || '').toString().trim();
  try {
    const { rows } = await pool.query(
      `SELECT country, count FROM (
         SELECT COALESCE(NULLIF(TRIM(country), ''), 'Unknown') AS country, COUNT(*)::int AS count
         FROM users
         GROUP BY 1
       ) sub
       WHERE country != 'Unknown'
       ORDER BY count DESC
       LIMIT 10`
    );
    const hideUnknown = (name) => (name === 'Unknown' ? '' : name);
    const out = rows.map((r) => ({
      country: hideUnknown(countryToEnglish(r.country)),
      count: r.count
    }));
    if (!userId) return res.json({ rows: out, you: null });

    const { rows: userRows } = await pool.query('SELECT country FROM users WHERE id = $1', [userId]);
    const u = userRows[0];
    if (!u || !u.country) return res.json({ rows: out, you: null });

    const rawCountry = (u.country || '').toString().trim() || 'Unknown';
    if (rawCountry === 'Unknown') return res.json({ rows: out, you: null });

    const { rows: countRows } = await pool.query(
      `SELECT COUNT(*)::int AS count FROM users
       WHERE COALESCE(NULLIF(TRIM(country), ''), 'Unknown') = $1`,
      [rawCountry]
    );
    const youCount = countRows[0] ? countRows[0].count : 0;
    res.json({
      rows: out,
      you: { country: hideUnknown(countryToEnglish(rawCountry)), count: youCount }
    });
  } catch (err) {
    console.error('DB error:', err);
    res.status(500).json({ error: 'DB error', rows: [], you: null });
  }
});

async function start() {
  if (!process.env.DATABASE_URL) {
    console.error('❌ DATABASE_URL manquant dans .env (URL Supabase)');
    process.exit(1);
  }
  try {
    await initSchema();
    await pool.query(`
      DELETE FROM users WHERE
        id = 'fake-paris' OR id = 'julie' OR id LIKE 'test%'
        OR username IN ('Paris visitor', 'Test2', 'Test3')
        OR username ~ '^Test [0-9]+$'
    `);
  } catch (err) {
    console.error('Erreur init base:', err.message);
    process.exit(1);
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Serveur sur http://localhost:${PORT}`);
    setTimeout(fillUnknownCountries, 3000);
    setInterval(fillUnknownCountries, 5 * 60 * 1000);
  });
}

start();
