'use strict';

const VN = (() => {
  // ── DOM refs ──────────────────────────────────────
  const container   = document.getElementById('game-container');
  const bgCanvas    = document.getElementById('bg-canvas');
  const sprCanvas   = document.getElementById('sprite-canvas');
  const itemCanvas  = document.getElementById('item-canvas');
  const portCanvas  = document.getElementById('portrait-canvas');
  const tbCanvas    = document.getElementById('textbox-canvas');
  const bgCtx       = bgCanvas.getContext('2d');
  const sprCtx      = sprCanvas.getContext('2d');
  const itemCtx     = itemCanvas.getContext('2d');
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
  const coatMenu    = document.getElementById('coat-menu');
  const coatCanvas  = document.getElementById('coat-canvas');
  const coatCtx     = coatCanvas.getContext('2d');
  const evBook      = document.getElementById('evidence-book');
  const evCanvas    = document.getElementById('evidence-canvas');
  const evCtx       = evCanvas.getContext('2d');
  const evHint      = document.getElementById('evidence-hint');
  const statusEl    = document.getElementById('status');
  const scriptSel   = document.getElementById('script-select');
  const langSel     = document.getElementById('lang-select');

  const W  = 640, H = 480;
  const TB_H = 150;
  const PORT_W = 168, PORT_H = 200;
  const FRAME_X = 168, FRAME_W = 472, FRAME_H = 150;

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
  let itemGen       = 0;       // incremented on every item-canvas clear; used to
                               // cancel async drawItem() calls that were queued
                               // before a clear signal (mind / background / script)
  let nextTextColor = '#e8eeff';
  let pendingLoads  = [];
  let uiTimer       = null;
  let nanakoTimer   = null;

  // ── Evidence system ───────────────────────────────
  // evidenceSelectPending: set when color_fade val=853009 is seen; tells the
  // engine that the next player interaction should present evidence rather
  // than just advancing normally.
  // evidenceCorrectCursor: cursor index past ALL consecutive wrong-evidence
  // jump blocks, computed at the time the signal is received.
  // evidenceInventory: names of acquired items for the current script.
  //   Ch1 items: 'han_item107', 'han_item112', ... (full-screen overlay names)
  //   Ch2 items: 'han_it_03l', 'han_it_05r', ... (l/r scene icons = acquisition signal)
  let evidenceSelectPending  = false;
  let evidenceCorrectCursor  = -1;
  let evidenceInventory      = [];

  // ── Evidence book UI state ────────────────────────
  // currentScript:    name of the script currently loaded (e.g. 'haruka', 's02_01')
  // evBookView:       which sub-screen the book is showing
  // evDetailItem:     inventory name of the item being viewed in detail
  // evDetailSubpage:  1 = main detail, 2+ = sub-pages / zoom levels
  // evDetailNumbered: true if the item uses numbered sub-pages (e.g. a1, a2) vs
  //                   unnumbered main + optional 02-suffix sub-pages (a + a02)
  // evCharDetail:     character ID currently shown in detail, e.g. 'ski'
  // evCharSubpage:    1 = main char page, 2 = 02 variant, 3 = 03 variant
  let currentScript    = '';
  let evBookView       = 'overview';  // 'overview' | 'detail' | 'character' | 'chardetail'
  let evDetailItem     = null;
  let evDetailSubpage  = 1;
  let evDetailNumbered = false;  // true = 05/14/16-style (a1..aN), false = 03-style (a, a02)
  let evShowingPhoto   = false;  // true while the _02 photo overlay is shown over the detail
  let evCharDetail     = null;
  let evCharSubpage    = 1;

  // ── Asset paths ───────────────────────────────────
  const ASSET = {
    bg:            name => `assets/bg/${name}.jpg`,
    sprite:        name => `assets/sprites/${name}.jpg`,
    nanako:        i    => `assets/sprites/nanako0${i}.png`,
    mask:          name => `assets/sprites/${name}_.jpg`,
    bgm:           name => `assets/bgm/${name}.mp3`,
    se:            name => `assets/se/${name}.wav`,
    frameWith:     'assets/ui/textwins.jpg',
    frameWithMask: 'assets/sprites/textwins_.jpg',
    frameLeft:     'assets/sprites/l_wins.jpg',      // right-side portrait frame
    frameLeftMask: 'assets/sprites/l_wins_.jpg',
    frameNo:       'assets/sprites/textwinc.jpg',
    frameNoMask:   'assets/sprites/textwinc_.jpg',
    // Evidence system
    coatMenu:      'assets/ui/coatmenu01.jpg',
    coatMenuMask:  'assets/ui/coatmenu01_.jpg',
    coatMenuOff:   'assets/ui/coatmenu01_off.jpg',
    coatMenuOffM:  'assets/ui/coatmenu01_off_.jpg',
    // evBook path is chapter-aware: use evBookAsset() at runtime
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
  // Preload nanako gavel animation frames
  [1,2,3,4].forEach(i => loadImg(ASSET.nanako(i)));

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

      // Show portrait canvas and position it on the correct side
      portCanvas.style.display = '';
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
      portCanvas.style.display = 'none';
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

  // ── Nanako gavel animation ────────────────────────
  // nanako01-04 are 640×480 BMP frames (renamed .jpg, converted to .png).
  // The script cycles them with fade:1 between each, but async drawSprite()
  // is too slow. Instead we detect the first frame and immediately play all
  // 4 at ~80 ms/frame on sprCtx, matching the original engine speed.
  function playNanako() {
    clearTimeout(nanakoTimer);
    let frame = 1;
    const FRAME_MS = 80;   // ~12 fps; original felt snappy, not slow-motion

    async function showFrame() {
      const img = await loadImg(ASSET.nanako(frame));
      if (img) {
        sprCtx.clearRect(0, 0, W, H);
        sprCtx.drawImage(img, 0, 0, W, H);
      }
      frame++;
      if (frame <= 4) {
        nanakoTimer = setTimeout(showFrame, FRAME_MS);
      }
      // After frame 4, leave the last frame on sprCtx; the script will load
      // han_bg04 shortly after which clears sprCtx via drawBackground.
    }
    showFrame();
  }
  // han_item* are 640×480 full-frame composites (image + R-channel mask).
  // They sit on the dedicated item-canvas so they overlay sprites without
  // clearing them. han_item (no number) clears the item layer.
  //
  // itemGen solves the async race condition:
  //   load_ui mind / background change / loadScript all call clearItemCanvas()
  //   which increments itemGen synchronously. Any async drawItem() that started
  //   before the clear checks the generation on completion; if itemGen changed,
  //   the clear happened while we were loading — discard the draw.
  function clearItemCanvas() {
    itemGen++;
    itemCtx.clearRect(0, 0, W, H);
  }

  async function drawItem(name) {
    const n = name.toLowerCase();
    if (n === 'han_item') {
      clearItemCanvas();
      return;
    }
    const myGen = itemGen;  // capture generation at dispatch time
    const [base, mask] = await Promise.all([
      loadImg(ASSET.sprite(name)), loadImg(ASSET.mask(name)),
    ]);
    // If a clear happened while we were loading images, discard this draw.
    if (itemGen !== myGen) return;

    itemCtx.clearRect(0, 0, W, H);
    if (!base) return;
    if (!mask) { itemCtx.drawImage(base, 0, 0, W, H); return; }

    const off = document.createElement('canvas');
    off.width = W; off.height = H;
    const offCtx = off.getContext('2d');
    offCtx.drawImage(base, 0, 0, W, H);
    const bd = offCtx.getImageData(0, 0, W, H);

    const mOff = document.createElement('canvas');
    mOff.width = W; mOff.height = H;
    const mCtx = mOff.getContext('2d');
    mCtx.drawImage(mask, 0, 0, W, H);
    const md = mCtx.getImageData(0, 0, W, H);

    for (let i = 0; i < bd.data.length; i += 4)
      bd.data[i + 3] = md.data[i];
    offCtx.putImageData(bd, 0, 0);
    itemCtx.drawImage(off, 0, 0);
  }

  // ── Evidence system helpers ───────────────────────
  // Scan forward from fromCursor for the last jump event within 500 events.
  // The cursor AFTER that jump is the "correct evidence" path start.
  function findEvidenceCorrectCursor(fromCursor) {
    let lastJump = -1;
    const limit  = Math.min(fromCursor + 500, events.length);
    for (let i = fromCursor; i < limit; i++) {
      if (events[i].op === 'jump') lastJump = i;
    }
    return lastJump >= 0 ? lastJump + 1 : fromCursor;
  }

  // ── Evidence book helpers ─────────────────────────
  // Slot grid for han_item_00.jpg (ch1).  Pixel boundaries measured from the image:
  //   Left page:  3 cols at x=47,132,217 (w=70 each)
  //   Right page: 3 cols at x=353,438,523 (w=70 each)
  //   Row 1: y=71  h=92  │  Row 2: y=197 h=91  │  Row 3: y=323 h=92
  //
  // Item ordering (ch1): slots 0-8 = left page items 101-109 (always have content in bg),
  //   slots 9-11 = right page row1 items 110-112, slots 12-17 = mostly empty.
  // Items 101-103 are always unlocked; 104-113 need story acquisition.
  //
  // The same slot grid is reused for ch2 (han_it_00.jpg) — adjust coordinates
  // if the ch2 book image turns out to have a different layout.
  const EV_SLOTS = [
    // Left page — Row 1 (items 101-103)
    {x:47,  y:71,  w:70, h:92}, {x:132, y:71,  w:70, h:92}, {x:217, y:71,  w:70, h:92},
    // Left page — Row 2 (items 104-106)
    {x:47,  y:197, w:70, h:91}, {x:132, y:197, w:70, h:91}, {x:217, y:197, w:70, h:91},
    // Left page — Row 3 (items 107-109)
    {x:47,  y:323, w:70, h:92}, {x:132, y:323, w:70, h:92}, {x:217, y:323, w:70, h:92},
    // Right page — Row 1 (items 110-112)
    {x:353, y:71,  w:70, h:92}, {x:438, y:71,  w:70, h:92}, {x:523, y:71,  w:70, h:92},
    // Right page — Row 2 (item 113, then empty)
    {x:353, y:197, w:70, h:91}, {x:438, y:197, w:70, h:91}, {x:523, y:197, w:70, h:91},
    // Right page — Row 3 (permanently empty slots)
    {x:353, y:323, w:70, h:92}, {x:438, y:323, w:70, h:92}, {x:523, y:323, w:70, h:92},
  ];

  // Hot-zone for the 関係者ファイルへ / 証拠品一覧へ tab (right edge, lower half)
  const EV_SIDETAB  = {x:608, y:260, w:32, h:150};
  // Hot-zone for the 戻る button (top-right of book overview)
  const EV_BACKTAB  = {x:540, y:4,   w:95, h:42};

  // Ch1 scripts use han_item_00; ch2/3 use han_it_00
  function getChapterType() {
    return ['akane','haruka','mitsuki'].includes(currentScript) ? 'ch1' : 'ch2';
  }
  function evBookAsset() {
    return getChapterType() === 'ch1'
      ? 'assets/sprites/han_item_00.jpg'
      : 'assets/sprites/han_it_00.jpg';
  }

  // Parse an inventory name into { type:'ch1'|'ch2', num:Number }
  // Ch1 inventory names: 'han_item107'  (bare number, no underscore after 'item')
  // Ch2 inventory names: 'han_it_03l'   (2-digit number + l/r suffix)
  function invItemId(invName) {
    const m1 = invName.match(/^han_item(\d{3})$/i);
    if (m1) return { type:'ch1', num:parseInt(m1[1], 10) };
    const m2 = invName.match(/^han_it_(\d+)[lr]$/i);
    if (m2) return { type:'ch2', num:parseInt(m2[1], 10) };
    return null;
  }

  // 0-based slot index (ch1 items start at 101 → slot 0)
  function invSlotIndex(invName) {
    const id = invItemId(invName);
    if (!id) return -1;
    return id.type === 'ch1' ? id.num - 101 : id.num - 1;
  }

  // Base name for loading detail/thumbnail images (without variant suffix)
  function invDetailBase(invName) {
    const id = invItemId(invName);
    if (!id) return null;
    if (id.type === 'ch1') return `han_item_${id.num}`;        // e.g. 'han_item_107'
    return `han_it_${String(id.num).padStart(2,'0')}`;         // e.g. 'han_it_03'
  }

  // Thumbnail sprite to draw inside the book grid slot
  function invThumbName(invName) {
    const id = invItemId(invName);
    if (!id) return null;
    if (id.type === 'ch1') return `han_item_${id.num}`;        // detail page as thumbnail
    return invName;                                             // e.g. 'han_it_03l' itself
  }

  // ── Character roster mapped to visual slot positions ─────────────────────
  // Flat array of 54 entries = 18 slots × 3 pages.
  // Index = (page - 1) * 18 + slotIndex.
  // null = slot is visually empty or has no selectable profile.
  //
  // Page 1 (han_cha.jpg)   — 10 occupied slots (0-9), 8 empty (10-17)
  // Page 2 (han_cha02.jpg) — 14 occupied slots (0-13), 4 empty (14-17)
  // Page 3 (han_cha03.jpg) — 12 occupied slots (0-11), 6 empty (12-17)
  //
  // All positions confirmed by user (story order within each chapter page).
  const CHAR_IDS = [
    // ── Page 1 (han_cha.jpg) — 10 chars, 8 empty ─────────
    'ski', 'khk', 'stk', 'arc', 'cel', 'sev', 'akr', 'ahk', 'kgm', 'akh',
    null,  null,  null,  null,  null,  null,  null,  null,

    // ── Page 2 (han_cha02.jpg) — 14 chars, 4 empty ───────
    'ski', 'khk', 'hsi', 'ahk', 'akh', 'tke', 'hni', 'suk',
    'cel', 'sev', 'akr', 'roa', 'arc', 'len',
    null,  null,  null,  null,

    // ── Page 3 (han_cha03.jpg) — 12 chars, 6 empty ───────
    'ski', 'akh', 'khk', 'hsi', 'ahk', 'arc',
    'cel', 'sev', 'tke', 'mkh', 'not', 'rri',
    null,  null,  null,  null,  null,  null,
  ];
  // Sub-pages per character (02 = second panel, 03 = third panel).
  // Only list the sub-pages that are confirmed to exist.
  const CHAR_SUBPAGES = {
    ski:3, akh:3, ahk:3, arc:3, khk:3, sev:3, cel:3, tke:3, rri:3,
    hsi:3, not:3,
    akr:2, sev:2,    // sev has both 02 and 03 so already in group above
  };
  // Maximum confirmed sub-page for each character (1 = main page only)
  function charMaxPage(id) { return CHAR_SUBPAGES[id] || 1; }

  // ── Evidence book render functions ───────────────
  async function renderEvBookOverview() {
    const bgImg = await loadImg(evBookAsset());
    evCtx.clearRect(0, 0, W, H);
    if (bgImg) evCtx.drawImage(bgImg, 0, 0, W, H);

    // The book background already contains all item thumbnails at their slot positions.
    // Locked (unacquired) items are hidden by drawing a white mask panel on top —
    // matching the original PSG engine behaviour where the exe overlaid white rects.
    //
    // Ch1: items 101-103 are always visible (no mask needed).
    //      Items 104-113 get a white mask until acquired via story event.
    // Ch2: all items get a white mask until acquired.
    const isCh1 = getChapterType() === 'ch1';

    // Build a Set of acquired slot indices for quick lookup
    const acquired = new Set();
    if (isCh1) {
      // Always show 101-103 (slots 0-2)
      acquired.add(0); acquired.add(1); acquired.add(2);
      // Add story-acquired items
      for (const n of evidenceInventory) {
        const id = invItemId(n);
        if (id && id.type === 'ch1') acquired.add(id.num - 101);
      }
    } else {
      for (const n of evidenceInventory) {
        const id = invItemId(n);
        if (id && id.type === 'ch2') acquired.add(id.num - 1);
      }
    }

    // Draw white mask over every slot that is NOT acquired
    evCtx.fillStyle = '#ffffff';
    for (let i = 0; i < EV_SLOTS.length; i++) {
      if (acquired.has(i)) continue;
      const s = EV_SLOTS[i];
      // Fill the interior only (leave 1px border from background visible)
      evCtx.fillRect(s.x + 1, s.y + 1, s.w - 2, s.h - 2);
    }
  }

  // Resolve the actual filename and numbered-mode for a ch2 item's detail page.
  // Returns { name:String, numbered:Boolean } where:
  //   numbered=false → item uses 'han_it_03a' style (unnumbered main, maybe a02 sub)
  //   numbered=true  → item uses 'han_it_05a1' style (all pages have a digit suffix)
  async function resolveDetailName(invName, subpage) {
    const id   = invItemId(invName);
    const base = invDetailBase(invName);
    if (!id || !base) return null;

    if (id.type === 'ch1') {
      // Ch1: 'han_item_107' (main) or 'han_item_1072' (sub 2), 'han_item_1073' etc.
      const name = subpage > 1 ? `${base}${subpage}` : base;
      return { name, numbered: false };
    }

    const v = evidenceSelectPending ? 'h' : 'a';   // testimony vs browse variant

    if (subpage === 1) {
      // Probe: try unnumbered ('han_it_03a') then numbered-1 ('han_it_05a1')
      const unnumbered = `${base}${v}`;
      const img = await loadImg(`assets/sprites/${unnumbered}.jpg`);
      if (img) return { name: unnumbered, numbered: false };
      return { name: `${base}${v}1`, numbered: true };
    }

    // subpage >= 2
    if (evDetailNumbered) {
      // Items 05/14/16: pages are a1, a2, a3 ...
      return { name: `${base}${v}${subpage}`, numbered: true };
    }
    // Items 03/27-style: sub-pages use zero-padded 02, 03 suffix
    return { name: `${base}${v}${String(subpage).padStart(2,'0')}`, numbered: false };
  }

  async function renderEvItemDetail(invName, subpage) {
    const resolved = await resolveDetailName(invName, subpage);
    if (!resolved) return;
    evCtx.clearRect(0, 0, W, H);
    let img = await loadImg(`assets/sprites/${resolved.name}.jpg`);
    if (!img && subpage > 1) {
      // Sub-page doesn't exist; fall back to page 1
      const fb = await resolveDetailName(invName, 1);
      if (fb) img = await loadImg(`assets/sprites/${fb.name}.jpg`);
    }
    if (img) evCtx.drawImage(img, 0, 0, W, H);
    // Persist the numbered/unnumbered mode so next-page navigation uses it
    if (subpage === 1) evDetailNumbered = resolved.numbered;

    // Show つきつける overlay button only in ch2 testimony mode
    const presentBtn = document.getElementById('ev-present-btn');
    if (presentBtn) {
      presentBtn.style.display =
        (evidenceSelectPending && getChapterType() !== 'ch1') ? 'block' : 'none';
    }

    // For ch1 main detail page (subpage=1): show invisible photo click-zone if a _02
    // photo variant exists for this item.  Currently only han_item_109 has _02.
    // On sub-pages (2/3/4) or ch2 items the zone is hidden.
    const photoBtn = document.getElementById('ev-photo-btn');
    if (photoBtn) {
      if (getChapterType() === 'ch1' && subpage === 1) {
        const base = invDetailBase(invName);
        if (base) {
          const photoImg = await loadImg(`assets/sprites/${base}_02.jpg`);
          photoBtn.style.display = photoImg ? 'block' : 'none';
        } else {
          photoBtn.style.display = 'none';
        }
      } else {
        photoBtn.style.display = 'none';
      }
    }
  }

  // Character list: han_cha.jpg (page 1), han_cha02.jpg (page 2), han_cha03.jpg (page 3)
  // Characters within each page are positioned at the same EV_SLOTS grid coordinates.
  let evCharPage = 1;   // which page of the character list is showing (1, 2, or 3)
  const CHAR_PAGE_SIZE = EV_SLOTS.length;  // 18 slots per page

  async function renderEvCharList() {
    const bgName = evCharPage === 1 ? 'han_cha' : `han_cha0${evCharPage}`;
    const img = await loadImg(`assets/sprites/${bgName}.jpg`);
    evCtx.clearRect(0, 0, W, H);
    if (img) evCtx.drawImage(img, 0, 0, W, H);
    const presentBtn = document.getElementById('ev-present-btn');
    if (presentBtn) presentBtn.style.display = 'none';
  }

  async function renderEvCharDetail(charId, subpage) {
    const suffix = subpage > 1 ? String(subpage).padStart(2,'0') : '';
    const name   = `han_cha_${charId}${suffix}`;
    let img = await loadImg(`assets/sprites/${name}.jpg`);
    if (!img && subpage > 1) img = await loadImg(`assets/sprites/han_cha_${charId}.jpg`);
    evCtx.clearRect(0, 0, W, H);
    if (img) evCtx.drawImage(img, 0, 0, W, H);
  }

  // Composite and draw the coat menu onto its canvas.
  // evidenceMode=true → show active coatmenu (slot 3 visible); false → off state
  async function renderCoatMenu(evidenceMode) {
    const src  = evidenceMode ? ASSET.coatMenu    : ASSET.coatMenuOff;
    const mask = evidenceMode ? ASSET.coatMenuMask : ASSET.coatMenuOffM;
    const off  = await compositeToCanvas(src, mask, W, H);
    coatCtx.clearRect(0, 0, W, H);
    if (off) coatCtx.drawImage(off, 0, 0);
    document.getElementById('coat-present').style.display =
      evidenceMode ? 'block' : 'none';
  }

  function showCoatMenu() {
    renderCoatMenu(evidenceSelectPending);
    coatMenu.style.display = 'block';
  }

  function hideCoatMenu() {
    coatMenu.style.display = 'none';
  }

  async function showEvidenceBook() {
    evBookView      = 'overview';
    evDetailItem    = null;
    evDetailSubpage = 1;
    evShowingPhoto  = false;
    evCharDetail    = null;
    await renderEvBookOverview();
    const presentBtn = document.getElementById('ev-present-btn');
    if (presentBtn) presentBtn.style.display = 'none';
    evBook.style.display = 'block';
  }

  function hideEvidenceBook() {
    evBook.style.display = 'none';
    document.getElementById('ev-present-btn').style.display = 'none';
    document.getElementById('ev-photo-btn').style.display   = 'none';
    evShowingPhoto = false;
  }

  // Called when player clicks つきつける (present evidence button).
  // Closes both overlays and jumps to the correct-evidence path.
  function presentEvidence() {
    hideEvidenceBook();
    hideCoatMenu();
    if (evidenceSelectPending && evidenceCorrectCursor >= 0) {
      evidenceSelectPending = false;
      evHint.style.display = 'none';   // hide amber hint bar
      waitingClick = false;
      waitSource   = null;
      textbox.style.display = 'none';
      dialogueEl.textContent = '';
      clearPortrait();
      nextTextColor = '#e8eeff';
      cursor = evidenceCorrectCursor;
      execute();
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
    portCanvas.style.display = 'none';
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
      clearItemCanvas();   // synchronous: increment gen before async draw starts
      p = drawBackground(name);
    } else if (n === 'textwins') {
      // Dialogue frame switch: character speaking on left side
      portraitSide = 'left';
      return;
    } else if (n === 'l_wins') {
      // Dialogue frame switch: prosecutor/judge speaking, portrait on right
      portraitSide = 'right';
      return;
    } else if (n === 'textwinc' || n === 'mind') {
      // Narrator / inner-monologue frame: no character speaking, clear portrait
      clearPortrait();
      return;
    } else if (n === 'han_item' || /^han_item\d/.test(n)) {
      // Ch1 evidence items: 'han_item' (clear) or 'han_item107' (show/acquire).
      // Only acquire bare-number names like han_item107, NOT detail pages han_item_107.
      if (/^han_item\d/.test(n) && !evidenceInventory.includes(name)) {
        evidenceInventory.push(name);
      }
      p = drawItem(name);
    } else if (/^han_it_\d+[lr]$/i.test(n)) {
      // Ch2 item scene icons: 'han_it_03l', 'han_it_05r', etc.
      // In ch2/3 scripts these signal item acquisition; in ch1 scripts (akane/haruka/
      // mitsuki) they appear as scene decoration sprites without book significance.
      if (getChapterType() === 'ch2' && !evidenceInventory.includes(name)) {
        evidenceInventory.push(name);
      }
      p = drawSprite(name);   // drawn as a regular sprite at its natural position
    } else if (n.startsWith('nanako')) {
      // Gavel animation frames — only trigger on the first frame; playNanako()
      // handles all 4 frames internally at fixed speed. Subsequent nanako*
      // load_image events (02-04) are no-ops here to avoid double-drawing.
      if (n === 'nanako01') playNanako();
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

  function showText(text, jp, zh) {
    let display;
    if (currentLang === 'cn' && zh && zh !== jp) display = zh;
    else if (currentLang !== 'jp' && text && text !== jp) display = text;
    else display = jp;
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
          //
          // Legitimate PSG in-text codes must be stripped BEFORE the garbage test so they
          // don't trigger a false positive:
          //   \x07  — in-text page-break / bell (very common in multi-page lines)
          //   !s    — centre-align tag
          //   @     — text pause marker
          const rawJp = (ev.jp || '').replace(/\x07/g, '').replace(/!s|@/g, '');
          const isGarbage = /[\x00-\x08\x0b\x0c\x0e-\x1f\x7f\ufffd]/.test(rawJp);
          if (isGarbage) break;   // skip silently, continue event loop
          // \u9E5A (鶚) is a PSG engine internal separator injected between cross-exam
          // sections — it should never be displayed as dialogue text.
          if (rawJp.trim() === '\u9E5A') break;

          const loads = pendingLoads.splice(0);
          const doShow = async () => {
            await renderTextbox();
            showText(ev.text, ev.jp, ev.zh);
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
          } else if (uiName === 'mind') {
            // Switch to protagonist internal-thought mode.
            // Physical evidence is not shown during inner monologue.
            clearItemCanvas();
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
          // val=853009 is the PSG engine's "present evidence" signal.
          // Compute the correct-evidence cursor now (past all wrong branches)
          // so the click handler / コート menu can jump there.
          if (ev.val === 853009) {
            evidenceSelectPending = true;
            evidenceCorrectCursor = findEvidenceCorrectCursor(cursor);
            evHint.style.display = 'block';  // show amber hint bar
          }
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
          // preserveInventory=true: carry collected evidence into the next script
          if (ev.target) { loadScript(ev.target, true); return; }
          break;

        case 'jump':
          // Jump to a cursor index (wrong-evidence retry loop).
          // Only fire if evidence selection is still pending (i.e. the player
          // has NOT yet presented evidence and explicitly chosen the correct path).
          // If evidenceSelectPending is false we already jumped to the correct
          // path, so the wrong branches should be skipped — just fall through.
          if (ev.target >= 0 && ev.target < events.length) {
            if (evidenceSelectPending) {
              // Player hasn't presented evidence yet → retry from target
              cursor = ev.target;
              execute();
              return;
            }
            // Otherwise: evidenceSelectPending was cleared by presentEvidence()
            // which already jumped us to the correct path.  This jump event
            // should never be reached in that case, but guard just in case.
          }
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
      portCanvas.style.display = 'none';  // hide portrait WITH textbox
      dialogueEl.textContent = '';
      // Portrait STATE (hasPortrait / currentPortrait) is intentionally kept so
      // the next text event from the same speaker restores the portrait.
      // Portrait is only truly reset when textwinc/mind loads (clearPortrait).
      nextTextColor = '#e8eeff';
    }
    // wait_click: no SE, no portrait change — just advance scene setup

    waitingClick = false;
    waitSource   = null;
    execute();
  });

  // Right-click on game → open coat menu (evidence/notes access)
  container.addEventListener('contextmenu', e => {
    e.preventDefault();
    if (coatMenu.style.display === 'none' || !coatMenu.style.display) {
      showCoatMenu();
    } else {
      hideCoatMenu();
      hideEvidenceBook();
    }
  });

  // Clicking outside coat-menu buttons (on the transparent background) closes the menu
  // and, if dialogue is waiting, advances it — so the player is never stuck.
  coatMenu.addEventListener('click', e => {
    const btnIds = ['coat-yusaburu','coat-datafile','coat-present','coat-back'];
    const hitBtn = btnIds.some(id => document.getElementById(id).contains(e.target));
    if (!hitBtn) {
      hideCoatMenu();
      hideEvidenceBook();
      if (waitingClick) container.click();
    }
  });

  document.addEventListener('keydown', e => {
    if (e.code === 'Space' || e.code === 'Enter') {
      e.preventDefault();
      // If coat menu is open, close it first; then advance dialogue if waiting
      if (coatMenu.style.display === 'block') {
        hideCoatMenu();
        hideEvidenceBook();
        if (waitingClick) container.click();
        return;
      }
      container.click();
    }
    if (e.code === 'KeyS') {
      skipping = !skipping;
      if (skipping && waitingClick) container.click();
    }
    // '1' key → toggle coat menu (matches original PSG engine binding)
    if (e.code === 'Digit1') {
      if (coatMenu.style.display === 'none' || !coatMenu.style.display) {
        showCoatMenu();
      } else {
        hideCoatMenu();
        hideEvidenceBook();
      }
    }
  });

  // ── Coat menu button wiring ───────────────────────
  // ゆさぶる: "shake" — currently a no-op; close the coat menu
  document.getElementById('coat-yusaburu').onclick = () => {
    hideCoatMenu();
    hideEvidenceBook();
  };
  // データファイル: open the evidence book
  document.getElementById('coat-datafile').onclick = () => {
    showEvidenceBook();
  };
  // つきつける: present evidence (only shown when evidenceSelectPending)
  document.getElementById('coat-present').onclick = () => {
    presentEvidence();
  };
  // 戻る: close coat menu
  document.getElementById('coat-back').onclick = () => {
    hideCoatMenu();
    hideEvidenceBook();
  };
  // ── Evidence book canvas click handler ───────────
  // Handles all navigation: item slots, character tab, close tab, sub-pages, char detail.
  evBook.addEventListener('click', async e => {
    e.stopPropagation();
    const rect = evBook.getBoundingClientRect();
    const mx = (e.clientX - rect.left) * (W / rect.width);
    const my = (e.clientY - rect.top)  * (H / rect.height);

    // Helper: is point inside a tab zone?
    const hit = z => mx >= z.x && mx < z.x + z.w && my >= z.y && my < z.y + z.h;

    if (evBookView === 'overview') {
      // 戻る: close the book
      if (hit(EV_BACKTAB)) { hideEvidenceBook(); return; }
      // 関係者ファイルへ tab: switch to character page
      if (hit(EV_SIDETAB)) {
        evBookView   = 'character';
        evCharDetail = null;
        await renderEvCharList();
        return;
      }
      // Item slot click: iterate ALL slots by index; locked slots silently ignore click.
      const isCh1 = getChapterType() === 'ch1';
      // Rebuild acquired set (same logic as renderEvBookOverview)
      const acqSet = new Set();
      if (isCh1) {
        acqSet.add(0); acqSet.add(1); acqSet.add(2);
        for (const n of evidenceInventory) {
          const id = invItemId(n); if (id && id.type === 'ch1') acqSet.add(id.num - 101);
        }
      } else {
        for (const n of evidenceInventory) {
          const id = invItemId(n); if (id && id.type === 'ch2') acqSet.add(id.num - 1);
        }
      }
      for (let slotIdx = 0; slotIdx < EV_SLOTS.length; slotIdx++) {
        const s = EV_SLOTS[slotIdx];
        if (!(mx >= s.x && mx < s.x + s.w && my >= s.y && my < s.y + s.h)) continue;
        // Slot hit — only open detail if acquired
        if (!acqSet.has(slotIdx)) return;  // locked: no response
        // Build the canonical inventory name for this slot
        let invName;
        if (isCh1) {
          invName = `han_item${slotIdx + 101}`;
        } else {
          const itemNum = slotIdx + 1;
          const numStr  = String(itemNum).padStart(2,'0');
          // Find the actual inventory entry (could be l or r variant)
          invName = evidenceInventory.find(n => invItemId(n)?.num === itemNum) ||
                    `han_it_${numStr}l`;  // fallback synthetic name
        }
        evBookView      = 'detail';
        evDetailItem    = invName;
        evDetailSubpage = 1;
        evDetailNumbered = false;
        await renderEvItemDetail(invName, 1);
        return;
      }

    } else if (evBookView === 'detail') {
      // If the _02 photo overlay is currently shown, any click returns to the detail page.
      if (evShowingPhoto) {
        evShowingPhoto = false;
        await renderEvItemDetail(evDetailItem, evDetailSubpage);
        return;
      }
      // Bottom-right zone: try next sub-page / zoom level
      if (mx > W * 0.65 && my > H * 0.65) {
        const nextPage = evDetailSubpage + 1;
        const resolved = await resolveDetailName(evDetailItem, nextPage);
        if (resolved) {
          const img = await loadImg(`assets/sprites/${resolved.name}.jpg`);
          if (img) {
            evDetailSubpage = nextPage;
            await renderEvItemDetail(evDetailItem, nextPage);
            return;
          }
        }
      }
      // Top-left zone on sub-page: go back to page 1
      if (evDetailSubpage > 1 && mx < W * 0.3 && my < H * 0.3) {
        evDetailSubpage = 1;
        await renderEvItemDetail(evDetailItem, 1);
        return;
      }
      // Anywhere else: back to overview
      evBookView       = 'overview';
      evDetailItem     = null;
      evDetailSubpage  = 1;
      evDetailNumbered = false;
      document.getElementById('ev-present-btn').style.display = 'none';
      document.getElementById('ev-photo-btn').style.display   = 'none';
      await renderEvBookOverview();

    } else if (evBookView === 'character') {
      // 証拠品一覧へ tab: return to evidence overview
      if (hit(EV_SIDETAB)) {
        evBookView = 'overview';
        evCharPage = 1;
        await renderEvBookOverview();
        return;
      }
      // 戻る at top-right: close book entirely
      if (hit(EV_BACKTAB)) { hideEvidenceBook(); return; }
      // Character slot click — offset by current page
      const charOffset = (evCharPage - 1) * CHAR_PAGE_SIZE;
      for (let i = 0; i < EV_SLOTS.length; i++) {
        const s = EV_SLOTS[i];
        if (mx >= s.x && mx < s.x + s.w && my >= s.y && my < s.y + s.h) {
          const charIdx = charOffset + i;
          if (charIdx < CHAR_IDS.length && CHAR_IDS[charIdx] !== null) {
            evBookView    = 'chardetail';
            evCharDetail  = CHAR_IDS[charIdx];
            evCharSubpage = 1;
            await renderEvCharDetail(CHAR_IDS[charIdx], 1);
          }
          return;
        }
      }

    } else if (evBookView === 'chardetail') {
      // Bottom-right: advance to next sub-page if it exists
      if (mx > W * 0.65 && my > H * 0.65) {
        const nextSub = evCharSubpage + 1;
        if (evCharDetail && nextSub <= charMaxPage(evCharDetail)) {
          evCharSubpage = nextSub;
          await renderEvCharDetail(evCharDetail, nextSub);
          return;
        }
      }
      // Top-left: go back to sub-page 1
      if (evCharSubpage > 1 && mx < W * 0.3 && my < H * 0.3) {
        evCharSubpage = 1;
        await renderEvCharDetail(evCharDetail, 1);
        return;
      }
      // Anywhere else: back to character list
      evBookView    = 'character';
      evCharDetail  = null;
      evCharSubpage = 1;
      await renderEvCharList();
    }
  });

  // ev-present-btn: つきつける button shown on ch2 item detail in testimony mode
  document.getElementById('ev-present-btn').onclick = e => {
    e.stopPropagation();
    presentEvidence();
  };

  // ev-photo-btn: transparent click-zone positioned over the cyan text in ch1 item
  // detail pages.  Clicking it shows the _02 photo overlay (han_item_109_02.jpg).
  // After the photo is shown, any canvas click returns to the item detail page.
  document.getElementById('ev-photo-btn').onclick = async e => {
    e.stopPropagation();
    const base = invDetailBase(evDetailItem);
    if (!base) return;
    const photoSrc = `assets/sprites/${base}_02.jpg`;
    const img = await loadImg(photoSrc);
    if (!img) return;
    evCtx.clearRect(0, 0, W, H);
    evCtx.drawImage(img, 0, 0, W, H);
    e.target.style.display = 'none';
    evShowingPhoto = true;   // flag: next canvas click → back to detail (not overview)
  };

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
  // preserveInventory=true when transitioning via goto_script (story continues);
  // false when the player manually restarts or returns to menu (fresh start).
  async function loadScript(name, preserveInventory = false) {
    currentScript = name;
    updateStatus(`Loading ${name}...`);
    // Clear all canvases so no previous scene bleeds into the new script
    bgCtx.clearRect(0, 0, W, H);
    sprCtx.clearRect(0, 0, W, H);
    clearItemCanvas();
    textbox.style.display = 'none';
    tbCtx.clearRect(0, 0, W, TB_H);
    choiceMenu.style.display = 'none';
    // Start with overlay opaque (black) so that the script's initial fade:1
    // event does a proper fade-in reveal rather than a flash-to-black.
    fadeOverlay.style.transition = 'none';
    fadeOverlay.style.opacity    = '1';
    pendingLoads = [];
    clearTimeout(nanakoTimer);
    clearPortrait();          // also resets portraitSide → 'left'
    hideUIOverlay();
    hideCoatMenu();
    hideEvidenceBook();
    evidenceSelectPending = false;
    evidenceCorrectCursor = -1;
    if (!preserveInventory) evidenceInventory = [];
    evBookView       = 'overview';
    evDetailItem     = null;
    evDetailSubpage  = 1;
    evDetailNumbered = false;
    evShowingPhoto   = false;
    evCharDetail     = null;
    evCharSubpage    = 1;
    evCharPage       = 1;
    evHint.style.display  = 'none';
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
    if (msg !== undefined) {
      statusEl.textContent = msg;
      return;
    }
    if (evidenceSelectPending) {
      statusEl.textContent =
        `⚠ 出示证据阶段：右键/[1] 打开菜单 → 证拠品一覧 → 选择证据 → つきつける`;
    } else {
      statusEl.textContent =
        `Playing: ${scriptSel.value} | 点击/[Space] 推进 | 右键/[1] 菜单 | [S] 跳过`;
    }
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
      clearItemCanvas();
      tbCtx.clearRect(0, 0, W, TB_H);
      clearTimeout(nanakoTimer);
      clearPortrait();
      hideUIOverlay();
      hideCoatMenu();
      hideEvidenceBook();
      evidenceSelectPending = false;
      evidenceCorrectCursor = -1;
      evidenceInventory     = [];
      evBookView       = 'overview';
      evDetailItem     = null;
      evDetailSubpage  = 1;
      evDetailNumbered = false;
      evShowingPhoto   = false;
      evCharDetail     = null;
      evCharSubpage    = 1;
      evCharPage       = 1;
      evHint.style.display  = 'none';
      events = []; cursor = 0; waitingClick = false; waitSource = null;
      if (window._showMenu) window._showMenu();
    },
    loadScript,
  };
})();
