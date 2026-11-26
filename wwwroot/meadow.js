// PokeVault Meadow: your map (assets/meadow/map.webp) with your walker (assets/meadow/player.png).
//
// Movement works like the GBA games: the map is a 32×32 grid of tiles (tools/meadow-map/tiles.txt) and
// every tile has a permission — walkable, solid, water, tall grass, a dirt edge, or stairs. You move one
// tile at a time in 4 directions; the tile ahead is checked before the step starts; tapping a direction
// turns you in place; dirt edges are hopped over (in any direction) onto the ground beyond. Pokémon live on the same grid and reserve the tile
// they are stepping into, so nothing overlaps (big Pokémon take a 3×3 patch). Only Water types swim.
//
// Pokémon are sized from real Pokédex heights (34 map pixels = 1 metre) and behave according to their
// nature: some battle, some play tag, some nap, some are shy. Sprites: PMD Sprite Collab (CC BY-NC 4.0,
// credited in the card), else Showdown's gen5 sprites, else PokeAPI's.

const ASSETS = '/assets/meadow/';
const POKEAPI = 'https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/';
const LOAD_CONCURRENCY = 8;
const WALK_STEP = 0.27, RUN_STEP = 0.14;     // seconds per tile (GBA: 16 frames walking, 8 with running shoes)
const DIRV = [[0, 1], [-1, 0], [1, 0], [0, -1]];   // down, left, right, up
const FAINT_SECONDS = 10;                         // a Pokémon that loses a battle stays down this long
const PMD_ROW = [0, 6, 2, 4];                      // PMD sheet rows for those directions

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const R = (a, b) => a + Math.random() * (b - a);
const pick = a => a[Math.floor(Math.random() * a.length)];
const canvas2d = (w, h) => { const c = document.createElement('canvas'); c.width = w; c.height = h; return c; };
const px = (g, x, y, w, h, col) => { g.fillStyle = col; g.fillRect(x, y, w, h); };
const norm = s => (s || '').toLowerCase().replace(/[^a-z0-9]/g, '');

function hash(x, y) {
  let h = (Math.imul(x | 0, 374761393) + Math.imul(y | 0, 668265263)) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}
function outline(c, col = '#1e2b2b') {
  const g = c.getContext('2d');
  const { width: w, height: h } = c;
  const src = g.getImageData(0, 0, w, h).data;
  g.fillStyle = col;
  const solid = (x, y) => x >= 0 && y >= 0 && x < w && y < h && src[(y * w + x) * 4 + 3] > 0;
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++)
      if (!solid(x, y) && (solid(x - 1, y) || solid(x + 1, y) || solid(x, y - 1) || solid(x, y + 1))) g.fillRect(x, y, 1, 1);
  return c;
}
function flipped(c) {
  const o = canvas2d(c.width, c.height);
  const g = o.getContext('2d');
  g.translate(c.width, 0); g.scale(-1, 1); g.drawImage(c, 0, 0);
  return o;
}
function eggArt() {
  const c = canvas2d(14, 16);
  const g = c.getContext('2d');
  for (let y = 0; y < 16; y++) {
    const t = (y - 9) / (y < 9 ? 9 : 7);
    const w = Math.round(6.5 * Math.sqrt(Math.max(0, 1 - t * t)));
    px(g, 7 - w, y, w * 2, 1, '#f7f0d2');
  }
  px(g, 4, 5, 3, 2, '#7cc955'); px(g, 8, 9, 3, 3, '#7cc955'); px(g, 3, 11, 2, 2, '#7cc955'); px(g, 5, 2, 2, 1, '#fff');
  return outline(c);
}
function heartArt() {
  const rows = ['.XX.XX.', 'XXXXXXX', 'XXXXXXX', '.XXXXX.', '..XXX..', '...X...'];
  const c = canvas2d(7, 6);
  const g = c.getContext('2d');
  rows.forEach((row, y) => [...row].forEach((ch, x) => { if (ch === 'X') px(g, x, y, 1, 1, y > 3 ? '#d8406e' : '#ff6f9c'); }));
  px(g, 1, 1, 1, 1, '#ffd0e0');
  return c;
}

/* ---------------- Pokémon facts ---------------- */

// Pokédex "height" of these is really body length; roughly how much of it they stand tall.
const SERPENTS = {
  23: 0.45, 24: 0.45, 95: 0.42, 130: 0.5, 147: 0.5, 148: 0.45, 206: 0.6, 208: 0.42, 336: 0.45, 350: 0.42,
  367: 0.5, 368: 0.5, 384: 0.45, 497: 0.55, 718: 0.6, 843: 0.5, 844: 0.45, 890: 0.4, 982: 0.55,
};
const PERSONA = {
  Lonely: 'fierce', Brave: 'fierce', Adamant: 'fierce', Naughty: 'fierce', Bold: 'fierce', Rash: 'fierce',
  Hardy: 'playful', Impish: 'playful', Hasty: 'playful', Jolly: 'playful', Naive: 'playful', Quirky: 'playful',
  Docile: 'calm', Serious: 'calm', Calm: 'calm', Gentle: 'calm', Careful: 'calm',
  Relaxed: 'lazy', Lax: 'lazy', Quiet: 'lazy', Sassy: 'lazy',
  Timid: 'shy', Modest: 'shy', Mild: 'shy', Bashful: 'shy',
};
export const PERSONA_TEXT = {
  fierce: 'Fierce: loves a friendly battle', playful: 'Playful: always up for a game of tag',
  calm: 'Calm: likes a quiet stroll', lazy: 'Laid-back: naps whenever it can', shy: 'Shy: keeps its distance from people',
};
const CHART = {
  Normal: { Rock: .5, Ghost: 0, Steel: .5 },
  Fire: { Fire: .5, Water: .5, Grass: 2, Ice: 2, Bug: 2, Rock: .5, Dragon: .5, Steel: 2 },
  Water: { Fire: 2, Water: .5, Grass: .5, Ground: 2, Rock: 2, Dragon: .5 },
  Electric: { Water: 2, Electric: .5, Grass: .5, Ground: 0, Flying: 2, Dragon: .5 },
  Grass: { Fire: .5, Water: 2, Grass: .5, Poison: .5, Ground: 2, Flying: .5, Bug: .5, Rock: 2, Dragon: .5, Steel: .5 },
  Ice: { Fire: .5, Water: .5, Grass: 2, Ice: .5, Ground: 2, Flying: 2, Dragon: 2, Steel: .5 },
  Fighting: { Normal: 2, Ice: 2, Poison: .5, Flying: .5, Psychic: .5, Bug: .5, Rock: 2, Ghost: 0, Dark: 2, Steel: 2, Fairy: .5 },
  Poison: { Grass: 2, Poison: .5, Ground: .5, Rock: .5, Ghost: .5, Steel: 0, Fairy: 2 },
  Ground: { Fire: 2, Electric: 2, Grass: .5, Poison: 2, Flying: 0, Bug: .5, Rock: 2, Steel: 2 },
  Flying: { Electric: .5, Grass: 2, Fighting: 2, Bug: 2, Rock: .5, Steel: .5 },
  Psychic: { Fighting: 2, Poison: 2, Psychic: .5, Dark: 0, Steel: .5 },
  Bug: { Fire: .5, Grass: 2, Fighting: .5, Poison: .5, Flying: .5, Psychic: 2, Ghost: .5, Dark: 2, Steel: .5, Fairy: .5 },
  Rock: { Fire: 2, Ice: 2, Fighting: .5, Ground: .5, Flying: 2, Bug: 2, Steel: .5 },
  Ghost: { Normal: 0, Psychic: 2, Ghost: 2, Dark: .5 },
  Dragon: { Dragon: 2, Steel: .5, Fairy: 0 },
  Dark: { Fighting: .5, Psychic: 2, Ghost: 2, Dark: .5, Fairy: .5 },
  Steel: { Fire: .5, Water: .5, Electric: .5, Ice: 2, Rock: 2, Steel: .5, Fairy: 2 },
  Fairy: { Fire: .5, Fighting: 2, Poison: .5, Dragon: 2, Dark: 2, Steel: .5 },
};
const TC = {
  Normal: ['#ffffff', '#e8e8dc', '#b8b8a8'], Fire: ['#ff8a2a', '#ffd84a', '#e03a1e'], Water: ['#5ab4ff', '#dff2ff', '#2f7fe0'],
  Electric: ['#ffe94a', '#fffbd0', '#f5b800'], Grass: ['#6fd04a', '#c8f59a', '#2f8f2f'], Ice: ['#a8ecff', '#ffffff', '#5cc8f0'],
  Fighting: ['#ff6a3a', '#ffd2b0', '#c0381e'], Poison: ['#b45ee0', '#e8b8ff', '#7a2fa8'], Ground: ['#d8a35a', '#f0d8a0', '#8a5a2a'],
  Flying: ['#dff0ff', '#ffffff', '#9cc8f0'], Psychic: ['#ff6fb0', '#ffd0e8', '#d03a80'], Bug: ['#a6d43a', '#e8f5a0', '#6a8f1e'],
  Rock: ['#b8a070', '#e0d0a8', '#7a6640'], Ghost: ['#8a6ad8', '#d0c0ff', '#4a3a8a'], Dragon: ['#7a5af0', '#c8b8ff', '#4a2ab0'],
  Dark: ['#6a5050', '#c09090', '#2a1e1e'], Steel: ['#c8d0d8', '#ffffff', '#8a98a8'], Fairy: ['#ff9ad8', '#ffe0f4', '#e060b0'],
};
let movesData = null, movesTask = null;
const movesReady = () => (movesTask ??= fetch('/api/moves').then(r => (r.ok ? r.json() : null)).catch(() => null).then(m => (movesData = m)));

/* ---------------- sprites ---------------- */

function loadImg(url) {
  return new Promise(res => {
    const im = new Image();
    im.crossOrigin = 'anonymous';
    im.onload = () => res(im.naturalWidth ? im : null);
    im.onerror = () => res(null);
    im.src = url;
  });
}
function trim(im) {
  const c = canvas2d(im.naturalWidth, im.naturalHeight);
  const g = c.getContext('2d');
  g.drawImage(im, 0, 0);
  let d;
  try { d = g.getImageData(0, 0, c.width, c.height).data; } catch { return c; }
  let x0 = c.width, y0 = c.height, x1 = -1, y1 = -1;
  for (let y = 0; y < c.height; y++)
    for (let x = 0; x < c.width; x++)
      if (d[(y * c.width + x) * 4 + 3] > 10) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
  if (x1 < 0) return null;
  const o = canvas2d(x1 - x0 + 1, y1 - y0 + 1);
  o.getContext('2d').drawImage(c, x0, y0, o.width, o.height, 0, 0, o.width, o.height);
  return o;
}
async function firstSprite(urls) {
  for (const u of urls) {
    const im = await loadImg(u);
    const t = im && trim(im);
    if (t) return t;
  }
  return null;
}
function matchHeight(c, h) {
  if (!c || Math.abs(c.height - h) <= 2) return c;
  const s = h / c.height;
  const o = canvas2d(Math.max(1, Math.round(c.width * s)), h);
  const g = o.getContext('2d');
  g.imageSmoothingEnabled = false;
  g.drawImage(c, 0, 0, o.width, o.height);
  return o;
}

let pmdIndex = null, pmdChildren = null, pmdIndexTask = null;
function pmdReady() {
  pmdIndexTask ??= fetch('/api/pmd/index').then(r => (r.ok ? r.json() : null)).catch(() => null).then(i => {
    pmdIndex = i;
    pmdChildren = new Map();
    for (const k of Object.keys(i ?? {})) {
      const parts = k.split('/');
      if (parts.length === 2) (pmdChildren.get(parts[0]) ?? pmdChildren.set(parts[0], []).get(parts[0])).push(k);
    }
  });
  return pmdIndexTask;
}
const pmdHas = (k, bit = 1) => ((pmdIndex?.[k]?.[0] ?? 0) & bit) !== 0;
function pmdKey(m) {
  if (!pmdIndex || m.isEgg) return null;
  const dex = String(m.species).padStart(4, '0');
  let base = dex;
  if (m.form > 0) {
    const want = norm(m.formName);
    if (!want) return null;
    base = (pmdChildren.get(dex) ?? []).find(k => {
      const n = norm(pmdIndex[k][1]);
      return n && (n === want || n.startsWith(want) || want.startsWith(n));
    });
    if (!base) return null;
  }
  const isBase = base === dex;
  if (m.gender === 1 && isBase) {
    const fk = `${dex}/0000/${m.shiny ? '0001' : '0000'}/0002`;
    if (pmdHas(fk)) return fk;
  }
  if (m.shiny) {
    const sk = isBase ? `${dex}/0000/0001` : `${base}/0001`;
    return pmdHas(sk) ? sk : null;
  }
  return pmdHas(base) ? base : null;
}
function portraitKey(key) {
  const parts = key.split('/');
  for (let n = parts.length; n >= 1; n--) {
    const k = parts.slice(0, n).join('/');
    if (pmdHas(k, 2)) return k;
  }
  return null;
}
async function pmdDoc(key) {
  try {
    const r = await fetch(`/pmd/sprite/${key}/AnimData.xml`);
    if (!r.ok) return null;
    const doc = new DOMParser().parseFromString(await r.text(), 'application/xml');
    return doc.querySelector('parsererror') ? null : doc;
  } catch { return null; }
}
function animDef(doc, name) {
  const anims = [...doc.querySelectorAll('Anims > Anim')];
  const by = n => anims.find(a => a.querySelector(':scope > Name')?.textContent === n);
  let a = by(name);
  const seen = new Set();
  while (a?.querySelector(':scope > CopyOf') && !seen.has(a.querySelector(':scope > CopyOf').textContent)) {
    const c = a.querySelector(':scope > CopyOf').textContent;
    seen.add(c);
    a = by(c);
  }
  if (!a) return null;
  const num = (s, d = 0) => { const el = a.querySelector(`:scope > ${s}`); return el ? +el.textContent : d; };
  const dur = [...a.querySelectorAll(':scope > Durations > Duration')].map(d => clamp(+d.textContent || 1, 1, 600) / 60);
  const fw = num('FrameWidth'), fh = num('FrameHeight');
  if (!dur.length || fw < 1 || fh < 1 || fw > 512 || fh > 512) return null;
  return { name: a.querySelector(':scope > Name').textContent, fw, fh, dur, hit: num('HitFrame', -1) };
}
async function pmdAnim(key, doc, names) {
  for (const name of names) {
    const def = animDef(doc, name);
    if (!def) continue;
    const [img, sh] = await Promise.all([
      loadImg(`/pmd/sprite/${key}/${def.name}-Anim.png`),
      loadImg(`/pmd/sprite/${key}/${def.name}-Shadow.png`),
    ]);
    if (!img) continue;
    const n = def.dur.length, rows = Math.round(img.naturalHeight / def.fh);
    if (img.naturalWidth !== def.fw * n || (rows !== 1 && rows !== 8)) continue;
    const feet = Array.from({ length: rows * n }, () => [def.fw / 2, def.fh / 2 + 4]);
    if (sh && sh.naturalWidth === img.naturalWidth && sh.naturalHeight === img.naturalHeight) {
      const c = canvas2d(sh.naturalWidth, sh.naturalHeight), g = c.getContext('2d');
      g.drawImage(sh, 0, 0);
      const d = g.getImageData(0, 0, c.width, c.height).data;
      for (let r = 0; r < rows; r++)
        for (let f = 0; f < n; f++) {
          let sx = 0, sy = 0, k = 0;
          for (let y = 0; y < def.fh; y++)
            for (let x = 0; x < def.fw; x++)
              if (d[((r * def.fh + y) * c.width + f * def.fw + x) * 4 + 3] > 0) { sx += x; sy += y; k++; }
          if (k) feet[r * n + f] = [sx / k, sy / k];
        }
    }
    const c = canvas2d(img.naturalWidth, def.fh), g = c.getContext('2d');
    g.drawImage(img, 0, 0);
    const d = g.getImageData(0, 0, c.width, c.height).data;
    let top = def.fh, bottom = 0, left = def.fw, right = 0;
    for (let y = 0; y < def.fh; y++)
      for (let x = 0; x < c.width; x++)
        if (d[(y * c.width + x) * 4 + 3] > 10) {
          const fx = x % def.fw;
          top = Math.min(top, y); bottom = Math.max(bottom, y); left = Math.min(left, fx); right = Math.max(right, fx);
        }
    const [, fy0] = feet[0];
    return {
      img, fw: def.fw, fh: def.fh, rows, dur: def.dur, total: def.dur.reduce((a, b) => a + b, 0), feet,
      bodyH: Math.max(4, bottom - top + 1), width: Math.max(4, right - left + 1), topOff: fy0 - top,
    };
  }
  return null;
}
const EXTRA = {
  sleep: ['Sleep', 'EventSleep', 'Laying'], sit: ['Sit', 'Laying', 'Idle'], eat: ['Eat', 'Nod'],
  attack: ['Attack', 'Strike', 'Swing', 'QuickStrike', 'Double', 'Slam', 'Scratch', 'Bite', 'Punch', 'Kick', 'MultiStrike'],
  special: ['Shoot', 'SpAttack', 'Charge', 'Attack'], hurt: ['Hurt'], faint: ['Faint', 'Laying', 'Sleep', 'Hurt'],
  win: ['Pose', 'Hop', 'Nod', 'Charge'], hop: ['Hop', 'Nod', 'Pose'], look: ['LookUp', 'Idle'],
};
async function loadPmd(key) {
  const doc = await pmdDoc(key);
  if (!doc) return null;
  const [walk, idle] = await Promise.all([pmdAnim(key, doc, ['Walk']), pmdAnim(key, doc, ['Idle'])]);
  if (!walk) return null;
  return { key, doc, anims: { walk, idle: idle ?? walk }, pending: {}, shadow: clamp(+(doc.querySelector('ShadowSize')?.textContent ?? 1), 0, 2) };
}
function ensureAnim(P, kind) {
  if (!P || !EXTRA[kind]) return Promise.resolve(null);
  if (kind in P.anims) return Promise.resolve(P.anims[kind]);
  P.pending[kind] ??= pmdAnim(P.key, P.doc, EXTRA[kind]).catch(() => null).then(a => (P.anims[kind] = a));
  return P.pending[kind];
}
function frameAt(anim, time, loop) {
  const n = anim.dur.length;
  let m = loop ? time % anim.total : Math.min(time, anim.total - 1e-4), f = 0;
  while (f < n - 1 && m >= anim.dur[f]) { m -= anim.dur[f]; f++; }
  return f;
}
async function monSprites(m) {
  if (m.isEgg) { const e = eggArt(); return { still: { front: e, frontR: e, back: e } }; }
  await pmdReady();
  const key = pmdKey(m);
  if (key) {
    const pmd = await loadPmd(key).catch(() => null);
    if (pmd) return { pmd, portrait: portraitKey(key) };
  }
  const ids = [...new Set([m.spriteId, (m.spriteId || '').split('-')[0]].filter(Boolean))];
  const sh = m.shiny ? '-shiny' : '';
  const front = await firstSprite([...ids.map(id => `/sprites/gen5${sh}/${id}.png`), `${POKEAPI}${m.shiny ? 'shiny/' : ''}${m.species}.png`]);
  if (!front) return null;
  const back = matchHeight(await firstSprite([...ids.map(id => `/sprites/gen5-back${sh}/${id}.png`), `${POKEAPI}back/${m.shiny ? 'shiny/' : ''}${m.species}.png`]), front.height);
  return { still: { front, frontR: flipped(front), back: back ?? front } };
}

