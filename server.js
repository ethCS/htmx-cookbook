import path from "node:path";
import fs from "node:fs";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";

import dotenv from "dotenv";
import express from "express";
import session from "express-session";
import admin from "firebase-admin";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Load both common local env files when available.
for (const envFile of [".env", ".env.SECRET_KEYS"]) {
  const fullPath = path.join(__dirname, envFile);
  if (fs.existsSync(fullPath)) {
    dotenv.config({ path: fullPath, override: false });
  }
}

const FB_PROJECT_ID =
  process.env.FB_PROJECT_ID || process.env.GCLOUD_PROJECT || process.env.GOOGLE_CLOUD_PROJECT || "htmx-cookbook";
const FB_CLIENT_EMAIL = process.env.FB_CLIENT_EMAIL;
const FB_PRIVATE_KEY = process.env.FB_PRIVATE_KEY;
const FB_WEB_API_KEY = process.env.FB_WEB_API_KEY;
const SESSION_SECRET = process.env.SESSION_SECRET;
const SESSION_COOKIE_NAME = "__session";
const APP_PORT = process.env.PORT || process.env.APP_PORT || "3000";
const isProduction = process.env.NODE_ENV === "production";
const isManagedRuntime = Boolean(process.env.K_SERVICE || process.env.PORT || process.env.FUNCTION_TARGET);

const isMain = process.argv[1] === fileURLToPath(import.meta.url);

const MAX_QUERY_LENGTH = 80;
const MAX_CATEGORY_LENGTH = 40;
const MAX_USERNAME_LENGTH = 40;
const MAX_TITLE_LENGTH = 120;
const MAX_DESCRIPTION_LENGTH = 800;
const MAX_INGREDIENT_LINE_LENGTH = 160;
const MAX_INGREDIENT_LINES = 80;
const MAX_INSTRUCTIONS_LENGTH = 8000;
const MAX_TAG_COUNT = 20;
const MAX_TAG_LENGTH = 30;
const MAX_USER_DOCS_PER_COLLECTION = 200;
const MEAL_ID_RE = /^\d{1,12}$/;
const FIRESTORE_ID_RE = /^[A-Za-z0-9_-]{8,128}$/;
const RATE_LIMIT_BUCKETS = new Map();
const MAX_RATE_LIMIT_BUCKETS = 8000;
const ALLOWED_QUERY_KEYS = {
  search: new Set(["q", "category", "page", "_"]),
  auth: new Set(["mode", "next", "_"]),
  validateEmail: new Set(["email", "_"]),
  validatePassword: new Set(["password", "_"]),
  validateUsername: new Set(["username", "_"]),
  validateRecipeTitle: new Set(["title", "_"]),
  validateRecipeIngredients: new Set(["ingredients", "_"]),
  validateRecipeInstructions: new Set(["instructions", "_"]),
};
const ALLOWED_USER_SUBCOLLECTIONS = new Set(["favorites", "customRecipes"]);

function validateLocalRuntimeEnv() {
  const missing = [];
  if (!SESSION_SECRET) missing.push("SESSION_SECRET");
  if (!FB_WEB_API_KEY) missing.push("FB_WEB_API_KEY");
  if (!FB_CLIENT_EMAIL) missing.push("FB_CLIENT_EMAIL");
  if (!FB_PRIVATE_KEY) missing.push("FB_PRIVATE_KEY");

  if (missing.length) {
    throw new Error(`Missing env vars for local run: ${missing.join(", ")}`);
  }
}

if (!admin.apps.length) {
  if (FB_CLIENT_EMAIL && FB_PRIVATE_KEY) {
    admin.initializeApp({
      credential: admin.credential.cert({
        projectId: FB_PROJECT_ID,
        clientEmail: FB_CLIENT_EMAIL,
        privateKey: FB_PRIVATE_KEY.replace(/\\n/g, "\n"),
      }),
    });
  } else if (!isManagedRuntime) {
    // Local direct run without service-account env vars can still use ADC with explicit project id.
    admin.initializeApp({ projectId: FB_PROJECT_ID });
  } else {
    // In Cloud Run/Functions, rely on attached service account + runtime project metadata.
    admin.initializeApp();
  }
}

const db = admin.firestore();

class FirestoreSessionStore extends session.Store {
  constructor({ database, collectionName = "sessions" }) {
    super();
    this.database = database;
    this.collection = this.database.collection(collectionName);
  }

  toPlainSession(sess) {
    const plainSession = JSON.parse(JSON.stringify(sess || {}));
    if (sess?.cookie?.expires instanceof Date) {
      plainSession.cookie = plainSession.cookie || {};
      plainSession.cookie.expires = sess.cookie.expires.toISOString();
    }
    return plainSession;
  }

  fromStoredSession(sessionData) {
    if (!sessionData || typeof sessionData !== "object") {
      return null;
    }

    const plainSession = { ...sessionData };
    if (plainSession.cookie?.expires && typeof plainSession.cookie.expires === "string") {
      plainSession.cookie = {
        ...plainSession.cookie,
        expires: new Date(plainSession.cookie.expires),
      };
    }

    return plainSession;
  }

