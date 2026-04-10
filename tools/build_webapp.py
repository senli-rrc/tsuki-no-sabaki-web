#!/usr/bin/env python3
"""
Tsuki no Sabaki - Web App Builder
Converts the game's binary assets and scripts to a web-compatible format.

Steps:
  1. Copy & rename JPEG images (bg, sprites, UI)
  2. Copy & rename MP3/WAV audio
  3. Convert .scr bytecode to JSON scripts
  4. Inject translations from strings.json

Usage:
    python3 build_webapp.py [--lang en|cn|jp]
"""

import os
import json
import glob
import shutil
import struct
import argparse
from pathlib import Path

BASE = Path(__file__).parent.parent
GAME_DIR = BASE / "extracted/game/Program_Executable_Files"
WEBAPP_DIR = BASE / "webapp"
TRANSLATION_DIR = BASE / "translation"


# ─────────────────────────────────────────────
# Asset Pipeline
# ─────────────────────────────────────────────

def classify_image(name):
    """Return asset category from filename."""
    n = name.lower()
    if any(n.startswith(p) for p in ('han_bg', 'blk', 'blood', 'adventure')):
        return 'bg'
    if n in ('textwins', 'mind') or n.startswith(('han_t', 'coatmenu', 'adventure')):
        return 'ui'
    return 'sprites'


def copy_assets():
    print("\n── Asset Pipeline ──────────────────────────")
    cg_dir = GAME_DIR / "cgdata"
    images = list(cg_dir.iterdir())
    counts = {'bg': 0, 'sprites': 0, 'ui': 0}

    for src in images:
        name = src.name
        cat = classify_image(name)
        dst = WEBAPP_DIR / "assets" / cat / (name + ".jpg")
        if not dst.exists():
            shutil.copy2(src, dst)
        counts[cat] += 1

    print(f"  Images → bg:{counts['bg']} sprites:{counts['sprites']} ui:{counts['ui']}")

    # BGM (MP3 without extension)
    media_dir = GAME_DIR / "media"
    for src in media_dir.iterdir():
        data = src.read_bytes()
        # Detect MP3 by ID3 tag or sync word
        if data[:3] == b'ID3' or (len(data) > 1 and data[0] == 0xff and (data[1] & 0xe0) == 0xe0):
            dst = WEBAPP_DIR / "assets/bgm" / (src.name + ".mp3")
            if not dst.exists():
                shutil.copy2(src, dst)
        # MPEG video (0x00 0x00 0x01 0xba or 0xb3)
        elif data[:3] == b'\x00\x00\x01':
            dst = WEBAPP_DIR / "assets/video" / (src.name + ".mpg")
            if not dst.exists():
                shutil.copy2(src, dst)
            print(f"  NOTE: {src.name} is MPEG-1 video, needs ffmpeg conversion for browser.")

    bgm_count = len(list((WEBAPP_DIR / "assets/bgm").iterdir()))
    print(f"  BGM → {bgm_count} tracks")

    # SFX (WAV)
    sound_dir = GAME_DIR / "sound"
    for src in sound_dir.iterdir():
        dst = WEBAPP_DIR / "assets/se" / src.name
        if not dst.exists():
            shutil.copy2(src, dst)
    se_count = len(list((WEBAPP_DIR / "assets/se").iterdir()))
    print(f"  SFX → {se_count} files")


# ─────────────────────────────────────────────
# Script Converter  (binary .scr → JSON)
# ─────────────────────────────────────────────

def read_u32(data, pos):
    return struct.unpack_from('<I', data, pos)[0], pos + 4

def read_str8(data, pos):
    # Name fields are 12 bytes (null-padded), not 8
    chunk = data[pos:pos+12]
    s = chunk.split(b'\x00')[0].decode('ascii', errors='replace')
    return s, pos + 12

def read_cstr_ascii(data, pos):
    end = pos
    while end < len(data) and data[end] != 0:
        end += 1
    return data[pos:end].decode('ascii', errors='replace'), end + 1

def read_cstr_sjis(data, pos):
    end = pos
    while end < len(data) and data[end] != 0:
        b = data[end]
        end += 2 if (0x81 <= b <= 0x9F or 0xE0 <= b <= 0xEF) else 1
    text = data[pos:end].decode('shift-jis', errors='replace')
    return text, end + 1

