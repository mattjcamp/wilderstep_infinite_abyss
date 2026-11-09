"""Make Wood House 2 and 3 copies of Wood House (wood_house_1), keeping each house's own
name/description/lighting and exit back to town, and re-point town doorways at the new entrance."""
import json, copy, sys
P = 'web/public/modules/varnfell/maps.json'
d = json.loads(open(P).read()); maps = {m['id']: m for m in d['maps']}
SRC = maps['wood_house_1']
ex, ey = 8, 11                                     # Wood House's bottom-wall door
assert SRC['grid'][ey][ex].get('link')
# each house returns to the town tile its doorway sits on
BACK = {'wood_house_2': {'map_id': 'town_hallowmere_overview', 'x': 32, 'y': 54},   # had lost its exit link
        'wood_house_4': {'map_id': 'town_hallowmere_overview', 'x': 32, 'y': 50}}
for i, back in BACK.items():
    m = maps[i]
    old = [c['link'] for r in m['grid'] for c in r if c.get('link')]
    assert old in ([], [back]), (i, old)
    m['width'], m['height'] = SRC['width'], SRC['height']
    m['grid'] = copy.deepcopy(SRC['grid'])
    m['grid'][ey][ex]['link'] = dict(back)
    print(i, m['name'], '-> exit', back, '(was', old, ')')
for r, row in enumerate(maps['town_hallowmere_overview']['grid']):
    for c, cell in enumerate(row):
        l = cell.get('link')
        if l and l.get('map_id') in BACK:
            l['x'], l['y'] = ex, ey; print('town', (c, r), '->', l)
if '--write' in sys.argv:
    open(P, 'w').write(json.dumps(d, indent=2) + '\n'); print('written')
