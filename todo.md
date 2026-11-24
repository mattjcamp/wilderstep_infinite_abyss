# TODO
- Consider re-rolling random elements on a schedule based on the game calendar

# Varnfell



# Notes

To run over the wifi network so I can test with my phone:
    npm run dev -- -H 0.0.0.0 
and open 
    http://192.168.86.173:3000/
To find the Mac IP address: 
    ipconfig getifaddr en0

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

