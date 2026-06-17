
## New Content for v2

- We will need fresh spell content past level 7-10 (sorcerer: Recall, Meteor Shower, Void Orb; priest: Day Light, Divine Smite, Resurrection
- Class Quest: add a class quest that provides an unlock for high level spells and abilities. After level 10, characters must complete Class Quests to get a new spell or ability. Class quests will have level and class pre-reqs. Class Quests could be initiated via the Character Sheet.

# Notes

npm run dev:all
npm run dev:remote
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
