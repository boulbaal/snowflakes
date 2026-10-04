#!/usr/bin/env python3
"""Iconen voor Snowflakes: een witte sneeuwvlok met zes armen op een nachtblauw vlak."""
import math, os
from PIL import Image, ImageDraw
UIT = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'public')
def vlok(d, cx, cy, r, w, kleur):
    for k in range(6):
        a = math.pi / 2 + k * math.pi / 3
        ex, ey = cx + math.cos(a) * r, cy - math.sin(a) * r
        d.line([(cx, cy), (ex, ey)], fill=kleur, width=w)
        for f, l in ((0.45, 0.32), (0.72, 0.22)):          # twee paar zijtakjes per arm
            bx, by = cx + math.cos(a) * r * f, cy - math.sin(a) * r * f
            for s in (-1, 1):
                b = a + s * math.pi / 3
                d.line([(bx, by), (bx + math.cos(b) * r * l, by - math.sin(b) * r * l)], fill=kleur, width=w)
        d.ellipse([ex - w * .6, ey - w * .6, ex + w * .6, ey + w * .6], fill=kleur)
    d.ellipse([cx - w * 1.4, cy - w * 1.4, cx + w * 1.4, cy + w * 1.4], fill=kleur)
def icoon(n, rand, maskable=False):
    S = n * 4
    im = Image.new('RGBA', (S, S), (0, 0, 0, 0))
    d = ImageDraw.Draw(im)
    # verloop van boven (lichter blauw) naar onder (nacht)
    achter = Image.new('RGBA', (S, S))
    for y in range(S):
        t = y / S
        c = tuple(int(a + (b - a) * t) for a, b in zip((28, 66, 120), (9, 22, 44))) + (255,)
        ImageDraw.Draw(achter).line([(0, y), (S, y)], fill=c)
    masker = Image.new('L', (S, S), 0)
    if maskable:
        ImageDraw.Draw(masker).rectangle([0, 0, S, S], fill=255)
    else:
        ImageDraw.Draw(masker).rounded_rectangle([0, 0, S - 1, S - 1], radius=int(S * 0.22), fill=255)
    im.paste(achter, (0, 0), masker)
    r = S * (0.30 if maskable else 0.36)
    vlok(d, S / 2, S / 2, r, max(4, int(S * 0.045)), (240, 248, 255, 255))
    return im.resize((n, n), Image.LANCZOS)
for naam, n, m in [('icon-192.png', 192, False), ('icon-512.png', 512, False), ('icon-maskable-192.png', 192, True),
                   ('icon-maskable-512.png', 512, True), ('apple-touch-icon.png', 180, True), ('favicon.png', 64, False)]:
    icoon(n, 0, m).save(os.path.join(UIT, naam))
# deelplaatje 1200x630
og = Image.new('RGB', (1200, 630))
dd = ImageDraw.Draw(og)
for y in range(630):
    t = y / 630
    dd.line([(0, y), (1200, y)], fill=tuple(int(a + (b - a) * t) for a, b in zip((24, 58, 107), (9, 22, 44))))
groot = icoon(360, 0, False)
og.paste(groot, (120, 135), groot)
try:
    from PIL import ImageFont
    f1 = ImageFont.truetype('/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf', 84)
    f2 = ImageFont.truetype('/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf', 34)
    dd.text((540, 220), 'Snowflakes', font=f1, fill=(255, 255, 255))
    dd.text((544, 330), 'Share and swipe snowflakes.', font=f2, fill=(200, 220, 245))
    dd.text((544, 378), 'Free, no ads.', font=f2, fill=(200, 220, 245))
except OSError:
    pass
og.save(os.path.join(UIT, 'og.png'))
print('iconen klaar')
