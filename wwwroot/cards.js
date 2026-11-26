'use strict';
/* =========================================================
   Shareable cards: a Pokémon card (from its summary) and a Trainer card (from the Pokédex), drawn on a
   1200×630 canvas — the size Reddit, Discord and X show best — then saved as a PNG or copied.
   Uses app.js helpers (TYPE_COLORS, name, monRenderUrls, monIconUrls, api, showDialog, toast…).
   ========================================================= */

const CARD_W = 1200, CARD_H = 630;
const CARD_FONT = '"Segoe UI", system-ui, sans-serif';

// First of the URLs that loads (CORS-clean, so the canvas can still be saved), or null.
function cardImage(urls) {
  const list = [].concat(urls).filter(Boolean);
  return new Promise(resolve => {
    const next = () => {
      if (!list.length) return resolve(null);
      const im = new Image();
      im.crossOrigin = 'anonymous';
      im.onload = () => resolve(im);
      im.onerror = next;
      im.src = list.shift();
    };
    next();
  });
}
function cardRound(g, x, y, w, h, r) {
  g.beginPath();
  g.moveTo(x + r, y); g.arcTo(x + w, y, x + w, y + h, r); g.arcTo(x + w, y + h, x, y + h, r);
  g.arcTo(x, y + h, x, y, r); g.arcTo(x, y, x + w, y, r); g.closePath();
}
// Mix a #rrggbb colour with black (amt < 0) or white (amt > 0).
function cardShade(hex, amt) {
  const n = parseInt(String(hex).replace('#', ''), 16), t = amt < 0 ? 0 : 255, p = Math.abs(amt);
  const c = s => Math.round(((n >> s) & 255) + (t - ((n >> s) & 255)) * p);
  return `rgb(${c(16)},${c(8)},${c(0)})`;
}
function cardText(g, text, x, y, { size = 20, weight = 600, color = '#fff', align = 'left', max = 0, alpha = 1 } = {}) {
  g.save();
  g.globalAlpha = alpha;
  g.font = `${weight} ${size}px ${CARD_FONT}`;
  g.fillStyle = color; g.textAlign = align; g.textBaseline = 'alphabetic';
  let t = String(text ?? '');
  if (max) while (t.length > 1 && g.measureText(t).width > max) t = t.slice(0, -2) + '…';
  g.fillText(t, x, y);
  g.restore();
  return g.measureText(t).width;
}
function cardPill(g, x, y, label, color, { h = 34, size = 17, pad = 16 } = {}) {
  g.save();
  g.font = `700 ${size}px ${CARD_FONT}`;
  const w = g.measureText(label).width + pad * 2;
  cardRound(g, x, y, w, h, h / 2); g.fillStyle = color; g.fill();
  g.fillStyle = '#fff'; g.textBaseline = 'middle'; g.fillText(label, x + pad, y + h / 2 + 1);
  g.restore();
  return w;
}
function cardBackground(g, c1, c2) {
  const bg = g.createLinearGradient(0, 0, CARD_W, CARD_H);
  bg.addColorStop(0, cardShade(c1, -0.25)); bg.addColorStop(1, cardShade(c2, -0.55));
  g.fillStyle = bg; g.fillRect(0, 0, CARD_W, CARD_H);
  g.save();                                   // soft diagonal stripes
  g.globalAlpha = 0.06; g.strokeStyle = '#fff'; g.lineWidth = 14;
  for (let x = -CARD_H; x < CARD_W; x += 44) { g.beginPath(); g.moveTo(x, CARD_H); g.lineTo(x + CARD_H, 0); g.stroke(); }
  g.restore();
}
function cardLogo(g, x, y) {
  cardRound(g, x, y, 40, 40, 11); g.fillStyle = '#17a398'; g.fill();
  for (let i = 0; i < 9; i++) {
    cardRound(g, x + 8 + (i % 3) * 9, y + 8 + Math.floor(i / 3) * 9, 7, 7, 2);
    g.fillStyle = i === 4 ? '#ffd23f' : '#c9f1ea'; g.fill();
  }
  cardText(g, 'PokeVault', x + 50, y + 28, { size: 22, weight: 800 });
}
function cardSparkles(g, cx, cy, r) {
  g.save(); g.fillStyle = '#fff6c2';
  [[-0.7, -0.6, 16], [0.75, -0.45, 11], [0.55, 0.7, 13], [-0.6, 0.55, 9]].forEach(([dx, dy, s]) => {
    const x = cx + dx * r, y = cy + dy * r;
    g.beginPath();
    for (let i = 0; i < 8; i++) { const a = i * Math.PI / 4, rr = i % 2 ? s * 0.28 : s; g.lineTo(x + Math.cos(a) * rr, y + Math.sin(a) * rr); }
    g.closePath(); g.fill();
  });
  g.restore();
}
// The box around an image's visible pixels: [x, y, w, h].
function cardTrim(im) {
  const c = document.createElement('canvas');
  c.width = im.width; c.height = im.height;
  const g = c.getContext('2d', { willReadFrequently: true });
  g.drawImage(im, 0, 0);
  const d = g.getImageData(0, 0, c.width, c.height).data;
  let x0 = c.width, y0 = c.height, x1 = -1, y1 = -1;
  for (let y = 0; y < c.height; y++) for (let x = 0; x < c.width; x++)
    if (d[(y * c.width + x) * 4 + 3] > 8) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
  return x1 < 0 ? [0, 0, im.width, im.height] : [x0, y0, x1 - x0 + 1, y1 - y0 + 1];
}
function newCardCanvas() {
  const cv = document.createElement('canvas');
  cv.width = CARD_W; cv.height = CARD_H;
  return [cv, cv.getContext('2d')];
}

