npm run dev:all

- in combat screen, add a dice roll area
- in combat screen, allow custom maps (perhaps constrained to set rows and cols)
- add combat screen polish (lighting bolt, fireball, other magical effects)

## Wishlist (long-term, not currently scoped)

- SFX picker — the sfx / hit_sfx fields on Spells and Ability.params.sfx are
  inert v1-era identifiers today. Long-term, treat sfx like sprites: an
  /sfx asset folder with a small AudioPicker component and an index.json,
  so authors can browse + pick audio for cast / hit / ability invocation.
  Path 2 in the audit response.
