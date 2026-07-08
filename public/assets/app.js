// Generate / retrieve a persistent userId in this browser
    function getOrCreateUserId() {
      let id = localStorage.getItem('userId');
      if (!id) {
        if (window.crypto && crypto.randomUUID) {
          id = crypto.randomUUID();
        } else {
          id = String(Date.now()) + '-' + Math.random().toString(16).slice(2);
        }
        localStorage.setItem('userId', id);
      }
      return id;
    }

    const userId = getOrCreateUserId();
    let username = null;

    const MAP_MIN_ZOOM = 3;
    const MAP_MAX_ZOOM = 6;
    const MAP_DEFAULT_ZOOM = 5;
    const MAP_CENTER = [45, 10];

    // Single preloaded image (imageOverlay): zoom/pan = no extra HTTP, markers stay on lat/lng
    const map = L.map('map', {
      zoomControl: true,
      worldCopyJump: false,
      minZoom: MAP_MIN_ZOOM,
      maxZoom: MAP_MAX_ZOOM,
      scrollWheelZoom: true,
      doubleClickZoom: true,
      touchZoom: true,
      boxZoom: false,
      keyboard: true,
      dragging: true
    });

    const panBounds = [[-58, -180], [85, 180]];
    map.setMaxBounds(panBounds);
    map.options.maxBoundsViscosity = 0.85;

    // Image corners = exact z4 tile grid (not panBounds) so markers align with geography
    const mapImageBounds = [
      [-66.51326044311186, -180],
      [85.0511287798066, 180]
    ];
    L.imageOverlay(window.__MAP_IMAGE_URL__ || '/map/world-dark-z4.webp', mapImageBounds, {
      attribution: '&copy; OpenStreetMap contributors &copy; CARTO',
      interactive: false
    }).addTo(map);

    map.setView(MAP_CENTER, MAP_DEFAULT_ZOOM);

    // Available skins (type: color | pattern | url for custom image)
    const SKINS = [
      { id: 'red', name: 'Red', hex: '#b91c1c' },
      { id: 'blue', name: 'Blue', hex: '#2563eb' },
      { id: 'green', name: 'Green', hex: '#16a34a', minVisits: 2 },
      { id: 'yellow', name: 'Yellow', hex: '#ca8a04', minVisits: 2 },
      { id: 'violet', name: 'Violet', hex: '#7c3aed', minVisits: 4 },
      { id: 'magenta', name: 'Pink', hex: '#c026d3', minVisits: 4 },
      { id: 'white', name: 'White', hex: '#f8fafc', minVisits: 4 },
      { id: 'roulette', name: 'Roulette', type: 'pattern', pattern: 'roulette', hex: '#7c3aed', minVisits: 10 },
      // BLACKED affiché tout en bas de la liste
      { id: 'blacked', name: 'BLACKED', type: 'pattern', pattern: 'blacked', hex: '#0f172a' }
    ];
    let fixedImageSkins = []; // filled by dashboard (skins) on full load
    let unlockedExternalSkins = []; // e.g. ['Drone', 'blacked', 'Spiral'] when unlocked
    let unlockedHiddenSkins = []; // e.g. [{ id: 'hidden:JULIEPFP', name, imageUrl }]
    const PAID_SKIN_IDS = ['Drone', 'blacked', 'Spiral'];
    const PAID_SKIN_LABELS = { Drone: 'Become a Drone', blacked: '5 €', Spiral: '5 €' };
    function isSkinUrl(s) {
      const v = String(s || '').trim();
      return v.startsWith('http://') || v.startsWith('https://');
    }
    function isFixedImageSkin(skinId) {
      return fixedImageSkins.some((s) => s.id === skinId);
    }
    function getFixedImageUrl(skinId) {
      const s = fixedImageSkins.find((x) => x.id === skinId);
      return s ? s.imageUrl : null;
    }
    function canUseSkin(skinId, score) {
      if (resolveHiddenSkinUrl(skinId)) {
        const norm = normalizeHiddenSkinId(skinId);
        return unlockedHiddenSkins.some((s) => s.id === norm)
          || unlockedExternalSkins.some((uid) => normalizeHiddenSkinId(uid) === norm);
      }
      if (isSkinUrl(skinId)) return true;
      if (PAID_SKIN_IDS.includes(skinId)) return unlockedExternalSkins.includes(skinId);
      if (isFixedImageSkin(skinId)) return true;
      const s = SKINS.find((x) => x.id === skinId);
      if (!s || s.minVisits == null) return true;
      return (typeof score === 'number' ? score : 0) >= s.minVisits;
    }
    function getSkinRequirementLabel(skin) {
      if (!skin) return '';
      if (PAID_SKIN_IDS.includes(skin.id)) return PAID_SKIN_LABELS[skin.id] || '5 €';
      if (skin.minVisits != null) return `Score ${skin.minVisits}+`;
      return '';
    }
    function getSkinColor(skinId) {
      const s = SKINS.find((x) => x.id === (skinId || 'red'));
      return (s && s.hex) ? s.hex : '#b91c1c';
    }
    /** hidden:MySkin → /skins/hidden/MySkin.png (panel only if external_unlock) */
    function resolveHiddenSkinUrl(skinId) {
      const id = String(skinId || '').trim();
      if (!id) return null;
      if (id.startsWith('/skins/hidden/')) {
        const rel = id.replace(/^\/skins\/hidden\//, '');
        if (!rel || rel.includes('..') || rel.includes('/')) return null;
        return `/skins/hidden/${rel.split('?')[0]}`;
      }
      if (!id.startsWith('hidden:')) return null;
      let base = id.slice(7).trim().replace(/[^a-zA-Z0-9._-]/g, '');
      if (!base) return null;
      if (/\.(png|jpe?g|gif|webp)$/i.test(base)) return `/skins/hidden/${base}`;
      return `/skins/hidden/${base}.png`;
    }
    function normalizeHiddenSkinId(skinId) {
      const url = resolveHiddenSkinUrl(skinId);
      if (!url) return null;
      const base = url.replace(/^\/skins\/hidden\//, '').split('?')[0];
      const name = base.replace(/\.(png|jpe?g|gif|webp)$/i, '');
      return name ? `hidden:${name}` : null;
    }
    function getSkinStyle(skinId) {
      const id = (skinId && String(skinId).trim()) || 'red';
      const neutralRing = '#64748b';
      if (isSkinUrl(id)) {
        const safe = id.replace(/"/g, '&quot;');
        return { style: `background-image:url(${safe});background-size:cover;background-color:#334155`, extraClass: '', ringColor: neutralRing };
      }
      const hiddenUrl = resolveHiddenSkinUrl(id);
      if (hiddenUrl) {
        const safe = hiddenUrl.replace(/"/g, '&quot;');
        return { style: `background-image:url(${safe});background-size:cover;background-color:#334155`, extraClass: '', ringColor: neutralRing };
      }
      const fixedUrl = getFixedImageUrl(id);
      if (fixedUrl) {
        const safe = fixedUrl.replace(/"/g, '&quot;');
        return { style: `background-image:url(${safe});background-size:cover;background-color:#334155`, extraClass: '', ringColor: neutralRing };
      }
      const s = SKINS.find((x) => x.id === id);
      if (s && s.type === 'pattern' && s.pattern) {
        return { style: '', extraClass: `pattern-${s.pattern}`, ringColor: neutralRing };
      }
      const color = getSkinColor(id);
      return { style: `background:${color}`, extraClass: '', ringColor: color };
    }
    function hexToRgba(hex, alpha) {
      const h = String(hex).replace('#', '');
      if (h.length !== 6) return `rgba(185,28,28,${alpha})`;
      const r = parseInt(h.slice(0, 2), 16), g = parseInt(h.slice(2, 4), 16), b = parseInt(h.slice(4, 6), 16);
      return `rgba(${r},${g},${b},${alpha})`;
    }
    function getRingShadow(hex, bandNum) {
      if (bandNum <= 1) return '';
      const px = 3 + (bandNum - 2) * 2; // 3,5,7,9,11
      return `, 0 0 0 ${px}px ${hexToRgba(hex, 0.4)}`;
    }

    // Delay (seconds) for spawn animation: left (west) = 0, right (east) = max
    function spawnDelayFromLng(lng) {
      return ((Number(lng) + 180) / 360) * 1.2;
    }

    const SELECTED_MARKER_SCALE = 3.5;
    const TOP_SCORER_CORE_EXTRA_PX = 5;
    const TOP_SCORER_STAR_SCALE = 2;
    const ME_MARKER_SIZE_BONUS = 3;
    const ME_HALO_PAD_PX = 10;

    function getNormalDotSize(visits, isMe) {
      const bandNum = getVisitBandNumber(visits);
      const base = 14 + (bandNum - 1);
      return isMe ? base + ME_MARKER_SIZE_BONUS : base;
    }

    function getTopScorerLayout(visits, isMe) {
      const normalDot = getNormalDotSize(visits, isMe);
      const coreSize = normalDot + TOP_SCORER_CORE_EXTRA_PX;
      const starSize = Math.round(coreSize * TOP_SCORER_STAR_SCALE);
      return { normalDot, coreSize, starSize };
    }

    function getMarkerIconSize(visits, isTopScorer, isSelected, isMe) {
      const size = isTopScorer ? getTopScorerLayout(visits, !!isMe).starSize : getNormalDotSize(visits, !!isMe);
      return isSelected ? Math.round(size * SELECTED_MARKER_SCALE) : size;
    }

    function getMeMarkerIconLayout(visits, isTopScorer, isSelected) {
      const dotSize = getMarkerIconSize(visits, isTopScorer, isSelected, true);
      const pad = isSelected ? 0 : ME_HALO_PAD_PX;
      const size = dotSize + pad;
      return { w: size, h: size, anchor: size / 2 };
    }

    function wrapMeMarkerHtml(innerHtml) {
      return `<div class="me-marker-body"><span class="me-marker-halo" aria-hidden="true"></span>${innerHtml}</div>`;
    }

    const Z_MARKER_SCORE_MULT = 10;
    const Z_MARKER_ME_BONUS = 500;
    const Z_MARKER_SELECTED_BONUS = 2000;

    function getMarkerZIndexOffset(visits, isMe, isSelected) {
      const score = Math.max(0, typeof visits === 'number' ? visits : 0);
      let z = score * Z_MARKER_SCORE_MULT;
      if (isMe) z += Z_MARKER_ME_BONUS;
      if (isSelected) z += Z_MARKER_SELECTED_BONUS;
      return z;
    }

    function sortPlayersByScoreAsc(users) {
      users.sort((a, b) => {
        const va = typeof a.visits === 'number' ? a.visits : 0;
        const vb = typeof b.visits === 'number' ? b.visits : 0;
        return va - vb;
      });
      return users;
    }

    function getPopupOffset(visits, isTopScorer, isSelected, isMe) {
      const size = getMarkerIconSize(visits, isTopScorer, isSelected, isMe);
      const pad = isMe && !isSelected ? ME_HALO_PAD_PX : 0;
      const gap = isSelected ? 6 : 8;
      return L.point(0, -(Math.round((size + pad) / 2) + gap));
    }

    function bindPlayerPopup(marker, popupHtml, visits, isTopScorer, playerId) {
      const isSelected = selectedPlayerId === playerId;
      const meta = playerMarkerMeta.get(playerId);
      const isMe = meta && meta.isMe;
      marker.bindPopup(popupHtml, {
        offset: getPopupOffset(visits, isTopScorer, isSelected, isMe),
        className: isSelected ? 'player-popup player-popup--selected' : 'player-popup'
      });
    }

    function syncMarkerPopup(marker, playerId) {
      const meta = playerMarkerMeta.get(playerId);
      if (!marker || !meta) return;
      const isSelected = selectedPlayerId === playerId;
      const offset = getPopupOffset(meta.visits, meta.isTopScorer, isSelected, meta.isMe);
      const popup = marker.getPopup();
      if (popup) {
        popup.options.offset = offset;
        popup.options.className = isSelected ? 'player-popup player-popup--selected' : 'player-popup';
        if (marker.isPopupOpen()) popup.update();
      }
    }


    function buildMarkerDotInlineStyle(skin, bandNum, spawnDelaySec, isTopScorer) {
      const ringShadow = getRingShadow(skin.ringColor, bandNum);
      const baseShadow = '0 2px 6px rgba(0,0,0,0.35)';
      const shadowPart = `box-shadow:${baseShadow}${ringShadow}`;
      if (isTopScorer) {
        return skin.style ? `${skin.style};${shadowPart}` : shadowPart;
      }
      const delayPart = `animation-delay:${spawnDelaySec}s;`;
      return skin.style ? `${delayPart}${skin.style};${shadowPart}` : `${delayPart}${shadowPart}`;
    }

    function buildMarkerDotHtml(dotClass, skin, dotStyle, isTopScorer, visits, isSelected, spawnDelaySec, isMe) {
      if (!isTopScorer) {
        const dotSize = getNormalDotSize(visits, isMe);
        const sizeCss = isMe && !isSelected ? `width:${dotSize}px;height:${dotSize}px;` : '';
        return `<div class="${dotClass} skin-dot ${skin.extraClass}" style="${sizeCss}${dotStyle}"></div>`;
      }
      let { coreSize } = getTopScorerLayout(visits, isMe);
      if (isSelected) coreSize = Math.round(coreSize * SELECTED_MARKER_SCALE);
      const wrapStyle = `animation-delay:${spawnDelaySec}s;`;
      const coreStyle = `${dotStyle};width:${coreSize}px;height:${coreSize}px;min-width:${coreSize}px;min-height:${coreSize}px;`;
      return `<div class="top-scorer-wrap" style="${wrapStyle}"><span class="top-scorer-gold" aria-hidden="true"></span><div class="${dotClass} top-scorer-core skin-dot ${skin.extraClass}" style="${coreStyle}"></div></div>`;
    }

    // Custom icons (color, pattern or image URL)
    function createMeIcon(visits, lng, isTopScorer, skinId, isSelected) {
      const bandClass = getVisitBandClass(visits);
      const bandNum = getVisitBandNumber(visits);
      const layout = getMeMarkerIconLayout(visits, isTopScorer, isSelected);
      const delay = spawnDelayFromLng(lng);
      const topClass = isTopScorer ? ' top-scorer' : '';
      const selectedClass = isSelected ? ' is-selected' : '';
      const spawnClass = isSelected ? '' : ' marker-spawn';
      const skin = getSkinStyle(skinId);
      const dotStyle = buildMarkerDotInlineStyle(skin, bandNum, delay, isTopScorer);
      const innerHtml = buildMarkerDotHtml('me-dot', skin, dotStyle, isTopScorer, visits, isSelected, delay, true);
      return L.divIcon({
        className: `me-dot-icon is-me-marker ${bandClass}${topClass}${selectedClass}${spawnClass}`,
        html: wrapMeMarkerHtml(innerHtml),
        iconSize: [layout.w, layout.h],
        iconAnchor: [layout.anchor, layout.anchor]
      });
    }

    function getVisitBandClass(visits) {
      if (!visits || visits <= 1) return 'visit-band-1';
      if (visits <= 5) return 'visit-band-2';
      if (visits <= 10) return 'visit-band-3';
      if (visits <= 25) return 'visit-band-4';
      if (visits <= 50) return 'visit-band-5';
      return 'visit-band-6'; // 51-100+
    }

    function getVisitBandNumber(visits) {
      if (!visits || visits <= 1) return 1;
      if (visits <= 5) return 2;
      if (visits <= 10) return 3;
      if (visits <= 25) return 4;
      if (visits <= 50) return 5;
      return 6;
    }

    function createOtherIcon(visits, lng, isTopScorer, skinId, isSelected) {
      const bandClass = getVisitBandClass(visits);
      const bandNum = getVisitBandNumber(visits);
      const size = getMarkerIconSize(visits, isTopScorer, isSelected, false);
      const delay = spawnDelayFromLng(lng);
      const topClass = isTopScorer ? ' top-scorer' : '';
      const selectedClass = isSelected ? ' is-selected' : '';
      const spawnClass = isSelected ? '' : ' marker-spawn';
      const skin = getSkinStyle(skinId);
      const dotStyle = buildMarkerDotInlineStyle(skin, bandNum, delay, isTopScorer);
      return L.divIcon({
        className: `other-dot-icon ${bandClass}${topClass}${selectedClass}${spawnClass}`,
        html: buildMarkerDotHtml('other-dot', skin, dotStyle, isTopScorer, visits, isSelected, delay, false),
        iconSize: [size, size],
        iconAnchor: [size / 2, size / 2]
      });
    }

    function refreshMarkerIcon(playerId) {
      const meta = playerMarkerMeta.get(playerId);
      if (!meta) return;
      const isSelected = selectedPlayerId === playerId;
      const icon = meta.isMe
        ? createMeIcon(meta.visits, meta.lng, meta.isTopScorer, meta.skinId, isSelected)
        : createOtherIcon(meta.visits, meta.lng, meta.isTopScorer, meta.skinId, isSelected);
      const marker = meta.isMe ? userMarker : otherMarkers.get(playerId);
      if (!marker) return;
      marker.setIcon(icon);
      marker.setZIndexOffset(getMarkerZIndexOffset(meta.visits, meta.isMe, isSelected));
      syncMarkerPopup(marker, playerId);
    }

    function setSelectedPlayer(playerId) {
      if (selectedPlayerId === playerId) return;
      const prev = selectedPlayerId;
      selectedPlayerId = playerId;
      if (prev) refreshMarkerIcon(prev);
      if (playerId) refreshMarkerIcon(playerId);
    }

    function clearSelectedPlayer() {
      if (!selectedPlayerId) return;
      const prev = selectedPlayerId;
      selectedPlayerId = null;
      refreshMarkerIcon(prev);
    }

    function bindMarkerSelection(marker, playerId) {
      if (marker._selectionBound) return;
      marker._selectionBound = true;
      marker.on('click', () => {
        setSelectedPlayer(playerId);
        syncMarkerPopup(marker, playerId);
      });
      marker.on('popupopen', () => {
        setSelectedPlayer(playerId);
        syncMarkerPopup(marker, playerId);
      });
      marker.on('popupclose', () => {
        if (selectedPlayerId === playerId) clearSelectedPlayer();
      });
    }

    map.on('click', () => {
      if (map._popup && map._popup.isOpen()) return;
      clearSelectedPlayer();
    });

    let userMarker = null;
    const otherMarkers = new Map(); // id -> marker
    const playerMarkerMeta = new Map(); // id -> { visits, lng, isTopScorer, skinId, isMe }
    let selectedPlayerId = null;
    const userSkinsCache = new Map(); // id -> skin (filled by loadAllPositions, used by leaderboard)
    let currentSkin = (localStorage.getItem('skin') || 'red').trim();
    let myVisits = 1, myLng = 0, amTopScorer = false;

    // Next-point timer: nextPointAt = ISO string (next UTC midnight) or null if available now
    let nextPointAt = null;
    let lastDashboardFetchAt = 0;
    const DASHBOARD_SSE_COOLDOWN_MS = 4000;

    function applyNextPointData(data) {
      if (!data) return;
      nextPointAt = data.nextPointAt != null ? data.nextPointAt : null;
      updateNextPointDisplay();
    }

    function fetchNextPoint() {
      fetchDashboard({ only: 'nextPoint' })
        .then((payload) => {
          if (!payload.unchanged && payload.data && payload.data.nextPoint) {
            applyNextPointData(payload.data.nextPoint);
          }
        })
        .catch(() => {});
    }
    function updateNextPointDisplay() {
      const el = document.getElementById('next-point-timer');
      const countEl = document.getElementById('next-point-countdown');
      if (!el || !countEl) return;
      el.style.display = '';
      if (!nextPointAt) {
        el.classList.add('available');
        countEl.textContent = 'Available now';
        return;
      }
      el.classList.remove('available');
      const target = new Date(nextPointAt).getTime();
      const now = Date.now();
      const ms = Math.max(0, target - now);
      if (ms <= 0) {
        nextPointAt = null;
        fetchNextPoint();
        return;
      }
      const s = Math.floor(ms / 1000) % 60;
      const m = Math.floor(ms / 60000) % 60;
      const h = Math.floor(ms / 3600000);
      countEl.textContent = `${h}h ${m}m ${s}s`;
    }
    setInterval(updateNextPointDisplay, 1000);

    // Send position to server (with skin so everyone sees it)
    function sendPosition(lat, lng) {
      if (!username) return Promise.resolve();
      const anonymous = localStorage.getItem('anonymousLocation') === 'true';
      return fetch('/api/position', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId, lat, lng, username, skin: currentSkin, anonymous }),
      })
        .then((res) => res.json())
        .then((data) => {
          if (data.nextPointAt != null) nextPointAt = data.nextPointAt;
          else nextPointAt = null;
          updateNextPointDisplay();
          lastDashboardFetchAt = Date.now();
          return data;
        });
    }

    function getPopupHtml(name, visits, isMe) {
      const safeName = name || (isMe ? 'Me' : 'Guest');
      const count = !visits || visits < 1 ? 1 : visits;
      const times = count > 1 ? 'TIMES' : 'TIME';
      return `${safeName}<span class="popup-sub">LOST ${count} ${times}</span>`;
    }

    function updateTopBarVisitors(count) {
      const el = document.getElementById('top-bar-visitors');
      if (!el) return;
      if (count == null || count === 0) {
        el.textContent = 'You are one of — simps';
        return;
      }
      el.textContent = count === 1 ? 'You are the only simp' : `You are one of ${count} simps`;
    }

    function minutesAgo(isoDate) {
      if (!isoDate) return '—';
      const then = new Date(isoDate).getTime();
      const now = Date.now();
      const min = Math.floor((now - then) / 60000);
      if (min < 1) return 'Just now';
      if (min === 1) return '1 minute ago';
      return `${min} minutes ago`;
    }

    function renderLastJoined(data) {
      const list = document.getElementById('last-joined-list');
      if (!list) return;
      const users = (data.users || []).slice(0, 3);
      if (users.length === 0) {
        list.innerHTML = '<li class="last-joined-item">No one yet</li>';
        return;
      }
      list.innerHTML = users
        .map(
          (u) =>
            `<li class="last-joined-item"><span class="name">${escapeHtml(u.username || 'Guest')}</span><br><span class="city">${escapeHtml(u.city || '—')}</span> · <span class="time">${minutesAgo(u.updatedAt)}</span></li>`
        )
        .join('');
    }

    function loadLastJoined() {
      fetch('/api/last-joined')
        .then((res) => res.json())
        .then((data) => renderLastJoined(data))
        .catch(() => {
          const list = document.getElementById('last-joined-list');
          if (list) list.innerHTML = '<li class="last-joined-item">—</li>';
        });
    }

    function rankSuffix(n) {
      if (n >= 11 && n <= 13) return n + 'th';
      const d = n % 10;
      if (d === 1) return n + 'st';
      if (d === 2) return n + 'nd';
      if (d === 3) return n + 'rd';
      return n + 'th';
    }

    let lastTopScoresData = null;

    function renderTopScores(data) {
      lastTopScoresData = data;
      const list = document.getElementById('top-scores-list');
      if (!list) return;
      const users = (data.users || []).slice(0, 10);
      const you = data.you || null;
      if (users.length === 0 && !you) {
        list.innerHTML = '<li class="top-scores-item">No scores yet</li>';
        return;
      }
      let html = users
        .map((u, i) => {
          const name = escapeHtml(u.username || 'Guest');
          const isMe = String(u.id) === String(userId);
          const skinFromApi = (u.skin != null && String(u.skin).trim()) ? String(u.skin).trim() : null;
          const skin = skinFromApi || (isMe ? currentSkin : (userSkinsCache.get(u.id) || 'red'));
          const skinStyle = getSkinStyle(skin);
          const dotHtml = skinStyle.style
            ? `<div class="point-dot" style="${skinStyle.style}"></div>`
            : skinStyle.extraClass
              ? `<div class="point-dot ${skinStyle.extraClass}"></div>`
              : `<div class="point-dot" style="background:${getSkinColor(skin)} !important"></div>`;
          const meClass = isMe ? ' is-me' : '';
          return `<li class="top-scores-item${meClass}">${dotHtml}<span class="name">${name}</span><span class="score">${u.score}</span></li>`;
        })
        .join('');
      if (you) {
        const rankStr = rankSuffix(you.rank);
        const youSkin = (you.skin != null && String(you.skin).trim()) ? String(you.skin).trim() : currentSkin;
        const youSkinStyle = getSkinStyle(youSkin || 'red');
        const youPointHtml = youSkinStyle.style
          ? `<div class="point-dot" style="${youSkinStyle.style}"></div>`
          : youSkinStyle.extraClass
            ? `<div class="point-dot ${youSkinStyle.extraClass}"></div>`
            : `<div class="point-dot" style="background:${getSkinColor(youSkin)} !important"></div>`;
        html += `<li class="top-scores-item is-me you-row">${youPointHtml}<span class="name">${escapeHtml(you.username)}</span><span class="rank-label">${rankStr}</span><span class="score">${you.score}</span></li>`;
      }
      list.innerHTML = html;
    }

    function loadTopScores() {
      fetch(`/api/top-scores?userId=${encodeURIComponent(userId)}`)
        .then((res) => res.json())
        .then((data) => renderTopScores(data))
        .catch(() => {
          const list = document.getElementById('top-scores-list');
          if (list) list.innerHTML = '<li class="top-scores-item">—</li>';
        });
    }

    function escapeHtml(s) {
      const div = document.createElement('div');
      div.textContent = s;
      return div.innerHTML;
    }

    const FALLBACK_SYNC_MS = 12 * 60 * 1000; // safety full check every 12 min (often 304)
    let dashboardEtag = null;
    let lastPositionsSync = '';
    let fallbackTimer = null;
    let sseDebounceTimer = null;
    let pendingSse = { p: false, l: false, b: false };
    let mapEventSource = null;

    function renderLeaderboard(data) {
      const list = document.getElementById('leaderboard-list');
      if (!list) return;
      const rows = data.rows || [];
      const you = data.you || null;
      if (rows.length === 0 && !you) {
        list.innerHTML = '<li class="leaderboard-item">No data yet</li>';
        return;
      }
      const youInTop10 = you && rows.some((r) => r.country === you.country);
      let html = rows
        .map((r, i) => {
          const isYou = you && r.country === you.country;
          const cls = isYou ? 'leaderboard-item is-you' : 'leaderboard-item';
          return `<li class="${cls}"><span class="rank">${i + 1}.</span><span>${r.country}</span><span class="count">${r.count}</span></li>`;
        })
        .join('');
      if (you && !youInTop10 && you.country) {
        html += `<li class="leaderboard-item is-you you-row"><span class="rank">You</span><span>${you.country}</span><span class="count">${you.count}</span></li>`;
      }
      list.innerHTML = html;
    }

    function applySkinsPayload(data) {
      if (!data) return false;
      fixedImageSkins = data.fixedImageSkins || [];
      unlockedExternalSkins = data.unlockedExternalSkins || [];
      unlockedHiddenSkins = data.unlockedHiddenSkins || [];
      return true;
    }

    function refreshSkinVisuals() {
      if (typeof renderSkinList === 'function') renderSkinList();
      playerMarkerMeta.forEach((_, id) => refreshMarkerIcon(id));
      if (lastTopScoresData) renderTopScores(lastTopScoresData);
    }

    function applySkinsData(data) {
      if (!applySkinsPayload(data)) return;
      refreshSkinVisuals();
    }

    function applyDashboardData(data, opts) {
      const isFullSync = opts && opts.fullSync;
      const skinsUpdated = data.skins ? applySkinsPayload(data.skins) : false;
      if (data.positions) {
        if (isFullSync || !lastPositionsSync) {
          applyPositionUsers(data.positions, true);
        } else if (data.positions.length) {
          applyPositionUsers(data.positions, false);
        }
      }
      if (data.leaderboard) renderLeaderboard(data.leaderboard);
      if (data.lastJoined) renderLastJoined(data.lastJoined);
      if (data.topScores) renderTopScores(data.topScores);
      if (data.nextPoint) applyNextPointData(data.nextPoint);
      if (skinsUpdated && !data.positions) refreshSkinVisuals();
    }

    function fetchDashboard(opts) {
      const headers = {};
      if (opts.full && dashboardEtag) headers['If-None-Match'] = dashboardEtag;
      const params = new URLSearchParams({ userId });
      if (opts.since) params.set('since', opts.since);
      if (opts.only) params.set('only', opts.only);
      return fetch(`/api/dashboard?${params}`, { headers }).then((res) => {
        if (res.status === 304) {
          lastDashboardFetchAt = Date.now();
          return { res, data: null, unchanged: true };
        }
        if (!res.ok) throw new Error('dashboard fetch failed');
        const maxUpd = res.headers.get('X-Positions-Max-Updated');
        if (maxUpd && maxUpd > lastPositionsSync) lastPositionsSync = maxUpd;
        const etag = res.headers.get('ETag');
        if (etag) dashboardEtag = etag;
        return res.json().then((data) => {
          lastDashboardFetchAt = Date.now();
          return { res, data, unchanged: false };
        });
      });
    }

    function loadPanels() {
      return fetchDashboard({ only: 'panels' })
        .then((payload) => {
          if (!payload.unchanged && payload.data) applyDashboardData(payload.data, {});
        })
        .catch(() => {
          loadLastJoined();
          loadTopScores();
        });
    }

    function sseOnlyParam(flags) {
      const parts = [];
      if (flags.p) parts.push('positions');
      if (flags.l) parts.push('leaderboard');
      if (flags.b) parts.push('panels');
      return parts.join(',');
    }

    function applySseUpdates() {
      if (Date.now() - lastDashboardFetchAt < DASHBOARD_SSE_COOLDOWN_MS) return;
      const flags = { ...pendingSse };
      pendingSse = { p: false, l: false, b: false };
      const only = sseOnlyParam(flags);
      if (!only) return;

      const useDelta = flags.p && lastPositionsSync;
      fetchDashboard({
        since: useDelta ? lastPositionsSync : undefined,
        only
      })
        .then((payload) => {
          if (payload.unchanged || !payload.data) return;
          applyDashboardData(payload.data, {
            fullSync: flags.p && !useDelta
          });
        })
        .catch((err) => console.error('SSE dashboard sync:', err));
    }

    function queueSseUpdate(data) {
      try {
        const flags = typeof data === 'string' ? JSON.parse(data) : data;
        if (flags.p) pendingSse.p = true;
        if (flags.l) pendingSse.l = true;
        if (flags.b) pendingSse.b = true;
      } catch (e) {
        pendingSse.p = true;
        pendingSse.l = true;
        pendingSse.b = true;
      }
      clearTimeout(sseDebounceTimer);
      sseDebounceTimer = setTimeout(applySseUpdates, 150);
    }

    function connectMapEvents() {
      if (mapEventSource) {
        mapEventSource.close();
        mapEventSource = null;
      }
      mapEventSource = new EventSource('/api/events');
      mapEventSource.addEventListener('update', (e) => queueSseUpdate(e.data));
      mapEventSource.onopen = () => {
        if (Date.now() - lastDashboardFetchAt < DASHBOARD_SSE_COOLDOWN_MS) return;
        if (!lastPositionsSync) return;
        fetchDashboard({ since: lastPositionsSync, only: 'positions' })
            .then((payload) => {
              if (!payload.unchanged && payload.data) applyDashboardData(payload.data, {});
            })
            .catch(() => {});
      };
      mapEventSource.onerror = () => {
        // EventSource auto-reconnects; onopen will delta-sync
      };
    }

    function scheduleFallbackSync() {
      if (fallbackTimer) clearInterval(fallbackTimer);
      fallbackTimer = setInterval(() => {
        fetchDashboard({ full: true })
          .then((payload) => {
            if (!payload.unchanged && payload.data) applyDashboardData(payload.data, { fullSync: true });
          })
          .catch(() => {});
      }, FALLBACK_SYNC_MS);
    }

    function recomputeTopScorersFromCache() {
      let maxVisits = 0;
      playerMarkerMeta.forEach((m) => {
        if (m.visits > maxVisits) maxVisits = m.visits;
      });
      const topScorerIds = new Set();
      playerMarkerMeta.forEach((m, id) => {
        if (m.visits === maxVisits) topScorerIds.add(id);
      });
      playerMarkerMeta.forEach((m, id) => {
        const isTopScorer = topScorerIds.has(id);
        if (m.isTopScorer === isTopScorer) return;
        m.isTopScorer = isTopScorer;
        if (m.isMe) amTopScorer = isTopScorer;
        refreshMarkerIcon(id);
      });
    }

    function applySinglePositionUser(u, topScorerIds) {
      const isMe = u.id === userId;
      const key = u.id;
      const skinId = (u.skin && String(u.skin).trim()) || 'red';
      userSkinsCache.set(key, skinId);
      const displayName = u.username || (isMe ? 'Me' : 'Guest');
      const visits = typeof u.visits === 'number' ? u.visits : 1;
      const popupHtml = getPopupHtml(displayName, visits, isMe);
      const isTopScorer = topScorerIds.has(key);
      playerMarkerMeta.set(key, { visits, lng: u.lng, isTopScorer, skinId, isMe });
      const isSelected = selectedPlayerId === key;
      const z = getMarkerZIndexOffset(visits, isMe, isSelected);
      if (isMe) {
        myVisits = visits;
        myLng = u.lng;
        amTopScorer = isTopScorer;
        if (u.anonymousLocation === true || u.anonymousLocation === 't') {
          localStorage.setItem('anonymousLocation', 'true');
        }
        if (u.username && String(u.username).trim()) {
          username = String(u.username).trim().slice(0, 40);
          localStorage.setItem('username', username);
        }
        if (skinId) {
          currentSkin = skinId;
          localStorage.setItem('skin', skinId);
        }
        const meIcon = createMeIcon(visits, u.lng, isTopScorer, skinId, isSelected);
        if (userMarker) {
          userMarker.setLatLng([u.lat, u.lng]);
          userMarker.setPopupContent(popupHtml);
          userMarker.setIcon(meIcon);
          userMarker.setZIndexOffset(z);
          syncMarkerPopup(userMarker, key);
        } else {
          userMarker = L.marker([u.lat, u.lng], { title: displayName, icon: meIcon, zIndexOffset: z })
            .addTo(map);
          bindPlayerPopup(userMarker, popupHtml, visits, isTopScorer, key);
        }
        bindMarkerSelection(userMarker, key);
      } else {
        const icon = createOtherIcon(visits, u.lng, isTopScorer, skinId, isSelected);
        if (otherMarkers.has(key)) {
          const marker = otherMarkers.get(key);
          marker.setLatLng([u.lat, u.lng]);
          marker.setPopupContent(popupHtml);
          marker.setIcon(icon);
          marker.setZIndexOffset(z);
          syncMarkerPopup(marker, key);
        } else {
          const m = L.marker([u.lat, u.lng], { title: displayName, icon, zIndexOffset: z })
            .addTo(map);
          bindPlayerPopup(m, popupHtml, visits, isTopScorer, key);
          otherMarkers.set(key, m);
          bindMarkerSelection(m, key);
        }
      }
    }

    function applyPositionUsers(users, isFullSync) {
      const valid = (users || []).filter((u) => typeof u.lat === 'number' && typeof u.lng === 'number');
      if (!valid.length) return;
      if (isFullSync) {
        updateTopBarVisitors(valid.length);
        const visitsOf = (u) => (typeof u.visits === 'number' ? u.visits : 1);
        const maxVisits = Math.max(...valid.map(visitsOf));
        const topScorerIds = new Set(valid.filter((u) => visitsOf(u) === maxVisits).map((u) => u.id));
        sortPlayersByScoreAsc(valid);
        valid.forEach((u) => applySinglePositionUser(u, topScorerIds));
        if (typeof renderSkinList === 'function') renderSkinList();
      } else {
        const pendingTop = new Set();
        valid.forEach((u) => applySinglePositionUser(u, pendingTop));
        recomputeTopScorersFromCache();
      }
    }

    function loadAllPositions() {
      lastDashboardFetchAt = Date.now();
      fetchDashboard({ full: true })
        .then((payload) => {
          if (payload.unchanged || !payload.data) return;
          applyDashboardData(payload.data, { fullSync: true });
        })
        .catch((err) => {
          console.error('Error while loading dashboard:', err);
        });
    }

    function loadNewPositionsOnly() {
      if (!lastPositionsSync) return;
      fetchDashboard({ since: lastPositionsSync, only: 'positions' })
        .then((payload) => {
          if (payload.unchanged || !payload.data || !payload.data.positions || !payload.data.positions.length) return;
          applyDashboardData(payload.data, {});
        })
        .catch((err) => {
          console.error('Error while loading new positions:', err);
        });
    }

    function loadLeaderboard() {
      fetchDashboard({ only: 'leaderboard' })
        .then((payload) => {
          if (!payload.unchanged && payload.data && payload.data.leaderboard) {
            renderLeaderboard(payload.data.leaderboard);
          }
        })
        .catch(() => {
          const list = document.getElementById('leaderboard-list');
          if (list) list.innerHTML = '<li class="leaderboard-item">—</li>';
        });
    }

    // Get my current position and send it
    function initGeolocationAndSync() {
      if (!('geolocation' in navigator)) {
        alert("Your browser does not support geolocation.");
        loadAllPositions();
        return;
      }

      navigator.geolocation.getCurrentPosition(
        async (pos) => {
          const lat = pos.coords.latitude;
          const lng = pos.coords.longitude;
          try {
            await sendPosition(lat, lng);
          } catch (e) {
            console.error('Error while sending position:', e);
          }
          loadAllPositions();
        },
        (err) => {
          console.error('Geolocation error:', err);
          alert("Unable to get your position (check permissions).");
          loadAllPositions(); // at least see others
        }
      );
    }

    // Name handling: block access until it is defined
    function setupPseudoOverlay() {
      const overlay = document.getElementById('pseudo-overlay');
      const input = document.getElementById('pseudo-input');
      const button = document.getElementById('pseudo-button');
      const error = document.getElementById('pseudo-error');
      const anonymousCheckbox = document.getElementById('pseudo-anonymous');

      function trySetPseudo() {
        const value = (input.value || '').trim();
        if (!value) {
          error.textContent = 'Name is required.';
          return;
        }
        username = value.slice(0, 40);
        localStorage.setItem('username', username);
        if (anonymousCheckbox && anonymousCheckbox.checked) {
          localStorage.setItem('anonymousLocation', 'true');
        } else {
          localStorage.removeItem('anonymousLocation');
        }
        overlay.style.display = 'none';
        error.textContent = '';
        // loadAllPositions() called once in geoloc callback (success or error)
        initGeolocationAndSync();
      }

      button.addEventListener('click', trySetPseudo);
      input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
          trySetPseudo();
        }
      });
    }

    // Global initialization: check if a name is already stored
    function initApp() {
      const stored = localStorage.getItem('username');
      const overlay = document.getElementById('pseudo-overlay');

      setupPseudoOverlay();

      if (stored && stored.trim()) {
        username = stored.trim().slice(0, 40);
        overlay.style.display = 'none';
        // loadAllPositions() called once in geoloc callback (success or error)
        initGeolocationAndSync();
      } else {
        overlay.style.display = 'flex';
      }
    }

    initApp();

    // Leaderboard expandable: click title to open/close
    (function setupLeaderboardToggle() {
      const board = document.getElementById('leaderboard');
      if (!board) return;
      board.addEventListener('click', () => board.classList.toggle('is-collapsed'));
    })();

    // Next point panel: header expands/collapses explanation
    (function setupNextPointPanel() {
      const panel = document.getElementById('next-point-timer');
      if (!panel) return;
      panel.addEventListener('click', () => panel.classList.toggle('is-collapsed'));
    })();

    // Last Submitted: header expands/collapses list
    (function setupLastJoinedToggle() {
      const panel = document.getElementById('last-joined');
      const header = document.getElementById('last-joined-header');
      if (!panel || !header) return;
      header.addEventListener('click', (e) => {
        e.stopPropagation();
        panel.classList.toggle('is-collapsed');
      });
    })();

    // Top scores: header expands/collapses list
    (function setupTopScoresToggle() {
      const panel = document.getElementById('top-scores');
      const header = document.getElementById('top-scores-header');
      if (!panel || !header) return;
      header.addEventListener('click', (e) => {
        e.stopPropagation();
        panel.classList.toggle('is-collapsed');
      });
    })();

    // Mobile stats drawer (Last Submitted + Top scores + Top countries)
    (function setupStatsPanel() {
      const panel = document.getElementById('stats-panel');
      const toggle = document.getElementById('stats-panel-toggle');
      if (!panel || !toggle) return;
      toggle.addEventListener('click', (e) => {
        e.stopPropagation();
        panel.classList.toggle('is-collapsed');
      });
    })();

    // Collapsibles: desktop ouverts par défaut, mobile repliés
    (function setupInitialPanelsState() {
      const isMobile = window.matchMedia && window.matchMedia('(max-width: 768px)').matches;
      const statsPanel = document.getElementById('stats-panel');
      if (statsPanel) {
        if (isMobile) statsPanel.classList.add('is-collapsed');
        else statsPanel.classList.remove('is-collapsed');
      }
      const panels = [
        document.getElementById('leaderboard'),
        document.getElementById('last-joined'),
        document.getElementById('top-scores')
      ];
      panels.forEach((el) => {
        if (!el) return;
        if (isMobile) {
          el.classList.add('is-collapsed');
        } else {
          el.classList.remove('is-collapsed');
        }
      });
      // Next point panel: toujours replié par défaut, même sur PC
      const nextPointPanel = document.getElementById('next-point-timer');
      if (nextPointPanel) nextPointPanel.classList.add('is-collapsed');
    })();

    // Skin panel on the right: list + selection (everyone sees the skin)
    function renderSkinList() {
      const list = document.getElementById('skin-list');
      if (!list) return;
      const score = myVisits;
      let html = '';
      if (amTopScorer) {
        html += `<li class="skin-item-top-scorer"><span class="skin-top-scorer-star">★</span><span class="skin-item-name">#1 · Top score</span></li>`;
      }
      // 1) Skins de base (sans BLACKED)
      html += SKINS.filter((s) => s.id !== 'blacked').map((s) => {
        const active = s.id === currentSkin ? ' is-active' : '';
        const locked = !canUseSkin(s.id, score);
        const lockClass = locked ? ' is-locked' : '';
        const reqLabel = getSkinRequirementLabel(s);
        const reqHtml = reqLabel ? `<span class="skin-item-requirement">${escapeHtml(reqLabel)}</span>` : '';
        const title = reqLabel ? `${s.name} — ${reqLabel}` : s.name;
        let dotStyle = '';
        let dotClass = 'skin-item-dot';
        if (s.type === 'pattern' && s.pattern) {
          dotClass += ` pattern-${s.pattern}`;
        } else {
          dotStyle = s.hex ? ` style="background: ${s.hex}"` : '';
        }
        return `<li class="skin-item${active}${lockClass}" data-skin-id="${escapeHtml(s.id)}" data-locked="${locked}" title="${escapeHtml(title)}"><span class="${dotClass}"${dotStyle}></span><span class="skin-item-name">${escapeHtml(s.name)}</span>${reqHtml}</li>`;
      }).join('');
      // 2) Skins image (Drone, Spiral, etc.)
      fixedImageSkins.forEach((s) => {
        const isPaidLocked = PAID_SKIN_IDS.includes(s.id) && !unlockedExternalSkins.includes(s.id);
        const locked = isPaidLocked;
        const lockClass = locked ? ' is-locked' : '';
        const active = s.id === currentSkin ? ' is-active' : '';
        const dotStyle = ` style="background-image:url(${String(s.imageUrl).replace(/"/g, '&quot;').replace(/'/g, '%27')});background-size:cover;background-color:#334155"`;
        const reqLabel = isPaidLocked ? (PAID_SKIN_LABELS[s.id] || '5 €') : '';
        const reqHtml = reqLabel ? `<span class="skin-item-requirement">${escapeHtml(reqLabel)}</span>` : '';
        const title = reqLabel ? `${s.name} — ${reqLabel}` : s.name;
        html += `<li class="skin-item${active}${lockClass}" data-skin-id="${escapeHtml(s.id)}" data-locked="${locked}" data-external-unlock="${s.id === 'Drone' && locked ? 'drone' : ''}" title="${escapeHtml(title)}"><span class="skin-item-dot"${dotStyle}></span><span class="skin-item-name">${escapeHtml(s.name)}</span>${reqHtml}</li>`;
      });
      // 3) BLACKED tout en bas
      const blacked = SKINS.find((s) => s.id === 'blacked');
      if (blacked) {
        const active = blacked.id === currentSkin ? ' is-active' : '';
        const locked = !canUseSkin(blacked.id, score);
        const lockClass = locked ? ' is-locked' : '';
        const reqLabel = getSkinRequirementLabel(blacked);
        const reqHtml = reqLabel ? `<span class="skin-item-requirement">${escapeHtml(reqLabel)}</span>` : '';
        const title = reqLabel ? `${blacked.name} — ${reqLabel}` : blacked.name;
        let dotStyle = '';
        let dotClass = 'skin-item-dot';
        if (blacked.type === 'pattern' && blacked.pattern) {
          dotClass += ` pattern-${blacked.pattern}`;
        } else {
          dotStyle = blacked.hex ? ` style="background: ${blacked.hex}"` : '';
        }
        html += `<li class="skin-item${active}${lockClass}" data-skin-id="${escapeHtml(blacked.id)}" data-locked="${locked}" title="${escapeHtml(title)}"><span class="${dotClass}"${dotStyle}></span><span class="skin-item-name">${escapeHtml(blacked.name)}</span>${reqHtml}</li>`;
      }
      if (unlockedHiddenSkins.length > 0) {
        html += '<li class="skin-list-divider" aria-hidden="true"></li>';
        unlockedHiddenSkins.forEach((s) => {
          const active = s.id === currentSkin ? ' is-active' : '';
          const dotStyle = ` style="background-image:url(${String(s.imageUrl).replace(/"/g, '&quot;').replace(/'/g, '%27')});background-size:cover;background-color:#334155"`;
          html += `<li class="skin-item${active}" data-skin-id="${escapeHtml(s.id)}" data-locked="false" title="${escapeHtml(s.name)}"><span class="skin-item-dot"${dotStyle}></span><span class="skin-item-name">${escapeHtml(s.name)}</span></li>`;
        });
      }
      list.innerHTML = html;
    }
    function setupSkinPanel() {
      const panel = document.getElementById('skin-panel');
      const toggle = document.getElementById('skin-panel-toggle');
      const list = document.getElementById('skin-list');
      if (!panel || !toggle) return;
      toggle.addEventListener('click', () => panel.classList.toggle('is-collapsed'));
      function refreshSkins() {
        fetchDashboard({ only: 'skins' })
          .then((payload) => {
            if (!payload.unchanged && payload.data && payload.data.skins) applySkinsData(payload.data.skins);
          })
          .catch(() => { fixedImageSkins = []; unlockedExternalSkins = []; unlockedHiddenSkins = []; renderSkinList(); });
      }
      list.addEventListener('click', (e) => {
        const item = e.target.closest('.skin-item');
        if (!item) return;
        const id = item.getAttribute('data-skin-id');
        if (!id) return;
        // Skins payants Throne : lien seulement si pas encore débloqué
        if ((id === 'blacked' || id === 'Spiral') && !canUseSkin(id, myVisits)) {
          window.open('https://www.julie.click/', '_blank');
          return;
        }
        // Drone : flux externe
        if (id === 'Drone' && !unlockedExternalSkins.includes('Drone')) {
          window.open('https://juliemommy.pythonanywhere.com', '_blank');
          setTimeout(function() {
            fetch('/api/unlock-drone', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ userId: userId })
            }).then(function() { refreshSkins(); }).catch(function() { refreshSkins(); });
          }, 20000);
          return;
        }
        if (item.getAttribute('data-locked') === 'true') return;
        const previousSkin = currentSkin;
        currentSkin = id;
        localStorage.setItem('skin', id);
        renderSkinList();
        if (userMarker) userMarker.setIcon(createMeIcon(myVisits, myLng, amTopScorer, currentSkin, selectedPlayerId === userId));
        fetch('/api/set-skin', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ userId, skin: id })
        }).then((res) => {
          if (res.ok) return res.json();
          return res.json().then(() => {
            if (res.status === 403) {
              currentSkin = previousSkin;
              localStorage.setItem('skin', currentSkin);
              renderSkinList();
              if (userMarker) userMarker.setIcon(createMeIcon(myVisits, myLng, amTopScorer, currentSkin, selectedPlayerId === userId));
            }
          }).catch(() => {});
        }).catch(() => {
          // Erreur réseau ou serveur : on garde le nouveau skin en local (pas de revert)
        });
      });
    }
    setupSkinPanel();

    connectMapEvents();
    scheduleFallbackSync();