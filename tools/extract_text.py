#!/usr/bin/env python3
"""
Tsuki no Sabaki - Text Extractor
Extracts all Japanese dialogue from .scr script files.

Format: 0x00 [4-byte LE length] [Shift-JIS null-terminated text]

Usage:
    python3 extract_text.py
    -> Creates translation/strings.json and translation/preview.txt
"""

import os
import json
import glob

SCRIPT_DIR = os.path.join(os.path.dirname(__file__), "..", "extracted", "game",
                          "Program_Executable_Files", "data")
OUTPUT_DIR = os.path.join(os.path.dirname(__file__), "..", "translation")


def has_japanese(text):
    return any('\u3000' <= c <= '\u9FFF' or '\uFF01' <= c <= '\uFF60' for c in text)


def find_text_entries(data):
    """Find all text entries in a binary script file."""
    entries = []
    i = 0
    while i < len(data) - 6:
        if data[i] == 0x00 and i + 5 < len(data):
            length = int.from_bytes(data[i+1:i+5], 'little')
            if 4 <= length <= 2000:
                text_start = i + 5
                text_end = text_start + length
                if text_end <= len(data):
                    text_bytes = data[text_start:text_end]
                    first = text_bytes[0]
                    # Must start with Shift-JIS lead byte
                    if (0x81 <= first <= 0x9F or 0xE0 <= first <= 0xEF):
                        # Must end with null terminator
                        if 0x00 in text_bytes:
                            null_pos = text_bytes.index(0x00)
                            clean_bytes = text_bytes[:null_pos]
                            try:
                                text = clean_bytes.decode('shift-jis', errors='replace')
                                if has_japanese(text) and len(text) >= 3:
                                    # Avoid overlaps with previous entry
                                    if not entries or i >= entries[-1]['text_end']:
                                        entries.append({
                                            'opcode_pos': i,
                                            'text_start': text_start,
                                            'text_end': text_start + null_pos + 1,
                                            'length_field': length,
                                            'byte_length': null_pos,  # bytes of actual text (excl null)
                                            'original_jp': text,
                                            'translation': '',
                                        })
                            except Exception:
                                pass
        i += 1
    return entries


def extract_all():
    os.makedirs(OUTPUT_DIR, exist_ok=True)

    scr_files = sorted(glob.glob(os.path.join(SCRIPT_DIR, "*.scr")))
    if not scr_files:
        print(f"ERROR: No .scr files found in {SCRIPT_DIR}")
        return

    all_data = {}
    total = 0

    for scr_path in scr_files:
        fname = os.path.basename(scr_path)
        with open(scr_path, 'rb') as f:
            data = f.read()

        entries = find_text_entries(data)
        all_data[fname] = entries
        total += len(entries)
        print(f"  {fname}: {len(entries)} text entries")

    # Save to JSON (translation file)
    out_json = os.path.join(OUTPUT_DIR, "strings.json")
    with open(out_json, 'w', encoding='utf-8') as f:
        json.dump(all_data, f, ensure_ascii=False, indent=2)

    # Save human-readable preview
    out_txt = os.path.join(OUTPUT_DIR, "preview.txt")
    with open(out_txt, 'w', encoding='utf-8') as f:
        for fname, entries in all_data.items():
            f.write(f"\n{'='*60}\n")
            f.write(f"FILE: {fname}  ({len(entries)} entries)\n")
            f.write(f"{'='*60}\n")
            for i, e in enumerate(entries):
                f.write(f"\n[{i:04d}] offset=0x{e['opcode_pos']:06x}  bytes={e['byte_length']}\n")
                f.write(f"  JP: {e['original_jp'].replace(chr(10), '↵')}\n")
                f.write(f"  EN: \n")

    print(f"\nTotal: {total} text entries across {len(scr_files)} files")
    print(f"Saved: {out_json}")
    print(f"Preview: {out_txt}")


if __name__ == '__main__':
    extract_all()
