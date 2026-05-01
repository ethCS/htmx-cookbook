# htmx cookbook

this is a recipe finder / mini cookbook app i built with htmx, pug, express, and firebase.
you can look up meals from themealdb, save favorites, and make your own recipes too.

## setup

1. run `npm install`
2. make a `.env` file and add these:
   `FB_PROJECT_ID`
   `FB_CLIENT_EMAIL`
   `FB_PRIVATE_KEY`
   `FB_WEB_API_KEY`
   `SESSION_SECRET`
   `APP_PORT=3000`
   `NODE_ENV=development`
3. run `npm run dev`
4. open `http://localhost:3000`

for the firebase private key, keep the line breaks escaped like `\n` or it gets weird.

## tech stack

- node.js + express
- htmx
- pug templates
- plain css + a little client js
- firebase auth
- firestore
- themealdb api

thats pretty much it. the backend stuff is in [server.js](server.js), the templates are in [views](views), and the small browser-side bits are in [public/app.js](public/app.js).