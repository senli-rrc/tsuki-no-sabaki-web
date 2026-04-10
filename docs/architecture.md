# Engine Architecture

## Overview

The web player is a single HTML file (`webapp/index.html`) that loads a pure-JS engine (`webapp/engine/engine.js`). There is no build step, no npm dependencies, and no VN framework — everything is custom.

The engine reads pre-extracted JSON script files and renders to HTML5 Canvas elements using a synchronous event loop with async I/O at defined suspension points.

---

## Three-screen SPA

`index.html` contains three `<div>` screens, exactly one visible at a time:

| Screen | ID | Background | Description |
|--------|----|-----------|-------------|
| Main menu | `#menu-screen` | `han_t_02_off.jpg` | Start / Load / Option / Exit |
| Chapter select | `#chapter-screen` | `han_t_start01.jpg` | Three story chapters + Back |
| Game | `#game-container` | canvas stack | Actual VN playback |

Navigation is done by toggling `display: block / none` via JavaScript. The public API is `window._showMenu()` and `window._showChapterSelect()`.

---

## Canvas stack

All canvases are absolutely positioned inside `#game-container` (640×480 CSS px, scaled by the browser):

```
z-index 20  #choice-menu          Branch buttons (HTML)
z-index 10  #fade-overlay         Black fade div
z-index  5  #textbox div
               └── #textbox-canvas  640×150  Dialogue frame (composited)
               └── #dialogue-area   Text + click indicator (HTML)
z-index  4  #portrait-canvas      165×200  Face portrait
z-index  2  #sprite-canvas        640×480  Full-body character sprites
z-index  1  #bg-canvas            640×480  Background images
```

### Why a separate portrait canvas?

The portrait canvas is intentionally **200 px tall** while the textbox frame is **150 px tall**. Both are bottom-anchored (`bottom: 0`). This makes the top 50 px of the portrait canvas extend above the frame, giving the "character head pokes above the dialogue box" look of the original game.

The portrait canvas has `z-index: 4` (above sprites, below textbox). The left 165 px of the textbox canvas are always **transparent** (no frame drawn there), so the portrait shows through correctly.

---

## Event loop (`execute()`)

`execute()` is a `while` loop that processes events synchronously until it hits a *suspension point*:

| Suspension point | Resumes when |
|-----------------|-------------|
| `text` | User clicks / presses Space |
| `wait_click` | User clicks / presses Space |
| `fade` | CSS transition ends (setTimeout) |
| `wait` | Timeout (frames × 16 ms) |
| `choice_begin` | User picks a branch |
| `goto_script` | New script loaded (async fetch) |

### `waitSource` flag

Two events cause the engine to wait for a click:
- `text` — dialogue line is displayed; clicking should **advance** (clear portrait, hide textbox)
- `wait_click` — scene setup pause; clicking should **not** clear the portrait

The `waitSource` string (`'text'` or `'wait_click'`) is checked in the click handler to decide whether to call `clearPortrait()`.

---

## Simultaneous asset loading

The pattern for showing background + sprite + portrait all at the same instant:

```
Event stream:
  load_image han_bg15     → drawBackground() → Promise pushed to pendingLoads[]
  load_image han_khk01    → drawSprite()     → Promise pushed to pendingLoads[]
  load_image han_ski01f   → setPortrait()    → Promise pushed to pendingLoads[]
  text "..."              → Promise.all(pendingLoads)
                            → renderTextbox()
                            → showText()
```

All asset loads run in parallel; the dialogue only appears once all three resolve.

---

## Canvas compositing (`compositeToCanvas`)

Signature:
```js
async function compositeToCanvas(srcUrl, maskUrl, dstW, dstH, srcCropW?, srcCropH?)
```

Algorithm:
1. Load `srcUrl` and `maskUrl` in parallel via the image cache (`loadImg`).
2. Draw the source into an offscreen canvas at the destination size (with optional source crop).
3. Read pixel data with `getImageData`.
4. Draw the mask into a second offscreen canvas at the same size.
5. For each pixel `i`: `src.data[i+3] = mask.data[i]` (R-channel of mask → alpha).
6. Write back with `putImageData`.
7. Return the offscreen canvas.

All `loadImg` calls are cached by URL, so repeated calls (e.g., every dialogue frame re-rendering the same textwins.jpg) do not re-fetch.

---

## Text colour system

`color_fade` events carry `r, g, b` fields that define the next dialogue text colour:

| Colour | Usage |
|--------|-------|
| `rgb(0, 255, 0)` green | Narrator / title cards |
| `rgb(255, 255, 255)` white | Normal dialogue |
| `rgb(100, 160, 240)` blue | Internal monologue / thoughts |

The colour is stored in `nextTextColor` and applied to `#dialogue-text` when `showText()` is called. It resets to `#e8eeff` (off-white) after each text advance.

---

## Dialogue frame selection

| `hasPortrait` | Frame | Canvas x | Text area |
|--------------|-------|----------|-----------|
| `true` | `assets/ui/textwins.jpg` (470×150, right decorative border) | x = 170 | left: 188px, right: 18px, left-aligned |
| `false` | `assets/sprites/textwinc.jpg` (620×150, both borders, stretched to 640) | x = 0 | left: 30px, right: 30px, centered |

Each frame image has a paired grayscale mask (`*_.jpg` in `assets/sprites/`) whose R-channel is applied as alpha to make the frame semi-transparent.

---

## Audio

- **BGM**: `<Audio>` element, loop = true, volume = 0.45. Started by `load_bgm` events.
- **SFX**: Throw-away `new Audio(…).play()` calls, one per `play_sound` event.
- BGM is stopped in `backToMenu()`.

---

## Known limitations / future work

| Area | Status |
|------|--------|
| Video playback | MPG files not browser-compatible; needs ffmpeg conversion + `<video>` integration |
| Save / Load | Not implemented |
| `set_flag` / branching flags | Events parsed but values not tracked |
| Translation UI | `translation/` directory exists; `reinsert_text.py` does reinsertion but no in-browser UI |
| `load_ui mind` | `mind.jpg` is a 640×480 thought overlay — not yet rendered |
