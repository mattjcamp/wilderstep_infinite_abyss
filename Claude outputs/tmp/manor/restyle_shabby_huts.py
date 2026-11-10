"""Apply the fixes made to Shabby Hut (hut1) to the other Shabby Huts, keeping each hut's
own layout quirks (grass/light holes, water, chests, rubble exits) and its exit link."""
import json, copy, sys
P = 'web/public/modules/varnfell/maps.json'
d = json.loads(open(P).read()); maps = {m['id']: m for m in d['maps']}
REF = maps['hut1']['grid']
pal = {t['id']: t for t in json.load(open('web/public/modules/default/map_tiles.json'))['map_tiles']}
DIRT, GRASS_BG, PLANKS = 'cave/floors/floor_dirt.png', 'map/grass.png', 'shop/floor_planks.png'
WALLISH = lambda c: c['id'].startswith(('shop_wall', 'dungeon_wall', 'shop_window'))
DUNGEON_TO_SHOP = {'dungeon_wall_top': 'shop_wall_top', 'dungeon_wall_left': 'shop_wall_left',
                   'dungeon_wall_right': 'shop_wall_right', 'dungeon_wall_corner_tl': 'shop_wall_corner_tl',
                   'dungeon_wall_corner_tr': 'shop_wall_corner_tr'}

def as_tile(cell, tid, bg='keep'):
    p = pal[tid]; out = dict(cell)
    for k in ('id', 'name', 'sprite', 'tag'): out[k] = p[k]
    if bg != 'keep':
        if bg: out['background_sprite'] = bg
        else: out.pop('background_sprite', None)
    return out

def ref(c, r): return copy.deepcopy(REF[r][c])
DIRT_CELL = copy.deepcopy(REF[2][1]); assert DIRT_CELL['id'] == 'cave_floor_dirt' and not DIRT_CELL['light_source']

def restyle(m):
    g = m['grid']; W, H = m['width'], m['height']
    same = (W, H) == (8, 8)
    link = next((c['link'] for row in g for c in row if c.get('link')), None)
    for r in range(H):
        for c in range(W):
            cell = g[r][c]; top, bot = r == 0, r == H - 1
            left, right = c == 0, c == W - 1
            if top or bot:
                if cell.get('link') or not WALLISH(cell) and cell['id'] != 'shop_door':
                    continue                                    # rubble exit etc.
                if same:
                    new = ref(c, r)                             # identical template: hut1's wall row
                elif (left or right):
                    tid = ('shop_wall_corner_' + ('t' if top else 'b') + ('l' if left else 'r'))
                    new = as_tile(cell, tid, PLANKS if cell.get('background_sprite') in (DIRT, PLANKS, None) or tid else 'keep')
                    if cell.get('background_sprite') == GRASS_BG: new['background_sprite'] = GRASS_BG
                    new['light_source'] = cell['light_source']; new['light_range'] = cell['light_range']
                elif top:
                    # hut1's top wall: windows near the ends, a fireplace in between
                    below = g[1][c]['id']
                    hearth = c == 3 and W >= 6 and below != 'grass'   # no fireplace in an open-air ruin
                    src = ref(1, 0) if c in (1, W - 2) else ref(3, 0) if hearth else ref(2, 0)
                    new = src
                else:
                    new = ref(1, 7)                             # plain bottom wall
                if cell.get('link'): new['link'] = cell['link']
                g[r][c] = new
            elif left or right:
                if not WALLISH(cell): continue
                tid = DUNGEON_TO_SHOP.get(cell['id'], cell['id'])
                rc = REF[r][0 if left else 7] if same else None
                if rc is not None and rc['id'] == tid:
                    new = copy.deepcopy(rc)                     # same piece as hut1: take its lighting/bg
                    if cell.get('background_sprite') == GRASS_BG: new['background_sprite'] = GRASS_BG
                    g[r][c] = new
                elif tid != cell['id']:
                    g[r][c] = as_tile(cell, tid)                # dungeon strip -> shop strip, keep the rest
            else:
                if cell['id'] == 'shop_door':                   # hut1 opened its interior doorway
                    g[r][c] = copy.deepcopy(DIRT_CELL)
                elif cell['id'] in DUNGEON_TO_SHOP:
                    g[r][c] = ref(c, r) if same else as_tile(cell, DUNGEON_TO_SHOP[cell['id']])
                elif cell['id'] == 'shop_wall_corner_bl' and False:
                    pass
    # hut_6 is missing its bottom-right corner (a right strip sits there)
    br = g[H - 1][W - 1]
    if br['id'] == 'shop_wall_right':
        g[H - 1][W - 1] = ref(7, 7)
    # bottom-row interior junction corners become plain bottom wall, as in hut1 (3,7)
    for c in range(1, W - 1):
        if g[H - 1][c]['id'] == 'shop_wall_corner_bl': g[H - 1][c] = ref(1, 7)
    # the exit keeps its own link
    links = [cc for row in g for cc in row if cc.get('link')]
    assert len(links) == 1 and links[0]['link'] == link, (m['id'], [x['link'] for x in links], link)

for hid in ['hut1_2', 'hut1_3', 'hut1_4', 'hut1_5', 'hut_6', 'hut_7', 'hut_8']:
    restyle(maps[hid]); print('restyled', hid, maps[hid]['name'])
if '--write' in sys.argv:
    open(P, 'w').write(json.dumps(d, indent=2) + '\n'); print('written')
