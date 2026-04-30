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
const APP_PORT = process.env.PORT || process.env.APP_PORT || "3000";
const isProduction = process.env.NODE_ENV === "production";
const isManagedRuntime = Boolean(process.env.K_SERVICE || process.env.PORT || process.env.FUNCTION_TARGET);

const isMain = process.argv[1] === fileURLToPath(import.meta.url);

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

function debugLog(event, payload = {}) {
  try {
    // eslint-disable-next-line no-console
    console.log(`[debug] ${event} ${JSON.stringify(payload)}`);
  } catch {
    // eslint-disable-next-line no-console
    console.log(`[debug] ${event}`);
  }
}

function summarizeUser(user) {
  if (!user) {
    return null;
  }

  return {
    uid: user.uid || null,
    email: user.email || null,
    username: user.username || null,
  };
}

function formatDebugValue(value) {
  if (value === null) return "null";
  if (value === undefined) return "undefined";
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);

  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

function buildDebugInfo(req, extraEntries = []) {
  const cookieHeader = String(req.headers.cookie || "");
  const cookieNames = Object.keys(parseCookies(cookieHeader));
  const entries = [
    ["Route", `${req.method} ${req.originalUrl}`],
    ["HX Request", isHtmx(req)],
    ["Managed Runtime", isManagedRuntime],
    ["Session ID", req.sessionID || "(none)"],
    ["Session Cookie Present", cookieHeader.includes("cookbook.sid=")],
    ["Cookie Names", cookieNames.length ? cookieNames.join(", ") : "(none)"],
    ["Request Secure", Boolean(req.secure)],
    ["Protocol", req.protocol],
    ["X-Forwarded-Proto", req.get("X-Forwarded-Proto") || "(missing)"],
    ["Host", req.get("Host") || "(missing)"],
    ["Origin", req.get("Origin") || "(missing)"],
    ["Referer", req.get("Referer") || "(missing)"],
    ["Session Has User", Boolean(req.session?.user)],
    ["Session User", summarizeUser(req.session?.user)],
  ];

  for (const entry of extraEntries) {
    entries.push(entry);
  }

  return entries.map(([label, value]) => ({
    label,
    value: formatDebugValue(value),
  }));
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
          debugLog("session:get:miss", { sid });
          callback(null, null);
          return;
        }

        const payload = docSnap.data() || {};
        const sessionData = this.fromStoredSession(payload.session || null);
        if (!sessionData) {
          debugLog("session:get:empty", { sid });
          callback(null, null);
          return;
        }

        const expiresAt = payload.expiresAt;
        if (expiresAt && typeof expiresAt.toDate === "function" && expiresAt.toDate() <= new Date()) {
          debugLog("session:get:expired", { sid, expiresAt: expiresAt.toDate().toISOString() });
          this.collection.doc(sid).delete().catch(() => {});
          callback(null, null);
          return;
        }

        debugLog("session:get:hit", {
          sid,
          hasUser: Boolean(sessionData.user),
          cookieExpires: sessionData.cookie?.expires || null,
        });
        callback(null, sessionData);
      })
      .catch((error) => {
        debugLog("session:get:error", { sid, message: String(error?.message || error) });
        callback(error);
      });
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
      .then(() => {
        debugLog("session:set", {
          sid,
          hasUser: Boolean(sessionData.user),
          cookieExpires: sessionData.cookie?.expires || null,
        });
        callback && callback(null);
      })
      .catch((error) => {
        debugLog("session:set:error", { sid, message: String(error?.message || error) });
        callback && callback(error);
      });
  }

  destroy(sid, callback) {
    this.collection
      .doc(sid)
      .delete()
      .then(() => {
        debugLog("session:destroy", { sid });
        callback && callback(null);
      })
      .catch((error) => {
        debugLog("session:destroy:error", { sid, message: String(error?.message || error) });
        callback && callback(error);
      });
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
  res.setHeader("Permissions-Policy", "camera=(), microphone=(), geolocation=()");
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
app.use(express.urlencoded({ extended: true }));
app.use(express.json());

app.use(
  session({
    store: sessionStore,
    name: "cookbook.sid",
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

app.use(issueCsrfCookie);
app.use(requireCsrf);

app.use((req, res, next) => {
  res.locals.currentUser = req.session.user || null;
  next();
});

app.use((req, res, next) => {
  if (!req.path.startsWith("/auth") && !req.path.startsWith("/favorites") && !req.path.startsWith("/my-recipes")) {
    return next();
  }

  const startedAt = Date.now();
  debugLog("request:start", {
    method: req.method,
    path: req.originalUrl,
    sessionId: req.sessionID || null,
    hasSessionCookie: String(req.headers.cookie || "").includes("cookbook.sid="),
    hasUser: Boolean(req.session?.user),
    hxRequest: isHtmx(req),
    secure: Boolean(req.secure),
    forwardedProto: req.get("X-Forwarded-Proto") || null,
  });

  res.on("finish", () => {
    const setCookie = res.getHeader("Set-Cookie");
    debugLog("request:finish", {
      method: req.method,
      path: req.originalUrl,
      statusCode: res.statusCode,
      durationMs: Date.now() - startedAt,
      sessionId: req.sessionID || null,
      hasUser: Boolean(req.session?.user),
      setCookieCount: Array.isArray(setCookie) ? setCookie.length : setCookie ? 1 : 0,
    });
  });

  return next();
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

  if (cookies.csrfToken) {
    req.csrfToken = cookies.csrfToken;
    return next();
  }

  const csrfToken = crypto.randomBytes(24).toString("hex");
  req.csrfToken = csrfToken;
  req.cookies.csrfToken = csrfToken;

  const secure = process.env.NODE_ENV === "production" ? "; Secure" : "";
  appendCookie(res, `csrfToken=${encodeURIComponent(csrfToken)}; Path=/; SameSite=Lax${secure}`);
  return next();
}

function requireCsrf(req, res, next) {
  if (!["POST", "PUT", "PATCH", "DELETE"].includes(req.method)) {
    return next();
  }

  const cookieToken = req.cookies?.csrfToken;
  const headerToken = req.get("X-CSRF-Token");
  if (cookieToken && headerToken && cookieToken === headerToken) {
    return next();
  }

  return res.status(403).send(
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
  if (req.session.user) {
    debugLog("auth:allowed", {
      path: req.originalUrl,
      sessionId: req.sessionID || null,
      user: summarizeUser(req.session.user),
    });
    return true;
  }

  debugLog("auth:blocked", {
    path: req.originalUrl,
    sessionId: req.sessionID || null,
    hasSessionCookie: String(req.headers.cookie || "").includes("cookbook.sid="),
    cookieNames: Object.keys(parseCookies(String(req.headers.cookie || ""))),
    hasUser: Boolean(req.session?.user),
  });

  const statusMessage = "Please sign in to continue.";
  const statusCode = isHtmx(req) ? 200 : 401;
  res.status(statusCode).render("partials/auth", {
    mode: "login",
    message: statusMessage,
    nextPath: normalizeNextPath(req.originalUrl),
    debugInfo: buildDebugInfo(req, [["Auth Guard", "Blocked because req.session.user was missing."]]),
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
  return {
    recipeId: String(meal.idMeal || ""),
    title: String(meal.strMeal || "Untitled Recipe"),
    image: String(meal.strMealThumb || ""),
    category: String(meal.strCategory || ""),
    source: "themealdb",
    addedAt: admin.firestore.FieldValue.serverTimestamp(),
  };
}

function customRecipeDoc(data) {
  const title = String(data.title || "").trim();
  const ingredientsRaw = String(data.ingredients || "");
  const instructions = String(data.instructions || "").trim();

  if (!title || !ingredientsRaw.trim() || !instructions) {
    return null;
  }

  const prep = Number.parseInt(String(data.prepTime || "").trim(), 10);
  const servings = Number.parseInt(String(data.servings || "").trim(), 10);

  return {
    title,
    description: String(data.description || "").trim(),
    ingredients: ingredientsRaw
      .split(/\r\n|\n|\r/)
      .map((s) => s.trim())
      .filter(Boolean),
    instructions,
    prepTime: Number.isNaN(prep) ? null : prep,
    servings: Number.isNaN(servings) ? null : servings,
    tags: String(data.tags || "")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean),
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
  };
}

function inlineValidationHtml(message, valid = false) {
  const tone = valid ? "valid" : "invalid";
  return `<p class="inline-validation ${tone}" role="status">${message}</p>`;
}

function isEmailLike(value) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(value || "").trim());
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
    const snap = await db.collection("users").doc(req.session.user.uid).collection("favorites").get();
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

app.get("/search", async (req, res) => {
  const query = String(req.query.q || "").trim();
  const category = String(req.query.category || "").trim();
  const page = Math.max(1, Number.parseInt(String(req.query.page || "1"), 10) || 1);
  const perPage = 6;

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
    const snap = await db.collection("users").doc(req.session.user.uid).collection("favorites").get();
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

app.get("/validate/auth/email", (req, res) => {
  const email = String(req.query.email || "").trim();
  if (!email) {
    return res.send(inlineValidationHtml("Email is required."));
  }
  if (!isEmailLike(email)) {
    return res.send(inlineValidationHtml("Enter a valid email address."));
  }
  return res.send(inlineValidationHtml("Email looks good.", true));
});

app.get("/validate/auth/password", (req, res) => {
  const password = String(req.query.password || "");
  if (!password) {
    return res.send(inlineValidationHtml("Password is required."));
  }
  if (password.length < 6) {
    return res.send(inlineValidationHtml("Use at least 6 characters."));
  }
  return res.send(inlineValidationHtml("Password length is valid.", true));
});

app.get("/validate/auth/username", (req, res) => {
  const username = String(req.query.username || "").trim();
  if (!username) {
    return res.send(inlineValidationHtml("Username is required."));
  }
  if (username.length < 2) {
    return res.send(inlineValidationHtml("Use at least 2 characters."));
  }
  return res.send(inlineValidationHtml("Username looks good.", true));
});

app.get("/validate/recipe/title", (req, res) => {
  const title = String(req.query.title || "").trim();
  if (!title) {
    return res.send(inlineValidationHtml("Title is required."));
  }
  if (title.length < 3) {
    return res.send(inlineValidationHtml("Use at least 3 characters."));
  }
  return res.send(inlineValidationHtml("Title looks good.", true));
});

app.get("/validate/recipe/ingredients", (req, res) => {
  const raw = String(req.query.ingredients || "");
  const count = raw
    .split(/\r\n|\n|\r/)
    .map((item) => item.trim())
    .filter(Boolean).length;

  if (count === 0) {
    return res.send(inlineValidationHtml("Add at least one ingredient."));
  }
  return res.send(inlineValidationHtml(`${count} ingredient${count === 1 ? "" : "s"} listed.`, true));
});

app.get("/validate/recipe/instructions", (req, res) => {
  const instructions = String(req.query.instructions || "").trim();
  if (!instructions) {
    return res.send(inlineValidationHtml("Instructions are required."));
  }
  if (instructions.length < 20) {
    return res.send(inlineValidationHtml("Add a bit more detail (20+ chars)."));
  }
  return res.send(inlineValidationHtml("Instructions look good.", true));
});

app.get("/recipe/:id", async (req, res) => {
  const id = String(req.params.id || "");
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
    user: req.session.user || null,
  });
});

app.patch("/favorites/:id", async (req, res) => {
  if (!authRequired(req, res)) {
    return;
  }

  const id = String(req.params.id || "");
  const favRef = db.collection("users").doc(req.session.user.uid).collection("favorites").doc(id);
  const existing = await favRef.get();

  if (existing.exists) {
    await favRef.delete();
    return res.render("partials/favorite-action", {
      mealId: id,
      isFavorite: false,
      title: req.body.title || "Recipe",
      image: req.body.image || "",
      category: req.body.category || "",
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

app.post("/favorites/:id", async (req, res) => {
  if (!authRequired(req, res)) {
    return;
  }

  const id = String(req.params.id || "");
  const favoriteDoc = sanitizeRecipeForFavorite({
    idMeal: id,
    strMeal: req.body.title,
    strMealThumb: req.body.image,
    strCategory: req.body.category,
  });

  await db.collection("users").doc(req.session.user.uid).collection("favorites").doc(id).set(favoriteDoc);

  const items = await db.collection("users").doc(req.session.user.uid).collection("favorites").get();
  const favorites = items.docs.map((item) => ({ id: item.id, ...item.data() }));

  res.render("partials/favorites", {
    favorites,
    user: req.session.user,
    message: "Recipe saved to favorites.",
  });
});

app.delete("/favorites/:id", async (req, res) => {
  if (!authRequired(req, res)) {
    return;
  }

  const id = String(req.params.id || "");
  await db.collection("users").doc(req.session.user.uid).collection("favorites").doc(id).delete();

  const items = await db.collection("users").doc(req.session.user.uid).collection("favorites").get();
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

  const items = await db.collection("users").doc(req.session.user.uid).collection("favorites").get();
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

  const snap = await db.collection("users").doc(req.session.user.uid).collection("customRecipes").get();
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

  const docSnap = await db
    .collection("users")
    .doc(req.session.user.uid)
    .collection("customRecipes")
    .doc(req.params.id)
    .get();

  if (!docSnap.exists) {
    return res.status(404).send('<p role="alert">Recipe not found.</p>');
  }

  const snap = await db.collection("users").doc(req.session.user.uid).collection("customRecipes").get();
  const recipes = snap.docs.map((item) => ({ id: item.id, ...item.data() }));

  return res.render("partials/my-recipes", {
    recipes,
    editRecipe: { id: docSnap.id, ...docSnap.data() },
    user: req.session.user,
    message: "Editing recipe.",
  });
});

app.post("/my-recipes", async (req, res) => {
  if (!authRequired(req, res)) {
    return;
  }

  const payload = customRecipeDoc(req.body);
  if (!payload) {
    return res.status(400).send('<p role="alert">Title, ingredients, and instructions are required.</p>');
  }

  payload.createdAt = admin.firestore.FieldValue.serverTimestamp();

  await db.collection("users").doc(req.session.user.uid).collection("customRecipes").add(payload);

  const snap = await db.collection("users").doc(req.session.user.uid).collection("customRecipes").get();
  const recipes = snap.docs.map((item) => ({ id: item.id, ...item.data() }));

  res.render("partials/my-recipes", {
    recipes,
    editRecipe: null,
    user: req.session.user,
    message: "Recipe created.",
  });
});

app.put("/my-recipes/:id", async (req, res) => {
  if (!authRequired(req, res)) {
    return;
  }

  const payload = customRecipeDoc(req.body);
  if (!payload) {
    return res.status(400).send('<p role="alert">Title, ingredients, and instructions are required.</p>');
  }

  await db.collection("users").doc(req.session.user.uid).collection("customRecipes").doc(req.params.id).set(payload, {
    merge: true,
  });

  const snap = await db.collection("users").doc(req.session.user.uid).collection("customRecipes").get();
  const recipes = snap.docs.map((item) => ({ id: item.id, ...item.data() }));

  res.render("partials/my-recipes", {
    recipes,
    editRecipe: null,
    user: req.session.user,
    message: "Recipe updated.",
  });
});

app.delete("/my-recipes/:id", async (req, res) => {
  if (!authRequired(req, res)) {
    return;
  }

  await db.collection("users").doc(req.session.user.uid).collection("customRecipes").doc(req.params.id).delete();

  const snap = await db.collection("users").doc(req.session.user.uid).collection("customRecipes").get();
  const recipes = snap.docs.map((item) => ({ id: item.id, ...item.data() }));

  res.render("partials/my-recipes", {
    recipes,
    editRecipe: null,
    user: req.session.user,
    message: "Recipe deleted.",
  });
});

app.get("/auth", (req, res) => {
  const mode = req.query.mode === "signup" ? "signup" : "login";
  res.render("partials/auth", {
    mode,
    message: "",
    nextPath: normalizeNextPath(req.query.next),
    debugInfo: buildDebugInfo(req, [["Auth Screen", "Opened manually or by guard."]]),
  });
});

app.post("/auth/signup", async (req, res) => {
  const email = String(req.body.email || "").trim();
  const password = String(req.body.password || "");
  const username = String(req.body.username || "").trim();
  const nextPath = normalizeNextPath(req.body.next);

  if (!email || !password || !username) {
    return res.status(htmxFriendlyStatus(req, 400)).render("partials/auth", {
      mode: "signup",
      message: "All signup fields are required.",
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

    req.session.user = {
      uid: userRecord.uid,
      email,
      username,
    };

    return req.session.save((saveError) => {
      if (saveError) {
        return res.status(htmxFriendlyStatus(req, 500)).render("partials/auth", {
          mode: "signup",
          message: "Session could not be created. Please try again.",
          nextPath,
          debugInfo: buildDebugInfo(req, [["Signup Save Error", String(saveError?.message || saveError)]]),
        });
      }

      return res.render("partials/post-auth", {
        user: req.session.user,
        message: "Account created. You are now signed in.",
        nextPath,
        debugInfo: buildDebugInfo(req, [
          ["Auth Outcome", "Signup succeeded."],
          ["Next Path", nextPath],
          ["Set-Cookie Prepared", Boolean(res.getHeader("Set-Cookie"))],
          ["Set-Cookie Header", res.getHeader("Set-Cookie") || "(none)"],
        ]),
      });
    });
  } catch (error) {
    if (createdUid && isFirestoreDisabledError(error)) {
      try {
        await admin.auth().deleteUser(createdUid);
      } catch {
        // Ignore rollback errors; setup message below is still actionable.
      }
    }

    const code = error?.errorInfo?.code || "";
    let message = "Unable to create account with those credentials.";
    if (code.includes("email-already-exists")) {
      message = "That email is already registered. Please sign in instead.";
    } else if (code.includes("invalid-password")) {
      message = "Password must be at least 6 characters.";
    } else if (code.includes("insufficient-permission")) {
      message = "Firebase permissions are not configured for Auth user creation.";
    } else if (code.includes("project-not-found") || code.includes("invalid-credential")) {
      message = "Firebase credentials are invalid for this project.";
    } else if (isFirestoreDisabledError(error)) {
      message = "Cloud Firestore API is disabled for this project. Enable Firestore, wait a minute, and try again.";
    }

    res.status(htmxFriendlyStatus(req, 400)).render("partials/auth", {
      mode: "signup",
      message,
      nextPath,
      debugInfo: buildDebugInfo(req, [["Signup Error", String(error?.message || error)]]),
    });
  }
});

app.post("/auth/login", async (req, res) => {
  const email = String(req.body.email || "").trim();
  const password = String(req.body.password || "");
  const nextPath = normalizeNextPath(req.body.next);

  if (!email || !password) {
    return res.status(htmxFriendlyStatus(req, 400)).render("partials/auth", {
      mode: "login",
      message: "Email and password are required.",
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

    req.session.user = {
      uid: decoded.uid,
      email: decoded.email || email,
      username: profile.data()?.username || decoded.name || "Cook",
    };

    return req.session.save((saveError) => {
      if (saveError) {
        return res.status(htmxFriendlyStatus(req, 500)).render("partials/auth", {
          mode: "login",
          message: "Session could not be created. Please try again.",
          nextPath,
          debugInfo: buildDebugInfo(req, [["Login Save Error", String(saveError?.message || saveError)]]),
        });
      }

      return res.render("partials/post-auth", {
        user: req.session.user,
        message: "",
        nextPath,
        debugInfo: buildDebugInfo(req, [
          ["Auth Outcome", "Login succeeded."],
          ["Next Path", nextPath],
          ["Decoded User", summarizeUser(req.session.user)],
          ["Set-Cookie Prepared", Boolean(res.getHeader("Set-Cookie"))],
          ["Set-Cookie Header", res.getHeader("Set-Cookie") || "(none)"],
        ]),
      });
    });
  } catch (error) {
    const code = String(error?.code || error?.errorInfo?.code || "");
    const details = String(error?.message || "");
    let message = `Login failed (${code || "no-code"}): ${details || "No error message returned."}`;
    if (details.includes("EMAIL_NOT_FOUND")) {
      message = "No account found with that email.";
    } else if (details.includes("INVALID_LOGIN_CREDENTIALS")) {
      message = "No matching account/password found. If signup previously failed, create account again after Firestore is enabled.";
    } else if (details.includes("INVALID_PASSWORD")) {
      message = "Firebase returned INVALID_PASSWORD (the account exists, but the submitted password was rejected).";
    } else if (code.includes("auth/argument-error") || code.includes("auth/invalid-credential")) {
      message = "Firebase token verification failed. Your FB_WEB_API_KEY and Admin SDK credentials are likely from different projects.";
    } else if (code.includes("auth/id-token-expired")) {
      message = "Sign-in token expired too quickly. Please try signing in again.";
    } else if (code.includes("auth/id-token-revoked")) {
      message = "Sign-in token was revoked. Please sign in again.";
    } else if (code.includes("auth/project-not-found")) {
      message = "Firebase Admin SDK project is invalid or does not exist.";
    } else if (details.includes("USER_DISABLED")) {
      message = "This account is disabled.";
    } else if (details.includes("CONFIGURATION_NOT_FOUND")) {
      message = "Email/password sign-in is disabled in Firebase Auth settings.";
    } else if (details.includes("API key not valid")) {
      message = "FB_WEB_API_KEY is invalid for this project.";
    } else if (details.includes("incorrect \"aud\"") || details.includes("incorrect \"iss\"")) {
      message = "Firebase project mismatch: FB_WEB_API_KEY and Admin SDK credentials appear to be from different Firebase projects.";
    } else if (details.includes("auth/argument-error") || details.includes("Decoding Firebase ID token failed")) {
      message = "The Firebase ID token could not be verified. Check FB_PROJECT_ID, FB_WEB_API_KEY, and Admin SDK credentials are for the same project.";
    } else if (details.includes("fetch failed") || details.includes("ENOTFOUND") || details.includes("ECONNRESET")) {
      message = "Temporary network issue while contacting Firebase Auth. Please try again.";
    } else {
      // eslint-disable-next-line no-console
      console.error("Login error detail:", { code, details: details || String(error) });
    }

    return res.status(htmxFriendlyStatus(req, 401)).render("partials/auth", {
      mode: "login",
      message,
      nextPath,
      debugInfo: buildDebugInfo(req, [
        ["Login Error Code", code || "(none)"],
        ["Login Error Detail", details || "No error message returned."],
        ["Next Path", nextPath],
      ]),
    });
  }
});

app.post("/auth/logout", (req, res) => {
  req.session.destroy(() => {
    res.render("partials/post-auth", {
      user: null,
      message: "Signed out.",
      nextPath: "/pages/home",
      debugInfo: buildDebugInfo(req, [["Auth Outcome", "Logout completed."]]),
    });
  });
});

app.use((err, req, res, next) => {
  if (res.headersSent) {
    return next(err);
  }

  if (isFirestoreDisabledError(err)) {
    return res.status(500).render("partials/status-panel", {
      title: "Firestore not enabled",
      message: "Cloud Firestore API is disabled for this Firebase project. Enable Firestore in the Firebase console, wait a minute, and retry.",
      debugInfo: buildDebugInfo(req, [["Unhandled Error", String(err?.message || err)]]),
    });
  }

  return res.status(500).render("partials/status-panel", {
    title: "Something went wrong",
    message: "Please try again.",
    debugInfo: buildDebugInfo(req, [["Unhandled Error", String(err?.message || err)]]),
  });
});

app.use((req, res) => {
  res.status(404).render("partials/status-panel", {
    title: "Page not found",
    message: "The requested page was not found.",
    debugInfo: buildDebugInfo(req, [["Route Match", "No matching route handled this request."]]),
  });
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