  get(sid, callback) {
    this.collection
      .doc(sid)
      .get()
      .then((docSnap) => {
        if (!docSnap.exists) {
          callback(null, null);
          return;
        }

        const payload = docSnap.data() || {};
        const sessionData = this.fromStoredSession(payload.session || null);
        if (!sessionData) {
          callback(null, null);
          return;
        }

        const expiresAt = payload.expiresAt;
        if (expiresAt && typeof expiresAt.toDate === "function" && expiresAt.toDate() <= new Date()) {
          this.collection.doc(sid).delete().catch(() => {});
          callback(null, null);
          return;
        }

        callback(null, sessionData);
      })
      .catch((error) => callback(error));
  }

  set(sid, sess, callback) {
    const sessionData = this.toPlainSession(sess);
    const expires = sess?.cookie?.expires;
    const expiresAt = expires ? new Date(expires) : new Date(Date.now() + 1000 * 60 * 60 * 24 * 7);

    this.collection
      .doc(sid)
      .set({
        session: sessionData,
        expiresAt,
      })
      .then(() => callback && callback(null))
      .catch((error) => callback && callback(error));
  }

  destroy(sid, callback) {
    this.collection
      .doc(sid)
      .delete()
      .then(() => callback && callback(null))
      .catch((error) => callback && callback(error));
  }
}

const sessionStore = new FirestoreSessionStore({
  database: db,
  collectionName: "sessions",
});

const app = express();

app.set("view engine", "pug");
app.set("views", path.join(__dirname, "views"));
app.set("trust proxy", true);
app.disable("x-powered-by");

app.use((req, res, next) => {
  res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "DENY");
  res.setHeader("Cross-Origin-Opener-Policy", "same-origin");
  res.setHeader("Cross-Origin-Resource-Policy", "same-origin");
  res.setHeader("Permissions-Policy", "camera=(), microphone=(), geolocation=()");
  if (isProduction) {
    res.setHeader("Strict-Transport-Security", "max-age=31536000; includeSubDomains");
  }
  res.setHeader(
    "Content-Security-Policy",
    [
      "default-src 'self'",
      "script-src 'self' https://unpkg.com",
      "style-src 'self' https://fonts.googleapis.com 'unsafe-inline'",
      "font-src 'self' https://fonts.gstatic.com",
      "img-src 'self' https: data:",
      "connect-src 'self'",
      "frame-ancestors 'none'",
      "base-uri 'self'",
      "form-action 'self'",
    ].join("; "),
  );
  next();
});

app.use("/public", express.static(path.join(__dirname, "public"), { extensions: ["css"] }));
app.use(express.urlencoded({ extended: true, limit: "32kb", parameterLimit: 200 }));
app.use(express.json({ limit: "32kb" }));

app.use(
  session({
    store: sessionStore,
    name: SESSION_COOKIE_NAME,
    // Keep import-time safe for Firebase deploy analysis; local runs validate before listen.
    secret: SESSION_SECRET || "import-time-placeholder-secret",
    resave: false,
    saveUninitialized: false,
    proxy: true,
    cookie: {
      httpOnly: true,
      sameSite: "lax",
      secure: isProduction ? "auto" : false,
      maxAge: 1000 * 60 * 60 * 24 * 7,
    },
  }),
);

function createRateLimitMiddleware({ windowMs, max, keyPrefix }) {
  return (req, res, next) => {
    const now = Date.now();
    pruneRateLimitBuckets(now);

    const clientIp = String(req.ip || req.socket?.remoteAddress || "unknown");
    const key = `${keyPrefix}:${clientIp}`;
    const record = RATE_LIMIT_BUCKETS.get(key);

    if (!record || record.resetAt <= now) {
      RATE_LIMIT_BUCKETS.set(key, { count: 1, resetAt: now + windowMs });
      return next();
    }

    record.count += 1;
    if (record.count > max) {
      res.setHeader("Retry-After", Math.ceil((record.resetAt - now) / 1000));
      return res.status(htmxFriendlyStatus(req, 429)).send(
        '<section class="panel" role="alert"><h1>Too many requests</h1><p>Please wait a moment and try again.</p></section>',
      );
    }

    RATE_LIMIT_BUCKETS.set(key, record);
    return next();
  };
}

function pruneRateLimitBuckets(now) {
  for (const [key, value] of RATE_LIMIT_BUCKETS.entries()) {
    if (!value || typeof value.resetAt !== "number" || value.resetAt <= now) {
      RATE_LIMIT_BUCKETS.delete(key);
    }
  }

  if (RATE_LIMIT_BUCKETS.size <= MAX_RATE_LIMIT_BUCKETS) {
    return;
  }

  // If the map still exceeds cap (e.g., concentrated active abuse), drop oldest keys first.
  const overflow = RATE_LIMIT_BUCKETS.size - MAX_RATE_LIMIT_BUCKETS;
  let removed = 0;
  for (const key of RATE_LIMIT_BUCKETS.keys()) {
    RATE_LIMIT_BUCKETS.delete(key);
    removed += 1;
    if (removed >= overflow) {
      break;
    }
  }
}

const globalRateLimit = createRateLimitMiddleware({
  windowMs: 60 * 1000,
  max: 240,
  keyPrefix: "global",
});
const authRateLimit = createRateLimitMiddleware({
  windowMs: 15 * 60 * 1000,
  max: 12,
  keyPrefix: "auth",
});
const writeRateLimit = createRateLimitMiddleware({
  windowMs: 60 * 1000,
  max: 90,
  keyPrefix: "write",
});

app.use(globalRateLimit);

app.use(issueCsrfCookie);
app.use(requireCsrf);

app.use((req, res, next) => {
  res.locals.currentUser = req.session.user || null;
  next();
});

const mealDbBase = "https://www.themealdb.com/api/json/v1/1";

