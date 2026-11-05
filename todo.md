## Improve UI
- Fine tune beginning character creation
- Put updated graphics into manuals

## Lore
- world name
- races
- gods
- cults
- guilds
- major city-states
- epics
- lost civilizations

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