/* ---------- Pokémon card ---------- */

async function drawMonCard(m) {
  const [cv, g] = newCardCanvas();
  const t1 = TYPE_COLORS[m.types?.[0]] ?? '#19b39b', t2 = TYPE_COLORS[m.types?.[1]] ?? t1;
  cardBackground(g, t1, t2);

  // the Pokémon, on a glowing disc
  const glow = g.createRadialGradient(320, 330, 40, 320, 330, 290);
  glow.addColorStop(0, 'rgba(255,255,255,.42)'); glow.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = glow; g.fillRect(0, 0, 660, CARD_H);
  const art = await cardImage(m.isEgg ? [`${SPR}egg.png`] : monRenderUrls(m));
  if (art) {
    const s = Math.min(460 / art.width, 460 / art.height);
    g.save(); g.shadowColor = 'rgba(0,0,0,.35)'; g.shadowBlur = 30; g.shadowOffsetY = 16;
    g.drawImage(art, 320 - art.width * s / 2, 335 - art.height * s / 2, art.width * s, art.height * s);
    g.restore();
  }
  if (m.shiny) cardSparkles(g, 320, 330, 210);
  // its ribbons and marks, as a shelf of icons (the last spot says how many more there are)
  const rbs = m.ribbons ?? [];
  if (rbs.length) {
    const size = 44, gap = 6, max = 11, show = rbs.length > max ? max - 1 : rbs.length;
    const w = Math.min(rbs.length, max) * (size + gap) + gap;
    cardRound(g, 36, 556, w, size + 12, 16); g.fillStyle = 'rgba(0,0,0,.32)'; g.fill();
    const icons = await Promise.all(rbs.slice(0, show).map(r => cardImage([`/ribbons/${encodeURIComponent(r.key)}.png`])));
    icons.forEach((im, i) => {
      const x = 36 + gap + i * (size + gap), y = 562;
      if (im) { const s = Math.min(size / im.width, size / im.height); g.drawImage(im, x + (size - im.width * s) / 2, y + (size - im.height * s) / 2, im.width * s, im.height * s); }
      else { g.beginPath(); g.arc(x + size / 2, y + size / 2, size / 2 - 4, 0, Math.PI * 2); g.fillStyle = '#e2a400'; g.fill(); cardText(g, rbs[i].name.slice(0, 1), x + size / 2, y + size / 2 + 7, { size: 20, weight: 800, align: 'center' }); }
    });
    if (rbs.length > max) cardText(g, `+${rbs.length - show}`, 36 + gap + show * (size + gap) + size / 2, 592, { size: 18, weight: 800, align: 'center' });
  }

  // right-hand panel
  const X = 640, W = 500;
  cardRound(g, X - 24, 36, W + 48, CARD_H - 72, 28); g.fillStyle = 'rgba(0,0,0,.28)'; g.fill();
  cardText(g, `No. ${String(m.species).padStart(4, '0')}${m.formName ? ` · ${m.formName}` : ''}`, X, 84, { size: 18, weight: 700, alpha: .8 });
  const title = m.isEgg ? 'Egg' : name(m);
  const tw = cardText(g, title, X, 140, { size: 54, weight: 800, max: W - 120 });
  if (m.shiny) cardText(g, '★', X + tw + 12, 132, { size: 34, weight: 800, color: '#ffd23f' });
  const sub = [!m.isEgg && `Lv. ${m.level}`, m.gender === 0 ? '♂' : m.gender === 1 ? '♀' : '', m.isNicknamed && !m.isEgg ? m.speciesName : ''].filter(Boolean).join('   ');
  cardText(g, sub, X, 176, { size: 22, weight: 600, alpha: .9 });
  let px = X;
  for (const t of m.types ?? []) px += cardPill(g, px, 194, t, TYPE_COLORS[t] ?? '#888') + 8;
  if (m.teraType) cardPill(g, px + 4, 194, `Tera ${m.teraType}`, cardShade(TYPE_COLORS[m.teraType] ?? '#40b5a5', -0.2));

  // nature · ability · item
  [['Nature', m.nature], ['Ability', m.ability || '—'], ['Held item', m.heldItem || 'None']].forEach(([k, v], i) => {
    const x = X + i * 172;
    cardText(g, k.toUpperCase(), x, 262, { size: 13, weight: 700, alpha: .7 });
    cardText(g, v, x, 288, { size: 19, weight: 700, max: 162 });
  });

  // moves, two by two
  (m.moves ?? []).slice(0, 4).forEach((mv, i) => {
    const x = X + (i % 2) * 254, y = 310 + Math.floor(i / 2) * 50;
    cardRound(g, x, y, 242, 40, 12); g.fillStyle = TYPE_COLORS[mv.type] ?? '#6b7c7a'; g.fill();
    cardText(g, mv.name, x + 14, y + 27, { size: 18, weight: 700, max: 214 });
  });

  // stats as bars
  const max = Math.max(200, ...(m.stats ?? [0]));
  (m.stats ?? []).forEach((v, i) => {
    const x = X + (i % 2) * 254, y = 430 + Math.floor(i / 2) * 36;
    cardText(g, ['HP', 'Atk', 'Def', 'SpA', 'SpD', 'Spe'][i], x, y + 16, { size: 15, weight: 700, alpha: .75 });
    cardRound(g, x + 46, y + 4, 150, 14, 7); g.fillStyle = 'rgba(255,255,255,.18)'; g.fill();
    cardRound(g, x + 46, y + 4, Math.max(14, 150 * v / max), 14, 7); g.fillStyle = '#fff'; g.fill();
    cardText(g, v, x + 204, y + 17, { size: 16, weight: 800 });
  });

  // trainer and origin, and the logo
  const origin = [m.ot && `OT ${m.ot}`, m.tid && `ID ${m.tid}`, m.origin && `from ${m.origin}`].filter(Boolean).join('  ·  ');
  cardText(g, origin, X, 560, { size: 16, weight: 600, alpha: .85, max: W });
  cardLogo(g, CARD_W - 196, CARD_H - 76);
  return cv;
}

