import json, sys
from PIL import Image, ImageDraw
SP = 'web/public/modules/default/sprites/'
cache = {}
def img(rel):
    if rel not in cache:
        try: cache[rel] = Image.open(SP + rel).convert('RGBA').resize((32, 32), Image.NEAREST)
        except Exception: cache[rel] = Image.new('RGBA', (32, 32), (255, 0, 255, 255))
    return cache[rel]
def render(m):
    W, H = m['width'], m['height']
    im = Image.new('RGBA', (W * 32, H * 32), (12, 10, 14, 255))
    for r, row in enumerate(m['grid']):
        for c, cell in enumerate(row):
            if cell.get('background_sprite'): im.alpha_composite(img(cell['background_sprite']), (c * 32, r * 32))
            if cell.get('sprite'): im.alpha_composite(img(cell['sprite']), (c * 32, r * 32))
    return im
before = {m['id']: m for m in json.load(open(sys.argv[1]))['maps']}
after = {m['id']: m for m in json.load(open(sys.argv[2]))['maps']}
ids = sys.argv[4:]
tiles = [(render(before[i]), render(after[i]), after[i]['name']) for i in ids]
w = max(a.width for a, _, _ in tiles); h = sum(a.height + 20 for a, _, _ in tiles)
out = Image.new('RGBA', (w * 2 + 16, h), (40, 40, 48, 255)); d = ImageDraw.Draw(out); y = 0
for a, b, n in tiles:
    d.text((4, y + 4), n + '  (before | after)', fill=(230, 230, 230, 255)); y += 18
    out.alpha_composite(a, (0, y)); out.alpha_composite(b, (w + 16, y)); y += a.height + 2
out.save(sys.argv[3])
