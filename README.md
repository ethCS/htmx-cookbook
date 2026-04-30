# HTMX Cookbook

Recipe discovery and personal cookbook app rebuilt as a server-rendered HTMX application.

## Grading Criteria Coverage
- Uses HTMX: fragment swaps, inline validation, partial page updates, load-more interactions, and HTMX-driven auth/content flows.
- Hosted-ready backend app: Express backend is included in the repository and deployed through Firebase Functions + Hosting.
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

- `FB_PROJECT_ID=htmx-cookbook`
- `FB_CLIENT_EMAIL=`
- `FB_PRIVATE_KEY=`
- `FB_WEB_API_KEY=`
- `SESSION_SECRET=`
- `APP_PORT=3000`
- `NODE_ENV=development`

`FB_PRIVATE_KEY` must come from a Firebase service account and should keep embedded newlines escaped as `\n` when stored in env files.

## Run Locally
1. Install dependencies with `npm install`.
2. Start the app with `npm run dev`.
3. Open `http://localhost:3000`.

## Hosted Deployment
This project is configured for Firebase Hosting + Firebase Functions deployment.

1. Push the repository to GitHub.
2. Ensure Firebase project default in [.firebaserc](.firebaserc) matches your target project.
3. Add GitHub repository secret FIREBASE_TOKEN (steps in the GitHub Actions section below).
4. Push to main or run the deploy workflow manually from GitHub Actions.
5. Verify the deployed function and hosted site in Firebase Console.

## GitHub Actions
Two workflows are included in [\.github/workflows](.github/workflows):

- [\.github/workflows/ci.yml](.github/workflows/ci.yml): runs on pull requests and pushes to validate syntax and compile all Pug templates.
- [\.github/workflows/deploy-firebase.yml](.github/workflows/deploy-firebase.yml): runs on pushes to main and deploys Firebase functions.

### Required GitHub Secret
- FIREBASE_TOKEN: CI token used by Firebase CLI in GitHub Actions.

How to create FIREBASE_TOKEN:
1. Run this command on your machine:
  firebase login:ci
2. Copy the token output from that command.
3. In GitHub, open your repository, then Settings > Secrets and variables > Actions.
4. Click New repository secret.
5. Name: FIREBASE_TOKEN
6. Value: paste the token from firebase login:ci
7. Save.

After that, pushes to main automatically run deployment with:
npx firebase deploy --only functions

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
- Firebase deployment configuration is in [firebase.json](firebase.json), and GitHub Actions handles automatic deployment for functions on main.