async function mealDb(pathname, params = {}) {
  const url = new URL(`${mealDbBase}/${pathname}`);
  for (const [key, value] of Object.entries(params)) {
    url.searchParams.set(key, value);
  }

  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`MealDB request failed (${response.status})`);
  }

  return response.json();
}

async function searchMeals(query) {
  const payload = await mealDb("search.php", { s: query });
  return payload.meals || [];
}

async function mealsByCategory(category) {
  const payload = await mealDb("filter.php", { c: category });
  return payload.meals || [];
}

async function mealById(id) {
  const payload = await mealDb("lookup.php", { i: id });
  return payload.meals?.[0] || null;
}

async function mealCategories() {
  const payload = await mealDb("categories.php");
  return payload.categories || [];
}

async function randomMeals(count = 8) {
  const list = await Promise.all(
    Array.from({ length: count }, async () => {
      const payload = await mealDb("random.php");
      return payload.meals?.[0] || null;
    }),
  );

  const seen = new Set();
  return list.filter((meal) => {
    if (!meal || seen.has(meal.idMeal)) {
      return false;
    }
    seen.add(meal.idMeal);
    return true;
  });
}

function parseIngredients(meal) {
  const ingredients = [];
  for (let i = 1; i <= 20; i += 1) {
    const ingredient = meal[`strIngredient${i}`];
    const measure = meal[`strMeasure${i}`];
    if (ingredient && ingredient.trim()) {
      ingredients.push({ ingredient: ingredient.trim(), measure: (measure || "").trim() });
    }
  }
  return ingredients;
}

function isHtmx(req) {
  return req.get("HX-Request") === "true";
}

function parseCookies(cookieHeader = "") {
  return cookieHeader
    .split(";")
    .map((part) => part.trim())
    .filter(Boolean)
    .reduce((cookies, part) => {
      const separatorIndex = part.indexOf("=");
      if (separatorIndex <= 0) {
        return cookies;
      }

      const key = part.slice(0, separatorIndex).trim();
      const value = part.slice(separatorIndex + 1).trim();
      cookies[key] = decodeURIComponent(value);
      return cookies;
    }, {});
}

function safeTokenMatch(a, b) {
  if (typeof a !== "string" || typeof b !== "string") {
    return false;
  }

  const aBuffer = Buffer.from(a);
  const bBuffer = Buffer.from(b);
  if (aBuffer.length !== bBuffer.length) {
    return false;
  }

  return crypto.timingSafeEqual(aBuffer, bBuffer);
}

function escapeHtml(value) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function sanitizeSingleLine(value, maxLength) {
  return String(value || "")
    .replace(/[\u0000-\u001F\u007F]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, maxLength);
}

function sanitizeMultiline(value, maxLength) {
  return String(value || "")
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, "")
    .trim()
    .slice(0, maxLength);
}

function parsePositiveInt(value, fallback = 1) {
  const num = Number.parseInt(String(value || ""), 10);
  return Number.isNaN(num) || num <= 0 ? fallback : num;
}

function parseBoundedInt(value, min, max) {
  const num = Number.parseInt(String(value || ""), 10);
  if (Number.isNaN(num)) {
    return null;
  }
  if (num < min || num > max) {
    return null;
  }
  return num;
}

function isMealId(value) {
  return MEAL_ID_RE.test(String(value || ""));
}

function isFirestoreId(value) {
  return FIRESTORE_ID_RE.test(String(value || ""));
}

function safeHttpUrl(raw) {
  const candidate = String(raw || "").trim();
  if (!candidate) {
    return "";
  }

  try {
    const parsed = new URL(candidate);
    if (parsed.protocol === "http:" || parsed.protocol === "https:") {
      return parsed.toString();
    }
  } catch {
    return "";
  }

  return "";
}

function hasValidSessionUser(req) {
  const user = req.session?.user;
  return Boolean(user && typeof user.uid === "string" && user.uid.length > 0);
}

function appendCookie(res, cookieValue) {
  const existing = res.getHeader("Set-Cookie");
  if (!existing) {
    res.setHeader("Set-Cookie", cookieValue);
    return;
  }

  const next = Array.isArray(existing) ? [...existing, cookieValue] : [existing, cookieValue];
  res.setHeader("Set-Cookie", next);
}

function issueCsrfCookie(req, res, next) {
  const cookies = parseCookies(req.headers.cookie || "");
  req.cookies = cookies;

  let csrfToken = typeof req.session?.csrfToken === "string" ? req.session.csrfToken : "";
  if (!csrfToken) {
    csrfToken = crypto.randomBytes(24).toString("hex");
    req.session.csrfToken = csrfToken;
  }

  req.csrfToken = csrfToken;
  req.cookies.csrfToken = csrfToken;

  if (cookies.csrfToken !== csrfToken) {
    const secure = process.env.NODE_ENV === "production" ? "; Secure" : "";
    appendCookie(
      res,
      `csrfToken=${encodeURIComponent(csrfToken)}; Path=/; SameSite=Lax; Max-Age=7200${secure}`,
    );
  }

  return next();
}

function sameOriginCheck(req) {
  const origin = String(req.get("Origin") || "").trim();
  if (!origin) {
    return true;
  }

  const expectedOrigin = `${req.protocol}://${req.get("host")}`;
  return origin === expectedOrigin;
}

