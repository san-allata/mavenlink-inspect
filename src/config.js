import fs from "node:fs";
import path from "node:path";
import dotenv from "dotenv";

dotenv.config();

const ENV_PATH = path.resolve(process.cwd(), ".env");

function parseEnvCompat() {
  if (!fs.existsSync(ENV_PATH)) return {};
  const raw = fs.readFileSync(ENV_PATH, "utf8");
  const lines = raw.split(/\r?\n/);
  const out = {};

  for (const line of lines) {
    if (!line || line.trim().startsWith("#")) continue;
    const idx = line.indexOf("=");
    if (idx === -1) continue;
    const key = line.slice(0, idx).trim();
    const value = line.slice(idx + 1).trim();
    out[key] = value;
  }

  return out;
}

const compatEnv = parseEnvCompat();

function getEnv(...keys) {
  for (const key of keys) {
    if (process.env[key]) return process.env[key];
    if (compatEnv[key]) return compatEnv[key];
  }
  return "";
}

export const config = {
  port: Number(process.env.PORT || 3000),
  apiBaseUrl: "https://api.mavenlink.com/api/v1",
  oauthAuthorizeUrl: "https://app.mavenlink.com/oauth/authorize",
  oauthTokenUrl: "https://app.mavenlink.com/oauth/token",
  clientId: getEnv("KANTATA_CLIENT_ID", "APP_ID", "AP_ID", "CLIENT_ID"),
  clientSecret: getEnv(
    "KANTATA_CLIENT_SECRET",
    "SECRET_TOKEN",
    "SECRET+TOKEN",
    "CLIENT_SECRET"
  ),
  redirectUri: getEnv("KANTATA_REDIRECT_URI", "CALLBACK_URL", "REDIRECT_URI")
};

export function validateConfig() {
  const missing = [];
  if (!config.clientId) missing.push("KANTATA_CLIENT_ID (or APP_ID/AP_ID)");
  if (!config.clientSecret) {
    missing.push("KANTATA_CLIENT_SECRET (or SECRET_TOKEN/SECRET+TOKEN)");
  }
  if (!config.redirectUri) {
    missing.push("KANTATA_REDIRECT_URI (or CALLBACK_URL)");
  }
  return missing;
}
