#!/usr/bin/env python3
"""
Tsuki no Sabaki - Text Reinserter
Writes translated text back into .scr script files.

Rules:
- Translated text is re-encoded to Shift-JIS (for Japanese/mixed) or ASCII (for English).
- If translation is empty, the original Japanese is kept.
- Translation MUST fit within the original byte length. If it's longer,
  the script will warn and truncate (to prevent corruption).
- Special markers preserved: @ (text pause), \\n (line break).

Usage:
    python3 reinsert_text.py [--lang en|cn|jp]
    -> Writes patched files to patched/<lang>/ directory
"""

import os
import json
import glob
import shutil
import argparse

SCRIPT_DIR = os.path.join(os.path.dirname(__file__), "..", "extracted", "game",
                          "Program_Executable_Files", "data")
TRANSLATION_DIR = os.path.join(os.path.dirname(__file__), "..", "translation")
OUTPUT_BASE = os.path.join(os.path.dirname(__file__), "..", "patched")


def encode_text(text, lang):
    """Encode translated text to bytes for the target language."""
    if lang == 'cn':
        # Simplified Chinese: try GBK encoding (2-byte, similar byte size to SJIS)
        return text.encode('gbk', errors='replace')
    elif lang == 'en':
        # English: ASCII, but allow some special chars via latin-1
        return text.encode('latin-1', errors='replace')
    else:
        # Japanese (default): Shift-JIS
        return text.encode('shift-jis', errors='replace')


def reinsert(lang='en'):
    strings_path = os.path.join(TRANSLATION_DIR, f"strings_{lang}.json")
    if not os.path.exists(strings_path):
        # Fall back to base strings.json
        strings_path = os.path.join(TRANSLATION_DIR, "strings.json")

    with open(strings_path, 'r', encoding='utf-8') as f:
        all_data = json.load(f)

    out_dir = os.path.join(OUTPUT_BASE, lang)
    os.makedirs(out_dir, exist_ok=True)

    total_replaced = 0
    total_skipped = 0
    total_truncated = 0

    for fname, entries in all_data.items():
        scr_path = os.path.join(SCRIPT_DIR, fname)
        if not os.path.exists(scr_path):
            print(f"WARNING: {fname} not found, skipping")
            continue

        with open(scr_path, 'rb') as f:
            data = bytearray(f.read())

        replaced = 0
        for e in entries:
            translation = e.get('translation', '').strip()
            if not translation:
                total_skipped += 1
                continue

            # Encode the translation
            encoded = encode_text(translation, lang)
            max_bytes = e['byte_length']  # original byte count (excl null)

            if len(encoded) > max_bytes:
                # Truncate with warning
                print(f"  TRUNCATE {fname}[0x{e['opcode_pos']:06x}]: "
                      f"{len(encoded)} bytes > {max_bytes} allowed")
                encoded = encoded[:max_bytes]
                total_truncated += 1

            # Write the new text in-place
            pos = e['text_start']
            # Zero out the old text area first (fill with spaces up to null)
            for k in range(max_bytes + 1):
                data[pos + k] = 0x00

            # Write new text
            for k, byte in enumerate(encoded):
                data[pos + k] = byte
            data[pos + len(encoded)] = 0x00  # null terminator

            # Update the length field (4-byte LE at opcode_pos+1)
            new_length = len(encoded) + 1  # +1 for null
            # Keep original length_field to avoid shifting offsets;
            # just null-fill the rest. The original slot size is preserved.
            # (length_field stays the same — engine reads until null)

            replaced += 1
            total_replaced += 1

        out_path = os.path.join(out_dir, fname)
        with open(out_path, 'wb') as f:
            f.write(data)
        print(f"  {fname}: {replaced} replaced")

    print(f"\nDone: {total_replaced} replaced, {total_skipped} skipped "
          f"(untranslated), {total_truncated} truncated")
    print(f"Output: {out_dir}")


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--lang', default='en', choices=['en', 'cn', 'jp'],
                        help='Target language (en=English, cn=Chinese, jp=Japanese)')
    args = parser.parse_args()
    reinsert(args.lang)
