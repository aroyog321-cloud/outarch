"""Build the Microsoft Store (MSIX) logos and tiles from the brand sources.

    python scripts/brand/build-store-assets.py

Requires Python 3 and Pillow. Uses the same glyph extraction and icon drawing
as build-brand-assets.py, so the Store tile, taskbar and Start icons match the
desktop icon exactly.

Output (committed; the MSIX build only copies it): packaging/msix/Assets/

Windows picks among qualified files by name, through the resources.pri that
scripts/msix/build-msix.mjs generates:
  <Name>.scale-<100|125|150|200|400>.png          tiles and logos per display scale
  Square44x44Logo.targetsize-<n>.png                  Start list and taskbar, plated
  Square44x44Logo.targetsize-<n>_altform-unplated.png taskbar / Start without a plate
  Square44x44Logo.targetsize-<n>_altform-lightunplated.png  the same on a light taskbar
"""

import importlib.util
import os
from PIL import Image

HERE = os.path.dirname(os.path.abspath(__file__))
spec = importlib.util.spec_from_file_location("brand_assets", os.path.join(HERE, "build-brand-assets.py"))
brand = importlib.util.module_from_spec(spec)
spec.loader.exec_module(brand)

ROOT = brand.ROOT
ASSETS = os.path.join(ROOT, "packaging", "msix", "Assets")
SCALES = (100, 125, 150, 200, 400)
TARGET_SIZES = (16, 20, 24, 30, 32, 36, 40, 48, 60, 64, 72, 80, 96, 256)
GROUND = (0, 0, 0, 255)


def scaled(base, scale):
    return max(1, round(base * scale / 100))


def tile(width, height, glyph, glyph_ratio):
    """An opaque black tile with the O centred: the Start tile look."""
    canvas = Image.new("RGBA", (width, height), GROUND)
    target_h = round(height * glyph_ratio)
    target_w = round(glyph.width * target_h / glyph.height)
    mark = glyph.resize((target_w, target_h), Image.LANCZOS)
    canvas.alpha_composite(mark, ((width - target_w) // 2, (height - target_h) // 2))
    return canvas


def wide_tile(width, height, wordmark):
    canvas = Image.new("RGBA", (width, height), GROUND)
    mark = brand.fit_width(wordmark, round(width * 0.62))
    if mark.height > height * 0.5:
        mark = mark.resize((round(mark.width * height * 0.5 / mark.height), round(height * 0.5)), Image.LANCZOS)
    canvas.alpha_composite(mark, ((width - mark.width) // 2, (height - mark.height) // 2))
    return canvas


def save(image, name):
    brand.save_png(image, brand.out(ASSETS, name))


def main():
    wordmark_source = Image.open(os.path.join(brand.SOURCE, "outarch-wordmark-source.png"))
    icon_source = Image.open(os.path.join(brand.SOURCE, "outarch-app-icon-source.png"))
    glyph = brand.trim(brand.remove_ground(icon_source.crop((100, 110, 700, 700)), (0, 0, 0)), pad=2)
    wordmark = brand.trim(brand.remove_ground(wordmark_source, (6, 10, 13)), pad=6)

    for name in os.listdir(ASSETS) if os.path.isdir(ASSETS) else []:
        if name.endswith(".png"):
            os.remove(os.path.join(ASSETS, name))

    for scale in SCALES:
        # The app list / taskbar logo and the Store logo are the desktop icon itself.
        save(brand.app_icon(glyph, scaled(44, scale)), f"Square44x44Logo.scale-{scale}.png")
        save(brand.app_icon(glyph, scaled(50, scale)), f"StoreLogo.scale-{scale}.png")
        save(tile(scaled(71, scale), scaled(71, scale), glyph, 0.56), f"Square71x71Logo.scale-{scale}.png")
        save(tile(scaled(150, scale), scaled(150, scale), glyph, 0.50), f"Square150x150Logo.scale-{scale}.png")
        save(tile(scaled(310, scale), scaled(310, scale), glyph, 0.46), f"Square310x310Logo.scale-{scale}.png")
        save(wide_tile(scaled(310, scale), scaled(150, scale), wordmark), f"Wide310x150Logo.scale-{scale}.png")

    for size in TARGET_SIZES:
        icon = brand.app_icon(glyph, size)
        save(icon, f"Square44x44Logo.targetsize-{size}.png")
        save(icon, f"Square44x44Logo.targetsize-{size}_altform-unplated.png")
        save(icon, f"Square44x44Logo.targetsize-{size}_altform-lightunplated.png")


if __name__ == "__main__":
    main()
