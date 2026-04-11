# CLAUDE.md — Tsuki no Sabaki Web VN Player

This file tells Claude Code how to work in this repository.

---

## Project in one sentence
A browser-based Visual Novel player for *Tsuki no Sabaki* (月ノ裁き, PsG System Laboratory, 2004) that reads extracted JSON scripts and composites game assets with a hand-written JS engine — no external VN framework.

---

## Quick start

```bash
node webapp/server.js          # serves on http://localhost:8765
```

No build step. Edit source files and hard-refresh the browser.

---

## Repository layout

```
.
├── webapp/                    # Everything the browser loads
│   ├── index.html             # Single-page app; three screens: menu / chapter-select / game
│   ├── server.js              # Tiny static Node.js file server
│   ├── engine/
│   │   └── engine.js          # VN engine (event loop, canvas compositor, audio)
│   ├── scripts/               # Extracted dialogue scripts (JSON, one per game scene)
│   │   ├── s02_01.json        # Chapter 1 start
│   │   ├── s02_20.json        # Chapter 2 start
│   │   └── …
│   ├── assets/                # ⚠ NOT in git — see docs/setup.md
│   │   ├── bg/                # Background images  (.jpg)
│   │   ├── sprites/           # Character sprites + face portraits + masks (.jpg)
│   │   ├── ui/                # Menu / HUD images (.jpg)
│   │   ├── bgm/               # Background music (.mp3)
│   │   ├── se/                # Sound effects (.wav)
│   │   └── video/             # Cutscene video (.mpg — browser-incompatible; needs conversion)
│   └── translation/           # (empty) placeholder for future translated scripts
├── tools/
│   ├── extract_text.py        # Dumps dialogue from raw game binary → strings.json
│   ├── reinsert_text.py       # Writes translated text back into JSON scripts
│   └── build_webapp.py        # Orchestrates the full extraction → webapp pipeline
├── translation/
│   └── strings.json           # 14 723-line source/translation table (JP original + EN placeholder)
└── docs/
    ├── setup.md               # Asset acquisition & project bootstrap guide
    ├── architecture.md        # Engine design, canvas stack, event format
    └── game-format.md         # Original game binary format & extraction notes
```

---

## Engine architecture (engine.js)

### Canvas stack (bottom → top)
| z-index | Element | Purpose |
|---------|---------|---------|
| 1 | `#bg-canvas` 640×480 | Background images |
| 2 | `#sprite-canvas` 640×480 | Full-body character sprites (mask-composited) |
| 4 | `#portrait-canvas` 168×200 | Face portrait — taller than frame so head overflows above |
| 5 | `#textbox` div | Contains frame canvas + dialogue text overlay |
| 10 | `#fade-overlay` | Black fade between scenes |
| 20 | `#choice-menu` | Branch choice buttons |

### Event loop
Events are processed synchronously in `execute()`. Async events (`text`, `fade`, `wait`, `wait_click`) break the loop and resume on user input or timeout.

**Critical: `wait_click` vs `text`**
`wait_click` is a *scene-setup* pause (sprite swap, portrait load) that must NOT clear the portrait. Advancing a `text` event hides `#portrait-canvas` and `#textbox` but does **not** call `clearPortrait()` — portrait state (`hasPortrait`, `currentPortrait`) is preserved so the next line from the same speaker restores it. `clearPortrait()` is called only when `textwinc` or `mind` is loaded (narrator mode) or on scene/script reset. This is tracked via `waitSource = 'text' | 'wait_click'`.

### Simultaneous asset loading
All `load_image` calls push a Promise to `pendingLoads[]`. When a `text` event is hit, `Promise.all(pendingLoads)` is awaited before rendering — background, sprite, and portrait all appear at the same frame.

### Image compositing
`compositeToCanvas(src, mask, dstW, dstH)` — R-channel of the `*_.jpg` grayscale mask becomes the alpha channel of the destination canvas. Used for sprites, face portraits, and the textbox frame.

### Text colour
`color_fade` events set `nextTextColor` (an `rgb(…)` string). On the next `text` event `dialogueEl.style.color` is applied. Green = narrator/title card, white = dialogue, blue-ish = internal monologue.

---

## Dialogue frame layout

| State | Frame image | Frame x | Portrait canvas |
|-------|-------------|---------|-----------------|
| Character speaking | `assets/ui/textwins.jpg` (472×150) | x = 168 | Rendered (168×200), visible |
| Narrator / title card | `assets/sprites/textwinc.jpg` (620×150) | x = 0, stretched to 640 | Hidden (`display:none`) |

