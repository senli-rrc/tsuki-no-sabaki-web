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
  const statusEl    = document.getElementById('status');
  const scriptSel   = document.getElementById('script-select');
  const langSel     = document.getElementById('lang-select');

  const W  = 640, H = 480;
  const TB_H = 150;            // textbox frame height
  const PORT_W = 165;          // portrait slot width
  const PORT_H = 200;          // portrait canvas height (overflows above frame by 50px)
  const FRAME_X = 170;         // frame x when portrait present
  const FRAME_W = 470;         // frame width (with portrait)
  const FRAME_H = 150;

  // ── State ─────────────────────────────────────────
  let events        = [];
  let cursor        = 0;
  let waitingClick  = false;
  let waitSource    = null;   // 'text' | 'wait_click'
  let skipping      = false;
  let currentLang   = 'jp';
  let bgmEl         = null;
  let currentLayer  = 0;
  let hasPortrait   = false;
  let currentPortrait = null;
  let nextTextColor = '#e8eeff';   // set by color_fade events

  // Pending image loads — await before showing text
  let pendingLoads = [];

  // ── Asset paths ───────────────────────────────────
  const ASSET = {
    bg:            name => `assets/bg/${name}.jpg`,
    sprite:        name => `assets/sprites/${name}.jpg`,
    mask:          name => `assets/sprites/${name}_.jpg`,
    bgm:           name => `assets/bgm/${name}.mp3`,
    se:            name => `assets/se/${name}.wav`,
    // Frame WITH portrait (right decorative border, 470×150)
    frameWith:     'assets/ui/textwins.jpg',
    frameWithMask: 'assets/sprites/textwins_.jpg',
    // Frame WITHOUT portrait (both borders, 620×150, stretched to 640)
    frameNo:       'assets/sprites/textwinc.jpg',
    frameNoMask:   'assets/sprites/textwinc_.jpg',
  };

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

  // Preload both frame variants at startup
  loadImg(ASSET.frameWith);  loadImg(ASSET.frameWithMask);
  loadImg(ASSET.frameNo);    loadImg(ASSET.frameNoMask);

  // ── Canvas compositing ────────────────────────────
  // Draws srcUrl composited with maskUrl (R-channel → alpha) onto an offscreen canvas.
  // srcCropW/H: source pixels to use (0 = full image).
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
      for (let i = 0; i < pixels.data.length; i += 4) {
        pixels.data[i + 3] = mPx.data[i];   // R channel → alpha
      }
    }

    ctx.putImageData(pixels, 0, 0);
    return off;
  }

  // ── Textbox renderer ──────────────────────────────
  // Draws the dialogue FRAME to tbCanvas and portrait to portCanvas.
  // Also adjusts the text area position/alignment based on portrait state.
  async function renderTextbox() {
    tbCtx.clearRect(0, 0, W, TB_H);
    portCtx.clearRect(0, 0, PORT_W, PORT_H);

    if (hasPortrait && currentPortrait) {
      // Portrait present: textwins frame (right border) at FRAME_X
      const [frameOff, faceOff] = await Promise.all([
        compositeToCanvas(ASSET.frameWith, ASSET.frameWithMask, FRAME_W, FRAME_H),
        // Draw the full 150×200 source into the 165×200 portrait canvas
        compositeToCanvas(ASSET.sprite(currentPortrait), ASSET.mask(currentPortrait),
                          PORT_W, PORT_H, 150, 200),
      ]);
      if (frameOff) tbCtx.drawImage(frameOff, FRAME_X, 0);
      if (faceOff)  portCtx.drawImage(faceOff, 0, 0);

      // Text area: right of portrait
      dialogueArea.style.left      = '188px';
      dialogueArea.style.right     = '18px';
      dialogueArea.style.top       = '16px';
      dialogueArea.style.bottom    = '14px';
      dialogueArea.style.textAlign = 'left';
    } else {
      // No portrait: textwinc frame (both borders, 620px) stretched to 640px
      const frameOff = await compositeToCanvas(
        ASSET.frameNo, ASSET.frameNoMask, W, TB_H
      );
      if (frameOff) tbCtx.drawImage(frameOff, 0, 0);

      // Text area: centered within frame
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
      loadImg(ASSET.sprite(name)),
      loadImg(ASSET.mask(name)),
    ]);
    sprCtx.clearRect(0, 0, W, H);
    if (!base) return;

    if (!mask) {
      sprCtx.drawImage(base, 0, 0, W, H);
      return;
    }

    const off = document.createElement('canvas');
    off.width = base.naturalWidth; off.height = base.naturalHeight;
    const offCtx = off.getContext('2d');
    offCtx.drawImage(base, 0, 0);
    const baseData = offCtx.getImageData(0, 0, off.width, off.height);

    const mOff = document.createElement('canvas');
    mOff.width = off.width; mOff.height = off.height;
    const mCtx = mOff.getContext('2d');
    mCtx.drawImage(mask, 0, 0, off.width, off.height);
    const maskData = mCtx.getImageData(0, 0, off.width, off.height);

    for (let i = 0; i < baseData.data.length; i += 4) {
      baseData.data[i + 3] = maskData.data[i];
    }
    offCtx.putImageData(baseData, 0, 0);

    const sw = base.naturalWidth, sh = base.naturalHeight;
    sprCtx.drawImage(off, Math.round((W - sw) / 2), H - sh);
  }

  // ── Background ────────────────────────────────────
  async function drawBackground(name) {
    const img = await loadImg(ASSET.bg(name));
    if (!img) return;
    bgCtx.clearRect(0, 0, W, H);
    const scale = Math.max(W / img.naturalWidth, H / img.naturalHeight);
    const dw = img.naturalWidth * scale, dh = img.naturalHeight * scale;
    bgCtx.drawImage(img, (W - dw) / 2, (H - dh) / 2, dw, dh);
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
    portCtx.clearRect(0, 0, PORT_W, PORT_H);
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
      return;  // frame handled by renderTextbox
    } else if (n.startsWith('han_') && n.endsWith('f')) {
      p = setPortrait(name);  // han_*f = face portrait
    } else {
      p = drawSprite(name);
    }
    if (p) pendingLoads.push(p);
  }

  // ── Text rendering ────────────────────────────────
  let typeTimer  = null;
  let fullText   = '';
  let charIdx    = 0;
  const TYPE_SPEED = 25;

  function showText(text, jp) {
    const display = (currentLang !== 'jp' && text && text !== jp) ? text : jp;
    fullText = display.replace(/\x07/g, '').replace(/!s/g, '').trim();
    charIdx = 0;
    textbox.style.display = 'block';
    dialogueEl.textContent = '';
    dialogueEl.style.color = nextTextColor;
    clickInd.style.display = 'none';
    clearTimeout(typeTimer);
    typeNextChar();
  }

  function typeNextChar() {
    if (charIdx >= fullText.length) {
      clickInd.style.display = 'block';
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

  // ── Audio ─────────────────────────────────────────
  function playSound(file) {
    if (!file) return;
    try { new Audio(ASSET.se(file)).play().catch(() => {}); } catch(e) {}
  }

  function playBGM(file) {
    if (!file) return;
    if (bgmEl) { bgmEl.pause(); bgmEl = null; }
    bgmEl = new Audio(ASSET.bgm(file));
    bgmEl.loop = true;
    bgmEl.volume = 0.45;
    bgmEl.play().catch(() => {});
  }

  // ── Fade ──────────────────────────────────────────
  function doFade(duration, onDone) {
    const ms = skipping ? 0 : Math.min(duration, 1500);
    fadeOverlay.style.transition = `opacity ${ms/2}ms ease`;
    fadeOverlay.style.opacity = '1';
    setTimeout(() => {
      fadeOverlay.style.transition = `opacity ${ms/2}ms ease`;
      fadeOverlay.style.opacity = '0';
      setTimeout(onDone, skipping ? 0 : ms / 2);
    }, skipping ? 0 : ms / 2);
  }

  // ── Event execution ───────────────────────────────
  function execute() {
    while (cursor < events.length) {
      const ev = events[cursor];
      cursor++;

      switch (ev.op) {

        case 'text': {
          // Await all pending loads (bg/sprite/portrait), render textbox, show dialogue.
          const loads = pendingLoads.splice(0);
          const doShow = async () => {
            await renderTextbox();
            showText(ev.text, ev.jp);
            waitSource    = 'text';
            waitingClick  = true;
            updateStatus();
          };
          Promise.all(loads).then(doShow);
          return;
        }

        case 'wait_click':
          // Scene setup pause — do NOT clear portrait.
          waitSource   = 'wait_click';
          waitingClick = true;
          updateStatus();
          return;

        case 'load_image':
          loadImage(ev.name);
          break;

        case 'load_ui':
          break;

        case 'set_layer':
          currentLayer = ev.layer;
          break;

        case 'fade':
          if (ev.duration > 0) {
            doFade(ev.duration, execute);
            return;
          }
          break;

        case 'color_fade':
          // In this engine color_fade sets the next dialogue text color.
          nextTextColor = `rgb(${ev.r},${ev.g},${ev.b})`;
          break;

        case 'play_sound':
          playSound(ev.file);
          break;

        case 'load_bgm':
          if (ev.file) playBGM(ev.file);
          break;

        case 'play_bgm':
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
      // First click: finish typing; second: advance
      if (!finishTyping()) return;
      // Clear dialogue state
      textbox.style.display = 'none';
      dialogueEl.textContent = '';
      clearPortrait();
      nextTextColor = '#e8eeff';   // reset to default
    }
    // For 'wait_click': just advance — portrait state preserved

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
    sprCtx.clearRect(0, 0, W, H);
    textbox.style.display = 'none';
    tbCtx.clearRect(0, 0, W, TB_H);
    choiceMenu.style.display = 'none';
    fadeOverlay.style.opacity = '0';
    pendingLoads = [];
    clearPortrait();
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
      if (bgmEl) { bgmEl.pause(); bgmEl = null; }
      textbox.style.display = 'none';
      bgCtx.clearRect(0, 0, W, H);
      sprCtx.clearRect(0, 0, W, H);
      tbCtx.clearRect(0, 0, W, TB_H);
      clearPortrait();
      events = []; cursor = 0; waitingClick = false; waitSource = null;
      if (window._showMenu) window._showMenu();
    },
    loadScript,
  };
})();
