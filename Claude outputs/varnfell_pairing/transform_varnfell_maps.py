#!/usr/bin/env python3
"""Convert Varnfell maps from the original-game art to Default palette tiles.

Usage: python3 transform_varnfell_maps.py <path to web/public/modules>

Every cell drawn with an old sprite (one that only exists in
modules/varnfell/sprites/) is replaced by a copy of a Default palette tile
(modules/default/map_tiles.json). Gameplay fields on the cell (link,
counter, encounter, npc, text, quest, dungeon, item, trap, spawn, locked,
light) are carried over. Walls, paths, brick floors and tables are
auto-tiled from their neighbours. Hallowmere's wall-block buildings are
replaced by 2x2 town houses whose bottom row carries the door link.
"""
import collections, copy, json, os, sys

MOD = sys.argv[1]
PAL = {t['id']: t for t in json.load(open(f'{MOD}/default/map_tiles.json'))['map_tiles']}
OLD_DIR = f'{MOD}/varnfell/sprites/'
TOWN = 'town_hallowmere_overview'
SHRINE_MAP = 'shrine_of_the_deep_ones'
KEEP = ['link', 'show_link_placard', 'counter', 'encounter', 'spawn', 'npc',
        'text', 'quest', 'dungeon', 'item', 'trap']

def old_name(c):
    s = c.get('sprite') or ''
    return s[4:-4] if s.startswith('map/') and os.path.exists(OLD_DIR + s) else None

GRASS = {'grass1', 'grass2', 'grass1_snowy', 'sand', 'lava_vent', 'poison_swamp'}
SIMPLE = {
    'water': 'water', 'swamp': 'overworld_swamp',
    'forest2': 'overworld_forest', 'forest_maple01': 'overworld_forest',
    'forest_maple02': 'overworld_forest', 'forest_maple03': 'overworld_forest',
    'forest_mixed01': 'overworld_forest', 'forest_mixed02': 'overworld_dense_forest',
    'forest_mixed03': 'overworld_dense_forest', 'forest_canopy02': 'overworld_dense_forest',
    'jungle_big': 'overworld_dense_forest', 'island_jungle': 'overworld_island',
    'forest_pine01': 'overworld_pine_forest', 'forest_pine02': 'overworld_pine_forest',
    'forest_pine04': 'overworld_pine_forest', 'forest_pine05': 'overworld_pine_forest',
    'forest_pine06': 'overworld_pine_forest', 'tree_pine12': 'overworld_pine_forest',
    'tree_pine01': 'overworld_tree_pine', 'tree_pine02': 'overworld_tree_pine',
    'tree_pine10': 'overworld_tree_pine', 'tree_pine11': 'overworld_tree_pine',
    'tree_pine07': 'overworld_tree_fir', 'tree_pine08': 'overworld_tree_fir',
    'tree_maple01': 'overworld_tree_oak', 'apple_tree': 'overworld_tree_oak',
    'L2_TreeMaple01': 'town_tree_large_1', 'berrybush': 'town_bush',
    'mountain_desert01': 'mountain', 'mountain_desert02': 'overworld_mountain_small',
    'mountain_desert03': 'overworld_hill_large', 'mountain_desert04': 'overworld_hills',
    'mountain_desert05': 'overworld_mountain_range', 'mountain_desert06': 'overworld_cliffs',
    'mountain_rocky02': 'overworld_rock_spires', 'mountain_rocky03': 'overworld_mountain_high',
    'mountain_rocky04': 'overworld_cliff', 'mountain_snowy01': 'overworld_mountain_high',
    'mountain_snowy02': 'overworld_mountain_range', 'mountain_snowy03': 'overworld_mountain_high',
    'village': 'overworld_village', 'L2_Tower': 'overworld_watchtower',
    'ruined_tower': 'overworld_keep', 'dome': 'overworld_shrine', 'shrine': 'overworld_shrine',
    'dungeon_entrance_1': 'overworld_cave_entrance', 'dungeon_entrance_2': 'overworld_cave_entrance',
    'graveyard': 'town_gravestone', 'bridge_copy': 'bridge', 'ship_frigate': 'ship',
    'shop_sign': 'object_signpost', 'chest_tile': 'object_chest',
    'rubble_collapse': 'dungeon_rubble', 'rubble_collapse_pillar': 'dungeon_pillar',
    'counter': 'shop_table_single', 'altar': 'shrine_table_single',
    'locked_door': 'dungeon_door', 'gate': 'dungeon_wall_portcullis',
    'doorway_dark': 'dungeon_wall_archway', 'doorway_dark_marble': 'dungeon_wall_archway',
    'stairs_entrance_rough': 'cave_stairs', 'stairs_entrance_braced': 'dungeon_stairs',
    'floor_brown': 'shop_floor_planks', 'floor_gray': 'dungeon_floor_smooth',
    'town_floor': 'dungeon_floor_flagstone',
}
SHRINE_OVERRIDE = {'floor_gray': 'shrine_floor_plain', 'town_floor': 'shrine_floor',
                   'counter': 'shrine_table_single', 'tree_maple01': 'town_tree_small_1'}
