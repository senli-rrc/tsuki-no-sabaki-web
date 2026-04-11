#!/usr/bin/env python3
"""
Tsuki no Sabaki — Japanese → Simplified Chinese translator
Uses Claude Haiku via the Anthropic API to translate script dialogue.

For each text event in webapp/scripts/*.json that has a non-empty `jp` field
but a missing/empty `zh` field, the script calls the API and writes the result
back into the JSON file as a new `zh` field.

Usage:
    python3 translate_zh.py [--scripts s02_01 s02_02 ...] [--dry-run] [--batch 20]

Options:
    --scripts   Only translate the named scripts (without .json suffix).
                Defaults to all files in webapp/scripts/.
    --dry-run   Print what would be translated without calling the API or
                writing any files.
    --batch N   Number of lines sent per API call (default 20).
                Larger batches = fewer calls but higher per-call cost.
    --force     Re-translate lines that already have a `zh` field.

Requirements:
    pip install anthropic
    export ANTHROPIC_API_KEY=sk-...
"""

import os
import sys
import json
import time
import argparse
import re

try:
    import anthropic
except ImportError:
    sys.exit("Missing dependency: pip install anthropic")

SCRIPTS_DIR = os.path.join(os.path.dirname(__file__), "..", "webapp", "scripts")
MODEL       = "claude-haiku-4-5"   # fast & cheap; swap to claude-sonnet-4-5 for higher quality
MAX_TOKENS  = 4096

# ---------------------------------------------------------------------------
# Formatting-code preservation
# ---------------------------------------------------------------------------
# The Japanese text contains PSG engine tags we must keep verbatim:
#   !s        — centre-align marker
#   @         — text pause
#   \x07      — bell / page-break
#   \n        — newline (literal in JSON)
#   　(U+3000) — ideographic space used for indentation
#
# Strategy: replace every formatting token with a placeholder before sending
# to the API, then restore them in the translated output.

_PLACEHOLDERS = [
    (re.compile(r'!s'),    '{{CS}}'),
    (re.compile(r'\x07'), '{{BL}}'),
    (re.compile(r'@'),    '{{PA}}'),
]

def encode_placeholders(text):
    for pat, ph in _PLACEHOLDERS:
        text = pat.sub(ph, text)
    return text

def decode_placeholders(text):
    text = text.replace('{{CS}}', '!s')
    text = text.replace('{{BL}}', '\x07')
    text = text.replace('{{PA}}', '@')
    return text

# ---------------------------------------------------------------------------
# Prompt building
# ---------------------------------------------------------------------------

SYSTEM_PROMPT = """\
You are a professional Japanese → Simplified Chinese translator specialising in \
visual novel dialogue. Your output will be displayed directly in a game UI.

Rules:
1. Translate the Japanese naturally into Simplified Chinese (简体中文).
2. Preserve ALL placeholder tokens exactly — {{CS}}, {{BL}}, {{PA}} — \
   and every newline character (\\n). Do NOT remove, move or duplicate them.
3. Keep leading/trailing newlines identical to the source.
4. Wide Japanese spaces (　) used for indentation may be kept or replaced with \
   normal spaces, but do NOT add extra indentation.
5. Names of characters, places and game-specific terms: keep consistent and \
   natural-sounding in Chinese. Do not romanise.
6. Output ONLY the translated lines — one per input line — separated by the \
   delimiter  <<<>>>  on its own line between each translation. \
   No explanations, no numbering.
"""

def build_user_prompt(lines):
    """lines: list of (index, jp_text) tuples"""
    parts = []
    for _, jp in lines:
        parts.append(encode_placeholders(jp))
    return "\n<<<>>>\n".join(parts)

# ---------------------------------------------------------------------------
# API call
# ---------------------------------------------------------------------------

