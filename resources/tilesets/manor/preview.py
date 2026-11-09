import os, sys
from PIL import Image, ImageDraw
OUT = sys.argv[1]; dst = sys.argv[2]
def L(rel): return Image.open(os.path.join(OUT, rel)).convert("RGBA")
BG = (12, 10, 14, 255)
def cell(fg, bg=None):
    im = Image.new("RGBA", (64, 64), BG)
    if bg: im.alpha_composite(L(bg))
    im.alpha_composite(L(fg)); return im
# --- sheet
files = []
for root, _, fs in os.walk(OUT):
    for f in sorted(fs):
        if f.endswith(".png"): files.append(os.path.relpath(os.path.join(root, f), OUT))
files.sort()
cols = 9; rows = (len(files) + cols - 1) // cols
S = Image.new("RGBA", (cols * 70, rows * 80), (40, 40, 48, 255)); d = ImageDraw.Draw(S)
for i, f in enumerate(files):
    x, y = (i % cols) * 70 + 3, (i // cols) * 80 + 2
    bg = "floors/floor_parquet.png" if f.startswith(("rugs", "features")) or "divider" in f or f.endswith(("left.png", "right.png")) and "rug" not in f else None
    S.alpha_composite(cell(f, bg), (x, y)); d.text((x, y + 65), os.path.basename(f)[:-4][:13], fill=(230, 230, 230, 255))
S.save(dst + "_sheet.png")
# --- sample room 10x8
W = "walls/room_walls/"; J = "walls/junctions/"
P = "floors/floor_parquet.png"
g = [[None] * 10 for _ in range(8)]
g[0] = [J+"wall_corner_tl.png", W+"wall_top.png", W+"wall_window.png", W+"wall_top.png", J+"wall_t_down.png",
        W+"wall_top.png", W+"wall_tapestry.png", W+"wall_top.png", W+"wall_window.png", J+"wall_corner_tr.png"]
for r in range(1, 7):
    g[r][0] = W+"wall_left.png"; g[r][9] = W+"wall_right.png"
    for c in range(1, 9): g[r][c] = P
for r in (1, 2):
    g[r][4] = J+"wall_divider.png"
g[3][4] = J+"wall_divider_end.png"
g[7] = [J+"wall_corner_bl.png", W+"wall_top.png", W+"wall_archway.png", W+"wall_top.png", "doors_and_stairs/door.png",
        W+"wall_top.png", W+"wall_gate.png", W+"wall_top.png", W+"wall_top.png", J+"wall_corner_br.png"]
rugs = {(5,4):"rug_corner_tl",(5,5):"rug_top",(5,6):"rug_top",(5,7):"rug_corner_tr",(6,4):"rug_corner_bl",(6,5):"rug_bottom",(6,6):"rug_bottom",(6,7):"rug_corner_br"}
feat = {(1,1):"features/column.png",(1,3):"features/potted_plant.png",(2,6):"features/grand_chair.png",(1,8):"features/column.png",(4,1):"doors_and_stairs/stairs.png",(3,8):"doors_and_stairs/ladder_up.png"}
for r in (1,2,3):
    for c in (5,6,7): g[r][c] = "floors/floor_carpet.png" if c==6 else "floors/floor_checker.png"
R = Image.new("RGBA", (640, 512), BG)
for r in range(8):
    for c in range(10):
        f = g[r][c]; bg = None
        if (r, c) in rugs: f, bg = "rugs/%s.png" % rugs[(r, c)], P
        if (r, c) in feat: f, bg = feat[(r, c)], P
        if f.endswith(("wall_left.png", "wall_right.png", "wall_divider.png", "wall_divider_end.png")): bg = P
        R.alpha_composite(cell(f, bg), (c * 64, r * 64))
R.save(dst + "_room.png")
R.resize((320, 256), Image.LANCZOS).save(dst + "_room_game.png")
