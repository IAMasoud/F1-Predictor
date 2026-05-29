#!/usr/bin/env python3
"""Generate F1 Predictor PWA icons (full-bleed, maskable-safe)."""
from PIL import Image, ImageDraw, ImageFont

BG = (13, 13, 13, 255)      # #0d0d0d
RED = (225, 6, 0, 255)      # #E10600
WHITE = (255, 255, 255, 255)
FONT_BOLD = "/System/Library/Fonts/Supplemental/Arial Bold.ttf"


def fit_font(text, target_w, max_size):
    size = max_size
    while size > 8:
        f = ImageFont.truetype(FONT_BOLD, size)
        w = f.getbbox(text)[2] - f.getbbox(text)[0]
        if w <= target_w:
            return f
        size -= 2
    return ImageFont.truetype(FONT_BOLD, 8)


def draw_centered(d, cx, y, text, font, fill):
    b = font.getbbox(text)
    w = b[2] - b[0]
    d.text((cx - w / 2 - b[0], y), text, font=font, fill=fill)


def make_app_icon(size, path):
    img = Image.new("RGBA", (size, size), BG)
    d = ImageDraw.Draw(img)
    # subtle red accent bar near the bottom (checkered-flag vibe)
    bar_h = max(2, int(size * 0.045))
    bar_y = int(size * 0.74)
    d.rectangle([int(size * 0.18), bar_y, int(size * 0.82), bar_y + bar_h], fill=RED)
    # "F1" big and red, centered in the safe zone (central 80%)
    f1_font = fit_font("F1", int(size * 0.56), int(size * 0.62))
    fb = f1_font.getbbox("F1")
    f1_h = fb[3] - fb[1]
    draw_centered(d, size / 2, int(size * 0.20) - fb[1], "F1", f1_font, RED)
    # "PREDICTOR" small + white under the bar
    pr_font = fit_font("PREDICTOR", int(size * 0.64), int(size * 0.13))
    draw_centered(d, size / 2, bar_y + bar_h + int(size * 0.03), "PREDICTOR", pr_font, WHITE)
    img.save(path)
    print("wrote", path, f"{size}x{size}")


def make_badge(size, path):
    # Notification badge: rendered as an alpha mask -> use white silhouette on transparent
    img = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    f = fit_font("F1", int(size * 0.78), int(size * 0.86))
    b = f.getbbox("F1")
    draw_centered(d, size / 2, (size - (b[3] - b[1])) / 2 - b[1], "F1", f, WHITE)
    img.save(path)
    print("wrote", path, f"{size}x{size}")


make_app_icon(192, "icons/icon-192.png")
make_app_icon(512, "icons/icon-512.png")
make_badge(96, "icons/icon-96.png")