def translate_batch(client, lines):
    """
    lines: list of (index, jp_text)
    Returns: list of zh strings, same length as lines.
    """
    user_msg = build_user_prompt(lines)
    response = client.messages.create(
        model=MODEL,
        max_tokens=MAX_TOKENS,
        system=SYSTEM_PROMPT,
        messages=[{"role": "user", "content": user_msg}],
    )
    raw = response.content[0].text
    parts = raw.split("<<<>>>")
    results = []
    for i, part in enumerate(parts):
        zh = decode_placeholders(part)
        # Restore trailing newline pattern from source
        src_jp = lines[i][1] if i < len(lines) else ""
        # Ensure same trailing newline count
        src_trailing = len(src_jp) - len(src_jp.rstrip('\n'))
        zh = zh.strip('\n')
        zh = zh + '\n' * max(src_trailing, 1)
        results.append(zh)
    # Pad or trim to match input count
    while len(results) < len(lines):
        results.append(lines[len(results)][1])   # fallback: original jp
    return results[:len(lines)]

# ---------------------------------------------------------------------------
# Per-script processing
# ---------------------------------------------------------------------------

def process_script(client, path, batch_size, dry_run, force):
    with open(path, encoding='utf-8') as f:
        data = json.load(f)

    events = data.get('events', [])
    # Collect text events needing translation
    pending = []   # list of (event_index, jp_text)
    for i, ev in enumerate(events):
        if ev.get('op') != 'text':
            continue
        jp = ev.get('jp', '').strip()
        if not jp:
            continue
        if not force and ev.get('zh', '').strip():
            continue   # already translated
        pending.append((i, ev['jp']))

    if not pending:
        print(f"  {os.path.basename(path)}: nothing to translate (all done)")
        return 0

    print(f"  {os.path.basename(path)}: {len(pending)} lines to translate")
    if dry_run:
        for _, jp in pending[:3]:
            print(f"    JP: {jp[:60].strip()!r}")
        if len(pending) > 3:
            print(f"    … and {len(pending)-3} more")
        return len(pending)

    translated = 0
    # Process in batches
    for start in range(0, len(pending), batch_size):
        chunk = pending[start:start + batch_size]
        try:
            zh_list = translate_batch(client, chunk)
        except Exception as e:
            print(f"    ERROR on batch {start//batch_size}: {e}")
            time.sleep(5)
            continue
        for (ev_idx, _), zh in zip(chunk, zh_list):
            events[ev_idx]['zh'] = zh
            translated += 1
        # Brief pause between batches to avoid rate-limiting
        if start + batch_size < len(pending):
            time.sleep(0.5)

    with open(path, 'w', encoding='utf-8') as f:
        json.dump(data, f, ensure_ascii=False, indent=2)
    print(f"    → wrote {translated} translations")
    return translated

# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

def main():
    parser = argparse.ArgumentParser(description="Translate VN scripts JP→ZH")
    parser.add_argument('--scripts', nargs='+', metavar='NAME',
                        help="Script names without .json (default: all)")
    parser.add_argument('--dry-run', action='store_true',
                        help="Preview without calling the API")
    parser.add_argument('--batch', type=int, default=20, metavar='N',
                        help="Lines per API call (default 20)")
    parser.add_argument('--force', action='store_true',
                        help="Re-translate lines that already have zh")
    args = parser.parse_args()

    api_key = os.environ.get('ANTHROPIC_API_KEY')
    if not api_key and not args.dry_run:
        sys.exit("Set ANTHROPIC_API_KEY environment variable before running.")

    client = anthropic.Anthropic(api_key=api_key) if api_key else None

    # Resolve script paths
    if args.scripts:
        paths = [os.path.join(SCRIPTS_DIR, n + '.json') for n in args.scripts]
    else:
        paths = sorted(
            os.path.join(SCRIPTS_DIR, f)
            for f in os.listdir(SCRIPTS_DIR)
            if f.endswith('.json')
        )

    missing = [p for p in paths if not os.path.exists(p)]
    if missing:
        sys.exit(f"Not found: {missing}")

    total = 0
    for path in paths:
        total += process_script(client, path, args.batch, args.dry_run, args.force)

    print(f"\nDone — {total} lines {'would be ' if args.dry_run else ''}translated")

if __name__ == '__main__':
    main()
