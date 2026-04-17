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

No build step. Edit source files and hard-refresh the browser (`Cmd+Shift+R`).

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
│   │   ├── akane.json         # Chapter 1, part 1
│   │   ├── haruka.json        # Chapter 1, part 2
│   │   ├── mitsuki.json       # Chapter 1, part 3 (final — triggers chapter select on end)
│   │   ├── s02_01.json        # Chapter 2 start
│   │   ├── s02_27.json        # Chapter 2 final (triggers chapter select on end)
│   │   ├── s03_01.json        # Chapter 3 start
│   │   ├── s03_06.json        # Chapter 3 final (triggers chapter select on end)
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
│   ├── translate_zh.py        # JP → Simplified Chinese translation via AI API
│   ├── reinsert_text.py       # Writes translated text back into JSON scripts
│   └── build_webapp.py        # Orchestrates the full extraction → webapp pipeline
├── extracted/                 # ⚠ NOT in git — original game files extracted from disc image
│   └── game/
│       └── Program_Executable_Files/
│           └── data/          # Binary script files (.scr) — source for build_webapp.py
│               ├── akane.scr
│               ├── haruka.scr
│               └── …          # one .scr per script, same names as webapp/scripts/*.json
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
| 3 | `#item-canvas` 640×480 | Full-screen item overlays (han_item*) |
| 4 | `#portrait-canvas` 168×200 | Face portrait — taller than frame so head overflows above |
| 5 | `#textbox` div | Contains frame canvas + dialogue text overlay |
| 10 | `#fade-overlay` | Black fade between scenes |
| 20 | `#choice-menu` | Branch choice buttons |
| 28 | `#coat-menu` | Right-click action menu |
| 29 | `#evidence-book` | Evidence / character book overlay |

### Event loop
Events are processed synchronously in `execute()`. Async events (`text`, `fade`, `wait`, `wait_click`) break the loop and resume on user input or timeout.

**Critical: `wait_click` vs `text`**
`wait_click` is a *scene-setup* pause (sprite swap, portrait load) that must NOT clear the portrait. Advancing a `text` event hides `#portrait-canvas` and `#textbox` but does **not** call `clearPortrait()` — portrait state (`hasPortrait`, `currentPortrait`) is preserved so the next line from the same speaker restores it.

`clearPortrait()` is called:
- When `textwinc` or `mind` is loaded (narrator mode)
- At the **start of `drawBackground()`** — every scene change clears the previous portrait so stale face images never bleed into new scenes
- On script/scene reset

This is tracked via `waitSource = 'text' | 'wait_click'`.

### Simultaneous asset loading
All `load_image` calls push a Promise to `pendingLoads[]`. When a `text` event is hit, `Promise.all(pendingLoads)` is awaited before rendering — background, sprite, and portrait all appear at the same frame.

### Image compositing
`compositeToCanvas(src, mask, dstW, dstH)` — R-channel of the `*_.jpg` grayscale mask becomes the alpha channel of the destination canvas. Used for sprites, face portraits, and the textbox frame.

### Text colour
`color_fade` events set `nextTextColor` (an `rgb(…)` string). On the next `text` event `dialogueEl.style.color` is applied. Green = narrator/title card, white = dialogue, blue-ish = internal monologue.

### Chapter endings
When the final script of a chapter reaches end-of-events, the engine calls `window._showChapterSelect()` after 800 ms so the player can start the next chapter:

| Terminal script | Chapter |
|----------------|---------|
| `mitsuki` | Chapter 1 — 月ノ裁き |
| `s02_27` | Chapter 2 — 反転姉妹 |
| `s03_06` | Chapter 3 — 反転、そしてサヨナラ |

---

## Dialogue frame layout

| State | Frame image | Frame x | Portrait canvas |
|-------|-------------|---------|-----------------|
| Character speaking | `assets/ui/textwins.jpg` (472×150) | x = 168 | Rendered (168×200), visible |
| Narrator / title card | `assets/sprites/textwinc.jpg` (620×150) | x = 0, stretched to 640 | Hidden (`display:none`) |

