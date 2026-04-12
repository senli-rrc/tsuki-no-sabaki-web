# Game Binary Format & Extraction Notes

## Game info

| Field | Value |
|-------|-------|
| Title | 月ノ裁き (*Tsuki no Sabaki* / "Judgment of the Moon") |
| Developer | PsG System Laboratory |
| Year | 2004 |
| Platform | Windows PC (CD-ROM) |
| Engine | Proprietary PSG engine |
| Disc format | CCD/IMG (CloneCD) — `月ノ裁.img` + `月ノ裁.sub` + `月ノ裁.cue` |

---

## Disc structure

The disc contains one data track. After mounting / converting with `bchunk`, the game folder contains:

```
game/
└── Program_Executable_Files/
    ├── *.exe           Game executable
    ├── *.dll           Engine DLLs
    ├── bg/             Background images (raw, possibly compressed)
    ├── sprite/         Character sprites
    ├── bgm/            Music
    ├── se/             Sound effects
    ├── scenario/       Binary script files
    └── …
```

The extracted files live at:
```
extracted/game/Program_Executable_Files/data/*.scr   ← binary scripts (already present)
```
`tools/build_webapp.py` reads from this path directly (`GAME_DIR = BASE / "extracted/game/Program_Executable_Files"`).

---

## Script format (binary → JSON)

### Original format

Game scripts are stored as binary files in `extracted/game/scenario/`. The PSG engine uses a custom bytecode format. Key opcodes decoded by `tools/extract_text.py`:

| Opcode (hex) | JSON `op` | Description |
|-------------|-----------|-------------|
| `01` / `02` | `text` | Dialogue/narration line; followed by UTF-16LE string |
| `10` | `load_image` | Load a graphic resource by name |
| `11` | `load_ui` | Load a UI overlay |
| `12` | `set_layer` | Set the draw layer (0 = background, 1 = foreground, etc.) |
| `20` | `fade` | Fade in/out with duration |
| `21` | `color_fade` | Coloured flash + set text colour (R, G, B fields) |
| `30` | `load_bgm` | Start background music |
| `31` | `play_sound` | Play sound effect |
| `40` | `wait` | Delay (frame count) |
| `41` | `wait_click` | Wait for player click (scene-setup pause) |
| `50` | `set_flag` | Set a game flag variable |
| `60` (`0x23 0x04`) | `choice_begin` | Show branch choice menu; followed by choice strings + jump targets |
| `70` | `goto_script` | Jump to another script file |

### Extracted JSON format

`tools/extract_text.py` writes each script as `webapp/scripts/<name>.json`:

```json
{
  "events": [
    { "op": "load_image", "name": "han_bg15" },
    { "op": "fade", "duration": 1000, "flag": 1 },
    { "op": "color_fade", "mode": 1, "r": 0, "g": 255, "b": 0, "val": 28674 },
    {
      "op": "text",
      "jp": "８月１１日　午後３時２８分\n琥珀堂法律事務所\n",
      "text": "８月１１日　午後３時２８分\n琥珀堂法律事務所\n",
      "offset": 413
    }
  ]
}
```

Fields:
- `jp` — original Japanese text
- `text` — translated text (copy of `jp` until translated)
- `offset` — byte offset in the original binary; used as a stable key in `translation/strings.json`

---

## Asset format

### Images

All images are JPEG. Transparent regions are encoded as a **paired grayscale mask** file (same name + `_` suffix, e.g., `han_ski01.jpg` + `han_ski01_.jpg`).

The mask encodes alpha via its **R channel** (not luminance): pixel R=255 → fully opaque, R=0 → fully transparent.

This is a non-standard convention specific to the PSG engine. The web player replicates it with `compositeToCanvas()` in `engine.js`.

### Face portraits

| Property | Value |
|----------|-------|
| Dimensions | 150 × 200 px |
| Naming | `han_*f.jpg` + `han_*f_.jpg` |
| Content | Top ~30 rows are transparent (mask R≈0); face starts at row ~40 |
| Display size | 165 × 200 px (stretched into portrait-canvas) |

### Full-body sprites

