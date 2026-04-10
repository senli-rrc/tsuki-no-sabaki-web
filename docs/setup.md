# Setup Guide

This guide walks through bootstrapping the project from scratch — from the original disc image to a running web VN player.

---

## Prerequisites

| Tool | Version tested | Install |
|------|---------------|---------|
| Node.js | ≥ 18 | https://nodejs.org |
| Python | ≥ 3.10 | https://python.org |
| Python packages | — | `pip install Pillow numpy` |
| ffmpeg | any | `brew install ffmpeg` (macOS) |
| cdemu / bchunk | any | for disc-image mounting (Linux/macOS) |

---

## Step 1 — Clone the repository

```bash
git clone https://github.com/senli-rrc/tsuki-no-sabaki-web.git
cd tsuki-no-sabaki-web
```

---

## Step 2 — Obtain the original game disc

The game files are **not** included in this repository for copyright reasons.

You need one of:
- `月ノ裁.img` + `月ノ裁.sub` + `月ノ裁.cue` — original disc dump (CloneCD format)
- An ISO extracted from the above

Mount / extract the disc:

```bash
# macOS — convert CCD/IMG to ISO with bchunk
brew install bchunk
bchunk 月ノ裁.img 月ノ裁.cue 月ノ裁

# The above writes 月ノ裁01.iso (data track)
mv 月ノ裁01.iso extracted/tsuki.iso

# Mount and copy the game folder
hdiutil attach extracted/tsuki.iso -mountpoint /Volumes/TsukiDisc
cp -r /Volumes/TsukiDisc/. extracted/game/
hdiutil detach /Volumes/TsukiDisc
```

---

## Step 3 — Extract scripts and assets

```bash
python tools/build_webapp.py
```

This script:
1. Reads the original game binary from `extracted/game/`
2. Extracts all dialogue scripts → `webapp/scripts/*.json`
3. Copies image/audio assets into `webapp/assets/`
4. Produces a dialogue string table at `translation/strings.json`

After this step `webapp/assets/` will be populated (~281 MB).

---

## Step 4 — Convert video files (optional)

The four cutscene files are MPEG-1 (`.mpg`), which most browsers refuse to play.
Convert them to H.264 MP4:

```bash
for f in webapp/assets/video/*.mpg; do
  ffmpeg -i "$f" -c:v libx264 -crf 23 -c:a aac "${f%.mpg}.mp4"
done
```

The engine currently does not play these videos — this is future work.

---

## Step 5 — Start the dev server

```bash
node webapp/server.js
# → Listening on http://localhost:8765
```

Open `http://localhost:8765` in any modern browser (Chrome / Edge / Firefox).

---

## Asset directory reference

After extraction, `webapp/assets/` has this layout:

```
assets/
├── bg/         76 JPG files  ~12 MB   Background scenes
├── sprites/  1469 JPG files ~104 MB   Character sprites, face portraits, masks, UI frames
├── ui/          50 JPG files   ~4 MB   Menu / HUD images
├── bgm/         15 MP3 files  ~87 MB   Background music
├── se/          43 WAV files   ~8 MB   Sound effects
└── video/        4 MPG files  ~65 MB   Cutscene video (needs conversion, see above)
```

Total: ~281 MB — excluded from git via `.gitignore`.
