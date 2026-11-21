# Regenerates assets/icon.png and assets/cover.png from assets/icon.svg (the source of truth).
# Needs Inkscape (to render the SVG) and Pillow:  python3 scripts/art.py
import os
import subprocess, tempfile
from pathlib import Path
from PIL import Image, ImageDraw, ImageFont

ROOT = Path(__file__).resolve().parent.parent
ASSETS = ROOT / 'assets'
FONT = os.environ.get('ART_FONT', 'NotoSans[wght].ttf')  # font file name (searched in system font folders) or a path; override with ART_FONT
NAVY, WHITE, CYAN, MUTED, SOFT = (10, 22, 40), (255, 255, 255), (56, 189, 248), (148, 163, 184), (203, 213, 225)

def render(svg: Path, size: int) -> Image.Image:
    with tempfile.TemporaryDirectory() as tmp:
        out = Path(tmp) / 'out.png'
        subprocess.run(['inkscape', str(svg), '--export-type=png', f'--export-filename={out}', '-w', str(size)], check=True, capture_output=True)
        return Image.open(out).convert('RGBA')

def font(size, weight='Regular'):
    f = ImageFont.truetype(FONT, size)
    try: f.set_variation_by_name(weight)
    except Exception: pass
    return f

render(ASSETS / 'icon.svg', 256).convert('RGB').save(ASSETS / 'icon.png', optimize=True)

# Cover: flat navy, the bird large on the right, text on the left. No gradients.
W, H = 1600, 1000
cover = Image.new('RGB', (W, H), NAVY)
cover.paste(render(ASSETS / 'icon.svg', 760).convert('RGB'), (W - 760 - 40, (H - 760) // 2))
d = ImageDraw.Draw(cover)
d.text((120, 300), 'Flutter & Dart', font=font(104, 'Bold'), fill=WHITE)
d.text((120, 420), 'Tools for Orca', font=font(104, 'Bold'), fill=CYAN)
for i, text in enumerate(['Run configurations & hot reload', 'Widget inspector', 'Builds with signing checks', 'Packages, SDK updates & emulators']):
    y = 600 + i * 56
    d.ellipse([124, y + 16, 140, y + 32], fill=CYAN)
    d.text((162, y), text, font=font(38), fill=SOFT)
d.text((120, H - 48), 'Not affiliated with Google. Flutter and Dart are trademarks of Google LLC.', font=font(22), fill=MUTED, anchor='ls')
cover.save(ASSETS / 'cover.png', optimize=True)
print('wrote assets/icon.png, assets/cover.png')