| Property | Value |
|----------|-------|
| Dimensions | 256–512 × 480 px (varies by character) |
| Naming | `han_*.jpg` + `han_*_.jpg` (no `f` suffix) |
| Positioning | Horizontally centred; bottom-aligned to canvas bottom (y = 480 − height) |

### Dialogue frames

| File | Dimensions | Description |
|------|-----------|-------------|
| `assets/ui/textwins.jpg` | 470 × 150 | Frame used when a character portrait is present (right decorative border) |
| `assets/sprites/textwins_.jpg` | 470 × 150 | Alpha mask for textwins |
| `assets/sprites/textwinc.jpg` | 620 × 150 | Frame used for narrator/title cards (both borders); stretched to 640 px in engine |
| `assets/sprites/textwinc_.jpg` | 620 × 150 | Alpha mask for textwinc |
| `assets/sprites/l_wins.jpg` | 470 × 150 | Alternate frame (left border only); not used in current engine |
| `assets/sprites/l_wins_.jpg` | 470 × 150 | Alpha mask for l_wins |

### Audio

- BGM: MPEG Audio (`.mp3`), 15 tracks, ~87 MB total
- SFX: PCM WAV (`.wav`), 43 files, ~8 MB total

### Video

Four MPEG-1 (`.mpg`) cutscene files:

| File | Description |
|------|-------------|
| `han_mov01.mpg` | Opening movie |
| `han_ski01m.mpg` | Character scene (Shiki) |
| `han_akh01m.mpg` | Character scene (Akane) |
| `ending.mpg` | Ending credits |

MPEG-1 is not supported natively in modern browsers. Convert with:
```bash
ffmpeg -i input.mpg -c:v libx264 -crf 23 -c:a aac output.mp4
```

---

## Translation workflow

1. **Extract**: `python tools/extract_text.py` — reads binary scripts, writes `translation/strings.json` and `webapp/scripts/*.json`
2. **Translate**: Edit `translation/strings.json`; each entry is keyed by `offset` with `jp` (source) and `en` (translation) fields
3. **Reinsert**: `python tools/reinsert_text.py` — reads `translation/strings.json`, writes updated `webapp/scripts/*.json` with `text` field populated

The web engine uses the `text` field when Language is set to a non-JP option; it falls back to `jp` if `text` is absent or identical.

---

## Script file map

| Script | Chapter / Scene |
|--------|----------------|
| `main.json`, `main2.json` | Title / opening |
| `akane.json` → `haruka.json` → `mitsuki.json` | Chapter 1 — 月ノ裁き (linked via goto_script) |
| `s02_01` – `s02_11`, `s02_20` – `s02_27` | Chapter 2 — 反転姉妹 |
| `s03_01` – `s03_06` | Chapter 3 — 反転、そしてサヨナラ |
| `gameover.json` | Bad ending |
| `karen.json`, `sakuya.json`, `ciel.json` | Character-specific sub-routes |

---

## Known extraction gaps

### Trailing garbage events
Near the end of `akane.scr`, `haruka.scr`, and `mitsuki.scr` the extractor misidentifies non-dialogue binary data (jump tables, alignment padding) as text events. These produce garbled characters like `弖`, `鏃`, `б`. They are either caught by the garbage filter (if they contain bytes in `[\x00-\x08]`) or displayed briefly at the very end of the script. They do not affect normal playthrough since the scripts end via `goto_script` before reaching them.

### choice_begin — missing choice text
The `choice_begin` opcode (`0x23 0x04`) is detected, but `build_webapp.py` only advances 4 bytes past it without parsing the choice strings and jump targets that follow. As a result most `choice_begin` events in the JSON have no `choices` array. `akane.json` is an exception — it was previously fixed manually.

To fix: inspect the bytes immediately after `0x23 0x04` in a `.scr` file (e.g. `karen.scr` which has 27 choice points) to determine the choice entry format (likely: count byte, then N × [Shift-JIS string + 4-byte jump offset]), then update `decode_script()` in `build_webapp.py` accordingly. The `.scr` source files are at:
```
extracted/game/Program_Executable_Files/data/*.scr
```
