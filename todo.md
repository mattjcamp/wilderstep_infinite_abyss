
# Polish

# V3 Ideas

- More Robust Trap System
- New Puzzle system (presure plates that open doors, etc)
- Key system (certain keys open certain doors)
- Add place description placard to linked tiles as optional. It would worked by selecting showLinkPlacard option. Then when the party is over that tile they will get the placard with the linked map description and an indication whether they have explored that area yet

# Technical Debt

## Large Data Storage Issues

Modules take up a lot of space and we may need to rethink how they are engineered. These were the options we could consider. It may also impact the notion that we will be thinking of creating a system were people can share modules so that is worth considering as part of the refactor.

Yeah, agreed — flag it for v3. The bake-specific fallback handles your current use case (the one that surfaced the issue), and the rest of the editor's quota story is a more involved redesign worth doing once when it's the focus, not piecemeal.
When you get to it, three options to weigh:

IndexedDB instead of localStorage for drafts. Same key-value semantics, ~100× the quota, async API. Touches every call site in draft.ts but the surface area is small.
Compression (CompressionStream is browser-native, no dependency). Gzip on JSON shrinks ~5–10×. Smaller change, but quota's still a ceiling for very large modules.
Sparse cell storage — store only the deltas from a referenced palette tile id instead of the full inline cell. ~5× shrink on dungeon-style maps that are mostly walls + floors. Bigger refactor but solves it at the source.

A combination (sparse cells + IndexedDB) probably handles even very large modules comfortably. None of it needs to happen today.

# Notes

## Battle Arena Maps

Target size: 16 cols × 14 rows. That fills the playable interior perfectly. Maps smaller than that anchor at the top-left of the interior with default fill around them; maps larger than that get clipped past col 16 / row 14.

Don't bother painting walls at the outer edges — the engine's perimeter wall covers those.
The combat formation bands sit at rows 1-4 (enemies) and rows 11-14 (party). Leave those bands as walkable floor so combatants spawn cleanly. The middle bands (rows 5-10) are where pillars, pits, and obstacles read best.