function requireCsrf(req, res, next) {
  if (!["POST", "PUT", "PATCH", "DELETE"].includes(req.method)) {
    return next();
  }

  if (!sameOriginCheck(req)) {
    return res.status(htmxFriendlyStatus(req, 403)).send(
      '<section class="panel" role="alert"><h1>Request blocked</h1><p>Cross-origin request denied.</p></section>',
    );
  }

  const fetchSite = String(req.get("Sec-Fetch-Site") || "").toLowerCase();
  if (fetchSite && !["same-origin", "same-site", "none"].includes(fetchSite)) {
    return res.status(htmxFriendlyStatus(req, 403)).send(
      '<section class="panel" role="alert"><h1>Request blocked</h1><p>Untrusted request context detected.</p></section>',
    );
  }

  const cookieToken = req.cookies?.csrfToken;
  const headerToken = req.get("X-CSRF-Token");
  const sessionToken = req.session?.csrfToken;

  if (safeTokenMatch(cookieToken, sessionToken) && safeTokenMatch(headerToken, sessionToken)) {
    return next();
  }

  return res.status(htmxFriendlyStatus(req, 403)).send(
    '<section class="panel" role="alert"><h1>Request blocked</h1><p>Your session token was missing or invalid. Refresh the page and try again.</p></section>',
  );
}

function htmxFriendlyStatus(req, statusCode) {
  return isHtmx(req) && statusCode >= 400 ? 200 : statusCode;
}

function isFirestoreDisabledError(error) {
  const text = String(error?.message || "").toLowerCase();
  return text.includes("cloud firestore api has not been used") || text.includes("firestore.googleapis.com");
}

function authRequired(req, res) {
  if (hasValidSessionUser(req)) {
    return true;
  }

  const statusMessage = "Please sign in to continue.";
  const statusCode = isHtmx(req) ? 200 : 401;
  res.status(statusCode).render("partials/auth", {
    mode: "login",
    message: statusMessage,
    nextPath: normalizeNextPath(req.originalUrl),
  });
  return false;
}

function normalizeNextPath(value) {
  const candidate = String(value || "").trim();
  if (!candidate || !candidate.startsWith("/") || candidate.startsWith("//")) {
    return "/pages/home";
  }

  return candidate === "/" ? "/pages/home" : candidate;
}

function regenerateSession(req) {
  return new Promise((resolve, reject) => {
    req.session.regenerate((error) => {
      if (error) {
        reject(error);
        return;
      }

      resolve();
    });
  });
}

function saveSession(req) {
  return new Promise((resolve, reject) => {
    req.session.save((error) => {
      if (error) {
        reject(error);
        return;
      }

      resolve();
    });
  });
}

async function loginWithFirebase(email, password) {
  if (!FB_WEB_API_KEY) {
    throw new Error("Missing FB_WEB_API_KEY for Firebase email/password login.");
  }

  const endpoint = `https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=${encodeURIComponent(FB_WEB_API_KEY)}`;
  const response = await fetch(endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      email,
      password,
      returnSecureToken: true,
    }),
  });

  const payload = await response.json();
  if (!response.ok || !payload.idToken) {
    const firebaseMessage = String(payload?.error?.message || "").trim();
    if (firebaseMessage) {
      throw new Error(firebaseMessage);
    }
    throw new Error("Invalid email or password.");
  }

  const decoded = await admin.auth().verifyIdToken(payload.idToken);
  return decoded;
}

function sanitizeRecipeForFavorite(meal) {
  const recipeId = String(meal.idMeal || "");
  return {
    recipeId,
    title: sanitizeSingleLine(meal.strMeal || "Untitled Recipe", MAX_TITLE_LENGTH) || "Untitled Recipe",
    image: safeHttpUrl(meal.strMealThumb || ""),
    category: sanitizeSingleLine(meal.strCategory || "", MAX_CATEGORY_LENGTH),
    source: "themealdb",
    addedAt: admin.firestore.FieldValue.serverTimestamp(),
  };
}

function customRecipeDoc(data) {
  const title = sanitizeSingleLine(data.title, MAX_TITLE_LENGTH);
  const ingredientsRaw = sanitizeMultiline(data.ingredients, MAX_INSTRUCTIONS_LENGTH);
  const instructions = sanitizeMultiline(data.instructions, MAX_INSTRUCTIONS_LENGTH);

  if (title.length < 3 || !ingredientsRaw.trim() || instructions.length < 20) {
    return null;
  }

  const ingredients = ingredientsRaw
    .split(/\r\n|\n|\r/)
    .map((s) => sanitizeSingleLine(s, MAX_INGREDIENT_LINE_LENGTH))
    .filter(Boolean)
    .slice(0, MAX_INGREDIENT_LINES);
  if (ingredients.length === 0) {
    return null;
  }

  const prep = parseBoundedInt(data.prepTime, 0, 1440);
  const servings = parseBoundedInt(data.servings, 1, 100);
  const tags = sanitizeSingleLine(data.tags, 400)
    .split(",")
    .map((s) => sanitizeSingleLine(s, MAX_TAG_LENGTH))
    .filter(Boolean)
    .slice(0, MAX_TAG_COUNT);

  return {
    title,
    description: sanitizeMultiline(data.description, MAX_DESCRIPTION_LENGTH),
    ingredients,
    instructions,
    prepTime: prep,
    servings,
    tags,
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
  };
}

function inlineValidationHtml(message, valid = false) {
  const tone = valid ? "valid" : "invalid";
  return `<p class="inline-validation ${tone}" role="status">${escapeHtml(message)}</p>`;
}

