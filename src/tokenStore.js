import fs from "node:fs";
import path from "node:path";

const TOKEN_PATH = path.resolve(process.cwd(), ".kantata-token.json");

let inMemoryToken = null;

export function getToken() {
  if (inMemoryToken) return inMemoryToken;

  if (fs.existsSync(TOKEN_PATH)) {
    try {
      const parsed = JSON.parse(fs.readFileSync(TOKEN_PATH, "utf8"));
      inMemoryToken = parsed.access_token || null;
    } catch {
      inMemoryToken = null;
    }
  }

  return inMemoryToken;
}

export function saveToken(token) {
  inMemoryToken = token;
  fs.writeFileSync(TOKEN_PATH, JSON.stringify({ access_token: token }, null, 2));
}

export function clearToken() {
  inMemoryToken = null;
  if (fs.existsSync(TOKEN_PATH)) fs.unlinkSync(TOKEN_PATH);
}