// Alpha of one pixel of a sprite sheet (for pixel-accurate clicks).
const alphaCache = new WeakMap();
function alphaAt(img, x, y) {
  let a = alphaCache.get(img);
  if (!a) {
    const w = img.naturalWidth ?? img.width, h = img.naturalHeight ?? img.height;
    const c = canvas2d(w, h), g = c.getContext('2d');
    g.drawImage(img, 0, 0);
    try { a = { w, h, d: g.getImageData(0, 0, w, h).data }; } catch { a = { w, h, d: null }; }
    alphaCache.set(img, a);
  }
  if (!a.d) return 255;
  x = Math.floor(x); y = Math.floor(y);
  if (x < 0 || y < 0 || x >= a.w || y >= a.h) return 0;
  return a.d[(y * a.w + x) * 4 + 3];
}

/* ---------------- the map ---------------- */

async function loadMap() {
  const [data, img, player] = await Promise.all([
    fetch(ASSETS + 'map.json').then(r => r.json()), loadImg(ASSETS + 'map.webp'), loadImg(ASSETS + 'player.png'),
  ]);
  if (!img || !player) throw new Error('map pictures are missing');
  const bits = b64 => Uint8Array.from(atob(b64), c => c.charCodeAt(0));
  const M = { ...data, img, playerImg: player, waterBits: bits(data.water) };
  const G = M.grid, C = M.cell;
  M.isWaterPx = (x, y) => {   // pixel-accurate water, for the ripples and streaks only
    const cx = Math.floor(x / C), cy = Math.floor(y / C);
    if (cx < 0 || cy < 0 || cx >= G || cy >= G) return false;
    const i = cy * G + cx;
    return ((M.waterBits[i >> 3] >> (i & 7)) & 1) === 1;
  };
  M.waterCells = [];
  for (let cy = 0; cy < G; cy++)
    for (let cx = 0; cx < G; cx++) {
      const x = cx * C + C / 2, y = cy * C + C / 2;
      if (M.isWaterPx(x, y) && !(x > 40 && x < 210 && y < 250)) M.waterCells.push(cy * G + cx);
    }
  // the tile grid
  M.N = M.tileCount; M.TS = M.size / M.N;
  M.tile = (tx, ty) => (tx < 0 || ty < 0 || tx >= M.N || ty >= M.N ? '#' : M.tiles[ty][tx]);
  const segs = [];
  for (const line of M.river) for (let i = 1; i < line.length; i++) segs.push([...line[i - 1], ...line[i]]);
  M.flow = (x, y) => {
    let best = null, bd = 1e9;
    for (const [ax, ay, bx, by] of segs) {
      const dx = bx - ax, dy = by - ay, l2 = dx * dx + dy * dy;
      const t = clamp(((x - ax) * dx + (y - ay) * dy) / l2, 0, 1);
      const d = (ax + dx * t - x) ** 2 + (ay + dy * t - y) ** 2;
      if (d < bd) { bd = d; best = [dx, dy]; }
    }
    const l = Math.hypot(best[0], best[1]) || 1;
    return [best[0] / l, best[1] / l];
  };
  return M;
}

/* ---------------- the meadow ---------------- */