WALL_FAMILY = {
    'wall_planks_dark': 'shop', 'wall_planks': 'shop', 'wall_planks_light': 'shop',
    'brick_wall_brown': 'shop', 'wall_masonry_dark': 'dungeon', 'wall_masonry': 'dungeon',
    'wall_masonry_light': 'dungeon', 'wall_fieldstone_dark': 'dungeon',
    'wall_fieldstone_light': 'dungeon', 'stone_wall': 'dungeon', 'wall_light': 'dungeon',
    'brick_wall_red': 'dungeon', 'mountains': 'cave',
}
DOORS = {'dungeon_door', 'door_a', 'door_a_boulder', 'door_a_braced', 'door_a_pillar',
         'door_b', 'door_b_rough'}
BUILDING_DOORS = {'building_alchemist', 'building_armory', 'building_inn', 'building_outfitter',
                  'building_weaponsmith', 'building_temple_boulder', 'building_templar_hall_boulder'}
WOOD = {'wall_planks_dark', 'wall_planks', 'wall_planks_light', 'brick_wall_brown'}

def piece(fam, name):
    """Palette id for a wall-family piece, with fallbacks for missing pieces."""
    pre = {'shop': 'shop_wall_', 'shrine': 'shrine_wall_', 'dungeon': 'dungeon_wall_',
           'cave': 'cave_wall_'}[fam]
    chain = {'solid': ['_solid', 'top'], 'bottom': ['bottom', 'top'], 'divider': ['divider', 'left'],
             'corner_bl': ['corner_bl', 'left'], 'corner_br': ['corner_br', 'right']}.get(name, [name])
    for n in chain:
        if n == '_solid':
            if fam + '_wall' in PAL: return fam + '_wall'
            continue
        if pre + n in PAL: return pre + n
    return pre + 'top'

DOOR_OF = {'shop': 'shop_door', 'shrine': 'shrine_door', 'dungeon': 'dungeon_door', 'cave': 'cave_door'}
WIN_OF = {'shop': 'shop_window_single', 'shrine': 'shrine_window_single', 'dungeon': 'dungeon_wall_window'}

def kind(e):
    if e['id'] == TOWN: return 'town'
    if 'overview' in [t.lower() for t in e.get('tags', [])]: return 'overworld'
    if 'battle_screen_arena' in e.get('tags', []): return 'arena'
    return 'interior'

def tile(pid, old):
    t = copy.deepcopy(PAL[pid])
    if old is not None:
        for k in KEEP:
            if old.get(k) not in (None, '', False):
                t[k] = copy.deepcopy(old[k])
        if old.get('locked'): t['locked'] = True
        if old.get('light_source'):
            t['light_source'] = True; t['light_range'] = old.get('light_range', 0)
        if isinstance(old.get('link'), dict) and old['link'].get('map_id'):
            t['walkable'] = bool(old.get('walkable', True))
    return t

