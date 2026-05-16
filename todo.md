npm run dev:all

- add Fill feature to Map Editor
- add combat screen polish (lighting bolt, fireball, other magical effects, directional spells should burst on obstructions)
- in combat screen, add a dice roll area? Think through how this impacts the UI since it's tight already
## Wishlist (long-term, not currently scoped)

- SFX picker — the sfx / hit_sfx fields on Spells and Ability.params.sfx are
  inert v1-era identifiers today. Long-term, treat sfx like sprites: an
  /sfx asset folder with a small AudioPicker component and an index.json,
  so authors can browse + pick audio for cast / hit / ability invocation.
  Path 2 in the audit response.