Face portraits (`han_*f.jpg`, 150×200) are drawn full-height into the 168×200 portrait canvas. Because the canvas is 200 px tall but the frame is only 150 px tall (both bottom-anchored), the top 50 px of the portrait shows above the frame.

`#portrait-canvas` visibility is always in sync with `#textbox`: both hidden between lines, both shown by `renderTextbox()`. The portrait canvas is never visible without an accompanying dialogue frame.

---

## PSG formatting codes

`showText()` strips all PSG engine control codes before display:

| Code | Meaning | Treatment |
|------|---------|-----------|
| `\x07` | In-text page-break / bell | Stripped before garbage test AND before display |
| `!s` | Centre-align tag | Stripped before display |
| `@` | Text pause marker | Stripped before display |

**Critical:** never add `\x07` to the garbage-character filter — ~31% of all dialogue events contain it and it falls in `[\x00-\x08]`. Strip it *before* the test.

---

## Evidence system

`color_fade val=853009` activates evidence-presentation mode:
1. Sets `evidenceSelectPending = true`, shows amber hint bar
2. Computes `evidenceCorrectCursor` (past all wrong-answer `jump` events within 500 events)
3. When the subsequent instruction `text` event is dismissed, the engine **stays suspended** (does not call `execute()`), updating `evidenceCorrectCursor` to point right after the instruction text
4. Player opens evidence book → selects item → clicks **つきつける** (top-right of detail page) → `presentEvidence()` → script advances

The `#ev-present-btn` HTML overlay is positioned at `left:349px; top:4px; width:185px; height:62px` to cover the つきつける button printed on the book artwork. It is shown whenever `evidenceSelectPending` is true, for both ch1 and ch2 scripts.

---

## Player UX features (Phase 1–3)

### Settings (`Settings` module, IIFE)
Persisted in `localStorage['tsuki.settings.v1']`. Keys: `textSpeed` (ms/char, `0` = instant), `bgmVolume`, `seVolume`, `muted`, `fontSize` (px), `autoAdvanceDelay`. Panel: `#settings-panel` (opened from main menu "Option", pause menu, or `Esc`). `Settings.applyAll()` re-applies settings (font size now; audio on next `playBGM`/`playSound`).

### Save / Load (`Saves` module)
8 slots in `localStorage['tsuki.save.v1.<id>']` where `id ∈ {auto, quick, 1-6}`. Shape: `{scriptName, cursor, evidenceInventory, lang, timestamp, thumbnail, preview}`. Saves are only allowed when `canSave()` is true (`waitingClick && waitSource==='text' && !evidenceSelectPending`) — this guarantees the saved cursor points AT a dismissible text event. Load uses `fastForwardTo(cursor)` to replay state ops (`load_image`, `load_ui`, `set_layer`, `color_fade`, `load_bgm`) from event 0 up to the cursor, draining `pendingLoads` at each text/`wait_click` boundary; user-interactive ops (`text`, `choice`, `wait`, `fade`) are skipped. Panel: `#saveload-panel` (load from main menu, save/load from pause menu).

### Pause menu
Modal `#pause-menu` (Save / Load / Log / Settings / Main-Menu / Resume), opened with `Esc` in-game. Engine's `keydown` handler checks for any open modal (`#settings-panel`, `#pause-menu`, `#saveload-panel`, `#backlog-panel`) and returns early — modals swallow Space/Enter/S/A/B/1.

### Backlog (ring buffer, `BACKLOG_MAX=200`)
Every `text` event pushes `{script, idx, jp, text, zh, color}` to the ring buffer. Dedup on consecutive identical entries. Opened with `B` key, scroll-wheel-up on `#game-container`, or pause menu → Log. Panel: `#backlog-panel`, renders per-entry language-aware text via `pickBacklogText(entry, lang)`.

### Auto-advance
`A` key toggles. `scheduleAutoAdvance(source)` sets a timer after each line is fully rendered:
- `source === 'text'` → `AUTO_ADVANCE_DELAY` (1800 ms)
- `source === 'wait_click'` → 400 ms (scene-setup pauses should flow)
- `skipping` → `SKIP_DELAY` (40 ms)