/* ---------- Trainer card ---------- */

async function drawTrainerCard(t, trainerName) {
  const [cv, g] = newCardCanvas();
  cardBackground(g, '#19b39b', '#0b4f4b');
  cardLogo(g, 48, 40);
  cardText(g, 'TRAINER CARD', CARD_W - 48, 70, { size: 20, weight: 800, align: 'right', alpha: .8 });
  cardText(g, trainerName || 'Trainer', 48, 150, { size: 60, weight: 800, max: 700 });
  cardText(g, `${t.generations} generation${t.generations === 1 ? '' : 's'} · ${t.originGames} game${t.originGames === 1 ? '' : 's'} of origin`, 50, 186, { size: 20, weight: 600, alpha: .85 });

  // four big numbers
  const pct = t.dexTotal ? Math.round(t.dexRegistered / t.dexTotal * 1000) / 10 : 0;
  [[t.total, 'Pokémon'], [`${t.dexRegistered}`, `Pokédex · ${pct}%`], [t.shinies, '★ Shiny'], [t.games, 'Games connected']].forEach(([v, k], i) => {
    const x = 48 + i * 280, y = 214;
    cardRound(g, x, y, 260, 112, 22); g.fillStyle = 'rgba(0,0,0,.26)'; g.fill();
    cardText(g, v, x + 22, y + 66, { size: 48, weight: 800, color: i === 2 ? '#ffd23f' : '#fff' });
    cardText(g, k, x + 22, y + 96, { size: 17, weight: 700, alpha: .8 });
  });

  // favourite type, most caught and oldest
  const tile = (x, label) => { cardRound(g, x, 346, 360, 122, 22); g.fillStyle = 'rgba(0,0,0,.2)'; g.fill(); cardText(g, label, x + 20, 376, { size: 14, weight: 800, alpha: .7 }); };
  tile(48, 'FAVOURITE TYPE');
  if (t.types?.[0]) {
    cardPill(g, 68, 396, t.types[0].type, TYPE_COLORS[t.types[0].type] ?? '#888', { h: 44, size: 22, pad: 20 });
    cardText(g, `${t.types[0].count} Pokémon`, 70, 458, { size: 16, weight: 600, alpha: .85 });
  }
  // A pixel sprite, trimmed to the Pokémon itself and enlarged by a whole number so it stays crisp.
  const sprite = async (p, x, y, size) => {
    const im = p && await cardImage(monIconUrls(p));
    if (!im) return;
    const [sx, sy, sw, sh] = cardTrim(im);
    const s = Math.max(1, Math.floor(size / Math.max(sw, sh)));
    g.save(); g.imageSmoothingEnabled = false;
    g.drawImage(im, sx, sy, sw, sh, x + (size - sw * s) / 2, y + (size - sh * s) / 2, sw * s, sh * s);
    g.restore();
  };
  tile(428, 'MOST CAUGHT');
  if (t.top) {
    await sprite(t.top.mon, 440, 368, 96);
    cardText(g, t.top.mon.speciesName, 548, 422, { size: 24, weight: 800, max: 220 });
    cardText(g, `× ${t.top.count}`, 548, 452, { size: 18, weight: 700, alpha: .85 });
  }
  tile(808, 'OLDEST POKÉMON');
  if (t.oldest) {
    await sprite(t.oldest, 820, 368, 96);
    cardText(g, t.oldest.name, 928, 422, { size: 24, weight: 800, max: 220 });
    cardText(g, `met ${t.oldest.metDate}`, 928, 452, { size: 16, weight: 600, alpha: .85, max: 220 });
  }

  // showcase
  cardText(g, 'SHOWCASE', 50, 506, { size: 14, weight: 800, alpha: .7 });
  for (const [i, p] of (t.showcase ?? []).entries()) {
    const x = 48 + i * 116;
    cardRound(g, x, 516, 104, 84, 18); g.fillStyle = 'rgba(255,255,255,.12)'; g.fill();
    await sprite(p, x + 14, 518, 76);
    if (p.shiny) cardText(g, '★', x + 92, 536, { size: 18, weight: 800, color: '#ffd23f', align: 'right' });
  }
  cardText(g, `${t.dexRegistered} / ${t.dexTotal} registered`, CARD_W - 48, CARD_H - 44, { size: 18, weight: 700, align: 'right', alpha: .85 });
  return cv;
}

