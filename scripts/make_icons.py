#!/usr/bin/env python3
"""Generate PWA / iOS home-screen icons for the Road to 70.3 tracker.

Produces solid-background rounded icons with a "70.3" wordmark, plus a
maskable variant (extra safe-zone padding) and an Apple touch icon.
Run: python3 scripts/make_icons.py
"""
import os
from PIL import Image, ImageDraw, ImageFont

OUT = os.path.join(os.path.dirname(__file__), "..", "icons")
FONT = "/usr/share/fonts/truetype/liberation/LiberationSans-Bold.ttf"

BG = (249, 219, 226)     # light pink background  #f9dbe2
RED = (224, 49, 65)      # red wordmark            #e03141
RED_DEEP = (193, 18, 31) # deeper red accent bar   #c1121f


def rounded(size, radius_ratio, pad_ratio, bg):
    """Base rounded-square canvas on a transparent field."""
    img = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    pad = int(size * pad_ratio)
    r = int(size * radius_ratio)
    d.rounded_rectangle([pad, pad, size - pad, size - pad], radius=r, fill=bg)
    return img, pad


def draw_mark(img, pad):
    """Draw the '70.3' wordmark + accent bar centred in the tile."""
    size = img.size[0]
    inner = size - 2 * pad
    d = ImageDraw.Draw(img)

    # accent bar above the number
    bar_w = int(inner * 0.30)
    bar_h = max(3, int(inner * 0.035))
    bx = (size - bar_w) // 2
    by = pad + int(inner * 0.26)
    d.rounded_rectangle([bx, by, bx + bar_w, by + bar_h], radius=bar_h // 2, fill=RED_DEEP)

    # the number
    text = "70.3"
    fs = int(inner * 0.34)
    font = ImageFont.truetype(FONT, fs)
    tb = d.textbbox((0, 0), text, font=font)
    tw, th = tb[2] - tb[0], tb[3] - tb[1]
    tx = (size - tw) // 2 - tb[0]
    ty = pad + int(inner * 0.40) - tb[1]
    d.text((tx, ty), text, font=font, fill=RED)

    # small "IRONMAN"-ish eyebrow removed for clarity; add tri sub-label
    sub = "TRI"
    fs2 = int(inner * 0.11)
    font2 = ImageFont.truetype(FONT, fs2)
    sb = d.textbbox((0, 0), sub, font=font2)
    sw = sb[2] - sb[0]
    sx = (size - sw) // 2 - sb[0]
    sy = pad + int(inner * 0.80)
    d.text((sx, sy), sub, font=font2, fill=RED)


def make(size, name, maskable=False):
    pad_ratio = 0.14 if maskable else 0.0
    radius_ratio = 0.20 if not maskable else 0.14
    img, pad = rounded(size, radius_ratio, pad_ratio, BG)
    # for maskable we still want visible padding inside the (transparent) safe zone
    draw_mark(img, pad if pad else int(size * 0.02))
    img.save(os.path.join(OUT, name))
    print("wrote", name, size)


def make_apple(size=180):
    # Apple touch icons must be fully opaque squares (iOS rounds them itself)
    img = Image.new("RGBA", (size, size), BG + (255,))
    draw_mark(img, int(size * 0.06))
    img.convert("RGB").save(os.path.join(OUT, "apple-touch-icon.png"))
    print("wrote apple-touch-icon.png", size)


def make_favicon():
    img = Image.new("RGBA", (64, 64), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    d.rounded_rectangle([2, 2, 62, 62], radius=12, fill=BG)
    font = ImageFont.truetype(FONT, 30)
    tb = d.textbbox((0, 0), "70", font=font)
    tw = tb[2] - tb[0]
    d.text(((64 - tw) // 2 - tb[0], 16), "70", font=font, fill=RED)
    img.save(os.path.join(OUT, "favicon.png"))
    print("wrote favicon.png")


if __name__ == "__main__":
    os.makedirs(OUT, exist_ok=True)
    make(192, "icon-192.png")
    make(512, "icon-512.png")
    make(512, "icon-512-maskable.png", maskable=True)
    make_apple(180)
    make_favicon()
    print("done")
