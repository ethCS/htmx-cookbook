import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import pug from "pug";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, "..");
const viewsRoot = path.join(repoRoot, "views");
const indexHtmlPath = path.join(repoRoot, "index.html");

function collectPugFiles(dirPath) {
  const entries = fs.readdirSync(dirPath, { withFileTypes: true });
  const files = [];

  for (const entry of entries) {
    const fullPath = path.join(dirPath, entry.name);
    if (entry.isDirectory()) {
      files.push(...collectPugFiles(fullPath));
      continue;
    }

    if (entry.isFile() && entry.name.endsWith(".pug")) {
      files.push(fullPath);
    }
  }

  return files;
}

const pugFiles = collectPugFiles(viewsRoot);
for (const filePath of pugFiles) {
  pug.compileFile(filePath, { basedir: viewsRoot, pretty: false });
}

const indexHtml = fs.readFileSync(indexHtmlPath, "utf8");
if (!indexHtml.includes("htmx.org")) {
  throw new Error("index.html must include HTMX.");
}

if (!indexHtml.includes("/public/app.js")) {
  throw new Error("index.html must include /public/app.js.");
}

console.log(`Verified ${pugFiles.length} Pug templates and the app shell.`);
