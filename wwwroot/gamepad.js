'use strict';
// Xbox controller support (any controller with the standard layout works).
//
// Two ways of moving:
//  • Game controls (default): the D-pad moves the box cursor, walks in the Meadow, picks moves on the summary…
//    Buttons become the keys the app already understands, so each screen behaves like it does on a keyboard.
//  • Menu navigation (View ⧉ to switch on/off, always on in the Pokédex and in pop-up windows): a yellow
//    highlight jumps between every button, pill, filter, drop-down and navbar item; A presses it, B leaves.
//
//   D-pad / left stick  move            A  confirm          B  back (hold in the Meadow to run)
//   X  Check Summary (summary: ribbons · Meadow: summary of the Pokémon you're talking to)
//   Y  Game box ↔ Vault (summary: stats view · Meadow: pet)
//   LB / RB  previous / next box (summary: Pokémon · Meadow: "Who's out")
//   LT / RT  previous / next screen      Menu ☰  next game (Boxes)
//   View ⧉  menu navigation on / off     Right stick  scroll (Meadow: zoom)
(() => {
  const BTN = { A: 0, B: 1, X: 2, Y: 3, LB: 4, RB: 5, LT: 6, RT: 7, VIEW: 8, MENU: 9, L3: 10, R3: 11, UP: 12, DOWN: 13, LEFT: 14, RIGHT: 15 };
  const VIEWS = ['boxes', 'dex', 'meadow', 'games'];
  const DIRS = { up: 'ArrowUp', down: 'ArrowDown', left: 'ArrowLeft', right: 'ArrowRight' };
  const FIRST_REPEAT = 320, REPEAT = 105, STICK = 0.55;

  let timer = 0, was = [], heldDir = null, nextRepeat = 0, running = false, announced = new Set();

  const $ = (s, r = document) => r.querySelector(s);
  const send = (key, type = 'keydown', repeat = false) =>
    document.body.dispatchEvent(new KeyboardEvent(type, { key, bubbles: true, cancelable: true, repeat }));
  const press = key => { send(key); send(key, 'keyup'); };
  const visible = el => !!el && el.getClientRects().length > 0 && getComputedStyle(el).visibility !== 'hidden';

  const summaryOpen = () => visible($('#summary')) && !$('#summary').hidden;
  const dialogOpen = () => !!$('#dialog')?.open;
  const monMenuOpen = () => typeof menu !== 'undefined' && !!menu;
  const pathPopOpen = () => { const p = $('#pathPop'); return !!p && !p.hidden; };
  const view = () => (typeof state !== 'undefined' ? state.view : 'boxes');
  const inMeadow = () => view() === 'meadow' && !summaryOpen() && !dialogOpen() && !uiOn;

  /* ================= menu navigation (spatial focus over every control) ================= */
  let uiOn = false, cur = null, badge = null;
  // Menu navigation is used: when switched on with View, in pop-up windows, and on screens with no game controls.
  const uiActive = () => uiOn || dialogOpen() || pathPopOpen() || (view() === 'dex' && !summaryOpen());

  // Where the highlight may go: the top-most open window, else the whole page.
  function scope() {
    if (dialogOpen()) return $('#dialog');
    if (pathPopOpen()) return $('#pathPop');
    if (monMenuOpen()) return $('.mon-menu');
    if (summaryOpen()) return $('#summary');
    return document.body;
  }
  const SKIP = '.slot, .sm-moves li, #summary[hidden] *, .pad-pick *, [tabindex="-1"], input[type="file"], option, .mc-credit a';
  function focusables(root = scope()) {
    const els = [...root.querySelectorAll('button, a[href], select, input, textarea, summary, label.topbtn, [tabindex]:not([tabindex="-1"])')];
    return els.filter(el => !el.disabled && !el.closest(SKIP) && visible(el) && !el.closest('[hidden]')
      && (root !== document.body || (!el.closest('#summary') && !el.closest('dialog') && !el.closest('.view[hidden]'))));
  }
  function setCur(el) {
    if (cur) cur.classList.remove('pad-focus');
    cur = el;
    if (!el) return;
    el.classList.add('pad-focus');
    el.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    window.sfx?.tick?.();
  }
  function firstIn(list) {
    // start from the active/selected control if there is one, else the top-left one on screen
    return list.find(el => el.matches('.active, .on, .sel, [aria-selected="true"]'))
      ?? [...list].sort((a, b) => { const ra = a.getBoundingClientRect(), rb = b.getBoundingClientRect(); return (ra.top - rb.top) || (ra.left - rb.left); })[0];
  }
  function ensureCur() {
    const list = focusables();
    if (!list.length) { setCur(null); return null; }
    if (!cur || !list.includes(cur)) setCur(firstIn(list));
    return cur;
  }
  function moveFocus(dir) {
    const list = focusables();
    if (!list.length) return;
    if (!cur || !list.includes(cur)) { setCur(firstIn(list)); return; }
    const a = cur.getBoundingClientRect(), ax = a.left + a.width / 2, ay = a.top + a.height / 2;
    let best = null, bestScore = Infinity;
    for (const el of list) {
      if (el === cur) continue;
      const b = el.getBoundingClientRect(), bx = b.left + b.width / 2, by = b.top + b.height / 2;
      const dx = bx - ax, dy = by - ay;
      const horiz = dir === 'left' || dir === 'right';
      const main = horiz ? (dir === 'right' ? dx : -dx) : (dir === 'down' ? dy : -dy);
      if (main <= 6) continue;
      // controls in the same row (or column) win over ones that are only diagonally in that direction
      const overlap = horiz ? Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top) : Math.min(a.right, b.right) - Math.max(a.left, b.left);
      const cross = overlap > 0 ? 0 : Math.abs(horiz ? dy : dx);
      const score = main + cross * 3;
      if (score < bestScore) { bestScore = score; best = el; }
    }
    if (best) setCur(best);
  }
  function activate(el) {
    if (!el) return;
    if (el.tagName === 'SELECT') return openPicker(el);
    if (el.tagName === 'INPUT' && !['checkbox', 'radio', 'button', 'submit'].includes(el.type)) {
      el.focus();
      if (typeof toast === 'function') toast('Type with the keyboard, then press B to go back.');
      return;
    }
    el.click();
    window.sfx?.select?.();
    // whatever opened (a window, a menu) gets the highlight next
    setTimeout(() => { if (uiActive()) ensureCur(); }, 60);
  }
  function setUi(on) {
    uiOn = on;
    if (!on) { setCur(null); document.activeElement?.blur?.(); }
    else ensureCur();
    if (!badge) {
      badge = document.createElement('div');
      badge.className = 'pad-badge';
      document.body.append(badge);
    }
    badge.innerHTML = `<span class="pg pg-pill">⧉</span> Menu navigation · <span class="pg pg-face" style="--pb:#e0453a">B</span> back to game controls`;
    badge.hidden = !on;
    window.sfx?.[on ? 'menu' : 'back']?.();
  }
  function uiButton(b) {
    if (picker) return pickerButton(b);
    if (b === BTN.A) return activate(ensureCur());
    if (b === BTN.B) {
      if (document.activeElement?.matches?.('input, textarea')) { document.activeElement.blur(); return; }
      if (dialogOpen()) { closeDialog(); setTimeout(ensureCurIfUi, 60); return; }
      if (pathPopOpen()) { $('#pathPop').hidden = true; setTimeout(ensureCurIfUi, 60); return; }
      if (monMenuOpen()) { press('Escape'); return; }
      if ([...document.querySelectorAll('details[open]')].some(d => { d.open = false; return true; })) return;
      if (uiOn) setUi(false);
      return;
    }
  }
  const ensureCurIfUi = () => { if (uiActive()) ensureCur(); else setCur(null); };

  /* ---------- drop-down picker (native drop-downs can't be opened by a controller) ---------- */
  let picker = null;
  function openPicker(sel) {
    const opts = [...sel.options].filter(o => !o.disabled);
    if (!opts.length) return;
    const el = document.createElement('div');
    el.className = 'pad-pick';
    const items = [];
    let html = '', lastGroup = null;
    for (const o of opts) {
      const g = o.parentElement.tagName === 'OPTGROUP' ? o.parentElement.label : null;
      if (g !== lastGroup) { if (g) html += `<h4>${escHtml(g)}</h4>`; lastGroup = g; }
      html += `<button type="button" data-i="${items.length}">${escHtml(o.textContent)}</button>`;
      items.push(o);
    }
    el.innerHTML = `<div class="pad-pick-card"><b>${escHtml(sel.closest('label')?.textContent.replace(sel.textContent, '').trim() || sel.getAttribute('aria-label') || 'Choose')}</b><div class="pad-pick-list">${html}</div></div>`;
    el.addEventListener('click', e => {
      const b = e.target.closest('[data-i]');
      if (b) choose(+b.dataset.i); else if (e.target === el) closePicker();
    });
    document.body.append(el);
    picker = { el, sel, items, i: Math.max(0, items.indexOf(sel.selectedOptions[0])) };
    markPicker();
    window.sfx?.menu?.();
  }
  function markPicker() {
    const bs = picker.el.querySelectorAll('[data-i]');
    bs.forEach((b, k) => b.classList.toggle('on', k === picker.i));
    bs[picker.i]?.scrollIntoView({ block: 'nearest' });
  }
  function choose(i) {
    const { sel, items } = picker;
    sel.value = items[i].value;
    sel.dispatchEvent(new Event('input', { bubbles: true }));
    sel.dispatchEvent(new Event('change', { bubbles: true }));
    window.sfx?.select?.();
    closePicker(true);
  }
  function closePicker(silent) {
    picker?.el.remove();
    picker = null;
    if (!silent) window.sfx?.back?.();
  }
  function pickerButton(b) {
    if (b === BTN.A) choose(picker.i);
    else if (b === BTN.B) closePicker();
  }
  function pickerDir(d) {
    if (d !== 'up' && d !== 'down') return;
    picker.i = (picker.i + (d === 'down' ? 1 : -1) + picker.items.length) % picker.items.length;
    markPicker();
    window.sfx?.tick?.();
  }
  const escHtml = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

  /* ================= game controls ================= */
  function switchScreen(d) {
    const i = Math.max(0, VIEWS.indexOf(view()));
    const v = VIEWS[(i + d + VIEWS.length) % VIEWS.length];
    document.querySelector(`.mainnav button[data-view="${v}"]`)?.click();
    setTimeout(ensureCurIfUi, 80);
  }
  // The game pills above the boxes (each game, then the Vault), in order.
  function nextPill(d) {
    const pills = [...document.querySelectorAll('.bx-sources button')].filter(visible);
    if (!pills.length) return;
    const i = pills.findIndex(p => p.classList.contains('active'));
    pills[(i + d + pills.length) % pills.length].click();
  }
  // "Who's out" in the Meadow: previous / next group of Pokémon.
  function cycleSelect(sel, d) {
    if (!sel || sel.options.length < 2) return;
    sel.selectedIndex = (sel.selectedIndex + d + sel.options.length) % sel.options.length;
    sel.dispatchEvent(new Event('change', { bubbles: true }));
    window.sfx?.flip?.();
  }

  function onButton(b) {
    if (picker) return pickerButton(b);
    if (b === BTN.VIEW) { if (!dialogOpen()) setUi(!uiOn); return; }
    if (b === BTN.LT || b === BTN.RT) {
      if (summaryOpen() && !dialogOpen()) { if (b === BTN.RT) press('j'); }   // the summary's Journey
      else if (!dialogOpen()) switchScreen(b === BTN.RT ? 1 : -1);
      return;
    }
    if (uiActive()) return uiButton(b);
    if (b === BTN.MENU) {
      if (summaryOpen()) press('c');                         // the summary's "Share card"
      else if (view() === 'boxes') nextPill(1);
      return;
    }
    if (inMeadow()) {
      const card = $('#meadowCard');
      const cardOpen = card && !card.hidden;
      if (b === BTN.A) press('Enter');
      else if (b === BTN.B) { if (cardOpen) press('Escape'); running = true; send('Shift'); }
      else if (b === BTN.X && cardOpen) card.querySelector('[data-a="summary"]')?.click();
      else if (b === BTN.Y && cardOpen) card.querySelector('[data-a="pet"]')?.click();
      else if (b === BTN.LB || b === BTN.RB) cycleSelect($('#meadowSource'), b === BTN.RB ? 1 : -1);
      return;
    }
    if (summaryOpen()) {
      const k = { [BTN.A]: 'Enter', [BTN.B]: 'Escape', [BTN.X]: 't', [BTN.Y]: 'y', [BTN.LB]: 'q', [BTN.RB]: 'e' }[b];
      if (k) press(k);
      return;
    }
    if (monMenuOpen()) {
      if (b === BTN.A) press('Enter'); else if (b === BTN.B) press('Escape');
      return;
    }
    if (b === BTN.A) press('Enter');
    else if (b === BTN.B) press('Escape');
    else if (b === BTN.X) press(' ');
    else if (b === BTN.LB) press('q');
    else if (b === BTN.RB) press('e');
    else if (b === BTN.Y && view() === 'boxes' && typeof dual === 'function' && dual()) {
      focusPane(state.pane === 'game' ? 'vault' : 'game');
      window.sfx?.tick?.();
    }
  }
  function onRelease(b) {
    if (b === BTN.B && running) { running = false; send('Shift', 'keyup'); }
  }

  // One direction at a time; the D-pad wins over the stick.
  function direction(p) {
    const btn = i => p.buttons[i]?.pressed;
    if (btn(BTN.UP)) return 'up';
    if (btn(BTN.DOWN)) return 'down';
    if (btn(BTN.LEFT)) return 'left';
    if (btn(BTN.RIGHT)) return 'right';
    const x = p.axes[0] ?? 0, y = p.axes[1] ?? 0;
    if (Math.max(Math.abs(x), Math.abs(y)) < STICK) return null;
    return Math.abs(x) > Math.abs(y) ? (x > 0 ? 'right' : 'left') : (y > 0 ? 'down' : 'up');
  }
  function dirPress(d, repeat) {
    if (picker) return pickerDir(d);
    if (uiActive()) return moveFocus(d);
    send(DIRS[d], 'keydown', repeat);
  }

  // Which hints to show: controller buttons after controller input, keys after keyboard or mouse use.
  let padMode = false;
  function setPadMode(on) {
    if (on === padMode) return;
    padMode = on;
    document.body.classList.toggle('pad', on);
    if (!on) { if (uiOn) setUi(false); setCur(null); if (picker) closePicker(true); }
  }
  addEventListener('keydown', e => { if (e.isTrusted) setPadMode(false); }, true);
  addEventListener('pointerdown', e => { if (e.isTrusted) setPadMode(false); }, true);
  let moved = 0;
  addEventListener('mousemove', e => {
    if (!padMode || !e.isTrusted) return;
    moved += Math.abs(e.movementX) + Math.abs(e.movementY);
    if (moved > 40) { moved = 0; setPadMode(false); }
  }, true);

  function poll() {
    const now = performance.now();
    const pads = [...(navigator.getGamepads?.() ?? [])].filter(Boolean);
    if (!pads.length) { releaseDir(); clearInterval(timer); timer = 0; return; }
    const p = pads.find(x => x.buttons.some(b => b.pressed) || x.axes.some(a => Math.abs(a) > STICK)) ?? pads[0];

    // any controller input switches the on-screen hints to controller buttons
    if (p.buttons.some(b => b.pressed) || p.axes.some(v => Math.abs(v) > STICK)) { moved = 0; setPadMode(true); }

    // keep the highlight on something real while menu navigation is in use (windows open and close)
    if (padMode && !picker) { if (uiActive()) { if (cur && !focusables().includes(cur)) ensureCur(); } else if (cur) setCur(null); }

    // buttons (edges only)
    p.buttons.forEach((b, i) => {
      const down = b.pressed || b.value > 0.5;
      if (down && !was[i]) onButton(i);
      else if (!down && was[i]) onRelease(i);
      was[i] = down;
    });

    // directions: held while walking in the Meadow, repeating everywhere else
    const d = direction(p);
    if (d !== heldDir) {
      releaseDir();
      if (d) { heldDir = d; dirPress(d, false); nextRepeat = now + FIRST_REPEAT; }
    } else if (d && !inMeadow() && now >= nextRepeat) {
      dirPress(d, true);
      nextRepeat = now + REPEAT;
    }

    // right stick: zoom in the Meadow, scroll everywhere else
    const ry = p.axes[3] ?? 0;
    if (Math.abs(ry) > 0.3) {
      if (inMeadow() && typeof meadow !== 'undefined' && meadow?.zoomBy) meadow.zoomBy(1 - ry * 0.025);
      else {
        const el = picker ? picker.el.querySelector('.pad-pick-list')
          : summaryOpen() && $('.sm-rbbody') ? $('.sm-rbbody')
          : dialogOpen() ? $('#dialog .dlg-body') ?? $('#dialog') : document.scrollingElement;
        el?.scrollBy(0, ry * 22);
      }
    }
  }
  function releaseDir() {
    if (heldDir) send(DIRS[heldDir], 'keyup');
    heldDir = null;
  }
  // A steady 60-per-second check (not tied to screen frames, so no press is ever missed).
  const start = () => { if (!timer) timer = setInterval(poll, 16); };

  addEventListener('gamepadconnected', e => {
    start();
    if (!announced.has(e.gamepad.index)) {
      announced.add(e.gamepad.index);
      if (typeof toast === 'function') toast('Controller connected. Press View ⧉ to move around the buttons and menus.');
    }
  });
  addEventListener('gamepaddisconnected', () => { releaseDir(); if (running) { running = false; send('Shift', 'keyup'); } });
  // Some systems only report a controller after its first button press.
  addEventListener('focus', start);
  start();
  // for testing: run one check by hand (and stop the timer)
  window.padDebug = { step: () => poll(), stop: () => { clearInterval(timer); timer = -1; }, cur: () => cur };
})();
