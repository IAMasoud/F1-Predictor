#!/usr/bin/env python3
"""Generate the Pitwall icons: PWA app icons (full-bleed, maskable-safe), the notification badge
and the link-preview image (og.png).

The mark is the site's own start lights (four on, the fifth still dark) with PITWALL in
Barlow Condensed ExtraBold Italic (SIL Open Font License, the copy in boxbox/fonts).
No Formula 1 / FIA fonts, logos or marks.

Needs Pillow, fontTools and brotli:  python3 make_icons.py
"""
import io
from PIL import Image, ImageDraw, ImageFilter, ImageFont
from fontTools.ttLib import TTFont

BG = (7, 7, 8, 255)          # #070708
RED = (255, 42, 42, 255)     # #FF2A2A, the start-light red used across the site
OFF = (58, 58, 62, 255)      # #3a3a3e, the dark fifth light
BOX = (22, 22, 26, 255)      # #16161a, the light housing
INK = (245, 245, 247, 255)
GREY = (154, 154, 162, 255)
SS = 4                       # supersampling for smooth edges


def font(woff2, size):
    t = TTFont(woff2)
    t.flavor = None
    buf = io.BytesIO()
    t.save(buf)
    buf.seek(0)
    return ImageFont.truetype(buf, size)


WORD = 'boxbox/fonts/barlow-condensed-800-italic.woff2'
TAG = 'boxbox/fonts/barlow-condensed-700-italic.woff2'


def glow(size, cx, cy, radius, alpha):
    g = Image.new('RGBA', size, (0, 0, 0, 0))
    ImageDraw.Draw(g).ellipse([cx - radius, cy - radius, cx + radius, cy + radius], fill=RED[:3] + (alpha,))
    return g.filter(ImageFilter.GaussianBlur(radius * 0.45))


def lights(d, x, y, w, housing=True, on=RED, off=OFF):
    """the mark in a 100 x 30 box, scaled to width w with its top-left at (x, y)"""
    k = w / 100
    if housing:
        d.rounded_rectangle([x, y, x + w, y + 30 * k], radius=15 * k, fill=BOX)
    for i in range(4):
        cx, cy, r = x + (14 + i * 18) * k, y + 15 * k, 7.4 * k
        d.ellipse([cx - r, cy - r, cx + r, cy + r], fill=on)
    cx, cy, r = x + 86 * k, y + 15 * k, 6.4 * k
    d.ellipse([cx - r, cy - r, cx + r, cy + r], outline=off, width=max(1, round(2 * k)))


def text_size(d, s, f):
    b = d.textbbox((0, 0), s, font=f)
    return b, b[2] - b[0], b[3] - b[1]


def app_icon(size, path):
    S = size * SS
    img = Image.new('RGBA', (S, S), BG)
    img.alpha_composite(glow((S, S), S / 2, S * 0.42, S * 0.42, 60))
    d = ImageDraw.Draw(img)
    mw, mh = S * 0.70, S * 0.70 * 0.3
    f = font(WORD, int(S * 0.2))
    b, tw, th = text_size(d, 'PITWALL', f)
    gap = S * 0.05
    top = (S - (mh + gap + th)) / 2
    lights(d, (S - mw) / 2, top, mw)
    d.text(((S - tw) / 2 - b[0], top + mh + gap - b[1]), 'PITWALL', font=f, fill=INK)
    img.resize((size, size), Image.LANCZOS).save(path)
    print('wrote', path, f'{size}x{size}')


def badge(size, path):
    # notification badge: shown as an alpha mask, so a white silhouette on transparent
    S = size * SS
    img = Image.new('RGBA', (S, S), (0, 0, 0, 0))
    lights(ImageDraw.Draw(img), S * 0.06, S * 0.36, S * 0.88, housing=False, on=(255, 255, 255, 255), off=(255, 255, 255, 255))
    img.resize((size, size), Image.LANCZOS).save(path)
    print('wrote', path, f'{size}x{size}')


def og_image(path, w=1200, h=630):
    W_, H_ = w * SS, h * SS
    img = Image.new('RGBA', (W_, H_), BG)
    img.alpha_composite(glow((W_, H_), W_ / 2, H_ / 2, H_ * 0.55, 46))
    d = ImageDraw.Draw(img)
    f = font(WORD, int(H_ * 0.27))
    b, tw, th = text_size(d, 'PITWALL', f)
    mw = th * 2.1
    gap = th * 0.28
    x0 = (W_ - (mw + gap + tw)) / 2
    y0 = H_ * 0.40 - th / 2
    lights(d, x0, y0 + th / 2 - mw * 0.15, mw, housing=False)
    d.text((x0 + mw + gap - b[0], y0 - b[1]), 'PITWALL', font=f, fill=INK)
    t = font(TAG, int(H_ * 0.072))
    tag = 'AI RACE PREDICTIONS  ·  PITWALL.COMPANY'
    b2, tw2, th2 = text_size(d, tag, t)
    d.text(((W_ - tw2) / 2 - b2[0], H_ * 0.66 - b2[1]), tag, font=t, fill=GREY)
    t3 = font(TAG, int(H_ * 0.042))
    note = 'UNOFFICIAL FAN PROJECT'
    b3, tw3, _ = text_size(d, note, t3)
    d.text(((W_ - tw3) / 2 - b3[0], H_ * 0.80 - b3[1]), note, font=t3, fill=OFF[:3] + (255,))
    img.convert('RGB').resize((w, h), Image.LANCZOS).save(path)
    print('wrote', path, f'{w}x{h}')


app_icon(192, 'icons/icon-192.png')
app_icon(512, 'icons/icon-512.png')
badge(96, 'icons/icon-96.png')
og_image('icons/og.png')