def skip_nulls(data, pos):
    while pos < len(data) and data[pos] == 0:
        pos += 1
    return pos


def decode_script(data, translations=None):
    """
    Decode binary .scr bytecode into a list of event dicts.
    Returns: list of events (dicts with 'op' key and opcode-specific fields)
    """
    events = []
    i = 8  # skip [SCRIPT] header

    # Skip header section (size word + label addresses)
    size, i = read_u32(data, i)

    # Collect labels from header
    labels = {}
    while i < len(data) - 4:
        b0, b1 = data[i], data[i+1]
        opcode = b0 | (b1 << 8)

        # ── Text display ──────────────────────────────────────────
        # Format: 0x00 [4-byte LE length] [Shift-JIS text] [0x00 null]
        # The large blocks of null padding before text entries mean we need
        # to look ahead: find the last 0x00 before a SJIS lead byte.
        if b0 == 0x00 and i + 5 < len(data):
            length = struct.unpack_from('<I', data, i+1)[0]
            if 4 <= length <= 2000:
                first = data[i+5] if i+5 < len(data) else 0
                if (0x81 <= first <= 0x9F or 0xE0 <= first <= 0xEF):
                    text, _ = read_cstr_sjis(data, i+5)
                    text = text.replace('@', '\x07')  # \x07 = pause marker
                    translated = ''
                    if translations:
                        key = f"0x{i:06x}"
                        translated = translations.get(key, {}).get('translation', '')
                    events.append({
                        'op': 'text',
                        'jp': text,
                        'text': translated or text,
                        'offset': i,
                    })
                    # Skip past the text (SJIS bytes + null)
                    j = i + 5
                    while j < len(data) and data[j] != 0:
                        b = data[j]
                        j += 2 if (0x81 <= b <= 0x9F or 0xE0 <= b <= 0xEF) else 1
                    j += 1  # skip null
                    # Skip padding but NOT another leading 0x00 that starts next text
                    # Look ahead: if followed by 4-byte length + SJIS, stop before 0x00
                    while j < len(data) and data[j] == 0:
                        # Peek: is data[j] the start of a new text block?
                        if j + 5 < len(data):
                            peek_len = struct.unpack_from('<I', data, j+1)[0]
                            peek_first = data[j+5] if j+5 < len(data) else 0
                            if (4 <= peek_len <= 2000 and
                                    (0x81 <= peek_first <= 0x9F or 0xE0 <= peek_first <= 0xEF)):
                                break  # next 0x00 is the next text opcode
                        j += 1
                    i = j
                    continue

        # ── Image load ───────────────────────────────────────────
        if opcode == 0x0C0C:
            name1, j = read_str8(data, i+4)
            name2, j = read_str8(data, j)
            events.append({'op': 'load_image', 'name': name1 or name2})
            i = j
            continue

        if opcode == 0x0808:
            name1, j = read_str8(data, i+4)
            name2, j = read_str8(data, j)
            events.append({'op': 'load_ui', 'name': name1 or name2})
            i = j
            continue

        # ── Fade / transition ─────────────────────────────────────
        if opcode == 0x0C10:
            dur, j = read_u32(data, i+4)
            flag, j = read_u32(data, j)
            events.append({'op': 'fade', 'duration': dur, 'flag': flag})
            i = j
            continue

        # ── Set layer / sprite position ───────────────────────────
        if opcode == 0x0C0F:
            x, j = read_u32(data, i+4)
            events.append({'op': 'set_layer', 'layer': x})
            i = j
            continue

        # ── Wait ──────────────────────────────────────────────────
        if opcode == 0x0815:
            val, j = read_u32(data, i+4)
            events.append({'op': 'wait', 'frames': val})
            i = j
            continue

        # ── Wait for click (page break) ───────────────────────────
        # NOTE: do NOT call skip_nulls here — the next text opcode starts
        # with 0x00 which would be consumed, causing text to be missed.
        if b0 == 0x02 and b1 == 0x70:
            events.append({'op': 'wait_click'})
            i += 2
            continue

        # ── Play sound ────────────────────────────────────────────
        if opcode == 0x0C14:
            # Structure: opcode(2) flags(2) val(4) inner_type(4) name(12)
            snd, _ = read_str8(data, i + 12)  # name starts at i+12
            events.append({'op': 'play_sound', 'file': snd})
            i = i + 24  # fixed 24-byte opcode
            continue

        # ── Color/screen fade ─────────────────────────────────────
        if b0 == 0x2F and b1 == 0x06:
            mode = data[i+2]
            r, g, b_ = data[i+3], data[i+4], data[i+5]
            val, j = read_u32(data, i+6)
            events.append({'op': 'color_fade', 'mode': mode, 'r': r, 'g': g, 'b': b_, 'val': val})
            i = j
            continue

        # ── Go to / call script ───────────────────────────────────
        if opcode == 0x0C16:
            dur, j = read_u32(data, i+4)
            flag, j = read_u32(data, j)
            target, j = read_u32(data, j)
            extra = data[j]; j += 1
            if extra == 0x08:
                script, j = read_cstr_ascii(data, j)
                events.append({'op': 'goto_script', 'target': script})
                i = j
            else:
                events.append({'op': 'jump', 'target': target})
                i = j
            continue

        # ── Set flag ──────────────────────────────────────────────
        if b0 == 0x11 and b1 == 0x04:
            flag_id, val = data[i+2], data[i+3]
            events.append({'op': 'set_flag', 'flag': flag_id, 'value': val})
            i += 4
            continue

        # ── BGM / music load ─────────────────────────────────────
        if b0 == 0x4D and b1 == 0x0C:
            name, j = read_cstr_ascii(data, i+4)
            events.append({'op': 'load_bgm', 'file': name})
            i = j
            continue

        # ── Play BGM ─────────────────────────────────────────────
        if b0 == 0x52 and b1 == 0x06:
            val, j = read_u32(data, i+4)
            events.append({'op': 'play_bgm', 'val': val})
            i = j
            continue

        # ── Choice menu ───────────────────────────────────────────
        if b0 == 0x23 and b1 == 0x04:
            events.append({'op': 'choice_begin'})
            i += 4
            continue

        # ── Label / subroutine ────────────────────────────────────
        if b0 == 0x03 and b1 == 0x04:
            i += 4
            continue

        if b0 == 0x0E and b1 == 0x04:
            i += 4
            continue

        # Unknown: advance 1 byte at a time so we don't skip text opcodes
        # (text display uses 0x00 as its opcode, which looks like padding)
        i += 1

    return events


