# Store screenshots from the fixture scenarios in src/panel.check.ts (never your real projects).
# Orca's window must be minimized while it runs: `orca plugin shot --scenario` draws inside it.
#   python3 scripts/screenshots.py
import os
import json, subprocess, sys
from pathlib import Path
from PIL import Image, ImageDraw, ImageFilter, ImageFont

ROOT = Path(__file__).resolve().parent.parent
ORCA = sys.argv[1] if len(sys.argv) > 1 else 'orca'
FONT = os.environ.get('ART_FONT', 'NotoSans[wght].ttf')  # font file name (searched in system font folders) or a path; override with ART_FONT
SHOTS = [
    ('running', 'Run configurations, hot reload and app output', 'Pick a device, mode, flavor and dart-defines. Save them as named configurations.'),
    ('inspector', 'Widget inspector', 'Your app’s widget tree with source locations. Enter jumps to the code.'),
    ('signing', 'Builds with signing checks', 'flutter build for every platform, with a warning before an unsigned release.'),
    ('packages', 'Packages', 'See outdated dependencies, upgrade them, or open them on pub.dev.'),
]

def font(size, weight='Regular'):
    f = ImageFont.truetype(FONT, size)
    try: f.set_variation_by_name(weight)
    except Exception: pass
    return f

def background(w, h):
    return Image.new('RGBA', (w, h), (10, 22, 40, 255))  # flat navy, same as the icon and cover

def wrap(draw, text, fnt, width):
    lines, line = [], ''
    for word in text.split():
        trial = f'{line} {word}'.strip()
        if draw.textlength(trial, font=fnt) > width and line: lines.append(line); line = word
        else: line = trial
    return lines + [line]

entries = []
for scenario, title, caption in SHOTS:
    raw = ROOT / '.orca' / 'shots' / f'{scenario}.png'
    raw.parent.mkdir(parents=True, exist_ok=True)
    result = subprocess.run([ORCA, 'plugin', 'shot', str(ROOT), '--scenario', scenario, '--theme', 'dark', '--width', '420', '--height', '1100', '--out', str(raw), '--json'], capture_output=True, text=True)
    if result.returncode != 0: sys.exit(f'{scenario}: {result.stdout or result.stderr}')
    W, H = 1600, 1000
    canvas = background(W, H)
    panel = Image.open(raw).convert('RGBA')
    if panel.height > 900: panel = panel.resize((round(panel.width * 900 / panel.height), 900), Image.LANCZOS)
    x, y = W - panel.width - 110, (H - panel.height) // 2
    shadow = Image.new('RGBA', (W, H), (0, 0, 0, 0))
    ImageDraw.Draw(shadow).rounded_rectangle([x - 6, y + 10, x + panel.width + 6, y + panel.height + 22], 18, fill=(0, 0, 0, 150))
    canvas = Image.alpha_composite(canvas, shadow.filter(ImageFilter.GaussianBlur(18)))
    mask = Image.new('L', panel.size, 0)
    ImageDraw.Draw(mask).rounded_rectangle([0, 0, panel.width - 1, panel.height - 1], 14, fill=255)
    canvas.paste(panel, (x, y), mask)
    d = ImageDraw.Draw(canvas)
    ty = 330
    for line in wrap(d, title, font(64, 'Bold'), 820):
        d.text((110, ty), line, font=font(64, 'Bold'), fill=(255, 255, 255)); ty += 80
    ty += 20
    for line in wrap(d, caption, font(34), 820):
        d.text((110, ty), line, font=font(34), fill=(203, 213, 225)); ty += 48
    out = ROOT / 'assets' / f'screenshot-{scenario}.png'
    canvas.convert('RGB').save(out, optimize=True)
    entries.append({'path': f'assets/{out.name}', 'alt': f'{title}: {caption}', 'caption': title})
    print('wrote', out.relative_to(ROOT))

manifest_path = ROOT / 'orca-plugin.json'
manifest = json.loads(manifest_path.read_text())
manifest['screenshots'] = entries
manifest_path.write_text(json.dumps(manifest, indent=2) + '\n')
print('updated orca-plugin.json screenshots')
