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

const {
  FIREBASE_PROJECT_ID = "htmx-cookbook",
  FIREBASE_CLIENT_EMAIL,
  FIREBASE_PRIVATE_KEY,
  FIREBASE_WEB_API_KEY,
  SESSION_SECRET,
  PORT = "3000",
} = process.env;

function normalizePrivateKey(rawKey) {
  return String(rawKey || "")
    .replace(/\\\r?\n/g, "\n")
    .replace(/\\n/g, "\n");
}

// When running as a Cloud Function the runtime provides Application Default
// Credentials automatically, so explicit service-account keys are optional.
const isCloudFunction = !!process.env.K_SERVICE || !!process.env.FUNCTION_TARGET;

if (!SESSION_SECRET || !FIREBASE_WEB_API_KEY) {
  throw new Error(
    "Missing env vars. Required: FIREBASE_WEB_API_KEY, SESSION_SECRET",
  );
}

if (!isCloudFunction && (!FIREBASE_CLIENT_EMAIL || !FIREBASE_PRIVATE_KEY)) {
  throw new Error(
    "Missing env vars. Required locally: FIREBASE_CLIENT_EMAIL, FIREBASE_PRIVATE_KEY",
  );
}

if (!admin.apps.length) {
  if (FIREBASE_CLIENT_EMAIL && FIREBASE_PRIVATE_KEY) {
    admin.initializeApp({
      credential: admin.credential.cert({
        projectId: FIREBASE_PROJECT_ID,
        clientEmail: FIREBASE_CLIENT_EMAIL,
        privateKey: normalizePrivateKey(FIREBASE_PRIVATE_KEY),
      }),
      projectId: FIREBASE_PROJECT_ID,
    });
  } else {
    // Cloud Functions runtime: use Application Default Credentials.
    admin.initializeApp({ projectId: FIREBASE_PROJECT_ID });
  }
}

const db = admin.firestore();
const app = express();

app.set("view engine", "pug");
app.set("views", path.join(__dirname, "views"));
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
    name: "cookbook.sid",
    secret: SESSION_SECRET,
    resave: false,
    saveUninitialized: false,
    cookie: {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
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
    return true;
  }

  const statusMessage = "Please sign in to continue.";
  const statusCode = isHtmx(req) ? 200 : 401;
  res.status(statusCode).render("partials/auth", {
    mode: "login",
    message: statusMessage,
  });
  return false;
}

async function loginWithFirebase(email, password) {
  const endpoint = `https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=${encodeURIComponent(FIREBASE_WEB_API_KEY)}`;
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
  });
});

app.post("/auth/signup", async (req, res) => {
  const email = String(req.body.email || "").trim();
  const password = String(req.body.password || "").trim();
  const username = String(req.body.username || "").trim();

  if (!email || !password || !username) {
    return res.status(htmxFriendlyStatus(req, 400)).render("partials/auth", {
      mode: "signup",
      message: "All signup fields are required.",
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

    res.render("partials/post-auth", {
      user: req.session.user,
      message: "Account created. You are now signed in.",
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
    });
  }
});

app.post("/auth/login", async (req, res) => {
  const email = String(req.body.email || "").trim();
  const password = String(req.body.password || "").trim();

  if (!email || !password) {
    return res.status(htmxFriendlyStatus(req, 400)).render("partials/auth", {
      mode: "login",
      message: "Email and password are required.",
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

    return res.render("partials/post-auth", {
      user: req.session.user,
      message: "",
    });
  } catch (error) {
    const details = String(error?.message || "");
    let message = "Invalid email or password.";
    if (details.includes("EMAIL_NOT_FOUND")) {
      message = "No account found with that email.";
    } else if (details.includes("INVALID_LOGIN_CREDENTIALS")) {
      message = "No matching account/password found. If signup previously failed, create account again after Firestore is enabled.";
    } else if (details.includes("INVALID_PASSWORD")) {
      message = "Invalid email or password.";
    } else if (details.includes("USER_DISABLED")) {
      message = "This account is disabled.";
    } else if (details.includes("CONFIGURATION_NOT_FOUND")) {
      message = "Email/password sign-in is disabled in Firebase Auth settings.";
    } else if (details.includes("API key not valid")) {
      message = "FIREBASE_WEB_API_KEY is invalid for this project.";
    }

    return res.status(htmxFriendlyStatus(req, 401)).render("partials/auth", {
      mode: "login",
      message,
    });
  }
});

app.post("/auth/logout", (req, res) => {
  req.session.destroy(() => {
    res.render("partials/post-auth", {
      user: null,
      message: "Signed out.",
    });
  });
});

app.use((err, req, res, next) => {
  if (res.headersSent) {
    return next(err);
  }

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

// Only start a local HTTP server when not running inside a Cloud Function.
if (!isCloudFunction) {
  app.listen(Number(PORT), () => {
    // eslint-disable-next-line no-console
    console.log(`HTMX Cookbook running on http://localhost:${PORT}`);
  });
}

export { app };