/* ---------- the share dialog ---------- */

async function cardBlob(cv) { return new Promise(r => cv.toBlob(r, 'image/png')); }
async function saveCard(cv, file) {
  const url = URL.createObjectURL(await cardBlob(cv));
  const a = Object.assign(document.createElement('a'), { href: url, download: file });
  document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
  toast(`Saved ${file}`);
}
async function copyCard(cv) {
  try {
    await navigator.clipboard.write([new ClipboardItem({ 'image/png': cardBlob(cv) })]);
    toast('Card copied. Paste it anywhere.');
  } catch { toast("Couldn't copy the image here. Use Save PNG instead.", true); }
}
async function cardDialog(title, file, draw, extra = '') {
  const d = showDialog(`<h2>${esc(title)}</h2>${extra}
    <div class="card-preview"><p class="muted">Drawing the card…</p></div>
    <div class="card-actions"><button type="button" class="btn" data-a="save">Save PNG</button>
      <button type="button" class="btn ghost" data-a="copy">Copy image</button></div>`);
  const dlg = d.closest('dialog');
  dlg?.classList.add('wide');
  dlg?.addEventListener('close', () => dlg.classList.remove('wide'), { once: true });
  let cv = null;
  const redraw = async () => {
    cv = await draw();
    const box = $('.card-preview', d);
    if (!box?.isConnected) return;
    cv.className = 'card-canvas';
    box.replaceChildren(cv);
  };
  $('[data-a="save"]', d).addEventListener('click', () => cv && saveCard(cv, file()));
  $('[data-a="copy"]', d).addEventListener('click', () => cv && copyCard(cv));
  await redraw();
  return { d, redraw };
}

/* ---------- Meadow photo mode ---------- */

const PHOTO_FILTERS = {
  none: ['None', 'none'], warm: ['Warm', 'sepia(.25) saturate(1.3) hue-rotate(-8deg)'], cool: ['Cool', 'saturate(1.1) hue-rotate(14deg) brightness(1.04)'],
  vintage: ['Vintage', 'sepia(.6) contrast(1.05) brightness(.98)'], vivid: ['Vivid', 'saturate(1.6) contrast(1.1)'],
  mono: ['Mono', 'grayscale(1) contrast(1.1)'], dreamy: ['Dreamy', 'brightness(1.1) saturate(1.25) blur(0.6px)'],
};
const PHOTO_FRAMES = { none: 'None', polaroid: 'Instant', film: 'Film', rounded: 'Rounded', pixel: 'Pixel' };