Face portraits (`han_*f.jpg`, 150×200) are drawn full-height into the 168×200 portrait canvas. Because the canvas is 200 px tall but the frame is only 150 px tall (both bottom-anchored), the top 50 px of the portrait shows above the frame.

`#portrait-canvas` visibility is always in sync with `#textbox`: both hidden between lines, both shown by `renderTextbox()`. The portrait canvas is never visible without an accompanying dialogue frame.

---

## Asset naming conventions

| Prefix | Location | Description |
|--------|----------|-------------|
| `han_bg*` | `assets/bg/` | Background scene image |
| `han_*` (no suffix) | `assets/sprites/` | Full-body character sprite |
| `han_*_` | `assets/sprites/` | Alpha mask for the sprite above |
| `han_*f` | `assets/sprites/` | Face portrait (150×200 px) |
| `han_*f_` | `assets/sprites/` | Alpha mask for the portrait above |
| `textwins` | `assets/ui/` | Dialogue frame — WITH portrait (right border) |
| `textwins_` | `assets/sprites/` | Mask for textwins |
| `textwinc` | `assets/sprites/` | Dialogue frame — NO portrait (both borders) |
| `textwinc_` | `assets/sprites/` | Mask for textwinc |

---

## JSON script event reference

Each `scripts/*.json` file has an `{ "events": [...] }` array. Key event types:

| `op` | Fields | Notes |
|------|--------|-------|
| `text` | `jp`, `text`, `zh`, `offset` | Show dialogue; awaits pendingLoads first. `zh` = Simplified Chinese translation (optional) |
| `load_image` | `name` | Dispatches to bg / sprite / portrait / ignore |
| `load_ui` | `name` | Currently ignored (frame handled by renderTextbox) |
| `wait_click` | — | Scene-setup pause; does NOT clear portrait |
| `fade` | `duration`, `flag` | Screen fade in/out |
| `color_fade` | `mode`, `r`, `g`, `b`, `val` | Sets next text colour |
| `load_bgm` | `file` | Start looping BGM |
| `play_sound` | `file` | One-shot SFX |
| `wait` | `frames` | Timed pause (frames × 16 ms) |
| `choice_begin` | `choices[]` | Branch menu |
| `goto_script` | `target` | Load another script |
| `set_layer` | `layer` | Currently tracked but not rendered |
| `set_flag` | `flag`, `value` | Currently ignored |

---

## Common development tasks

### Add / update a Chinese translation
`zh` fields are stored directly in each `webapp/scripts/*.json` event. To (re-)translate using Claude Haiku:

```bash
export ANTHROPIC_API_KEY=sk-ant-...

# Translate all scripts (skips already-translated lines)
python3 tools/translate_zh.py

# Translate specific scripts only
python3 tools/translate_zh.py --scripts s02_01 s02_02

# Re-translate lines that already have zh (e.g. to fix quality)
python3 tools/translate_zh.py --scripts s02_01 --force

# Preview without calling the API
python3 tools/translate_zh.py --dry-run
```

Formatting codes (`\x07`, `!s`, `@`) are protected by placeholder substitution during translation and restored afterwards. Cost: ~$1–2 for the full 16 000-line corpus with Haiku.

### Add a translated line (legacy English path)
Edit `translation/strings.json` (keyed by `offset`), then run `tools/reinsert_text.py` to regenerate the affected `scripts/*.json` file.

### Convert MPG videos to browser-compatible MP4
```bash
ffmpeg -i webapp/assets/video/han_mov01.mpg -c:v libx264 -crf 23 \
       -c:a aac webapp/assets/video/han_mov01.mp4
```

### Run the extraction pipeline from scratch
See `docs/setup.md` — requires original disc image and the Python tools.

---

## Do / Don't

- **Do** edit `engine.js` and `index.html` directly — no build step.
- **Do** use `compositeToCanvas()` for any image+mask pair; it is cached.
- **Don't** commit `webapp/assets/` — those are binary files totalling ~281 MB.
- **Don't** call `clearPortrait()` on text-advance — portrait state must persist across consecutive lines from the same speaker. Call it only when `textwinc`/`mind` loads or on script/scene reset.
- **Don't** add `\x07` to the garbage-character filter — it is a legitimate PSG in-text page-break used in ~31% of all dialogue events. Strip it in pre-processing before the regex test.
- **Don't** push `extracted/` or `*.img` disc images.
