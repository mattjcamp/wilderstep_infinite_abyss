npm run dev:all


- add Fill feature to Map Editor
- make the reticle adapt to the current state so that it shows range of bows and spells (unless the range is essentially infinite)
- add combat screen polish (lighting bolt, fireball, other magical effects, directional spells should burst on obstructions)
- in combat screen, add a dice roll area? Think through how this impacts the UI since it's tight already
- audit the other v1battle loaders for the same enumeration-style hydrator
  pattern that bit us on `Items` (Item.targeting + Item.range were silently
  dropped because `itemFromRaw` had an explicit per-field copy and nobody
  remembered to update it). Apply the spread + minimal-overrides refactor to:
  `data/monsters.ts` (specFromRaw), `world/Spells.ts` (spellFromRaw),
  `world/Encounters.ts` (fromRaw), `world/Effects.ts` (loader),
  `world/Classes.ts` (classFromRaw / race hydration), `world/Maps.ts`
  (fromRaw), and `world/Party.ts` (memberFromRaw / partyFromRaw). Project
  principle: configuration lives in the data model — loaders should carry
  fields through without a separate copy point to remember.

## Wishlist (long-term, not currently scoped)

- SFX picker — the sfx / hit_sfx fields on Spells and Ability.params.sfx are
  inert v1-era identifiers today. Long-term, treat sfx like sprites: an
  /sfx asset folder with a small AudioPicker component and an index.json,
  so authors can browse + pick audio for cast / hit / ability invocation.
  Path 2 in the audit response.
