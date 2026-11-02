## Things to Fix
- The chests that we have now don't do anything and were probably meant to be quest items. Figure out a way to add chests with random drops to game.
- One room in the crystal skull dungeon has a wall you can walk through
- Double check the random dungeons populate with monsters, figure out random chest drops
- Fine tune random dungeons, add more incentives like extra exp for reaching the last floor. Brainstorm some big ideas for clearing a random dungeon. Make sure there are plenty of loot drops.
- Remove any remaining unneeded sprites and tiles
- Remove any legacy dungeon generators

## Flesh Out Core
- Fine tune core demo adventure
- Keep adding to the core demo

## Improve UI
- Fine tune the party screen
- Fine tune the character screen
- Fine tune the conversation screens
- Fine tune beginning character creation
- Fine tune dungeon generator UI

## Lore
- start brainstorming ideas about the first original, immersive world that I will create for this game:world type, political structures, economy, towns, gods, epic stories, lost civizations

# Notes

cd web

npm run dev:all
npm run build:manual
npm run dev:remote
npm run reindex-sprites

https://wilderstep.pages.dev
rpgmaker12345678@gmail.com (@rpgmaker12345678)
mjcampbell74@gmail.com (@matt)

### Adding New Players

Invite specific people (best for now / a trusted test group). You add their email addresses to the Access policy. Steps:

- Go to one.dash.cloudflare.com > Zero Trust → Access → Applications.
- Open your publish-API application (the one protecting …workers.dev/login).
- Open its Policies → edit the existing "Allow" policy.
- In the Include rule, add the new players' emails — either as individual Emails, or switch it to Emails ending in a domain (e.g. everyone @yourschool.edu) if you want to admit a whole group at once.
- Save