def convert_scripts(lang='en'):
    print("\n── Script Conversion ───────────────────────")

    # Load translation lookup: offset -> entry
    translations_by_file = {}
    strings_path = TRANSLATION_DIR / "strings.json"
    if strings_path.exists():
        with open(strings_path, encoding='utf-8') as f:
            raw = json.load(f)
        for fname, entries in raw.items():
            lookup = {}
            for e in entries:
                key = f"0x{e['opcode_pos']:06x}"
                lookup[key] = e
            translations_by_file[fname] = lookup

    scr_files = sorted((GAME_DIR / "data").glob("*.scr"))
    out_dir = WEBAPP_DIR / "scripts"
    out_dir.mkdir(exist_ok=True)

    for scr_path in scr_files:
        fname = scr_path.name
        data = scr_path.read_bytes()
        if not data.startswith(b'[SCRIPT]'):
            continue

        translations = translations_by_file.get(fname, {})
        events = decode_script(data, translations)

        out_path = out_dir / (scr_path.stem + ".json")
        with open(out_path, 'w', encoding='utf-8') as f:
            json.dump({'script': fname, 'lang': lang, 'events': events},
                      f, ensure_ascii=False, indent=2)

        text_count = sum(1 for e in events if e['op'] == 'text')
        print(f"  {fname}: {len(events)} events ({text_count} dialogue)")

    print(f"  → {out_dir}")


# ─────────────────────────────────────────────
# Main
# ─────────────────────────────────────────────

if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--lang', default='jp', choices=['en', 'cn', 'jp'])
    parser.add_argument('--assets-only', action='store_true')
    parser.add_argument('--scripts-only', action='store_true')
    args = parser.parse_args()

    if not args.scripts_only:
        copy_assets()
    if not args.assets_only:
        convert_scripts(args.lang)

    print("\nDone! Next: open webapp/index.html in a browser.")
