## Fine Tune

- dial in monster AI, abilities, and animations, test in Battle Sim
- Battle Screen: show item sprites, don't put items in Use Items that can't be used (like torches)
- dial in side quests, add theme tags, add more steps, make the content more clear
- tighten up game log

## Source Material

- start brainstorming ideas about the first original, immersive world that I will create for this game
- world type, political structures, economy, towns, gods, epic stories, lost civizations
- make a simple but playable classic D&D module: https://gamenightblog.com/sunless-citadel-campaign-resources/ is an example of a low level module


## Bugs


# Notes

cd web

npm run dev:all
npm run build:manual
npm run dev:remote
npm run reindex-sprites

https://wilderstep.pages.dev
rpgmaker12345678@gmail.com (@rpgmaker12345678)
mjcampbell74@gmail.com (@matt)

## Developer Notes

### Adding New Players

Invite specific people (best for now / a trusted test group). You add their email addresses to the Access policy. Steps:

- Go to one.dash.cloudflare.com > Zero Trust → Access → Applications.
- Open your publish-API application (the one protecting …workers.dev/login).
- Open its Policies → edit the existing "Allow" policy.
- In the Include rule, add the new players' emails — either as individual Emails, or switch it to Emails ending in a domain (e.g. everyone @yourschool.edu) if you want to admit a whole group at once.
- Save

## Battle Arena Maps

Target size: 16 cols × 14 rows. That fills the playable interior perfectly. Maps smaller than that anchor at the top-left of the interior with default fill around them; maps larger than that get clipped past col 16 / row 14.

Don't bother painting walls at the outer edges — the engine's perimeter wall covers those.
The combat formation bands sit at rows 1-4 (enemies) and rows 11-14 (party). Leave those bands as walkable floor so combatants spawn cleanly. The middle bands (rows 5-10) are where pillars, pits, and obstacles read best.

## Resolved
- ~~Make sure Iron Keys are consumable (one per lock)~~ Verified 2026-07-03: sim + save-persistence code consume one key per lock (covered by MapSimulation tests). Likely cause of the report: quests grant multiple keys ("Pirates" gives 2) and non-stackable keys rendered as identical duplicate rows. Fixed by making iron_key stackable ("Iron Key (2)" counts down visibly). Re-publish underworld-invaders so the hosted copy picks up the catalog change.
