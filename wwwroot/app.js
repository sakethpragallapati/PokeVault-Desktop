'use strict';

/* =========================================================
   PokeVault front end
   ========================================================= */

const SPR = 'https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/';
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
// Interface icon from the SVG sprite in index.html.
const ico = n => `<svg class="i" aria-hidden="true"><use href="#i-${n}"/></svg>`;
// On-screen control hints: the keyboard key(s) and the matching controller button. Only one set shows,
// depending on what was used last (body.pad is set by gamepad.js while a controller is in use).
const PAD_FACE = { A: '#3fb64a', B: '#e0453a', X: '#2f74d6', Y: '#e8b21a' };
function padGlyph(b) {
  if (PAD_FACE[b]) return `<span class="pg pg-face" style="--pb:${PAD_FACE[b]}">${b}</span>`;
  if (b.startsWith('dpad')) {
    const lit = { 'dpad-ud': 'ud', 'dpad-lr': 'lr' }[b] ?? 'all';
    return `<span class="pg pg-dpad ${lit}" aria-label="D-pad"><i></i><i></i></span>`;
  }
  return `<span class="pg pg-pill">${b}</span>`;
}
const kh = (keys, pad) => `<span class="hk">${[].concat(keys).map(k => `<kbd>${k}</kbd>`).join('')}</span>${padGlyph(pad)}`;

const GAME_COLORS = {
  SL: '#e0533b', VL: '#8b55d9', ZA: '#2aa876', PLA: '#9a7442', BD: '#3d6fd6', SP: '#d46b9f',
  SW: '#2f8fe0', SH: '#d6335f', GP: '#e8b31c', GE: '#b9813f', SN: '#f08a24', MN: '#4b62c9',
  US: '#e86a1c', UM: '#5b4bc4', X: '#2c6fbf', Y: '#cf3a3a', OR: '#d1452f', AS: '#2f6cc0',
  B: '#3a3a3a', W: '#9aa1a8', B2: '#2e3a4a', W2: '#b8c2cc', D: '#4a76c9', P: '#cf6fa0', Pt: '#7a7f8c',
  HG: '#d6a51c', SS: '#a9b5c4', R: '#d23b3b', S: '#3b6fd2', E: '#2e9e5b', FR: '#e2672a', LG: '#4caf50',
  GD: '#d4a017', SI: '#9fa8b3', C: '#3fb3c9', RD: '#d23b3b', GN: '#4caf50', BU: '#3b6fd2', YW: '#e8c21c',
};
// The Pokémon on each game's box (Pokémon Showdown sprite names), shown on its pill instead of letters.
// Keys are PKHeX's version codes; paired saves that can't tell the two games apart get one of the pair.
const GAME_MASCOTS = {
  RD: 'charizard', GN: 'venusaur', BU: 'blastoise', YW: 'pikachu', RB: 'charizard', RBY: 'pikachu',   // Gen 1
  GD: 'hooh', SI: 'lugia', C: 'suicune', GS: 'hooh', GSC: 'suicune',                                   // Gen 2
  R: 'groudon', S: 'kyogre', E: 'rayquaza', RS: 'groudon', RSE: 'rayquaza', FR: 'charizard', LG: 'venusaur', FRLG: 'charizard',
  COLO: 'espeon', XD: 'lugia', CXD: 'espeon',                                                           // GameCube
  D: 'dialga', P: 'palkia', Pt: 'giratina-origin', DP: 'dialga', DPPt: 'giratina-origin',               // Gen 4
  HG: 'hooh', SS: 'lugia', HGSS: 'hooh',
  B: 'reshiram', W: 'zekrom', BW: 'reshiram', B2: 'kyurem-black', W2: 'kyurem-white', B2W2: 'kyurem-black',   // Gen 5
  X: 'xerneas', Y: 'yveltal', XY: 'xerneas', OR: 'groudon-primal', AS: 'kyogre-primal', ORAS: 'groudon-primal', // Gen 6
  SN: 'solgaleo', MN: 'lunala', SM: 'solgaleo', US: 'necrozma-duskmane', UM: 'necrozma-dawnwings', USUM: 'necrozma-duskmane', // Gen 7
  GP: 'pikachu', GE: 'eevee', GG: 'pikachu',                                                            // Let's Go
  SW: 'zacian', SH: 'zamazenta', SWSH: 'zacian', BD: 'dialga', SP: 'palkia', BDSP: 'dialga', PLA: 'arceus',   // Gen 8
  SL: 'assets/mascots/koraidon.png', VL: 'assets/mascots/miraidon.png', SV: 'assets/mascots/koraidon.png', ZA: 'zygarde', // Gen 9 (your pictures for Scarlet & Violet)
};
// Box sprites are 96 px with lots of empty space: cut the still ones down to the Pokémon so it fills its circle.
// (The moving one stays a GIF, shown larger instead.)
function trimMascot(im) {
  im.classList.toggle('ani', im.src.endsWith('.gif'));
  if (im.dataset.own || !im.src.endsWith('.png') || !im.naturalWidth) return;   // your own pictures are already trimmed
  const c = document.createElement('canvas'); c.width = im.naturalWidth; c.height = im.naturalHeight;
  const g = c.getContext('2d', { willReadFrequently: true });
  g.drawImage(im, 0, 0);
  let d; try { d = g.getImageData(0, 0, c.width, c.height).data; } catch { return; }
  let x0 = c.width, y0 = c.height, x1 = -1, y1 = -1;
  for (let y = 0; y < c.height; y++) for (let x = 0; x < c.width; x++)
    if (d[(y * c.width + x) * 4 + 3] > 10) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
  if (x1 < 0) return;
  const side = Math.max(x1 - x0, y1 - y0) + 3, o = document.createElement('canvas');
  o.width = o.height = side;
  o.getContext('2d').drawImage(c, x0, y0, x1 - x0 + 1, y1 - y0 + 1, Math.floor((side - (x1 - x0 + 1)) / 2), side - (y1 - y0 + 1) - 1, x1 - x0 + 1, y1 - y0 + 1);
  im.onload = null;
  im.src = o.toDataURL();
}
// A game's pill badge: its box Pokémon (moving on the chosen game), or its letters if there isn't one.
function mascotChip(g, moving) {
  const id = GAME_MASCOTS[g?.version];
  if (!id) return `<span class="src-chip">${esc(gameAbbr(g))}</span>`;
  const own = id.includes('/');                    // a picture of its own (no moving version)
  const still = own ? id : `/sprites/gen5/${id}.png`;
  return `<span class="src-chip mascot" title="${esc(g.game)}"><img src="${moving && !own ? `/sprites/ani/${id}.gif` : still}" alt="" draggable="false" ${own ? 'data-own="1"' : ''}
    data-still="${still}" onload="trimMascot(this)" onerror="if(this.dataset.still&&!this.src.endsWith('.png')){this.src=this.dataset.still}else{this.parentNode.classList.add('nomascot')}"><b>${esc(gameAbbr(g))}</b></span>`;
}

const TYPE_COLORS = {
  Normal: '#9a9a7a', Fire: '#ee7f30', Water: '#5590ec', Electric: '#e8c22a', Grass: '#5fb84c', Ice: '#6ccfd0',
  Fighting: '#c03a2e', Poison: '#9b47a0', Ground: '#d9b65a', Flying: '#8f9ff0', Psychic: '#f25782', Bug: '#9fb21f',
  Rock: '#b59d3a', Ghost: '#6f5899', Dragon: '#6c3ef6', Dark: '#6d5848', Steel: '#a8a8c4', Fairy: '#e690b8', Stellar: '#40b5a5',
};
const STAT_NAMES = ['HP', 'Attack', 'Defense', 'Sp. Atk', 'Sp. Def', 'Speed'];

const state = {
  status: null,
  view: 'boxes',
  pane: 'game',          // the box the cursor is in
  mode: 'vault',         // which pill is chosen: 'game' (game box + Vault box side by side) or 'vault'
  cursor: 0,            // the yellow cursor's slot in the visible box
  mouseCursor: false,   // true while a mouse moves the cursor (then one click opens the summary)
  gameId: null,
  gameBoxes: [],
  box: { game: 0, vault: 0 },
  slots: { game: [], vault: [], party: [] },
  select: null,     // { side, items: Map<key, mon> }
  pick: null,       // { kind: 'deposit' | 'withdraw' | 'vaultmove', mon }
  drag: null,       // { side, index }
  highlight: null,
  busy: false,
  dex: null,
  dexFilter: 'all',
};

/* ---------------- helpers ---------------- */

const game = () => state.status?.games.find(g => g.id === state.gameId) ?? null;
const gameColor = g => GAME_COLORS[g?.version] ?? '#7c8b88';
const gameAbbr = g => g?.version ? g.version.slice(0, 3) : '?';
const isRyu = g => g && (g.kind === 'ryujinx' || /\\Ryujinx\\/i.test(g.path));
const gameWritable = g => !!g?.supported && !(isRyu(g) && state.status?.emulatorRunning) && !g.running;
const name = m => (m.isNicknamed && !m.isEgg ? m.nickname : m.speciesName) || '???';
const key = (side, m) => side === 'vault' ? m.id : `${m.box}:${m.slot}`;
// Round type icons (from your icon set) in assets/types; typeChip shows the icon with the name.
const TYPE_ICONS = new Set(['normal','fighting','flying','poison','ground','rock','bug','ghost','steel','fire','water','grass','electric','psychic','ice','dragon','dark','fairy','stellar']);
const typeIcon = (t, cls = 'ticon') => TYPE_ICONS.has(String(t).toLowerCase())
  ? `<img class="${cls}" src="assets/types/${String(t).toLowerCase()}.png" alt="" title="${esc(t)}" draggable="false">` : '';
const typeChip = t => `<span class="type" style="--tc:${TYPE_COLORS[t] ?? '#888'}">${typeIcon(t, 'tchip-ico')}${esc(t)}</span>`;
const genderMark = m => m.isEgg ? '' : m.gender === 0 ? ' <span style="color:#2f6fe0">♂</span>' : m.gender === 1 ? ' <span style="color:#e0457e">♀</span>' : '';

function iconUrl(n) { return `${SPR}${n}.png`; }
function renderUrl(n, shiny) { return `${SPR}other/home/${shiny ? 'shiny/' : ''}${n}.png`; }

// Form-correct pictures (e.g. Hisuian Arcanine = "arcanine-hisui") from Showdown, cached by the
// PokeVault server; then the base form; then the species-only pictures as a last resort.
const baseId = m => (m.spriteId || '').split('-')[0];
function monIconUrls(m) {
  const set = m.shiny ? 'gen5-shiny' : 'gen5';
  const ids = [...new Set([m.spriteId, baseId(m)].filter(Boolean))];
  return [...ids.map(id => `/sprites/${set}/${id}.png`), iconUrl(m.species)];
}
function monRenderUrls(m) {
  const set = m.shiny ? 'home-centered-shiny' : 'home-centered';
  const ids = [...new Set([m.spriteId, baseId(m)].filter(Boolean))];
  // 512 px first (sharp in the big detail/summary pictures), then the 192 px version, then older sources.
  const hires = m.spriteId ? [`/sprites/${m.shiny ? 'hires-shiny' : 'hires'}/${m.spriteId}.png`] : [];
  return [...hires, ...ids.map(id => `/sprites/${set}/${id}.png`), renderUrl(m.species, m.shiny), iconUrl(m.species)];
}

function img(src, alt, cls, fallbackText, fallbackSrc) {
  // src may be a list of URLs: each one is tried in turn until one loads.
  const list = Array.isArray(src) ? src.slice(1) : [];
  if (Array.isArray(src)) src = src[0];
  const i = document.createElement('img');
  i.alt = alt; i.loading = 'lazy'; i.decoding = 'async'; i.src = src;
  if (cls) i.className = cls;
  if (list.length) {
    i.addEventListener('error', function next(e) {
      if (!list.length) return;
      e.stopImmediatePropagation();
      i.src = list.shift();
    });
  }
  i.onerror = () => {
    if (fallbackSrc && !i.dataset.f) { i.dataset.f = 1; i.className = 'render'; i.src = fallbackSrc; return; }
    const s = document.createElement('span'); s.className = 'fallback'; s.textContent = fallbackText ?? alt; i.replaceWith(s);
  };
  return i;
}
const monIcon = m => m.isEgg
  ? img(`${SPR}egg.png`, 'Egg', 'render', 'Egg')
  : img(monIconUrls(m), name(m), 'pixel', m.speciesName);

/* Pixel sprites in the box: scaled only by whole numbers of screen pixels (2x, 3x…) and trimmed to the
   visible part, so they stay crisp at any window size, including F11 full screen. */
// "Sharp bilinear": enlarge the sprite by a whole number with hard pixel edges first (96 → 192/288…),
// then let the browser shrink that smoothly to the exact slot size. Same pixel look and size as
// before, but no smeared or uneven pixels at any window size (including F11 full screen).
function fitPixelIcon(im) {
  const slot = im.closest('.slot');
  if (!slot || !im.naturalWidth) return;
  // fit the icon's own box (the whole slot, or the small square at the left in list view)
  const box = im.offsetParent && slot.contains(im.offsetParent) ? im.offsetParent : slot;
  const tile = Math.min(box.clientWidth, box.clientHeight) || slot.clientWidth, dpr = window.devicePixelRatio || 1;
  const tileW = box.clientWidth || tile, tileH = box.clientHeight || tile;
  const W = im.naturalWidth, H = im.naturalHeight;
  const s = (tile * 0.84) / W;                         // on-screen size per sprite pixel (CSS px), as before
  const k = Math.max(1, Math.ceil(s * dpr - 0.01));    // whole-number pre-scale, at least the screen size
  let cv = im._sharp;
  if (!cv || cv._k !== k || cv._src !== im.currentSrc) {
    const next = document.createElement('canvas');
    next.className = 'pixel-sharp';
    next.width = W * k; next.height = H * k;
    const g = next.getContext('2d');
    g.imageSmoothingEnabled = false;
    g.drawImage(im, 0, 0, W * k, H * k);
    next._k = k; next._src = im.currentSrc;
    if (cv) cv.replaceWith(next); else im.after(next);
    im._sharp = cv = next;
    im.style.visibility = 'hidden';
  }
  const snap = v => Math.round(v * dpr) / dpr;
  Object.assign(cv.style, {
    width: `${W * s}px`, height: `${H * s}px`,
    left: `${snap((tileW - W * s) / 2)}px`, top: `${snap((tileH - H * s) / 2)}px`,
  });
}
const refitPixelIcons = () => $$('.slot img.pixel').forEach(fitPixelIcon);
addEventListener('resize', () => requestAnimationFrame(refitPixelIcons));
// Refit whenever a box grid changes size (window resize, F11, layout changes).
const gridWatcher = new ResizeObserver(entries => requestAnimationFrame(() =>
  entries.forEach(e => e.target.querySelectorAll('.slot img.pixel').forEach(fitPixelIcon))));
document.addEventListener('DOMContentLoaded', () => $$('.grid').forEach(g => gridWatcher.observe(g)));
$$('.grid').forEach(g => gridWatcher.observe(g));

async function api(path, opts = {}) {
  const isForm = opts.body instanceof FormData;
  const res = await fetch(path, {
    method: opts.method ?? (opts.body ? 'POST' : 'GET'),
    headers: opts.body && !isForm ? { 'Content-Type': 'application/json' } : undefined,
    body: opts.body && !isForm ? JSON.stringify(opts.body) : opts.body,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || data.title || `Request failed (${res.status})`);
  return data;
}

let toastTimer;
function toast(msg, isError = false) {
  const t = $('#toast');
  t.textContent = msg; t.className = 'toast' + (isError ? ' error' : ''); t.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (t.hidden = true), isError ? 7000 : 3200);
}
const fail = e => { window.sfx?.error(); toast(e.message ?? String(e), true); };

function showDialog(html) {
  $('#dialogBody').innerHTML = html;
  const d = $('#dialog');
  if (!d.open) d.showModal();
  return $('#dialogBody');
}
const closeDialog = () => $('#dialog').open && $('#dialog').close();

/* ---------------- status & loading ---------------- */

async function loadStatus() {
  const prev = state.status;
  const s = await api('/api/status');
  state.status = s;

  if (!state.gameId || !s.games.some(g => g.id === state.gameId && g.supported && !g.hidden)) state.gameId = s.defaultGame;

  $('#phoneBtn').hidden = !!s.desktop; // the desktop window is only reachable from this PC
  const pill = $('#statusPill');
  // Only shown when it matters: while Ryujinx is open its saves are copy-only.
  pill.hidden = !s.emulatorRunning;
  if (s.emulatorRunning) { pill.textContent = 'Ryujinx open'; pill.className = 'pill bad'; pill.title = 'Ryujinx saves are view/copy only until you close Ryujinx.'; }

  $('#vaultSub').textContent = `${s.vaultTotal} Pokémon · Pokédex ${s.dexRegistered}/${s.dexTotal}`;
  checkCatches(s).catch(() => { /* alerts are a nicety */ });
  renderGameSwitch();
  if (state.view === 'games') renderGames();
  warmGameIcons(s.games);
  return { prev, s };
}

// The row above the box: one pill per connected game (badge + name) and the Vault.
function renderGameSwitch() {
  $('#pane-game .box').style.setProperty('--gc', gameColor(game()));
  const games = (state.status?.games ?? []).filter(x => x.supported && !x.hidden);
  const total = state.status?.vaultTotal ?? 0;
  $('.bx-sources').innerHTML =
    games.map(x => `
      <button type="button" data-pane="game" data-game="${esc(x.id)}" style="--gc:${gameColor(x)}"
        title="${esc(`${x.trainer ?? '?'} · ${x.pokemon} Pokémon${gameWritable(x) ? '' : ' · copy only while Ryujinx is open'}`)}">
        ${mascotChip(x, state.mode === 'game' && x.id === state.gameId)}${esc(x.game)}</button>`).join('')
    + `<button type="button" data-pane="vault"><span class="src-chip vault">${ico('vault')}</span>Vault${total ? ` (${total})` : ''}</button>`
    + (games.length ? '' : `<button type="button" data-act="addgame">${ico('plus')} Add a game</button>`);
  markActivePill();
}

function markActivePill() {
  $$('.bx-sources button').forEach(b => {
    const on = b.dataset.pane === state.mode && (state.mode !== 'game' || b.dataset.game === state.gameId);
    b.classList.toggle('active', on);
    const im = b.querySelector('.src-chip.mascot img');
    if (!im) return;
    const id = (im.dataset.still.match(/gen5\/(.+)\.png$/) ?? [])[1];
    const want = on && id ? `/sprites/ani/${id}.gif` : im.dataset.still;
    if ((im.dataset.shown ?? '') === want) return;
    im.dataset.shown = want;
    im.onload = () => trimMascot(im);
    im.src = want;
  });
}

async function loadGameBoxes() {
  if (!state.gameId) { state.gameBoxes = []; return; }
  state.gameBoxes = await api(`/api/games/${state.gameId}/boxes`);
  if (state.box.game >= state.gameBoxes.length) state.box.game = 0;
}

async function loadBox(side) {
  if (side === 'game' && !state.gameId) { state.slots.game = []; state.slots.party = []; render('game'); return; }
  const url = side === 'game' ? `/api/games/${state.gameId}/box/${state.box.game}` : `/api/vault/box/${state.box.vault}`;
  const [d] = await Promise.all([api(url), side === 'game' ? loadParty() : null]);
  state.slots[side] = d.slots;
  state.boxInfo ??= {};
  state.boxInfo[side] = d;
  render(side);
}

async function refreshAll() {
  await loadStatus();
  await loadGameBoxes().catch(fail);
  await Promise.all([loadBox('game').catch(fail), loadBox('vault').catch(fail)]);
}

async function selectGame(id) {
  state.gameId = id;
  state.box.game = 0;
  if (state.select?.side === 'game') endSelect();
  renderGameSwitch();
  await loadGameBoxes();
  await loadBox('game');
  if (state.pick?.from === 'vault') showCompat(state.pick.mon);   // holding one: check the newly chosen game
}

/* ---------------- box rendering ---------------- */

function render(side) {
  const pane = $(`#pane-${side}`);
  const grid = $('.grid', pane);
  const slots = state.slots[side];
  const size = side === 'vault' ? (state.status?.boxSize ?? 30) : (game()?.slotsPerBox ?? 30);
  grid.style.setProperty('--cols', size % 6 === 0 ? 6 : 5);

  const info = state.boxInfo?.[side];
  const boxEl = $('.box', pane);
  if (side === 'vault') { boxEl.dataset.wall = info?.wallpaper ?? 0; grid.dataset.wp = info?.wallpaper ?? 0; }
  const count = slots.filter(Boolean).length;
  $('.box-title .name', pane).textContent = side === 'game'
    ? (state.gameBoxes[state.box.game]?.name ?? (state.gameId ? '…' : 'No game'))
    : (info?.name ?? `Box ${state.box.vault + 1}`);
  $('.box-title .count', pane).textContent = side === 'game' && !state.gameId ? '' : `${count}/${size}`;
  $('.box-title', pane).dataset.owner = side === 'vault' ? 'Vault' : (game()?.game ?? '');

  grid.replaceChildren();
  for (let i = 0; i < size; i++) grid.append(makeSlot(side, slots[i], i, size));
  $$('.tool[data-act="select"]', pane).forEach(t => t.classList.toggle('on', state.select?.side === side));
  $('#btnSelect')?.classList.toggle('on', !!state.select);
  if (side === state.pane) renderDetail(side, shownMon(side));
  if (side === 'game') renderParty();
}

