
# Playthrough Polish

- When the cleric healed a party member in the party screen, the bars moved the total hit points did not appear to replenise 
- Make a note in the rats quest to hint that some rats or goblins may be in the houses

## Big Ideas

- Relic system: some dungeons have a relic chest somewhere in their deepest level that grants the party one available relic. Relics are powerful one of a kind weapons, new spells otherwise unavailable in any other way (way to get high level spells after level 10) or bestowing magical abilities. Note we have a "relic chest defined already in items". These should be rare but appear enough to provide some progress for high level classes.
- New Puzzle system (presure plates that open doors, etc)
- More Robust Trap System: Traps data model, explosive, poison, teleporting. Traps should now be placeable directly on the map
- Better Save Game functionality
- Make module publishing available

# Notes

## Battle Arena Maps

Target size: 16 cols × 14 rows. That fills the playable interior perfectly. Maps smaller than that anchor at the top-left of the interior with default fill around them; maps larger than that get clipped past col 16 / row 14.

Don't bother painting walls at the outer edges — the engine's perimeter wall covers those.
The combat formation bands sit at rows 1-4 (enemies) and rows 11-14 (party). Leave those bands as walkable floor so combatants spawn cleanly. The middle bands (rows 5-10) are where pillars, pits, and obstacles read best.
