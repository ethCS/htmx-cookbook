# HTMX Cookbook

Recipe discovery and personal cookbook app rebuilt as a server-rendered HTMX application.

## Grading Criteria Coverage
- Uses HTMX: fragment swaps, inline validation, partial page updates, load-more interactions, and HTMX-driven auth/content flows.
- Hosted-ready backend app: Express server included in the repository with a Render deployment config in [render.yaml](render.yaml).
- Hits an API: server calls TheMealDB for search, categories, details, and random featured recipes.
- Hits a database: Firebase Firestore stores user profiles, favorites, and custom recipes.
- Backend code included: all backend routes and data access live in [server.js](server.js).
- Security-conscious: session cookies are `httpOnly`, write routes require a CSRF header, security headers are set server-side, and user/third-party content is wrapped with `hx-disable` where appropriate.
- Accessibility: semantic headings/sections, labels on form fields, skip link, live regions, alt text, and keyboard-focus styles.

## Stack
- Node.js + Express
- HTMX
- Pug partials for HTML responses
- Handwritten CSS in [public/style.css](public/style.css)
- Small progressive-enhancement JS in [public/app.js](public/app.js)
- Firebase Admin SDK for Auth/Firestore access on the server
- TheMealDB public API queried from the backend

## API And Database Usage
- External API: TheMealDB is accessed from the backend in [server.js](server.js) via `search.php`, `filter.php`, `lookup.php`, `categories.php`, and `random.php`.
- Database: Firestore stores:
  - user profile metadata
  - saved favorites
  - custom recipe CRUD data

## Required Environment Variables
Copy [\.env.example](.env.example) to `.env` or use `.env.SECRET_KEYS` and provide:

- `FIREBASE_PROJECT_ID=htmx-cookbook`
- `FIREBASE_CLIENT_EMAIL=`
- `FIREBASE_PRIVATE_KEY=`
- `FIREBASE_WEB_API_KEY=`
- `SESSION_SECRET=`
- `PORT=3000`
- `NODE_ENV=development`

`FIREBASE_PRIVATE_KEY` must come from a Firebase service account and should keep embedded newlines escaped as `\n` when stored in env files.

## Run Locally
1. Install dependencies with `npm install`.
2. Start the app with `npm run dev`.
3. Open `http://localhost:3000`.

## Hosted Deployment
This project is configured for a Node web service deployment on Render.

1. Push the repository to GitHub.
2. Create a new Render Web Service from the repo.
3. Render will detect [render.yaml](render.yaml).
4. Set the required environment variables in Render.
5. Create a Render deploy hook in the Render dashboard.
6. Add that hook URL to the GitHub repository secret `RENDER_DEPLOY_HOOK_URL`.
7. Push to `main` or run the deploy workflow manually from GitHub Actions.
8. Verify the health endpoint at `/health`.

## GitHub Actions
Two workflows are included in [\.github/workflows](.github/workflows):

- [\.github/workflows/ci.yml](.github/workflows/ci.yml): runs on pull requests and pushes to validate syntax and compile all Pug templates.
- [\.github/workflows/deploy-render.yml](.github/workflows/deploy-render.yml): runs on pushes to `main` and triggers the Render deploy hook after validation passes.

### Required GitHub Secret
- `RENDER_DEPLOY_HOOK_URL`: the Render deploy hook URL for the production web service.

### What CI Checks
- `node --check` on [server.js](server.js)
- `node --check` on [public/app.js](public/app.js)
- Pug template compilation through [scripts/verify-templates.mjs](scripts/verify-templates.mjs)
- HTMX shell presence in [index.html](index.html)

## Features
- Search recipes and browse categories with HTMX swaps
- View recipe details without full page reloads
- Sign up, log in, and log out with Firebase-backed auth
- Save and remove favorites in Firestore
- Create, edit, and delete custom recipes in Firestore
- Inline validation for auth and recipe forms
- Mobile-friendly navigation and responsive layout

## Notes
- The legacy [firebase.json](firebase.json) file remains in the repo, but the active hosted deployment path for this server-rendered app is the Node backend configuration in [render.yaml](render.yaml) plus the GitHub Actions deploy workflow.