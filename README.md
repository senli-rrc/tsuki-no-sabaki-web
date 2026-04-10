# Tsuki no Sabaki — Web VN Player

Browser-based player for *月ノ裁き* (*Tsuki no Sabaki*, PsG System Laboratory, 2004), built with vanilla HTML5 Canvas and a custom JavaScript engine. No VN framework, no build step.

> **Note:** Game assets (images, audio, video) are not included in this repository. See [docs/setup.md](docs/setup.md) for acquisition instructions.

---

## Quick start

```bash
git clone https://github.com/senli-rrc/tsuki-no-sabaki-web.git
cd tsuki-no-sabaki-web

# (One-time) extract assets from original disc image — see docs/setup.md
python tools/build_webapp.py

# Start the dev server
node webapp/server.js
# → http://localhost:8765
```

---

## Features

- **Main menu** — `han_t_02_off.jpg` with Start / Load / Option / Exit
- **Chapter select** — three story chapters
- **Simultaneous asset loading** — background, sprite, and portrait all render together
- **Mask-based alpha compositing** — original PSG engine's `*_.jpg` greyscale-mask convention replicated in canvas
- **Portrait overflow** — face portrait (165×200 px) pokes 50 px above the 150 px dialogue frame
- **Text colour** — `color_fade` events drive narrator green / dialogue white / thought blue
- **Full-width narrator frame** — `textwinc.jpg` used when no character portrait is active
- **BGM + SFX** — all audio events wired

---

## Docs

| Document | Contents |
|----------|----------|
| [docs/setup.md](docs/setup.md) | Prerequisites, disc extraction, asset pipeline, video conversion |
| [docs/architecture.md](docs/architecture.md) | Engine design, canvas stack, event loop, compositing |
| [docs/game-format.md](docs/game-format.md) | Binary script format, asset naming, translation workflow |
| [CLAUDE.md](CLAUDE.md) | Instructions for Claude Code (AI-assisted development) |

---

## Project layout

```
.
├── webapp/
│   ├── index.html          Single-page app (menu → chapter select → game)
│   ├── server.js           Static file server (Node.js, port 8765)
│   ├── engine/engine.js    VN engine — event loop, canvas compositor, audio
│   ├── scripts/            Extracted dialogue (34 × JSON)
│   └── assets/             ⚠ Not in git (~281 MB) — see docs/setup.md
├── tools/
│   ├── extract_text.py     Binary script → JSON extractor
│   ├── reinsert_text.py    Translated strings → JSON updater
│   └── build_webapp.py     Full extraction pipeline
├── translation/
│   └── strings.json        14 723-line JP source / EN placeholder table
├── docs/                   Architecture & format documentation
├── CLAUDE.md               AI dev instructions
└── .gitignore
```

---

## Translation status

The `translation/strings.json` file contains all 14 723 dialogue offsets. Japanese originals are present; English translations are in progress.

To contribute translations, edit `translation/strings.json` and run `python tools/reinsert_text.py`.

---

## License

The web player code (`webapp/engine/`, `webapp/index.html`, `webapp/server.js`, `tools/`) is released under **MIT**.  
Game assets and scripts are © 2004 PsG System Laboratory — not redistributed.