// The finished photo: the frozen Meadow with the filter, the frame and the caption.
function composePhoto(src, frame, filter, caption) {
  const W = src.width, H = src.height, u = Math.round(Math.min(W, H) * 0.035);
  // the frame's border on each side: top, right, bottom, left (an instant photo has room for the caption at the bottom)
  const [pt, pr, pb, pl] = { none: [0, 0, 0, 0], polaroid: [u, u, u * 4.2, u], film: [u * 1.8, u * 0.9, u * 1.8, u * 0.9], rounded: [u * 0.6, u * 0.6, u * 0.6, u * 0.6], pixel: [u, u, u, u] }[frame];
  const cv = document.createElement('canvas');
  cv.width = Math.round(W + pl + pr); cv.height = Math.round(H + pt + pb);
  const g = cv.getContext('2d');
  if (frame === 'polaroid') { g.fillStyle = '#fbfaf6'; g.fillRect(0, 0, cv.width, cv.height); }
  if (frame === 'film') {
    g.fillStyle = '#141414'; g.fillRect(0, 0, cv.width, cv.height);
    g.fillStyle = '#efe9da';
    for (let x = u * 0.6; x < cv.width; x += u * 1.6) { cardRound(g, x, pt * 0.3, u * 0.8, pt * 0.4, u * 0.15); g.fill(); cardRound(g, x, cv.height - pb * 0.7, u * 0.8, pb * 0.4, u * 0.15); g.fill(); }
  }
  if (frame === 'rounded') { cardRound(g, 0, 0, cv.width, cv.height, u * 2.2); g.fillStyle = '#ffffff'; g.fill(); }
  if (frame === 'pixel') {
    const s = Math.max(4, Math.round(u / 3));
    for (let y = 0; y < cv.height; y += s) for (let x = 0; x < cv.width; x += s)
      if (x < pl || y < pt || x >= cv.width - pr || y >= cv.height - pb) { g.fillStyle = ((x + y) / s) % 2 ? '#ffd23f' : '#0c605c'; g.fillRect(x, y, s, s); }
  }
  g.save();
  if (frame === 'rounded') { cardRound(g, pl, pt, W, H, u * 1.6); g.clip(); }
  g.filter = PHOTO_FILTERS[filter]?.[1] ?? 'none';
  g.drawImage(src, pl, pt);
  g.restore();
  const cap = (caption || '').trim();
  const fs = Math.round(u * 1.15);
  if (cap && frame === 'polaroid') cardText(g, cap, cv.width / 2, cv.height - pb / 2 + fs * 0.35, { size: fs, weight: 700, color: '#2b2f33', align: 'center', max: cv.width - u * 2 });
  else if (cap) {
    g.font = `800 ${fs}px ${CARD_FONT}`;
    const tw = Math.min(g.measureText(cap).width, W - u * 4) + u * 1.4;
    cardRound(g, pl + u, pt + H - fs * 2.2 - u * 0.6, tw, fs * 2, fs * 0.5); g.fillStyle = 'rgba(0,0,0,.45)'; g.fill();
    cardText(g, cap, pl + u + u * 0.7, pt + H - u * 0.6 - fs * 0.62, { size: fs, weight: 800, max: W - u * 4 });
  }
  cardText(g, 'PokeVault Meadow', cv.width - pr - u * 0.6, cv.height - pb - u * 0.5, { size: Math.round(u * 0.6), weight: 700, align: 'right', alpha: .75 });
  return cv;
}

window.meadowPhoto = () => {
  const box = $('#meadow');
  const m = meadow;                                  // app.js's Meadow instance (null until the Meadow has opened)
  if (!m || box.classList.contains('photo')) return;
  m.freeze(true);
  box.classList.add('photo');
  window.sfx?.sheet?.();
  const st = { frame: 'polaroid', filter: 'none', caption: '' };
  const bar = document.createElement('div');
  bar.className = 'photo-bar card';
  const frameEl = document.createElement('div');
  frameEl.className = 'photo-frame';
  box.append(frameEl, bar);
  const canvas = $('canvas.meadow-canvas', box);
  const paint = () => {
    canvas.style.filter = PHOTO_FILTERS[st.filter][1];
    frameEl.dataset.frame = st.frame;
    bar.innerHTML = `<b>📷 Photo</b>
      <div class="pb-row"><span>Frame</span>${Object.entries(PHOTO_FRAMES).map(([k, n]) => `<button type="button" class="chip ${st.frame === k ? 'active' : ''}" data-frame="${k}">${n}</button>`).join('')}</div>
      <div class="pb-row"><span>Filter</span>${Object.entries(PHOTO_FILTERS).map(([k, [n]]) => `<button type="button" class="chip ${st.filter === k ? 'active' : ''}" data-filter="${k}">${n}</button>`).join('')}</div>
      <div class="pb-row"><input class="field" id="photoCaption" maxlength="60" placeholder="Add a caption (optional)" value="${esc(st.caption)}">
        <button type="button" class="btn small" data-a="save">Save PNG</button><button type="button" class="btn small ghost" data-a="copy">Copy</button>
        <button type="button" class="btn small ghost" data-a="done">Done</button></div>`;
    $('#photoCaption', bar).addEventListener('input', e => { st.caption = e.target.value; });
  };
  const close = () => {
    m.freeze(false);
    box.classList.remove('photo');
    canvas.style.filter = '';
    bar.remove(); frameEl.remove();
    removeEventListener('keydown', onKey, true);
    window.sfx?.back?.();
  };
  const shot = () => composePhoto(m.snapshot(), st.frame, st.filter, st.caption);
  bar.addEventListener('click', e => {
    const b = e.target.closest('button'); if (!b) return;
    if (b.dataset.frame) { st.frame = b.dataset.frame; paint(); }
    else if (b.dataset.filter) { st.filter = b.dataset.filter; paint(); }
    else if (b.dataset.a === 'save') saveCard(shot(), `PokeVault Meadow ${new Date().toISOString().slice(0, 16).replace(/[T:]/g, '-')}.png`);
    else if (b.dataset.a === 'copy') copyCard(shot());
    else if (b.dataset.a === 'done') close();
  });
  const onKey = e => { if (e.key === 'Escape' && !$('#dialog').open) { e.preventDefault(); e.stopPropagation(); close(); } };
  addEventListener('keydown', onKey, true);
  paint();
};

