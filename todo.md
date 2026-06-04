
# Playthrough Polish

- When the cleric healed a party member in the party screen, the bars moved the total hit points did not appear to replenise 

## Big Ideas

- Clear dungeon bonus/relic: when a party clears all monsters from certain procedural dungeons they will have a special reward and a portal to the surface. This could also be a way to learn new spells or abilities. This could be instead of the relic system below. Relic bestown new abilities after a certain level. This would require thoughtful design work.

- New Puzzle system (presure plates that open doors, etc)
- More Robust Trap System: Traps data model, explosive, poison, teleporting. Traps should now be placeable directly on the map
- Better Save Game functionality
- Make module publishing available

# Notes

## Battle Arena Maps

Target size: 16 cols × 14 rows. That fills the playable interior perfectly. Maps smaller than that anchor at the top-left of the interior with default fill around them; maps larger than that get clipped past col 16 / row 14.

Don't bother painting walls at the outer edges — the engine's perimeter wall covers those.
The combat formation bands sit at rows 1-4 (enemies) and rows 11-14 (party). Leave those bands as walkable floor so combatants spawn cleanly. The middle bands (rows 5-10) are where pillars, pits, and obstacles read best.
