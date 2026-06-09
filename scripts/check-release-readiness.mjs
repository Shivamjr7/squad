import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

const root = process.cwd();
const envPath =
  process.argv.find((arg) => arg.startsWith("--env="))?.slice("--env=".length) ??
  ".env.local";
const env = loadEnv(envPath);
const checks = [];

function loadEnv(path) {
  const values = { ...process.env };
  const fullPath = join(root, path);
  if (!existsSync(fullPath)) return values;
  const body = readFileSync(fullPath, "utf8");
  for (const rawLine of body.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const index = line.indexOf("=");
    if (index === -1) continue;
    const key = line.slice(0, index).trim();
    let value = line.slice(index + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    values[key] = value;
  }
  return values;
}

function present(key) {
  const value = env[key];
  return typeof value === "string" && value.trim().length > 0;
}

function add(name, ok, detail) {
  checks.push({ name, ok, detail });
}

function readJson(path) {
  return JSON.parse(readFileSync(join(root, path), "utf8"));
}

function validUrl(value, { requireHttps = true } = {}) {
  try {
    const url = new URL(value);
    return requireHttps ? url.protocol === "https:" : true;
  } catch {
    return false;
  }
}

const requiredEnv = [
  "NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY",
  "CLERK_SECRET_KEY",
  "CLERK_WEBHOOK_SECRET",
  "DATABASE_URL",
  "DIRECT_URL",
  "NEXT_PUBLIC_SUPABASE_URL",
  "NEXT_PUBLIC_SUPABASE_ANON_KEY",
  "SUPABASE_URL",
  "SUPABASE_SERVICE_ROLE_KEY",
  "NEXT_PUBLIC_APP_URL",
  "CRON_SECRET",
  "NEXT_PUBLIC_VAPID_PUBLIC_KEY",
  "VAPID_PUBLIC_KEY",
  "VAPID_PRIVATE_KEY",
  "VAPID_SUBJECT",
  "APP_URL",
  "GOOGLE_PLACES_API_KEY",
];

for (const key of requiredEnv) {
  add(`env:${key}`, present(key), present(key) ? "set" : "missing");
}

const optionalProviderEnv = [
  "OPENWEATHER_API_KEY",
  "TMDB_API_KEY",
  "EVENTBRITE_API_KEY",
];
for (const key of optionalProviderEnv) {
  add(
    `env:${key}`,
    present(key),
    present(key) ? "set" : "missing; related suggestions degrade gracefully",
  );
}

if (present("NEXT_PUBLIC_APP_URL")) {
  add(
    "env:NEXT_PUBLIC_APP_URL is https",
    validUrl(env.NEXT_PUBLIC_APP_URL),
    env.NEXT_PUBLIC_APP_URL,
  );
}

if (present("APP_URL")) {
  add("env:APP_URL is https", validUrl(env.APP_URL), env.APP_URL);
}

if (present("NEXT_PUBLIC_APP_URL") && present("APP_URL")) {
  add(
    "env:APP_URL matches NEXT_PUBLIC_APP_URL",
    env.APP_URL.replace(/\/$/, "") ===
      env.NEXT_PUBLIC_APP_URL.replace(/\/$/, ""),
    "edge and web origins should match for production",
  );
}

if (present("NEXT_PUBLIC_VAPID_PUBLIC_KEY") && present("VAPID_PUBLIC_KEY")) {
  add(
    "env:VAPID public keys match",
    env.NEXT_PUBLIC_VAPID_PUBLIC_KEY === env.VAPID_PUBLIC_KEY,
    "browser and edge function must use the same public key",
  );
}

try {
  const manifest = readJson("public/manifest.webmanifest");
  const icons = Array.isArray(manifest.icons) ? manifest.icons : [];
  add("manifest:display standalone", manifest.display === "standalone", manifest.display);
  add("manifest:portrait orientation", manifest.orientation === "portrait", manifest.orientation);
  add("manifest:192 icon", icons.some((icon) => icon.sizes === "192x192"), "required by TWA");
  add("manifest:512 icon", icons.some((icon) => icon.sizes === "512x512"), "required by TWA");
  add(
    "manifest:maskable icon",
    icons.some((icon) => String(icon.purpose ?? "").includes("maskable")),
    "required for adaptive Android icon",
  );
} catch (err) {
  add("manifest:valid JSON", false, err instanceof Error ? err.message : String(err));
}

try {
  const assetLinks = readJson("public/.well-known/assetlinks.json");
  const target = assetLinks?.[0]?.target;
  const fingerprints = target?.sha256_cert_fingerprints;
  add(
    "assetlinks:package name",
    target?.package_name === "app.squad.twa",
    target?.package_name ?? "missing",
  );
  add(
    "assetlinks:fingerprints",
    Array.isArray(fingerprints) && fingerprints.length > 0,
    Array.isArray(fingerprints) ? `${fingerprints.length} configured` : "missing",
  );
} catch (err) {
  add("assetlinks:valid JSON", false, err instanceof Error ? err.message : String(err));
}

for (const path of [
  "public/sw.js",
  "public/icon-192.png",
  "public/icon-512.png",
  "public/icon-maskable-512.png",
  "supabase/functions/send-push/index.ts",
  "supabase/functions/remind-plans/index.ts",
]) {
  add(`file:${path}`, existsSync(join(root, path)), existsSync(join(root, path)) ? "present" : "missing");
}

const failed = checks.filter((check) => !check.ok);
for (const check of checks) {
  const mark = check.ok ? "PASS" : "FAIL";
  console.log(`${mark} ${check.name} - ${check.detail}`);
}

if (failed.length > 0) {
  console.error(`\n${failed.length} release readiness check(s) failed.`);
  process.exit(1);
}

console.log("\nAll release readiness checks passed.");