function isEmailLike(value) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(value || "").trim());
}

function rejectUnexpectedQueryParams(allowList) {
  return (req, res, next) => {
    for (const key of Object.keys(req.query || {})) {
      if (!allowList.has(key)) {
        return res.status(htmxFriendlyStatus(req, 400)).send(
          '<section class="panel" role="alert"><h1>Invalid request</h1><p>Unsupported query parameter.</p></section>',
        );
      }
    }

    return next();
  };
}

async function getUserSubcollectionDocs(uid, subcollectionName, maxDocs = MAX_USER_DOCS_PER_COLLECTION) {
  const safeUid = String(uid || "").trim();
  const safeSubcollection = String(subcollectionName || "").trim();
  if (!safeUid || !ALLOWED_USER_SUBCOLLECTIONS.has(safeSubcollection)) {
    throw new Error("Invalid Firestore user collection request");
  }

  const boundedMax = Number.isInteger(maxDocs)
    ? Math.min(Math.max(maxDocs, 1), MAX_USER_DOCS_PER_COLLECTION)
    : MAX_USER_DOCS_PER_COLLECTION;

  return db.collection("users").doc(safeUid).collection(safeSubcollection).limit(boundedMax).get();
}

async function renderNav(res, req) {
  return res.render("partials/nav", {
    user: req.session.user || null,
  });
}

app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "index.html"));
});

const appShellRoutes = [
  "/auth",
  "/search",
  "/favorites",
  "/my-recipes",
  "/my-recipes/:id/edit",
  "/recipe/:id",
  "/pages/*",
];

app.get(appShellRoutes, (req, res, next) => {
  if (isHtmx(req)) {
    return next();
  }

  return res.sendFile(path.join(__dirname, "index.html"));
});

app.get("/health", (req, res) => {
  res.status(200).json({ ok: true });
});

app.get("/fragments/nav", async (req, res) => {
  await renderNav(res, req);
});

app.get("/pages/home", async (req, res) => {
  const [featured, categories] = await Promise.all([randomMeals(8), mealCategories()]);
  const favoriteIds = new Set();

  if (req.session.user) {
    const snap = await getUserSubcollectionDocs(req.session.user.uid, "favorites");
    snap.forEach((doc) => {
      const value = doc.data()?.recipeId;
      if (value) favoriteIds.add(String(value));
    });
  }

  res.render("index", {
    featured,
    categories: categories.slice(0, 10),
    favoriteIds,
    user: req.session.user || null,
  });
});

app.get("/search", rejectUnexpectedQueryParams(ALLOWED_QUERY_KEYS.search), async (req, res) => {
  const query = sanitizeSingleLine(req.query.q, MAX_QUERY_LENGTH);
  const category = sanitizeSingleLine(req.query.category, MAX_CATEGORY_LENGTH);
  const page = Math.min(20, parsePositiveInt(req.query.page, 1));
  const perPage = 6;

  if (query && category) {
    return res.status(htmxFriendlyStatus(req, 400)).send(
      '<section class="panel" role="alert"><h1>Invalid request</h1><p>Choose search text or a category, not both.</p></section>',
    );
  }

  let meals = [];
  let title = "Search Recipes";

  if (query) {
    meals = await searchMeals(query);
    title = `Results for \"${query}\"`;
  } else if (category) {
    meals = await mealsByCategory(category);
    title = `${category} Recipes`;
  }

  const visibleMeals = meals.slice(0, page * perPage);
  const hasMore = visibleMeals.length < meals.length;

  const favoriteIds = new Set();
  if (req.session.user) {
    const snap = await getUserSubcollectionDocs(req.session.user.uid, "favorites");
    snap.forEach((doc) => {
      const value = doc.data()?.recipeId;
      if (value) favoriteIds.add(String(value));
    });
  }

  res.render("partials/recipe-results", {
    meals: visibleMeals,
    title,
    favoriteIds,
    searchQuery: query,
    searchCategory: category,
    page,
    hasMore,
    user: req.session.user || null,
  });
});

app.get("/validate/auth/email", rejectUnexpectedQueryParams(ALLOWED_QUERY_KEYS.validateEmail), (req, res) => {
  const email = sanitizeSingleLine(req.query.email, 254).toLowerCase();
  if (!email) {
    return res.send(inlineValidationHtml("Email is required."));
  }
  if (!isEmailLike(email)) {
    return res.send(inlineValidationHtml("Enter a valid email address."));
  }
  return res.send(inlineValidationHtml("Email looks good.", true));
});

app.get("/validate/auth/password", rejectUnexpectedQueryParams(ALLOWED_QUERY_KEYS.validatePassword), (req, res) => {
  const password = String(req.query.password || "");
  if (!password) {
    return res.send(inlineValidationHtml("Password is required."));
  }
  if (password.length < 6) {
    return res.send(inlineValidationHtml("Use at least 6 characters."));
  }
  return res.send(inlineValidationHtml("Password length is valid.", true));
});

app.get("/validate/auth/username", rejectUnexpectedQueryParams(ALLOWED_QUERY_KEYS.validateUsername), (req, res) => {
  const username = sanitizeSingleLine(req.query.username, MAX_USERNAME_LENGTH);
  if (!username) {
    return res.send(inlineValidationHtml("Username is required."));
  }
  if (username.length < 2) {
    return res.send(inlineValidationHtml("Use at least 2 characters."));
  }
  return res.send(inlineValidationHtml("Username looks good.", true));
});

