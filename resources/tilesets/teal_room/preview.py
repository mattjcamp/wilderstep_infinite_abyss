import os, sys
from PIL import Image, ImageDraw
D = sys.argv[1]
L = lambda n: Image.open(os.path.join(D, n + ".png")).convert("RGBA")

# Assembled room (8x8) — base layer + object overlays.
base = [["wall_corner_tl"] + ["wall_top"] * 6 + ["wall_corner_tr"]]
for r in range(6):
    base.append(["wall_left"] + [("floor_planks" if (r + c) % 3 else "floor_planks_alt") for c in range(6)] + ["wall_right"])
base.append(["wall_corner_bl"] + ["wall_bottom"] * 6 + ["wall_corner_br"])
over = {(1, 1): "crate", (5, 1): "table_v_top", (5, 2): "table_v_mid", (5, 3): "table_v_bottom",
        (1, 3): "table_h_left", (2, 3): "table_h_mid", (3, 3): "table_h_right",
        (2, 0): "lantern", (6, 5): "table_single",
        (2, 7): "window_left", (3, 7): "window_right", (5, 7): "notice_board",
        (4, 7): "lantern", (6, 7): "lantern"}
room = Image.new("RGBA", (512, 512))
for r, row in enumerate(base):
    for c, n in enumerate(row):
        room.alpha_composite(L(n), (c * 64, r * 64))
for (c, r), n in over.items():
    room.alpha_composite(L(n), (c * 64, r * 64))
room.save(os.path.join(D, "_room_preview.png"))

# Contact sheet with names, on a checker so transparency is visible.
names = sorted(f[:-4] for f in os.listdir(D) if f.endswith(".png") and not f.startswith("_"))
cols = 6; cw, ch = 150, 100
sheet = Image.new("RGBA", (cols * cw, ((len(names) + cols - 1) // cols) * ch), (30, 30, 30, 255))
d = ImageDraw.Draw(sheet)
for i, n in enumerate(names):
    x, y = (i % cols) * cw + 43, (i // cols) * ch + 6
    for yy in range(0, 64, 8):
        for xx in range(0, 64, 8):
            d.rectangle([x + xx, y + yy, x + xx + 7, y + yy + 7], fill=(70, 70, 70) if (xx + yy) // 8 % 2 else (50, 50, 50))
    sheet.alpha_composite(L(n), (x, y))
    d.text(((i % cols) * cw + 6, y + 70), n, fill=(230, 230, 230))
sheet.save(os.path.join(D, "_sheet.png"))
print("ok")