window.shareMonCard = m => cardDialog(`${m.isEgg ? 'Egg' : name(m)}'s card`, () => `PokeVault - ${m.isEgg ? 'Egg' : name(m)}.png`, () => drawMonCard(m))
  .catch(fail);

/* ---------- Trainer card, retro style ---------- */

// Colour sets for the retro card: [background, row panel, header band, text, text shadow, border, watermark].
const RETRO_PALETTES = {
  classic: { name: 'Classic', c: ['#4a4a4a', '#5e5e5e', '#6a6a6a', '#f2ea78', '#262626', '#e8df6c', '#ffffff'] },
  bronze: { name: 'Bronze', c: ['#6b4a2e', '#80593a', '#8d6442', '#ffe2a8', '#2e1d10', '#d9a066', '#ffe0b8'] },
  silver: { name: 'Silver', c: ['#8a96a3', '#9daab6', '#a9b5c0', '#ffffff', '#3a434c', '#e8eef3', '#ffffff'] },
  gold: { name: 'Gold', c: ['#a8811c', '#bd9428', '#c9a032', '#fff6c8', '#4a3608', '#ffe066', '#fff3c0'] },
  emerald: { name: 'Emerald', c: ['#2f7a4f', '#3a8f5e', '#45996a', '#e6ffb8', '#123522', '#9be07a', '#d9ffd8'] },
  sapphire: { name: 'Sapphire', c: ['#2c4f8f', '#3a62a6', '#4670b4', '#d6ecff', '#0f2245', '#8fc2ff', '#d6e6ff'] },
  ruby: { name: 'Ruby', c: ['#8f2c3a', '#a63a4a', '#b44656', '#ffe0d6', '#3d0f17', '#ff9a8f', '#ffd6d6'] },
  night: { name: 'Night', c: ['#2b2550', '#3a3366', '#463f75', '#f3e98a', '#100c26', '#b8a8ff', '#d9d0ff'] },
  vault: { name: 'Vault teal', c: ['#0c605c', '#117b75', '#1a8c84', '#ffd23f', '#032a27', '#7ee0d4', '#c9f1ea'] },
};
// A custom colour: the whole set worked out from one colour you pick.
function retroFromColour(hex) {
  const n = parseInt(hex.slice(1), 16), r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
  const mix = (t, k) => `rgb(${Math.round(r + (t - r) * k)},${Math.round(g + (t - g) * k)},${Math.round(b + (t - b) * k)})`;
  const light = (r * 299 + g * 587 + b * 114) / 1000 > 150;
  return [mix(0, 0.25), mix(255, 0.08), mix(255, 0.14), light ? '#1b1b1b' : '#fff6c8', light ? 'rgba(255,255,255,.55)' : 'rgba(0,0,0,.6)', mix(255, 0.5), '#ffffff'];
}

// Text drawn small and then made crisp (every pixel fully on or off), so it looks like a handheld screen once enlarged.
function pixelText(g, text, x, y, { size = 11, color = '#fff', shadow = null, align = 'left', max = 0 } = {}) {
  const font = `bold ${size}px "Lucida Console", Consolas, "Courier New", monospace`;
  const m = document.createElement('canvas').getContext('2d');
  m.font = font;
  let t = String(text ?? '');
  while (max && t.length > 1 && m.measureText(t).width > max) t = t.slice(0, -2) + '…';
  const w = Math.ceil(m.measureText(t).width) + 2, h = size + 6;
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  const cg = c.getContext('2d', { willReadFrequently: true });
  cg.font = font; cg.textBaseline = 'alphabetic'; cg.fillStyle = '#000'; cg.fillText(t, 1, size);
  const id = cg.getImageData(0, 0, w, h), d = id.data;
  for (let i = 3; i < d.length; i += 4) d[i] = d[i] > 100 ? 255 : 0;
  cg.putImageData(id, 0, 0);
  cg.globalCompositeOperation = 'source-in';
  const draw = col => { const k = document.createElement('canvas'); k.width = w; k.height = h; const kg = k.getContext('2d'); kg.drawImage(c, 0, 0); kg.globalCompositeOperation = 'source-in'; kg.fillStyle = col; kg.fillRect(0, 0, w, h); return k; };
  const x0 = Math.round(align === 'right' ? x - w : align === 'center' ? x - w / 2 : x), y0 = Math.round(y - size);
  if (shadow) g.drawImage(draw(shadow), x0 + 1, y0 + 1);
  g.drawImage(draw(color), x0, y0);
}
function retroStar(g, cx, cy, r, fill) {
  g.beginPath();
  for (let i = 0; i < 10; i++) { const a = -Math.PI / 2 + i * Math.PI / 5, rr = i % 2 ? r * 0.45 : r; g.lineTo(Math.round(cx + Math.cos(a) * rr), Math.round(cy + Math.sin(a) * rr)); }
  g.closePath(); g.fillStyle = fill; g.fill();
}