app.get("/validate/recipe/title", rejectUnexpectedQueryParams(ALLOWED_QUERY_KEYS.validateRecipeTitle), (req, res) => {
  const title = sanitizeSingleLine(req.query.title, MAX_TITLE_LENGTH);
  if (!title) {
    return res.send(inlineValidationHtml("Title is required."));
  }
  if (title.length < 3) {
    return res.send(inlineValidationHtml("Use at least 3 characters."));
  }
  return res.send(inlineValidationHtml("Title looks good.", true));
});

app.get(
  "/validate/recipe/ingredients",
  rejectUnexpectedQueryParams(ALLOWED_QUERY_KEYS.validateRecipeIngredients),
  (req, res) => {
  const raw = sanitizeMultiline(req.query.ingredients, MAX_INSTRUCTIONS_LENGTH);
  const count = raw
    .split(/\r\n|\n|\r/)
    .map((item) => item.trim())
    .filter(Boolean).length;

  if (count === 0) {
    return res.send(inlineValidationHtml("Add at least one ingredient."));
  }
  return res.send(inlineValidationHtml(`${count} ingredient${count === 1 ? "" : "s"} listed.`, true));
  },
);

app.get(
  "/validate/recipe/instructions",
  rejectUnexpectedQueryParams(ALLOWED_QUERY_KEYS.validateRecipeInstructions),
  (req, res) => {
  const instructions = sanitizeMultiline(req.query.instructions, MAX_INSTRUCTIONS_LENGTH);
  if (!instructions) {
    return res.send(inlineValidationHtml("Instructions are required."));
  }
  if (instructions.length < 20) {
    return res.send(inlineValidationHtml("Add a bit more detail (20+ chars)."));
  }
  return res.send(inlineValidationHtml("Instructions look good.", true));
  },
);

app.get("/recipe/:id", async (req, res) => {
  const id = String(req.params.id || "");
  if (!isMealId(id)) {
    return res.status(htmxFriendlyStatus(req, 400)).send(
      '<section class="panel" role="alert"><h1>Invalid recipe id</h1><p>Please open a valid recipe.</p></section>',
    );
  }

  const meal = await mealById(id);

  if (!meal) {
    return res.status(404).send(
      '<section class="panel" role="status" aria-live="polite"><h1>Recipe not found</h1><p>The requested recipe could not be found.</p></section>',
    );
  }

  let favorite = false;
  if (req.session.user) {
    const favDoc = await db
      .collection("users")
      .doc(req.session.user.uid)
      .collection("favorites")
      .doc(id)
      .get();
    favorite = favDoc.exists;
  }

  return res.render("partials/recipe-detail", {
    meal,
    ingredients: parseIngredients(meal),
    favorite,
    sourceUrl: safeHttpUrl(meal.strSource),
    youtubeUrl: safeHttpUrl(meal.strYoutube),
    user: req.session.user || null,
  });
});

app.patch("/favorites/:id", writeRateLimit, async (req, res) => {
  if (!authRequired(req, res)) {
    return;
  }

  const id = String(req.params.id || "");
  if (!isMealId(id)) {
    return res.status(htmxFriendlyStatus(req, 400)).send('<p role="alert">Invalid recipe id.</p>');
  }

  const favRef = db.collection("users").doc(req.session.user.uid).collection("favorites").doc(id);
  const existing = await favRef.get();

  if (existing.exists) {
    await favRef.delete();
    return res.render("partials/favorite-action", {
      mealId: id,
      isFavorite: false,
      title: sanitizeSingleLine(req.body.title || "Recipe", MAX_TITLE_LENGTH) || "Recipe",
      image: safeHttpUrl(req.body.image || ""),
      category: sanitizeSingleLine(req.body.category || "", MAX_CATEGORY_LENGTH),
    });
  }

  const favoriteDoc = sanitizeRecipeForFavorite({
    idMeal: id,
    strMeal: req.body.title,
    strMealThumb: req.body.image,
    strCategory: req.body.category,
  });

  await favRef.set(favoriteDoc);
  return res.render("partials/favorite-action", {
    mealId: id,
    isFavorite: true,
    title: favoriteDoc.title,
    image: favoriteDoc.image,
    category: favoriteDoc.category,
  });
});

app.post("/favorites/:id", writeRateLimit, async (req, res) => {
  if (!authRequired(req, res)) {
    return;
  }

  const id = String(req.params.id || "");
  if (!isMealId(id)) {
    return res.status(htmxFriendlyStatus(req, 400)).send('<p role="alert">Invalid recipe id.</p>');
  }

  const favoriteDoc = sanitizeRecipeForFavorite({
    idMeal: id,
    strMeal: req.body.title,
    strMealThumb: req.body.image,
    strCategory: req.body.category,
  });

  await db.collection("users").doc(req.session.user.uid).collection("favorites").doc(id).set(favoriteDoc);

  const items = await getUserSubcollectionDocs(req.session.user.uid, "favorites");
  const favorites = items.docs.map((item) => ({ id: item.id, ...item.data() }));

  res.render("partials/favorites", {
    favorites,
    user: req.session.user,
    message: "Recipe saved to favorites.",
  });
});

