## Preliminary for Game Implementation

2. A real /play route. Today everything testable lives under /editor/.... The /play page is a stub. Whatever your intended entry point is — a New Game / Continue chooser, picking a module, dropping the party on the configured start_position — needs to exist. The MapEditor's sim mode does basically the right movement work, but it's bundled with the painting UI; you'll want a slimmed-down host that's just the scene + party panel + simulator kernel.

Play Workflow:
    Return to Game
        - resume playing at last save
    New Game
        - Choose Module
        - Form Tye Party (create characters and form the party)
        - View Beginning screen based on the description of the module (takes up whole screen, players can "press any key" to start playing after a few seconds)
        - The map appears with the party located in the starting position stored in the party's data model
        - When the party moves through links, the game state is saved. This save file is essentially a copy of the module but with the current state of the party and the world
        - If all characters die then the game goes to a grim looking end screen that gives the party a chance to start over from their last saved game

1. Real combat trigger from the spawn/encounter flow. Right now the simulator shows a Win/Flee dialog when the party bumps into a spawn or placed-encounter monster. That dialog is a stand-in. The actual combat scene lives at /editor/[moduleId]/sim/battle and isn't reachable from the overworld sim. Gameplay needs:

spawn_encountered → mount CombatScene (same one the battle sim uses) with the encounter's roster + the right arena map
Combat resolves (victory / flee / TPK) → control returns to the overworld sim with HP/MP/inventory synced, defeated lairs marked, etc.
The infravision activation flag, party light state, and any other party-level state should carry through the round-trip.

This is the biggest architectural gap. Without it, "wired-up gameplay" doesn't really exist yet — there's a battle simulator and there's a movement simulator, with a dialog in between.

# V3 Ideas

- More Robust Trap System
- New Puzzle system (presure plates that open doors, etc)
- Key system (certain keys open certain doors)