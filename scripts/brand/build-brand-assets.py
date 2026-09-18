"""Build every OUTARCH brand asset the app ships from the three source images.

    python scripts/brand/build-brand-assets.py

Requires Python 3 and Pillow. The sources live in assets/brand/source/ and are
flat RGB renders on a dark ground (the brand sheet's checkerboard is painted
in, not real transparency), so the transparent assets are made by removing the
known ground colour rather than by cutting shapes out of the sheet.

Outputs (all committed, so the app never needs this script at runtime):
  src/brand/                        desktop window icon (.ico/.png), toast icon,
                                    mobile companion PWA icons
  src/groundstation/renderer/brand/ in-app logo, mark and wordmark
  integrations/vscode/media/        VS Code extension icon
  mobile/android/app/src/main/res/  Android launcher icons
"""

import math
import os
from PIL import Image, ImageDraw

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
SOURCE = os.path.join(ROOT, "assets", "brand", "source")
BRAND = os.path.join(ROOT, "src", "brand")
RENDERER = os.path.join(ROOT, "src", "groundstation", "renderer", "brand")
VSCODE = os.path.join(ROOT, "integrations", "vscode", "media")
ANDROID = os.path.join(ROOT, "mobile", "android", "app", "src", "main", "res")

BLUE = (74, 156, 248)
MINT = (82, 206, 160)
EDGE = (46, 46, 46)
SUPERSAMPLE = 4


def out(directory, name):
    os.makedirs(directory, exist_ok=True)
    return os.path.join(directory, name)


def remove_ground(image, ground, floor=0.035):
    """Colour-to-alpha against a dark ground. Only pixels lighter than the
    ground carry ink; darker ones are compression noise and become clear."""
    rgb = image.convert("RGB")
    result = Image.new("RGBA", rgb.size)
    src = rgb.load()
    dst = result.load()
    width, height = rgb.size
    for y in range(height):
        for x in range(width):
            pixel = src[x, y]
            alpha = 0.0
            for channel, base in zip(pixel, ground):
                if channel > base:
                    alpha = max(alpha, (channel - base) / (255 - base))
            if alpha < floor:
                dst[x, y] = (0, 0, 0, 0)
                continue
            colour = tuple(max(0, min(255, round((c - b) / alpha + b))) for c, b in zip(pixel, ground))
            dst[x, y] = colour + (round(alpha * 255),)
    return result


def trim(image, pad=0):
    box = image.getchannel("A").point(lambda a: 255 if a > 8 else 0).getbbox()
    left, top, right, bottom = box
    return image.crop((max(0, left - pad), max(0, top - pad), min(image.width, right + pad), min(image.height, bottom + pad)))


def fit_width(image, width):
    height = round(image.height * width / image.width)
    return image.resize((width, height), Image.LANCZOS)


def rounded_square(size, inset, radius, fill, edge, edge_width):
    """A rounded square drawn at SUPERSAMPLE x and reduced, for clean corners."""
    big = size * SUPERSAMPLE
    layer = Image.new("RGBA", (big, big), (0, 0, 0, 0))
    draw = ImageDraw.Draw(layer)
    box = [inset * SUPERSAMPLE, inset * SUPERSAMPLE, big - inset * SUPERSAMPLE - 1, big - inset * SUPERSAMPLE - 1]
    draw.rounded_rectangle(box, radius=radius * SUPERSAMPLE, fill=edge + (255,))
    inner = edge_width * SUPERSAMPLE
    draw.rounded_rectangle([box[0] + inner, box[1] + inner, box[2] - inner, box[3] - inner], radius=max(0, (radius - edge_width) * SUPERSAMPLE), fill=fill + (255,))
    return layer.resize((size, size), Image.LANCZOS)


def ring_disc(size, inset, ring_width):
    """A black disc with the brand sheet's blue-to-mint ring."""
    big = size * SUPERSAMPLE
    layer = Image.new("RGBA", (big, big), (0, 0, 0, 0))
    ring = Image.new("RGBA", (big, big), (0, 0, 0, 0))
    ring_px = ring.load()
    centre = big / 2
    for y in range(big):
        for x in range(big):
            # Blue on the left, mint on the right, as on the sheet.
            t = (x - inset * SUPERSAMPLE) / max(1, big - 2 * inset * SUPERSAMPLE)
            t = max(0.0, min(1.0, t))
            ring_px[x, y] = tuple(round(b + (m - b) * t) for b, m in zip(BLUE, MINT)) + (255,)
    mask = Image.new("L", (big, big), 0)
    draw = ImageDraw.Draw(mask)
    outer = inset * SUPERSAMPLE
    draw.ellipse([outer, outer, big - outer - 1, big - outer - 1], fill=255)
    layer.paste(ring, (0, 0), mask)
    disc = ImageDraw.Draw(layer)
    inner = outer + ring_width * SUPERSAMPLE
    disc.ellipse([inner, inner, big - inner - 1, big - inner - 1], fill=(0, 0, 0, 255))
    return layer.resize((size, size), Image.LANCZOS)


