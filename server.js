import express from "express";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Tiny .env loader so we don't need a dotenv dependency. Lines like
// `KEY=value` (with optional surrounding quotes) get loaded into
// process.env unless the variable is already set.
function loadDotenv(file) {
  if (!fs.existsSync(file)) return;
  const text = fs.readFileSync(file, "utf8");
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq === -1) continue;
    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (!(key in process.env)) process.env[key] = value;
  }
}
loadDotenv(path.join(__dirname, ".env"));

const PORT = process.env.PORT || 3000;

const SUPABASE_URL = process.env.SUPABASE_URL || "";
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY || "";

if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
  console.warn(
    "[youtube-jam] SUPABASE_URL / SUPABASE_ANON_KEY not set. " +
      "The UI will load but realtime sync will be disabled until you create " +
      "a Supabase project and set them in .env. See README.md.",
  );
}

const app = express();

// Expose only the public anon key + URL to the browser. The anon key is
// safe to ship to clients; it's the same key Supabase docs put in frontends.
app.get("/api/config", (_req, res) => {
  res.json({
    supabaseUrl: SUPABASE_URL,
    supabaseAnonKey: SUPABASE_ANON_KEY,
  });
});

// Pretty route mirroring youtube.com/watch?v=VIDEO_ID&session=SESSION_ID.
app.get("/watch", (_req, res) => {
  res.sendFile(path.join(__dirname, "public", "watch.html"));
});

app.use(express.static(path.join(__dirname, "public")));

app.listen(PORT, () => {
  console.log(`youtube-jam listening on http://localhost:${PORT}`);
});