Cancelled by `cancelAutoAdvance()` on any user click, modal open, or `evidenceSelectPending`.

### Skip modes
`S` = skip-read (stops on any line not in `Visited`); `Shift+S` = skip-all. `Visited` module tracks `{script, idx}` pairs in `localStorage['tsuki.visited.v1']` with 600 ms debounced flush + `beforeunload` flush. Every text render calls `Visited.mark(script, idx)`. Status line shows `[⏭ SKIP]`, `[⏭ SKIP-ALL]`, `[▶ AUTO]` tags.

### Keybindings
| Key | Action |
|-----|--------|
| Click / Space / Enter | Advance text |
| `Esc` | Pause menu in-game, close modal otherwise |
| `S` | Toggle skip-read |
| `Shift+S` | Toggle skip-all |
| `A` | Toggle auto-advance |
| `B` | Toggle backlog |
| `1` / Right-click | Coat menu |
| Scroll-wheel up (on game) | Open backlog |

### Public API (`window.VN`)
- `VN.settings` — Settings module
- `VN.saves` — Saves module (incl. `canSave()`, `save(slot)`, `load(slot)`, `list()`, `delete(slot)`)
- `VN.visited` — Visited module
- `VN.getBacklog()` — copy of ring buffer
- `VN.setAutoAdvance(bool)` / `VN.isAutoAdvance()`
- `VN.restart()` — reload current script from event 0

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
| `color_fade` | `mode`, `r`, `g`, `b`, `val` | Sets next text colour; `val=853009` = evidence-present signal |
| `load_bgm` | `file` | Start looping BGM |
| `play_sound` | `file` | One-shot SFX |
| `wait` | `frames` | Timed pause (frames × 16 ms) |
| `choice_begin` | `choices[]` | Branch menu |
| `goto_script` | `target` | Load another script (preserves evidenceInventory) |
| `jump` | `target` | Wrong-answer retry jump (only fires while evidenceSelectPending) |
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

### Use an alternative translation API (OpenAI-compatible)
To use OpenRouter, DeepSeek, Alibaba Qwen, or any OpenAI-compatible endpoint, replace the client section in `tools/translate_zh.py`:

```python
import openai
client = openai.OpenAI(api_key=api_key, base_url="https://<platform>/v1")
# In translate_batch():
response = client.chat.completions.create(
    model=MODEL,
    max_tokens=MAX_TOKENS,
    messages=[
        {"role": "system", "content": SYSTEM_PROMPT},
        {"role": "user",   "content": user_msg},
    ],
)
raw = response.choices[0].message.content
```

### Add a translated line (legacy English path)
Edit `translation/strings.json` (keyed by `offset`), then run `tools/reinsert_text.py` to regenerate the affected `scripts/*.json` file.

### Convert MPG videos to browser-compatible MP4
```bash
ffmpeg -i webapp/assets/video/han_mov01.mpg -c:v libx264 -crf 23 \
       -c:a aac webapp/assets/video/han_mov01.mp4
```

### Re-run the extraction pipeline
Binary `.scr` source files are already present at:
```
extracted/game/Program_Executable_Files/data/*.scr
```
To regenerate all `webapp/scripts/*.json` from them:
```bash
python3 tools/build_webapp.py
```
See `docs/setup.md` if starting from scratch (requires original disc image).

---

## Do / Don't

- **Do** edit `engine.js` and `index.html` directly — no build step.
- **Do** use `compositeToCanvas()` for any image+mask pair; it is cached.
- **Don't** commit `webapp/assets/` — those are binary files totalling ~281 MB.
- **Don't** call `clearPortrait()` on text-advance — portrait state must persist across consecutive lines from the same speaker. It IS called in `drawBackground()` (scene change) and when `textwinc`/`mind` loads.
- **Don't** add `\x07` to the garbage-character filter — it is a legitimate PSG in-text page-break used in ~31% of all dialogue events. Strip it in pre-processing before the regex test.
- **Don't** place `#vn-tooltip` after the `<script>` tags — the element must exist in the DOM before `engine.js` runs so `getElementById('vn-tooltip')` resolves correctly.
- **Don't** push `extracted/` or `*.img` disc images.
