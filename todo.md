
# Playthrough Polish

- Return dungeons to their original intended state of being procedurally generated and resuable on a per game level. So, we should have variations of one dungeon that has a unique layout for each game. And we can use a dungeon data model multiple times on one map and each one would be unique within the game. Dungeons can still be used to seed maps, but quests may need to be limited to simple steps like "reach bottom floor" aka: seplunking quest.

seplunking quest

## Big Ideas

- New Puzzle system (presure plates that open doors, etc)
- Key system (certain keys open certain doors, party gets a keyring)
- More Robust Trap System: Traps data model, explosive, poison, teleporting. Traps should now be placeable directly on the map

# Notes

## Battle Arena Maps

Target size: 16 cols × 14 rows. That fills the playable interior perfectly. Maps smaller than that anchor at the top-left of the interior with default fill around them; maps larger than that get clipped past col 16 / row 14.

Don't bother painting walls at the outer edges — the engine's perimeter wall covers those.
The combat formation bands sit at rows 1-4 (enemies) and rows 11-14 (party). Leave those bands as walkable floor so combatants spawn cleanly. The middle bands (rows 5-10) are where pillars, pits, and obstacles read best.