export function createMeadow(container, { onStatus = () => {}, onPick = () => {} } = {}) {
  const canvas = document.createElement('canvas');
  canvas.className = 'meadow-canvas';
  canvas.tabIndex = 0;
  container.prepend(canvas);
  const ctx = canvas.getContext('2d');
  const HEART = heartArt();

  let M = null, N = 32, TS = 39.19, PXM = 34;
  const ready = loadMap().then(m => { M = m; setup(); return m; });
  ready.catch(e => onStatus('Couldn’t load the map: ' + (e.message ?? e)));
  movesReady();

  let cw = 1, ch = 1, dpr = 1, zoom = 0;
  try { zoom = +localStorage.getItem('pv.meadowZoom2') || 0; } catch { /* ignore */ }
  const cam = { x: 627, y: 600 };
  let shake = 0, t = 0;

  /* ----- time of day: follows your PC's clock ----- */
  // Day 07:00–17:00 · sunset glow 17:00–18:30 · dusk into night 18:30–20:00 · night 20:00–05:00 ·
  // dawn 05:00–07:00 (night → pink-orange glow → day). Changes are gradual, minute by minute.
  let timeName = 'day', light = { eve: 0, night: 0 }, clockOverride = null;
  let live = null;   // live weather where you are (see 'weather and seasons'): its sunrise and sunset set the day
  function lightAt(d) {
    const h = d.getHours() + d.getMinutes() / 60 + d.getSeconds() / 3600;
    let eve = 0, night = 0;
    const sun = live?.sunrise != null && !clockOverride ? live : null;
    if (sun) {                                   // the real sunrise and sunset where you are
      const rise = sun.sunrise, set = sun.sunset;
      if (h < rise - 1 || h >= set + 1.5) night = 1;
      else if (h < rise) { night = rise - h; eve = 1 - night; }
      else if (h < rise + 1) eve = rise + 1 - h;
      else if (h < set - 1) { /* day */ }
      else if (h < set) eve = h - (set - 1);
      else { night = (h - set) / 1.5; eve = 1 - night; }
      return { eve, night, name: night > 0.5 ? 'night' : eve > 0.4 ? 'evening' : 'day' };
    }
    if (h >= 20 || h < 5) night = 1;
    else if (h < 6) { night = 6 - h; eve = h - 5; }
    else if (h < 7) eve = 7 - h;
    else if (h < 17) { /* day */ }
    else if (h < 18.5) eve = (h - 17) / 1.5;
    else { night = (h - 18.5) / 1.5; eve = 1 - night; }
    return { eve, night, name: night > 0.5 ? 'night' : eve > 0.4 ? 'evening' : 'day' };
  }
  const hud = container.querySelector('.meadow-hud');
  const ic = n => `<svg class="i" aria-hidden="true"><use href="#i-${n}"/></svg>`;
  const clock = document.createElement('div');
  clock.className = 'meadow-clock';
  clock.title = 'Time in the Meadow follows your PC’s clock';
  hud?.append(clock);
  let lastClock = '';
  function updateLight() {
    const now = clockOverride ?? new Date();
    light = lightAt(now);
    timeName = light.name;
    const text = now.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
    const key = text + timeName;
    if (key !== lastClock) {
      lastClock = key;
      clock.innerHTML = `${ic(timeName === 'night' ? 'moon' : timeName === 'evening' ? 'sunset' : 'sun')}<span>${text}</span>`;
    }
  }
  updateLight();
  setInterval(updateLight, 5000);

  /* ----- weather and seasons ----- */
  // Seasons follow the real calendar and weather changes every few minutes (both "Auto"), or you pick them
  // in the HUD. Each season recolours the map once (autumn leaves, winter frost…); weather is drawn on top.
  const WEATHERS = { clear: ['☀️', 'Clear'], cloudy: ['☁️', 'Cloudy'], rain: ['🌧️', 'Rain'], storm: ['⛈️', 'Storm'], snow: ['❄️', 'Snow'] };
  const SEASONS = { spring: ['🌸', 'Spring'], summer: ['🌻', 'Summer'], autumn: ['🍂', 'Autumn'], winter: ['⛄', 'Winter'] };
  // Live weather: the real weather where you are, from Open-Meteo (free, no account needed). The place is
  // kept only on this PC, and sent to Open-Meteo just to look up its weather.
  let place = null;
  try { place = JSON.parse(localStorage.getItem('pv.meadowPlace') || 'null'); } catch { /* ignore */ }
  let weatherPick = place ? 'live' : 'auto', seasonPick = 'auto', autoWeather = 'clear', nextWeatherAt = 0;
  try { weatherPick = localStorage.getItem('pv.meadowWeather') || weatherPick; seasonPick = localStorage.getItem('pv.meadowSeason') || 'auto'; } catch { /* ignore */ }
  // WMO weather codes → the Meadow's kinds of weather
  const fromWmo = c => (c <= 1 ? 'clear' : c <= 3 || c === 45 || c === 48 ? 'cloudy' : (c >= 71 && c <= 77) || c === 85 || c === 86 ? 'snow' : c >= 95 ? 'storm' : 'rain');
  const hoursOf = iso => { const d = new Date(iso); return d.getHours() + d.getMinutes() / 60; };
  async function fetchLive() {
    if (!place) return;
    try {
      const u = `https://api.open-meteo.com/v1/forecast?latitude=${place.lat.toFixed(3)}&longitude=${place.lon.toFixed(3)}`
        + '&current=weather_code,temperature_2m,is_day&daily=sunrise,sunset&forecast_days=1&timezone=auto';
      const r = await fetch(u);
      if (!r.ok) throw new Error(String(r.status));
      const j = await r.json();
      live = { weather: fromWmo(j.current.weather_code), temp: Math.round(j.current.temperature_2m),
        sunrise: hoursOf(j.daily.sunrise[0]), sunset: hoursOf(j.daily.sunset[0]), at: Date.now() };
      liveError = '';
    } catch { liveError = 'Couldn’t reach the weather service (offline?).'; }
    updateLight(); renderWeatherUi?.();
  }
  let liveError = '';
  setInterval(fetchLive, 15 * 60 * 1000);
  const realSeason = () => {
    let m = new Date().getMonth();
    if (place && place.lat < 0) m = (m + 6) % 12;            // southern hemisphere: the seasons are the other way round
    return m >= 2 && m <= 4 ? 'spring' : m >= 5 && m <= 7 ? 'summer' : m >= 8 && m <= 10 ? 'autumn' : 'winter';
  };
  const season = () => (SEASONS[seasonPick] ? seasonPick : realSeason());
  const weather = () => (WEATHERS[weatherPick] ? weatherPick : weatherPick === 'live' && live ? live.weather : autoWeather);
  const WEATHER_ODDS = {
    spring: [['clear', 5], ['cloudy', 3], ['rain', 3], ['storm', 1]], summer: [['clear', 7], ['cloudy', 2], ['rain', 1], ['storm', 1]],
    autumn: [['clear', 4], ['cloudy', 4], ['rain', 3], ['storm', 1]], winter: [['clear', 3], ['cloudy', 3], ['snow', 5]],
  };
  function rollWeather() {
    const odds = WEATHER_ODDS[season()], sum = odds.reduce((a, [, w]) => a + w, 0);
    let r = Math.random() * sum;
    for (const [w, n] of odds) { if ((r -= n) <= 0) { autoWeather = w; break; } }
    nextWeatherAt = t + R(300, 660);
  }
  // How strong each effect is right now (eased, so weather fades in and out).
  const wx = { rain: 0, snow: 0, cloud: 0, storm: 0 };
  let drops = [], flakes = [], flash = 0, nextBolt = 0, rainSnd = null;
  function updateWeather(dt) {
    if ((weatherPick === 'auto' || (weatherPick === 'live' && !live)) && t >= nextWeatherAt) rollWeather();
    const w = weather();
    const goal = { rain: w === 'rain' ? 1 : w === 'storm' ? 1.4 : 0, snow: w === 'snow' ? 1 : 0, cloud: w === 'clear' ? 0 : w === 'cloudy' ? 0.6 : 1, storm: w === 'storm' ? 1 : 0 };
    for (const k in wx) wx[k] += (goal[k] - wx[k]) * Math.min(1, dt * 0.6);
    const wind = windAt();
    const nDrops = Math.round(260 * wx.rain), nFlakes = Math.round(170 * wx.snow);
    while (drops.length < nDrops) drops.push({ x: R(-0.2, 1.1), y: R(-0.2, 1), v: R(1.4, 2.1), l: R(0.03, 0.06) });
    if (drops.length > nDrops) drops.length = nDrops;
    for (const d of drops) { d.y += d.v * dt; d.x += (0.18 + 0.25 * wind) * d.v * dt; if (d.y > 1.05) { d.y = R(-0.2, 0); d.x = R(-0.3, 1); } }
    while (flakes.length < nFlakes) flakes.push({ x: R(0, 1), y: R(-0.1, 1), v: R(0.05, 0.12), s: R(1, 2.6), p: R(0, 6) });
    if (flakes.length > nFlakes) flakes.length = nFlakes;
    for (const f of flakes) { f.y += f.v * dt; f.x += (Math.sin(t * 0.8 + f.p) * 0.02 + 0.015 * wind) * dt; if (f.y > 1.03) { f.y = -0.03; f.x = R(0, 1); } }
    flash = Math.max(0, flash - dt * 2.2);
    if (wx.storm > 0.6 && t > nextBolt) { nextBolt = t + R(7, 18); flash = 1; thunder(); }
    rainSound();
  }
  function thunder() {
    const A = out(); if (!A) return;
    const ch = { c: A.ctx, out: A.master, t: A.ctx.currentTime + R(0.3, 1.2) };
    hiss(ch, { kind: 'lowpass', from: 420, to: 45, dur: 2.6, gain: 0.55, attack: 0.04 });
    hiss(ch, { kind: 'bandpass', from: 900, to: 120, dur: 0.6, gain: 0.25, attack: 0.01 });
  }
  // A soft steady rain, louder in a storm; it stops with the weather or when you leave the Meadow.
  function rainSound() {
    const want = Math.min(1, wx.rain) * 0.16;
    const A = want > 0.004 ? out() : null;
    if (rainSnd && (rainSnd.bus !== bus || !A)) { try { rainSnd.src.stop(); } catch { /* stopped */ } rainSnd = null; }
    if (!A) return;
    if (!rainSnd) {
      const c = A.ctx, src = c.createBufferSource(), f = c.createBiquadFilter(), g = c.createGain();
      src.buffer = noise({ c }); src.loop = true;
      f.type = 'lowpass'; f.frequency.value = 2400; g.gain.value = 0;
      src.connect(f).connect(g).connect(A.master); src.start();
      rainSnd = { src, g, bus };
    }
    rainSnd.g.gain.setTargetAtTime(want, A.ctx.currentTime, 0.4);
  }
  // The map, recoloured for the season (worked out once per season, then kept).
  const seasonMaps = new Map();
  function seasonMap() {
    const sn = season();
    if (sn === 'spring' || !M) return M?.img;
    if (seasonMaps.has(sn)) return seasonMaps.get(sn);
    const W = M.img.naturalWidth || M.img.width, H = M.img.naturalHeight || M.img.height;
    const c = canvas2d(W, H), g = c.getContext('2d', { willReadFrequently: true });
    g.drawImage(M.img, 0, 0);
    let img;
    try { img = g.getImageData(0, 0, W, H); } catch { seasonMaps.set(sn, M.img); return M.img; }
    const d = img.data;
    for (let i = 0; i < d.length; i += 4) {
      const r = d[i], gr = d[i + 1], b = d[i + 2];
      const green = gr > r + 8 && gr > b + 4, water = b > r + 25 && b > gr - 5;
      const px = (i >> 2) % W, py = ((i >> 2) / W) | 0;
      if (sn === 'autumn' && green) {
        // golden everywhere, with soft patches of orange and red (smooth over ~48 px, so no blocky squares)
        const lum = (r + gr + b) / 3, cx = px / 48, cy = py / 48, ix = Math.floor(cx), iy = Math.floor(cy), fx = cx - ix, fy = cy - iy;
        const n = (hash(ix, iy) * (1 - fx) + hash(ix + 1, iy) * fx) * (1 - fy) + (hash(ix, iy + 1) * (1 - fx) + hash(ix + 1, iy + 1) * fx) * fy;
        const warm = n > 0.62 ? (n - 0.62) / 0.38 : 0;          // 0 = golden, 1 = deep orange-red
        const tr = lum * 1.32 + 18, tg = lum * (1.02 - 0.42 * warm), tb = lum * (0.42 - 0.12 * warm);
        const mix = 0.68;
        d[i] = Math.min(255, r + (tr - r) * mix); d[i + 1] = Math.min(255, gr + (tg - gr) * mix); d[i + 2] = Math.min(255, b + (tb - b) * mix);
      } else if (sn === 'winter') {
        const mix = green ? 0.62 : water ? 0.35 : 0.3, lum = (r + gr + b) / 3;
        d[i] = r + (Math.min(255, lum + 120) - r) * mix;
        d[i + 1] = gr + (Math.min(255, lum + 128) - gr) * mix;
        d[i + 2] = b + (Math.min(255, lum + 145) - b) * mix;
      } else if (sn === 'summer' && green) {
        d[i] = Math.min(255, r * 1.04 + 6); d[i + 1] = Math.min(255, gr * 1.08); d[i + 2] = b * 0.9;
      }
    }
    g.putImageData(img, 0, 0);
    seasonMaps.set(sn, c);
    return c;
  }
  // the HUD control: weather + season, each "Auto" or chosen
  const wbtn = document.createElement('button');
  wbtn.type = 'button'; wbtn.className = 'meadow-weather';
  wbtn.title = 'Weather and season';
  const wpanel = document.createElement('div');
  wpanel.className = 'meadow-wpanel card'; wpanel.hidden = true;
  hud?.append(wbtn);
  container.append(wpanel);
  function renderWeatherUi() {
    const w = weather(), sn = season();
    const isLive = weatherPick === 'live' && live;
    wbtn.innerHTML = `<span>${WEATHERS[w][0]}</span><span>${WEATHERS[w][1]}${isLive ? ` · ${live.temp}°` : ''} · ${SEASONS[sn][1]}${isLive ? ` · ${place.name}` : ''}</span>`;
    if (wpanel.hidden) return;
    const chip = (kind, v, label, on, dis = false) => `<button type="button" class="chip ${on ? 'active' : ''}" data-${kind}="${v}" ${dis ? 'disabled' : ''}>${label}</button>`;
    wpanel.innerHTML = `<b>Weather</b><div class="chips">${chip('w', 'live', '📍 Live', weatherPick === 'live', !place)}${chip('w', 'auto', 'Random', weatherPick === 'auto')}${Object.entries(WEATHERS).map(([k, [ico, n]]) => chip('w', k, `${ico} ${n}`, weatherPick === k)).join('')}</div>
      <div class="wp-place">${place
        ? `<span>📍 <b>${place.name}</b>${live ? ` · ${WEATHERS[live.weather][1]}, ${live.temp}° · sunrise ${fmtH(live.sunrise)}, sunset ${fmtH(live.sunset)}` : ' · looking up the weather…'}</span>
           <button type="button" class="chip" data-place="change">Change place</button>`
        : `<span>See the real weather where you are.</span>`}
        <div class="wp-find" ${place ? 'hidden' : ''}><button type="button" class="chip" data-place="here">📍 Use my location</button>
          <input class="field" id="wpCity" placeholder="or type a city" maxlength="60"><button type="button" class="chip" data-place="city">Find</button></div>
        ${liveError ? `<small class="wp-err">${liveError}</small>` : ''}
        <small class="muted">Weather from Open-Meteo. Your place stays on this PC and is only sent to Open-Meteo to look up the weather.</small></div>
      <b>Season</b><div class="chips">${chip('s', 'auto', `Auto (${SEASONS[realSeason()][1]})`, seasonPick === 'auto')}${Object.entries(SEASONS).map(([k, [ico, n]]) => chip('s', k, `${ico} ${n}`, seasonPick === k)).join('')}</div>`;
  }
  const fmtH = h => { const d = new Date(); d.setHours(Math.floor(h), Math.round((h % 1) * 60), 0, 0); return d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }); };
  function setPlace(p) {
    place = p;
    try { localStorage.setItem('pv.meadowPlace', JSON.stringify(p)); } catch { /* ignore */ }
    weatherPick = 'live';
    try { localStorage.setItem('pv.meadowWeather', 'live'); } catch { /* ignore */ }
    live = null; liveError = '';
    seasonMaps.clear();
    renderWeatherUi(); fetchLive();
  }
  async function findPlace(kind) {
    liveError = '';
    if (kind === 'here') {
      if (!navigator.geolocation) { liveError = 'This window can’t get your location. Type a city instead.'; return renderWeatherUi(); }
      navigator.geolocation.getCurrentPosition(
        pos => setPlace({ lat: pos.coords.latitude, lon: pos.coords.longitude, name: 'Your location' }),
        () => { liveError = 'Windows didn’t give a location (Settings › Privacy › Location). Type a city instead.'; renderWeatherUi(); },
        { timeout: 12000, maximumAge: 30 * 60 * 1000 });
      return;
    }
    const q = wpanel.querySelector('#wpCity')?.value.trim();
    if (!q) return;
    try {
      const r = await fetch(`https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(q)}&count=1&language=en&format=json`);
      const j = await r.json();
      const hit = j.results?.[0];
      if (!hit) { liveError = `Couldn’t find “${q}”.`; return renderWeatherUi(); }
      setPlace({ lat: hit.latitude, lon: hit.longitude, name: [hit.name, hit.country_code].filter(Boolean).join(', ') });
    } catch { liveError = 'Couldn’t reach the place search (offline?).'; renderWeatherUi(); }
  }
  wbtn.addEventListener('click', () => { wpanel.hidden = !wpanel.hidden; renderWeatherUi(); });
  wpanel.addEventListener('keydown', e => { if (e.key === 'Enter' && e.target.id === 'wpCity') { e.preventDefault(); findPlace('city'); } e.stopPropagation(); });
  wpanel.addEventListener('click', e => {
    const b = e.target.closest('button'); if (!b) return;
    if (b.dataset.place === 'change') { wpanel.querySelector('.wp-find').hidden = false; return; }
    if (b.dataset.place) return findPlace(b.dataset.place);
    if (b.dataset.w) { weatherPick = b.dataset.w; try { localStorage.setItem('pv.meadowWeather', weatherPick); } catch { /* ignore */ } if (weatherPick === 'auto') rollWeather(); if (weatherPick === 'live') fetchLive(); }
    if (b.dataset.s) { seasonPick = b.dataset.s; try { localStorage.setItem('pv.meadowSeason', seasonPick); } catch { /* ignore */ } }
    window.sfx?.select?.();
    renderWeatherUi();
  });
  renderWeatherUi();
  setInterval(renderWeatherUi, 5000);
  fetchLive();

  /* ----- grid: tiles, reservations, paths ----- */
  const occ = new Map();                       // tile index → whoever stands on (or is stepping into) it
  let reach = new Set();                       // land tiles you can get to from the start
  const feetAt = (tx, ty) => [(tx + 0.5) * TS, (ty + 0.86) * TS];
  const footprint = (e, tx, ty) => {
    if (e.k === 1) return [[tx, ty]];
    const out = [];
    for (let dy = -2; dy <= 0; dy++) for (let dx = -1; dx <= 1; dx++) out.push([tx + dx, ty + dy]);
    return out;
  };
  const okTile = (e, c) => c === '.' || c === 'G' || c === 'S' || (c === '~' && e.swim);
  function canStand(e, tx, ty, ignoreOcc = false) {
    for (const [x, y] of footprint(e, tx, ty)) {
      if (!okTile(e, M.tile(x, y))) return false;
      if (!ignoreOcc && !e.isPlayer) { const o = occ.get(y * N + x); if (o && o !== e) return false; }
    }
    if (!ignoreOcc) {
      if (e.isPlayer) { if (monFeetAt(tx, ty)) return false; }          // you can't walk into a Pokémon…
      else if (feetRow(e, tx, ty).some(([x, y]) => playerOn(x, y))) return false;   // …and they don't walk into you
    }
    return true;
  }
  // You and a Pokémon block each other only on the tile(s) it stands on (the front row of a big one),
  // not its whole picture, so walking around stays easy. Pokémon also block each other on their full patch.
  const feetRow = (e, tx, ty) => (e.k === 1 ? [[tx, ty]] : [[tx - 1, ty], [tx, ty], [tx + 1, ty]]);
  const playerOn = (x, y) => (player.tx === x && player.ty === y) || (!!player.move && player.move.tx === x && player.move.ty === y);
  function monFeetAt(x, y) {
    const o = occ.get(y * N + x);
    if (!o || o.isPlayer) return null;
    return y === o.ty || (o.move && y === o.move.ty) ? o : null;
  }
  // Pokémon reserve tiles so they never overlap each other; you don't reserve any (they check where you are).
  const claim = (e, tx, ty) => { if (e.isPlayer) return; for (const [x, y] of footprint(e, tx, ty)) occ.set(y * N + x, e); };
  const release = (e, tx, ty) => { if (e.isPlayer) return; for (const [x, y] of footprint(e, tx, ty)) if (occ.get(y * N + x) === e) occ.delete(y * N + x); };
  const whoAt = (tx, ty) => occ.get(ty * N + tx) ?? null;

  // Where a step in direction d from (tx, ty) lands: the next tile, or two tiles down over a ledge.
  function stepTarget(e, tx, ty, d) {
    const [dx, dy] = DIRV[d];
    const nx = tx + dx, ny = ty + dy;
    // Hop over a dirt edge ('L') in any direction, or a one-way ledge ('v') downwards; you land on the far side.
    // (Big Pokémon don't hop.)
    const c = M.tile(nx, ny);
    if (e.k === 1 && (c === 'L' || (c === 'v' && d === 0))) return { x: nx + dx, y: ny + dy, hop: true };
    return { x: nx, y: ny, hop: false };
  }
  // Shortest 4-direction path (as a list of directions) to a tile that satisfies goal().
  function findPath(e, goal, maxLen = 40, ignoreOcc = false) {
    const start = e.ty * N + e.tx;
    const prev = new Map([[start, null]]);
    const q = [[e.tx, e.ty, 0]];
    for (let qi = 0; qi < q.length; qi++) {
      const [x, y, len] = q[qi];
      if (qi > 0 && goal(x, y)) {
        const dirs = [];
        let k = y * N + x;
        while (prev.get(k)) { const [pk, d] = prev.get(k); dirs.push(d); k = pk; }
        return dirs.reverse();
      }
      if (len >= maxLen) continue;
      for (let d = 0; d < 4; d++) {
        const s = stepTarget(e, x, y, d);
        const k = s.y * N + s.x;
        if (prev.has(k) || !canStand(e, s.x, s.y, ignoreOcc)) continue;
        prev.set(k, [y * N + x, d]);
        q.push([s.x, s.y, len + 1]);
      }
    }
    return null;
  }

  // Start a one-tile step (or a ledge hop). False if the tile ahead isn't free.
  function tryStep(e, d, dur) {
    e.dir = d;
    const s = stepTarget(e, e.tx, e.ty, d);
    if (!canStand(e, s.x, s.y)) return false;
    claim(e, s.x, s.y);
    e.move = { fx: e.x, fy: e.y, ox: e.tx, oy: e.ty, tx: s.x, ty: s.y, t: 0, dur: s.hop ? dur * 2.2 : dur, hop: s.hop };
    return true;
  }
  function updateMove(e, dt) {
    const m = e.move;
    if (!m) return false;
    m.t += dt;
    const p = Math.min(1, m.t / m.dur);
    const [ex, ey] = feetAt(m.tx, m.ty);
    e.x = m.fx + (ex - m.fx) * p; e.y = m.fy + (ey - m.fy) * p;
    e.lift = m.hop ? Math.sin(p * Math.PI) * TS * 0.6 : 0;
    if (p >= 1) {
      release(e, m.ox, m.oy); claim(e, m.tx, m.ty);
      e.tx = m.tx; e.ty = m.ty; e.move = null; e.lift = 0;
      if (m.hop) { dust(e.x, e.y, 6); if (e.isPlayer) landSound(); }
      if (M.tile(e.tx, e.ty) === 'G') rustle(e.tx, e.ty);
      return true;
    }
    return false;
  }
  function placeAt(e, tx, ty) {
    if (e.placed) release(e, e.tx, e.ty);
    e.tx = tx; e.ty = ty; [e.x, e.y] = feetAt(tx, ty); e.move = null; e.lift = 0; e.placed = true;
    claim(e, tx, ty);
  }

  /* ----- the walker (your sprite) ----- */
  const player = { k: 1, swim: false, tx: 16, ty: 14, x: 0, y: 0, dir: 0, move: null, lift: 0, walk: 0, turnT: 0, bump: 0, path: null, goal: null, isPlayer: true };
  const held = [];                             // direction keys, newest last (GBA: the newest press wins)

  function setup() {
    N = M.N; TS = M.TS; PXM = M.pxPerMeter;
    const sx = Math.floor(M.spawn[0] / TS), sy = Math.floor(M.spawn[1] / TS);
    placeAt(player, sx, sy);
    // every tile you can walk to from the start (ledges one way only)
    reach = new Set([sy * N + sx]);
    const q = [[sx, sy]];
    for (let i = 0; i < q.length; i++) {
      const [x, y] = q[i];
      for (let d = 0; d < 4; d++) {
        const s = stepTarget(player, x, y, d);
        if (!canStand(player, s.x, s.y, true) || reach.has(s.y * N + s.x)) continue;
        reach.add(s.y * N + s.x); q.push([s.x, s.y]);
      }
    }
    const S = canvas2d(16, 40), g = S.getContext('2d');
    for (let i = 0; i < 6; i++) {
      g.fillStyle = `rgba(255,255,255,${(0.25 + hash(i, 4) * 0.5).toFixed(2)})`;
      g.fillRect(Math.floor(hash(i, 5) * 15), Math.floor(hash(i, 6) * 30), 1, 4 + Math.floor(hash(i, 8) * 8));
    }
    fallPattern = ctx.createPattern(S, 'repeat');
    clouds = Array.from({ length: 4 }, (_, i) => ({ x: hash(i, 11) * 1254, y: hash(i, 12) * 1254, r: 140 + hash(i, 13) * 120 }));
    resize();
  }

  /* ----- ambient things ----- */
  let streaks = [], fallStreaks = [], foam = [], leaves = [], sparkles = [], clouds = [];
  const fireflies = Array.from({ length: 60 }, (_, i) => ({ x: hash(i, 1) * 1254, y: hash(i, 2) * 1254, p: hash(i, 3) * 10 }));
  let fallPattern = null;
  const waterSpot = () => {
    const i = pick(M.waterCells), G = M.grid, C = M.cell;
    return [(i % G) * C + R(0, C), Math.floor(i / G) * C + R(0, C)];
  };
  const windAt = () => clamp(0.25 + 0.55 * Math.max(0, Math.sin(t * 0.21) + 0.6 * Math.sin(t * 0.53 + 1.3)), 0.1, 1);

  function updateAmbient(dt) {
    const wind = windAt();
    while (streaks.length < 260) { const [x, y] = waterSpot(), max = R(1.2, 2.6); streaks.push({ x, y, life: R(0, max), max, len: R(3, 8), sp: R(16, 30) }); }
    for (const s of streaks) {
      const [fx, fy] = M.flow(s.x, s.y);
      s.x += fx * s.sp * dt; s.y += fy * s.sp * dt; s.fx = fx; s.fy = fy; s.life += dt;
      if (s.life > s.max || !M.isWaterPx(s.x, s.y)) { const [x, y] = waterSpot(); Object.assign(s, { x, y, life: 0 }); }
    }
    while (sparkles.length < 40) { const [x, y] = waterSpot(); sparkles.push({ x, y, life: 0, max: R(0.3, 0.9) }); }
    for (const s of sparkles) { s.life += dt; if (s.life > s.max) { const [x, y] = waterSpot(); Object.assign(s, { x, y, life: 0, max: R(0.3, 0.9) }); } }
    const [fall, top] = [M.waterfall.fall, M.waterfall.top];
    while (fallStreaks.length < 70) {
      const upper = fallStreaks.length % 7 === 0;
      fallStreaks.push(upper
        ? { x: R(top[0][0], top[1][0]), y: R(top[0][1], top[2][1]), vx: 40, vy: 60, len: 6, life: 0, max: 0.6, upper }
        : { x: R(fall[0][0] + 2, fall[1][0] - 2), y: R(fall[0][1], fall[2][1]), vx: 0, vy: R(150, 230), len: R(6, 16), life: 0, max: 2 });
    }
    for (const s of fallStreaks) {
      s.x += s.vx * dt; s.y += s.vy * dt; s.life += dt;
      const out = s.upper ? s.x > top[1][0] || s.life > s.max : s.y > fall[2][1] + 4;
      if (out) {
        if (!s.upper) for (let k = 0; k < 2; k++) foam.push({ x: s.x + R(-3, 3), y: fall[2][1] + R(0, 6), vx: R(-40, 40), vy: R(-30, 12), life: 0, max: R(0.5, 1.2), r: R(1.5, 3.5) });
        Object.assign(s, s.upper ? { x: top[0][0], y: R(top[0][1], top[2][1]), life: 0 } : { x: R(fall[0][0] + 2, fall[1][0] - 2), y: fall[0][1] + R(0, 10), life: 0 });
      }
    }
    for (const f of foam) { f.life += dt; f.x += f.vx * dt; f.y += f.vy * dt; f.vx *= 0.96; f.vy = f.vy * 0.96 + 6 * dt; }
    foam = foam.filter(f => f.life < f.max).slice(-160);
    // a few leaves on the wind
    const vw = cw / (zoom * dpr), vh = ch / (zoom * dpr);
    const sn = season();
    const want = sn === 'winter' ? 0 : Math.round((sn === 'autumn' ? 10 : sn === 'spring' ? 8 : 4) + 14 * wind);
    const cols = sn === 'spring' ? ['#f7b6cf', '#f9d3e2', '#ffffff', '#f29ab8'] : sn === 'autumn' ? ['#d8682f', '#e0a13a', '#b8432d', '#e8c14a'] : ['#4fa83a', '#7cc94f', '#d8b44a', '#e08a3a'];
    while (leaves.length < want) leaves.push({ x: cam.x - vw / 2 - R(0, 60), y: cam.y + R(-vh / 2, vh / 2), rot: R(0, 6), vr: R(-4, 4), p: R(0, 6), col: pick(cols) });
    if (leaves.length > want + 6) leaves.length = want;
    for (const l of leaves) { l.x += (22 + 75 * wind) * dt; l.y += (6 + Math.sin(t * 2 + l.p) * 14) * dt; l.rot += l.vr * dt; }
    leaves = leaves.filter(l => l.x < cam.x + vw / 2 + 40 && Math.abs(l.y - cam.y) < vh);
    for (const c of clouds) { c.x += (5 + 10 * wind) * dt; if (c.x - c.r > 1300) c.x = -c.r; }
  }

  function drawWater() {
    ctx.lineWidth = 1;
    for (const s of streaks) {
      const a = Math.sin(Math.PI * s.life / s.max) * 0.5;
      if (a <= 0.02) continue;
      ctx.strokeStyle = `rgba(235,248,255,${a.toFixed(2)})`;
      ctx.beginPath(); ctx.moveTo(s.x, s.y); ctx.lineTo(s.x - (s.fx ?? 1) * s.len, s.y - (s.fy ?? 0) * s.len); ctx.stroke();
    }
    for (const s of sparkles) {
      const a = Math.sin(Math.PI * s.life / s.max);
      ctx.fillStyle = `rgba(255,255,255,${(a * 0.85).toFixed(2)})`;
      ctx.fillRect(s.x - 1, s.y, 3, 1); ctx.fillRect(s.x, s.y - 1, 1, 3);
    }
    for (const [rx, ry] of M.waterRocks) {
      const [fx, fy] = M.flow(rx, ry);
      for (let k = 0; k < 2; k++) {
        const p = ((t * 0.45 + k * 0.5 + hash(rx, ry)) % 1);
        ctx.strokeStyle = `rgba(230,246,255,${(0.55 * (1 - p)).toFixed(2)})`;
        ctx.lineWidth = 1.2;
        ctx.beginPath(); ctx.ellipse(rx + fx * p * 10, ry + 6 + fy * p * 10, 16 + p * 14, (16 + p * 14) * 0.42, 0, 0, Math.PI * 2); ctx.stroke();
      }
    }
    const fall = M.waterfall.fall, top = M.waterfall.top;
    ctx.save();
    ctx.beginPath(); ctx.moveTo(...fall[0]); for (const p of fall.slice(1)) ctx.lineTo(...p); ctx.closePath(); ctx.clip();
    ctx.translate(0, (t * 140) % 40);
    ctx.fillStyle = fallPattern; ctx.fillRect(fall[0][0], fall[0][1] - 40, fall[1][0] - fall[0][0], fall[2][1] - fall[0][1] + 80);
    ctx.restore();
    ctx.save();
    ctx.beginPath(); ctx.moveTo(...top[0]); for (const p of top.slice(1)) ctx.lineTo(...p); ctx.closePath(); ctx.clip();
    ctx.translate((t * 50) % 16, (t * 30) % 40);
    ctx.fillStyle = fallPattern; ctx.fillRect(top[0][0] - 16, top[0][1] - 40, 80, 80);
    ctx.restore();
    for (const s of fallStreaks) {
      ctx.strokeStyle = s.upper ? 'rgba(255,255,255,.55)' : 'rgba(255,255,255,.7)';
      ctx.beginPath(); ctx.moveTo(s.x, s.y); ctx.lineTo(s.x - s.vx * 0.03, s.y - (s.upper ? 3 : s.len)); ctx.stroke();
    }
    for (const f of foam) {
      ctx.fillStyle = `rgba(255,255,255,${(0.85 * (1 - f.life / f.max)).toFixed(2)})`;
      ctx.beginPath(); ctx.arc(f.x, f.y, f.r, 0, Math.PI * 2); ctx.fill();
    }
    const [bx, by, brx] = M.waterfall.basin;
    for (let k = 0; k < 5; k++) {
      const p = (t * 0.25 + k / 5) % 1;
      const mx = bx + Math.sin(k * 2.1 + t * 0.4) * brx * 0.6, my = by - 8 - p * 40, r = 14 + p * 26;
      const gr = ctx.createRadialGradient(mx, my, 0, mx, my, r);
      gr.addColorStop(0, `rgba(255,255,255,${(0.28 * (1 - p)).toFixed(2)})`); gr.addColorStop(1, 'rgba(255,255,255,0)');
      ctx.fillStyle = gr; ctx.fillRect(mx - r, my - r, r * 2, r * 2);
    }
  }

  /* ----- sound: cries and battle sounds, louder the nearer you are ----- */
  // Cries come from the PokeAPI cries collection (cached by the server); move sounds are made here with
  // Web Audio. Everything is placed by distance and side: full volume within ~1.5 tiles, fading to
  // silence at HEAR_TILES, and panned left/right by where it is on screen. The mute button mutes it all.
  const HEAR_TILES = 14;
  const cries = new Map();
  let noiseBuf = null, playingCries = 0;
  // All Meadow sounds go through one channel ("bus"), faded out the moment you leave the Meadow;
  // and nothing new plays while you're on another screen.
  let bus = null;
  function out() {
    if (!active || !window.sfx || window.sfx.muted) return null;
    const A = window.sfx.audio?.();
    if (!A) return null;
    if (!bus || bus.context !== A.ctx) { bus = A.ctx.createGain(); bus.connect(A.master); }
    return { ctx: A.ctx, master: bus };
  }
  function silence() {
    if (!bus) return;
    const b = bus, now = b.context.currentTime;
    bus = null;                                   // new sounds get a fresh channel next time
    b.gain.setValueAtTime(b.gain.value, now);
    b.gain.linearRampToValueAtTime(0, now + 0.15);
    setTimeout(() => { try { b.disconnect(); } catch { /* already gone */ } }, 400);
  }
  function spatial(x, y) {
    const d = Math.hypot(x - player.x, y - player.y) / TS;
    const g = d <= 1.5 ? 1 : clamp(1 - (d - 1.5) / (HEAR_TILES - 1.5), 0, 1) ** 1.7;
    return { gain: g, pan: clamp((x - player.x) / (8 * TS), -0.85, 0.85) };
  }
  // A gain + stereo-pan chain at a spot on the map, or null if it's out of earshot / muted.
  function chainAt(x, y, vol = 1) {
    const A = out();
    if (!A) return null;
    const { gain, pan } = spatial(x, y);
    if (gain < 0.015) return null;
    const c = A.ctx, g = c.createGain(), pn = c.createStereoPanner ? c.createStereoPanner() : null;
    g.gain.value = gain * vol;
    if (pn) { pn.pan.value = pan; g.connect(pn).connect(A.master); } else g.connect(A.master);
    return { c, out: g, t: c.currentTime };
  }
  function cryBuffer(e) {
    const id = e.info.spriteId;
    if (!id || e.info.isEgg) return Promise.resolve(null);
    if (!cries.has(id)) {
      const A = window.sfx?.audio?.();
      cries.set(id, !A ? Promise.resolve(null)
        : fetch(`/cries/${id}.ogg`).then(r => (r.ok ? r.arrayBuffer() : null))
          .then(b => (b ? A.ctx.decodeAudioData(b) : null)).catch(() => null));
      cries.get(id).then(b => { if (!b) cries.delete(id); });   // try again later if it failed
    }
    return cries.get(id);
  }
  // A Pokémon's cry from where it stands. rate < 1 = lower and slower (the fainting cry).
  async function playCry(e, { rate = 1, vol = 1 } = {}) {
    if (e.info.isEgg || (e.cryUntil ?? 0) > t || playingCries >= 4) return;
    const buf = await cryBuffer(e);
    const ch = buf && active && chainAt(e.x, e.y, 0.9 * vol);
    if (!ch) return;
    const src = ch.c.createBufferSource();
    src.buffer = buf; src.playbackRate.value = rate;
    src.connect(ch.out);
    src.start();
    e.cryUntil = t + buf.duration / rate;
    playingCries++;
    src.onended = () => { playingCries--; };
  }
  function noise(ch) {
    if (!noiseBuf || noiseBuf.sampleRate !== ch.c.sampleRate) {
      noiseBuf = ch.c.createBuffer(1, ch.c.sampleRate * 2, ch.c.sampleRate);
      const d = noiseBuf.getChannelData(0);
      for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    }
    return noiseBuf;
  }
  // Building blocks: an enveloped oscillator note and a filtered noise burst.
  function tone(ch, { f, to = null, type = 'sine', at = 0, dur = 0.15, gain = 0.4, attack = 0.005, vib = 0 }) {
    const c = ch.c, st = ch.t + at;
    const o = c.createOscillator(), g = c.createGain();
    o.type = type;
    o.frequency.setValueAtTime(f, st);
    if (to) o.frequency.exponentialRampToValueAtTime(to, st + dur);
    if (vib) { const l = c.createOscillator(), lg = c.createGain(); l.frequency.value = 7; lg.gain.value = vib; l.connect(lg).connect(o.frequency); l.start(st); l.stop(st + dur + 0.05); }
    g.gain.setValueAtTime(0.0001, st);
    g.gain.exponentialRampToValueAtTime(gain, st + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, st + dur);
    o.connect(g).connect(ch.out);
    o.start(st); o.stop(st + dur + 0.05);
  }
  function hiss(ch, { at = 0, dur = 0.2, kind = 'bandpass', from = 1500, to = 600, q = 1, gain = 0.3, attack = 0.005 }) {
    const c = ch.c, st = ch.t + at;
    const src = c.createBufferSource(); src.buffer = noise(ch);
    const f = c.createBiquadFilter(); f.type = kind; f.Q.value = q;
    f.frequency.setValueAtTime(from, st); f.frequency.exponentialRampToValueAtTime(Math.max(20, to), st + dur);
    const g = c.createGain();
    g.gain.setValueAtTime(0.0001, st);
    g.gain.exponentialRampToValueAtTime(gain, st + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, st + dur);
    src.connect(f).connect(g).connect(ch.out);
    src.start(st, Math.random()); src.stop(st + dur + 0.05);
  }
  // Wind-up as a move starts: a whoosh for contact moves, a rising charge for the rest.
  function launchSound(att, type, contact) {
    const ch = chainAt(att.x, att.y, 0.7);
    if (!ch) return;
    if (contact) hiss(ch, { dur: 0.18, from: 700, to: 2600, q: 0.9, gain: 0.35 });
    else tone(ch, { f: 260, to: 900, type: type === 'Electric' ? 'square' : 'triangle', dur: 0.22, gain: type === 'Electric' ? 0.12 : 0.22 });
  }
  // The hit, by move type (louder for super-effective hits, an extra crack for critical hits).
  function impactSound(def, type, eff, crit, contact) {
    if (eff === 0) { const ch = chainAt(def.x, def.y, 0.6); if (ch) tone(ch, { f: 300, to: 180, dur: 0.18, gain: 0.25, type: 'triangle' }); return; }
    const ch = chainAt(def.x, def.y, eff > 1 ? 1.25 : eff < 1 ? 0.75 : 1);
    if (!ch) return;
    const thud = (g = 0.6) => { tone(ch, { f: 170, to: 55, dur: 0.16, gain: g }); hiss(ch, { dur: 0.06, from: 2200, to: 700, gain: 0.25 }); };
    switch (type) {
      case 'Fire':
        hiss(ch, { kind: 'lowpass', dur: 0.5, from: 700, to: 3200, q: 0.7, gain: 0.45, attack: 0.03 });
        for (let i = 0; i < 6; i++) hiss(ch, { at: R(0, 0.4), kind: 'highpass', dur: 0.03, from: 3000, to: 5000, gain: 0.18 });
        break;
      case 'Water':
        hiss(ch, { dur: 0.4, from: 1400, to: 380, q: 1.6, gain: 0.45 });
        [900, 720, 560].forEach((f, i) => tone(ch, { at: 0.05 + i * 0.07, f, to: f * 1.6, dur: 0.06, gain: 0.18 }));
        break;
      case 'Electric':
        for (let i = 0; i < 9; i++) tone(ch, { at: i * 0.035, f: R(250, 1100), type: 'square', dur: 0.03, gain: 0.1 });
        hiss(ch, { kind: 'highpass', dur: 0.3, from: 2500, to: 6000, gain: 0.2 });
        break;
      case 'Grass':
        hiss(ch, { dur: 0.35, from: 4200, to: 2400, q: 1.2, gain: 0.3 });
        tone(ch, { f: 520, to: 380, dur: 0.15, gain: 0.15 });
        break;
      case 'Ice':
        [2093, 2637, 3136, 2794].forEach((f, i) => tone(ch, { at: i * 0.045, f, dur: 0.22, gain: 0.12, type: 'triangle' }));
        hiss(ch, { kind: 'highpass', dur: 0.18, from: 5000, to: 7000, gain: 0.18 });
        break;
      case 'Poison':
        for (let i = 0; i < 5; i++) tone(ch, { at: R(0, 0.3), f: R(250, 420), to: R(600, 900), dur: 0.07, gain: 0.2 });
        break;
      case 'Ground':
        tone(ch, { f: 85, to: 38, dur: 0.6, gain: 0.7 });
        hiss(ch, { kind: 'lowpass', dur: 0.6, from: 400, to: 120, gain: 0.5, attack: 0.02 });
        break;
      case 'Rock':
        thud(0.65);
        for (let i = 0; i < 5; i++) hiss(ch, { at: 0.04 + R(0, 0.25), dur: 0.04, from: 1200, to: 500, q: 2, gain: 0.25 });
        break;
      case 'Flying':
        hiss(ch, { dur: 0.35, from: 500, to: 2600, q: 0.8, gain: 0.4, attack: 0.05 });
        break;
      case 'Psychic':
        tone(ch, { f: 420, dur: 0.5, gain: 0.25, vib: 40, attack: 0.04 });
        tone(ch, { f: 840, dur: 0.45, gain: 0.1, type: 'triangle', vib: 60, attack: 0.04 });
        break;
      case 'Bug':
        tone(ch, { f: 210, dur: 0.32, gain: 0.16, type: 'sawtooth', vib: 25 });
        break;
      case 'Ghost':
        tone(ch, { f: 320, to: 150, dur: 0.6, gain: 0.25, vib: 30, attack: 0.08 });
        hiss(ch, { kind: 'lowpass', dur: 0.5, from: 600, to: 200, gain: 0.2, attack: 0.05 });
        break;
      case 'Dragon':
        tone(ch, { f: 115, to: 70, dur: 0.55, gain: 0.3, type: 'sawtooth', attack: 0.03 });
        hiss(ch, { kind: 'lowpass', dur: 0.5, from: 900, to: 300, gain: 0.3 });
        break;
      case 'Dark':
        thud(0.55);
        tone(ch, { f: 95, to: 60, dur: 0.35, gain: 0.2, type: 'sawtooth' });
        break;
      case 'Steel':
        [523, 1307, 2093, 3170].forEach(f => tone(ch, { f, dur: 0.55, gain: 0.1, type: 'sine' }));
        hiss(ch, { kind: 'highpass', dur: 0.05, from: 3500, to: 5000, gain: 0.25 });
        break;
      case 'Fairy':
        [1318, 1568, 2093, 2637].forEach((f, i) => tone(ch, { at: i * 0.06, f, dur: 0.2, gain: 0.13, type: 'triangle' }));
        break;
      case 'Fighting':
        thud(0.75);
        hiss(ch, { kind: 'highpass', dur: 0.05, from: 2800, to: 4000, gain: 0.3 });
        break;
      default:
        thud(contact ? 0.7 : 0.55);
    }
    if (eff > 1) tone(ch, { at: 0.02, f: 110, to: 45, dur: 0.25, gain: 0.5 });
    if (crit > 1) hiss(ch, { at: 0.01, kind: 'highpass', dur: 0.08, from: 3500, to: 6000, gain: 0.35 });
  }
  // A heavy Pokémon's footstep.
  function stompSound(e) {
    const ch = chainAt(e.x, e.y, clamp(e.weight / 900, 0.25, 0.8));
    if (ch) { tone(ch, { f: 75, to: 40, dur: 0.18, gain: 0.6 }); hiss(ch, { kind: 'lowpass', dur: 0.15, from: 300, to: 100, gain: 0.3 }); }
  }

  // Your own sounds: bumping into things and hopping down a ledge.
  function selfChain(vol) {
    const A = out();
    if (!A) return null;
    const g = A.ctx.createGain();
    g.gain.value = vol;
    g.connect(A.master);
    return { c: A.ctx, out: g, t: A.ctx.currentTime };
  }
  let lastBump = 0;
  function bumpSound() {
    if (t - lastBump < 0.3) return;                         // once per bump, like the GBA "thud"
    lastBump = t;
    const ch = selfChain(0.8);
    if (ch) { tone(ch, { f: 130, to: 70, type: 'square', dur: 0.08, gain: 0.16 }); tone(ch, { f: 65, dur: 0.1, gain: 0.25 }); }
  }
  function hopSound() {
    const ch = selfChain(0.8);
    if (ch) tone(ch, { f: 380, to: 820, type: 'triangle', dur: 0.14, gain: 0.22 });
  }
  function landSound() {
    const ch = selfChain(0.9);
    if (ch) { tone(ch, { f: 150, to: 55, dur: 0.14, gain: 0.45 }); hiss(ch, { kind: 'lowpass', dur: 0.12, from: 900, to: 200, gain: 0.25 }); }
  }

  // Stepping into tall grass sends a few blades flying (nothing is drawn over sprites, so no half-grass patches).
  function rustle(tx, ty) {
    const [x, y] = feetAt(tx, ty);
    for (let k = 0; k < 4; k++) grassBits.push({ x: x + R(-8, 8), y: y - R(2, 10), vx: R(-35, 35), vy: R(-60, -25), life: 0, max: R(0.35, 0.6), rot: R(0, 6) });
  }

  /* ----- Pokémon ----- */
  let mons = [];
  let focused = null, hovered = null;
  const hearts = [], fx = [], shots = [], battles = [], grassBits = [];
  let loadToken = 0, pendingFocus = null;

  function addMon(info, spr) {
    const types = info.types ?? [];
    const heightM = info.isEgg ? 0.45 : Math.max(0.1, (info.heightM || 0.8) * (SERPENTS[info.species] ?? 1));
    const P = spr.pmd ?? null;
    const bodyH = P ? P.anims.walk.bodyH : spr.still.front.height;
    const scale = (heightM * PXM) / bodyH;
    const weight = info.weightKg || 0;
    const v = clamp(0.8 + 0.9 * Math.sqrt(heightM), 0.6, 4) * (weight > 400 ? 0.8 : 1);
    const w = (P ? P.anims.walk.width : spr.still.front.width) * scale;
    const e = {
      info, key: info.key, spr, P, still: spr.still ?? null, scale, heightM, weight, w,
      topOff: (P ? P.anims.walk.topOff : spr.still.front.height) * scale,
      k: w > TS * 1.6 ? 3 : 1,
      swim: !info.isEgg && types.includes('Water'),
      persona: info.isEgg ? 'egg' : PERSONA[info.nature] ?? 'calm',
      stepDur: clamp(TS / (v * PXM), 0.3, 0.85),
      x: 0, y: 0, tx: 0, ty: 0, dir: 0, move: null, lift: 0, path: null, wait: 0,
      state: 'idle', timer: R(0.5, 2.5), phase: R(0, 10), hop: 0, emote: 0, bubble: null, play: null,
      cool: R(10, 40), lunge: null, kb: null, step: 0,
    };
    // a free spot to start on: swimmers mostly in the river, everyone else on reachable land
    const land = [...reach], water = [];
    for (let y = 6; y < N; y++) for (let x = 0; x < N; x++) if (M.tile(x, y) === '~') water.push(y * N + x);
    for (let i = 0; i < 400; i++) {
      const idx = e.swim && Math.random() < 0.6 && water.length ? pick(water) : pick(land);
      const tx = idx % N, ty = Math.floor(idx / N);
      if (!canStand(e, tx, ty) || Math.abs(tx - player.tx) + Math.abs(ty - player.ty) < 4) continue;
      placeAt(e, tx, ty);
      break;
    }
    if (!e.placed) return null;                 // nowhere it fits (a huge Pokémon in a full meadow)
    e.home = { x: e.tx, y: e.ty };
    mons.push(e);
    return e;
  }
  function removeAll() {
    for (const e of mons) { release(e, e.tx, e.ty); if (e.move) release(e, e.move.tx, e.move.ty); }
    mons = [];
  }

  async function setPokemon(list, focusKey) {
    const token = ++loadToken;
    await ready;
    if (token !== loadToken) return;
    for (const b of [...battles]) endBattle(b, true);
    removeAll();
    focused = null; hovered = null; hearts.length = 0; fx.length = 0; shots.length = 0;
    pendingFocus = focusKey ?? null;
    onPick(null);
    if (!list.length) { onStatus('Nobody here yet.'); return; }
    onStatus(`Calling ${list.length} Pokémon…`);
    let next = 0, done = 0, skipped = 0;
    const worker = async () => {
      while (next < list.length) {
        const info = list[next++];
        const spr = await monSprites(info).catch(() => null);
        if (token !== loadToken) return;
        done++;
        if (spr) {
          const e = addMon(info, spr);
          if (!e) skipped++;
          else if (pendingFocus && e.key === pendingFocus) { pendingFocus = null; walkUpTo(e); }
        }
        if (done < list.length) onStatus(`Calling Pokémon… ${done}/${list.length}`);
      }
    };
    await Promise.all(Array.from({ length: LOAD_CONCURRENCY }, worker));
    if (token !== loadToken) return;
    onStatus(mons.length ? `${mons.length} Pokémon are out` + (skipped ? ` (${skipped} too big to fit)` : '') : 'Couldn’t load any sprites (offline?).');
    setTimeout(() => { if (token === loadToken) onStatus(''); }, 4000);
  }

  // Put the walker on a free tile next to a Pokémon, facing it (used when you come from the boxes).
  function walkUpTo(e) {
    const spots = [];
    for (const [dx, dy, d] of [[0, 1, 3], [-1, 0, 2], [1, 0, 1], [0, -1, 0]]) {
      const ex = e.k === 3 ? (dx === 0 ? 0 : dx * 2) : dx, ey = e.k === 3 && dy === -1 ? -3 : dy;
      spots.push([e.tx + ex, e.ty + ey, d]);
    }
    for (const [x, y, d] of spots) {
      if (reach.has(y * N + x) && canStand(player, x, y)) { placeAt(player, x, y); player.dir = d; player.path = null; snapCamera(); greet(e); return; }
    }
    greet(e);
  }

  const name = e => (e.info.isEgg ? 'The Egg' : e.info.nickname || e.info.speciesName);
  const portraits = new Map();
  const portrait = (key, emo) => {
    const k = `${key}/${emo}`;
    if (!portraits.has(k)) portraits.set(k, loadImg(`/pmd/portrait/${key}/${emo}.png`));
    return portraits.get(k);
  };
  async function say(e, emotions, dur = 2.8) {
    if (!e.spr.portrait) { e.emote = 1; return; }
    for (const emo of emotions) {
      const im = await portrait(e.spr.portrait, emo);
      if (im) { e.bubble = { img: im, t: dur }; e.emote = 0; return; }
    }
  }
  function play(e, kind, opts = {}) {
    if (!e.P) return;
    e.playWant = kind;
    const start = a => { if (a && e.playWant === kind) e.play = { kind, start: t, loop: !!opts.loop, hold: !!opts.hold }; };
    if (kind in e.P.anims) start(e.P.anims[kind]);          // already loaded: start right now
    else ensureAnim(e.P, kind).then(start);
  }
  const stopPlay = e => { e.play = null; e.playWant = null; };
  const faceDir = (from, to) => {
    const dx = to.tx - from.tx, dy = to.ty - from.ty;
    return Math.abs(dx) > Math.abs(dy) ? (dx < 0 ? 1 : 2) : (dy < 0 ? 3 : 0);
  };

  function greet(e) {
    if (e.battle) endBattle(e.battle, false);
    focused = e;
    stopPlay(e); e.path = null;
    e.state = 'look'; e.timer = 5; e.hop = 0.7; e.emote = 1.1;
    if (!e.move) e.dir = faceDir(e, player);
    if (!player.move) player.dir = faceDir(player, e);
    window.sfx?.select();
    playCry(e);
    say(e, e.persona === 'shy' ? ['Worried', 'Normal'] : ['Happy', 'Normal']);
    onPick(e.info, {
      key: e.P?.key ?? null,
      portrait: e.spr.portrait ? `/pmd/portrait/${e.spr.portrait}/Normal.png` : null,
      persona: PERSONA_TEXT[e.persona] ?? null,
    });
  }
  function pet(key) {
    const e = mons.find(m => m.key === key);
    if (!e) return;
    e.state = 'look'; e.timer = 4; e.hop = 1;
    for (let i = 0; i < 4; i++) hearts.push({ x: e.x + R(-0.5, 0.5) * Math.max(16, e.w), y: e.y - e.topOff - 6, t: -i * 0.18, vx: R(-8, 8) });
    say(e, ['Joyous', 'Happy', 'Normal']);
    play(e, 'hop');
    playCry(e, { rate: 1.08 });
    window.sfx?.place();
  }

  // Feeding: the berry flies from you to the Pokémon, it eats, then reacts — "love" (its favourite
  // flavour), "like" or "dislike" (decided from its nature by the page).
  const treats = [];
  function feed(key, img, reaction) {
    const e = mons.find(m => m.key === key);
    if (!e || !img) return false;
    if (e.battle) endBattle(e.battle, false);
    stopPlay(e); e.path = null; e.state = 'look'; e.timer = 6;
    treats.push({ img, x0: player.x, y0: player.y - 30, x1: e.x, y1: e.y - Math.min(e.topOff, 40) * 0.5, t: 0, dur: 0.55, e, reaction });
    window.sfx?.select?.();
    return true;
  }
  function updateTreats(dt) {
    for (const tr of treats) {
      tr.t += dt;
      if (tr.t >= tr.dur && !tr.done) {
        tr.done = true;
        const e = tr.e;
        if (!mons.includes(e)) continue;
        play(e, 'eat', { loop: true });
        setTimeout(() => {
          if (!mons.includes(e)) return;
          stopPlay(e);
          const n = tr.reaction === 'love' ? 7 : tr.reaction === 'like' ? 3 : 0;
          for (let i = 0; i < n; i++) hearts.push({ x: e.x + R(-0.5, 0.5) * Math.max(16, e.w), y: e.y - e.topOff - 6, t: -i * 0.15, vx: R(-10, 10) });
          if (tr.reaction === 'dislike') { say(e, ['Sad', 'Worried', 'Normal']); e.kb = { t: 0, dx: 0, dy: -3 }; }
          else { say(e, tr.reaction === 'love' ? ['Joyous', 'Inspired', 'Happy'] : ['Happy', 'Normal']); e.hop = tr.reaction === 'love' ? 1 : 0.5; play(e, 'hop'); playCry(e, { rate: tr.reaction === 'love' ? 1.12 : 1.04 }); }
          e.timer = 3;
        }, 1300);
      }
    }
    for (let i = treats.length - 1; i >= 0; i--) if (treats[i].t > treats[i].dur + 0.05) treats.splice(i, 1);
  }
  function drawTreats() {
    for (const tr of treats) {
      if (tr.t > tr.dur) continue;
      const k = tr.t / tr.dur, x = tr.x0 + (tr.x1 - tr.x0) * k, y = tr.y0 + (tr.y1 - tr.y0) * k - Math.sin(Math.PI * k) * 28;
      ctx.drawImage(tr.img, x - 10, y - 10, 20, 20);
    }
  }

  /* ----- behaviour ----- */
  const busy = e => !!e.battle || ['look', 'chase', 'flee', 'sleep', 'faint'].includes(e.state);
  const manhattan = (a, b) => Math.abs(a.tx - b.tx) + Math.abs(a.ty - b.ty);

  function wanderPath(e, radius, preferGrass) {
    // collect the free tiles within reach, then pick one (shy ones like tall grass, swimmers like water)
    const cands = [];
    const start = e.ty * N + e.tx, seen = new Set([start]), q = [[e.tx, e.ty, 0]];
    for (let i = 0; i < q.length; i++) {
      const [x, y, l] = q[i];
      if (l > 0) cands.push([x, y, l]);
      if (l >= radius) continue;
      for (let d = 0; d < 4; d++) {
        const s = stepTarget(e, x, y, d), k = s.y * N + s.x;
        if (seen.has(k) || !canStand(e, s.x, s.y)) continue;
        if (Math.abs(s.x - e.home.x) + Math.abs(s.y - e.home.y) > radius * 2) continue;
        seen.add(k); q.push([s.x, s.y, l + 1]);
      }
    }
    if (!cands.length) return null;
    let pool = cands;
    if (preferGrass) { const g = cands.filter(([x, y]) => M.tile(x, y) === 'G'); if (g.length) pool = g; }
    if (e.swim) { const w = cands.filter(([x, y]) => M.tile(x, y) === '~'); if (w.length && Math.random() < 0.7) pool = w; }
    const [gx, gy] = pick(pool);
    return findPath(e, (x, y) => x === gx && y === gy, radius + 2);
  }
  function walkPath(e, path, state = 'walk', mul = 1) {
    if (!path || !path.length) return false;
    e.path = path; e.state = state; e.mul = mul; e.wait = 0; stopPlay(e);
    return true;
  }

  // A walkable tile next to something solid (a tree, a rock, a fence): somewhere to shelter from the rain.
  const shelterTile = (x, y) => { const c = M.tile(x, y); return (c === '.' || c === 'G') && [[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dx, dy]) => M.tile(x + dx, y + dy) === '#'); };
  const hasType = (e, ty) => (e.info.types ?? []).includes(ty);
  // Weather moods: Water types play in the rain, Fire types shelter, Ice types love snow, Grass types sunbathe.
  function weatherMood(e, r) {
    e.after = null;                                  // a plan from an earlier, interrupted walk
    const w = weather(), wet = w === 'rain' || w === 'storm';
    if (wet && hasType(e, 'Fire') && r < 0.65) {
      if (shelterTile(e.tx, e.ty)) { sit(e); say(e, ['Worried', 'Sigh', 'Normal']); return true; }
      const p = findPath(e, shelterTile, 14);
      if (walkPath(e, p, 'walk', 1.35)) { e.after = () => { sit(e); say(e, ['Worried', 'Sigh', 'Normal']); }; return true; }
    }
    if (wet && hasType(e, 'Water') && r < 0.55) {
      play(e, 'hop'); say(e, ['Joyous', 'Happy']); e.hop = 0.5;
      if (!walkPath(e, wanderPath(e, 5, false), 'walk', 1.25)) e.timer = R(1.5, 3);
      return true;
    }
    if (w === 'snow' && hasType(e, 'Ice') && r < 0.55) { play(e, 'hop'); say(e, ['Joyous', 'Happy']); e.hop = 0.6; e.timer = R(2, 4); return true; }
    if (w === 'snow' && hasType(e, 'Fire') && r < 0.3) { sit(e); say(e, ['Sigh', 'Normal']); return true; }
    if (w === 'clear' && season() === 'summer' && timeName === 'day' && hasType(e, 'Grass') && r < 0.3) { sit(e); say(e, ['Happy', 'Joyous']); return true; }
    if (w === 'storm' && e.persona === 'shy' && r < 0.5) { if (walkPath(e, wanderPath(e, 4, true), 'flee', 1.4)) { say(e, ['Worried', 'Surprised']); return true; } }
    return false;
  }

  function decide(e) {
    if (e.info.isEgg) { e.timer = R(3, 6); e.hop = Math.random() < 0.3 ? 0.4 : 0; return; }
    const night = timeName === 'night', pr = e.persona, r = Math.random();
    if (weatherMood(e, Math.random())) return;
    if (night && r < (pr === 'lazy' ? 0.7 : 0.45)) return sleep(e);
    if (pr === 'fierce' && e.cool <= 0 && r < 0.4 && startBattle(e)) return;
    if (pr === 'playful') {
      if (r < 0.28 && startChase(e)) return;
      if (r < 0.38 && manhattan(e, player) < 10 && manhattan(e, player) > 2) {   // comes over to say hi
        const p = findPath(e, (x, y) => Math.abs(x - player.tx) + Math.abs(y - player.ty) === 1, 16);
        if (walkPath(e, p, 'walk', 1.3)) { say(e, ['Happy', 'Joyous']); return; }
      }
    }
    if (pr === 'lazy') { if (r < 0.25) return sleep(e); if (r < 0.65) return sit(e); }
    if (pr === 'calm') { if (r < 0.25) return sit(e); if (r < 0.35) { play(e, 'look'); e.timer = R(2, 4); return; } }
    if (r > 0.9) { play(e, 'eat', { loop: true }); e.timer = R(2.5, 4); return; }
    const radius = Math.round(3 + 2 * Math.sqrt(e.heightM));
    if (walkPath(e, wanderPath(e, radius, pr === 'shy'), 'walk', pr === 'calm' ? 0.8 : pr === 'fierce' ? 1.1 : 1)) return;
    e.timer = R(1, 2);
  }
  function sit(e) { e.state = 'sit'; e.timer = R(6, 12); play(e, 'sit', { loop: true }); }
  function sleep(e) { e.state = 'sleep'; e.timer = timeName === 'night' ? R(15, 35) : R(8, 16); play(e, 'sleep', { loop: true }); }

  function startChase(a) {
    const others = mons.filter(b => b !== a && !b.info.isEgg && !busy(b) && b.state !== 'sit' && b.persona !== 'shy' && manhattan(a, b) < 9 && b.swim === a.swim);
    if (!others.length) return false;
    const b = pick(others), until = t + R(8, 13);
    a.state = b.state = 'chase';
    a.chase = { other: b, it: true, until }; b.chase = { other: a, it: false, until };
    a.path = b.path = null;
    stopPlay(a); stopPlay(b);
    say(a, ['Happy', 'Joyous']); say(b, ['Surprised', 'Happy']);
    return true;
  }
  function chaseStep(e) {
    const c = e.chase, o = c.other;
    if (!mons.includes(o) || o.state !== 'chase' || t > c.until) {
      e.chase = null; e.state = 'idle'; e.timer = R(1, 3);
      if (Math.random() < 0.5) say(e, ['Joyous', 'Happy'], 2);
      return;
    }
    if (c.it && manhattan(e, o) <= (e.k + o.k) / 2) {        // tag, you're it
      c.it = false; o.chase.it = true; o.hop = 0.5; e.hop = 0.4;
      if (Math.random() < 0.5) playCry(o, { vol: 0.7, rate: 1.05 });
      say(o, ['Surprised', 'Happy'], 1.6);
      return;
    }
    // the chaser steps toward, the runner steps away (whichever free direction does that best)
    const dirs = [0, 1, 2, 3].sort(() => Math.random() - 0.5);
    let best = null, bestD = c.it ? 1e9 : -1;
    for (const d of dirs) {
      const s = stepTarget(e, e.tx, e.ty, d);
      if (!canStand(e, s.x, s.y)) continue;
      const dd = Math.abs(s.x - o.tx) + Math.abs(s.y - o.ty);
      if (c.it ? dd < bestD : dd > bestD) { bestD = dd; best = d; }
    }
    if (best !== null) tryStep(e, best, e.stepDur * 0.55);
  }

  function updateMon(e, dt) {
    e.hop = Math.max(0, e.hop - dt);
    e.emote = Math.max(0, e.emote - dt);
    e.cool -= dt;
    if (e.bubble && (e.bubble.t -= dt) <= 0) e.bubble = null;
    if (e.kb) { e.kb.t += dt; if (e.kb.t > 0.4) e.kb = null; }
    if (e.lunge) { e.lunge.t += dt; if (e.lunge.t > e.lunge.dur) e.lunge = null; }
    if (e.move) {
      const arrived = updateMove(e, dt);
      if (arrived && e.weight >= 250) {                       // heavy footsteps raise dust (and shake the very heavy)
        dust(e.x, e.y, 4);
        stompSound(e);
        if (e.weight >= 500 && onScreen(e)) shake = Math.max(shake, Math.min(3, e.weight / 400));
      }
      if (!arrived) return;
    }
    if (e.battle) return;                                     // the battle drives it
    if (e.state === 'chase') return chaseStep(e);
    if (e.path?.length) {                                     // follow the path, waiting if someone is in the way
      if (tryStep(e, e.path[0], e.stepDur / (e.mul ?? 1))) { e.path.shift(); e.wait = 0; }
      else if ((e.wait += dt) > 1.2) { e.path = null; e.state = 'idle'; e.timer = R(0.5, 1.5); }
      return;
    }
    if (e.state === 'walk' || e.state === 'flee') {
      e.state = 'idle'; e.timer = e.persona === 'lazy' ? R(3, 7) : R(1.2, 4);
      if (e.after) { const f = e.after; e.after = null; f(); return; }   // e.g. arrived at shelter: sit down
    }
    e.timer -= dt;
    const near = manhattan(e, player);
    switch (e.state) {
      case 'look':
        e.dir = faceDir(e, player);
        if (e.timer <= 0 && focused !== e) { e.state = 'idle'; e.timer = R(1, 2); }
        return;
      case 'sleep':
        if (e.timer <= 0) { stopPlay(e); e.state = 'idle'; e.timer = R(1, 3); }
        return;
      case 'faint':
        if (e.timer <= 0) { stopPlay(e); e.state = 'idle'; e.timer = R(1, 2); e.hop = 0.4; say(e, ['Normal', 'Happy'], 1.6); playCry(e, { vol: 0.6 }); }
        return;
      case 'sit':
        if (e.timer <= 0) { stopPlay(e); e.state = 'idle'; e.timer = R(0.5, 1.5); }
        break;
      case 'idle': {
        const bt = battles.find(b => Math.abs(b.a.tx - e.tx) + Math.abs(b.a.ty - e.ty) < 10);
        if (bt) {
          e.dir = faceDir(e, bt.a);
          if (Math.random() < dt * 0.15) { play(e, 'hop'); say(e, ['Inspired', 'Happy', 'Surprised'], 1.6); }
        } else if (near <= 2) e.dir = faceDir(e, player);
        if (t > (e.nextCry ??= t + R(10, 50))) { e.nextCry = t + R(25, 70); playCry(e, { vol: 0.75 }); }
        if (e.timer <= 0) { stopPlay(e); decide(e); }
        break;
      }
    }
    // shy ones back away when you come close
    if (e.persona === 'shy' && near <= 2 && e.state !== 'sleep') {
      let far = null;
      const p = findPath(e, (x, y) => { const d = Math.abs(x - player.tx) + Math.abs(y - player.ty); if (d >= 5) { far = [x, y]; return true; } return false; }, 8);
      if (walkPath(e, p, 'flee', 1.5) && Math.random() < 0.4) say(e, ['Worried', 'Surprised'], 1.8);
    }
  }

  /* ----- friendly battles ----- */
  function usableMoves(e) {
    const list = (e.info.moves ?? []).filter(m => m.name && m.type && !/^\(?none\)?$|^—$/i.test(m.name));
    const data = m => movesData?.[norm(m.name)];
    const damaging = list.filter(m => (data(m)?.[0] ?? 'Physical') !== 'Status');
    return { damaging: damaging.length ? damaging : [{ name: 'Tackle', type: 'Normal' }], status: list.filter(m => data(m)?.[0] === 'Status') };
  }
  function startBattle(a) {
    if (battles.length >= 2 || a.info.isEgg) return false;
    const cands = mons.filter(b => b !== a && !b.info.isEgg && !busy(b) && b.cool <= 0 && b.state !== 'sit' && manhattan(a, b) < 10)
      .sort((p, q) => manhattan(a, p) - manhattan(a, q));
    for (const b of cands.slice(0, 3)) {
      // two tiles in a row with room between them (more room for big Pokémon), both reachable
      const gap = 1 + (a.k === 3 ? 1 : 0) + (b.k === 3 ? 1 : 0);
      const mx = Math.round((a.tx + b.tx) / 2), my = Math.round((a.ty + b.ty) / 2);
      for (let r = 0; r <= 4; r++)
        for (let oy = -r; oy <= r; oy++)
          for (let ox = -r; ox <= r; ox++) {
            if (Math.max(Math.abs(ox), Math.abs(oy)) !== r) continue;
            const ax = mx + ox - Math.ceil(gap / 2), ay = my + oy, bx = ax + gap + 1, by = ay;
            if (!canStand(a, ax, ay, true) || !canStand(b, bx, by, true)) continue;
            const pa = a.tx === ax && a.ty === ay ? [] : findPath(a, (x, y) => x === ax && y === ay, 20);
            const pb = b.tx === bx && b.ty === by ? [] : findPath(b, (x, y) => x === bx && y === by, 20);
            if (!pa || !pb) continue;
            const battle = { a, b, phase: 'approach', clock: 0, events: [], hp: new Map([[a, 1], [b, 1]]), shown: new Map([[a, 1], [b, 1]]), caption: null, spot: [[ax, ay], [bx, by]] };
            a.battle = b.battle = battle;
            for (const e of [a, b]) {
              stopPlay(e); e.state = 'battle';
              for (const k of ['attack', 'special', 'hurt', 'faint', 'win']) ensureAnim(e.P, k);
            }
            a.path = pa; b.path = pb;
            battles.push(battle);
            say(a, ['Determined', 'Angry', 'Normal'], 2);
            playCry(a);
            return true;
          }
    }
    return false;
  }
  const at = (bt, delay, fn) => bt.events.push({ time: bt.clock + delay, fn });
  const caption = (bt, text, dur = 1.4) => { bt.caption = { text, t: dur }; };

  function updateBattle(bt, dt) {
    const { a, b } = bt;
    bt.clock += dt;
    if (bt.caption && (bt.caption.t -= dt) <= 0) bt.caption = null;
    for (const [e, v] of bt.hp) bt.shown.set(e, bt.shown.get(e) + (v - bt.shown.get(e)) * Math.min(1, dt * 5));
    if (!mons.includes(a) || !mons.includes(b)) return endBattle(bt, true);
    if (bt.phase === 'approach') {
      for (const e of [a, b]) {
        if (e.move || !e.path?.length) continue;
        if (tryStep(e, e.path[0], e.stepDur)) { e.path.shift(); e.wait = 0; }
        else if ((e.wait = (e.wait ?? 0) + dt) > 2) return endBattle(bt, true);
      }
      const there = (e, [x, y]) => !e.move && e.tx === x && e.ty === y;
      if (there(a, bt.spot[0]) && there(b, bt.spot[1])) {
        bt.phase = 'fight'; bt.clock = 0;
        a.dir = 2; b.dir = 1;                                 // face each other
        say(b, ['Determined', 'Angry', 'Normal'], 2);
        playCry(b);
        caption(bt, `${name(a)} challenged ${name(b)} to a friendly battle!`, 2);
        const first = (a.info.stats?.[5] ?? 0) >= (b.info.stats?.[5] ?? 0) ? a : b;
        at(bt, 1.8, () => turn(bt, first));
      } else if (bt.clock > 14) endBattle(bt, true);
      return;
    }
    a.dir = 2; b.dir = 1;
    const due = bt.events.filter(ev => ev.time <= bt.clock);
    bt.events = bt.events.filter(ev => ev.time > bt.clock);
    for (const ev of due) ev.fn();
  }

  function turn(bt, att) {
    if (!battles.includes(bt)) return;
    const def = att === bt.a ? bt.b : bt.a;
    const { damaging, status } = usableMoves(att);
    const useStatus = status.length && Math.random() < 0.15;
    const move = useStatus ? pick(status) : pick(damaging);
    const md = movesData?.[norm(move.name)] ?? ['Physical', 50, 1];
    caption(bt, `${name(att)} used ${move.name}!`);
    if (useStatus) {
      play(att, 'win');
      for (let k = 0; k < 10; k++) at(bt, k * 0.06, () => fx.push({ kind: 'star', x: att.x + R(-att.w / 2, att.w / 2), y: att.y - R(0, att.topOff), vx: 0, vy: -30, life: 0, max: 0.7, size: 3, col: TC[move.type]?.[1] ?? '#fff', g: 0, rot: 0, vr: 0 }));
      at(bt, 1.3, () => caption(bt, `${name(att)} is getting pumped up!`, 1.1));
      at(bt, 2.4, () => turn(bt, def));
      return;
    }
    const physical = md[0] === 'Physical', contact = physical && md[2] === 1;
    const chestA = [att.x, att.y - att.topOff * 0.55], chestD = [def.x, def.y - def.topOff * 0.55];
    if (contact) {
      play(att, 'attack');
      const dx = def.x - att.x, dy = def.y - att.y, d = Math.hypot(dx, dy) || 1;
      att.lunge = { dx: dx / d, dy: dy / d, dist: Math.max(4, d - (att.w + def.w) / 2 - 2), t: 0, dur: 0.42 };
      launchSound(att, move.type, true);
      at(bt, 0.21, () => hit(bt, att, def, move, md));
    } else {
      play(att, physical ? 'attack' : 'special');
      launchSound(att, move.type, false);
      at(bt, 0.18, () => shots.push({ type: move.type, x: chestA[0], y: chestA[1], from: chestA, to: chestD, t: 0, dur: move.type === 'Electric' ? 0.18 : clamp(Math.hypot(def.x - att.x, def.y - att.y) / 220, 0.25, 0.6), done: () => hit(bt, att, def, move, md) }));
    }
  }

  function hit(bt, att, def, move, md) {
    if (!battles.includes(bt)) return;
    const physical = md[0] === 'Physical';
    const power = md[1] || 50;
    const s = att.info.stats ?? [], d = def.info.stats ?? [];
    const A = (physical ? s[1] : s[3]) || 50, D = (physical ? d[2] : d[4]) || 50, HP = d[0] || 100, L = att.info.level || 50;
    let eff = 1;
    for (const ty of def.info.types ?? []) eff *= CHART[move.type]?.[ty] ?? 1;
    const stab = (att.info.types ?? []).includes(move.type) ? 1.5 : 1;
    const crit = Math.random() < 1 / 24 ? 1.5 : 1;
    const dmg = ((2 * L / 5 + 2) * power * A / D / 50 + 2) * stab * eff * crit * R(0.85, 1);
    const frac = eff === 0 ? 0 : Math.max(0.04, dmg / HP);
    burst(move.type, def.x, def.y - def.topOff * 0.55, clamp(def.w / 26, 0.7, 2.6));
    impactSound(def, move.type, eff, crit, physical && md[2] === 1);
    if (eff > 0) {
      play(def, 'hurt');
      const dx = def.x - att.x, dy = def.y - att.y, dd = Math.hypot(dx, dy) || 1;
      const push = clamp(10 * Math.sqrt((att.weight || 20) / (def.weight || 20)), 2, 22);
      def.kb = { dx: dx / dd * push, dy: dy / dd * push, t: 0 };
      if (onScreen(def)) shake = Math.max(shake, clamp(1.2 + (eff > 1 ? 2 : 0) + (att.weight || 0) / 200, 1, 7));
    }
    bt.hp.set(def, Math.max(0, bt.hp.get(def) - frac));
    const notes = [];
    if (crit > 1 && eff > 0) notes.push('A critical hit!');
    if (eff === 0) notes.push(`It doesn’t affect ${name(def)}…`);
    else if (eff > 1) notes.push('It’s super effective!');
    else if (eff < 1) notes.push('It’s not very effective…');
    notes.forEach((n, i) => at(bt, 0.5 + i * 0.9, () => caption(bt, n, 0.9)));
    const later = 0.6 + notes.length * 0.9;
    if (bt.hp.get(def) <= 0) {
      at(bt, later, () => {
        play(def, 'faint', { hold: true });
        def.faintAt = t;
        def.cryUntil = 0; playCry(def, { rate: 0.78 });
        at(bt, 0.9, () => { att.cryUntil = 0; playCry(att); });
        say(def, ['Pain', 'Sad', 'Normal'], 2.6);
        play(att, 'win');
        say(att, ['Joyous', 'Happy', 'Normal'], 2.6);
        caption(bt, `${name(def)} is worn out! ${name(att)} wins!`, 2.6);
      });
      at(bt, later + 3, () => endBattle(bt, false));
    } else {
      at(bt, later + 0.6, () => turn(bt, def));
    }
  }

  function endBattle(bt, quiet) {
    const i = battles.indexOf(bt);
    if (i < 0) return;
    battles.splice(i, 1);
    for (const e of [bt.a, bt.b]) {
      e.battle = null; e.lunge = null; e.kb = null; e.path = null;
      const lost = bt.hp.get(e) <= 0 && !quiet;
      if (lost) {
        // stays down (holding its Faint pose) for 10 s counted from the knockout
        e.state = 'faint';
        e.timer = Math.max(1, FAINT_SECONDS - (t - (e.faintAt ?? t)));
        if (e.play?.kind !== 'faint') play(e, 'faint', { hold: true });
      } else { stopPlay(e); e.state = 'idle'; e.timer = R(1.5, 3); }
      e.cool = R(40, 90);
    }
  }

  /* ----- effects ----- */
  function dust(x, y, n) {
    for (let k = 0; k < n; k++) fx.push({ kind: 'smoke', x: x + R(-8, 8), y: y - 2, vx: R(-14, 14), vy: R(-8, -2), life: 0, max: 0.7, size: 4, col: '210,190,150', g: 0, rot: 0, vr: 0 });
  }
  function burst(type, x, y, s) {
    const [c1, c2, c3] = TC[type] ?? TC.Normal;
    const N2 = Math.round(12 * s);
    const add = p => fx.push(Object.assign({ life: 0, vx: 0, vy: 0, g: 0, rot: R(0, 6), vr: 0, size: 2 }, p));
    add({ kind: 'ring', x, y, max: 0.32, size: 3 * s, grow: 55 * s, col: c2 });
    const radial = (sp, f) => { for (let i = 0; i < N2; i++) { const a = R(0, 6.28), v = R(0.4, 1) * sp * s; f(Math.cos(a) * v, Math.sin(a) * v, i); } };
    switch (type) {
      case 'Fire':
        radial(50, (vx, vy, i) => add({ kind: 'blob', x: x + R(-3, 3) * s, y: y + R(-3, 3) * s, vx, vy: vy - 35 * s, max: R(0.35, 0.75), size: R(2, 4.5) * s, col: [c1, c2, c3][i % 3], shrink: true }));
        for (let i = 0; i < 4; i++) add({ kind: 'smoke', x, y, vx: R(-10, 10), vy: R(-25, -10), max: 0.9, size: 5 * s, col: '60,40,30' });
        break;
      case 'Water':
        radial(90, (vx, vy, i) => add({ kind: 'blob', x, y, vx, vy: vy - 60 * s, g: 280, max: R(0.4, 0.7), size: R(1.5, 3) * s, col: i % 2 ? c1 : c2 }));
        add({ kind: 'ring', x, y: y + 6, max: 0.5, size: 4 * s, grow: 70 * s, col: c1 });
        break;
      case 'Electric':
        for (let i = 0; i < 5; i++) { const a = R(0, 6.28), l = R(12, 26) * s; add({ kind: 'bolt', x, y, x2: x + Math.cos(a) * l, y2: y + Math.sin(a) * l, max: 0.2, col: i % 2 ? c1 : c2 }); }
        radial(110, (vx, vy) => add({ kind: 'spark', x, y, vx, vy, max: 0.25, col: c1 }));
        break;
      case 'Grass':
        radial(65, (vx, vy, i) => add({ kind: 'leaf', x, y, vx, vy, vr: R(-10, 10), g: 30, max: R(0.5, 0.9), size: 3 * s, col: i % 2 ? c1 : c3 }));
        break;
      case 'Ice':
        radial(75, (vx, vy, i) => add({ kind: 'shard', x, y, vx, vy, vr: R(-8, 8), max: R(0.4, 0.7), size: 3.5 * s, col: i % 2 ? c1 : c2 }));
        for (let i = 0; i < 6; i++) add({ kind: 'star', x: x + R(-10, 10) * s, y: y + R(-10, 10) * s, max: 0.5, size: 2.5 * s, col: '#fff' });
        break;
      case 'Poison':
        radial(30, (vx, vy, i) => add({ kind: 'bubble', x: x + R(-6, 6) * s, y, vx, vy: vy - 30, max: R(0.5, 0.9), size: R(1.5, 3.5) * s, col: i % 2 ? c1 : c2 }));
        break;
      case 'Ground': case 'Rock':
        radial(85, (vx, vy, i) => add({ kind: type === 'Rock' ? 'shard' : 'blob', x, y: y + 6, vx, vy: vy - 70 * s, g: 320, vr: R(-6, 6), max: R(0.5, 0.8), size: R(2, 4) * s, col: [c1, c3, c2][i % 3] }));
        for (let i = 0; i < 5; i++) add({ kind: 'smoke', x: x + R(-8, 8) * s, y: y + 8, vx: R(-20, 20), vy: R(-12, -2), max: 0.9, size: 6 * s, col: '200,170,120' });
        break;
      case 'Flying':
        for (let i = 0; i < 4; i++) add({ kind: 'arc', x, y, vx: R(-40, 40), vy: R(-40, 40), vr: R(8, 14) * (i % 2 ? 1 : -1), max: 0.4, size: R(6, 10) * s, col: c2 });
        break;
      case 'Psychic':
        for (let i = 0; i < 3; i++) add({ kind: 'ring', x, y, life: -i * 0.12, max: 0.5, size: 2 * s, grow: 45 * s, col: i % 2 ? c1 : c2 });
        break;
      case 'Bug':
        radial(55, (vx, vy, i) => add({ kind: 'blob', x, y, vx, vy, max: R(0.3, 0.6), size: 1.5 * s, col: i % 2 ? c1 : c3 }));
        break;
      case 'Ghost': case 'Dark':
        for (let i = 0; i < 6; i++) add({ kind: 'smoke', x: x + R(-8, 8) * s, y: y + R(-8, 8) * s, vx: R(-15, 15), vy: R(-20, 0), max: 0.8, size: 5 * s, col: type === 'Ghost' ? '120,90,200' : '40,25,35' });
        radial(70, (vx, vy) => add({ kind: 'spark', x, y, vx, vy, max: 0.25, col: type === 'Ghost' ? c2 : '#ff5a5a' }));
        break;
      case 'Dragon':
        radial(80, (vx, vy, i) => add({ kind: 'spark', x, y, vx: vx - vy * 0.8, vy: vy + vx * 0.8, max: 0.35, col: i % 2 ? c1 : c2 }));
        add({ kind: 'ring', x, y, max: 0.45, size: 6 * s, grow: 40 * s, col: c1 });
        break;
      case 'Steel':
        radial(140, (vx, vy, i) => add({ kind: 'spark', x, y, vx, vy, g: 200, max: R(0.2, 0.4), col: i % 2 ? c1 : '#ffffff' }));
        break;
      case 'Fairy':
        radial(45, (vx, vy, i) => add({ kind: 'star', x, y, vx, vy: vy - 20, max: R(0.5, 0.9), size: R(2, 3.5) * s, col: i % 2 ? c1 : c2 }));
        break;
      default:
        radial(120, (vx, vy) => add({ kind: 'spark', x, y, vx, vy, max: 0.22, col: c1 }));
        add({ kind: 'star', x, y, max: 0.25, size: 9 * s, col: type === 'Fighting' ? c1 : '#ffffff' });
    }
  }
  function updateFx(dt) {
    for (const p of fx) {
      p.life += dt;
      if (p.life < 0) continue;
      p.x += p.vx * dt; p.y += p.vy * dt; p.vy += (p.g ?? 0) * dt; p.rot += (p.vr ?? 0) * dt;
      p.vx *= 0.985; if (!p.g) p.vy *= 0.985;
    }
    for (let i = fx.length - 1; i >= 0; i--) if (fx[i].life > fx[i].max) fx.splice(i, 1);
    for (const s of shots) {
      s.t += dt;
      const p = clamp(s.t / s.dur, 0, 1);
      s.x = s.from[0] + (s.to[0] - s.from[0]) * p;
      s.y = s.from[1] + (s.to[1] - s.from[1]) * p - Math.sin(p * Math.PI) * 6;
      const [c1, c2] = TC[s.type] ?? TC.Normal;
      if (s.type !== 'Electric' && Math.random() < 0.9) fx.push({ kind: 'blob', x: s.x + R(-1.5, 1.5), y: s.y + R(-1.5, 1.5), vx: 0, vy: 0, life: 0, max: 0.25, size: 2.2, col: Math.random() < 0.5 ? c1 : c2, shrink: true, rot: 0, g: 0, vr: 0 });
      if (p >= 1 && !s.hit) { s.hit = true; s.done(); }
    }
    for (let i = shots.length - 1; i >= 0; i--) if (shots[i].hit) shots.splice(i, 1);
    for (const g of grassBits) { g.life += dt; g.x += g.vx * dt; g.y += g.vy * dt; g.vy += 140 * dt; g.rot += 8 * dt; }
    for (let i = grassBits.length - 1; i >= 0; i--) if (grassBits[i].life > grassBits[i].max) grassBits.splice(i, 1);
  }
  function drawFx() {
    for (const p of fx) {
      if (p.life < 0) continue;
      const a = clamp(1 - p.life / p.max, 0, 1);
      ctx.globalAlpha = a;
      switch (p.kind) {
        case 'blob': { const s = p.shrink ? p.size * (0.4 + 0.6 * a) : p.size; ctx.fillStyle = p.col; ctx.fillRect(p.x - s / 2, p.y - s / 2, s, s); break; }
        case 'ring': ctx.strokeStyle = p.col; ctx.lineWidth = Math.max(0.6, 2.2 * a); ctx.beginPath(); ctx.ellipse(p.x, p.y, p.size + p.grow * p.life, (p.size + p.grow * p.life) * 0.7, 0, 0, 6.283); ctx.stroke(); break;
        case 'bolt': {
          ctx.strokeStyle = p.col; ctx.lineWidth = 1.6; ctx.beginPath(); ctx.moveTo(p.x, p.y);
          for (let k = 1; k <= 4; k++) { const f = k / 4; ctx.lineTo(p.x + (p.x2 - p.x) * f + (k < 4 ? R(-3, 3) : 0), p.y + (p.y2 - p.y) * f + (k < 4 ? R(-3, 3) : 0)); }
          ctx.stroke(); break;
        }
        case 'spark': ctx.strokeStyle = p.col; ctx.lineWidth = 1.2; ctx.beginPath(); ctx.moveTo(p.x, p.y); ctx.lineTo(p.x - p.vx * 0.045, p.y - p.vy * 0.045); ctx.stroke(); break;
        case 'leaf': ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(p.rot); ctx.fillStyle = p.col; ctx.fillRect(-p.size / 2, -p.size / 4, p.size, p.size / 2); ctx.restore(); break;
        case 'shard': ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(p.rot); ctx.fillStyle = p.col; ctx.beginPath(); ctx.moveTo(0, -p.size); ctx.lineTo(p.size * 0.45, p.size * 0.6); ctx.lineTo(-p.size * 0.45, p.size * 0.6); ctx.fill(); ctx.restore(); break;
        case 'bubble': ctx.strokeStyle = p.col; ctx.lineWidth = 1; ctx.beginPath(); ctx.arc(p.x, p.y, p.size, 0, 6.283); ctx.stroke(); break;
        case 'smoke': {
          const r = p.size * (1 + p.life * 1.8);
          const gr = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, r);
          gr.addColorStop(0, `rgba(${p.col},${(0.45 * a).toFixed(2)})`); gr.addColorStop(1, `rgba(${p.col},0)`);
          ctx.globalAlpha = 1; ctx.fillStyle = gr; ctx.fillRect(p.x - r, p.y - r, r * 2, r * 2); break;
        }
        case 'arc': ctx.strokeStyle = p.col; ctx.lineWidth = 1.6; ctx.beginPath(); ctx.arc(p.x, p.y, p.size, p.rot, p.rot + 2.2); ctx.stroke(); break;
        case 'star': ctx.fillStyle = p.col; ctx.fillRect(p.x - p.size, p.y - 0.6, p.size * 2, 1.2); ctx.fillRect(p.x - 0.6, p.y - p.size, 1.2, p.size * 2); break;
      }
    }
    ctx.globalAlpha = 1;
    for (const s of shots) {
      const [c1, c2] = TC[s.type] ?? TC.Normal;
      if (s.type === 'Electric') {
        ctx.strokeStyle = c1; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(...s.from);
        for (let k = 1; k <= 7; k++) { const f = k / 7; ctx.lineTo(s.from[0] + (s.to[0] - s.from[0]) * f + (k < 7 ? R(-4, 4) : 0), s.from[1] + (s.to[1] - s.from[1]) * f + (k < 7 ? R(-4, 4) : 0)); }
        ctx.stroke();
        continue;
      }
      const gr = ctx.createRadialGradient(s.x, s.y, 0, s.x, s.y, 7);
      gr.addColorStop(0, '#ffffff'); gr.addColorStop(0.35, c2); gr.addColorStop(1, 'rgba(255,255,255,0)');
      ctx.fillStyle = gr; ctx.fillRect(s.x - 7, s.y - 7, 14, 14);
      ctx.fillStyle = c1; ctx.beginPath(); ctx.arc(s.x, s.y, 2.6, 0, 6.283); ctx.fill();
    }
    for (const g of grassBits) {
      ctx.globalAlpha = clamp(1 - g.life / g.max, 0, 1);
      ctx.save(); ctx.translate(g.x, g.y); ctx.rotate(g.rot); ctx.fillStyle = '#3f9a3a'; ctx.fillRect(-2, -0.6, 4, 1.2); ctx.restore();
    }
    ctx.globalAlpha = 1;
  }

  /* ----- input (GBA-style) ----- */
  let active = false;
  const KEYMAP = { arrowdown: 0, s: 0, arrowleft: 1, a: 1, arrowright: 2, d: 2, arrowup: 3, w: 3 };
  let running = false;
  window.addEventListener('keydown', e => {
    if (!active || e.target.closest?.('input, select, textarea, button') || document.querySelector('dialog[open]')) return;
    const k = e.key.toLowerCase();
    if (k in KEYMAP) {
      e.preventDefault();
      const d = KEYMAP[k];
      if (!held.includes(d)) held.push(d);
      player.path = null; player.goal = null;
    } else if (k === 'shift') running = true;
    else if (k === ' ' || k === 'enter' || k === 'z') { e.preventDefault(); if (!e.repeat) interact(); }
    else if (k === 'escape' || k === 'x' || k === 'backspace') { if (focused) { e.preventDefault(); closeCard(); } }
    else if (k === '+' || k === '=') { e.preventDefault(); setZoom(zoom * 1.15); }
    else if (k === '-' || k === '_') { e.preventDefault(); setZoom(zoom / 1.15); }
  });
  // Close the Pokémon's card (B / Esc, or walking away from it).
  function closeCard() {
    if (!focused) return;
    focused.timer = 0.5;
    focused = null;
    onPick(null);
  }
  const AWAY_TILES = 3;
  window.addEventListener('keyup', e => {
    const k = e.key.toLowerCase();
    if (k in KEYMAP) { const i = held.indexOf(KEYMAP[k]); if (i >= 0) held.splice(i, 1); }
    else if (k === 'shift') running = false;
  });
  window.addEventListener('blur', () => { held.length = 0; running = false; });

  // Talk to whoever is on the tile you're facing.
  function interact() {
    if (!M || player.move) return;
    const [dx, dy] = DIRV[player.dir];
    const o = whoAt(player.tx + dx, player.ty + dy);
    if (o && !o.isPlayer) greet(o);
  }

  const toWorld = (cx, cy) => ({ x: (cx * dpr - cw / 2) / (zoom * dpr) + cam.x, y: (cy * dpr - ch / 2) / (zoom * dpr) + cam.y });
  // Pixel-accurate: the Pokémon whose drawn sprite has a solid pixel under the pointer (front-most first).
  function monAt(wx, wy) {
    const order = [...mons].sort((a, b) => b.y - a.y);
    for (const e of order) {
      const d = e.drawn;
      if (!d || wx < d.dx || wy < d.dy || wx >= d.dx + d.dw || wy >= d.dy + d.dh) continue;
      const sx = d.sx + (wx - d.dx) / d.dw * d.sw, sy = d.sy + (wy - d.dy) / d.dh * d.sh;
      const flip = d.flip ? -1 : 1;
      // a little tolerance so tiny Pokémon are still easy to click
      for (const [ox, oy] of [[0, 0], [1, 0], [-1, 0], [0, 1], [0, -1]])
        if (alphaAt(d.img, d.flip ? d.sx + d.sw - (sx - d.sx) + ox * flip : sx + ox, sy + oy) > 24) return e;
    }
    // or the tile a small Pokémon stands on
    const tx = Math.floor(wx / TS), ty = Math.floor(wy / TS);
    const o = whoAt(tx, ty);
    return o && !o.isPlayer && o.topOff < TS * 0.9 ? o : null;
  }
  canvas.addEventListener('pointerdown', e => {
    if (!M) return;
    canvas.focus({ preventScroll: true });
    const r = canvas.getBoundingClientRect();
    const w = toWorld(e.clientX - r.left, e.clientY - r.top);
    const m = monAt(w.x, w.y);
    if (m) {
      // next to it already? say hi. Otherwise walk up to it first.
      if (adjacentTo(player, m)) { player.dir = faceDir(player, m); greet(m); return; }
      player.goal = m;
      player.path = findPath(player, (x, y) => adjacentTile(x, y, m), 60);
      return;
    }
    focused = null; onPick(null);
    const tx = Math.floor(w.x / TS), ty = Math.floor(w.y / TS);
    player.goal = null; player.spot = [tx, ty];
    player.path = findPath(player, (x, y) => x === tx && y === ty, 80);
  });
  const adjacentTile = (x, y, m) => footprint(m, m.tx, m.ty).some(([fx, fy]) => Math.abs(fx - x) + Math.abs(fy - y) === 1);
  const adjacentTo = (p, m) => !p.move && !m.move && adjacentTile(p.tx, p.ty, m);
  canvas.addEventListener('pointermove', e => {
    if (!M) return;
    const r = canvas.getBoundingClientRect();
    const w = toWorld(e.clientX - r.left, e.clientY - r.top);
    hovered = monAt(w.x, w.y);
    canvas.style.cursor = hovered ? 'pointer' : 'default';
  });
  canvas.addEventListener('pointerleave', () => { hovered = null; });
  canvas.addEventListener('wheel', e => {
    e.preventDefault();
    setZoom(zoom * (e.deltaY < 0 ? 1.15 : 1 / 1.15));
  }, { passive: false });
  function setZoom(z) {
    const minZ = Math.max(cw, ch) / dpr / (M?.size ?? 1254);
    zoom = clamp(z, Math.max(1, minZ), 7);
    try { localStorage.setItem('pv.meadowZoom2', zoom.toFixed(2)); } catch { /* ignore */ }
    snapCamera();
  }

  /* ----- update ----- */
  // One step for you (a ledge hop has its sound).
  function playerStep(d) {
    if (!tryStep(player, d, running ? RUN_STEP : WALK_STEP)) return false;
    if (player.move.hop) hopSound();
    return true;
  }
  // Walking into a Pokémon for a moment makes it step aside (sideways if it can), so it never boxes you in.
  function pushInto(d, dt) {
    const s = stepTarget(player, player.tx, player.ty, d);
    const m = monFeetAt(s.x, s.y) ?? monFeetAt(player.tx + DIRV[d][0], player.ty + DIRV[d][1]);
    if (!m || m.battle || m.move) { player.push = 0; return; }
    if ((player.push = (player.push ?? 0) + dt) < 0.4) return;
    player.push = 0;
    const side = d === 0 || d === 3 ? [1, 2] : [0, 3];
    for (const md of [...side.sort(() => Math.random() - 0.5), d]) {
      const t2 = stepTarget(m, m.tx, m.ty, md);
      if (!canStand(m, t2.x, t2.y)) continue;
      if (m.state === 'sleep' || m.state === 'sit' || m.state === 'faint') stopPlay(m);
      m.chase = null;
      walkPath(m, [md], 'walk', 1.2);
      if (Math.random() < 0.5) say(m, ['Surprised', 'Normal'], 1.2);
      return;
    }
  }
  function updatePlayer(dt) {
    player.bump = Math.max(0, player.bump - dt);
    if (player.move) {
      if (!updateMove(player, dt)) { player.walk += dt; return; }
      player.walk += dt;
      // arrived: keep going without stopping if a key is still held (no turn pause while walking)
      const d = held.length ? held[held.length - 1] : null;
      if (d !== null) { if (!playerStep(d)) { player.dir = d; player.bump = 0.25; bumpSound(); pushInto(d, dt); } return; }
    }
    const want = held.length ? held[held.length - 1] : null;
    if (want !== null) {
      if (want !== player.dir && player.turnT <= 0 && !player.wasHolding) {   // tap = turn in place
        player.dir = want; player.turnT = 0.1; player.wasHolding = true;
        return;
      }
      player.wasHolding = true;
      if (player.turnT > 0) { player.turnT -= dt; return; }
      if (!playerStep(want)) { player.dir = want; player.bump = Math.max(player.bump, 0.05); bumpSound(); pushInto(want, dt); }
      return;
    }
    player.wasHolding = false; player.turnT = 0;
    // following a clicked path
    if (player.path?.length) {
      if (playerStep(player.path[0])) player.path.shift();
      else {                                                   // something stepped in the way: find another way
        const goal = player.goal, spot = player.spot;
        player.path = goal ? findPath(player, (x, y) => adjacentTile(x, y, goal), 60)
          : spot ? findPath(player, (x, y) => x === spot[0] && y === spot[1], 80) : null;
      }
      return;
    }
    if (player.goal) {
      const g = player.goal;
      player.goal = null; player.path = null;
      if (mons.includes(g) && adjacentTo(player, g)) { player.dir = faceDir(player, g); greet(g); }
    }
    player.walk = 0;
  }

  function camTarget() {
    const ze = zoom * dpr;
    const vw = cw / ze, vh = ch / ze, S = M?.size ?? 1254;
    return {
      x: vw >= S ? S / 2 : clamp(player.x, vw / 2, S - vw / 2),
      y: vh >= S ? S / 2 : clamp(player.y - 20, vh / 2, S - vh / 2),
    };
  }
  function snapCamera() { Object.assign(cam, camTarget()); }
  function onScreen(e) {
    const ze = zoom * dpr;
    return Math.abs(e.x - cam.x) < cw / ze / 2 + 40 && Math.abs(e.y - cam.y) < ch / ze / 2 + 60;
  }

  function update(dt) {
    updateWeather(dt);
    updateTreats(dt);
    t += dt;
    updatePlayer(dt);
    if (focused && (!mons.includes(focused) || Math.abs(focused.tx - player.tx) + Math.abs(focused.ty - player.ty) > AWAY_TILES + (focused.k === 1 ? 0 : 2))) closeCard();
    for (const e of mons) updateMon(e, dt);
    for (const bt of [...battles]) updateBattle(bt, dt);
    for (const h of hearts) h.t += dt;
    while (hearts.length && hearts[0].t > 1.4) hearts.shift();
    updateAmbient(dt);
    updateFx(dt);
    shake = Math.max(0, shake - dt * 14);
    const to = camTarget(), k = 1 - Math.exp(-dt * 10);
    cam.x += (to.x - cam.x) * k; cam.y += (to.y - cam.y) * k;
  }

  /* ----- drawing ----- */
  function currentAnim(e) {
    const P = e.P;
    if (e.play) {
      const a = P.anims[e.play.kind];
      if (a) {
        const el = t - e.play.start;
        if (e.play.loop || e.play.hold || el < a.total) return [a, el, e.play.loop];
      }
      if (!e.play.loop && !e.play.hold) e.play = null;
    }
    if (e.move) return [P.anims.walk, t + e.phase, true];
    if (e.state === 'sleep' && P.anims.sleep) return [P.anims.sleep, t + e.phase, true];
    if ((e.state === 'sit' || e.state === 'faint') && P.anims.sit) return [P.anims.sit, t + e.phase, true];
    return [P.anims.idle, t + e.phase, true];
  }

  function drawMon(e) {
    const water = M.tile(Math.floor(e.x / TS), Math.floor((e.y - 1) / TS)) === '~';
    let lift = e.lift ?? 0;
    if (e.hop > 0) lift += Math.abs(Math.sin(e.hop * Math.PI * 2.8)) * Math.min(14, 6 + e.topOff * 0.15);
    let ox = 0, oy = 0;
    if (e.lunge) { const p = Math.sin(Math.PI * e.lunge.t / e.lunge.dur); ox += e.lunge.dx * e.lunge.dist * p; oy += e.lunge.dy * e.lunge.dist * p; }
    if (e.kb) { const p = Math.sin(Math.PI * Math.min(1, e.kb.t / 0.4)); ox += e.kb.dx * p; oy += e.kb.dy * p; }
    const x = e.x + ox, y = e.y + oy;
    if (!water) {
      const rx = clamp(e.w * 0.38, 2.5, 160);
      ctx.fillStyle = `rgba(0,0,0,${(0.16 + Math.min(0.12, e.weight / 3000)).toFixed(3)})`;
      ctx.beginPath(); ctx.ellipse(x, y - 0.5, rx, rx * 0.35, 0, 0, 6.283); ctx.fill();
    }
    const sink = water ? e.topOff * 0.35 : 0;
    if (water) { ctx.save(); ctx.beginPath(); ctx.rect(x - e.w * 2, y - 2000, e.w * 4, 2000 - 1); ctx.clip(); }
    if (e.P) {
      const [anim, time, loop] = currentAnim(e);
      const n = anim.dur.length, f = frameAt(anim, time, loop);
      const row = anim.rows === 8 ? PMD_ROW[e.dir] : 0;
      const [fx0, fy0] = anim.feet[row * n + f];
      const d = { img: anim.img, sx: f * anim.fw, sy: row * anim.fh, sw: anim.fw, sh: anim.fh,
        dx: x - fx0 * e.scale, dy: y - fy0 * e.scale - lift + sink, dw: anim.fw * e.scale, dh: anim.fh * e.scale };
      ctx.drawImage(d.img, d.sx, d.sy, d.sw, d.sh, d.dx, d.dy, d.dw, d.dh);
      e.drawn = d;
    } else {
      const s = e.still, spr = e.dir === 3 ? s.back : e.dir === 2 ? s.frontR : s.front;
      const w = spr.width * e.scale, h = spr.height * e.scale;
      const d = { img: spr, sx: 0, sy: 0, sw: spr.width, sh: spr.height, dx: x - w / 2, dy: y - h - lift + sink, dw: w, dh: h };
      if (e.state === 'faint') {
        ctx.save(); ctx.translate(x, y - 1); ctx.rotate(Math.PI / 2); ctx.drawImage(spr, -w, -h / 2, w, h); ctx.restore();   // lying on its side
      } else ctx.drawImage(spr, d.dx, d.dy, d.dw, d.dh);
      e.drawn = d;
    }
    if (water) {
      ctx.restore();
      ctx.strokeStyle = 'rgba(230,244,255,.9)'; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.ellipse(x, y - 1, e.w * 0.45 + Math.sin(t * 3 + e.phase) * 1.5, 2.5, 0, 0, 6.283); ctx.stroke();
    }
    drawBubble(e, x, y - e.topOff - lift + sink);
  }

  function drawBubble(e, x, top) {
    if (e.bubble) {
      const a = clamp(e.bubble.t / 0.3, 0, 1);
      ctx.globalAlpha = a;
      const S = 26, bx = Math.round(x - S / 2), by = Math.round(top - S - 9);
      ctx.fillStyle = '#1e2b2b'; ctx.fillRect(bx - 1, by - 1, S + 2, S + 2);
      ctx.fillStyle = '#fff'; ctx.fillRect(bx, by, S, S);
      ctx.drawImage(e.bubble.img, bx + 1, by + 1, S - 2, S - 2);
      ctx.fillStyle = '#1e2b2b'; ctx.fillRect(Math.round(x) - 3, by + S + 1, 6, 2); ctx.fillRect(Math.round(x) - 2, by + S + 3, 4, 2);
      ctx.fillStyle = '#fff'; ctx.fillRect(Math.round(x) - 2, by + S, 4, 2); ctx.fillRect(Math.round(x) - 1, by + S + 2, 2, 2);
      ctx.globalAlpha = 1;
    } else if (e.emote > 0) {
      const bx = Math.round(x - 5), by = Math.round(top - 17);
      ctx.fillStyle = '#1e2b2b'; ctx.fillRect(bx - 1, by - 1, 12, 14);
      ctx.fillStyle = '#fff'; ctx.fillRect(bx, by, 10, 12);
      ctx.fillStyle = '#e0403a'; ctx.fillRect(bx + 4, by + 2, 2, 5); ctx.fillRect(bx + 4, by + 8, 2, 2);
    } else if (e.state === 'faint') {
      for (let i = 0; i < 3; i++) {
        const a = t * 3 + i * 2.09, sx = x + Math.cos(a) * Math.max(6, e.w * 0.35), sy = top - 4 + Math.sin(a) * 2.5;
        ctx.fillStyle = i % 2 ? '#ffe94a' : '#ffffff';
        ctx.fillRect(sx - 2, sy - 0.5, 4, 1); ctx.fillRect(sx - 0.5, sy - 2, 1, 4);
      }
    } else if (e.state === 'sleep') {
      for (let i = 0; i < 2; i++) {
        const k = (t * 0.6 + i * 0.5) % 1, s = i ? 1 : 1.5;
        const zx = x + e.w * 0.3 + k * 8, zy = top - 2 - k * 16;
        ctx.globalAlpha = 1 - k; ctx.fillStyle = '#fff';
        ctx.fillRect(zx, zy, 5 * s, s); ctx.fillRect(zx + 3 * s, zy + s, s, s); ctx.fillRect(zx + 2 * s, zy + 2 * s, s, s);
        ctx.fillRect(zx + s, zy + 3 * s, s, s); ctx.fillRect(zx, zy + 4 * s, 5 * s, s);
      }
      ctx.globalAlpha = 1;
    }
  }

  function drawPlayer() {
    const P = M.player;
    const scale = (P.heightM * PXM) / P.heightPx;
    // walk cycle: 4 frames per two tiles; walking in place when bumping into something
    const moving = !!player.move || player.bump > 0;
    const frames = running ? 9 : 6.5;
    const col = moving ? Math.floor((player.move ? player.walk : t) * frames) % 4 : 0;
    const [ax, ay] = P.anchors[player.dir];
    const y = player.y - (player.lift ?? 0);
    ctx.fillStyle = 'rgba(0,0,0,.2)';
    ctx.beginPath(); ctx.ellipse(player.x, player.y - 0.5, 8, 3, 0, 0, 6.283); ctx.fill();
    ctx.imageSmoothingEnabled = true; ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(M.playerImg, col * P.frameW, player.dir * P.frameH, P.frameW, P.frameH,
      player.x - ax * scale, y - ay * scale, P.frameW * scale, P.frameH * scale);
    ctx.imageSmoothingEnabled = false;
  }

  function label(e, ze, ox, oy) {
    const sx = e.x * ze + ox, sy = (e.y - e.topOff - (e.bubble || e.emote > 0 ? 38 : 4)) * ze + oy;
    const text = e.info.isEgg ? 'Egg' : `${e.info.nickname || e.info.speciesName}  Lv. ${e.info.level}`;
    ctx.font = `700 ${13 * dpr}px "Segoe UI", system-ui, sans-serif`;
    const tw = ctx.measureText(text).width + (e.info.shiny ? 16 * dpr : 0);
    const pad = 8 * dpr, hgt = 22 * dpr;
    const x = Math.round(sx - tw / 2 - pad), y = Math.round(sy - hgt);
    ctx.fillStyle = e === focused ? '#ffd23f' : 'rgba(8,40,40,.88)';
    ctx.beginPath(); ctx.roundRect(x, y, tw + pad * 2, hgt, 11 * dpr); ctx.fill();
    ctx.fillStyle = e === focused ? '#3a2e00' : '#fff';
    ctx.textBaseline = 'middle';
    ctx.fillText(text, x + pad, y + hgt / 2 + dpr);
    if (e.info.shiny) { ctx.fillStyle = e === focused ? '#b06d00' : '#ffd23f'; ctx.fillText('★', x + pad + tw - 13 * dpr, y + hgt / 2 + dpr); }
  }

  function drawBattleUi(bt, ze, ox, oy) {
    if (bt.phase === 'fight')
      for (const e of [bt.a, bt.b]) {
        const v = bt.shown.get(e), real = bt.hp.get(e);
        const sx = e.x * ze + ox, sy = (e.y - e.topOff) * ze + oy - 12 * dpr;
        const W = 52 * dpr, H = 7 * dpr, x = Math.round(sx - W / 2), y = Math.round(sy - H);
        ctx.fillStyle = 'rgba(10,30,30,.85)'; ctx.fillRect(x - 2 * dpr, y - 2 * dpr, W + 4 * dpr, H + 4 * dpr);
        ctx.fillStyle = '#3a4a48'; ctx.fillRect(x, y, W, H);
        ctx.fillStyle = real > 0.5 ? '#4cd964' : real > 0.2 ? '#ffcc00' : '#ff3b30';
        ctx.fillRect(x, y, Math.max(0, W * v), H);
      }
    if (bt.caption) {
      const top = Math.min(bt.a.y - bt.a.topOff, bt.b.y - bt.b.topOff);
      const sx = ((bt.a.x + bt.b.x) / 2) * ze + ox, sy = top * ze + oy - 44 * dpr;
      ctx.font = `700 ${14 * dpr}px "Segoe UI", system-ui, sans-serif`;
      const tw = ctx.measureText(bt.caption.text).width, pad = 10 * dpr, hgt = 28 * dpr;
      ctx.globalAlpha = clamp(bt.caption.t / 0.25, 0, 1);
      ctx.fillStyle = 'rgba(255,255,255,.95)'; ctx.strokeStyle = '#1e2b2b'; ctx.lineWidth = 2 * dpr;
      ctx.beginPath(); ctx.roundRect(sx - tw / 2 - pad, sy - hgt, tw + pad * 2, hgt, 8 * dpr); ctx.fill(); ctx.stroke();
      ctx.fillStyle = '#1e2b2b'; ctx.textBaseline = 'middle';
      ctx.fillText(bt.caption.text, sx - tw / 2, sy - hgt / 2 + dpr);
      ctx.globalAlpha = 1;
    }
  }

  // Rain, snow, cloud shade and lightning, on top of the world (the time of day still darkens them).
  function drawWeather() {
    const shade = 0.22 * wx.cloud + 0.18 * Math.min(1, wx.rain) + 0.25 * wx.storm;
    if (shade > 0.01) {
      ctx.globalCompositeOperation = 'multiply';
      ctx.fillStyle = `rgba(120,132,150,${shade.toFixed(3)})`; ctx.fillRect(0, 0, cw, ch);
      ctx.globalCompositeOperation = 'source-over';
    }
    if (drops.length) {
      ctx.strokeStyle = 'rgba(210,225,245,.55)'; ctx.lineWidth = Math.max(1, dpr);
      ctx.beginPath();
      for (const d of drops) { const x = d.x * cw, y = d.y * ch; ctx.moveTo(x, y); ctx.lineTo(x - d.l * ch * 0.3, y - d.l * ch); }
      ctx.stroke();
    }
    if (flakes.length) {
      ctx.fillStyle = 'rgba(255,255,255,.9)';
      for (const f of flakes) { ctx.beginPath(); ctx.arc(f.x * cw, f.y * ch, f.s * dpr, 0, Math.PI * 2); ctx.fill(); }
    }
    if (flash > 0.01) { ctx.fillStyle = `rgba(240,245,255,${(0.55 * flash).toFixed(3)})`; ctx.fillRect(0, 0, cw, ch); }
  }

  function draw() {
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = '#2a6233';
    ctx.fillRect(0, 0, cw, ch);
    if (!M) return;
    const ze = zoom * dpr;
    const sx = shake ? R(-shake, shake) : 0, sy = shake ? R(-shake, shake) : 0;
    const ox = Math.round(cw / 2 - cam.x * ze + sx * dpr), oy = Math.round(ch / 2 - cam.y * ze + sy * dpr);
    ctx.setTransform(ze, 0, 0, ze, ox, oy);
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(seasonMap() ?? M.img, 0, 0);
    drawWater();
    if (light.night < 0.6)
      for (const c of clouds) {
        const gr = ctx.createRadialGradient(c.x, c.y, 0, c.x, c.y, c.r);
        gr.addColorStop(0, 'rgba(20,40,30,.10)'); gr.addColorStop(1, 'rgba(20,40,30,0)');
        ctx.fillStyle = gr; ctx.fillRect(c.x - c.r, c.y - c.r, c.r * 2, c.r * 2);
      }
    // everyone, back to front by where their feet are
    const vx0 = cam.x - cw / ze / 2 - 60, vx1 = cam.x + cw / ze / 2 + 60, vy0 = cam.y - ch / ze / 2 - 40, vy1 = cam.y + ch / ze / 2 + 400;
    const list = [];
    for (const e of mons) if (e.x > vx0 - e.w && e.x < vx1 + e.w && e.y > vy0 && e.y < vy1 + e.topOff) list.push({ y: e.y, draw: () => drawMon(e) });
    list.push({ y: player.y + 0.01, draw: drawPlayer });
    list.sort((a, b) => a.y - b.y);
    for (const d of list) d.draw();
    drawFx();
    for (const h of hearts) {
      if (h.t < 0) continue;
      ctx.globalAlpha = clamp(1.4 - h.t, 0, 1);
      ctx.drawImage(HEART, h.x + h.vx * h.t, h.y - h.t * 24, 7, 6);
    }
    ctx.globalAlpha = 1;
    for (const l of leaves) { ctx.save(); ctx.translate(l.x, l.y); ctx.rotate(l.rot); ctx.fillStyle = l.col; ctx.fillRect(-1.5, -0.75, 3, 1.5); ctx.restore(); }
    drawTreats();

    ctx.setTransform(1, 0, 0, 1, 0, 0);
    drawWeather();
    // sunset/sunrise glow and night, blended by the real time
    if (light.eve > 0.01 || light.night > 0.01) {
      ctx.globalCompositeOperation = 'multiply';
      if (light.eve > 0.01) { ctx.fillStyle = `rgba(255,170,110,${(0.75 * light.eve).toFixed(3)})`; ctx.fillRect(0, 0, cw, ch); }
      if (light.night > 0.01) { ctx.fillStyle = `rgba(60,78,160,${(0.9 * light.night).toFixed(3)})`; ctx.fillRect(0, 0, cw, ch); }
      ctx.globalCompositeOperation = 'source-over';
    }
    if (light.night > 0.05) {
      ctx.globalCompositeOperation = 'lighter';
      const gx = player.x * ze + ox, gy = (player.y - 25) * ze + oy;
      const glow = ctx.createRadialGradient(gx, gy, 0, gx, gy, 3.5 * PXM * ze);
      glow.addColorStop(0, `rgba(255,220,150,${(0.22 * light.night).toFixed(3)})`); glow.addColorStop(1, 'rgba(255,220,150,0)');
      ctx.fillStyle = glow; ctx.fillRect(0, 0, cw, ch);
      const s = Math.max(2, Math.round(ze * 1.2));
      for (const f of fireflies) {
        const fx1 = (f.x + Math.sin(t * 0.6 + f.p) * 18) * ze + ox, fy1 = (f.y + Math.cos(t * 0.8 + f.p) * 12) * ze + oy;
        ctx.fillStyle = `rgba(220,255,140,${((0.5 + 0.5 * Math.sin(t * 3 + f.p)) * light.night).toFixed(2)})`;
        ctx.fillRect(Math.round(fx1), Math.round(fy1), s, s);
      }
      ctx.globalCompositeOperation = 'source-over';
    }
    for (const bt of battles) drawBattleUi(bt, ze, ox, oy);
    for (const e of new Set([hovered, focused])) if (e && mons.includes(e) && !e.battle) label(e, ze, ox, oy);
  }

  let raf = 0, last = 0, frozen = false;   // frozen: photo mode holds the moment still
  function loop(now) {
    raf = 0;
    if (!active) return;
    const dt = last ? Math.min(0.05, (now - last) / 1000) : 0;
    last = now;
    if (M && !frozen) update(dt);
    draw();
    raf = requestAnimationFrame(loop);
  }
  function setActive(on) {
    active = on;
    if (!on) { held.length = 0; running = false; last = 0; silence(); return; }
    if (!raf) raf = requestAnimationFrame(loop);
    canvas.focus({ preventScroll: true });
  }

  function resize() {
    dpr = Math.max(1, window.devicePixelRatio || 1);
    cw = Math.max(1, Math.round(container.clientWidth * dpr));
    ch = Math.max(1, Math.round(container.clientHeight * dpr));
    canvas.width = cw; canvas.height = ch;
    if (!zoom && container.clientHeight > 0) zoom = clamp(container.clientHeight / 320, 1.5, 6);
    if (zoom && container.clientHeight > 0) setZoom(zoom);
    else if (M) snapCamera();
    if (!active) draw();
  }
  new ResizeObserver(resize).observe(container);
  resize();

  return {
    setPokemon,
    setActive,
    pet,
    feed,
    // Photo mode: hold the scene still (and give back the picture as it is now).
    freeze: on => { frozen = !!on; if (!frozen) last = 0; draw(); },
    snapshot: () => { draw(); return canvas; },
    // for checking weather from the dev console: meadow.setWeather('rain'), meadow.setSeason('winter'), 'auto' for both
    setWeather: w => { weatherPick = w; if (w === 'auto') rollWeather(); renderWeatherUi(); return weather(); },
    setSeason: sn => { seasonPick = sn; renderWeatherUi(); return season(); },
    // for checking how a time of day looks: meadow.setClock('21:30'), meadow.setClock(null) = real clock
    setClock: hhmm => {
      if (!hhmm) clockOverride = null;
      else { const [h, m] = hhmm.split(':').map(Number); clockOverride = new Date(); clockOverride.setHours(h, m || 0, 0, 0); }
      updateLight(); draw(); return { ...light, timeName };
    },
    clearFocus: () => { if (focused) focused.timer = 0.5; focused = null; },
    closeCard: () => closeCard(),
    hasCard: () => !!focused,
    zoomBy: f => setZoom(zoom * f),
    // for checking things from the dev console
    debug: () => ({
      player: [player.tx, player.ty, M?.tile(player.tx, player.ty)],
      battles: battles.map(b => ({ a: name(b.a), b: name(b.b), phase: b.phase, hp: [...b.hp.values()].map(v => +v.toFixed(2)) })),
      mons: mons.map(e => [name(e), e.persona, e.state, e.tx, e.ty, M.tile(e.tx, e.ty), e.k, +e.timer.toFixed(1), e.play?.kind ?? null]),
      clock: +t.toFixed(2),
      overlaps: (() => {                       // tiles claimed by two Pokémon at once (should always be 0)
        const seen = new Map(); let n = 0;
        for (const e of mons) for (const [x, y] of footprint(e, e.tx, e.ty)) { const k = y * N + x; if (seen.has(k)) n++; seen.set(k, e); }
        return n;
      })(),
      youShareATile: !!monFeetAt(player.tx, player.ty),
      badTiles: [...mons, player].filter(e => !footprint(e, e.tx, e.ty).every(([x, y]) => okTile(e, M.tile(x, y)))).map(e => (e.isPlayer ? 'you' : name(e))),
    }),
    // run the game clock forward (for testing while the window is hidden)
    cry: who => { const e = mons.find(m => name(m) === who); if (!e) return false; e.cryUntil = 0; playCry(e); return spatial(e.x, e.y); },
    where: () => ({ player: [player.x, player.y], cam: [cam.x, cam.y], zoom, TS }),
    advance: sec => { for (let i = 0; i < Math.round(sec * 60); i++) update(1 / 60); draw(); return [player.tx, player.ty, player.dir]; },
    teleport: (tx, ty) => { if (canStand(player, tx, ty)) { placeAt(player, tx, ty); snapCamera(); return true; } return false; },
    forceBattle: () => {
      mons.forEach(m => { m.cool = 0; });
      const a = mons.find(e => !e.info.isEgg && !busy(e) && e.state !== 'sit');
      return a ? startBattle(a) : false;
    },
  };
}