// One slot button, for a box or the party.
function makeSlot(side, m, i, size) {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = 'slot' + (m ? '' : ' empty');
  b.dataset.index = i;
  b.setAttribute('aria-label', m ? `${name(m)}, level ${m.level}` : `Empty slot ${i + 1}`);
  if (m) {
    const ico = document.createElement('span');
    ico.className = 'ico';
    const pic = monIcon(m);
    if (pic.tagName === 'IMG') {
      pic.loading = 'eager'; // small, and the whole box is on screen anyway
      pic.addEventListener('load', () => fitPixelIcon(pic));
      if (pic.complete && pic.naturalWidth) requestAnimationFrame(() => fitPixelIcon(pic));
    }
    ico.append(pic);
    b.append(ico);
    b.insertAdjacentHTML('beforeend', `<span class="nm">${esc(m.isEgg ? 'Egg' : name(m))}</span>`);
    if (!m.isEgg) b.insertAdjacentHTML('beforeend', `<span class="lv">${m.level}</span>`);
    if (m.shiny) b.insertAdjacentHTML('beforeend', '<span class="star">★</span>');
    if (m.locked) b.classList.add('locked');
    if (side === 'vault' && m.awayIn) {
      b.classList.add('away');
      b.insertAdjacentHTML('beforeend', `<span class="away-tag">Away</span>`);
    }
    if (state.select?.side === paneOf(side) && state.select.items.has(key(side, m))) {
      b.classList.add('picked');
      b.insertAdjacentHTML('beforeend', '<span class="tick">✓</span>');
    }
    if (isHeld(side, m)) b.classList.add('lifted');
    if (!state.pick && state.shown?.side === side && state.shown.k === key(side, m)) b.classList.add('shown');
    if (side === 'vault' && state.highlight === m.id) b.classList.add('found');
    const hg = state.highlightGame;
    if (side === 'game' && hg && hg.gameId === state.gameId && hg.box === state.box.game && hg.slot === i) b.classList.add('found');
    if (!state.select && !state.pick && !m.locked) b.draggable = true;
  } else if (isPickTarget(side)) {
    b.classList.add('target');
  }
  if (side !== 'party' && side === state.pane && i === state.cursor && !state.cursorHidden) b.classList.add('cursor');
  if (side !== 'party' && i < (size % 6 === 0 ? 6 : 5)) b.classList.add('top-row');
  if (m) b.dataset.tip = (m.isEgg ? 'Egg' : `${name(m)} (Lv. ${m.level})`) + (side === 'vault' && m.awayIn ? ` · away in ${m.awayIn}` : '');
  return b;
}

/* ---------------- the party (a strip in the game's pane) ---------------- */

// The party shares the game's pane: selections, the cursor's pane and "which game" are the game's.
const paneOf = side => side === 'party' ? 'game' : side;
const slotEls = side => side === 'party' ? $$('#party .slot') : $$(`#pane-${side} .slot`);

async function loadParty() {
  if (!state.gameId) { state.slots.party = []; state.partyHas = false; renderParty(); return; }
  const id = state.gameId;
  const d = await api(`/api/games/${id}/party`).catch(() => ({ has: false, slots: [] }));
  if (id !== state.gameId) return;
  state.slots.party = d.slots ?? [];
  state.partyHas = !!d.has;
  renderParty();
}

function renderParty() {
  const el = $('#party');
  if (!el) return;
  el.hidden = !state.gameId || !state.partyHas || state.mode !== 'game';
  $('.bx').classList.toggle('has-party', !el.hidden);
  const row = $('.party-slots', el);
  row.replaceChildren();
  if (el.hidden) return;
  const slots = state.slots.party ?? [];
  for (let i = 0; i < 6; i++) row.append(makeSlot('party', slots[i], i, 6));
  $('.party-count', el).textContent = `${slots.filter(Boolean).length}/6`;
  setPartyShown(partyShown());
}

// The party bar can fold away to a slim "Party 6/6" line; the choice is remembered.
const partyShown = () => { try { return localStorage.getItem('pv.party') !== 'hidden'; } catch { return true; } };
function setPartyShown(on) {
  const el = $('#party');
  if (!el) return;
  el.classList.toggle('folded', !on);
  $('.bx').classList.toggle('party-folded', !on);
  const t = $('.party-toggle', el);
  t.setAttribute('aria-expanded', on);
  t.title = on ? 'Hide the party' : 'Show the party';
  // the boxes change size with the column: redraw the sprites at their new size
  requestAnimationFrame(() => requestAnimationFrame(refitPixelIcons));
}
$('#party .party-toggle')?.addEventListener('click', e => {
  e.stopPropagation();
  const on = !partyShown();
  try { localStorage.setItem('pv.party', on ? 'shown' : 'hidden'); } catch { /* still toggles for now */ }
  setPartyShown(on);
  window.sfx?.tick?.();
});
$('#party .party-head')?.addEventListener('click', e => { if (!partyShown() && !e.target.closest('.party-toggle')) $('#party .party-toggle').click(); });


/* ---------------- cursor & detail panel (right side) ---------------- */

function gridSize(side) {
  return side === 'vault' ? (state.status?.boxSize ?? 30) : (game()?.slotsPerBox ?? 30);
}

function setCursor(i) {
  state.cursorHidden = false;
  const side = state.pane;
  const size = gridSize(side);
  const next = Math.max(0, Math.min(size - 1, i));
  if (next !== state.cursor) window.sfx?.tick();
  state.cursor = next;
  $$(`#pane-${side} .slot`).forEach(s => s.classList.toggle('cursor', +s.dataset.index === state.cursor));
}

// The panel on the right shows the Pokémon you clicked (or the one in your hand), not whatever the mouse is over.
function shownMon(side) {
  if (state.pick && state.pick.from === side) return state.pick.mon;
  if (state.shown?.side !== side) return null;
  return state.slots[side].find(m => m && key(side, m) === state.shown.k) ?? null;
}
// The Pokémon's cry (from the PokeAPI cries collection, cached by the server). A new one cuts off the last.
const cryCache = new Map();
let crySource = null;
async function playCry(m) {
  if (!m || m.isEgg || !m.spriteId || window.sfx?.muted) return;
  const A = window.sfx?.audio?.();
  if (!A) return;
  let p = cryCache.get(m.spriteId);
  if (!p) {
    p = fetch(`/cries/${m.spriteId}.ogg`).then(r => (r.ok ? r.arrayBuffer() : null))
      .then(b => (b ? A.ctx.decodeAudioData(b) : null)).catch(() => null);
    cryCache.set(m.spriteId, p);
    p.then(b => { if (!b) cryCache.delete(m.spriteId); });   // try again next time if it failed
  }
  const buf = await p;
  if (!buf || window.sfx.muted) return;
  try { crySource?.stop(); } catch { /* already finished */ }
  const src = A.ctx.createBufferSource(), g = A.ctx.createGain();
  src.buffer = buf; g.gain.value = 0.85;
  src.connect(g).connect(A.master);
  src.start();
  crySource = src;
}

function showMon(side, m) {
  if (m && (state.shown?.side !== side || state.shown?.k !== key(side, m))) playCry(m);
  state.shown = m ? { side, k: key(side, m) } : null;
  const at = m ? state.slots[side].indexOf(m) : -1;
  for (const sd of ['game', 'vault', 'party']) slotEls(sd).forEach(el => el.classList.toggle('shown', sd === side && +el.dataset.index === at));
  renderDetail(side, m);
}

function renderDetail(side, m) {
  const d = $('#detail');
  if (!d) return;
  // The side summary panel is switched off: details live in Check Summary (right click / A → Check Summary).
  d.classList.add('empty'); d.replaceChildren();
  if (d) return;
  const g = game();
  const gender = m.isEgg ? '' : m.gender === 0 ? '<span class="dt-g m">♂</span>' : m.gender === 1 ? '<span class="dt-g f">♀</span>' : '';
  d.innerHTML = `
    <div class="dt-head"><span class="dt-dot"></span><b class="dt-name">${esc(name(m))}</b>
      ${m.isEgg ? '' : `<span class="dt-lv">Lv. ${m.level}</span>`}${gender}
      <button class="dt-close" type="button" aria-label="Close" title="Close">${ico('close')}</button></div>
    <div class="dt-stage"><div class="dt-ring"></div><div class="dt-img"></div>${m.shiny ? '<span class="dt-shiny" title="Shiny">★</span>' : ''}</div>
    <div class="dt-body">
      <div class="badges">${m.types.map(typeChip).join(' ')}${m.teraType ? ` <span class="badge">Tera ${esc(m.teraType)}</span>` : ''}</div>
      <dl class="facts">
        ${m.isNicknamed && !m.isEgg ? `<dt>Species</dt><dd>${esc(m.speciesName)}</dd>` : ''}
        <dt>Nature</dt><dd>${esc(m.nature)}</dd>
        <dt>Ability</dt><dd>${esc(m.ability)}</dd>
        <dt>Held item</dt><dd>${esc(m.heldItem || '—')}</dd>
        <dt>OT</dt><dd>${esc(m.ot)} · ${esc(m.tid)}</dd>
        <dt>From</dt><dd>${esc(m.origin || '?')}</dd>
      </dl>
    </div>`;
  const pic = $('.dt-img', d);
  pic.append(img(monRenderUrls(m), name(m), '', m.speciesName));
  pic.title = 'Summary';
  pic.addEventListener('click', () => openSummary(side, m));
  $('.dt-close', d).addEventListener('click', () => { window.sfx?.tick(); showMon(side, null); });
}

/* ---------------- slot interaction ---------------- */

function isPickTarget(side) {
  return !!state.pick && (dual() || paneOf(side) === state.pane);
}

async function onSlot(side, i) {
  const m = state.slots[side][i];
  state.highlightGame = null;   // a catch alert's marker goes away once you start using the box

  if (state.pick) {
    if (paneOf(side) !== state.pane) { if (!dual()) return; focusPane(paneOf(side), side === 'party' ? 0 : i); }
    if (side !== 'party') state.cursor = i;
    await putDown(side, i);
    return;
  }

  if (state.select) {
    if (state.select.side !== paneOf(side)) { toast('Finish or cancel your selection first.'); return; }
    if (!m) return;
    const k = key(side, m);
    if (state.select.items.has(k)) state.select.items.delete(k); else state.select.items.set(k, m);
    window.sfx?.select();
    render(paneOf(side));
    updateActionBar();
    return;
  }

  // Left click shows the Pokémon (with its cry); clicking it again picks it up. Right click opens its menu.
  closeMonMenu(true);
  if (side === 'party') {
    if (state.pane !== 'game' && dual()) focusPane('game', state.cursor);
  } else {
    if (side !== state.pane && dual()) focusPane(side, i);
    if (state.cursor !== i || side !== state.pane) setCursor(i);
  }
  if (!m) { showMon(side, null); return; }
  if (state.shown?.side !== side || state.shown.k !== key(side, m)) { window.sfx?.select(); showMon(side, m); return; }
  if (m.locked) { toast('The game has locked that slot.', true); return; }
  grab(side, m);
}
// Right click (or Enter): the HOME-style menu — Move, Check Summary, Quit.
function slotMenu(side, i) {
  const m = state.slots[side][i];
  if (!m || state.pick || state.select) return false;
  if (side !== 'party') {
    if (side !== state.pane && dual()) focusPane(side, i);
    if (state.cursor !== i || side !== state.pane) setCursor(i);
  }
  if (state.shown?.side !== side || state.shown.k !== key(side, m)) showMon(side, m);
  openMonMenu(side, i, m);
  return true;
}

function onDrop(fromSide, fromIndex, toSide, toIndex) {
  const m = state.slots[fromSide][fromIndex];
  const target = state.slots[toSide][toIndex];
  if (!m) return;
  if (fromSide === 'party' || toSide === 'party') {
    if (fromSide === toSide && fromIndex === toIndex) return;
    state.pick = { from: fromSide, mon: m, gameId: state.gameId };
    putDown(toSide, toIndex);
    return;
  }
  if (fromSide === 'game' && toSide === 'vault') {
    if (target && !target.awayIn) return toast('Drop it on an empty vault slot.');   // or on its own AWAY slot
    deposit([m], false, state.box.vault, toIndex);
  } else if (fromSide === 'vault' && toSide === 'game') {
    if (target) return toast(`Drop it on an empty slot in ${game()?.game}.`);
    withdraw([m.id], state.box.game, toIndex);
  } else if (fromSide === 'vault' && toSide === 'vault') {
    if (fromIndex !== toIndex) vaultMove(m.id, state.box.vault, toIndex);
  } else if (fromIndex !== toIndex) {
    gameMove(state.box.game, fromIndex, state.box.game, toIndex);
  }
}

/* ---------------- transfers ---------------- */

async function run(fn) {
  if (state.busy) return;
  state.busy = true;
  document.body.style.cursor = 'progress';
  try { await fn(); } catch (e) { fail(e); }
  finally { state.busy = false; document.body.style.cursor = ''; }
}

function reportSkips(r, verb) {
  if (!r.skipped?.length) return;
  showDialog(`<h2>${r.done.length ? `${r.done.length} ${verb}, ${r.skipped.length} skipped` : 'Nothing moved'}</h2>
    <ul class="skips">${r.skipped.map(s => `<li><b>${esc(s.name)}</b>: ${esc(s.reason)}</li>`).join('')}</ul>`);
}

const deposit = (mons, copy, vaultBox, vaultSlot) => run(async () => {
  const r = await api('/api/deposit', {
    body: { gameId: state.gameId, slots: mons.map(m => ({ box: m.box, slot: m.slot })), copy, vaultBox, vaultSlot },
  });
  closeSheet(); endSelect();
  if (r.done.length) window.sfx?.place();
  if (r.box != null) state.box.vault = r.box;
  const home = (r.trips ?? []).filter(t => t.back);
  if (home.length && !copy) toast(home.length === 1 && r.done.length === 1
    ? `${home[0].name} is back from ${home[0].game}, with everything it did there.`
    : `${r.done.length} Pokémon moved to the Vault (${home.length} back from a trip, with their progress).`);
  else if (r.done.length) toast(r.done.length === 1
    ? `${name(r.done[0])} was ${copy ? 'copied' : 'moved'} to the Vault.`
    : `${r.done.length} Pokémon ${copy ? 'copied' : 'moved'} to the Vault.`);
  reportSkips(r, copy ? 'copied' : 'moved');
  await refreshAll();
});

const withdraw = (ids, box, slot) => run(async () => {
  const g = game();
  const r = await api('/api/withdraw', { body: { gameId: state.gameId, ids, box, slot } });
  closeSheet(); endSelect();
  if (r.done.length) window.sfx?.place();
  if (r.box != null && r.box >= 0) state.box.game = r.box;
  const trips = (r.trips ?? []).filter(t => !t.back);
  if (trips.length && !r.skipped?.length) tripDialog(trips, g.game);
  else if (r.done.length) toast(r.done.length === 1 ? `${name(r.done[0])} was sent to ${g.game}.` : `${r.done.length} Pokémon sent to ${g.game}.`);
  reportSkips(r, 'sent');
  await refreshAll();
});

