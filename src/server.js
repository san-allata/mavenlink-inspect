import express from "express";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { config, validateConfig } from "./config.js";
import { getToken, saveToken, clearToken } from "./tokenStore.js";
import { apiGet, apiGetAllPages, extractResults } from "./kantataClient.js";
import {
  getBudgetCheck,
  getSpendReport,
  getTimesheetStatusReport,
  resolveProject
} from "./reports.js";

const app = express();
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

app.use(express.json({ limit: "5mb" }));
app.use(express.static(path.join(__dirname, "../public")));

function getAuthUrl() {
  const url = new URL(config.oauthAuthorizeUrl);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("client_id", config.clientId);
  url.searchParams.set("redirect_uri", config.redirectUri);
  return url.toString();
}

async function exchangeCodeForToken(code) {
  const body = new URLSearchParams({
    grant_type: "authorization_code",
    code,
    client_id: config.clientId,
    client_secret: config.clientSecret,
    redirect_uri: config.redirectUri
  });

  const res = await fetch(config.oauthTokenUrl, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body
  });

  const payload = await res.json().catch(() => ({}));
  if (!res.ok || !payload.access_token) {
    const msg = payload?.error_description || payload?.error || `OAuth failed (${res.status})`;
    throw new Error(msg);
  }

  return payload.access_token;
}

function requireToken(req, res, next) {
  const token = getToken();
  if (!token) {
    return res.status(401).json({
      error: "Not connected. Use /auth/start or Connect button first."
    });
  }
  req.kantataToken = token;
  next();
}

app.get("/api/health", (_req, res) => {
  const missing = validateConfig();
  res.json({
    ok: true,
    connected: Boolean(getToken()),
    missing_config: missing
  });
});

app.get("/auth/start", (_req, res) => {
  const missing = validateConfig();
  if (missing.length > 0) {
    return res.status(400).json({ error: "Missing config", missing });
  }
  return res.redirect(getAuthUrl());
});

app.get("/oauth/callback", async (req, res) => {
  try {
    if (req.query.error) {
      throw new Error(String(req.query.error_description || req.query.error));
    }
    const code = String(req.query.code || "");
    if (!code) throw new Error("Missing OAuth code in callback.");
    const token = await exchangeCodeForToken(code);
    saveToken(token);
    return res.redirect("/?connected=1");
  } catch (err) {
    return res.status(400).send(`OAuth callback failed: ${err.message}`);
  }
});

app.post("/api/disconnect", (_req, res) => {
  clearToken();
  res.json({ ok: true });
});

app.get("/api/projects/resolve", requireToken, async (req, res) => {
  try {
    const project = await resolveProject(req.kantataToken, req.query.project);
    res.json({ project });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.get("/api/projects", requireToken, async (req, res) => {
  try {
    const rows = await apiGetAllPages(req.kantataToken, "/workspaces.json", {
      order: "title:asc"
    });

    const projects = rows
      .map((w) => ({
        id: w.id,
        title: w.title || "",
        label: `${w.title || "Untitled Project"} (${w.id})`
      }))
      .sort((a, b) => a.title.localeCompare(b.title));

    res.json({ projects });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.get("/api/projects/version", requireToken, async (req, res) => {
  try {
    const payload = await apiGet(req.kantataToken, "/workspaces.json", {
      order: "updated_at:desc",
      optional_fields: "updated_at",
      page: 1,
      per_page: 1
    });
    const top = extractResults(payload)[0] || {};
    const version = `${payload.count || ""}|${top.id || ""}|${top.updated_at || ""}`;
    res.json({ version });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.get("/api/reports/timesheets", requireToken, async (req, res) => {
  try {
    const project = await resolveProject(req.kantataToken, req.query.project);
    const report = await getTimesheetStatusReport(
      req.kantataToken,
      project.id,
      req.query.start,
      req.query.end
    );
    res.json({ project, ...report });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.get("/api/reports/spend", requireToken, async (req, res) => {
  try {
    const project = await resolveProject(req.kantataToken, req.query.project);
    const approvedOnly = ["1", "true", "yes"].includes(
      String(req.query.approvedOnly || "").toLowerCase()
    );
    const completedWeeksOnly = ["1", "true", "yes"].includes(
      String(req.query.completedWeeksOnly || "").toLowerCase()
    );
    const report = await getSpendReport(
      req.kantataToken,
      project.id,
      req.query.start,
      req.query.end,
      req.query.rateType || "bill",
      approvedOnly,
      completedWeeksOnly
    );
    res.json({ project, ...report });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.get("/api/reports/budget", requireToken, async (req, res) => {
  try {
    const project = await resolveProject(req.kantataToken, req.query.project);
    const spendReport = await getSpendReport(
      req.kantataToken,
      project.id,
      req.query.start,
      req.query.end,
      req.query.rateType || "bill"
    );

    const budget = await getBudgetCheck(
      req.kantataToken,
      project.id,
      spendReport.summary,
      req.query.budget
    );

    res.json({ project, spend_summary: spendReport.summary, budget });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.listen(config.port, () => {
  const missing = validateConfig();
  console.log(`Kantata starter app listening on http://localhost:${config.port}`);
  if (missing.length > 0) {
    console.log("Missing config:", missing.join(", "));
  }
});