N4 = [(0, -1, 'N'), (1, 0, 'E'), (0, 1, 'S'), (-1, 0, 'W')]
PATH_PIECE = {'NS': 'straight_v', 'EW': 'straight_h', 'ES': 'bend_tl', 'SW': 'bend_tr',
              'NE': 'bend_bl', 'NW': 'bend_br', 'NESW': 'cross', 'ESW': 't_down',
              'NSW': 't_left', 'NES': 't_right', 'NEW': 't_up',
              'N': 'end_down', 'S': 'end_up', 'E': 'end_left', 'W': 'end_right', '': 'cross'}

def path_id(prefix, mask):
    p = PATH_PIECE[mask]
    if prefix == 'town_brick_path_' and p.startswith('end'):
        p = 'straight_v' if mask in ('N', 'S') else 'straight_h'
    return prefix + p

def transform(e, report):
    W, H, g = e['width'], e['height'], e['grid']
    k = kind(e)
    names = [[old_name(c) for c in row] for row in g]
    inb = lambda x, y: 0 <= x < W and 0 <= y < H
    new = [[None] * W for _ in range(H)]   # palette id per changed cell
    extra_link = {}                        # (x,y) -> link dict copied onto house cells

    fams = collections.Counter(WALL_FAMILY[n] for r in names for n in r if n in WALL_FAMILY)
    if e['id'] == SHRINE_MAP: fams = collections.Counter({'shrine': 1})
    dom = fams.most_common(1)[0][0] if fams else 'dungeon'

    def has_link(x, y):
        l = g[y][x].get('link'); return isinstance(l, dict) and bool(l.get('map_id'))

    # ---------- Hallowmere: buildings -> 2x2 houses ----------
    if k == 'town':
        TW = set(WALL_FAMILY) | DOORS | BUILDING_DOORS | {'window', 'gate', 'locked_door', 'doorway_dark', 'doorway_dark_marble'}
        wallish = lambda x, y: names[y][x] in TW and not (names[y][x] == 'mountains')
        seen = set()
        for sy in range(H):
            for sx in range(W):
                if (sx, sy) in seen or not wallish(sx, sy): continue
                comp, q = [], [(sx, sy)]; seen.add((sx, sy))
                while q:
                    x, y = q.pop(); comp.append((x, y))
                    for dx, dy, _ in N4:
                        nx, ny = x + dx, y + dy
                        if inb(nx, ny) and (nx, ny) not in seen and wallish(nx, ny):
                            seen.add((nx, ny)); q.append((nx, ny))
                links = [p for p in comp if has_link(*p)]
                if not links:
                    edge = any(x in (0, W - 1) or y in (0, H - 1) for x, y in comp)
                    for x, y in comp:
                        if x in (0, W - 1) or y in (0, H - 1):
                            new[y][x] = 'town_path_end_up' if names[y][x] in TW - set(WALL_FAMILY) else 'overworld_dense_forest'
                        else:
                            new[y][x] = 'town_bush'
                    report.append(f'{e["id"]}: {len(comp)} wall cells without a door -> '
                                  + ('forest border / hedges' if edge else 'hedges'))
                    continue
                # assign every cell to its nearest door (multi-source BFS)
                owner, q = {p: p for p in links}, collections.deque(links)
                cset = set(comp)
                while q:
                    x, y = q.popleft()
                    for dx, dy, _ in N4:
                        n = (x + dx, y + dy)
                        if n in cset and n not in owner: owner[n] = owner[(x, y)]; q.append(n)
                groups = collections.defaultdict(list)
                for p, o in owner.items(): groups[o].append(p)
                for (lx, ly), cells in groups.items():
                    cs = set(cells)
                    target = g[ly][lx]['link']['map_id']
                    if target == SHRINE_MAP: style = 'town_shrine_'
                    elif 'town_hall' in target: style = 'town_chapel_'
                    else:
                        wood = sum(names[y][x] in WOOD for x, y in cells)
                        style = 'town_house_timber_shop_' if wood * 2 >= len(cells) else 'town_house_stone_1_'
                    if (lx + 1, ly) in cs or (lx - 1, ly) not in cs: cols = (lx, lx + 1)
                    else: cols = (lx - 1, lx)
                    if not inb(cols[1], ly): cols = (lx - 1, lx)
                    for x, y in cells: new[y][x] = 'grass'
                    for ci, x in enumerate(cols):
                        for ri, y in ((0, ly - 1), (1, ly)):
                            if not inb(x, y): continue
                            if has_link(x, y) and (x, y) != (lx, ly) and ri == 0:
                                report.append(f'{e["id"]}: house roof at ({x},{y}) overlaps another door; left it')
                                continue
                            new[y][x] = f'{style}r{ri}c{ci}'
                            if ri == 1 and (x, y) != (lx, ly) and not has_link(x, y):
                                extra_link[(x, y)] = (lx, ly)
                    report.append(f'{e["id"]}: house {style.rstrip("_")} at cols {cols} rows {ly-1}-{ly} -> {target}')

    # ---------- per-cell roles (static masks, computed once) ----------
    WALLISH = set(WALL_FAMILY) | DOORS | BUILDING_DOORS | {'window', 'gate', 'locked_door', 'doorway_dark', 'doorway_dark_marble'}
    wallmask = [[(names[y][x] in WALLISH and not new[y][x]) for x in range(W)] for y in range(H)]
    def is_wall(x, y): return inb(x, y) and wallmask[y][x]
    def is_floor(x, y): return inb(x, y) and not wallmask[y][x]
    def fam_at(x, y):
        if e['id'] == SHRINE_MAP: return 'shrine'
        c = collections.Counter()
        for dx in (-1, 0, 1):
            for dy in (-1, 0, 1):
                if inb(x + dx, y + dy) and names[y + dy][x + dx] in WALL_FAMILY:
                    c[WALL_FAMILY[names[y + dy][x + dx]]] += 1
        return c.most_common(1)[0][0] if c else dom

    def wall_piece(x, y, fam):
        F = {d: is_floor(x + dx, y + dy) for dx, dy, d in N4}
        if F['S']: return piece(fam, 'top')
        if F['N']: return piece(fam, 'bottom' if fam == 'shrine' else 'top')
        if F['E'] and F['W']: return piece(fam, 'divider')
        if F['E']: return piece(fam, 'left')
        if F['W']: return piece(fam, 'right')
        if is_floor(x + 1, y + 1): return piece(fam, 'corner_tl')
        if is_floor(x - 1, y + 1): return piece(fam, 'corner_tr')
        if is_floor(x + 1, y - 1): return piece(fam, 'corner_bl')
        if is_floor(x - 1, y - 1): return piece(fam, 'corner_br')
        return piece(fam, 'solid')

    road = lambda x, y: inb(x, y) and (names[y][x] == 'path' or has_link(x, y) or names[y][x] == 'bridge_copy')
    brick = lambda x, y: inb(x, y) and names[y][x] in ('floor_brown', 'floor_gray', 'town_floor')

    for y in range(H):
        for x in range(W):
            n = names[y][x]
            if n is None or new[y][x]: continue
            if n in GRASS: pid = 'grass'
            elif n == 'path':
                if k in ('overworld', 'town'):
                    mask = ''.join(d for dx, dy, d in N4 if road(x + dx, y + dy))
                    pid = path_id('town_path_', mask)
                else: pid = 'cave_floor_dirt'
            elif k == 'town' and n in ('floor_brown', 'floor_gray', 'town_floor'):
                pid = 'dungeon_floor_cobble'   # paved plaza; brick-path pieces only suit 1-wide roads
            elif n in WALL_FAMILY:
                pid = wall_piece(x, y, 'shrine' if e['id'] == SHRINE_MAP else WALL_FAMILY[n])
            elif n in DOORS or n in BUILDING_DOORS:
                pid = DOOR_OF[fam_at(x, y)]
            elif n == 'window':
                fam = fam_at(x, y)
                vertical = not (is_floor(x, y + 1) or is_floor(x, y - 1))
                pid = wall_piece(x, y, fam) if vertical or fam not in WIN_OF else WIN_OF[fam]
            elif n in ('stairs_down', 'stairs_up'):
                fam = 'cave' if dom == 'cave' or e['id'] == 'otto_inn_2' else 'dungeon'
                pid = f'{fam}_stairs' + ('_up' if n == 'stairs_up' else '')
            elif n == 'table':
                pre = 'shrine_table_' if e['id'] == SHRINE_MAP else 'shop_table_'
                T = lambda a, b: inb(a, b) and names[b][a] == 'table'
                if T(x - 1, y) or T(x + 1, y):
                    pid = pre + ('h_left' if not T(x - 1, y) else 'h_right' if not T(x + 1, y) else 'h_mid')
                elif T(x, y - 1) or T(x, y + 1):
                    pid = pre + ('v_top' if not T(x, y - 1) else 'v_bottom' if not T(x, y + 1) else 'v_mid')
                else: pid = pre + 'single'
            elif e['id'] == SHRINE_MAP and n in SHRINE_OVERRIDE: pid = SHRINE_OVERRIDE[n]
            elif n == 'tree_maple01' and k == 'interior': pid = 'town_tree_small_1'
            elif n in SIMPLE: pid = SIMPLE[n]
            else:
                report.append(f'{e["id"]}: no rule for {n} at ({x},{y})'); continue
            new[y][x] = pid

    # ---------- write cells ----------
    for y in range(H):
        for x in range(W):
            if not new[y][x]: continue
            old = g[y][x]
            t = tile(new[y][x], old)
            if (x, y) in extra_link:
                lx, ly = extra_link[(x, y)]
                src = g[ly][lx]
                t['link'] = copy.deepcopy(src['link']); t['walkable'] = True
                if src.get('show_link_placard'): t['show_link_placard'] = True
            g[y][x] = t

    # ---------- backgrounds: put objects and wall edges on the floor they stand on ----------
    FLOOR_BG = ('map/grass.png', 'shop/floor_planks.png', 'shrine/floor.png', 'shrine/floor_alt.png', 'shrine/floor_plain.png')
    def floorish(c):
        s = c.get('sprite', '')
        return not c.get('background_sprite') and (s in FLOOR_BG or '/floors/' in s)
    def needs_bg(pid):
        if pid in ('shop_wall_top', 'shop_wall_bottom', 'shop_wall', 'shrine_wall', 'shrine_wall_top', 'shrine_wall_bottom'):
            return False
        return pid.startswith(('object_', 'town_tree', 'town_bush', 'town_gravestone', 'overworld_', 'mountain',
                               'dungeon_rubble', 'dungeon_pillar', 'dungeon_door', 'cave_door', 'dungeon_stairs',
                               'cave_stairs', 'shop_wall', 'shrine_wall', 'dungeon_wall', 'cave_wall')) or '_table_' in pid
    for y in range(H):
        for x in range(W):
            pid = new[y][x]
            if not pid: continue
            c = g[y][x]
            if pid in ('overworld_island', 'bridge', 'ship'):
                c['background_sprite'] = 'water/water.png'; continue
            if not needs_bg(pid): continue
            cnt = collections.Counter()
            for dx in (-1, 0, 1):
                for dy in (-1, 0, 1):
                    if (dx or dy) and inb(x + dx, y + dy) and floorish(g[y + dy][x + dx]):
                        cnt[g[y + dy][x + dx]['sprite']] += 1
            if cnt: c['background_sprite'] = cnt.most_common(1)[0][0]
            elif not c.get('background_sprite') and k != 'interior': c['background_sprite'] = 'map/grass.png'

if __name__ == '__main__':
    path = f'{MOD}/varnfell/maps.json'
    data = json.load(open(path, encoding='utf-8'))
    report = []
    for e in data['maps']: transform(e, report)
    open(path, 'w', encoding='utf-8').write(json.dumps(data, indent=2, ensure_ascii=False) + '\n')
    print('\n'.join(report))
