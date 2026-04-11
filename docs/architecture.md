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
z-index  4  #portrait-canvas      168×200  Face portrait
z-index  2  #sprite-canvas        640×480  Full-body character sprites
z-index  1  #bg-canvas            640×480  Background images
```

### Why a separate portrait canvas?

The portrait canvas is intentionally **200 px tall** while the textbox frame is **150 px tall**. Both are bottom-anchored (`bottom: 0`). This makes the top 50 px of the portrait canvas extend above the frame, giving the "character head pokes above the dialogue box" look of the original game.

The portrait canvas has `z-index: 4` (above sprites, below textbox). The left 168 px of the textbox canvas are always **transparent** (no frame drawn there), so the portrait shows through correctly.

### Portrait canvas visibility

`#portrait-canvas` visibility is kept in sync with `#textbox` at all times:
- `renderTextbox()` sets `portCanvas.style.display = ''` (character mode) or `'none'` (narrator mode).
- The click-advance handler sets `portCanvas.style.display = 'none'` together with hiding `#textbox`.
- `clearPortrait()` also sets `display: none`.

The **portrait state** (`hasPortrait`, `currentPortrait`) is intentionally **not** cleared on text-advance. It persists so the next text event from the same speaker can restore the portrait without a new `load_image`. State is cleared only when `textwinc`/`mind` loads or on script/scene reset.

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
- `text` — dialogue line is displayed; clicking hides `#textbox` and `#portrait-canvas` but does **not** call `clearPortrait()`. Portrait state is preserved for the next line.
- `wait_click` — scene setup pause; clicking advances with no visual change.

The `waitSource` string (`'text'` or `'wait_click'`) is checked in the click handler.

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
| `true` | `assets/ui/textwins.jpg` (472×150, right decorative border) | x = 168 | left: 188px, right: 18px, left-aligned |
| `false` | `assets/sprites/textwinc.jpg` (620×150, both borders, stretched to 640) | x = 0 | left: 30px, right: 30px, centered |

Each frame image has a paired grayscale mask (`*_.jpg` in `assets/sprites/`) whose R-channel is applied as alpha to make the frame semi-transparent.

---

## Audio

- **BGM**: `<Audio>` element, loop = true, volume = 0.45. Started by `load_bgm` events.
- **SFX**: Throw-away `new Audio(…).play()` calls, one per `play_sound` event.
- BGM is stopped in `backToMenu()`.

---

## Simplified Chinese translation

Each `text` event in `webapp/scripts/*.json` may carry an optional `zh` field:

```json
{ "op": "text", "jp": "…", "text": "…", "zh": "…", "offset": 123 }
```

`showText(text, jp, zh)` selects the field to display based on `currentLang`:
- `cn` → `zh` (if present and non-empty), else `jp`
- `en` → `text` (if differs from `jp`), else `jp`
- `jp` → `jp`

### Formatting codes in zh

The PSG engine embeds control codes inside dialogue strings. These are stripped by `showText()` before display but must be **preserved** in the `zh` field so the engine's stripping logic works consistently:

| Code | Meaning | In zh field |
|------|---------|-------------|
| `\x07` | In-text page-break / bell | Keep as `\x07` (not `x07`) |
| `!s` | Centre-align tag | Keep as `!s` |
| `@` | Text pause | Keep as `@` |

The translation tool (`tools/translate_zh.py`) uses placeholder substitution to protect these codes during API calls.

### Garbage filter

`text` events whose `jp` field contains binary extraction artifacts (null bytes, replacement chars, etc.) are silently skipped. **`\x07` is explicitly stripped before this test** to avoid false positives — ~31% of all dialogue events contain `\x07`.

---

## Known limitations / future work

| Area | Status |
|------|--------|
| Video playback | MPG files not browser-compatible; needs ffmpeg conversion + `<video>` integration |
| Save / Load | Not implemented |
| `set_flag` / branching flags | Events parsed but values not tracked |
| `load_ui mind` | `mind.jpg` is a 640×480 thought overlay — not yet rendered |
