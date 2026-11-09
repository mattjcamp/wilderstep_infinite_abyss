"""Convert Hallowmere 'Stone House' interiors from Dungeon/Shop tiles to the Manor tileset."""
import json, sys, collections
P = 'web/public/modules/varnfell/maps.json'
pal = {t['id']: t for t in json.load(open('web/public/modules/default/map_tiles.json'))['map_tiles']}
raw = open(P).read(); d = json.loads(raw)
FLOOR = {'dungeon_floor_smooth': 'manor_floor_parquet', 'shop_floor_planks': 'manor_floor_planks'}
BG = {'dungeon/floors/floor_smooth.png': 'manor/floors/floor_parquet.png',
      'shop/floor_planks.png': 'manor/floors/floor_planks.png'}
def target(cid):
    if cid in FLOOR: return FLOOR[cid]
    if cid.startswith('dungeon_wall_') or cid == 'dungeon_door':
        return 'manor_' + cid[len('dungeon_'):]
    return None
houses = [m for m in d['maps'] if m.get('name', '').startswith('Stone House') and 'Hallowmere' in (m.get('tags') or [])]
stats = collections.Counter()
for m in houses:
    for row in m['grid']:
        for cell in row:
            t = target(cell['id'])
            if t:
                assert t in pal, t
                p = pal[t]
                # swap the art + identity only; keep this cell's behaviour (links, locks, light, counters…)
                cell['id'], cell['name'], cell['sprite'], cell['tag'] = p['id'], p['name'], p['sprite'], p['tag']
                stats[t] += 1
            if cell.get('background_sprite') in BG:
                cell['background_sprite'] = BG[cell['background_sprite']]; stats['bg'] += 1
    print(m['id'], '|', m['name'])
left = [c['id'] for m in houses for r in m['grid'] for c in r if c['id'].startswith('dungeon') or 'dungeon/' in (c.get('background_sprite') or '') or 'shop/floor' in (c.get('background_sprite') or '')]
print(dict(stats)); print('leftover dungeon refs:', collections.Counter(left))
if '--write' in sys.argv:
    open(P, 'w').write(json.dumps(d, indent=2) + '\n'); print('written')