app.delete("/favorites/:id", writeRateLimit, async (req, res) => {
  if (!authRequired(req, res)) {
    return;
  }

  const id = String(req.params.id || "");
  if (!isMealId(id)) {
    return res.status(htmxFriendlyStatus(req, 400)).send('<p role="alert">Invalid recipe id.</p>');
  }

  await db.collection("users").doc(req.session.user.uid).collection("favorites").doc(id).delete();

  const items = await getUserSubcollectionDocs(req.session.user.uid, "favorites");
  const favorites = items.docs.map((item) => ({ id: item.id, ...item.data() }));

  res.render("partials/favorites", {
    favorites,
    user: req.session.user,
    message: "Recipe removed from favorites.",
  });
});

app.get("/favorites", async (req, res) => {
  if (!authRequired(req, res)) {
    return;
  }

  const items = await getUserSubcollectionDocs(req.session.user.uid, "favorites");
  const favorites = items.docs.map((item) => ({ id: item.id, ...item.data() }));

  res.render("partials/favorites", {
    favorites,
    user: req.session.user,
    message: "",
  });
});

app.get("/my-recipes", async (req, res) => {
  if (!authRequired(req, res)) {
    return;
  }

  const snap = await getUserSubcollectionDocs(req.session.user.uid, "customRecipes");
  const recipes = snap.docs.map((docSnap) => ({ id: docSnap.id, ...docSnap.data() }));

  res.render("partials/my-recipes", {
    recipes,
    editRecipe: null,
    user: req.session.user,
    message: "",
  });
});

app.get("/my-recipes/:id/edit", async (req, res) => {
  if (!authRequired(req, res)) {
    return;
  }

  const recipeId = String(req.params.id || "");
  if (!isFirestoreId(recipeId)) {
    return res.status(htmxFriendlyStatus(req, 400)).send('<p role="alert">Invalid recipe id.</p>');
  }

  const docSnap = await db
    .collection("users")
    .doc(req.session.user.uid)
    .collection("customRecipes")
    .doc(recipeId)
    .get();

  if (!docSnap.exists) {
    return res.status(404).send('<p role="alert">Recipe not found.</p>');
  }

  const snap = await getUserSubcollectionDocs(req.session.user.uid, "customRecipes");
  const recipes = snap.docs.map((item) => ({ id: item.id, ...item.data() }));

  return res.render("partials/my-recipes", {
    recipes,
    editRecipe: { id: docSnap.id, ...docSnap.data() },
    user: req.session.user,
    message: "Editing recipe.",
  });
});

app.post("/my-recipes", writeRateLimit, async (req, res) => {
  if (!authRequired(req, res)) {
    return;
  }

  const payload = customRecipeDoc(req.body);
  if (!payload) {
    return res.status(400).send('<p role="alert">Title, ingredients, and instructions are required.</p>');
  }

  payload.createdAt = admin.firestore.FieldValue.serverTimestamp();

  await db.collection("users").doc(req.session.user.uid).collection("customRecipes").add(payload);

  const snap = await getUserSubcollectionDocs(req.session.user.uid, "customRecipes");
  const recipes = snap.docs.map((item) => ({ id: item.id, ...item.data() }));

  res.render("partials/my-recipes", {
    recipes,
    editRecipe: null,
    user: req.session.user,
    message: "Recipe created.",
  });
});

app.put("/my-recipes/:id", writeRateLimit, async (req, res) => {
  if (!authRequired(req, res)) {
    return;
  }

  const recipeId = String(req.params.id || "");
  if (!isFirestoreId(recipeId)) {
    return res.status(htmxFriendlyStatus(req, 400)).send('<p role="alert">Invalid recipe id.</p>');
  }

  const payload = customRecipeDoc(req.body);
  if (!payload) {
    return res.status(400).send('<p role="alert">Title, ingredients, and instructions are required.</p>');
  }

  await db.collection("users").doc(req.session.user.uid).collection("customRecipes").doc(recipeId).set(payload, {
    merge: true,
  });

  const snap = await getUserSubcollectionDocs(req.session.user.uid, "customRecipes");
  const recipes = snap.docs.map((item) => ({ id: item.id, ...item.data() }));

  res.render("partials/my-recipes", {
    recipes,
    editRecipe: null,
    user: req.session.user,
    message: "Recipe updated.",
  });
});

app.delete("/my-recipes/:id", writeRateLimit, async (req, res) => {
  if (!authRequired(req, res)) {
    return;
  }

  const recipeId = String(req.params.id || "");
  if (!isFirestoreId(recipeId)) {
    return res.status(htmxFriendlyStatus(req, 400)).send('<p role="alert">Invalid recipe id.</p>');
  }

  await db.collection("users").doc(req.session.user.uid).collection("customRecipes").doc(recipeId).delete();

  const snap = await getUserSubcollectionDocs(req.session.user.uid, "customRecipes");
  const recipes = snap.docs.map((item) => ({ id: item.id, ...item.data() }));

  res.render("partials/my-recipes", {
    recipes,
    editRecipe: null,
    user: req.session.user,
    message: "Recipe deleted.",
  });
});

app.get("/auth", rejectUnexpectedQueryParams(ALLOWED_QUERY_KEYS.auth), (req, res) => {
  const mode = req.query.mode === "signup" ? "signup" : "login";
  res.render("partials/auth", {
    mode,
    message: "",
    nextPath: normalizeNextPath(req.query.next),
  });
});