// The five stars: milestones of your collection.
function trainerStars(t) {
  return [
    ['Registered 151 Pokémon in the Pokédex', t.dexRegistered >= 151],
    ['100 Pokémon in the Vault', t.total >= 100],
    ['10 shiny Pokémon', t.shinies >= 10],
    ['Pokémon from 5 generations', t.generations >= 5],
    ['Half the National Pokédex registered', t.dexRegistered >= Math.ceil(t.dexTotal / 2)],
  ];
}
const RANKS = ['Rookie', 'Collector', 'Ace Collector', 'Veteran', 'Elite Keeper', 'Vault Master'];

async function drawRetroTrainerCard(t, o) {
  const W = 300, H = 200, S = 4;                      // drawn small, enlarged 4× with hard pixel edges
  const [bg, panel, band, ink, shade, border, mark] = o.palette;
  const base = document.createElement('canvas'); base.width = W; base.height = H;
  const g = base.getContext('2d');
  g.imageSmoothingEnabled = false;
  const box = (x, y, w, h, r, col) => { cardRound(g, x, y, w, h, r); g.fillStyle = col; g.fill(); };
  // the card
  box(0, 0, W, H, 12, border); box(3, 3, W - 6, H - 6, 10, bg);
  // faint rings behind everything
  g.save(); cardRound(g, 3, 3, W - 6, H - 6, 10); g.clip();
  g.globalAlpha = 0.07; g.strokeStyle = mark; g.lineWidth = 14;
  g.beginPath(); g.arc(70, 92, 62, 0, Math.PI * 2); g.stroke();
  g.lineWidth = 9; g.beginPath(); g.arc(150, 70, 36, 0, Math.PI * 2); g.stroke();
  g.globalAlpha = 0.05; g.fillStyle = mark; g.beginPath(); g.arc(250, 180, 70, 0, Math.PI * 2); g.fill();
  g.restore();
  // header and stars
  pixelText(g, 'TRAINER CARD', 12, 21, { size: 14, color: ink, shadow: shade });
  const stars = trainerStars(t), earned = stars.filter(x => x[1]).length;
  stars.forEach(([, on], i) => retroStar(g, 205 + i * 19, 14, 8, on ? ink : 'rgba(255,255,255,.14)'));
  // rows on the left
  const row = (y, h, label, value) => {
    box(10, y, 180, h, 6, panel);
    pixelText(g, label, 16, y + h / 2 + 4, { size: 11, color: ink, shadow: shade });
    if (value != null) pixelText(g, value, 184, y + h / 2 + 4, { size: 11, color: ink, shadow: shade, align: 'right', max: 100 });
  };
  row(32, 18, 'Name', o.name || 'Trainer');
  box(10, 53, 180, 14, 5, band);
  pixelText(g, RANKS[earned], 100, 64, { size: 10, color: ink, shadow: shade, align: 'center' });
  row(70, 18, 'Pokémon', String(t.total));
  row(93, 18, 'Pokédex', `${t.dexRegistered}`);
  row(116, 18, 'Shiny', `★ ${t.shinies}`);
  row(139, 18, 'Living Dex', `${t.living}`);
  // ID No. and the partner on the right
  box(198, 32, 92, 18, 6, panel);
  pixelText(g, `IDNo.${o.tid || '-----'}`, 244, 45, { size: 10, color: ink, shadow: shade, align: 'center' });
  box(198, 56, 92, 101, 8, band);
  if (o.partner) {
    const im = await cardImage(o.partner.urls);
    if (im) {
      const [sx, sy, sw, sh] = cardTrim(im);
      const k = Math.min(84 / sw, 92 / sh), dw = Math.round(sw * k), dh = Math.round(sh * k);
      g.drawImage(im, sx, sy, sw, sh, 244 - dw / 2, 152 - dh, dw, dh);
    }
  }
  // bottom row: since when
  const since = t.started && !t.started.startsWith('0001') ? new Date(t.started).toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' }) : '—';
  box(10, 163, 280, 26, 7, panel);
  pixelText(g, 'Vault Started', 16, 180, { size: 11, color: ink, shadow: shade });
  pixelText(g, since, 284, 180, { size: 11, color: ink, shadow: shade, align: 'right', max: 150 });
  // enlarge with crisp pixels
  const out = document.createElement('canvas'); out.width = W * S; out.height = H * S;
  const og = out.getContext('2d'); og.imageSmoothingEnabled = false;
  og.drawImage(base, 0, 0, W * S, H * S);
  return out;
}

