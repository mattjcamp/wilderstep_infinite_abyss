
# V2 MPV Launch Items

- Show an item's durablity as a progress bar graphic in the both the party and character inventory. 
- add map level attribute to set lighting: world time, day, twilight, darkness
- add soundtrack feature: soundtracks are module level and on random, maps and dungeons can overide the soundtrack if needed

# V3 Ideas

- More Robust Trap System
- New Puzzle system (presure plates that open doors, etc)
- Key system (certain keys open certain doors)

# Notes

## Battle Arena Maps

Target size: 16 cols × 14 rows. That fills the playable interior perfectly. Maps smaller than that anchor at the top-left of the interior with default fill around them; maps larger than that get clipped past col 16 / row 14.

Don't bother painting walls at the outer edges — the engine's perimeter wall covers those.
The combat formation bands sit at rows 1-4 (enemies) and rows 11-14 (party). Leave those bands as walkable floor so combatants spawn cleanly. The middle bands (rows 5-10) are where pillars, pits, and obstacles read best.