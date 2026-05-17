npm run dev:all

## Remaining Features


## Technical Debt

THe public folder seems to have somehow gotten the v1 assets copied into it. We don't want that.

10. MapEditor and DungeonSimMount have duplicated Phaser scaffolding. Lighting + animation configs are shared now, but each has its own ~600-line scene class. If you keep adding game systems (combat overlays, dialog, party UI), they'll drift again. Worth a refactor at some point to a shared "world scene" that the editor wraps and the play page mounts directly. Not urgent.

11. CombatScene is still in v1battle/ and reads v2 data natively — that's working but the file's heritage is the Python port. Tests under that path have ~282 pre-existing failures (CombatBridge dice math, vfx animationsCatalog, Combat passives) that you'll want to clean up before adding more combat features so regressions are visible. If you want, I can take a pass at those before the gameplay wiring.

12. No CI test step. We're at 87 sim/lighting/dungeon tests, all passing, plus a working next build gate. CI only runs the build, not the tests. Wiring vitest run into the deploy workflow + adding vitest as a devDep would let regressions show up before they hit you in the simulator.

## Preliminary

2. A real /play route. Today everything testable lives under /editor/.... The /play page is a stub. Whatever your intended entry point is — a New Game / Continue chooser, picking a module, dropping the party on the configured start_position — needs to exist. The MapEditor's sim mode does basically the right movement work, but it's bundled with the painting UI; you'll want a slimmed-down host that's just the scene + party panel + simulator kernel.

1. Real combat trigger from the spawn/encounter flow. Right now the simulator shows a Win/Flee dialog when the party bumps into a spawn or placed-encounter monster. That dialog is a stand-in. The actual combat scene lives at /editor/[moduleId]/sim/battle and isn't reachable from the overworld sim. Gameplay needs:

spawn_encountered → mount CombatScene (same one the battle sim uses) with the encounter's roster + the right arena map
Combat resolves (victory / flee / TPK) → control returns to the overworld sim with HP/MP/inventory synced, defeated lairs marked, etc.
The infravision activation flag, party light state, and any other party-level state should carry through the round-trip.

This is the biggest architectural gap. Without it, "wired-up gameplay" doesn't really exist yet — there's a battle simulator and there's a movement simulator, with a dialog in between.

# V3 Ideas

- More Robust Trap System
- New Puzzle system (presure plates that open doors, etc)
- Key system (certain keys open certain doors)