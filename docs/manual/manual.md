# Wilderstep Infinite Abyss — Player's Manual

_Generated 2026-05-24 from the default module's data._

This manual is a quick reference for everything you can pick, equip, learn, brew, or fight. Tables let you compare options at a glance; items are grouped by type and sorted by power so the strongest one in each category is at the top.

---

**Contents**

- [Races](#races)
- [Character Classes](#character-classes)
- [Abilities](#abilities)
- [Spells](#spells)
- [Items](#items)
- [Monsters](#monsters)

---

## Races

Each race grants a set of innate abilities and applies stat modifiers when a character of that race is rolled. Lower `Exp / Lvl` means the race levels up faster; higher means slower.

| Race | Description | STR | DEX | CON | INT | WIS | Exp / Lvl | Abilities |
|---|---|---:|---:|---:|---:|---:|---:|---|
| **Dwarf** | Stout and hardy, dwarves are natural miners and warriors with keen underground senses. | +2 | -1 | +2 | 0 | +1 |  | Infravision |
| **Elf** | Graceful and keen-minded, elves have a natural affinity for magic and sharp senses. | -1 | +1 | -1 | +2 | 0 |  | Nimble |
| **Gnome** | Clever and curious, gnomes combine a knack for tinkering with innate magical talent. | -1 | 0 | 0 | +2 | +1 |  | Tinker |
| **Halfling** | Small and nimble, halflings are surprisingly resilient and hard to hit. | -2 | +2 | 0 | 0 | +1 |  | Pickpocket |
| **Human** | Versatile and adaptable, humans excel in no single area but have no weaknesses. They learn quickly and level up faster than other races. | 0 | 0 | 0 | 0 | 0 | 1125 | Fast Learner |

## Character Classes

Class determines combat role, movement range per turn, which weapons and armor the character can equip, and which spell catalog (if any) they cast from. `Range` is the per-turn movement budget on the battle grid.

| Class | Range | Casting | Allowed Items | Abilities (min level) |
|---|---:|---|---|---|
| **Alchemist** | 4 | sorcerer | fists, dagger, sling, cloth | Herbalism (L1)<br/>Brew Potion (L1) |
| **Cleric** | 2 | priest | fists, club, mace, sling, cloth, leather, chain | Turn Undead (L2) |
| **Druid** | 2 | sorcerer, priest | fists, dagger, club, mace, sling, cloth, leather | Dual Casting (L1)<br/>Herbalism (L1) |
| **Fighter** | 4 | none | fists, dagger, club, mace, sword, axe, halberd, spear, gloves, sling, short_bow, long_bow, crossbow, rock, cloth, leather, chain, plate, exotic | — |
| **Paladin** | 4 | priest | fists, dagger, club, mace, sword, spear, gloves, sling, short_bow, long_bow, rock, cloth, leather, chain | Turn Undead (L5)<br/>Smite Undead (L1) |
| **Ranger** | 4 | priest | fists, dagger, club, sword, sling, short_bow, long_bow, crossbow, cloth, leather | Pick Locks (L5)<br/>Craft Arrows (L2)<br/>Craft Fire Arrows (L5) |
| **Thief** | 6 | none | fists, dagger, club, sling, short_bow, cloth, leather | Pick Locks (L1)<br/>Detect Traps (L1)<br/>Backstab (L3)<br/>Shadow Step (L7) |
| **Wizard** | 2 | sorcerer | fists, dagger, club, cloth | — |

## Abilities

Abilities are named capabilities granted by Race or Class (or other sources). The `Where` column tells you where the ability can be triggered: `battle` (combat action menu), `party` (Use button on the character sheet), or `passive` (always-on / auto-triggered).


### Class Abilities

| Ability | Description | Where | Duration |
|---|---|---|---|
| **Backstab** | Critical hits with daggers on a successful DEX save — the humble dagger becomes a devastating weapon. | passive | permanent |
| **Brew Potion** | Combine regents using the guidance of a recipe to create a potion | party |  |
| **Craft Arrows** | Allows the character to craft a bundle of arrows or bolts once per day. | party |  |
| **Craft Fire Arrows** | Allows the character to craft a bundle of fire arrows once per day. | party |  |
| **Detect Traps** | Hidden traps are revealed before the party steps on them. | passive | permanent |
| **Dual Casting** | Access to both the priest and sorcerer spell catalogs — the only class with both. | passive | permanent |
| **Herbalism** | Nature lore spots reagents in the wild while travelling. Each step on a foraging tile (grass, forest, …) has a small chance to turn up a potion reagent. Alchemists in particular benefit from a doubled find rate. | passive | permanent |
| **Pick Locks** | Pick locked doors and chests — d20 + DEX mod vs DC 12, one lockpick consumed per attempt. | passive | permanent |
| **Shadow Step** | Move after attacking — true hit-and-run play. | passive | permanent |
| **Smite Undead** | Attacks against undead creatures deal double damage | passive |  |
| **Turn Undead** | Channel holy energy at every undead on the battlefield. Each one must make a Wisdom save (d20 + WIS mod vs DC 10 + caster's WIS mod) or be destroyed outright; those that succeed are still seared for 50% of their HP in radiant damage. | battle | instant |

### Race Abilities

| Ability | Description | Where | Duration |
|---|---|---|---|
| **Fast Learner** | Requires only 1125 XP per level instead of the standard 1500, leveling up roughly 25% faster than other races. | passive | permanent |
| **Infravision** | Pierces darkness, revealing the world in shades of red. The bearer can see in absolute darkness without needing a torch. | passive | permanent |
| **Nimble** | Allows extra movement, and the ability to move after an attack | passive | permanent |
| **Pickpocket** | Attempt to steal items from town NPCs. Once per NPC, with a chance of failure. | party | permanent |
| **Tinker** | Once per in-game day, fashion any single item normally found in a general store. | party | permanent |

## Spells

Spells are MP-cost actions castable by classes that have a matching `casting_type`. The `Where` column tells you where the spell can be cast — `battle`, `party`, or `context` (contextual surfaces like the locked-door dialog).


### Priest Spells

| Spell | MP | Min Lvl | Range | Targeting | Where | Description |
|---|---:|---:|---:|---|---|---|
| **Light** | 3 | 1 | 0 | select_tile | party, battle | Conjures a radiant orb of divine light at a chosen spot — anywhere on the battlefield. |
| **Minor Heal** | 5 | 1 | 6 | select_ally_or_self | battle, party | Sends a gentle wave of healing energy toward an ally or the caster. |
| **Cure Poison** | 5 | 2 | 99 | select_ally | battle | Draws the venom from an ally's body with a cleansing prayer, removing the poisoned condition. |
| **Bless** | 10 | 3 | 0 | self | battle | Invokes a divine blessing that empowers all allies, granting them greater accuracy in battle. |
| **Curse** | 10 | 3 | 99 | select_enemy | battle | Calls down a dark malediction on an enemy, weakening its defenses and dulling its attacks. |
| **Major Heal** | 15 | 4 | 10 | select_ally_or_self | battle | Channels a powerful wave of restorative energy toward an ally, mending grievous wounds. |
| **Push** | 14 | 5 | 0 | self | party | Emits a powerful wave of divine force that drives nearby monsters away from the party. |
| **Mass Heal** | 25 | 6 | 0 | self | battle | A burst of divine light radiates from the caster, restoring health to all nearby allies. |
| **Restore** | 35 | 7 | 0 | self | battle | A radiant pillar of divine power engulfs the party, fully restoring health and mana to all allies and purging all poisons from their bodies. |

### Sorcerer Spells

| Spell | MP | Min Lvl | Range | Targeting | Where | Description |
|---|---:|---:|---:|---|---|---|
| **Shield** | 4 | 1 | 5 | select_ally | battle | Conjures a faint magical barrier around an ally, slightly boosting their armor. |
| **Sleep** | 5 | 1 | 99 | select_enemy | battle | Lulls a weak-minded creature into a light magical slumber. |
| **Magic Dart** | 6 | 1 | 10 | directional_projectile | battle | Hurls an energy-charged dart in a straight line, stinging on impact. |
| **Knock** | 6 | 2 | 1 | self | context | Sends a pulse of arcane force into a lock's mechanism, rattling tumblers and wards alike. Cast from the locked-door dialog when the party bumps a lock. |
| **Long Shanks** | 6 | 2 | 99 | select_ally_or_self | battle | Enchants an ally's legs with unnatural speed, extending their movement range for 3 turns. May also be cast on yourself. |
| **Magic Arrow** | 12 | 3 | 99 | select_enemy | battle | Conjures a piercing bolt of arcane energy that streaks toward a chosen foe. |
| **Misty Step** | 8 | 4 | 6 | select_tile | battle | The caster vanishes in a swirl of silvery mist and reappears at a chosen location on the battlefield. |
| **Invisibility** | 16 | 4 | 0 | self | battle | The caster bends light around themselves, becoming invisible to enemies for 3 turns. |
| **Charm Person** | 14 | 5 | 99 | select_enemy | battle | Weaves an enchantment that bends the will of a humanoid creature, turning it against its allies for 3 turns. |
| **Lightning Bolt** | 25 | 5 | 99 | directional_projectile | battle | Unleashes a searing bolt of lightning that streaks in a straight line, electrocuting everything in its path. |
| **Animate Dead** | 20 | 6 | 99 | select_tile | battle | Raises a powerful skeleton warrior from the earth to fight for the caster. |
| **Fireball** | 30 | 7 | 99 | select_tile | battle | Hurls a massive ball of flame that detonates in a 3-tile radius, scorching everything — friend or foe — caught in the blast. |

## Items

Items are grouped by `item_type` and sorted by `power` (descending) within each group so the strongest option in each category is at the top. Where `power` doesn't apply (reagents, quest items), items are sorted alphabetically.


### Ammo

| Item | Power | Durability | Damage Bonus | Damage Type | Special | Buy |
|---|---:|---:|---|---|---|---:|
| **Fire Arrows** | 3 | 0 |  |  | ignites (light 3) | 25 |
| **Arrows** |  |  |  |  |  | 5 |
| **Bolts** |  |  |  |  |  | 8 |
| **Stones** |  |  |  |  |  | 3 |

### Axe

| Item | Power | Durability | Damage Bonus | Damage Type | Special | Buy |
|---|---:|---:|---|---|---|---:|
| **Broad Axe** | 7 | 20 |  |  |  | 0 |

### Club

| Item | Power | Durability | Damage Bonus | Damage Type | Special | Buy |
|---|---:|---:|---|---|---|---:|
| **Club** | 1 | 12 |  |  |  | 20 |

### Crossbow

| Item | Power | Durability | Damage Bonus | Damage Type | Special | Buy |
|---|---:|---:|---|---|---|---:|
| **Crossbow** | 9 | 20 |  |  | ranged, uses bolts | 250 |

### Dagger

| Item | Power | Durability | Damage Bonus | Damage Type | Special | Buy |
|---|---:|---:|---|---|---|---:|
| **Dagger** | 1 | 20 |  |  | throwable | 20 |

### Fists

| Item | Power | Durability | Damage Bonus | Damage Type | Special | Buy |
|---|---:|---:|---|---|---|---:|
| **Fists** | 0 | 0 |  |  |  |  |

### Gloves

| Item | Power | Durability | Damage Bonus | Damage Type | Special | Buy |
|---|---:|---:|---|---|---|---:|
| **Gloves** | 1 | 50 |  |  |  | 0 |

### Halberd

| Item | Power | Durability | Damage Bonus | Damage Type | Special | Buy |
|---|---:|---:|---|---|---|---:|
| **Halberd** | 9 | 20 |  |  |  | 0 |

### Long Bow

| Item | Power | Durability | Damage Bonus | Damage Type | Special | Buy |
|---|---:|---:|---|---|---|---:|
| **Silver Bow** | 9 | 0 |  |  | ranged, uses arrows |  |
| **Long Bow** | 7 | 20 |  |  | ranged, uses arrows | 150 |

### Mace

| Item | Power | Durability | Damage Bonus | Damage Type | Special | Buy |
|---|---:|---:|---|---|---|---:|
| **Mace** | 2 | 20 |  |  |  | 40 |

### Rock

| Item | Power | Durability | Damage Bonus | Damage Type | Special | Buy |
|---|---:|---:|---|---|---|---:|
| **Rock** | 1 | 0 |  |  | ranged, throwable | 0 |

### Short Bow

| Item | Power | Durability | Damage Bonus | Damage Type | Special | Buy |
|---|---:|---:|---|---|---|---:|
| **Short Bow** | 4 | 30 |  |  | ranged, uses arrows | 60 |

### Sling

| Item | Power | Durability | Damage Bonus | Damage Type | Special | Buy |
|---|---:|---:|---|---|---|---:|
| **Sling** | 2 | 20 |  |  | ranged, uses stones | 60 |

### Spear

| Item | Power | Durability | Damage Bonus | Damage Type | Special | Buy |
|---|---:|---:|---|---|---|---:|
| **Spear** | 6 | 20 |  |  |  | 50 |

### Sword

| Item | Power | Durability | Damage Bonus | Damage Type | Special | Buy |
|---|---:|---:|---|---|---|---:|
| **Sun Sword** | 20 | 0 | 1d6 | fire |  | 0 |
| **Mystic Sword** | 10 | 0 |  |  |  |  |
| **Iron Sword** | 8 | 50 |  |  |  | 0 |
| **Sword** | 5 | 20 |  |  |  | 40 |

### Chain

| Item | Evasion (AC) | Durability | Buy | Sell |
|---|---:|---:|---:|---:|
| **+2 Chain** | 62 | 0 |  |  |
| **Chain** | 58 | 50 | 120 | 60 |

### Cloth

| Item | Evasion (AC) | Durability | Buy | Sell |
|---|---:|---:|---:|---:|
| **Cloth** | 50 | 0 | 20 | 10 |

### Exotic

| Item | Evasion (AC) | Durability | Buy | Sell |
|---|---:|---:|---:|---:|
| **Exotic** | 67 | 0 |  |  |

### Leather

| Item | Evasion (AC) | Durability | Buy | Sell |
|---|---:|---:|---:|---:|
| **Leather** | 56 | 20 | 50 | 25 |

### Plate

| Item | Evasion (AC) | Durability | Buy | Sell |
|---|---:|---:|---:|---:|
| **+2 Plate** | 64 | 0 |  |  |
| **Plate** | 60 | 20 | 200 | 150 |

### Antidote

| Item | Power | Effect | Charges | Stackable | Buy | Description |
|---|---:|---|---:|:---:|---:|---|
| **Antidote** |  | cure_poison | 1 | ✓ | 10 | A bitter tincture that cures poison. |

### Bomb

| Item | Power | Effect | Charges | Stackable | Buy | Description |
|---|---:|---|---:|:---:|---:|---|
| **Smoke Bomb** |  |  |  |  |  | A small bomb that creates a blinding cloud. |

### Camping Supplies

| Item | Power | Effect | Charges | Stackable | Buy | Description |
|---|---:|---|---:|:---:|---:|---|
| **Camping Supplies** | 0 | rest | 3 | ✓ | 25 | A bedroll, flint, and dried rations. Lets the party rest safely in the wilderness. |

### Herb

| Item | Power | Effect | Charges | Stackable | Buy | Description |
|---|---:|---|---:|:---:|---:|---|
| **Healing Herb** | 15 | heal_hp | 1 | ✓ | 15 | A fragrant herb that restores a small amount of HP. |

### Holy Water

| Item | Power | Effect | Charges | Stackable | Buy | Description |
|---|---:|---|---:|:---:|---:|---|
| **Holy Water** |  |  | 1 | ✓ |  | Blessed water from a sacred spring. Burns the undead. |

### Lockpick

| Item | Power | Effect | Charges | Stackable | Buy | Description |
|---|---:|---|---:|:---:|---:|---|
| **Lockpick** |  |  | 5 | ✓ | 8 | A set of fine lockpicking tools. Consumed on each attempt. |

### Poison Potion

| Item | Power | Effect | Charges | Stackable | Buy | Description |
|---|---:|---|---:|:---:|---:|---|
| **Lingering Venom** | 2 | combat_only |  |  | 70 | A potent toxin that persists far longer than ordinary poisons. |
| **Paralytic Poison** | 2 | combat_only |  |  | 75 | A nerve toxin that drains magical energy. Apply to a weapon or throw at enemies. |
| **Poison Vial** | 2 | combat_only |  |  | 50 | A vial of toxic liquid. Apply to a weapon or throw at enemies to inflict poison damage. |
| **Weakening Poison** | 2 | combat_only |  |  | 60 | A venom that saps fighting prowess. Apply to a weapon or throw at enemies. |

### Potion

| Item | Power | Effect | Charges | Stackable | Buy | Description |
|---|---:|---|---:|:---:|---:|---|
| **Healing Potion** | 30 | heal_hp | 1 | ✓ | 40 | A ruby-red elixir that mends wounds. Restores a large amount of HP. |
| **Mana Potion** | 10 | heal_mp | 1 | ✓ |  | A shimmering blue liquid that restores magic points. |
| **Elixir of Strength** | 2 | buff_strength | 1 | ✓ | 60 | A thick crimson brew. Grants +2 STR for the next combat. |
| **Elixir of Warding** | 2 | buff_ac | 1 | ✓ | 60 | A silver-tinged potion. Grants +2 AC for the next combat. |

### Quest Item

| Item | Power | Effect | Charges | Stackable | Buy | Description |
|---|---:|---|---:|:---:|---:|---|
| **Bronze Key** |  |  |  |  |  | A tarnished bronze key with intricate gnomish gearwork. One of the 8 Keys of Shadow. |
| **Crystal Key** |  |  |  |  |  | A translucent key carved from a single crystal, humming with magical energy. One of the 8 Keys of Shadow. |
| **Diamond Key** |  |  |  |  |  | A flawless diamond key that refracts light into rainbows. The final Key of Shadow. |
| **Dragonheart** |  |  |  |  |  | The smoldering heart of an ancient wyrm. It beats once every few minutes, slow as the tide, and the air around it shimmers with heat. |
| **Family Heirloom** |  |  |  |  |  | A delicate silver locket engraved with a family crest. It belongs to Elara. |
| **Gold Key** |  |  |  |  |  | A solid gold key shaped like a miniature war hammer. One of the 8 Keys of Shadow. |
| **Iron Key** |  |  |  |  |  | A heavy iron key etched with gnomish runes. One of the 8 Keys of Shadow. |
| **Obsidian Key** |  |  |  |  |  | A key of polished volcanic glass, cold to the touch. One of the 8 Keys of Shadow. |
| **Ruby Key** |  |  |  |  |  | A blood-red key that pulses with warmth. One of the 8 Keys of Shadow. |
| **Shadow Crystal** |  |  |  |  |  | A pulsing dark crystal radiating ancient power. The innkeeper seeks this. |
| **Silver Key** |  |  |  |  |  | A gleaming silver key inscribed with arcane formulae. One of the 8 Keys of Shadow. |

### Reagent

| Item | Power | Effect | Charges | Stackable | Buy | Description |
|---|---:|---|---:|:---:|---:|---|
| **Brimite Ore** |  |  | 1 | ✓ | 15 | A volatile mineral that smolders with inner heat. |
| **Glowcap Mushroom** |  |  | 1 | ✓ | 10 | A blue-capped fungus that pulses with arcane energy. |
| **Moonpetal** |  |  | 1 | ✓ | 12 | A luminous flower petal that glows faintly in the dark. Prized by alchemists. |
| **Serpent Root** |  |  | 1 | ✓ | 8 | A twisted root with potent cleansing properties. |
| **Spring Water** |  |  | 1 | ✓ | 3 | Pure water from a mountain spring. Essential for brewing. |

### Rope

| Item | Power | Effect | Charges | Stackable | Buy | Description |
|---|---:|---|---:|:---:|---:|---|
| **Rope** |  |  |  |  |  | A sturdy hemp rope. Useful for climbing. |

### Scroll

| Item | Power | Effect | Charges | Stackable | Buy | Description |
|---|---:|---|---:|:---:|---:|---|
| **Scroll of Fire** |  |  |  |  |  | A single-use scroll containing a fire spell. |

### Throwable

| Item | Power | Effect | Charges | Stackable | Buy | Description |
|---|---:|---|---:|:---:|---:|---|
| **Fire Oil** | 20 |  |  |  | 35 | A volatile oil that bursts into a small 3x3 gout of flame where it lands. Throw at an enemy or tile. |

### Torch

| Item | Power | Effect | Charges | Stackable | Buy | Description |
|---|---:|---|---:|:---:|---:|---|
| **Torch** | 3 |  | 1 | ✓ | 5 | A wooden torch. Lights the way in dark places. |

## Monsters

Sorted by `difficulty` then HP. `Damage` is the weapon dice; `Move` is the move budget per turn. `Undead` matters for Smite Undead / Turn Undead.

| Monster | Diff | HP | AC | Atk | Damage | Move | XP | Gold | Tags |
|---|---|---:|---:|---:|---|---:|---:|---|---|
| **Goblin** | easy | 6 | 11 | +2 | 1d4 | 6 | 10 | 1–6 | humanoid |
| **Giant Rat** | easy | 8 | 12 | +2 | 1d4 | 10 | 15 | 2–8 |  |
| **Wolf** | easy | 12 | 13 | +4 | 1d6+1 | 4 | 30 | 0–5 |  |
| **Wild Boar** | easy | 15 | 14 | +1 | 1d4 | 4 | 20 | 3–10 |  |
| **Lich** | hard | 30 | 15 | +3 | 3d4 | 2 | 135 | 10–40 | undead |
| **Banshee** | hard | 35 | 13 | +5 | 1d8 | 3 | 90 | 8–25 | undead, hit-and-run 1 |
| **Super Zombie** | hard | 40 | 11 | +4 | 1d8+2 | 2 | 70 | 6–22 | undead |
| **Ogre** | hard | 40 | 13 | +5 | 2d6+3 | 2 | 80 | 15–40 | humanoid |
| **Man Eater** | hard | 50 | 16 | +3 | 3d4 | 3 | 125 | 10–30 |  |
| **Wyvern** | hard | 60 | 14 | +4 | 2d4 | 4 | 120 | 3–25 | hit-and-run 1 |
| **Dragon** | boss | 125 | 18 | +6 | 4d8 | 8 | 335 | 20–50 | hit-and-run 2 |
| **Skeleton Archer** | normal | 12 | 12 | +3 | 1d4 | 2 | 20 | 5–18 | undead |
| **Dark Mage** | normal | 14 | 12 | +4 | 2d4+1 | 2 | 50 | 10–25 | humanoid |
| **Orc Shaman** | normal | 16 | 11 | +3 | 1d4 | 2 | 25 | 5–18 | humanoid |
| **Skeleton** | normal | 16 | 13 | +3 | 1d6+1 | 3 | 30 | 5–15 | undead |
| **Zombie** | normal | 20 | 10 | +2 | 1d6+1 | 3 | 30 | 3–12 | undead |
| **Orc** | normal | 22 | 13 | +5 | 1d8+2 | 4 | 50 | 5–15 | humanoid |
| **Troll** | normal | 30 | 14 | +6 | 2d6+2 | 1 | 70 | 10–25 | humanoid |
| **Mind Flayer** | deadly | 50 | 15 | +6 | 1d6 | 3 | 140 | 25–90 |  |
| **Vampire Lord** | deadly | 60 | 16 | +7 | 1d10 | 4 | 160 | 50–150 | undead, humanoid, hit-and-run 1 |
| **Hydra** | deadly | 110 | 15 | +6 | 3d8+2 | 2 | 190 | 40–120 |  |
| **Stone Golem** | deadly | 110 | 18 | +6 | 2d12 | 1 | 205 | 30–80 |  |

---

_End of manual._