app.post("/auth/signup", authRateLimit, async (req, res) => {
  const email = sanitizeSingleLine(req.body.email, 254).toLowerCase();
  const password = String(req.body.password || "");
  const username = sanitizeSingleLine(req.body.username, MAX_USERNAME_LENGTH);
  const nextPath = normalizeNextPath(req.body.next);

  if (!email || !password || !username) {
    return res.status(htmxFriendlyStatus(req, 400)).render("partials/auth", {
      mode: "signup",
      message: "All signup fields are required.",
      nextPath,
    });
  }

  if (!isEmailLike(email) || password.length < 6) {
    return res.status(htmxFriendlyStatus(req, 400)).render("partials/auth", {
      mode: "signup",
      message: "Provide a valid email and a password with at least 6 characters.",
      nextPath,
    });
  }

  let createdUid = null;

  try {
    const userRecord = await admin.auth().createUser({ email, password, displayName: username });
    createdUid = userRecord.uid;

    await db.collection("users").doc(userRecord.uid).set({
      username,
      email,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
    });

    await regenerateSession(req);

    req.session.user = {
      uid: userRecord.uid,
      email,
      username,
    };

    try {
      await saveSession(req);
      return res.render("partials/post-auth", {
        user: req.session.user,
        message: "Account created. You are now signed in.",
        nextPath,
      });
    } catch (saveError) {
      return res.status(htmxFriendlyStatus(req, 500)).render("partials/auth", {
        mode: "signup",
        message: "Session could not be created. Please try again.",
        nextPath,
      });
    }
  } catch (error) {
    if (createdUid && isFirestoreDisabledError(error)) {
      try {
        await admin.auth().deleteUser(createdUid);
      } catch {
        // Ignore rollback errors; setup message below is still actionable.
      }
    }

    const code = String(error?.errorInfo?.code || "unknown");
    const details = String(error?.message || "").slice(0, 180);
    // eslint-disable-next-line no-console
    console.error("Signup error", { code, details });

    let message = "Unable to create account with those credentials.";
    if (code.includes("email-already-exists")) {
      message = "That email is already registered. Please sign in instead.";
    }

    res.status(htmxFriendlyStatus(req, 400)).render("partials/auth", {
      mode: "signup",
      message,
      nextPath,
    });
  }
});

app.post("/auth/login", authRateLimit, async (req, res) => {
  const email = sanitizeSingleLine(req.body.email, 254).toLowerCase();
  const password = String(req.body.password || "");
  const nextPath = normalizeNextPath(req.body.next);

  if (!email || !password) {
    return res.status(htmxFriendlyStatus(req, 400)).render("partials/auth", {
      mode: "login",
      message: "Email and password are required.",
      nextPath,
    });
  }

  if (!isEmailLike(email) || password.length < 6) {
    return res.status(htmxFriendlyStatus(req, 401)).render("partials/auth", {
      mode: "login",
      message: "Invalid email or password.",
      nextPath,
    });
  }

  try {
    const decoded = await loginWithFirebase(email, password);
    let profile = null;
    try {
      profile = await db.collection("users").doc(decoded.uid).get();
    } catch {
      profile = null;
    }

    await regenerateSession(req);

    req.session.user = {
      uid: decoded.uid,
      email: decoded.email || email,
      username: profile.data()?.username || decoded.name || "Cook",
    };

    try {
      await saveSession(req);
      return res.render("partials/post-auth", {
        user: req.session.user,
        message: "",
        nextPath,
      });
    } catch (saveError) {
      return res.status(htmxFriendlyStatus(req, 500)).render("partials/auth", {
        mode: "login",
        message: "Session could not be created. Please try again.",
        nextPath,
      });
    }
  } catch (error) {
    const code = String(error?.code || error?.errorInfo?.code || "unknown");
    const details = String(error?.message || "").slice(0, 180);
    // eslint-disable-next-line no-console
    console.error("Login error", { code, details });

    return res.status(htmxFriendlyStatus(req, 401)).render("partials/auth", {
      mode: "login",
      message: "Invalid email or password.",
      nextPath,
    });
  }
});

app.post("/auth/logout", writeRateLimit, (req, res) => {
  req.session.destroy(() => {
    res.render("partials/post-auth", {
      user: null,
      message: "Signed out.",
      nextPath: "/pages/home",
    });
  });
});

app.use((err, req, res, next) => {
  if (res.headersSent) {
    return next(err);
  }

  const errorMessage = String(err?.message || "unexpected-error").slice(0, 200);
  const errorCode = String(err?.code || err?.errorInfo?.code || "unknown").slice(0, 100);
  // eslint-disable-next-line no-console
  console.error("Unhandled request error", { errorCode, errorMessage, path: req.originalUrl, method: req.method });

  if (isFirestoreDisabledError(err)) {
    return res.status(500).send(
      '<section class="panel" role="alert"><h1>Firestore not enabled</h1><p>Cloud Firestore API is disabled for this Firebase project. Enable Firestore in the Firebase console, wait a minute, and retry.</p></section>',
    );
  }

  if (isHtmx(req)) {
    return res.status(500).send('<section class="panel" role="alert"><h1>Something went wrong</h1><p>Please try again.</p></section>');
  }

  return res.status(500).send("<h1>Something went wrong</h1><p>Please try again.</p>");
});

app.use((req, res) => {
  res.status(404).send('<section class="panel" role="alert"><h1>Page not found</h1><p>The requested page was not found.</p></section>');
});

// Only start a local HTTP server when server.js is run directly (not imported).
if (isMain) {
  if (!isManagedRuntime) {
    validateLocalRuntimeEnv();
  }
  app.listen(Number(APP_PORT), () => {
    // eslint-disable-next-line no-console
    console.log(`HTMX Cookbook running on http://localhost:${APP_PORT}`);
  });
}

export { app };