window.shareTrainerCard = async () => {
  try {
    const t = await api('/api/trainer');
    const pref = (() => { try { return JSON.parse(localStorage.getItem('pv.trainerCard') || '{}'); } catch { return {}; } })();
    let trainer = t.trainer;
    try { trainer = localStorage.getItem('pv.trainerName') || trainer; } catch { /* ignore */ }
    const st = { style: pref.style ?? 'retro', palette: pref.palette ?? 'classic', custom: pref.custom ?? '#3a7bd5', partner: pref.partner ?? 0 };
    const partners = [...(t.showcase ?? []).map(p => ({ label: `${p.name}${p.shiny ? ' ★' : ''}`, urls: monIconUrls(p) })),
      { label: 'Meadow walker', urls: ['/assets/meadow/player.png'], walker: true }];
    const keep = () => { try { localStorage.setItem('pv.trainerCard', JSON.stringify(st)); } catch { /* ignore */ } };
    const palette = () => st.palette === 'custom' ? retroFromColour(st.custom) : RETRO_PALETTES[st.palette]?.c ?? RETRO_PALETTES.classic.c;
    const partner = async () => {
      const p = partners[st.partner] ?? partners[0];
      if (!p?.walker) return p;
      // the Meadow walker's sheet: its first (front-facing) frame
      const sheet = await cardImage(p.urls);
      if (!sheet) return null;
      const c = document.createElement('canvas'); c.width = Math.round(sheet.width / 4); c.height = Math.round(sheet.height / 4);
      c.getContext('2d').drawImage(sheet, 0, 0);
      return { urls: [c.toDataURL()] };
    };
    const draw = async () => st.style === 'modern' ? drawTrainerCard(t, trainer)
      : drawRetroTrainerCard(t, { name: trainer, tid: t.tid, palette: palette(), partner: await partner() });
    const stars = trainerStars(t);
    const { d, redraw } = await cardDialog('Trainer card', () => `PokeVault - ${trainer || 'Trainer'} card.png`, draw, `
      <div class="tc-opts">
        <label class="muted card-name">Trainer name <input class="field" id="cardTrainer" maxlength="16" value="${esc(trainer)}"></label>
        <label class="muted card-name">Partner <select class="field" id="cardPartner">${partners.map((p, i) => `<option value="${i}" ${i === st.partner ? 'selected' : ''}>${esc(p.label)}</option>`).join('')}</select></label>
        <div class="chips tc-style"><button type="button" class="chip ${st.style === 'retro' ? 'active' : ''}" data-style="retro">Retro</button><button type="button" class="chip ${st.style === 'modern' ? 'active' : ''}" data-style="modern">Modern</button></div>
        <div class="tc-colours">${Object.entries(RETRO_PALETTES).map(([k, v]) => `<button type="button" class="tc-sw ${st.palette === k ? 'on' : ''}" data-pal="${k}" title="${v.name}" style="--a:${v.c[0]};--b:${v.c[3]};--c:${v.c[5]}"></button>`).join('')}
          <label class="tc-sw tc-custom ${st.palette === 'custom' ? 'on' : ''}" title="Your own colour"><input type="color" id="cardColour" value="${st.custom}"></label></div>
        <p class="muted tc-stars">${stars.map(([n, on]) => `<span class="${on ? 'on' : ''}">★ ${esc(n)}</span>`).join('')}</p>
      </div>`);
    let timer;
    const later = () => { keep(); clearTimeout(timer); timer = setTimeout(redraw, 200); };
    $('#cardTrainer', d).addEventListener('input', e => { trainer = e.target.value.trim(); try { localStorage.setItem('pv.trainerName', trainer); } catch { /* ignore */ } later(); });
    $('#cardPartner', d).addEventListener('change', e => { st.partner = +e.target.value; later(); });
    $('#cardColour', d).addEventListener('input', e => { st.custom = e.target.value; st.palette = 'custom'; $$('.tc-sw', d).forEach(x => x.classList.toggle('on', x.classList.contains('tc-custom'))); later(); });
    d.addEventListener('click', e => {
      const b = e.target.closest('[data-pal], [data-style]'); if (!b) return;
      if (b.dataset.pal) { st.palette = b.dataset.pal; $$('.tc-sw', d).forEach(x => x.classList.toggle('on', x === b)); }
      if (b.dataset.style) { st.style = b.dataset.style; $$('[data-style]', d).forEach(x => x.classList.toggle('active', x === b)); }
      later();
    });
  } catch (e) { fail(e); }
};
