#!/usr/bin/env python3
"""Round off coastlines by swapping shore water cells for Default "Lake" tiles.

Usage: python3 round_coastlines.py <modules dir> <module id> <map id> [<map id> ...]

A water cell touching land becomes the matching lake piece:
  land on one side           -> lake_edge_<side>      (edge_top = land to the north)
  land on two adjacent sides -> lake_corner_<tl|tr|bl|br> (rounded outer corner)
  land only diagonally       -> lake_inner_<corner>  (notch), or lake_inlet_<side>
                                when both diagonals on one side are land
Water squeezed between land on opposite sides (1-tile channels, single
tiles) has no matching piece and stays plain water. The map border counts
as open water. Gameplay fields on the cell (link, encounter, text, ...)
are kept. Running it again recomputes every shore cell, so it is safe to
rerun after editing the coastline.
"""
import copy, json, sys

MOD, MODULE, MAP_IDS = sys.argv[1], sys.argv[2], set(sys.argv[3:])
PAL = {t['id']: t for t in json.load(open(f'{MOD}/default/map_tiles.json'))['map_tiles']}
KEEP = ['link', 'show_link_placard', 'counter', 'encounter', 'spawn', 'npc',
        'text', 'quest', 'dungeon', 'item', 'trap']
WATERISH = {'overworld_island', 'bridge', 'ship', 'boat_small'}

def is_water_tile(c):
    i = c.get('id', '')
    return i == 'water' or i.startswith('lake_')

def pick(land):
    n, e, s, w = land['N'], land['E'], land['S'], land['W']
    orth = n + e + s + w
    if orth == 0:
        d = [k for k in ('NW', 'NE', 'SW', 'SE') if land[k]]
        pairs = {('NW', 'NE'): 'inlet_top', ('SW', 'SE'): 'inlet_bottom',
                 ('NW', 'SW'): 'inlet_left', ('NE', 'SE'): 'inlet_right'}
        if len(d) == 2 and tuple(d) in pairs: return pairs[tuple(d)]
        if d: return 'inner_' + {'NW': 'tl', 'NE': 'tr', 'SW': 'bl', 'SE': 'br'}[d[0]]
        return None
    if (n and s) or (e and w) or orth > 2: return None
    if orth == 2:
        return 'corner_' + ('t' if n else 'b') + ('l' if w else 'r')
    return 'edge_' + ('top' if n else 'bottom' if s else 'left' if w else 'right')

def run(e):
    g, H, W = e['grid'], e['height'], e['width']
    def water(x, y):
        if not (0 <= x < W and 0 <= y < H): return True
        c = g[y][x]
        return is_water_tile(c) or c.get('id', '').startswith('river_') or c.get('id') in WATERISH
    out = []
    for y in range(H):
        for x in range(W):
            c = g[y][x]
            if not is_water_tile(c): continue
            land = {'N': not water(x, y - 1), 'S': not water(x, y + 1),
                    'W': not water(x - 1, y), 'E': not water(x + 1, y)}
            for k, (dx, dy) in {'NW': (-1, -1), 'NE': (1, -1), 'SW': (-1, 1), 'SE': (1, 1)}.items():
                land[k] = not water(x + dx, y + dy)
            p = pick(land)
            pid = f'lake_{p}' if p else 'water'
            if pid == c['id']: continue
            t = copy.deepcopy(PAL[pid])
            for k in KEEP:
                if c.get(k) not in (None, '', False): t[k] = copy.deepcopy(c[k])
            out.append((x, y, pid))
            g[y][x] = t
    return out

if __name__ == '__main__':
    import collections
    path = f'{MOD}/{MODULE}/maps.json'
    data = json.load(open(path, encoding='utf-8'))
    for e in data['maps']:
        if e['id'] in MAP_IDS:
            ch = run(e)
            print(e['id'], len(ch), 'cells changed', dict(collections.Counter(p for _, _, p in ch)))
    open(path, 'w', encoding='utf-8').write(json.dumps(data, indent=2, ensure_ascii=False) + '\n')
