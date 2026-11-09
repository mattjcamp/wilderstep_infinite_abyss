"""Make every Hallowmere Stone House a copy of Stone House 2 (wood_house_3), keeping each
house's own name/description/lighting and its own exit back to town, and re-point the town
doorways at the new entrance (x0, y9)."""
import json, copy, sys
P = 'web/public/modules/varnfell/maps.json'
raw = open(P).read(); d = json.loads(raw)
maps = {m['id']: m for m in d['maps']}
SRC = maps['wood_house_3']
ENTRY = (0, 9)                      # x, y — left-wall doorway in Stone House 2
TARGETS = ['stone_house_1', 'stone_house_2', 'stone_house_3', 'stone_house_4',
           'stone_house_5', 'stone_house_6', 'wood_house_5', 'wood_house_6']
OLD_ENTRY = {i: (10, 11) for i in TARGETS[:6]}
OLD_ENTRY.update({'wood_house_5': (0, 9), 'wood_house_6': (0, 9)})

def exit_link(m):
    ls = [c['link'] for r in m['grid'] for c in r if c.get('link') and c['link'].get('map_id') == 'town_hallowmere_overview']
    assert len(ls) == 1, (m['id'], ls); return ls[0]

# Stone House 2 itself lost its way out when its door became floor: restore it.
ex, ey = ENTRY
if not SRC['grid'][ey][ex].get('link'):
    SRC['grid'][ey][ex]['link'] = {'map_id': 'town_hallowmere_overview', 'x': 33, 'y': 56}
    print('restored Stone House 2 exit')
for i in TARGETS:
    m = maps[i]
    back = exit_link(m)
    m['width'], m['height'] = SRC['width'], SRC['height']
    m['grid'] = copy.deepcopy(SRC['grid'])
    m['grid'][ey][ex]['link'] = dict(back)
    print(i, m['name'], '-> exit', back)
# town doorways
town = maps['town_hallowmere_overview']
for r, row in enumerate(town['grid']):
    for c, cell in enumerate(row):
        l = cell.get('link')
        if l and l.get('map_id') in OLD_ENTRY and (l['x'], l['y']) == OLD_ENTRY[l['map_id']]:
            l['x'], l['y'] = ENTRY; print('town', (c, r), '->', l)
out = json.dumps(d, indent=2) + '\n'
assert json.loads(out)
if '--write' in sys.argv: open(P, 'w').write(out); print('written')
