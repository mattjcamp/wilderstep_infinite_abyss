## Start App Varations

npm run dev:all          # LOCAL mode — static modules, publishes to web/public/ via publish-server

npm run dev:remote   # REMOTE mode — hosted catalog, publishes to the cloud as @matt


## Big Ideas

- Implement module publishing for players

## New Content for v2

- We will need fresh spell content past level 7-10 (sorcerer: Recall, Meteor Shower, Void Orb; priest: Day Light, Divine Smite, Resurrection
- Relic Quest: add a relic quest that provides an unlock for high level spells and abilities. After level 10, characters must complete Relic Quests to get a new spell. Relic quests will have level and class pre-reqs. Relic Quests could be initiated via the Character Sheet.

# Notes

## Battle Arena Maps

Target size: 16 cols × 14 rows. That fills the playable interior perfectly. Maps smaller than that anchor at the top-left of the interior with default fill around them; maps larger than that get clipped past col 16 / row 14.

Don't bother painting walls at the outer edges — the engine's perimeter wall covers those.
The combat formation bands sit at rows 1-4 (enemies) and rows 11-14 (party). Leave those bands as walkable floor so combatants spawn cleanly. The middle bands (rows 5-10) are where pillars, pits, and obstacles read best.

## Herbalism

It's data-driven from the `herbalism` ability record, not hard-coded per tile. The chain:

1. **On each step**, PlayHost (~line 3075) reads the tile id of the cell the party just stepped onto: `cat.map.grid[row][col]` (either the string id or the cell's `.id`), and passes it to `herbalismOnStep`.

2. **The tile whitelist** comes from `params.terrain` on the `herbalism` ability in `abilities.json` (default module):

```json
"terrain": ["grass", "grass2", "forest", "palm_tree"]
```

`herbalismTerrain()` in `web/src/play/herbalism.ts` reads that list; if the tile id isn't in it, no roll happens. If the catalog lacks the param entirely, the code falls back to the same four ids (`DEFAULT_TERRAIN`).

3. **If the tile qualifies**, it then needs an alive Druid or Alchemist in the party, and rolls `find_chance` (0.02, doubled to 0.04 for an Alchemist — both knobs also in `params`). On a hit, the reagent is a uniform pick from every item in `items.json` with `item_type: "reagent"` or `"herb"`.

So to make a new tile forageable, add its tile id to the `terrain` array in `abilities.json` — no code change. Note it matches the map-tile palette id exactly, so visual variants (like `grass2`) each need their own entry.

# Quote

"when we die, we stand in the court of our former selves. I worndr how I will be judged... Will they wonder why I spent so much much time in life looking for middle ages versions of ABBA songs"