def place(base, glyph, height_ratio, offset_y=0.0):
    size = base.width
    target_h = round(size * height_ratio)
    target_w = round(glyph.width * target_h / glyph.height)
    scaled = glyph.resize((target_w, target_h), Image.LANCZOS)
    canvas = base.copy()
    x = (size - target_w) // 2
    y = (size - target_h) // 2 + round(size * offset_y)
    canvas.alpha_composite(scaled, (x, y))
    return canvas


def app_icon(glyph, size):
    # Small sizes drop the inset and enlarge the glyph so the O still reads.
    if size <= 24:
        base = rounded_square(size, 0, round(size * 0.22), (0, 0, 0), EDGE, 0)
        return place(base, glyph, 0.80)
    if size <= 48:
        base = rounded_square(size, 0, round(size * 0.22), (0, 0, 0), EDGE, 1)
        return place(base, glyph, 0.74)
    inset = round(size * 0.03)
    base = rounded_square(size, inset, round(size * 0.21), (0, 0, 0), EDGE, max(1, round(size * 0.012)))
    return place(base, glyph, 0.64, -0.004)


def save_png(image, path):
    image.save(path, optimize=True)
    print("wrote", os.path.relpath(path, ROOT), image.size, os.path.getsize(path), "bytes")


def main():
    wordmark_source = Image.open(os.path.join(SOURCE, "outarch-wordmark-source.png"))
    icon_source = Image.open(os.path.join(SOURCE, "outarch-app-icon-source.png"))

    # The O and its glitch lines, from inside the source icon's frame (the
    # frame's hairline sits at x 46/770, y 33/787 and is left out).
    glyph = trim(remove_ground(icon_source.crop((100, 110, 700, 700)), (0, 0, 0)), pad=2)
    wordmark = trim(remove_ground(wordmark_source, (6, 10, 13)), pad=6)

    # In-app assets.
    save_png(fit_width(wordmark, 960), out(RENDERER, "outarch-wordmark.png"))
    save_png(fit_width(wordmark, 360), out(RENDERER, "outarch-wordmark-sm.png"))
    save_png(app_icon(glyph, 128), out(RENDERER, "outarch-icon.png"))
    save_png(app_icon(glyph, 256), out(RENDERER, "outarch-icon-lg.png"))
    mark = glyph.copy()
    mark.thumbnail((256, 256), Image.LANCZOS)
    save_png(mark, out(RENDERER, "outarch-mark.png"))

    # Desktop window, taskbar and notification icons.
    master = app_icon(glyph, 1024)
    save_png(master.resize((512, 512), Image.LANCZOS), out(BRAND, "outarch.png"))
    save_png(app_icon(glyph, 256), out(BRAND, "outarch-256.png"))
    save_png(app_icon(glyph, 128), out(BRAND, "outarch-128.png"))
    frames = [app_icon(glyph, s) for s in (16, 20, 24, 32, 40, 48, 64, 96, 128, 256)]
    ico_path = out(BRAND, "outarch.ico")
    frames[-1].save(ico_path, format="ICO", sizes=[f.size for f in frames], append_images=frames[:-1])
    print("wrote", os.path.relpath(ico_path, ROOT), os.path.getsize(ico_path), "bytes")

    # Mobile companion (PWA) icons: an opaque square works for "any" and,
    # with the glyph inside the 80% safe zone, for "maskable" too.
    for size in (192, 512):
        opaque = Image.new("RGBA", (size, size), (0, 0, 0, 255))
        save_png(place(opaque, glyph, 0.56), out(BRAND, f"outarch-pwa-{size}.png"))
    touch = Image.new("RGBA", (180, 180), (0, 0, 0, 255))
    save_png(place(touch, glyph, 0.60).convert("RGB"), out(BRAND, "outarch-touch-180.png"))

    # VS Code marketplace-style icon.
    save_png(app_icon(glyph, 256), out(VSCODE, "outarch.png"))

    # Android launcher icons, square and round, per density.
    for density, size in (("mdpi", 48), ("hdpi", 72), ("xhdpi", 96), ("xxhdpi", 144), ("xxxhdpi", 192)):
        folder = os.path.join(ANDROID, f"mipmap-{density}")
        save_png(app_icon(glyph, size), out(folder, "ic_launcher.png"))
        disc = ring_disc(size, max(1, round(size * 0.02)), max(2, round(size * 0.035)))
        save_png(place(disc, glyph, 0.52), out(folder, "ic_launcher_round.png"))


if __name__ == "__main__":
    main()
