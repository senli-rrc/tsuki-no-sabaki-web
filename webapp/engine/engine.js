'use strict';

const VN = (() => {
  // ── DOM refs ──────────────────────────────────────
  const container   = document.getElementById('game-container');
  const bgCanvas    = document.getElementById('bg-canvas');
  const sprCanvas   = document.getElementById('sprite-canvas');
  const portCanvas  = document.getElementById('portrait-canvas');
  const tbCanvas    = document.getElementById('textbox-canvas');
  const bgCtx       = bgCanvas.getContext('2d');
  const sprCtx      = sprCanvas.getContext('2d');
  const portCtx     = portCanvas.getContext('2d');
  const tbCtx       = tbCanvas.getContext('2d');
  const textbox     = document.getElementById('textbox');
  const dialogueEl  = document.getElementById('dialogue-text');
  const dialogueArea= document.getElementById('dialogue-area');
  const clickInd    = document.getElementById('click-indicator');
  const fadeOverlay = document.getElementById('fade-overlay');
  const choiceMenu  = document.getElementById('choice-menu');
  const uiOverlay   = document.getElementById('ui-overlay');
  const uiImg       = document.getElementById('ui-img');
  const statusEl    = document.getElementById('status');
  const scriptSel   = document.getElementById('script-select');
  const langSel     = document.getElementById('lang-select');

  const W  = 640, H = 480;
  const TB_H = 150;
  const PORT_W = 165, PORT_H = 200;
  const FRAME_X = 170, FRAME_W = 470, FRAME_H = 150;

  // ── State ─────────────────────────────────────────
  let events        = [];
  let cursor        = 0;
  let waitingClick  = false;
  let waitSource    = null;   // 'text' | 'wait_click'
  let skipping      = false;
  let currentLang   = 'jp';
  let bgmEl         = null;
  let currentBgmFile= null;   // track which file is playing to avoid restarts
  let currentLayer  = 0;
  let hasPortrait   = false;
  let currentPortrait = null;
  let portraitSide  = 'left';  // 'left' (textwins) | 'right' (l_wins)
  let nextTextColor = '#e8eeff';
  let pendingLoads  = [];
  let uiTimer       = null;

  // ── Asset paths ───────────────────────────────────
  const ASSET = {
    bg:            name => `assets/bg/${name}.jpg`,
    sprite:        name => `assets/sprites/${name}.jpg`,
    mask:          name => `assets/sprites/${name}_.jpg`,
    bgm:           name => `assets/bgm/${name}.mp3`,
    se:            name => `assets/se/${name}.wav`,
    frameWith:     'assets/ui/textwins.jpg',
    frameWithMask: 'assets/sprites/textwins_.jpg',
    frameLeft:     'assets/sprites/l_wins.jpg',      // right-side portrait frame
    frameLeftMask: 'assets/sprites/l_wins_.jpg',
    frameNo:       'assets/sprites/textwinc.jpg',
    frameNoMask:   'assets/sprites/textwinc_.jpg',
  };

  // ── BGM auto-map: background name → BGM track ────
  // These are approximate assignments based on scene grouping.
  // Courtroom/office scenes (main story) use tracks han_04–han_13.
  // Character route / personal scenes use han_01–han_03.
  // Adjust once you identify tracks by ear.
  const BG_BGM_MAP = {
    // Character route outdoor/personal locations
    han_bg01: 'han_01', han_bg02: 'han_01', han_bg03: 'han_01',
    han_bg04: 'han_01', han_bg05: 'han_02',
    han_bg06: 'han_03',  // law firm (shared lobby)
    // Courtroom complex (main story s02 / s03)
    han_bg07: 'han_04', han_bg08: 'han_05', han_bg09: 'han_06',
    han_bg10: 'han_07', han_bg10_02: 'han_07',
    han_bg11: 'han_08', han_bg12: 'han_09', han_bg13: 'han_10',
    han_bg14: 'han_11', han_bg14_02: 'han_11', han_bg14_03: 'han_11',
    han_bg15: 'han_12', han_bg15_02: 'han_12',
    han_bg17: 'han_13',
    han_bg28: 'han_14', han_bg29: 'han_15', han_bg30: 'han_15',
  };
  // Populate han_bg00a – han_bg00z (outdoor character route scenes)
  'abcdefghijklmnopqrstuvwxyz'.split('').forEach(c => {
    BG_BGM_MAP[`han_bg00${c}`] = 'han_01';
  });

  // ── Image loader (cached) ─────────────────────────
  const imgCache = {};
  function loadImg(src) {
    if (imgCache[src]) return imgCache[src];
    const p = new Promise(resolve => {
      const img = new Image();
      img.onload  = () => resolve(img);
      img.onerror = () => resolve(null);
      img.src = src;
    });
    imgCache[src] = p;
    return p;
  }

  loadImg(ASSET.frameWith);  loadImg(ASSET.frameWithMask);
  loadImg(ASSET.frameLeft);  loadImg(ASSET.frameLeftMask);
  loadImg(ASSET.frameNo);    loadImg(ASSET.frameNoMask);

  // ── Canvas compositing ────────────────────────────
  async function compositeToCanvas(srcUrl, maskUrl, dstW, dstH, srcCropW, srcCropH) {
    const [img, mask] = await Promise.all([loadImg(srcUrl), loadImg(maskUrl)]);
    if (!img) return null;
    const sw = srcCropW || img.naturalWidth;
    const sh = srcCropH || img.naturalHeight;
    const off = document.createElement('canvas');
    off.width = dstW; off.height = dstH;
    const ctx = off.getContext('2d');
    ctx.drawImage(img, 0, 0, sw, sh, 0, 0, dstW, dstH);
    const pixels = ctx.getImageData(0, 0, dstW, dstH);
    if (mask) {
      const mOff = document.createElement('canvas');
      mOff.width = dstW; mOff.height = dstH;
      const mCtx = mOff.getContext('2d');
      mCtx.drawImage(mask, 0, 0, sw, sh, 0, 0, dstW, dstH);
      const mPx = mCtx.getImageData(0, 0, dstW, dstH);
      for (let i = 0; i < pixels.data.length; i += 4)
        pixels.data[i + 3] = mPx.data[i];
    }
    ctx.putImageData(pixels, 0, 0);
    return off;
  }

  // ── Textbox renderer ──────────────────────────────
  async function renderTextbox() {
    tbCtx.clearRect(0, 0, W, TB_H);
    portCtx.clearRect(0, 0, PORT_W, PORT_H);

    if (hasPortrait && currentPortrait) {
      const isRight = portraitSide === 'right';
      // Right-side portrait uses l_wins (left-border only frame, portrait on right).
      // Left-side portrait uses textwins (right-border only frame, portrait on left).
      const frameSrc  = isRight ? ASSET.frameLeft     : ASSET.frameWith;
      const frameMask = isRight ? ASSET.frameLeftMask  : ASSET.frameWithMask;

      const [frameOff, faceOff] = await Promise.all([
        compositeToCanvas(frameSrc, frameMask, FRAME_W, FRAME_H),
        compositeToCanvas(ASSET.sprite(currentPortrait), ASSET.mask(currentPortrait),
                          PORT_W, PORT_H, 150, 200),
      ]);
      // l_wins: frame at x=0 (left edge); textwins: frame at x=170 (right of portrait slot)
      if (frameOff) tbCtx.drawImage(frameOff, isRight ? 0 : FRAME_X, 0);
      if (faceOff)  portCtx.drawImage(faceOff, 0, 0);

      // Move portrait canvas to the appropriate side
      if (isRight) {
        portCanvas.style.left  = 'auto';
        portCanvas.style.right = '0';
      } else {
        portCanvas.style.left  = '0';
        portCanvas.style.right = 'auto';
      }

      // Text area is on the opposite side from the portrait
      dialogueArea.style.left      = isRight ? '18px'  : '188px';
      dialogueArea.style.right     = isRight ? '188px' : '18px';
      dialogueArea.style.top       = '16px';
      dialogueArea.style.bottom    = '14px';
      dialogueArea.style.textAlign = 'left';
    } else {
      // No portrait: full-width textwinc frame (620px stretched to 640px)
      const frameOff = await compositeToCanvas(
        ASSET.frameNo, ASSET.frameNoMask, W, TB_H
      );
      if (frameOff) tbCtx.drawImage(frameOff, 0, 0);
      // Narrator text: centre-align to match original PSG engine appearance.
      // Leading ideographic spaces and !s tags are stripped in showText() so
      // CSS centering positions each line correctly.
      dialogueArea.style.left      = '30px';
      dialogueArea.style.right     = '30px';
      dialogueArea.style.top       = '16px';
      dialogueArea.style.bottom    = '14px';
      dialogueArea.style.textAlign = 'center';
    }
  }

  // ── Sprite compositor ─────────────────────────────
  async function drawSprite(name) {
    const [base, mask] = await Promise.all([
      loadImg(ASSET.sprite(name)), loadImg(ASSET.mask(name)),
    ]);
    sprCtx.clearRect(0, 0, W, H);
    if (!base) return;
    if (!mask) { sprCtx.drawImage(base, 0, 0, W, H); return; }

    const off = document.createElement('canvas');
    off.width = base.naturalWidth; off.height = base.naturalHeight;
    const offCtx = off.getContext('2d');
    offCtx.drawImage(base, 0, 0);
    const bd = offCtx.getImageData(0, 0, off.width, off.height);

    const mOff = document.createElement('canvas');
    mOff.width = off.width; mOff.height = off.height;
    const mCtx = mOff.getContext('2d');
    mCtx.drawImage(mask, 0, 0, off.width, off.height);
    const md = mCtx.getImageData(0, 0, off.width, off.height);

    for (let i = 0; i < bd.data.length; i += 4)
      bd.data[i + 3] = md.data[i];
    offCtx.putImageData(bd, 0, 0);

    const sw = base.naturalWidth, sh = base.naturalHeight;
    sprCtx.drawImage(off, Math.round((W - sw) / 2), H - sh);
  }

  // ── Background loader + auto-BGM ─────────────────
  async function drawBackground(name) {
    const img = await loadImg(ASSET.bg(name));
    if (!img) return;
    bgCtx.clearRect(0, 0, W, H);
    const scale = Math.max(W / img.naturalWidth, H / img.naturalHeight);
    const dw = img.naturalWidth * scale, dh = img.naturalHeight * scale;
    bgCtx.drawImage(img, (W - dw) / 2, (H - dh) / 2, dw, dh);

    // Auto-play BGM based on scene if nothing is currently playing
    if (!bgmEl || bgmEl.paused || bgmEl.ended) {
      const autoBgm = BG_BGM_MAP[name.toLowerCase()];
      if (autoBgm) playBGM(autoBgm);
    }
  }

  // ── Portrait state ────────────────────────────────
  function setPortrait(name) {
    currentPortrait = name;
    hasPortrait = true;
    return Promise.all([loadImg(ASSET.sprite(name)), loadImg(ASSET.mask(name))]);
  }

  function clearPortrait() {
    currentPortrait = null;
    hasPortrait = false;
    portraitSide = 'left';
    portCtx.clearRect(0, 0, PORT_W, PORT_H);
    portCanvas.style.left  = '0';
    portCanvas.style.right = 'auto';
  }

  // ── Testimony / action UI overlay ────────────────
  // duration=0  → persistent (shown until hideUIOverlay() or loadScript())
  // duration>0  → auto-hide after ms
  function showUIOverlay(name, duration) {
    clearTimeout(uiTimer);
    uiImg.src     = `assets/ui/${name}.jpg`;
    uiImg.onerror = () => {};           // silently ignore missing assets
    uiOverlay.style.display = 'block';
    if (duration > 0) {
      uiTimer = setTimeout(() => { uiOverlay.style.display = 'none'; },
                           skipping ? 0 : duration);
    }
  }

  function hideUIOverlay() {
    clearTimeout(uiTimer);
    uiTimer = null;
    uiOverlay.style.display = 'none';
  }

  // ── Image dispatch ────────────────────────────────
  function loadImage(name) {
    if (!name) return;
    const n = name.toLowerCase();
    let p;
    if (n.startsWith('han_bg') || n === 'blk' || n === 'blood' ||
        n.startsWith('adventure')) {
      p = drawBackground(name);
    } else if (n === 'textwins' || n === 'textwinc' || n === 'l_wins' || n === 'mind') {
      return;
    } else if (n.startsWith('han_') && n.endsWith('f')) {
      p = setPortrait(name);
    } else {
      p = drawSprite(name);
    }
    if (p) pendingLoads.push(p);
  }

  // ── Audio ─────────────────────────────────────────
  // One-shot sound effects (UI interactions)
  function playSE(name) {
    if (!name) return;
    try { new Audio(ASSET.se(name)).play().catch(() => {}); } catch(e) {}
  }

  // Game SFX from script events
  function playSound(file) {
    if (!file) return;
    try { new Audio(ASSET.se(file)).play().catch(() => {}); } catch(e) {}
  }

  function playBGM(file) {
    if (!file || file === currentBgmFile) return;  // avoid restarting same track
    if (bgmEl) { bgmEl.pause(); bgmEl = null; }
    currentBgmFile = file;
    bgmEl = new Audio(ASSET.bgm(file));
    bgmEl.loop = true;
    bgmEl.volume = 0.45;
    bgmEl.play().catch(() => {});
  }

  function stopBGM() {
    if (bgmEl) { bgmEl.pause(); bgmEl = null; }
    currentBgmFile = null;
  }

  // ── Fade ──────────────────────────────────────────
  // flag 1 = fade IN  (overlay opaque → transparent; reveal canvas)
  // flag 0 = fade OUT (overlay transparent → opaque; hide canvas)
  // other  = full scene-transition (out then in)
  function doFade(duration, flag, onDone) {
    const ms = skipping ? 0 : Math.min(duration, 1500);
    if (flag === 1) {
      // Reveal: overlay fades away
      fadeOverlay.style.transition = skipping ? 'none' : `opacity ${ms}ms ease`;
      fadeOverlay.style.opacity = '0';
      setTimeout(onDone, skipping ? 0 : ms);
    } else if (flag === 0) {
      // Hide: overlay fades in (covers canvas)
      fadeOverlay.style.transition = skipping ? 'none' : `opacity ${ms}ms ease`;
      fadeOverlay.style.opacity = '1';
      setTimeout(onDone, skipping ? 0 : ms);
    } else {
      // Full scene transition: hide then reveal
      fadeOverlay.style.transition = skipping ? 'none' : `opacity ${ms/2}ms ease`;
      fadeOverlay.style.opacity = '1';
      setTimeout(() => {
        fadeOverlay.style.transition = skipping ? 'none' : `opacity ${ms/2}ms ease`;
        fadeOverlay.style.opacity = '0';
        setTimeout(onDone, skipping ? 0 : ms / 2);
      }, skipping ? 0 : ms / 2);
    }
  }

  // ── Text rendering ────────────────────────────────
  let typeTimer  = null;
  let fullText   = '';
  let charIdx    = 0;
  const TYPE_SPEED = 25;

  function showText(text, jp) {
    const display = (currentLang !== 'jp' && text && text !== jp) ? text : jp;
    // Strip engine formatting codes (!s = PSG centre-line tag, \x07 = bell)
    // Strip leading ideographic spaces (U+3000) from every line — the original
    // text uses them as padding for centring, but we centre via CSS instead.
    const stripped = display.replace(/\x07/g, '').replace(/!s/g, '');
    fullText = stripped
      .split('\n')
      .map(line => line.replace(/^\u3000+/, ''))   // strip leading wide spaces
      .join('\n')
      .trim();
    charIdx = 0;
    textbox.style.display = 'block';
    dialogueEl.textContent = '';
    dialogueEl.style.color = nextTextColor;
    clickInd.style.display = 'none';
    clearTimeout(typeTimer);
    playSE('page');       // page-turn sound when text begins
    typeNextChar();
  }

  function typeNextChar() {
    if (charIdx >= fullText.length) {
      clickInd.style.display = 'block';
      playSE('read');     // soft chime when typing finishes
      return;
    }
    dialogueEl.textContent += fullText[charIdx++];
    typeTimer = setTimeout(typeNextChar, skipping ? 0 : TYPE_SPEED);
  }

  function finishTyping() {
    clearTimeout(typeTimer);
    if (charIdx < fullText.length) {
      dialogueEl.textContent = fullText;
      charIdx = fullText.length;
      clickInd.style.display = 'block';
      return false;
    }
    return true;
  }

  // ── Event execution ───────────────────────────────
  function execute() {
    while (cursor < events.length) {
      const ev = events[cursor];
      cursor++;

      switch (ev.op) {

        case 'text': {
          // Skip corrupted binary-extraction artifacts (choice data mis-read as text).
          // These events contain control characters (e.g. \x01, \x00) or replacement
          // chars (U+FFFD) that result from the extractor reading branch tables as UTF-16.
          const rawJp = ev.jp || '';
          const isGarbage = /[\x00-\x08\x0b\x0c\x0e-\x1f\x7f\ufffd]/.test(rawJp);
          if (isGarbage) break;   // skip silently, continue event loop

          const loads = pendingLoads.splice(0);
          const doShow = async () => {
            await renderTextbox();
            showText(ev.text, ev.jp);
            waitSource   = 'text';
            waitingClick = true;
            updateStatus();
          };
          Promise.all(loads).then(doShow);
          return;
        }

        case 'wait_click':
          waitSource   = 'wait_click';
          waitingClick = true;
          updateStatus();
          return;

        case 'load_image':
          loadImage(ev.name);
          break;

        case 'load_ui': {
          const uiName = (ev.name || '').toLowerCase();
          if (uiName === 'l_wins') {
            // Prosecutor / judge speaks — portrait moves to right side
            portraitSide = 'right';
          } else if (uiName === 'textwins') {
            // Defence / character speaks — portrait on left (default)
            portraitSide = 'left';
          } else if (uiName === 'han_m01') {
            // 証言中 — persistent "testimony in progress" corner indicator
            showUIOverlay('han_m01', 0);
          } else if (uiName === 'han_m04') {
            // End of testimony — hide indicator
            hideUIOverlay();
          } else if (uiName === 'han_m05') {
            // 証言開始 — "testimony start" flash (auto-hide after 1.5 s)
            showUIOverlay('han_m05', 1500);
          } else if (/^han_m1[0-4]$/.test(uiName)) {
            // Brief action markers (han_m10–han_m14, auto-hide after 1 s)
            showUIOverlay(uiName, 1000);
          }
          // han_m27 (navigation map) and all other load_ui names: ignore
          break;
        }

        case 'set_layer':
          currentLayer = ev.layer;
          break;

        case 'fade':
          if (ev.duration > 0) {
            doFade(ev.duration, ev.flag, execute);
            return;
          }
          break;

        case 'color_fade':
          // Sets text colour for the next dialogue line.
          nextTextColor = `rgb(${ev.r},${ev.g},${ev.b})`;
          break;

        case 'play_sound':
          playSound(ev.file);
          break;

        case 'load_bgm': {
          // file may be:
          //   '' or null  → no-op (BGM index 0 = stop in original; we leave it alone)
          //   '\x01'–'\x0f' → single-byte index → han_01…han_15
          //   a plain string → direct filename (future-proof)
          const f = ev.file || '';
          if (f.length === 1) {
            const idx = f.charCodeAt(0);
            if (idx >= 1 && idx <= 15) {
              playBGM(`han_${String(idx).padStart(2, '0')}`);
            } else if (idx === 0) {
              stopBGM();
            }
          } else if (f.length > 1) {
            playBGM(f);
          }
          break;
        }

        case 'play_bgm':
          // Opcode with packed value — BGM management handled via load_bgm + auto-BGM
          break;

        case 'wait':
          if (!skipping && ev.frames > 2) {
            setTimeout(execute, ev.frames * 16);
            return;
          }
          break;

        case 'set_flag':
          break;

        case 'choice_begin':
          if (ev.choices && ev.choices.length) {
            showChoiceMenu(ev.choices);
            return;
          }
          break;

        case 'goto_script':
          if (ev.target) { loadScript(ev.target); return; }
          break;

        case 'jump':
          break;
      }
    }

    textbox.style.display = 'none';
    updateStatus('— End of script —');
  }

  // ── Click / keyboard ──────────────────────────────
  container.addEventListener('click', () => {
    if (!waitingClick) return;

    if (waitSource === 'text') {
      if (!finishTyping()) return;
      playSE('click');    // click-advance sound
      textbox.style.display = 'none';
      dialogueEl.textContent = '';
      clearPortrait();
      nextTextColor = '#e8eeff';
    }
    // wait_click: no SE, no portrait clear — just advance scene setup

    waitingClick = false;
    waitSource   = null;
    execute();
  });

  document.addEventListener('keydown', e => {
    if (e.code === 'Space' || e.code === 'Enter') {
      e.preventDefault();
      container.click();
    }
    if (e.code === 'KeyS') {
      skipping = !skipping;
      if (skipping && waitingClick) container.click();
    }
  });

  // ── Choice menu ───────────────────────────────────
  function showChoiceMenu(choices) {
    choiceMenu.innerHTML = '';
    choiceMenu.style.display = 'flex';
    choices.forEach(c => {
      const btn = document.createElement('button');
      btn.className = 'choice-btn';
      btn.textContent = c.text;
      btn.onclick = () => {
        playSE('select');   // selection sound
        choiceMenu.style.display = 'none';
        cursor = c.target_cursor || cursor;
        execute();
      };
      choiceMenu.appendChild(btn);
    });
  }

  // ── Script loader ─────────────────────────────────
  async function loadScript(name) {
    updateStatus(`Loading ${name}...`);
    // Clear all canvases so no previous scene bleeds into the new script
    bgCtx.clearRect(0, 0, W, H);
    sprCtx.clearRect(0, 0, W, H);
    textbox.style.display = 'none';
    tbCtx.clearRect(0, 0, W, TB_H);
    choiceMenu.style.display = 'none';
    // Start with overlay opaque (black) so that the script's initial fade:1
    // event does a proper fade-in reveal rather than a flash-to-black.
    fadeOverlay.style.transition = 'none';
    fadeOverlay.style.opacity    = '1';
    pendingLoads = [];
    clearPortrait();          // also resets portraitSide → 'left'
    hideUIOverlay();
    nextTextColor = '#e8eeff';
    try {
      const res = await fetch(`scripts/${name}.json`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      events = data.events || [];
      cursor = 0;
      waitingClick = false;
      waitSource   = null;
      skipping = false;
      execute();
    } catch (err) {
      updateStatus(`Error: ${err.message}`);
    }
  }

  function updateStatus(msg) {
    statusEl.textContent = msg !== undefined
      ? msg
      : `Playing: ${scriptSel.value} | Click or [Space] to advance | [S] to skip`;
  }

  // ── Public API ────────────────────────────────────
  return {
    restart() {
      currentLang = langSel.value;
      loadScript(scriptSel.value);
    },
    skip() {
      skipping = true;
      if (waitingClick) container.click();
    },
    backToMenu() {
      stopBGM();
      textbox.style.display = 'none';
      bgCtx.clearRect(0, 0, W, H);
      sprCtx.clearRect(0, 0, W, H);
      tbCtx.clearRect(0, 0, W, TB_H);
      clearPortrait();
      hideUIOverlay();
      events = []; cursor = 0; waitingClick = false; waitSource = null;
      if (window._showMenu) window._showMenu();
    },
    loadScript,
  };
})();