// A Pokémon sent to an older game: what changed for the trip, and that the original waits in the Vault.
function tripDialog(trips, game) {
  const one = trips.length === 1;
  showDialog(`<h2>${one ? `${esc(trips[0].name)} is visiting ${esc(game)}` : `${trips.length} Pokémon are visiting ${esc(game)}`}</h2>
    <p class="trip-note">${one ? 'The original stays in the Vault, marked Away' : 'The originals stay in the Vault, marked Away'}.
      Bring ${one ? 'it' : 'them'} back to the Vault and ${one ? 'it gets' : 'they get'} everything back: moves, ability, ball,
      Tera type and ribbons, plus anything new from ${esc(game)} (levels, evolutions, EVs, new moves, ribbons).</p>
    ${trips.some(t => t.swaps.length) ? `<ul class="skips">${trips.filter(t => t.swaps.length).map(t =>
      `<li><b>${esc(t.name)}</b>: ${t.swaps.map(s => `${esc(s.from)} → ${esc(s.to)}`).join(', ')}</li>`).join('')}</ul>
      <p class="trip-note">${esc(game)} doesn't have ${trips.reduce((n, t) => n + t.swaps.length, 0) === 1 ? 'that move' : 'those moves'}, so the closest ${trips.reduce((n, t) => n + t.swaps.length, 0) === 1 ? 'one' : 'ones'} it can learn there stand in for now.</p>` : ''}`);
}

const vaultMove = (id, box, slot) => run(async () => {
  await api('/api/vault/move', { body: { id, box, slot } });
  window.sfx?.place();
  closeSheet();
  await loadBox('vault');
  await loadStatus();
});

/* ---------------- compatibility glow ---------------- */

// While a Vault Pokémon is dragged or held next to a game box, the box glows green if it can go in,
// or greys out with the reason (a newer generation, not in that game, Ryujinx open…).
const compatCache = new Map();
async function compatFor(mon) {
  const k = `${state.gameId}|${mon.id}|${state.status?.emulatorRunning ? 1 : 0}`;
  if (!compatCache.has(k)) {
    const r = await api(`/api/games/${encodeURIComponent(state.gameId)}/accepts?ids=${encodeURIComponent(mon.id)}`);
    compatCache.set(k, r[mon.id] ?? null);
  }
  return compatCache.get(k);
}
function clearCompat() {
  state.compatFor = null;
  const box = $('#pane-game .box');
  box.classList.remove('accepts', 'rejects');
  delete box.dataset.why;
}
async function showCompat(mon) {
  clearCompat();
  if (!mon?.id || !state.gameId || !dual()) return;
  state.compatFor = mon.id;
  const c = await compatFor(mon).catch(() => null);
  if (!c || state.compatFor !== mon.id) return;   // dropped or put back meanwhile
  const box = $('#pane-game .box');
  box.classList.add(c.ok ? 'accepts' : 'rejects');
  box.dataset.why = c.ok ? `${name(mon)} can go into ${game()?.game ?? 'this game'}` : c.why;
}

/* ---------------- select & pick modes ---------------- */

function startSelect(side) {
  if (state.select?.side === side) return endSelect();
  endPick();
  state.select = { side, items: new Map() };
  window.sfx?.multi(true);
  render('game'); render('vault');
  updateActionBar();
}
function endSelect() {
  if (!state.select) return;
  state.select = null;
  window.sfx?.multi(false);
  render('game'); render('vault');
  updateActionBar();
}
// Pick a Pokémon up (like the game's move mode). It stays "in hand" while you change box or switch
// between your games and the Vault; clicking a slot puts it down there.
function grab(side, mon) {
  endSelect();
  window.sfx?.select();
  state.pick = { from: side, mon, gameId: state.gameId };
  closeSheet();
  render('game'); render('vault');
  updateActionBar();
  if (side === 'vault') showCompat(mon);
}
function startPick(kind, from, mon) {
  grab(from, mon);
  if (kind === 'withdraw') setPane('game');
  else setPane('vault');
}
function isHeld(side, m) {
  const p = state.pick;
  if (!p?.mon || !m || p.from !== side) return false;
  return side === 'vault' ? p.mon.id === m.id
    : p.gameId === state.gameId && p.mon.box === m.box && p.mon.slot === m.slot;
}
const gameMove = (fromBox, fromSlot, toBox, toSlot) => run(async () => {
  await api(`/api/games/${state.gameId}/move`, { body: { fromBox, fromSlot, toBox, toSlot } });
  window.sfx?.place();
  closeSheet();
  await loadStatus(); await loadGameBoxes(); await loadBox('game');
});
// Put the held Pokémon down in slot i of the box that is on screen.
async function putDown(side, i) {
  const { from, mon, gameId } = state.pick;
  const target = state.slots[side][i];
  if (isHeld(side, target)) { endPick(); return; }                 // same slot: put it back
  if (side === 'party' || from === 'party') {
    const inGame = s => s === 'game' || s === 'party';
    if (inGame(from) && inGame(side)) {                               // party ⇄ party, box ⇄ party
      if (gameId !== state.gameId) { toast('To move between games, put it in the Vault first, then send it on.'); return; }
      endPick(); await gameMove(from === 'party' ? -1 : mon.box, mon.slot, side === 'party' ? -1 : state.box.game, side === 'party' ? i : i); return;
    }
    if (from === 'vault') {                                           // Vault → party: joins the end of the party
      if (target) { toast('Pick an empty party slot.'); return; }
      endPick(); await withdraw([mon.id], -1, null); return;
    }
    // party → Vault
    if (target && !target.awayIn) { toast('Moving between a game and the Vault needs an empty slot. Pick an empty one.'); return; }
    endPick();
    if (gameId !== state.gameId) await selectGame(gameId);
    await deposit([mon], false, state.box.vault, i);
    return;
  }
  if (from === 'vault' && side === 'vault') { endPick(); await vaultMove(mon.id, state.box.vault, i); return; }
  if (from === 'game' && side === 'game') {
    if (gameId !== state.gameId) { toast('To move between games, put it in the Vault first, then send it on.'); return; }
    endPick(); await gameMove(mon.box, mon.slot, state.box.game, i); return;
  }
  // a game Pokémon may also land on an AWAY slot: that's where its original waits (the server checks it's the one)
  if (target && !(from === 'game' && side === 'vault' && target.awayIn)) {
    toast('Moving between a game and the Vault needs an empty slot. Pick an empty one.'); return;
  }
  endPick();
  if (from === 'game') {                                            // game → Vault
    if (gameId !== state.gameId) await selectGame(gameId);
    await deposit([mon], false, state.box.vault, i);
  } else {                                                          // Vault → game
    await withdraw([mon.id], state.box.game, i);
  }
}
function endPick() {
  if (!state.pick) return;
  state.pick = null;
  clearCompat();
  render('game'); render('vault');
  updateActionBar();
}

function updateActionBar() {
  const bar = $('#actionbar');
  const btns = $('#abButtons');
  btns.replaceChildren();
  const add = (label, cls, fn, disabled, title) => {
    const b = document.createElement('button');
    b.type = 'button'; b.className = 'btn small ' + cls; b.textContent = label; b.disabled = !!disabled;
    if (title) b.title = title;
    b.addEventListener('click', fn);
    btns.append(b);
  };

  if (state.pick) {
    const { mon } = state.pick;
    $('#abText').textContent = `Holding ${name(mon)}`;
    add('Put back', 'ghost', endPick);
    bar.hidden = false;
    return;
  }
  if (state.select) {
    const { side, items } = state.select;
    const mons = [...items.values()];
    const n = mons.length;
    const g = game();
    $('#abText').textContent = `${n} selected`;
    if (side === 'game') {
      const canMove = gameWritable(g) && g?.canMove;
      add(`Move to Vault`, '', () => deposit(mons.filter(m => !m.locked), false, state.box.vault), !n || !canMove,
        !g?.canMove ? 'This game can only be copied from' : !gameWritable(g) ? 'Close Ryujinx to move' : '');
      add('Copy to Vault', 'ghost', () => deposit(mons, true, state.box.vault), !n);
    } else {
      add(`Send to ${g?.game ?? 'game'}`, '', () => withdraw(mons.map(m => m.id), state.box.game), !n || !gameWritable(g) || !g?.canMove);
      add('Move to box…', 'ghost', () => boxPicker('vault', b => run(async () => {
        const r = await api('/api/vault/move-many', { body: { ids: mons.map(m => m.id), box: b } });
        toast(r.moved < n ? `Moved ${r.moved}; that box is full.` : `Moved ${r.moved} Pokémon.`);
        endSelect(); state.box.vault = b; await loadStatus(); await loadBox('vault');
      })), !n);
      add('Release', 'danger', () => {
        if (!confirm(`Release ${n} Pokémon from the vault? Their files are kept in data/released, but they leave your boxes.`)) return;
        run(async () => {
          const r = await api('/api/vault/release', { body: { ids: mons.map(m => m.id) } });
          toast(`Released ${r.released} Pokémon.`); endSelect(); await refreshAll();
        });
      }, !n);
    }
    add('Done', 'ghost', endSelect);
    bar.hidden = false;
    return;
  }
  bar.hidden = true;
}

/* ---------------- summary sheet ---------------- */

function judge(iv) {
  if (iv >= 31) return ['Best', 'best'];
  if (iv === 30) return ['Fantastic', ''];
  if (iv >= 26) return ['Very Good', ''];
  if (iv >= 16) return ['Pretty Good', ''];
  if (iv >= 1) return ['Decent', ''];
  return ['No Good', 'no'];
}

function hexChart(stats) {
  // Clockwise from the top: HP, Atk, Def, Spe, SpD, SpA (like the in-game chart).
  const order = [0, 1, 2, 5, 4, 3];
  const labels = ['HP', 'Atk', 'Def', 'Spe', 'SpD', 'SpA'];
  const cx = 115, cy = 108, R = 72;
  const max = Math.max(...stats, 1);
  const pt = (i, r) => {
    const a = (-90 + i * 60) * Math.PI / 180;
    return [cx + r * Math.cos(a), cy + r * Math.sin(a)];
  };
  const ring = f => order.map((_, i) => pt(i, R * f).join(',')).join(' ');
  const shape = order.map((s, i) => pt(i, 10 + (R - 10) * (stats[s] / max)).join(',')).join(' ');
  const text = order.map((s, i) => {
    const [x, y] = pt(i, R + 20);
    return `<text x="${x}" y="${y - 3}" text-anchor="middle" font-size="11" fill="currentColor" opacity=".65">${labels[i]}</text>
            <text x="${x}" y="${y + 10}" text-anchor="middle" font-size="12" font-weight="700" fill="currentColor">${stats[s]}</text>`;
  }).join('');
  return `<svg class="hex" viewBox="0 0 230 216" role="img" aria-label="Stat chart">
    <polygon points="${ring(1)}" fill="var(--card2)" stroke="var(--line)"/>
    <polygon points="${ring(.66)}" fill="none" stroke="var(--line)"/>
    <polygon points="${ring(.33)}" fill="none" stroke="var(--line)"/>
    ${order.map((_, i) => `<line x1="${cx}" y1="${cy}" x2="${pt(i, R)[0]}" y2="${pt(i, R)[1]}" stroke="var(--line)"/>`).join('')}
    <polygon points="${shape}" fill="color-mix(in srgb, var(--accent) 45%, transparent)" stroke="var(--accent)" stroke-width="2"/>
    ${text}</svg>`;
}

/* ---------------- Pokémon menu (shown when you click a Pokémon) ---------------- */

let menu = null;
const MENU_ITEMS = [['move', 'Move'], ['summary', 'Check Summary'], ['quit', 'Quit']];
const menuItems = (side, m) => side === 'vault' && m.awayIn
  ? [['move', 'Move'], ['summary', 'Check Summary'], ['endtrip', 'Stop waiting'], ['quit', 'Quit']] : MENU_ITEMS;

function openMonMenu(side, i, m) {
  closeMonMenu(true);
  const slot = slotEls(side)[i];
  if (!slot) return;
  const el = document.createElement('div');
  el.className = 'mon-menu';
  el.setAttribute('role', 'menu');
  const items = menuItems(side, m);
  el.innerHTML = `<div class="mm-head">${esc(m.isEgg ? 'Egg' : `${name(m)} (Lv. ${m.level})`)}${side === 'vault' && m.awayIn
      ? `<small>Away in ${esc(m.awayIn)}</small>` : ''}</div>` +
    items.map(([a, l], k) => `<button type="button" role="menuitem" data-a="${a}" data-k="${k}" class="${k === 0 ? 'on' : ''}">${l}</button>`).join('');
  document.body.append(el);
  const r = slot.getBoundingClientRect(), w = el.offsetWidth, h = el.offsetHeight;
  let left = r.right + 12, from = 'right';
  if (left + w > innerWidth - 10) { left = r.left - w - 12; from = 'left'; }
  el.style.left = `${Math.max(10, left)}px`;
  el.style.top = `${Math.max(10, Math.min(innerHeight - h - 10, r.top + r.height / 2 - h / 2))}px`;
  el.classList.add(from);
  menu = { side, i, m, el, k: 0, items };
  el.addEventListener('pointerover', e => { const b = e.target.closest('button[data-k]'); if (b) menuFocus(+b.dataset.k); });
  el.addEventListener('click', e => { const b = e.target.closest('button[data-a]'); if (b) menuDo(b.dataset.a); });
  window.sfx?.menu?.();
}
function menuFocus(k) {
  if (!menu) return;
  k = (k + menu.items.length) % menu.items.length;
  if (k === menu.k) return;
  menu.k = k;
  $$('button[data-k]', menu.el).forEach(b => b.classList.toggle('on', +b.dataset.k === k));
  window.sfx?.tick();
}
function closeMonMenu(silent) {
  if (!menu) return;
  const el = menu.el;
  menu = null;
  el.classList.add('closing');
  setTimeout(() => el.replaceWith(), 130);
  if (!silent) window.sfx?.back?.();
}
function menuDo(a) {
  if (!menu) return;
  const { side, m } = menu;
  if (a === 'quit') return closeMonMenu();
  closeMonMenu(true);
  if (a === 'move') {
    if (m.locked) return toast('The game has locked that slot.', true);
    grab(side, m);
  } else if (a === 'summary') openSummary(side, m);
  else if (a === 'endtrip') {
    if (!confirm(`Stop waiting for ${name(m)} to come back from ${m.awayIn}?\n\nThis one in the Vault is unlocked as it is now. `
      + `The copy in ${m.awayIn} becomes a separate Pokémon, and moving it to the Vault later adds it as a new one.`)) return;
    run(async () => {
      await api(`/api/vault/${encodeURIComponent(m.id)}/end-trip`, { method: 'POST' });
      toast(`${name(m)} is no longer waiting for ${m.awayIn}.`);
      await refreshAll();
    });
  }
}
document.addEventListener('pointerdown', e => {
  if (menu && !menu.el.contains(e.target) && !e.target.closest('.slot')) closeMonMenu(true);
}, true);
addEventListener('resize', () => closeMonMenu(true));

/* ---------------- Change View: box view ⇄ list view ---------------- */

function toggleListView(on = !$('.bx').classList.contains('list-view')) {
  $('.bx').classList.toggle('list-view', on);
  try { localStorage.setItem('pv.listView', on ? '1' : '0'); } catch { /* ignore */ }
  requestAnimationFrame(() => requestAnimationFrame(refitPixelIcons));
}

/* ---------------- Check Summary (full screen) ---------------- */

const sum = { side: null, list: [], i: 0, view: 'stats', move: -1, moveOpen: false, ribbons: false, panel: null };
const overall = t => (t >= 151 ? 'Outstanding stats' : t >= 121 ? 'Great stats' : t >= 91 ? 'Good stats' : 'OK stats');

function openSummary(side, m) {
  closeMonMenu(true);
  sum.move = -1;
  const list = state.slots[side]?.filter(Boolean) ?? [];
  const i = list.findIndex(x => key(side, x) === key(side, m));
  sum.side = paneOf(side);
  sum.list = i >= 0 ? list : [m];
  sum.i = Math.max(0, i);
  const el = $('#summary');
  if (el.hidden) {
    el.hidden = false;
    el.classList.add('opening');
    setTimeout(() => el.classList.toggle('opening', false), 500);
    window.sfx?.sheet?.();
  }
  renderSummary(0);
}
function closeSummary() {
  const el = $('#summary');
  if (el.hidden || el.classList.contains('closing')) return;
  window.sfx?.back?.();
  el.classList.add('closing');
  setTimeout(() => { el.hidden = true; el.classList.toggle('closing', false); el.replaceChildren(); }, 230);
}
function stepSummary(d) {
  if (sum.list.length < 2) return;
  sum.i = (sum.i + d + sum.list.length) % sum.list.length;
  window.sfx?.page?.();
  renderSummary(d);
}
function setStatsView(v) {
  if (v === sum.view) return;
  sum.view = v;
  window.sfx?.tick();
  const m = sum.list[sum.i], el = $('#summary');
  $('.sm-hex', el).innerHTML = summaryHex(m, v);
  $('.sm-caption', el).textContent = statsCaption(m, v);
  $$('.sm-tabs button', el).forEach(b => b.classList.toggle('on', b.dataset.v === v));
}
const cycleStatsView = () => setStatsView({ stats: 'judge', judge: 'effort', effort: 'stats' }[sum.view]);
const statsCaption = (m, v) => v === 'judge' ? overall(m.ivs.reduce((a, b) => a + b, 0))
  : v === 'effort' ? `Effort ${m.evs.reduce((a, b) => a + b, 0)} / 510` : `Total ${m.stats.reduce((a, b) => a + b, 0)}`;

// The hexagon: HP at the top, then Attack, Defense, Speed, Sp. Def and Sp. Atk going clockwise.
function summaryHex(m, view) {
  const order = [0, 1, 2, 5, 4, 3], names = ['HP', 'Attack', 'Defense', 'Speed', 'Sp. Def', 'Sp. Atk'];
  const cx = 180, cy = 150, R = 100;
  const max = Math.max(...m.stats, 1);
  const val = s => Math.min(1, Math.max(0, view === 'judge' ? m.ivs[s] / 31 : view === 'effort' ? m.evs[s] / 252 : m.stats[s] / max));
  const lab = s => (view === 'judge' ? judge(m.ivs[s])[0] : view === 'effort' ? m.evs[s] : m.stats[s]);
  const pt = (i, r) => { const a = (-90 + i * 60) * Math.PI / 180; return [cx + r * Math.cos(a), cy + r * Math.sin(a)]; };
  const poly = f => order.map((s, i) => pt(i, f(s)).map(n => n.toFixed(1)).join(',')).join(' ');
  // HP above, Speed below, the others beside the corners (like HOME)
  const at = i => { const [x, y] = pt(i, R); return i === 0 ? [x, y - 34] : i === 3 ? [x, y + 22] : [x + (i < 3 ? 56 : -56), y - 6]; };
  const labels = order.map((s, i) => {
    const [x, y] = at(i);
    const best = view === 'judge' && m.ivs[s] >= 31;
    return `<text x="${x.toFixed(1)}" y="${y.toFixed(1)}" class="hx-name">${names[i]}</text>
      <text x="${x.toFixed(1)}" y="${(y + 19).toFixed(1)}" class="hx-val${best ? ' best' : ''}">${esc(String(lab(s)))}</text>`;
  }).join('');
  const spokes = order.map((_, i) => { const [x, y] = pt(i, R); return `<line x1="${cx}" y1="${cy}" x2="${x.toFixed(1)}" y2="${y.toFixed(1)}"/>`; }).join('');
  return `<svg viewBox="0 0 360 302" class="sm-hexsvg" role="img" aria-label="Stats">
    <polygon class="hx-ring" points="${poly(() => R)}"/>
    <polygon class="hx-ring2" points="${poly(() => R * 0.5)}"/>
    <g class="hx-spokes">${spokes}</g>
    <polygon class="hx-shape" points="${poly(s => 6 + (R - 6) * val(s))}" style="transform-origin:${cx}px ${cy}px"/>
    ${labels}</svg>`;
}

function renderSummary(dir = 0) {
  const m = sum.list[sum.i];
  if (!m) return closeSummary();
  sum.moveOpen = false; sum.ribbons = false; sum.panel = null;
  sum.move = Math.min(Math.max(sum.move ?? -1, -1), (m.moves?.length ?? 0) - 1);
  const el = $('#summary');
  const n = sum.list.length;
  const prev = sum.list[(sum.i - 1 + n) % n], next = sum.list[(sum.i + 1) % n];
  const dex = String(m.species).padStart(4, '0');
  const ribbons = m.ribbons ?? [];
  el.innerHTML = `
    <div class="sm-top">
      <div class="sm-title"><span class="sm-logo">${ico('vault')}</span>Check Summary</div>
      <button class="sm-x" type="button" data-a="back" aria-label="Close" title="Close (Esc)">${ico('close')}</button>
    </div>
    <div class="sm-bar">
      <button class="sm-nav" type="button" data-a="prev" ${n < 2 ? 'disabled' : ''} title="Previous (← / L)"><span class="sm-mini" data-m="prev"></span>${ico('prev')}${kh('L', 'LB')}</button>
      <div class="sm-who">
        <span class="sm-ball" aria-hidden="true"></span><b>${esc(name(m))}</b>${genderMark(m)}
        ${m.isEgg ? '' : `<span class="sm-lv">Lv. ${m.level}</span>`}${originMark(m)}
        ${langTag(m.language) ? `<span class="sm-lang" title="Language: ${esc(m.language)}">${langTag(m.language)}</span>` : ''}
        ${gameStamp(sum.side, m)}
      </div>
      <button class="sm-nav" type="button" data-a="next" ${n < 2 ? 'disabled' : ''} title="Next (→ / R)">${kh('R', 'RB')}${ico('next')}<span class="sm-mini" data-m="next"></span></button>
    </div>
    <div class="sm-body ${dir > 0 ? 'in-right' : dir < 0 ? 'in-left' : 'in-pop'}">
      <section class="sm-col sm-hexcol">
        <div class="sm-tabs">${[['stats', 'Stats'], ['judge', 'Judge'], ['effort', 'Effort']].map(([v, l]) =>
          `<button type="button" data-v="${v}" class="${v === sum.view ? 'on' : ''}">${l}</button>`).join('')}</div>
        <div class="sm-hex">${summaryHex(m, sum.view)}</div>
        <div class="sm-caption">${statsCaption(m, sum.view)}</div>
        <dl class="sm-table">
          <dt>Nature</dt><dd>${esc(m.nature)}</dd>
          <dt>Ability</dt><dd>${esc(m.ability || '———')}</dd>
          <dt>Held Item</dt><dd>${esc(m.heldItem || 'None')}</dd>
          ${m.teraType ? `<dt>Tera Type</dt><dd>${typeChip(m.teraType)}</dd>` : ''}
        </dl>
      </section>
      <section class="sm-col sm-movecol">
        <div class="sm-card sm-movecard">
          <div class="sm-card-head"><span class="sm-no">No. ${dex}</span><b>${esc(m.speciesName)}</b><span class="sm-types">${m.types.map(t => typeIcon(t, 'sm-tdot')).join('')}</span></div>
          <ul class="sm-moves" role="listbox" aria-label="Moves">${m.moves.map((x, k) => `<li role="option" tabindex="-1" data-a="move" data-k="${k}"
              class="${k === sum.move ? 'on' : ''}" style="--tc:${TYPE_COLORS[x.type] ?? '#8a9a98'};--d:${120 + k * 70}ms" title="Show what ${esc(x.name)} does">
            ${x.mastered ? '<img class="sm-mastery" src="assets/marks/mastery.png" alt="" title="Mastered: can be used in Strong and Agile Style (Legends: Arceus)">' : ''}<span class="sm-mdot">${typeIcon(x.type) || typeGlyph(x.type)}</span><span class="sm-mname">${esc(x.name)}</span>
            ${x.maxPP ? `<span class="sm-pp">PP <b>${x.pp}</b>/${x.maxPP}</span>` : ''}</li>`).join('') || '<li class="none">No moves</li>'}</ul>
        </div>
      </section>
      <section class="sm-col sm-artcol">
        <div class="sm-stage"><div class="sm-glow"></div><div class="sm-art"></div>
          <div class="sm-gimmicks">${gimmickIcon(m.gimmick)}${m.teraType ? teraGem(m.teraType) : ''}</div></div>
        <div class="sm-status">
          ${m.pokerus ? `<img class="sm-sym" src="assets/marks/${m.pokerus === 2 ? 'pkrs-cured' : 'pkrs'}.png" alt="" title="Pokérus: ${m.pokerus === 2 ? 'cured' : 'infected'}">` : ''}
          ${m.shiny ? '<img class="sm-sym" src="assets/marks/shiny.png" alt="" title="Shiny">' : ''}
          ${m.markings?.length ? `<span class="sm-marks" title="Markings">${markingIcons(m.markings)}</span>` : ''}
        </div>
        <button class="sm-shelf ${ribbons.length ? '' : 'empty'}" type="button" data-a="ribbons" title="Ribbons and marks (T)">
          <span class="sm-shelf-icons">${ribbons.slice(0, 7).map(r => ribbonImg(r)).join('')}</span>
          <span class="sm-shelf-label">${ribbons.length ? `${ribbons.length} ribbon${ribbons.length === 1 ? '' : 's'}${ribbons.some(r => r.mark) ? ' & marks' : ''}` : 'No ribbons yet'}</span>
        </button>
      </section>
      <section class="sm-col sm-low"></section>
    </div>
    <div class="sm-foot">
      <button type="button" data-a="back">${kh('Esc', 'B')} Back</button>
      <span class="sm-hint">${kh(['↑', '↓'], 'dpad-ud')} moves · ${kh('Enter', 'A')} move details</span>
      <button type="button" data-a="ribbons">${kh('T', 'X')} Ribbons</button>
      <button type="button" data-a="view">${kh('Y', 'Y')} Change stats view</button>
      <button type="button" data-a="journey">${kh('J', 'RT')} Journey</button>
      <button type="button" data-a="share">${kh('C', '☰')} Share card</button>
    </div>`;
  $('.sm-art', el).append(img(monRenderUrls(m), name(m), '', m.speciesName));
  if (n > 1) for (const [k, mon] of [['prev', prev], ['next', next]]) $(`.sm-mini[data-m="${k}"]`, el)?.append(monIcon(mon));
  hookRibbonImgs(el);
  renderLow();
  el.onclick = e => {
    const b = e.target.closest('[data-a], [data-v]');
    if (!b) return;
    if (b.dataset.v) return setStatsView(b.dataset.v);
    if (b.dataset.a === 'move') return pickMove(+b.dataset.k, true);
    ({
      back: closeSummary, prev: () => stepSummary(-1), next: () => stepSummary(1), view: cycleStatsView,
      share: () => window.shareMonCard?.(sum.list[sum.i]),
      journey: () => togglePanel('journey'), 'close-panel': () => togglePanel(null),
      ribbons: () => toggleRibbons(), 'close-move': () => pickMove(sum.move, false), 'close-ribbons': () => toggleRibbons(false),
    })[b.dataset.a]?.();
  };
  playCry(m);
}

// The wide card under the moves: the trainer card, or the chosen move's details.
function renderLow() {
  const m = sum.list[sum.i], el = $('#summary .sm-low');
  if (!m || !el) return;
  const mv = sum.moveOpen ? m.moves[sum.move] : null;
  if (!mv) {
    const met = [m.metLocation ? `first met at <em>${esc(m.metLocation)}</em>` : '', m.metLevel ? `at Lv. ${m.metLevel}` : '', m.metDate ? `on ${esc(m.metDate)}` : '']
      .filter(Boolean).join(' ');
    el.innerHTML = `<div class="sm-card sm-ot swap">
      <div class="sm-otrow"><span>OT</span><b>${esc(m.ot)}</b><span>ID No.</span><b>${esc(m.tid)}</b></div>
      <div class="sm-otbody">
        <p>${met ? `Seems to have been ${met}.` : 'Where it was met is unknown.'}</p>
        <p>From <em>${esc(m.origin || '?')}</em>${m.ball ? ` · ${esc(m.ball)}` : ''}${m.characteristic ? `<br>Characteristic: ${esc(m.characteristic)}` : ''}</p>
      </div></div>`;
    return;
  }
  const tc = TYPE_COLORS[mv.type] ?? '#8a9a98';
  el.innerHTML = `<div class="sm-card sm-mvinfo swap" style="--tc:${tc}">
    <div class="sm-mvhead">
      <span class="sm-mdot">${typeIcon(mv.type) || typeGlyph(mv.type)}</span><b>${esc(mv.name)}</b>
      ${typeChip(mv.type || '?')}<span class="sm-cat" data-cat>…</span>
      <button type="button" class="sm-mvx" data-a="close-move" aria-label="Close move details" title="Close (Enter)">${ico('close')}</button>
    </div>
    <div class="sm-mvstats">
      <div><span>Power</span><b data-f="power">…</b></div>
      <div><span>Accuracy</span><b data-f="acc">…</b></div>
      <div><span>PP</span><b>${mv.maxPP ? `${mv.pp} / ${mv.maxPP}` : '—'}</b></div>
    </div>
    <p class="sm-mvdesc" data-f="desc">Loading…</p>
  </div>`;
  moveTable().then(t => {
    if (!el.isConnected || sum.list[sum.i] !== m || !sum.moveOpen || m.moves[sum.move] !== mv) return;
    const d = t?.[toId(mv.name)];
    const set = (f, v) => { const x = $(`[data-f="${f}"]`, el); if (x) x.textContent = v; };
    if (!d) { set('power', '—'); set('acc', '—'); set('desc', 'Move details need an internet connection the first time.'); $('[data-cat]', el).textContent = '—'; return; }
    const [cat, power, , acc, , , , desc] = d;
    const c = $('[data-cat]', el);
    c.innerHTML = `${catIcon(cat)}${esc(cat)}`; c.dataset.cat = cat;
    set('power', power ? String(power) : '—');
    set('acc', acc ? `${acc}%` : '—');
    set('desc', desc || 'No description.');
  });
}

let moveTablePromise = null;
const moveTable = () => (moveTablePromise ??= fetch('/api/moves').then(r => (r.ok ? r.json() : null)).catch(() => { moveTablePromise = null; return null; }));
const toId = s => String(s ?? '').toLowerCase().replace(/[^a-z0-9]/g, '');

// Move category: the Physical / Special split icons (from your image), and a matching Status one.
function catIcon(cat) {
  const f = cat === 'Physical' ? 'physical' : cat === 'Special' ? 'special' : 'status';
  return `<img class="sm-caticon" src="assets/moves/${f}.png" alt="" title="${esc(cat)}">`;
}
// Stamp = the LAST game the Pokémon was placed in (HOME's stamp): the save it is in now, or for the Vault the
// game it was brought from. Games with a stamp in your icon set use it; others get a lettered stamp.
const STAMPS = { SW: 'sw', SH: 'sh', BD: 'bd', SP: 'sp', PLA: 'pla', SL: 'sl', VL: 'vl', GP: 'lgp', GE: 'lge', GO: 'go', ZA: 'za' };
const STAMP_BY_NAME = [[/scarlet/i, 'sl'], [/violet/i, 'vl'], [/sword/i, 'sw'], [/shield/i, 'sh'], [/brilliant diamond/i, 'bd'],
  [/shining pearl/i, 'sp'], [/arceus/i, 'pla'], [/pikachu/i, 'lgp'], [/eevee/i, 'lge'], [/pok[eé]mon go\b|^go$/i, 'go'], [/z-a|\bza\b/i, 'za']];
function lastGame(side, m) {
  if (side === 'game') {
    const g = (state.status?.games ?? []).find(x => x.id === state.gameId);
    return g ? { name: g.game, version: g.version } : null;
  }
  const name = String(m.source ?? '').split(' · ')[0].trim();
  return name && !/^(recovered|imported file)$/i.test(name) ? { name } : null;
}
function gameStamp(side, m) {
  const lg = lastGame(side, m);
  if (!lg) return '';
  const f = STAMPS[lg.version] ?? STAMP_BY_NAME.find(([re]) => re.test(lg.name))?.[1];
  const title = `Stamp: last placed in ${esc(lg.name)}`;
  if (f) return `<span class="sm-stampring" title="${title}"><img class="sm-stamp" src="assets/stamps/${f}.png" alt="${esc(lg.name)}"></span>`;
  const letters = lg.name.replace(/^Pokémon\s+/i, '').split(/[^A-Za-z0-9]+/).filter(Boolean).map(w => w[0]).join('').slice(0, 3).toUpperCase();
  return `<span class="sm-stampring" title="${title}"><span class="sm-stamp txt">${esc(letters)}</span></span>`;
}
// Origin mark = where it was CAUGHT. Games before X/Y have no mark.
const ORIGIN_MARKS = { X: 'gen6', Y: 'gen6', AS: 'gen6', OR: 'gen6', SN: 'gen7', MN: 'gen7', US: 'gen7', UM: 'gen7',
  RD: 'vc', GN: 'vc', BU: 'vc', YW: 'vc', GD: 'vc', SI: 'vc', C: 'vc', GO: 'go', GP: 'lgpe', GE: 'lgpe', SW: 'galar', SH: 'galar',
  BD: 'bdsp', SP: 'bdsp', PLA: 'pla', SL: 'paldea', VL: 'paldea' };
const ORIGIN_NAMES = { gen6: 'Origin mark: Pentagon (X, Y, Omega Ruby, Alpha Sapphire)', gen7: 'Origin mark: Clover (Sun, Moon, Ultra Sun, Ultra Moon)',
  vc: 'Origin mark: Game Boy (Virtual Console)', go: 'Origin mark: Pokémon GO', lgpe: "Origin mark: Let's Go", galar: 'Origin mark: Galar (Sword, Shield)',
  bdsp: 'Origin mark: Triforce (Brilliant Diamond, Shining Pearl)', pla: 'Origin mark: Cross (Legends: Arceus)', paldea: 'Origin mark: Scarlet, Violet' };
const originMark = m => { const k = ORIGIN_MARKS[m.version]; return k ? `<img class="sm-origin" src="assets/marks/${k}.png" alt="" title="${ORIGIN_NAMES[k]}">` : ''; };
const LANGS = { Japanese: 'JPN', English: 'ENG', French: 'FRE', Italian: 'ITA', German: 'GER', Spanish: 'SP-EU', SpanishL: 'SP-LA', Korean: 'KOR', ChineseS: 'CHS', ChineseT: 'CHT' };
const langTag = l => LANGS[l] ?? '';
// Small original badges in the HOME style.
const MARK_SHAPES = ['<circle cx="10" cy="10" r="6.5"/>', '<path d="M10 3.5l7 12.5H3z"/>', '<rect x="4" y="4" width="12" height="12"/>',
  '<path d="M10 17s-6.5-4.2-6.5-8.5A3.5 3.5 0 0 1 10 6.6a3.5 3.5 0 0 1 6.5 1.9C16.5 12.8 10 17 10 17z"/>',
  '<path d="M10 2.8l2.1 4.5 4.9.6-3.6 3.4.9 4.9L10 13.8l-4.3 2.4.9-4.9L3 7.9l4.9-.6z"/>', '<path d="M10 2.5l7 7.5-7 7.5-7-7.5z"/>'];
const markingIcons = list => MARK_SHAPES.slice(0, Math.max(list.length, 0)).map((sh, i) =>
  `<svg viewBox="0 0 20 20" class="mk mk${list[i] ?? 0}" aria-hidden="true">${sh}</svg>`).join('');
// Tera Type: a faceted gem in the type's colour.
const teraGem = t => `<span class="sm-tera" style="--tc:${TYPE_COLORS[t] ?? '#8a9a98'}" title="Tera Type: ${esc(t)}"><svg viewBox="0 0 40 40" aria-hidden="true">
  <path d="M20 2l7 6 9 2-2 9 4 7-8 4-3 8-7-3-7 3-3-8-8-4 4-7-2-9 9-2z" fill="var(--tc)" stroke="#fff" stroke-width="2"/>
  <path d="M20 9l8 6-3 10H15l-3-10z" fill="rgba(255,255,255,.35)"/><path d="M20 9v16M12 15l13 10M28 15L15 25" stroke="rgba(255,255,255,.5)" stroke-width="1"/></svg>${typeIcon(t, 'sm-tera-ico') || `<b>${typeGlyph(t)}</b>`}</span>`;
function gimmickIcon(g) {
  if (g === 'gmax') return '<img class="sm-gimmick" src="assets/marks/gmax.png" alt="" title="Can Gigantamax">';
  if (g === 'alpha') return '<img class="sm-gimmick" src="assets/marks/alpha.png" alt="" title="Alpha Pokémon">';
  return '';
}
// A type's first two letters in a coloured circle.
const typeGlyph = t => esc((t || '?').slice(0, 2));

function pickMove(k, toggle) {
  const m = sum.list[sum.i];
  if (!m?.moves.length) return;
  k = Math.max(0, Math.min(m.moves.length - 1, k));
  const same = k === sum.move;
  sum.move = k;
  sum.moveOpen = toggle ? !(same && sum.moveOpen) : false;
  if (toggle) window.sfx?.[sum.moveOpen ? 'select' : 'back']?.(); else window.sfx?.tick();
  $$('#summary .sm-moves li[data-k]').forEach(li => li.classList.toggle('on', +li.dataset.k === k));
  renderLow();
}
// ↑/↓ move the highlight; once details are open they follow the highlight.
function stepMove(d) {
  const m = sum.list[sum.i];
  if (!m?.moves.length) return;
  const k = sum.move < 0 ? (d > 0 ? 0 : m.moves.length - 1) : (sum.move + d + m.moves.length) % m.moves.length;
  const open = sum.moveOpen;
  sum.move = k;
  window.sfx?.tick();
  $$('#summary .sm-moves li[data-k]').forEach(li => li.classList.toggle('on', +li.dataset.k === k));
  sum.moveOpen = open;
  if (open) renderLow();
}

// Ribbons: a panel over the moves and picture, listing every ribbon and mark.
function ribbonImg(r, big) {
  return `<span class="rb ${big ? 'big' : ''}" title="${esc(r.name)}${r.count > 1 ? ` ×${r.count}` : ''}"><img src="/ribbons/${esc(r.key)}.png" alt="" loading="lazy"><i>${esc(r.name.slice(0, 1))}</i></span>`;
}
function hookRibbonImgs(root) {
  $$('.rb img', root).forEach(im => {
    const ok = () => im.parentNode?.classList.add('ok');
    if (im.complete && im.naturalWidth) ok(); else im.addEventListener('load', ok, { once: true });
    im.addEventListener('error', () => im.remove(), { once: true });
  });
}
function toggleRibbons(on = !sum.ribbons) {
  const m = sum.list[sum.i], body = $('#summary .sm-body');
  if (!m || !body) return;
  sum.ribbons = on;
  sum.panel = null;
  $('.sm-ribbons', body)?.remove();
  window.sfx?.[on ? 'menu' : 'back']?.();
  if (!on) return;
  const rs = m.ribbons ?? [];
  const groups = [['Ribbons', rs.filter(r => !r.mark)], ['Marks', rs.filter(r => r.mark)]].filter(([, l]) => l.length);
  const panel = document.createElement('section');
  panel.className = 'sm-ribbons';
  panel.setAttribute('aria-label', 'Ribbons and marks');
  panel.innerHTML = `
    <div class="sm-rbhead"><b>Ribbons &amp; Marks</b><span>${rs.length}</span>
      <button type="button" class="sm-mvx" data-a="close-ribbons" aria-label="Close ribbons" title="Close (T / Esc)">${ico('close')}</button></div>
    <div class="sm-rbbody">${groups.length ? groups.map(([g, l]) => `<h4>${g}</h4><ul class="sm-rbgrid">${l.map((r, k) =>
      `<li style="--d:${Math.min(k, 24) * 22}ms">${ribbonImg(r, true)}<span>${esc(r.name)}${r.count > 1 ? ` <b>×${r.count}</b>` : ''}</span></li>`).join('')}</ul>`).join('')
      : '<p class="sm-rbnone">This Pokémon has no ribbons or marks yet.</p>'}</div>`;
  body.append(panel);
  hookRibbonImgs(panel);
}

/* ---------------- summary panel: journey ---------------- */

const JOURNEY_ICONS = { met: '🌿', route: '🧭', home: '🏠', caught: '✨', vault: '📦', game: '🎮', import: '📄', release: '🕊️', here: '📍' };
const journeyDate = d => d ? d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' })
  + (d.getHours() || d.getMinutes() ? ` · ${d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })}` : '') : '';

// The generation each kind of Pokémon data belongs to.
const FORMAT_GEN = { PK1: 1, PK2: 2, PK3: 3, CK3: 3, XK3: 3, PK4: 4, BK4: 4, RK4: 4, PK5: 5, PK6: 6, PK7: 7, PB7: 7, PK8: 8, PB8: 8, PA8: 8, PK9: 9, PA9: 9 };

// The generation of a game by its name, from your connected games (0 if it isn't one of them).
const genOfGame = name => (state.status?.games ?? []).find(g => g.game === name)?.generation ?? 0;

// The road from the game it was met in to the first game PokeVault saw it in. That stretch isn't recorded
// anywhere, so each generation in between is one of your games of that generation, or the games it could have been.
// Everything after that is what PokeVault recorded as it happened.
function routeSteps(m, fromGen, toGen) {
  if (!fromGen || !toGen || toGen <= fromGen || m.isEgg) return [];
  const steps = [];
  const yours = gen => (state.status?.games ?? []).find(g => g.supported && g.generation === gen && g.game !== m.origin)?.game;
  const GEN_GAMES = { 4: 'Diamond, Pearl, Platinum, HeartGold or SoulSilver', 5: 'Black, White, Black 2 or White 2',
    6: 'X, Y, Omega Ruby or Alpha Sapphire', 7: 'Sun, Moon, Ultra Sun or Ultra Moon' };
  const stop = gen => steps.push({ t: null, kind: 'route', text: `Traveled to ${yours(gen) ?? GEN_GAMES[gen]}` });
  if (fromGen <= 2 && toGen >= 7) stop(7);
  else {
    if (fromGen <= 3 && toGen >= 4) stop(4);
    if (fromGen <= 4 && toGen >= 5) stop(5);
    if (fromGen <= 5 && toGen >= 6) stop(6);
    if (fromGen <= 6 && toGen >= 7) stop(7);
  }
  if (toGen >= 8) steps.push({ t: null, kind: 'home', text: 'Traveled through Pokémon HOME' });
  return steps;
}

// The whole story: where it was met, how it got to the first game PokeVault saw it in, every move since,
// and finally where it is now: arrived in a game, or entered the Vault.
async function journeySteps(m, side) {
  const steps = [];
  const j = m.uid ? await api(`/api/journey/${encodeURIComponent(m.uid)}`).catch(() => null) : null;
  const here0 = side === 'game' ? game()?.game : null;
  if (j?.original) m = j.original;    // a copy on a trip: tell the original's story
  if (m.metLocation || m.metDate) steps.push({
    t: m.metDate ? new Date(`${m.metDate}T00:00:00`) : null, kind: 'met',
    text: `Met in ${m.origin || 'its first game'}${m.metLocation ? ` at ${m.metLocation}` : ''}${m.metLevel ? `, Lv. ${m.metLevel}` : ''}`,
  });
  const logged = (Array.isArray(j) ? j : j?.steps ?? [])
    .map(s => {
      // steps saved by older versions only have the sentence; read the game out of it
      let g = s.game;
      if (!g) g = (s.text.match(/^(?:Copied|Moved) from (.+) into the Vault/) ?? s.text.match(/^Sent from the Vault to (.+)$/)
        ?? s.text.match(/^Turned up in (.+?)(?: \(.*\))?$/))?.[1] ?? null;
      const copy = s.kind === 'vault' && /^Copied/.test(s.text);
      return { ...s, game: g, gen: s.gen || genOfGame(g), copy, t: new Date(s.time) };
    }).sort((a, b) => a.t - b.t);
  const source = (m.source || '').split('·')[0].trim();                 // "Scarlet · Alex" → "Scarlet"
  const fromImport = /import|recover/i.test(source);
  const here = here0;

  // the first game PokeVault knows it was in, and that game's generation
  const preVault = logged[0]?.kind === 'game' && !!source && !fromImport;   // in the Vault before moves were written down
  const first = preVault ? null : logged.find(s => s.game);
  const firstGame = first?.game ?? ((side === 'vault' || preVault) && source && !fromImport ? source : here);
  const firstGen = first?.gen || genOfGame(firstGame) || FORMAT_GEN[m.format] || 0;
  steps.push(...routeSteps(m, m.generation, firstGen));

  // it was already in the Vault before PokeVault started writing moves down
  let lastPlace = null;
  if (preVault) {
    steps.push({ t: m.added ? new Date(m.added) : null, kind: 'vault', text: `Entered the Vault from ${source}` });
    lastPlace = 'vault';
  }

  // every move PokeVault recorded, in plain words
  for (const s of logged) {
    if (s.kind === 'caught') {
      if (s.game && s.game !== m.origin && s.game !== lastPlace) steps.push({ t: s.t, kind: 'game', text: `Arrived in ${s.game}` });
      lastPlace = s.game;
    } else if (s.kind === 'vault') {
      if (lastPlace === 'vault' && s.copy) continue;                     // another copy of what's already there
      if (lastPlace === 'vault' && steps.at(-1)?.copy) steps.pop();       // copied first, then moved for real
      steps.push({ t: s.t, kind: 'vault', text: s.game ? `${s.copy ? 'Copied into' : 'Entered'} the Vault from ${s.game}` : 'Entered the Vault', copy: s.copy });
      lastPlace = 'vault';
    }
    else if (s.kind === 'game') { steps.push({ t: s.t, kind: 'game', text: s.game ? `Arrived in ${s.game}` : 'Left the Vault' }); lastPlace = s.game; }
    else if (s.kind === 'import') { steps.push({ t: s.t, kind: 'import', text: 'Imported into the Vault' }); lastPlace = 'vault'; }
    else steps.push({ t: s.t, kind: s.kind, text: s.text });
  }

  // where it is now
  if (side === 'vault' && lastPlace !== 'vault' && !m.awayIn)   // one that's away is in that game right now
    steps.push({ t: m.added ? new Date(m.added) : null, kind: 'vault', text: fromImport ? 'Imported into the Vault' : source ? `Entered the Vault from ${source}` : 'Entered the Vault' });
  if (side === 'game' && here && here !== m.origin && lastPlace !== here) steps.push({ t: null, kind: 'here', text: `Arrived in ${here}` });
  return steps;
}

async function togglePanel(kind) {
  const m = sum.list[sum.i], body = $('#summary .sm-body');
  if (!m || !body) return;
  if (kind && sum.ribbons) toggleRibbons(false);
  const was = sum.panel;
  sum.panel = kind === was ? null : kind;
  $('.sm-panel', body)?.remove();
  window.sfx?.[sum.panel ? 'menu' : 'back']?.();
  if (!sum.panel) return;
  const panel = document.createElement('section');
  panel.className = 'sm-ribbons sm-panel';
  const head = (title, n) => `<div class="sm-rbhead"><b>${title}</b>${n != null ? `<span>${n}</span>` : ''}
    <button type="button" class="sm-mvx" data-a="close-panel" aria-label="Close" title="Close (Esc)">${ico('close')}</button></div>`;
  panel.innerHTML = `${head('Journey', null)}<div class="sm-rbbody"><p class="sm-rbnone">Loading…</p></div>`;
  body.append(panel);
  const steps = await journeySteps(m, sum.side);
  if (!panel.isConnected || sum.list[sum.i] !== m) return;
  $('.sm-rbbody', panel).innerHTML = steps.length ? `<ol class="sm-journey">${steps.map((s, k) => `
      <li style="--d:${k * 60}ms"><span class="jn-ico">${JOURNEY_ICONS[s.kind] ?? '•'}</span>
        <div><b>${esc(s.text)}</b>${(s.small ?? journeyDate(s.t)) ? `<small>${esc(s.small ?? journeyDate(s.t))}</small>` : ''}</div></li>`).join('')}</ol>`
    : '<p class="sm-rbnone">Nothing recorded yet.</p>';
}

function closeSheet() {
  closeSummary();
  $('#sheet').hidden = true;
  $('#backdrop').hidden = true;
}

/* ---------------- dialogs ---------------- */

function gamePicker() {
  const list = (state.status?.games ?? []).filter(g => g.supported && !g.hidden);
  const d = showDialog(`<h2>Choose a game</h2>
    <div class="pick-list">${list.map(g => `
      <button class="pick ${g.id === state.gameId ? 'current' : ''}" data-id="${esc(g.id)}" type="button">
        <span class="game-chip" style="--gc:${gameColor(g)}">${esc(gameAbbr(g))}</span>
        <span><b>${esc(g.game)}</b> · ${esc(g.trainer ?? '')}<small>${g.pokemon} Pokémon · ${esc(sourceLabel(g))}</small></span>
      </button>`).join('') || '<p class="muted">No games connected yet.</p>'}
    </div>
    <p style="margin-top:14px"><button class="btn ghost" id="manageGames" type="button">+ Add or manage games</button></p>`);
  $$('.pick', d).forEach(b => b.addEventListener('click', () => { closeDialog(); selectGame(b.dataset.id).catch(fail); }));
  $('#manageGames', d).addEventListener('click', () => { closeDialog(); setView('games'); });
}

async function boxPicker(side, onPick) {
  const boxes = side === 'game' ? await api(`/api/games/${state.gameId}/overview`) : await api('/api/vault/overview');
  const cols = side === 'game' ? ((game()?.slotsPerBox ?? 30) % 6 === 0 ? 6 : 5) : 6;
  const d = showDialog(`<h2>${side === 'game' ? esc(game()?.game) + ' boxes' : 'Vault boxes'}</h2>
    <div class="overview">${boxes.map((b, i) => `
      <button type="button" class="ov-box ${i === state.box[side] ? 'current' : ''} box" data-i="${i}" ${side === 'vault' ? `data-wall="${b.wallpaper}" data-wp="${b.wallpaper}"` : 'data-wall="g"'}
        style="--gc:${gameColor(game())};padding:8px;border-width:0">
        <b>${esc(b.name)} <span class="muted">${b.slots.filter(Boolean).length}</span></b>
        <div class="ov-dots" style="--cols:${cols}">${b.slots.map(s => `<i class="${s ? 'on' : ''}"></i>`).join('')}</div>
      </button>`).join('')}</div>
    ${side === 'vault' ? '<p style="margin-top:12px"><button class="btn ghost small" id="ovAdd" type="button">+ Add a box</button></p>' : ''}`);
  $$('.ov-box', d).forEach(b => b.addEventListener('click', () => { closeDialog(); onPick(+b.dataset.i); }));
  $('#ovAdd', d)?.addEventListener('click', () => run(async () => {
    const r = await api('/api/vault/boxes', { method: 'POST' });
    closeDialog(); state.box.vault = r.box; await loadStatus(); await loadBox('vault');
  }));
}

function goToBox(side, b) {
  if (state.box[side] !== b) window.sfx?.flip();
  state.box[side] = b;
  loadBox(side).catch(fail);
}

function vaultBoxMenu() {
  const info = state.boxInfo?.vault;
  if (!info) return;
  const d = showDialog(`<h2>Box settings</h2>
    <p class="muted" style="margin:6px 0 4px">Name</p>
    <div style="display:flex;gap:6px"><input class="field" id="bxName" maxlength="24" value="${esc(info.name)}" style="flex:1">
      <button class="btn" id="bxSave" type="button">Save</button></div>
    <p class="muted" style="margin:14px 0 0">Wallpaper</p>
    <div class="walls">${[24, ...WALLPAPER_NAMES.keys()].filter((v, k, a) => a.indexOf(v) === k).map(i =>
      `<button type="button" class="wall ${i === info.wallpaper ? 'current' : ''} ${i === 24 ? 'theme-wall' : ''}" data-wp="${i}" data-w="${i}" title="${WALLPAPER_NAMES[i]}" aria-label="Wallpaper: ${WALLPAPER_NAMES[i]}">${i === 24 ? '<span>Theme</span>' : ''}</button>`).join('')}</div>
    <div style="display:flex;gap:8px;flex-wrap:wrap">
      <button class="btn ghost" id="bxAdd" type="button">+ Add a new box</button>
      <label class="btn ghost file">Import .pk files<input type="file" id="bxImport" multiple></label>
    </div>
    <p class="muted" style="margin:16px 0 6px">Organize</p>
    <div class="org-row">
      <select class="field" id="orgBy" aria-label="Sort by">
        <option value="dex">By Pokédex number</option><option value="type">By type</option><option value="gen">By generation</option>
        <option value="level">By level</option><option value="shiny">Shiny first</option><option value="newest">Newest first</option>
      </select>
      <button class="btn ghost" id="orgBox" type="button">Sort this box</button>
      <button class="btn ghost" id="orgAll" type="button">Sort whole Vault</button>
    </div>
    <div class="org-row">
      <button class="btn ghost" id="orgLiving" type="button">Make Living Dex</button>
      <button class="btn ghost" id="orgDupes" type="button">Find duplicates</button>
      <button class="btn ghost" id="orgUndo" type="button" hidden></button>
    </div>`);
  const showUndo = async () => {
    const u = await api('/api/vault/undo').catch(() => null);
    const b = $('#orgUndo', d);
    if (!b) return;
    b.hidden = !u?.label;              // nothing to undo comes back empty
    if (u?.label) b.textContent = `Undo: ${u.label}`;
  };
  showUndo();
  const organize = (path, body, msg) => run(async () => {
    const r = await api(path, { body });
    closeDialog(); toast(msg(r)); window.sfx?.place();
    await loadStatus();
    if (state.box.vault >= state.status.vaultBoxes.length) state.box.vault = 0;
    await loadBox('vault');
  });
  $('#orgBox', d).addEventListener('click', () => organize('/api/vault/sort',
    { scope: 'box', box: state.box.vault, by: $('#orgBy', d).value }, r => `Sorted this box (${r.moved} moved). You can undo it in Box settings.`));
  $('#orgAll', d).addEventListener('click', () => {
    if (!confirm('Sort every Pokémon in the Vault? They fill your boxes in order, so box names may no longer match what is inside. Living Dex boxes are left alone, and you can undo this.')) return;
    organize('/api/vault/sort', { scope: 'all', box: 0, by: $('#orgBy', d).value }, r => `Sorted the Vault (${r.moved} moved). You can undo it in Box settings.`);
  });
  $('#orgLiving', d).addEventListener('click', () => {
    if (!confirm('Make a Living Dex? One Pokémon of each species you have goes into Living Dex boxes at the end of the Vault, in Pokédex order. Your other boxes stay as they are, apart from the gaps left behind. You can undo this.')) return;
    organize('/api/vault/living-dex', {}, r => `Living Dex: ${r.species} of ${r.total} species (${r.placed} placed) in ${r.boxes} boxes.`);
  });
  $('#orgDupes', d).addEventListener('click', () => duplicatesDialog().catch(fail));
  $('#orgUndo', d).addEventListener('click', () => run(async () => {
    const r = await api('/api/vault/undo', { method: 'POST' });
    closeDialog(); toast(`Undone. ${r.restored} Pokémon are back where they were.`);
    await loadStatus();
    if (state.box.vault >= state.status.vaultBoxes.length) state.box.vault = 0;
    await loadBox('vault');
  }));
  const save = body => run(async () => {
    await api(`/api/vault/boxes/${state.box.vault}`, { body });
    await loadStatus(); await loadBox('vault');
  });
  $('#bxSave', d).addEventListener('click', () => { save({ name: $('#bxName', d).value }); closeDialog(); });
  $$('.wall', d).forEach(w => w.addEventListener('click', () => {
    $$('.wall', d).forEach(x => x.classList.toggle('current', x === w));
    save({ wallpaper: +w.dataset.w });
  }));
  $('#bxAdd', d).addEventListener('click', () => run(async () => {
    const r = await api('/api/vault/boxes', { method: 'POST' });
    closeDialog(); state.box.vault = r.box; await loadStatus(); await loadBox('vault');
  }));
  $('#bxImport', d).addEventListener('change', e => importPk(e.target));
}

async function importPk(input) {
  const files = [...input.files];
  input.value = '';
  if (!files.length) return;
  const fd = new FormData();
  files.forEach(f => fd.append('files', f));
  await run(async () => {
    const r = await api('/api/vault/import', { body: fd });
    closeDialog();
    toast(`Imported ${r.added} Pokémon.` + (r.skipped.length ? ` ${r.skipped.length} file(s) couldn't be read.` : ''));
    await refreshAll();
  });
}

function phoneDialog() {
  const urls = state.status?.lanUrls ?? [];
  showDialog(`<h2>Open on your phone</h2>
    ${urls.length ? `${urls.map(u => `<p class="url">${esc(u)}</p>`).join('')}
      <p class="note">Anyone on your Wi-Fi can open this page while it's running.</p>`
      : '<p>No Wi-Fi or network connection found on this PC.</p>'}`);
}

/* ---------------- themes and wallpapers ---------------- */

const WALLPAPER_NAMES = ['Mint', 'Sky', 'Lavender', 'Peach', 'Sunny', 'Blossom', 'Leaf', 'Lagoon', 'Sand', 'Slate', 'Rose', 'Lime',
  'Polka dots', 'Checkers', 'Candy stripes', 'Waves', 'Starry night', 'Graph paper', 'Zigzag', 'Bubbles', 'Sunburst', 'Plaid', 'Diamonds', 'Night meadow', 'Match theme'];
const THEMES = [
  { id: 'teal', name: 'Teal', sw: ['#22c6b7', '#0c605c', '#ffd23f'] },
  { id: 'night', name: 'Night', sw: ['#3b4f8f', '#1b2547', '#ffd23f'] },
  { id: 'sakura', name: 'Sakura', sw: ['#f39bbb', '#8c3b5c', '#ffd23f'] },
  { id: 'forest', name: 'Forest', sw: ['#6fbf6b', '#255830', '#ffd23f'] },
  { id: 'sunset', name: 'Sunset', sw: ['#ffa26b', '#6c2e54', '#ffd23f'] },
  { id: 'retro', name: 'Retro', sw: ['#a8c43a', '#2f5a24', '#ffd23f'] },
];
function applyTheme(id) {
  if (!THEMES.some(t => t.id === id)) id = 'teal';
  if (id === 'teal') delete document.documentElement.dataset.theme; else document.documentElement.dataset.theme = id;
  try { localStorage.setItem('pv.theme', id); } catch { /* ignore */ }
}
try { applyTheme(localStorage.getItem('pv.theme') || 'teal'); } catch { /* ignore */ }
function themeDialog() {
  const cur = document.documentElement.dataset.theme || 'teal';
  const d = showDialog(`<h2>Theme</h2><p class="muted" style="margin:4px 0 0">Colours for the whole app. Each box can still have its own wallpaper (Box settings).</p>
    <div class="theme-list">${THEMES.map(t => `<button type="button" class="theme-pick ${t.id === cur ? 'current' : ''}" data-theme-id="${t.id}">
      <span class="tp-sw" style="background:linear-gradient(135deg, ${t.sw[0]}, ${t.sw[1]})">${t.sw.map(c => `<i style="background:${c}"></i>`).join('')}</span>
      <b>${t.name}</b></button>`).join('')}</div>`);
  $$('.theme-pick', d).forEach(b => b.addEventListener('click', () => {
    applyTheme(b.dataset.themeId);
    $$('.theme-pick', d).forEach(x => x.classList.toggle('current', x === b));
    window.sfx?.select();
  }));
}

/* ---------------- views ---------------- */

function setView(v, opts = {}) {
  // start-up chime when the boxes open, power-down when you leave them
  if (v !== state.view) {
    if (v === 'boxes') window.sfx?.open();
    else if (state.view === 'boxes') window.sfx?.close();
  }
  state.view = v;
  $$('.mainnav button').forEach(b => b.classList.toggle('active', b.dataset.view === v));
  $$('.view').forEach(el => (el.hidden = el.id !== `view-${v}`));
  if (v !== 'boxes') { endSelect(); endPick(); }
  meadow?.setActive(v === 'meadow');
  window.sfx?.pauseMusic?.(v === 'meadow'); // the Meadow has its own sounds
  if (v === 'meadow' && !opts.noLoad) showMeadow();
  if (v === 'dex') loadDex().catch(fail);
  if (v === 'games') { $('#view-games').dataset.ids = ''; renderGames(); loadPlayInfo().then(() => state.view === 'games' && renderGames()).catch(() => {}); }   // opening the screen plays its entrance
  if (v === 'play') renderPlay().catch(fail);
  $('.top-games').hidden = v !== 'games';
  if (v !== 'games') $('#pathPop').hidden = true;
}

// Choosing a pill. A game shows its box next to your Vault box (no detail panel); the Vault shows on its own.
function setPane(p) {
  state.mode = p;
  state.pane = p;
  try { localStorage.setItem('pv.pane', p); } catch { /* ignore */ }
  markActivePill();
  $('.bx').classList.toggle('dual', p === 'game');
  $$('.pane').forEach(el => el.classList.toggle('active', el.dataset.side === p));
  if (state.status) { render('game'); render('vault'); }
  if (p === 'game' && state.pick?.from === 'vault') showCompat(state.pick.mon); else if (p !== 'game') clearCompat();
}
const dual = () => state.mode === 'game';
// Moving the cursor into the other box while both are showing.
function focusPane(side, index = state.cursor) {
  if (side === state.pane) return;
  $$(`#pane-${state.pane} .slot`).forEach(s => s.classList.toggle('cursor', false));
  state.pane = side;
  state.cursorHidden = false;
  state.cursor = Math.max(0, Math.min(gridSize(side) - 1, index));
  $$(`#pane-${side} .slot`).forEach(s => s.classList.toggle('cursor', +s.dataset.index === state.cursor));
}

/* ---------------- Pokédex ---------------- */

async function loadDex() {
  state.dex = await api('/api/dex');
  const total = state.dex.length;
  const reg = state.dex.filter(d => d.reg & 1).length;
  const shiny = state.dex.filter(d => d.reg & 2).length;
  $('#dexReg').textContent = reg;
  $('#dexTotal').textContent = total;
  $('#dexShiny').textContent = shiny;
  $('#dexLiving').textContent = state.dex.filter(d => d.have).length;
  const pct = total ? Math.round((reg / total) * 1000) / 10 : 0;
  $('#dexPct').textContent = `${pct}%`;
  $('#dexRing').style.setProperty('--p', pct);
  renderDex();
}

function renderDex() {
  if (!state.dex) return;
  const q = $('#dexSearch').value.trim().toLowerCase();
  const t = $('#dexType').value;
  const f = state.dexFilter;
  const list = state.dex.filter(d =>
    (f === 'all' || (f === 'reg' && d.reg & 1) || (f === 'missing' && !(d.reg & 1)) || (f === 'shiny' && d.reg & 2)) &&
    (!t || d.types.includes(t)) &&
    (!q || d.name.toLowerCase().includes(q) || String(d.n) === q.replace(/^#0*/, '')));
  const grid = $('#dexGrid');
  grid.replaceChildren(...list.map(d => {
    const tile = document.createElement('button');
    tile.type = 'button';
    tile.className = 'dex-tile' + (d.reg & 1 ? '' : ' missing');
    tile.append(img(iconUrl(d.n), d.name, '', d.name));
    tile.insertAdjacentHTML('beforeend', `<div class="no">#${String(d.n).padStart(4, '0')}</div><div class="nm">${esc(d.name)}</div>
      ${d.reg & 2 ? '<span class="star">★</span>' : ''}${d.have ? `<span class="have">×${d.have}</span>` : ''}`);
    tile.addEventListener('click', () => dexEntry(d));
    return tile;
  }));
  if (!list.length) grid.innerHTML = '<p class="muted">Nothing matches.</p>';
}

async function dexEntry(d) {
  const mons = d.have ? await api(`/api/vault/search?species=${d.n}`) : [];
  const body = showDialog(`
    <div style="display:flex;gap:16px;align-items:center">
      <div class="hero-img" style="background:var(--card2)"></div>
      <div>
        <div class="muted">#${String(d.n).padStart(4, '0')}</div>
        <h2>${esc(d.name)}</h2>
        <div class="badges">${d.types.map(typeChip).join(' ')}</div>
        <p style="margin:8px 0 0">${d.reg & 1 ? '✓ Registered' : 'Not registered yet'}${d.reg & 2 ? ' · ★ shiny registered' : ''}</p>
      </div>
    </div>
    ${mons.length ? `<h3 style="margin:16px 0 8px;font-size:15px">In your vault (${mons.length})</h3>
      <div class="results">${mons.map(m => `<button type="button" class="mini" data-box="${m.box}" data-id="${esc(m.id)}">
        <span class="ic" data-n="${m.species}"></span>${esc(name(m))} · Lv.${m.level}${m.shiny ? ' ★' : ''} · ${esc(state.status.vaultBoxes[m.box]?.name)}</button>`).join('')}</div>` : ''}
    <h3 style="margin:16px 0 8px;font-size:15px">Where to catch it</h3>
    <div class="where"><p class="muted">Looking through your games…</p></div>`);
  api(`/api/dex/${d.n}/where`).then(list => renderWhere($('.where', body), list, d)).catch(e => {
    $('.where', body).innerHTML = `<p class="muted">${esc(e.message)}</p>`;
  });
  const hero = $('.hero-img', body);
  hero.append(img(renderUrl(d.n, false), d.name, '', d.name, iconUrl(d.n)));
  if (!(d.reg & 1)) hero.firstChild.style.filter = 'brightness(0) opacity(.35)';
  $$('.mini', body).forEach(b => {
    $('.ic', b).replaceWith(img(iconUrl(+$('.ic', b)?.dataset.n || d.n), '', '', ''));
    b.addEventListener('click', () => {
      closeDialog(); setView('boxes'); setPane('vault');
      state.highlight = b.dataset.id; goToBox('vault', +b.dataset.box);
    });
  });
}

// "Where to catch it" in each connected game: method, place and levels, from PKHeX's encounter tables.
function renderWhere(box, list, d) {
  if (!box.isConnected) return;
  const lv = s => s.method.startsWith('Hatch') ? 'Egg' : s.levelMin === s.levelMax ? `Lv. ${s.levelMin}` : `Lv. ${s.levelMin}–${s.levelMax}`;
  const can = list.filter(g => g.spots.length), cant = list.filter(g => !g.spots.length);
  const notIn = cant.filter(g => /isn't in this game/.test(g.note ?? '')), noWild = cant.filter(g => !notIn.includes(g));
  const sg = id => state.status?.games.find(x => x.id === id);
  box.innerHTML = (can.length ? can.map(g => `
    <div class="where-game" style="--gc:${gameColor(sg(g.gameId))}">
      <div class="wg-head"><span class="game-chip">${esc(gameAbbr(sg(g.gameId)))}</span><b>${esc(g.game)}</b>
        <small>${g.spots.length === 1 ? '1 way' : `${g.spots.length} ways`}</small></div>
      <ul class="wg-spots">${g.spots.map(s => `<li>
        <span class="ws-method">${esc(s.method)}</span>
        <span class="ws-place">${esc(s.place || 'Place not recorded for this game')}</span>
        <span class="ws-lv">${lv(s)}</span>
        ${s.note ? `<small class="ws-note">${esc(s.note)}</small>` : ''}</li>`).join('')}</ul>
    </div>`).join('') : `<p class="muted">${esc(d.name)} can't be caught in any of your connected games. Trade it in, or keep one safe in the Vault.</p>`)
    + (noWild.length ? `<p class="muted wg-foot">Not obtainable in-game: ${noWild.map(g => esc(g.game)).join(', ')}.</p>` : '')
    + (notIn.length ? `<p class="muted wg-foot">Not in ${notIn.map(g => esc(g.game)).join(', ')}.</p>` : '');
}

/* ---------------- duplicate finder ---------------- */

// Exact copies (the same Pokémon twice: extras ticked, the oldest kept) and species you have several of.
async function duplicatesDialog() {
  const r = await api('/api/vault/duplicates');
  const boxName = m => state.status.vaultBoxes[m.box]?.name ?? `Box ${m.box + 1}`;
  const row = (m, checked) => `<label class="dup-mon"><input type="checkbox" data-id="${esc(m.id)}" ${checked ? 'checked' : ''}>
    <span class="dup-pic" data-id="${esc(m.id)}"></span><span><b>${esc(name(m))}${m.shiny ? ' ★' : ''}</b>
    <small>Lv. ${m.level} · ${esc(boxName(m))} · OT ${esc(m.ot)}</small></span></label>`;
  const d = showDialog(`<h2>Duplicates</h2>
    <h3 class="dup-h">Exact copies <span class="muted">(the same Pokémon more than once)</span></h3>
    ${r.copies.length ? r.copies.map(g => `<div class="dup-group">${g.map((m, i) => row(m, i > 0)).join('')}</div>`).join('')
      : '<p class="muted">None. Every Pokémon in your Vault is one of a kind.</p>'}
    <h3 class="dup-h">Species you have several of</h3>
    ${r.species.length ? r.species.map(s => `<details class="dup-species"><summary><b>${esc(s.name)}</b> <span class="muted">× ${s.count}</span></summary>
      <div class="dup-group">${s.mons.map(m => row(m, false)).join('')}</div></details>`).join('')
      : '<p class="muted">You have one of each species.</p>'}
    <div class="dup-foot"><button type="button" class="btn danger" id="dupRelease" disabled>Release selected</button>
      <span class="muted">Released Pokémon leave your boxes. Their files are kept in data/released.</span></div>`);
  const dlg = d.closest('dialog');
  dlg?.classList.add('wide');
  dlg?.addEventListener('close', () => dlg.classList.remove('wide'), { once: true });
  const all = [...r.copies.flat(), ...r.species.flatMap(s => s.mons)];
  $$('.dup-pic', d).forEach(p => p.replaceWith(monIcon(all.find(m => m.id === p.dataset.id))));
  const picked = () => [...new Set($$('input[data-id]:checked', d).map(c => c.dataset.id))];
  const sync = () => {
    const n = picked().length, b = $('#dupRelease', d);
    b.disabled = !n; b.textContent = n ? `Release selected (${n})` : 'Release selected';
  };
  d.addEventListener('change', e => {
    // the same Pokémon can show up in both lists: keep its boxes in step
    const c = e.target.closest('input[data-id]');
    if (c) $$(`input[data-id="${CSS.escape(c.dataset.id)}"]`, d).forEach(x => (x.checked = c.checked));
    sync();
  });
  sync();
  $('#dupRelease', d).addEventListener('click', () => {
    const ids = picked();
    if (!ids.length || !confirm(`Release ${ids.length} Pokémon from the Vault? They leave your boxes, but their files are kept in data/released.`)) return;
    run(async () => {
      const res = await api('/api/vault/release', { body: { ids } });
      closeDialog(); toast(`Released ${res.released} Pokémon.`);
      await refreshAll();
    });
  });
}

/* ---------------- save backups ---------------- */

// Every save PokeVault changes is copied first. This lists those copies and puts one back.
async function backupsDialog(id) {
  const g = state.status?.games.find(x => x.id === id);
  if (!g) return;
  const d = showDialog(`<h2>Backups · ${esc(g.game)}</h2>
    <p class="muted" style="margin:4px 0 0">PokeVault copies this save before every change it makes. Restore one to put the save back exactly as it was then.</p>
    <div class="bk-list"><p class="muted">Loading…</p></div>`);
  const fill = async () => {
    const list = await api(`/api/games/${encodeURIComponent(id)}/backups`);
    const box = $('.bk-list', d);
    if (!box?.isConnected) return;
    box.innerHTML = list.length ? list.map(b => `
      <div class="bk-row">
        <div class="bk-when"><b>${esc(new Date(b.time).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' }))}</b>
          ${b.original ? '<span class="bk-tag">First copy</span>' : ''}
          <small>${b.pokemon >= 0 ? `${b.pokemon} Pokémon · ${esc(b.playTime ?? '')}${b.trainer ? ` · ${esc(b.trainer)}` : ''}` : "Can't be read"}</small></div>
        <button type="button" class="btn small ghost" data-file="${esc(b.file)}" data-when="${esc(new Date(b.time).toLocaleString())}" ${b.pokemon < 0 ? 'disabled' : ''}>Restore</button>
      </div>`).join('')
      : `<p class="muted">No backups yet. PokeVault makes one the first time it changes this save.</p>`;
    $$('[data-file]', box).forEach(btn => btn.addEventListener('click', () => {
      if (!confirm(`Put ${g.game} back to how it was on ${btn.dataset.when}?\n\nYour current save is backed up first, so you can undo this.\n\nPokémon moved in or out of this game since then go back to where they were then. A Pokémon you moved to the Vault since then would then be in both places.`)) return;
      run(async () => {
        await api(`/api/games/${encodeURIComponent(id)}/restore`, { body: { file: btn.dataset.file } });
        toast(`${g.game} was restored to ${btn.dataset.when}.`);
        await refreshAll();
        await fill();
      });
    }));
  };
  fill().catch(e => { const box = $('.bk-list', d); if (box) box.innerHTML = `<p class="muted">${esc(e.message)}</p>`; });
}

/* ---------------- games view ---------------- */

const sourceLabel = g => g.kind === 'ryujinx' ? 'Ryujinx' : g.kind === 'path' ? 'File on this PC' : 'Uploaded file';

function ago(date) {
  const s = (Date.now() - new Date(date)) / 1000;
  if (!isFinite(s)) return '';
  if (s < 90) return 'just now';
  if (s < 3600) return `${Math.round(s / 60)} min ago`;
  if (s < 86400) return `${Math.round(s / 3600)} h ago`;
  return new Date(date).toLocaleDateString();
}

// Game box art (English covers from Bulbapedia's image archive, archives.bulbagarden.net), loaded by the page
// itself as small 240 px versions. Keyed by the game's name in lower-case letters and digits.
const COVERS = {
  red: 'Red EN boxart.png', blue: 'Blue EN boxart.png', yellow: 'Yellow EN boxart.png', redblue: 'Red EN boxart.png', goldsilver: 'Gold EN boxart.png',
  gold: 'Gold EN boxart.png', silver: 'Silver EN boxart.png', crystal: 'Crystal EN boxart.png',
  ruby: 'Ruby EN boxart.png', sapphire: 'Sapphire EN boxart.png', emerald: 'Emerald EN boxart.jpg',
  firered: 'FireRed EN boxart.png', leafgreen: 'LeafGreen EN boxart.png', colosseum: 'Colosseum EN boxart.png', xd: 'XD EN boxart.png',
  diamond: 'Diamond EN boxart.jpg', pearl: 'Pearl EN boxart.jpg', platinum: 'Platinum EN boxart.png',
  heartgold: 'HeartGold EN boxart.jpg', soulsilver: 'SoulSilver EN boxart.jpg',
  black: 'Black EN boxart.png', white: 'White EN boxart.png', black2: 'Black 2 EN boxart.png', white2: 'White 2 EN boxart.png',
  x: 'X EN boxart.png', y: 'Y EN boxart.png', omegaruby: 'Omega Ruby EN boxart.png', alphasapphire: 'Alpha Sapphire EN boxart.png',
  sun: 'Sun EN boxart.png', moon: 'Moon EN boxart.png', ultrasun: 'Ultra Sun EN boxart.png', ultramoon: 'Ultra Moon EN boxart.png',
  letsgopikachu: 'Lets Go Pikachu EN boxart.png', letsgoeevee: 'Lets Go Eevee EN boxart.png',
  sword: 'Sword EN boxart.png', shield: 'Shield EN boxart.png',
  brilliantdiamond: 'Brilliant Diamond EN boxart.png', shiningpearl: 'Shining Pearl EN boxart.png',
  legendsarceus: 'Legends Arceus EN boxart.png', scarlet: 'Scarlet EN boxart.png', violet: 'Violet EN boxart.png',
  legendsza: 'Legends Z-A EN boxart.png',
};
const gameKey = g => (g?.game ?? '').toLowerCase().replace(/version/g, '').replace(/[^a-z0-9]/g, '');
const archiveFile = (f, w) => `https://archives.bulbagarden.net/wiki/Special:FilePath/${encodeURIComponent(f.replace(/ /g, '_'))}?width=${w}`;
function coverUrl(g) {
  const f = COVERS[gameKey(g)];
  return f ? archiveFile(f, 240) : null;
}
// Square home-screen game icons (Nintendo Switch, from the Bulbagarden Archives). Older games only have tiny
// 3DS/DS icons, so they use a square crop of their box art instead.
const GAME_ICONS = {
  scarlet: 'Scarlet Icon.jpg', violet: 'Violet Icon.jpg', sword: 'Sword Icon.jpg', shield: 'Shield Icon.jpg',
  brilliantdiamond: 'Brilliant Diamond Icon.jpg', shiningpearl: 'Shining Pearl Icon.jpg', legendsarceus: 'Legends Arceus Icon.jpg',
  legendsza: 'Legends Z-A Icon.jpg', letsgopikachu: "Let's Go Pikachu Icon.jpg", letsgoeevee: "Let's Go Eevee Icon.jpg",
  firered: 'FireRed Icon.jpg', leafgreen: 'LeafGreen Icon.jpg',
};
// A copy kept in assets/games/<key>.jpg is used first (works offline); otherwise the archive's file.
function gameIcon(g) {
  const k = gameKey(g), f = GAME_ICONS[k];
  if (f) return { url: `assets/games/${k}.jpg`, fallback: archiveFile(f, 256), icon: true };
  const c = coverUrl(g);
  return c ? { url: `assets/games/${k}.jpg`, fallback: archiveFile(COVERS[k], 320), icon: false } : null;
}
// Loads every connected game's picture once in the background, so the Games screen opens with them ready.
const warmedIcons = new Set();
function warmGameIcons(games) {
  for (const g of games ?? []) {
    const ic = gameIcon(g);
    if (!ic || warmedIcons.has(ic.url)) continue;
    warmedIcons.add(ic.url);
    const im = new Image();
    im.onerror = () => { const r = new Image(); r.referrerPolicy = 'no-referrer'; r.src = ic.fallback; };
    im.src = ic.url;
  }
}

// Games screen, laid out like HOME's game picker: the chosen game's card on the left,
// your name above every game's cover tile on the right. Upload / Add from PC live in the top bar.
let gameSel = null;
/* ---------------- Play: start games in your emulators ---------------- */

const PLAY_FILES = {
  ryujinx: 'Switch games (*.nsp;*.xci)|*.nsp;*.xci;*.nca;*.nro|All files (*.*)|*.*',
  sudachi: 'Switch games (*.nsp;*.xci)|*.nsp;*.xci;*.nca;*.nro|All files (*.*)|*.*',
  citra: '3DS games (*.3ds;*.cci;*.cia;*.cxi;*.3dsx)|*.3ds;*.cci;*.cia;*.cxi;*.3dsx;*.app;*.elf|All files (*.*)|*.*',
  melonds: 'DS games (*.nds)|*.nds;*.srl;*.dsi|All files (*.*)|*.*',
  mgba: 'GBA and Game Boy games (*.gba;*.gb;*.gbc)|*.gba;*.gb;*.gbc;*.sgb;*.agb;*.zip;*.7z|All files (*.*)|*.*',
};
const pick = (title, filter, start) => api('/api/pick', { body: { title, filter, start } }).then(r => r.path);
const fileName = p => String(p ?? '').split(/[\\/]/).pop();
const when = t => t ? new Date(t).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' }) : '—';
let playTimer = null;

// What each game needs to be played (emulator, game file, save), kept for the Games screen too.
state.play = null;
async function loadPlayInfo() { state.play = await api('/api/play'); return state.play; }
const playOf = id => state.play?.games.find(x => x.id === id) ?? null;
const emuOf = kind => state.play?.emulators.find(e => e.kind === kind) ?? null;
// Ready = the emulator is there and the game file is chosen (a save that's still PokeVault's copy only warns).
const playReady = p => !!p && !!emuOf(p.emulator)?.found && p.romFound && !p.running;
function playWhy(p) {
  if (!p) return 'Set up how to play it in Emulators.';
  if (!p.emulator) return p.note || "PokeVault can't start this kind of game.";
  if (!emuOf(p.emulator)?.found) return `${p.emulatorName} isn't set up yet.`;
  if (!p.rom) return 'Choose its game file once in Emulators.';
  if (!p.romFound) return "Its game file isn't there any more. Choose it again in Emulators.";
  return '';
}

// Starts a game (from Games or Emulators). A save that's still PokeVault's copy gets a warning first.
async function startGame(id) {
  const g = playOf(id) ?? (await loadPlayInfo(), playOf(id));
  if (!g) return;
  if (g.saveKind === 'upload' && !confirm(`${g.game} isn't using your save yet: your save is only in PokeVault's copy, so ${g.emulatorName} would start `
    + `${g.realSave ? 'with the save next to the game file instead' : 'without it (New Game)'}.\n\nLink it first in Emulators with "${g.realSave ? `Use ${fileName(g.realSave)}` : 'Choose the real save…'}".\n\nStart anyway?`)) return;
  const r = await api(`/api/play/${id}/start`, { method: 'POST' });
  window.sfx?.select();
  toast(`Starting ${g.game} in ${r.emulator}…`);
  setTimeout(() => checkStatus(), 1500);
}
// "Set up to play": the Emulators screen, scrolled to that game.
function setupGame(id) { state.emuFocus = id; setView('play'); }

const SYSTEM_COLORS = { ryujinx: '#e4434f', sudachi: '#e0b021', citra: '#3d7fe0', melonds: '#7c8794', mgba: '#7653d6' };
const SYSTEM_TAGS = { ryujinx: 'Switch', sudachi: 'Switch', citra: '3DS', melonds: 'DS', mgba: 'GBA' };
// The emulator's own icon (for 3DS: whichever of Citra, Azahar or Lime3DS you have), or its coloured badge.
function emuIconFile(kind) {
  const exe = fileName(emuOf(kind)?.exe ?? '').toLowerCase();
  if (kind === 'citra') return exe.includes('azahar') ? 'azahar' : exe.includes('lime') ? 'lime3ds' : 'citra';
  return { ryujinx: 'ryujinx', sudachi: 'sudachi', melonds: 'melonds', mgba: 'mgba' }[kind] ?? null;
}
function emuIcon(kind, cls = 'em-ico') {
  const f = emuIconFile(kind);
  const tag = esc(SYSTEM_TAGS[kind] ?? '');
  return f ? `<span class="${cls}" style="--sys:${SYSTEM_COLORS[kind] ?? '#7c8794'}"><img src="assets/emulators/${f}.png" alt="" draggable="false"
      onerror="this.parentNode.classList.add('noimg');this.remove()"><b>${tag}</b></span>`
    : `<span class="${cls} noimg" style="--sys:#7c8794"><b>${tag}</b></span>`;
}

async function renderPlay() {
  const view = $('#view-play');
  const d = await loadPlayInfo();
  if (state.view !== 'play') return;
  const emu = emuOf;
  const tick = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>';
  const step = (n, done, warn, title, value, actions = '') => `
      <li class="em-step ${done ? 'done' : warn ? 'warn' : 'todo'}">
        <span class="em-n">${done ? tick : n}</span>
        <div class="em-sv"><small>${title}</small><b title="${esc(value.title ?? '')}">${value.html}</b>${actions ? `<div class="em-acts">${actions}</div>` : ''}</div>
      </li>`;
  const btn = (label, attrs, primary) => `<button class="em-btn${primary ? ' primary' : ''}" type="button" ${attrs}>${label}</button>`;

  const gameCard = g => {
    const e = emu(g.emulator);
    const ready = playReady(g);
    const choices = (g.choices ?? []).length > 1
      ? `<div class="em-choose" role="group" aria-label="Emulator">${g.choices.map(k => `<button type="button" class="${k === g.emulator ? 'on' : ''}"
          data-emu="${esc(g.id)}" data-kind="${esc(k)}">${emuIcon(k, 'em-mini')}${esc(emu(k)?.name ?? k)}</button>`).join('')}</div>` : '';
    const s1 = g.emulator
      ? step(1, e?.found, false, 'Emulator', { html: emuIcon(g.emulator, 'em-mini') + esc(g.emulatorName) + (e?.found ? '' : ' <em>not found</em>') },
          choices + (e?.found ? '' : btn('Choose program…', `data-exe="${esc(g.emulator)}"`, true)))
      : step(1, false, true, 'Emulator', { html: `<em>${esc(g.note ?? 'Not supported')}</em>` });
    const s2 = step(2, g.romFound, g.rom && !g.romFound, 'Game file',
      { html: g.rom ? esc(fileName(g.rom)) + (g.romFound ? '' : ' <em>missing</em>') : '<em>Not chosen yet</em>', title: g.rom ?? '' },
      g.emulator ? btn(g.rom ? 'Change…' : 'Choose…', `data-rom="${esc(g.id)}"`, !g.rom) : '');
    let s3;
    if (g.saveKind === 'ryujinx' && g.emulator !== 'ryujinx')
      s3 = step(3, false, true, 'Save', { html: `Ryujinx's save <em>· ${esc(g.emulatorName)} keeps its own</em>`, title: g.savePath });
    else if (g.saveKind === 'ryujinx') s3 = step(3, true, false, 'Save', { html: `Ryujinx's own save`, title: g.savePath });
    else if (g.saveKind === 'upload')
      s3 = step(3, false, true, 'Save', { html: `PokeVault's copy <em>· the game won't see it</em>`, title: g.savePath },
        (g.realSave ? btn(`Use ${esc(fileName(g.realSave))}`, `data-link="${esc(g.id)}" data-path="${esc(g.realSave)}"`, true) : '')
        + btn('Choose the real save…', `data-link="${esc(g.id)}"`, !g.realSave && !g.canPlaceSave)
        + (g.canPlaceSave ? btn('Put it into Citra', `data-place="${esc(g.id)}"`, true) : ''));
    else s3 = step(3, !g.realSave, !!g.realSave, 'Save', { html: `${esc(fileName(g.savePath))} <em>· ${esc(when(g.saveTime))}</em>`, title: g.savePath },
        (g.realSave ? btn(`Use ${esc(fileName(g.realSave))}`, `data-link="${esc(g.id)}" data-path="${esc(g.realSave)}"`, true) : '')
        + btn('Change…', `data-link="${esc(g.id)}"`));
    const left = [e?.found || !g.emulator, g.romFound, g.saveKind !== 'upload'].filter(x => !x).length;
    const badge = g.running ? `<span class="em-badge live">● Playing</span>`
      : ready && g.saveKind !== 'upload' ? `<span class="em-badge ok">${tick} Ready to play</span>`
      : ready ? `<span class="em-badge warn">Playable · save not linked</span>`
      : `<span class="em-badge todo">${left} step${left === 1 ? '' : 's'} left</span>`;
    return `<article class="em-game${ready ? ' ready' : ''}${g.running ? ' running' : ''}" id="em-${esc(g.id)}" style="--sys:${SYSTEM_COLORS[g.emulator] ?? '#7c8794'}">
      <header class="em-g-head">
        <span class="em-g-art">${mascotChip(g, true)}</span>
        <div class="em-g-name"><h3>${esc(g.game)}</h3><small>${esc(g.trainer ?? '')}${g.playTime ? ` · ${esc(g.playTime)}` : ''}</small></div>
        ${badge}
        <button class="em-play" data-go="${esc(g.id)}" type="button" ${ready ? '' : 'disabled'} title="${esc(playWhy(g))}">${ico('play')}<span>Play</span></button>
      </header>
      <ol class="em-steps">${s1}${s2}${s3}</ol>
    </article>`;
  };

  const emuCard = e => `
    <article class="em-emu ${e.running ? 'running' : e.found ? 'ok' : 'missing'}" style="--sys:${SYSTEM_COLORS[e.kind]}">
      ${emuIcon(e.kind, 'em-sys')}
      <div class="em-e-name"><b>${esc(e.name)}</b><small>${esc(e.systems)}</small></div>
      <span class="em-state">${e.running ? '● Open now' : e.found ? `${tick} Ready` : 'Not on this PC'}</span>
      <p class="em-path" title="${esc(e.exe ?? '')}">${e.found ? esc(e.exe) : `Get it from <b>${esc(e.getFrom)}</b>, then choose its program.`}</p>
      ${btn(e.found ? 'Change…' : 'Choose program…', `data-exe="${esc(e.kind)}"`, !e.found)}
    </article>`;

  const readyCount = d.games.filter(g => playReady(g)).length;
  view.innerHTML = `
    <div class="em-wrap">
      <header class="em-hero">
        <div><h2>Emulators</h2>
          <p>Set each game up once: its emulator, its game file and the save it plays. Then press Play in <a href="#" data-to-games>Games</a>. PokeVault pauses while you play and refreshes when you close the game.</p></div>
        <div class="em-count"><b>${readyCount}/${d.games.length}</b><small>games ready</small></div>
      </header>
      <section class="em-sec">
        <div class="em-sec-head"><h3>Your emulators</h3>${btn('Look again', 'data-redetect')}</div>
        <div class="em-emus">${d.emulators.map(emuCard).join('')}</div>
      </section>
      <section class="em-sec">
        <div class="em-sec-head"><h3>Your games</h3></div>
        <div class="em-games">${d.games.map(gameCard).join('') || '<p class="em-none">No games connected yet. Add one in Games.</p>'}</div>
      </section>
    </div>`;

  const again = () => renderPlay().catch(fail);
  const byId = id => d.games.find(x => x.id === id);
  $('[data-to-games]', view)?.addEventListener('click', e => { e.preventDefault(); setView('games'); });
  $$('[data-go]', view).forEach(b => b.addEventListener('click', () => run(async () => { await startGame(b.dataset.go); setTimeout(again, 2500); })));
  $$('[data-emu]', view).forEach(b => b.addEventListener('click', () => run(async () => {
    if (b.classList.contains('on')) return;
    await api(`/api/play/${b.dataset.emu}/emulator`, { body: { kind: b.dataset.kind, path: null } });
    window.sfx?.tick?.();
    await again();
  })));
  $$('[data-rom]', view).forEach(b => b.addEventListener('click', () => run(async () => {
    const g = byId(b.dataset.rom);
    const path = await pick(`Choose the game file for ${g.game}`, PLAY_FILES[g.emulator], g.rom);
    if (!path) return;
    await api(`/api/play/${g.id}/rom`, { body: { path } });
    await again();
  })));
  $$('[data-exe]', view).forEach(b => b.addEventListener('click', () => run(async () => {
    const e = emu(b.dataset.exe);
    const path = await pick(`Choose the ${e.name} program`, `${e.name} (*.exe)|*.exe`, e.exe);
    if (!path) return;
    await api('/api/play/emulator', { body: { kind: e.kind, path } });
    await again();
  })));
  $('[data-redetect]', view)?.addEventListener('click', () => run(async () => {
    for (const e of d.emulators.filter(x => !x.found)) await api('/api/play/emulator', { body: { kind: e.kind, path: null } });
    await again();
    toast('Looked for emulators again.');
  }));
  $$('[data-place]', view).forEach(b => b.addEventListener('click', () => run(async () => {
    const g = byId(b.dataset.place);
    if (!confirm(`Copy PokeVault's ${g.game} save into Citra, and use that file from now on?\n\nCitra will play it, and PokeVault will change it directly (with a backup before every change).`)) return;
    await api(`/api/play/${g.id}/place-citra`, { method: 'POST' });
    toast(`${g.game} now uses Citra's save.`);
    await loadStatus(); await again();
  })));
  $$('[data-link]', view).forEach(b => b.addEventListener('click', () => run(async () => {
    const g = byId(b.dataset.link);
    const path = b.dataset.path || await pick(`Choose the save file the emulator uses for ${g.game}`, 'Save files (*.sav;main;*.dsv;*.srm)|*.sav;main;*.dsv;*.srm;*.bin|All files (*.*)|*.*', g.rom);
    if (!path) return;
    linkSaveDialog(g, path, again);
  })));

  // came here from "Set up to play" in Games: show that game
  if (state.emuFocus) {
    const card = $(`#em-${CSS.escape(state.emuFocus)}`, view);
    state.emuFocus = null;
    if (card) { card.scrollIntoView({ block: 'center', behavior: 'smooth' }); card.classList.add('flash'); setTimeout(() => card.classList.remove('flash'), 1800); }
  }
  clearTimeout(playTimer);
  if (d.games.some(g => g.running)) playTimer = setTimeout(() => state.view === 'play' && again(), 4000);   // notice when the game is closed
}

// Which version wins when an uploaded copy is switched to the emulator's own save.
async function linkSaveDialog(g, path, after) {
  const st = await api('/api/pick-info?path=' + encodeURIComponent(path)).catch(() => null);
  const fileTime = st?.time ? new Date(st.time) : null;
  const mineNewer = st?.blank || !fileTime || new Date(g.saveTime) >= fileTime;
  const away = g.away ?? [];
  const awayText = away.length ? ` ${away.join(', ')} ${away.length === 1 ? 'comes' : 'come'} back to the Vault first, with everything from ${esc(g.game)}.` : '';
  const canUse = !st?.blank && !st?.problem;
  const body = showDialog(`<h2>Use the real ${esc(g.game)} save</h2>
    <p class="trip-note">From now on PokeVault reads and changes <b>${esc(fileName(path))}</b>, the file ${esc(g.emulatorName ?? 'the emulator')} plays.
      ${st?.blank ? "That file is still empty: the game hasn't been saved in it yet. PokeVault puts your save in it, so the game starts from your save."
        : st?.problem ? `PokeVault can't read that file (${esc(st.problem)}). It can put your save in it instead.`
        : 'Which version should it start from?'}</p>
    <div class="pl-choice">
      <button class="btn${mineNewer ? '' : ' ghost'}" data-keep="1" type="button">${canUse ? "Keep PokeVault's version" : 'Put my save in it'}<small>last changed ${esc(when(g.saveTime))}. Everything you did in PokeVault goes into the real file (the file is backed up first).</small></button>
      ${canUse ? `<button class="btn${mineNewer ? ' ghost' : ''}" data-keep="0" type="button">Use the file as it is<small>last saved ${esc(when(fileTime))}${mineNewer ? '' : ', newer'}${st?.trainer ? ` (${esc(st.trainer)})` : ''}. Changes made only in PokeVault's copy are left behind.${awayText}</small></button>` : ''}
    </div>`);
  $$('[data-keep]', body).forEach(b => b.addEventListener('click', () => run(async () => {
    const r = await api(`/api/play/${g.id}/link-save`, { body: { path, keepPokeVault: b.dataset.keep === '1' } });
    closeDialog();
    toast(`${g.game} now uses ${fileName(path)}.${r.back?.length ? ` ${r.back.join(', ')} came back to the Vault.` : ''}`);
    await loadStatus();
    await after();
  })));
}

// Games: the Play button and a line on how the game is played.
function playButton(g) {
  const p = playOf(g.id);
  if (p?.running) return `<button class="btn gs-play" type="button" disabled>${ico('play')} Playing…</button>`;
  if (playReady(p)) return `<button class="btn gs-play" data-play="${esc(g.id)}" type="button">${ico('play')} Play</button>`;
  return `<button class="btn gs-play setup" data-setup="${esc(g.id)}" type="button" title="${esc(playWhy(p))}">${ico('play')} Set up to play</button>`;
}
function playLine(g) {
  const p = playOf(g.id);
  if (!state.play) return '';
  if (p?.running) return `<p class="gs-playline live">Playing in ${esc(p.running)} now. PokeVault refreshes when you close it.</p>`;
  if (!playReady(p)) return `<p class="gs-playline">${esc(playWhy(p))}</p>`;
  return `<p class="gs-playline">Plays in ${emuIcon(p.emulator, 'em-mini')}<b>${esc(p.emulatorName)}</b> · ${esc(fileName(p.rom))}${p.saveKind === 'upload' ? ' · <em>save not linked yet</em>' : ''}</p>`;
}

function renderGames() {
  if (!state.play) loadPlayInfo().then(() => state.view === 'games' && renderGames()).catch(() => {});
  const all = state.status?.games ?? [];
  const main = all.filter(g => g.supported && !g.hidden);
  const view = $('#view-games');
  if (!main.some(g => g.id === gameSel)) gameSel = main.some(g => g.id === state.gameId) ? state.gameId : main[0]?.id ?? null;
  const g = main.find(x => x.id === gameSel);
  const cover = x => { const ic = gameIcon(x); return `<span class="game-cover game-icon ${ic ? (ic.icon ? 'is-icon' : 'is-box') : 'none'}" style="--gc:${gameColor(x)}">${ic
    ? `<img src="${esc(ic.url)}" data-fallback="${esc(ic.fallback)}" alt="${esc(x.game)}" referrerpolicy="no-referrer">` : ''}<span>${esc(gameAbbr(x))}</span></span>`; };
  const moreMenu = x => `
    <details class="more">
      <summary aria-label="More options">${ico('more')}</summary>
      <div class="menu card">
        ${x.kind === 'upload' ? `<a class="mi" href="/api/games/${esc(x.id)}/download" download>${ico('download')} Download save</a>` : ''}
        <button class="mi" data-backups="${esc(x.id)}" type="button">${ico('download')} Backups &amp; restore</button>
        <button class="mi" data-copy="${esc(x.path)}" type="button">${ico('copy')} Copy file path</button>
        ${x.kind !== 'ryujinx' ? `<button class="mi danger" data-drop="${esc(x.id)}" type="button">${ico('close')} Disconnect</button>` : ''}
        <div class="mi-path">${esc(x.path)}</div>
      </div>
    </details>`;
  const trainer = g?.trainer || main.find(x => x.trainer)?.trainer || 'Trainer';
  const info = g ? `
          <div class="gs-info-head">${esc(g.game.startsWith('Pokémon') ? g.game : `Pokémon ${g.game}`)}</div>
          <div class="gs-info-body">
            <div class="gs-art">${cover(g)}</div>
            <table class="gs-table">
              <tr><th>Name</th><td>${esc(g.trainer ?? '—')}</td></tr>
              <tr><th>Play time</th><td>${esc(g.playTime || '—')}</td></tr>
              <tr><th>ID No.</th><td>${esc(g.tid ?? '—')}</td></tr>
              <tr><th>Pokémon</th><td>${g.pokemon}</td></tr>
              <tr><th>Last saved on</th><td>${esc(new Date(g.lastWrite).toLocaleString([], { dateStyle: 'short', timeStyle: 'short' }))}</td></tr>
            </table>
            <div class="gs-actions">${playButton(g)}<button class="btn ghost" data-open="${esc(g.id)}" type="button">Open</button>${moreMenu(g)}</div>
            ${playLine(g)}
          </div>` : '<div class="gs-info-head">No games yet</div><p class="gs-none">Use Upload a save or Add from this PC at the top.</p>';

  const refresh = async () => { await loadStatus(); renderGames(); };
  const openGame = async id => { window.sfx?.select(); setView('boxes'); setPane('game'); await selectGame(id).catch(fail); };
  // a game with no cover (or offline) keeps its coloured letters
  const coverFallback = scope => $$('.game-cover img', scope).forEach(im => im.addEventListener('error', () => {
    if (im.dataset.fallback) { const fb = im.dataset.fallback; delete im.dataset.fallback; im.src = fb; return; }
    im.parentNode.classList.add('none'); im.hidden = true;
  }));
  const bindInfo = scope => {
    coverFallback(scope);
    $$('[data-open]', scope).forEach(b => b.addEventListener('click', () => openGame(b.dataset.open)));
    $$('[data-play]', scope).forEach(b => b.addEventListener('click', () => run(() => startGame(b.dataset.play))));
    $$('[data-setup]', scope).forEach(b => b.addEventListener('click', () => setupGame(b.dataset.setup)));
    $$('[data-backups]', scope).forEach(b => b.addEventListener('click', () => {
      b.closest('details')?.removeAttribute('open');
      backupsDialog(b.dataset.backups);
    }));
    $$('[data-copy]', scope).forEach(b => b.addEventListener('click', async () => {
      try { await navigator.clipboard.writeText(b.dataset.copy); toast('Path copied.'); } catch { prompt('File path:', b.dataset.copy); }
    }));
    $$('[data-drop]', scope).forEach(b => b.addEventListener('click', () => {
      const x = all.find(y => y.id === b.dataset.drop);
      if (!confirm(`Disconnect ${x.game} from PokeVault?${x.kind === 'upload' ? ' The uploaded copy stays in data/uploaded-saves.' : ' The save file itself is not touched.'}`)) return;
      run(async () => { await api(`/api/games/${x.id}/remove`, { method: 'POST' }); await refresh(); });
    }));
    $$('details.more', scope).forEach(d => d.addEventListener('toggle', () => {
      if (d.open) $$('details.more', view).forEach(o => { if (o !== d) o.open = false; });
    }));
  };

  // Same games as on screen: just move the highlight and swap the card, so nothing re-plays its entrance.
  const ids = main.map(x => x.id).join('|');
  if (view.dataset.ids === ids && $('.gs-info', view)) {
    $$('.gs-tile', view).forEach(t => { const on = t.dataset.sel === gameSel; t.classList.toggle('sel', on); t.setAttribute('aria-selected', on); });
    $('.gs-who b', view).textContent = trainer;
    $('.gs-avatar', view).textContent = trainer.slice(0, 1).toUpperCase();
    const box = $('.gs-info', view);
    box.innerHTML = info;
    bindInfo(box);
    return;
  }
  view.dataset.ids = ids;

  view.innerHTML = `
    <div class="gs-strip">Select a game</div>
    <div class="gs">
      <section class="gs-info">${info}
      </section>
      <section class="gs-right">
        <div class="gs-who"><span class="gs-avatar" aria-hidden="true">${esc(trainer.slice(0, 1).toUpperCase())}</span><b>${esc(trainer)}</b></div>
        <div class="gs-tiles" role="listbox" aria-label="Games">
          ${main.map(x => `<button class="gs-tile ${x.id === gameSel ? 'sel' : ''}" type="button" role="option" data-sel="${esc(x.id)}"
            aria-selected="${x.id === gameSel}" title="${esc(x.game)}">${cover(x)}</button>`).join('')}
        </div>
      </section>
    </div>
    <div class="gs-foot"><span>${kh(['←', '→'], 'dpad-lr')} choose</span><span>${kh('P', 'X')} play</span><span>${kh('Enter', 'A')} open</span></div>`;

  coverFallback($('.gs-right', view));
  bindInfo($('.gs-info', view));
  $$('[data-sel]', view).forEach(b => {
    b.addEventListener('click', () => { if (gameSel !== b.dataset.sel) { gameSel = b.dataset.sel; window.sfx?.tick(); renderGames(); $(`[data-sel="${CSS.escape(gameSel)}"]`, view)?.focus(); } });
    b.addEventListener('dblclick', () => openGame(b.dataset.sel));
  });
}

// Top-bar buttons (shown on the Games screen): upload a save file, or add one by its path on this PC.
(() => {
  const after = async x => { toast(`Added ${x.game} (${x.trainer}).`); gameSel = x.id; await loadStatus(); if (state.view === 'games') renderGames(); };
  const pop = $('#pathPop');
  $('#topPath').addEventListener('click', e => {
    e.stopPropagation();
    pop.hidden = !pop.hidden;
    window.sfx?.[pop.hidden ? 'back' : 'menu']?.();
    if (!pop.hidden) $('#addPath').focus();
  });
  addEventListener('pointerdown', e => { if (!pop.hidden && !pop.contains(e.target) && !e.target.closest('#topPath')) pop.hidden = true; });
  pop.addEventListener('keydown', e => { if (e.key === 'Escape') { e.stopPropagation(); pop.hidden = true; } });
  pop.addEventListener('submit', e => {
    e.preventDefault();
    run(async () => {
      const x = await api('/api/games/add-path', { body: { path: $('#addPath').value } });
      pop.hidden = true; $('#addPath').value = '';
      await after(x);
    });
  });
  $('#uploadSave').addEventListener('change', e => {
    const f = e.target.files[0];
    e.target.value = '';
    if (!f) return;
    const fd = new FormData();
    fd.append('file', f);
    run(async () => after(await api('/api/games/upload', { body: fd })));
  });
})();
// Arrow keys move between the game tiles; Enter opens the chosen one.
function gamesKey(e) {
  const main = (state.status?.games ?? []).filter(g => g.supported && !g.hidden);
  if (!main.length) return false;
  const k = e.key.length === 1 ? e.key.toLowerCase() : e.key;
  const i = Math.max(0, main.findIndex(g => g.id === gameSel));
  const cols = Math.max(1, Math.round($('.gs-tiles')?.clientWidth / ($('.gs-tile')?.offsetWidth + 18) || 3));
  const d = { ArrowLeft: -1, a: -1, ArrowRight: 1, d: 1, ArrowUp: -cols, w: -cols, ArrowDown: cols, s: cols }[k];
  if (d !== undefined) {
    const j = Math.max(0, Math.min(main.length - 1, i + d));
    if (j !== i) { gameSel = main[j].id; window.sfx?.tick(); renderGames(); $(`[data-sel="${CSS.escape(gameSel)}"]`)?.focus(); }
    return true;
  }
  if (k === 'Enter') { window.sfx?.select(); setView('boxes'); setPane('game'); selectGame(main[i].id).catch(fail); return true; }
  if (k === 'p') { const id = main[i].id; if (playReady(playOf(id))) run(() => startGame(id)); else setupGame(id); return true; }
  return false;
}

/* ---------------- vault search ---------------- */

let searchTimer;
// The search panel's current filters, as a smart box would store them.
const searchFilters = () => ({
  q: $('#search').value.trim(), type: $('#typeFilter').value, shiny: $('#shinyFilter').checked,
  gen: +$('#genFilter').value || 0, perfect: $('#perfectFilter').checked,
});
const anyFilter = f => !!(f.q || f.type || f.shiny || f.gen || f.perfect);

// Smart boxes: saved searches that update themselves. Two come built in.
const SMART_PRESETS = [
  { id: 'p-shiny', name: '★ All shinies', shiny: true, preset: true },
  { id: 'p-perfect', name: 'Perfect IVs', perfect: true, preset: true },
];
let smartBoxes = [];
async function loadSmart() {
  smartBoxes = await api('/api/smart').catch(() => []);
  renderSmart();
}
function renderSmart() {
  const f = searchFilters();
  const same = s => (s.q ?? '') === f.q && (s.type ?? '') === f.type && !!s.shiny === f.shiny && (s.gen || 0) === f.gen && !!s.perfect === f.perfect;
  $('#smartRow').innerHTML = [...SMART_PRESETS, ...smartBoxes].map(s => `
    <span class="smart-chip ${same(s) ? 'on' : ''}"><button type="button" data-smart="${esc(s.id)}">${esc(s.name)}</button>${s.preset ? ''
      : `<button type="button" class="sc-x" data-smart-del="${esc(s.id)}" aria-label="Delete ${esc(s.name)}" title="Delete this smart box">×</button>`}</span>`).join('');
  $('#smartSave').hidden = !anyFilter(f) || [...SMART_PRESETS, ...smartBoxes].some(same);
}
function applySmart(s) {
  $('#search').value = s.q ?? '';
  $('#typeFilter').value = s.type ?? '';
  $('#shinyFilter').checked = !!s.shiny;
  $('#genFilter').value = s.gen ? String(s.gen) : '';
  $('#perfectFilter').checked = !!s.perfect;
  onSearch();
}
$('#smartRow').addEventListener('click', e => {
  const del = e.target.closest('[data-smart-del]');
  if (del) {
    const s = smartBoxes.find(x => x.id === del.dataset.smartDel);
    if (s && confirm(`Delete the smart box "${s.name}"? No Pokémon are touched.`))
      run(async () => { await api(`/api/smart/${encodeURIComponent(s.id)}/delete`, { method: 'POST' }); await loadSmart(); });
    return;
  }
  const b = e.target.closest('[data-smart]');
  if (b) applySmart([...SMART_PRESETS, ...smartBoxes].find(x => x.id === b.dataset.smart));
});
$('#smartSave').addEventListener('click', () => {
  const nm = prompt('Name this smart box (it keeps itself up to date):', '')?.trim();
  if (!nm) return;
  run(async () => { await api('/api/smart', { body: { ...searchFilters(), name: nm } }); await loadSmart(); toast(`Saved the smart box "${nm}".`); });
});

function onSearch() {
  clearTimeout(searchTimer);
  renderSmart();
  searchTimer = setTimeout(async () => {
    const { q, type, shiny, gen, perfect } = searchFilters();
    const out = $('#results');
    if (!anyFilter({ q, type, shiny, gen, perfect })) { out.replaceChildren(); state.highlight = null; render('vault'); return; }
    try {
      const params = new URLSearchParams({ q, type, shiny, gen, perfect });
      const list = await api('/api/vault/search?' + params);
      out.replaceChildren(...list.map(m => {
        const c = document.createElement('button');
        c.type = 'button'; c.className = 'mini';
        c.append(monIcon(m), `${name(m)}${m.shiny ? ' ★' : ''} · ${state.status.vaultBoxes[m.box]?.name}`);
        c.addEventListener('click', () => { state.highlight = m.id; goToBox('vault', m.box); });
        return c;
      }));
      if (!list.length) out.innerHTML = '<span class="muted">No matches in the vault.</span>';
    } catch (e) { fail(e); }
  }, 250);
}

/* ---------------- box rename ---------------- */

function renameBox(side) {
  const g = game();
  if (side === 'game') {
    if (!g) return;
    if (!g.canRename) return toast(`${g.game} doesn't support box names.`, true);
    if (!gameWritable(g)) return toast('Close Ryujinx to rename boxes in this game.', true);
  }
  const current = side === 'game' ? state.gameBoxes[state.box.game]?.name : state.boxInfo?.vault?.name;
  const max = side === 'game' ? (g.generation <= 5 ? 8 : 16) : 24;
  const d = showDialog(`<h2>Rename box</h2>
    <form id="renameForm" style="display:flex;gap:6px">
      <input class="field" id="renameInput" maxlength="${max}" value="${esc(current ?? '')}" style="flex:1" autocomplete="off">
      <button class="btn" type="submit">Save</button>
    </form>`);
  const input = $('#renameInput', d);
  input.focus(); input.select();
  $('#renameForm', d).addEventListener('submit', e => {
    e.preventDefault();
    const name = input.value.trim();
    if (!name || name === current) return closeDialog();
    run(async () => {
      if (side === 'game') {
        await api(`/api/games/${state.gameId}/boxes/${state.box.game}/rename`, { body: { name } });
        await loadStatus(); await loadGameBoxes(); await loadBox('game');
      } else {
        await api(`/api/vault/boxes/${state.box.vault}`, { body: { name } });
        await loadStatus(); await loadBox('vault');
      }
      closeDialog();
      toast(`Box renamed to “${name}”.`);
    });
  });
}

/* ---------------- 2D meadow ---------------- */

let meadow = null;        // the loaded meadow module instance
let meadowLoading = null;

async function ensureMeadow() {
  if (meadow) return meadow;
  meadowLoading ??= import('./meadow.js').then(mod => mod.createMeadow($('#meadow'), {
    onStatus: t => ($('#meadowStatus').textContent = t),
    onPick: showMeadowCard,
  }));
  meadow = await meadowLoading;
  return meadow;
}

// "Who's out": every box that has Pokémon in it, from the Vault and from every connected game.
// Values: "vault:<box>" or "game:<box>:<game id>" (the id last, since it may contain ':').
async function fillMeadowSources() {
  const sel = $('#meadowSource');
  const cur = sel.value;
  const groups = [];
  const vault = (state.status?.vaultBoxes ?? []).map((b, i) => [b, i]).filter(([b]) => b.count > 0)
    .map(([b, i]) => `<option value="vault:${i}">Vault · ${esc(b.name)} (${b.count})</option>`).join('');
  if (vault) groups.push(`<optgroup label="Vault">${vault}</optgroup>`);
  const list = (state.status?.games ?? []).filter(g => g.supported && !g.hidden && g.pokemon > 0);
  const boxes = await Promise.all(list.map(g =>
    api(`/api/games/${encodeURIComponent(g.id)}/boxes?peek=true`).then(b => [g, b]).catch(() => [g, []])));
  for (const [g, bs] of boxes) {
    const opts = bs.map((b, i) => [b, i]).filter(([b]) => b.count > 0)
      .map(([b, i]) => `<option value="game:${i}:${esc(g.id)}">${esc(g.game)} · ${esc(b.name)} (${b.count})</option>`).join('');
    if (opts) groups.push(`<optgroup label="${esc(g.game)}">${opts}</optgroup>`);
  }
  sel.innerHTML = groups.join('');
  if (cur && [...sel.options].some(o => o.value === cur)) sel.value = cur;
  else if (sel.options.length) sel.value = sel.options[0].value;
}
function parseSource(source) {
  const [side, box, ...rest] = source.split(':');
  return { side, box: +box, gameId: side === 'game' ? rest.join(':') : null };
}

let meadowToken = 0;
async function loadMeadow(source, focusKey) {
  const token = ++meadowToken;
  const { side, box, gameId } = parseSource(source);
  const url = side === 'vault' ? `/api/vault/box/${box}` : `/api/games/${encodeURIComponent(gameId)}/box/${box}`;
  const [m, data] = await Promise.all([ensureMeadow(), api(url)]);
  if (token !== meadowToken) return; // a newer choice won
  m.setActive(state.view === 'meadow');
  // a Vault Pokémon that's away in an older game is out playing there, not in the Meadow
  const mons = data.slots.filter(x => x && !(side === 'vault' && x.awayIn)).map(x => ({ ...x, key: side === 'vault' ? x.id : `${x.box}:${x.slot}`, side, gameId }));
  m.setPokemon(mons, focusKey);
  state.meadowSource = source;
}

const meadowSourceFor = side => (side === 'vault' ? `vault:${state.box.vault}` : `game:${state.box.game}:${state.gameId}`);
const openMeadow = (source, focusKey) => { setView('meadow', { noLoad: true }); return showMeadow(source, focusKey); };

// Shows the meadow; reloads only when asked for something new (or the first time).
async function showMeadow(source, focusKey) {
  await fillMeadowSources();
  if (!source && meadow && state.meadowSource) return;
  if (source && [...$('#meadowSource').options].some(o => o.value === source)) $('#meadowSource').value = source;
  if (!$('#meadowSource').value) {
    $('#meadowStatus').textContent = 'No Pokémon here yet.';
    return;
  }
  try { await loadMeadow($('#meadowSource').value, focusKey); }
  catch (e) { fail(e); $('#meadowStatus').textContent = 'Couldn’t open the Meadow: ' + (e.message ?? e); }
}

function showMeadowCard(mon, extra = {}) {
  const card = $('#meadowCard');
  if (!mon) { card.hidden = true; return; }
  card.innerHTML = `
    <button class="close" aria-label="Close" type="button">×</button>
    <div class="mc-row">
      ${extra.portrait ? `<img class="mc-portrait" src="${esc(extra.portrait)}" alt="" onerror="this.remove()">` : ''}
      <div><b>${esc(name(mon))}</b>${genderMark(mon)} ${mon.shiny ? '<span style="color:var(--shiny)">★</span>' : ''}
      <div class="muted">${mon.isEgg ? 'Egg' : `${esc(mon.speciesName)} · Lv. ${mon.level}`}</div></div>
    </div>
    <div class="badges">${mon.types.map(typeChip).join(' ')}</div>
    <p class="mc-line">${esc(mon.nature)} nature · ${esc(mon.ability)}</p>
    ${extra.persona ? `<p class="mc-line">${esc(extra.persona)}</p>` : ''}
    ${mon.isEgg || !mon.heightM ? '' : `<p class="mc-line muted">${mon.heightM.toFixed(1)} m · ${mon.weightKg ? `${mon.weightKg.toFixed(1)} kg` : '? kg'}</p>`}
    <p class="mc-line muted">OT ${esc(mon.ot)} · from ${esc(mon.origin || '?')}</p>
    ${mon.isEgg ? '' : '<div class="mc-bond" title="Friendship in the Meadow (kept by PokeVault, not in the Pokémon)"></div>'}
    <p class="mc-line mc-react" hidden></p>
    <div class="mc-actions">
      <button class="btn small" data-a="pet" type="button">${ico('heart')} Pet</button>
      ${mon.isEgg ? '' : '<button class="btn small ghost" data-a="feed" type="button">Feed</button>'}
      <button class="btn small ghost" data-a="summary" type="button">Summary</button>
    </div>
    <div class="mc-berries" hidden>${BERRIES.map(b => `<button type="button" data-berry="${b.id}" title="${b.name} Berry · ${b.flavor ?? 'mild'}">
      <img src="/items/${b.id}.png" alt="" onerror="this.style.visibility='hidden'"><span>${b.name}</span></button>`).join('')}</div>`;
  $('.close', card).addEventListener('click', () => { card.hidden = true; meadow?.clearFocus(); });
  const showBond = b => { const el = $('.mc-bond', card); if (el && b) el.innerHTML = `${'<span class="on">♥</span>'.repeat(b.hearts)}${'<span>♥</span>'.repeat(5 - b.hearts)}<small>${b.hearts === 5 ? 'Best friends' : `${b.points % 50}/50 to the next heart`}</small>`; };
  if (!mon.isEgg && mon.uid) api(`/api/bond/${encodeURIComponent(mon.uid)}`).then(showBond).catch(() => {});
  const bond = (kind, delta) => mon.uid && api(`/api/bond/${encodeURIComponent(mon.uid)}`, { body: { kind, delta } }).then(showBond).catch(() => {});
  $('[data-a="pet"]', card).addEventListener('click', () => { meadow?.pet(mon.key); bond('pet', 1); });
  $('[data-a="feed"]', card)?.addEventListener('click', () => { const r = $('.mc-berries', card); r.hidden = !r.hidden; });
  $$('[data-berry]', card).forEach(btn => btn.addEventListener('click', async () => {
    const b = BERRIES.find(x => x.id === btn.dataset.berry);
    const im = new Image();
    im.src = `/items/${b.id}.png`;
    try { await im.decode(); } catch { toast("That berry's picture couldn't load (offline?).", true); return; }
    const reaction = berryReaction(mon.nature, b);
    if (!meadow?.feed(mon.key, im, reaction)) return;
    $('.mc-berries', card).hidden = true;
    const line = $('.mc-react', card);
    line.hidden = false;
    line.textContent = reaction === 'love' ? `${name(mon)} loved the ${b.name} Berry! ${b.flavor} is its favourite flavour.`
      : reaction === 'dislike' ? `${name(mon)} didn't like the ${b.name} Berry. It's not fond of ${b.flavor.toLowerCase()} food.`
      : `${name(mon)} enjoyed the ${b.name} Berry.`;
    bond('treat', reaction === 'love' ? 5 : reaction === 'like' ? 2 : -1);
  }));
  $('[data-a="summary"]', card).addEventListener('click', async () => {
    // a Pokémon from another game: switch the Boxes to that game first, so the summary's buttons act on the right save
    if (mon.side === 'game' && mon.gameId && mon.gameId !== state.gameId) await selectGame(mon.gameId).catch(fail);
    openSummary(mon.side, mon);
  });
  card.hidden = false;
}

// Berries for the Meadow, and which flavour each nature likes or dislikes (as in the games:
// the raised stat's flavour is the favourite, the lowered one's is disliked; Oran is mild, everyone likes it).
const BERRIES = [
  { id: 'cheri-berry', name: 'Cheri', flavor: 'Spicy' }, { id: 'chesto-berry', name: 'Chesto', flavor: 'Dry' },
  { id: 'pecha-berry', name: 'Pecha', flavor: 'Sweet' }, { id: 'rawst-berry', name: 'Rawst', flavor: 'Bitter' },
  { id: 'aspear-berry', name: 'Aspear', flavor: 'Sour' }, { id: 'oran-berry', name: 'Oran', flavor: null },
];
const NATURE_STATS = {
  Lonely: ['Atk', 'Def'], Brave: ['Atk', 'Spe'], Adamant: ['Atk', 'SpA'], Naughty: ['Atk', 'SpD'],
  Bold: ['Def', 'Atk'], Relaxed: ['Def', 'Spe'], Impish: ['Def', 'SpA'], Lax: ['Def', 'SpD'],
  Timid: ['Spe', 'Atk'], Hasty: ['Spe', 'Def'], Jolly: ['Spe', 'SpA'], Naive: ['Spe', 'SpD'],
  Modest: ['SpA', 'Atk'], Mild: ['SpA', 'Def'], Quiet: ['SpA', 'Spe'], Rash: ['SpA', 'SpD'],
  Calm: ['SpD', 'Atk'], Gentle: ['SpD', 'Def'], Sassy: ['SpD', 'Spe'], Careful: ['SpD', 'SpA'],
};
const STAT_FLAVOR = { Atk: 'Spicy', Def: 'Sour', SpA: 'Dry', SpD: 'Bitter', Spe: 'Sweet' };
function berryReaction(nature, berry) {
  const ns = NATURE_STATS[nature];
  if (!berry.flavor || !ns) return 'like';
  return STAT_FLAVOR[ns[0]] === berry.flavor ? 'love' : STAT_FLAVOR[ns[1]] === berry.flavor ? 'dislike' : 'like';
}

/* ---------------- live catch alerts ---------------- */

// The server notices Pokémon that turn up in a save (a catch, a gift, an in-game trade) and numbers them;
// the page remembers the last number it showed for this run of PokeVault.
const catchSeen = { run: null, seq: 0 };
try { Object.assign(catchSeen, JSON.parse(localStorage.getItem('pv.catches') || '{}')); } catch { /* ignore */ }
let catchBusy = false;
async function checkCatches(s) {
  if (!s?.catchRun || catchBusy) return;
  if (catchSeen.run !== s.catchRun) { catchSeen.run = s.catchRun; catchSeen.seq = 0; }
  if (s.catchSeq <= catchSeen.seq) return;
  catchBusy = true;
  try {
    const list = await api(`/api/catches?after=${catchSeen.seq}`);
    catchSeen.seq = Math.max(s.catchSeq, ...list.map(e => e.id));
    try { localStorage.setItem('pv.catches', JSON.stringify(catchSeen)); } catch { /* ignore */ }
    const away = list.filter(e => e.away), live = list.filter(e => !e.away);
    if (away.length) catchDialog(away, 'While you were away');
    if (live.length > 3) catchSummaryCard(live);
    else live.forEach(catchCard);
  } finally { catchBusy = false; }
}

const catchName = e => e.mon.isEgg ? 'an Egg' : name(e.mon);
const catchWhere = e => e.where === 'party' ? 'in your party' : `in ${e.where}`;
const catchGameColor = e => gameColor(state.status?.games.find(g => g.id === e.gameId));

function dismissCatch(card) {
  if (!card.isConnected) return;
  card.classList.add('out');
  setTimeout(() => card.remove(), 300);
}
function catchCardShell(color, pic, html, onView) {
  const card = document.createElement('div');
  card.className = 'catch-card';
  card.style.setProperty('--gc', color);
  card.innerHTML = `<div class="cc-pic"></div><div class="cc-text">${html}</div>
    <button type="button" class="btn small">View</button><button type="button" class="cc-x" aria-label="Dismiss">×</button>`;
  $('.cc-pic', card).append(pic);
  $('.btn', card).addEventListener('click', () => { dismissCatch(card); onView(); });
  $('.cc-x', card).addEventListener('click', () => dismissCatch(card));
  const stack = $('#catchStack');
  stack.append(card);
  while (stack.children.length > 4) stack.firstElementChild.remove();
  setTimeout(() => dismissCatch(card), 12000);
  window.sfx?.catch?.();
}
function catchCard(e) {
  catchCardShell(catchGameColor(e), monIcon(e.mon),
    `<small>New in ${esc(e.game)}</small><b>${esc(e.mon.isEgg ? 'Egg' : name(e.mon))}${e.mon.shiny ? ' ★' : ''}</b>
     <span>${e.mon.isEgg ? '' : `Lv. ${e.mon.level} · `}${esc(catchWhere(e))}</span>`, () => viewCatch(e));
}
function catchSummaryCard(list) {
  const games = [...new Set(list.map(e => e.game))];
  catchCardShell(catchGameColor(list[0]), monIcon(list[list.length - 1].mon),
    `<small>New Pokémon</small><b>${list.length} new in ${esc(games.length === 1 ? games[0] : `${games.length} games`)}</b>
     <span>${esc(list.slice(-3).map(catchName).join(', '))}…</span>`, () => catchDialog(list, 'New Pokémon'));
}
function catchDialog(list, title) {
  const byGame = new Map();
  list.forEach(e => (byGame.get(e.game) ?? byGame.set(e.game, []).get(e.game)).push(e));
  const d = showDialog(`<h2>${esc(title)}</h2>
    <p class="muted" style="margin:4px 0 0">${list.length === 1 ? '1 Pokémon' : `${list.length} Pokémon`} turned up in your games.</p>
    <div class="catch-list">${[...byGame].map(([g, es]) => `<h3>${esc(g)}</h3>${es.map(e => `
      <div class="catch-row" data-id="${e.id}"><span class="cr-pic"></span>
        <div class="cr-text"><b>${esc(e.mon.isEgg ? 'Egg' : name(e.mon))}${e.mon.shiny ? ' ★' : ''}</b>
          <small>${e.mon.isEgg ? '' : `Lv. ${e.mon.level} · `}${esc(catchWhere(e))}</small></div>
        ${e.where === 'party' ? '' : '<button type="button" class="btn small ghost">View</button>'}</div>`).join('')}`).join('')}</div>`);
  $$('.catch-row', d).forEach(row => {
    const e = list.find(x => String(x.id) === row.dataset.id);
    $('.cr-pic', row).replaceWith(monIcon(e.mon));
    $('.btn', row)?.addEventListener('click', () => { closeDialog(); viewCatch(e); });
  });
  window.sfx?.catch?.();
}
// Opens the game's box with the new Pokémon in it and marks its slot.
async function viewCatch(e) {
  if (e.where === 'party') { toast(`${catchName(e)} is in your party in ${e.game}. Put it in a box in the game to see it here.`); return; }
  setView('boxes');
  try {
    if (state.gameId !== e.gameId) await selectGame(e.gameId);
    setPane('game');
    state.highlightGame = { gameId: e.gameId, box: e.mon.box, slot: e.mon.slot };
    state.box.game = e.mon.box;
    await loadGameBoxes();
    await loadBox('game');
    setCursor(e.mon.slot);
  } catch (err) { fail(err); }
}

/* ---------------- wiring ---------------- */

const types = Object.keys(TYPE_COLORS).filter(t => t !== 'Stellar');
for (const sel of ['#typeFilter', '#dexType'])
  $(sel).insertAdjacentHTML('beforeend', types.map(t => `<option>${t}</option>`).join(''));

// The party strip: clicks, the menu and drag & drop, like a box.
{
  const row = $('#party .party-slots');
  const at = e => e.target.closest('.slot');
  row.addEventListener('click', e => { const s = at(e); if (s) onSlot('party', +s.dataset.index); });
  row.addEventListener('contextmenu', e => { const s = at(e); if (s && slotMenu('party', +s.dataset.index)) e.preventDefault(); });
  row.addEventListener('dragstart', e => {
    const s = at(e);
    if (!s) return;
    state.drag = { side: 'party', index: +s.dataset.index };
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', 'pokemon');
  });
  row.addEventListener('dragend', () => { state.drag = null; $$('.slot.drop').forEach(x => x.classList.remove('drop')); });
  row.addEventListener('dragover', e => {
    const s = at(e);
    if (!s || !state.drag) return;
    e.preventDefault();
    $$('.slot.drop').forEach(x => x !== s && x.classList.remove('drop'));
    s.classList.add('drop');
  });
  row.addEventListener('drop', e => {
    const s = at(e);
    if (!s || !state.drag) return;
    e.preventDefault();
    s.classList.remove('drop');
    const { side: from, index } = state.drag;
    state.drag = null;
    onDrop(from, index, 'party', +s.dataset.index);
  });
}

for (const side of ['game', 'vault']) {
  const pane = $(`#pane-${side}`);
  const grid = $('.grid', pane);
  grid.addEventListener('click', e => {
    const s = e.target.closest('.slot');
    if (s) onSlot(side, +s.dataset.index);
  });
  // Right-click a Pokémon for its menu.
  grid.addEventListener('contextmenu', e => {
    const s = e.target.closest('.slot');
    if (s && slotMenu(side, +s.dataset.index)) e.preventDefault();
  });
  // With a mouse, the cursor follows the pointer (like moving it in the game).
  grid.addEventListener('pointerover', e => {
    const s = e.target.closest('.slot');
    state.mouseCursor = e.pointerType === 'mouse';
    if (s && state.mouseCursor && side !== state.pane && dual()) focusPane(side, +s.dataset.index);
    if (s && state.mouseCursor && side === state.pane && (+s.dataset.index !== state.cursor || state.cursorHidden)) setCursor(+s.dataset.index);
  });
  grid.addEventListener('dragstart', e => {
    const s = e.target.closest('.slot');
    if (!s) return;
    state.drag = { side, index: +s.dataset.index };
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', 'pokemon');
    if (side === 'vault') showCompat(state.slots.vault[+s.dataset.index]);
  });
  grid.addEventListener('dragend', () => {
    state.drag = null;
    $$('.slot.drop').forEach(x => x.classList.remove('drop'));
    if (!state.pick) clearCompat();
  });
  grid.addEventListener('dragover', e => {
    const s = e.target.closest('.slot');
    if (!s || !state.drag) return;
    e.preventDefault();
    $$('.slot.drop').forEach(x => x !== s && x.classList.remove('drop'));
    s.classList.add('drop');
  });
  grid.addEventListener('drop', e => {
    const s = e.target.closest('.slot');
    if (!s || !state.drag) return;
    e.preventDefault();
    s.classList.remove('drop');
    const { side: from, index } = state.drag;
    state.drag = null;
    onDrop(from, index, side, +s.dataset.index);
  });

  $$('.arrow[data-step]', pane).forEach(b => b.addEventListener('click', () => {
    const n = side === 'game' ? state.gameBoxes.length : state.status?.vaultBoxes.length ?? 0;
    if (!n) return;
    goToBox(side, (state.box[side] + +b.dataset.step + n) % n);
  }));
  $('.box-title', pane).addEventListener('click', () => {
    if (side === 'game' && !state.gameId) return gamePicker();
    boxPicker(side, b => goToBox(side, b)).catch(fail);
  });
  $('.tool[data-act="select"]', pane).addEventListener('click', () => startSelect(side));
  $('.rename', pane).addEventListener('click', () => renameBox(side));
}
// The yellow cursor goes away when the mouse leaves the boxes (it comes back on a slot, or with the keys).
$('.boxes-layout').addEventListener('pointerleave', e => {
  if (e.pointerType !== 'mouse' || state.pick) return;
  state.cursorHidden = true;
  $$('.slot.cursor').forEach(s => s.classList.toggle('cursor', false));
});
$('#meadowSource').addEventListener('change', e => loadMeadow(e.target.value).catch(fail));
$('#zoomIn').addEventListener('click', () => meadow?.zoomBy(1.2));
$('#meadowPhoto').addEventListener('click', () => window.meadowPhoto?.());
$('#zoomOut').addEventListener('click', () => meadow?.zoomBy(1 / 1.2));
$('#btnAllBoxes').addEventListener('click', () => {
  if (state.pane === 'game' && !state.gameId) return gamePicker();
  boxPicker(state.pane, b => goToBox(state.pane, b)).catch(fail);
});
// Search opens in the space to the left of the Vault box.
function setSearch(on) {
  if (on) setPane('vault');
  $('.bx').classList.toggle('searching', on);
  $('#btnSearch').classList.toggle('on', on);
  if (on) $('#search').focus();
}
$('#btnSearch').addEventListener('click', () => setSearch(!$('.bx').classList.contains('searching')));
$('#closeSearch').addEventListener('click', () => setSearch(false));
$('#btnSelect').addEventListener('click', () => startSelect(state.pane));
$('.tool[data-act="boxmenu"]').addEventListener('click', vaultBoxMenu);
$$('.mainnav button').forEach(b => b.addEventListener('click', () => setView(b.dataset.view)));
$('.bx-sources').addEventListener('click', async e => {
  const b = e.target.closest('button');
  if (!b) return;
  if (b.dataset.act === 'addgame') return setView('games');
  if (b.dataset.pane === 'game' && b.dataset.game !== state.gameId) await selectGame(b.dataset.game).catch(fail);
  setPane(b.dataset.pane);
});
$('#closeSheet').addEventListener('click', closeSheet);
$('#backdrop').addEventListener('click', closeSheet);
$('#dialogClose').addEventListener('click', closeDialog);
$('#phoneBtn').addEventListener('click', phoneDialog);
$('#themeBtn').addEventListener('click', themeDialog);
const showMute = () => { $('#muteBtn').innerHTML = ico(window.sfx?.muted ? 'mute' : 'sound'); $('#muteBtn').title = window.sfx?.muted ? 'Sound off (click to turn on)' : 'Sound on (click to mute)'; };
$('#muteBtn').addEventListener('click', () => { window.sfx?.setMuted(!window.sfx.muted); showMute(); if (!window.sfx.muted) window.sfx.select(); });
showMute();
const showMusic = () => { const on = window.sfx?.musicOn; $('#musicBtn').innerHTML = ico(on ? 'music' : 'music-off'); $('#musicBtn').title = on ? 'Music on (click to turn off)' : 'Music off (click to turn on)'; $('#musicBtn').setAttribute('aria-pressed', String(!!on)); };
$('#musicBtn').addEventListener('click', () => { window.sfx?.setMusic(!window.sfx.musicOn); showMusic(); });
showMusic();
// The boxes are the first screen: play the start-up chime (it sounds on your first click if the window starts silent).
window.sfx?.open();
$('#search').addEventListener('input', onSearch);
$('#typeFilter').addEventListener('change', onSearch);
$('#shinyFilter').addEventListener('change', onSearch);
$('#genFilter').addEventListener('change', onSearch);
$('#perfectFilter').addEventListener('change', onSearch);
$('#genFilter').insertAdjacentHTML('beforeend', [1, 2, 3, 4, 5, 6, 7, 8, 9].map(g => `<option value="${g}">From Gen ${g}</option>`).join(''));
loadSmart();
$('#dexSearch').addEventListener('input', renderDex);
$('#trainerCardBtn').addEventListener('click', () => window.shareTrainerCard?.());
$('#dexType').addEventListener('change', renderDex);
$$('#dexChips .chip').forEach(c => c.addEventListener('click', () => {
  state.dexFilter = c.dataset.f;
  $$('#dexChips .chip').forEach(x => x.classList.toggle('active', x === c));
  renderDex();
}));
document.addEventListener('keydown', e => {
  // F11: full screen (the desktop window turns borderless; Esc or F11 again leaves it).
  if (e.key === 'F11') {
    e.preventDefault();
    if (document.fullscreenElement) document.exitFullscreen?.();
    else document.documentElement.requestFullscreen?.().catch(() => {});
    return;
  }
  if (!$('#summary').hidden && !$('#dialog').open) {   // a dialog over the summary (Share card) handles its own keys
    const k = e.key.length === 1 ? e.key.toLowerCase() : e.key;
    if (['ArrowLeft', 'a', 'q', 'l'].includes(k)) { e.preventDefault(); stepSummary(-1); }
    else if (['ArrowRight', 'd', 'e', 'r'].includes(k)) { e.preventDefault(); stepSummary(1); }
    else if (k === 'ArrowUp' || k === 'w') { e.preventDefault(); stepMove(-1); }
    else if (k === 'ArrowDown' || k === 's') { e.preventDefault(); stepMove(1); }
    else if (k === 'Enter' || k === ' ' || k === 'z') { e.preventDefault(); if (!e.repeat) pickMove(sum.move < 0 ? 0 : sum.move, true); }
    else if (k === 't') { e.preventDefault(); toggleRibbons(); }
    else if (k === 'y' || k === 'Tab') { e.preventDefault(); cycleStatsView(); }
    else if (k === 'c' && !$('#dialog').open) { e.preventDefault(); window.shareMonCard?.(sum.list[sum.i]); }
    else if (k === 'j') { e.preventDefault(); togglePanel('journey'); }
    else if (k === 'Escape' || k === 'Backspace' || k === 'x') {
      e.preventDefault();
      if (sum.panel) togglePanel(null); else if (sum.ribbons) toggleRibbons(false); else if (sum.moveOpen) pickMove(sum.move, true); else closeSummary();
    }
    return;
  }
  if (menu) {
    const k = e.key.length === 1 ? e.key.toLowerCase() : e.key;
    if (k === 'ArrowUp' || k === 'w') { e.preventDefault(); menuFocus(menu.k - 1); }
    else if (k === 'ArrowDown' || k === 's') { e.preventDefault(); menuFocus(menu.k + 1); }
    else if (k === 'Enter' || k === ' ' || k === 'z') { e.preventDefault(); menuDo(MENU_ITEMS[menu.k][0]); }
    else if (k === 'Escape' || k === 'Backspace' || k === 'x') { e.preventDefault(); closeMonMenu(); }
    return;
  }
  if (state.view === 'games' && !$('#dialog').open && !e.target.closest?.('input, select, textarea, summary, details') && gamesKey(e)) { e.preventDefault(); return; }
  if (e.key === 'Escape' && !$('#dialog').open) { closeSheet(); endPick(); endSelect(); }
  // Game-style controls on the Boxes screen: arrows move the cursor, Q/E change box, Enter opens.
  if (state.view !== 'boxes' || $('#dialog').open || !$('#sheet').hidden || e.target.closest?.('input, select, textarea')) return;
  if (e.ctrlKey || e.metaKey || e.altKey) return;
  const side = state.pane, size = gridSize(side), cols = size % 6 === 0 ? 6 : 5;
  const k = e.key.length === 1 ? e.key.toLowerCase() : e.key;
  // arrows or WASD move the cursor; Space opens the summary
  const move = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -cols, ArrowDown: cols, a: -1, d: 1, w: -cols, s: cols }[k];
  if (move !== undefined) {
    e.preventDefault();
    state.mouseCursor = false;
    // with both boxes showing, going off the game box's right edge lands in the Vault box, and back
    const col = state.cursor % cols, row = Math.floor(state.cursor / cols);
    if (dual() && side === 'game' && move === 1 && col === cols - 1) { focusPane('vault', row * (gridSize('vault') % 6 === 0 ? 6 : 5)); window.sfx?.tick(); return; }
    if (dual() && side === 'vault' && move === -1 && col === 0) {
      const gc = gridSize('game') % 6 === 0 ? 6 : 5;
      focusPane('game', Math.min(gridSize('game') - 1, row * gc + gc - 1)); window.sfx?.tick(); return;
    }
    setCursor((state.cursor + move + size) % size);
  } else if (k === 'q' || k === 'e' || k === 'PageUp' || k === 'PageDown') {
    const n = side === 'game' ? state.gameBoxes.length : state.status?.vaultBoxes.length ?? 0;
    if (n) goToBox(side, (state.box[side] + (k === 'e' || k === 'PageDown' ? 1 : -1) + n) % n);
  } else if (k === 'Enter') {
    const m = state.slots[side][state.cursor];
    if (state.pick) { e.preventDefault(); onSlot(side, state.cursor); }
    else if (m) { e.preventDefault(); slotMenu(side, state.cursor); }
  } else if (k === ' ' && !state.pick) {
    const m = state.slots[side][state.cursor];
    e.preventDefault();
    if (m) openSummary(side, m);
  }
});

/* ---------------- playing a game: pause, then refresh ---------------- */

let playingKey = null;       // the game being played (emulator + game), or null
let playingPeek = null;      // the session the overlay was dismissed for
const playKey = p => p ? `${p.emulator}|${p.gameId ?? ''}` : null;

function showPlaying(p) {
  const el = $('#playing');
  const g = p?.gameId ? state.status?.games.find(x => x.id === p.gameId) : null;
  const shown = !!p && playingPeek !== playKey(p);
  el.hidden = !shown;
  document.body.classList.toggle('is-playing', !!p);
  window.sfx?.pauseMusic?.(!!p || state.view === 'meadow');
  meadow?.setActive(!p && state.view === 'meadow');
  if (!shown) return;
  $('.playing-art', el).innerHTML = g ? mascotChip(g, true) : ico('play');
  $('#playingTitle').textContent = g ? `Playing ${g.game}` : `${p.emulator} is open`;
  $('.playing-sub', el).textContent = g ? `in ${p.emulator}` : 'Playing a game';
}
$('#playingPeek').addEventListener('click', () => { playingPeek = playingKey; $('#playing').hidden = true; });

// Everything a save can change: the game's boxes and party, the Vault (Pokémon brought home), the Pokédex, the Meadow.
async function refreshEverything() {
  await refreshAll();
  if (state.view === 'dex') await loadDex().catch(() => {});
  await loadPlayInfo().catch(() => {});
  if (state.view === 'play') await renderPlay().catch(() => {});
  if (state.view === 'games') renderGames();
  if (state.view === 'meadow' && state.meadowSource) await loadMeadow(state.meadowSource).catch(() => {});
}

async function checkStatus() {
  if (state.busy) return;
  try {
    const { prev, s } = await loadStatus();
    const key = playKey(s.playing);
    if (key !== playingKey) {
      const was = prev?.playing;
      playingKey = key;
      showPlaying(s.playing);
      if (!key && was) {
        // the game was closed: show what changed in it
        await refreshEverything();
        const g = was.gameId ? s.games.find(x => x.id === was.gameId) : null;
        toast(`Back from ${g?.game ?? was.emulator}. PokeVault is up to date.`);
        return;
      }
    }
    const a = prev?.games.find(g => g.id === state.gameId);
    const b = s.games.find(g => g.id === state.gameId);
    if (state.view === 'boxes' && (a?.lastWrite !== b?.lastWrite || prev?.emulatorRunning !== s.emulatorRunning)) {
      await loadGameBoxes(); await loadBox('game');
      updateActionBar();
    }
  } catch { /* server stopped */ }
}
// Check often while a game is open, and right away when you come back to PokeVault.
setInterval(() => { if (!document.hidden || playingKey) checkStatus(); }, 3000);
document.addEventListener('visibilitychange', () => { if (!document.hidden) checkStatus(); });
addEventListener('focus', () => checkStatus());

try { localStorage.removeItem('pv.gameHidden'); } catch { /* old setting, no longer used */ }
// Open on the Vault (where your stored Pokémon are), or wherever you were last time.
let startPane = 'vault';
try { startPane = localStorage.getItem('pv.pane') === 'game' ? 'game' : 'vault'; } catch { /* ignore */ }
setPane(startPane);
try { localStorage.removeItem('pv.listView'); } catch { /* ignore */ }   // the list view was removed
refreshAll().catch(fail);
