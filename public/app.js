const $ = (id) => document.getElementById(id);
const PROJECTS_CACHE_KEY = "kantata.projects.cache.v1";
const PROJECTS_CACHE_VERSION_KEY = "kantata.projects.cache.version.v1";

const el = {
  connectBtn: $("connectBtn"),
  disconnectBtn: $("disconnectBtn"),
  runBtn: $("runBtn"),
  clearProjectBtn: $("clearProjectBtn"),
  thisMonthBtn: $("thisMonthBtn"),
  lastMonthBtn: $("lastMonthBtn"),
  health: $("health"),
  project: $("project"),
  projectOptions: $("projectOptions"),
  start: $("start"),
  end: $("end"),
  timesheetOut: $("timesheetOut"),
  invoicePreviewOut: $("invoicePreviewOut"),
  budgetOut: $("budgetOut")
};

function normalizeProjectRef(value) {
  const raw = String(value || "").trim();
  if (!raw) return "";
  const match = raw.match(/\((\d+)\)\s*$/);
  if (match) return match[1];
  return raw;
}

function query() {
  const q = new URLSearchParams({
    project: normalizeProjectRef(el.project.value),
    start: el.start.value,
    end: el.end.value
  });
  return q.toString();
}

function clearAndSetMessage(host, message) {
  host.textContent = message;
}

function renderTable(host, columns, rows) {
  host.innerHTML = "";
  if (!rows || rows.length === 0) {
    clearAndSetMessage(host, "No rows returned.");
    return;
  }

  const table = document.createElement("table");
  table.className = "data-table";

  const thead = document.createElement("thead");
  const trh = document.createElement("tr");
  for (const col of columns) {
    const th = document.createElement("th");
    th.textContent = col;
    trh.appendChild(th);
  }
  thead.appendChild(trh);

  const tbody = document.createElement("tbody");
  for (const row of rows) {
    const tr = document.createElement("tr");
    for (const col of columns) {
      const td = document.createElement("td");
      td.textContent = row[col] == null ? "" : String(row[col]);
      tr.appendChild(td);
    }
    tbody.appendChild(tr);
  }

  table.appendChild(thead);
  table.appendChild(tbody);
  host.appendChild(table);
}

function objectToRows(obj) {
  return Object.entries(obj || {}).map(([key, value]) => ({
    field: key,
    value: typeof value === "object" && value !== null ? JSON.stringify(value) : String(value)
  }));
}

function normalizeTimesheetRows(rows) {
  const map = new Map();

  for (const row of rows || []) {
    const userId = String(row.user_id || "");
    if (!userId) continue;

    const existing = map.get(userId) || {
      user_name: row.user_name || userId,
      user_id: userId,
      weeks: 0,
      submission_events: 0,
      total_hours_logged: 0,
      statuses: new Set()
    };

    existing.weeks += 1;
    existing.submission_events += Number(row.submission_events || 0);
    existing.total_hours_logged += Number(row.hours_logged || 0);
    if (row.latest_status) existing.statuses.add(String(row.latest_status));

    map.set(userId, existing);
  }

  return [...map.values()]
    .map((r) => ({
      user_name: r.user_name,
      user_id: r.user_id,
      weeks: r.weeks,
      latest_status: r.statuses.size === 1 ? [...r.statuses][0] : [...r.statuses].join(", "),
      submission_events: r.submission_events,
      total_hours_logged: Number(r.total_hours_logged.toFixed(2)),
      avg_hours_per_week: r.weeks > 0 ? Number((r.total_hours_logged / r.weeks).toFixed(2)) : 0
    }))
    .sort((a, b) => a.user_name.localeCompare(b.user_name));
}

function toCurrency(value) {
  const n = Number(value || 0);
  return n.toLocaleString(undefined, { style: "currency", currency: "USD" });
}

function renderInvoiceStylePreview(host, project, startDate, endDate, spend) {
  host.innerHTML = "";

  const metaHost = document.createElement("div");
  host.appendChild(metaHost);
  const metaRows = [
    { field: "project", value: project?.title || project?.id || "" },
    { field: "period_start", value: startDate || "" },
    { field: "period_end", value: endDate || "" },
    { field: "rate_type", value: "bill" }
  ];
  renderTable(metaHost, ["field", "value"], metaRows);

  const byPerson = spend.byPerson || [];
  const lineRows = byPerson.map((r) => ({
    resource: r.user_name,
    hours: Number(r.hours || 0).toFixed(2),
    rate: toCurrency(r.rate || 0),
    amount: toCurrency(r.spend || 0)
  }));

  const linesTitle = document.createElement("p");
  linesTitle.className = "muted";
  linesTitle.style.marginTop = "10px";
  linesTitle.textContent = "Statement of Services";
  host.appendChild(linesTitle);

  const linesHost = document.createElement("div");
  host.appendChild(linesHost);
  renderTable(linesHost, ["resource", "hours", "rate", "amount"], lineRows);

  const totalHours = byPerson.reduce((sum, r) => sum + Number(r.hours || 0), 0);
  const totalAmount = byPerson.reduce((sum, r) => sum + Number(r.spend || 0), 0);
  const totalsTitle = document.createElement("p");
  totalsTitle.className = "muted";
  totalsTitle.style.marginTop = "10px";
  totalsTitle.textContent = "Invoice Totals";
  host.appendChild(totalsTitle);

  const totalsHost = document.createElement("div");
  host.appendChild(totalsHost);
  renderTable(
    totalsHost,
    ["field", "value"],
    [
      { field: "line_items", value: String(byPerson.length) },
      { field: "total_hours", value: Number(totalHours.toFixed(2)).toFixed(2) },
      { field: "total_amount", value: toCurrency(totalAmount) }
    ]
  );
}

async function fetchJson(url) {
  const res = await fetch(url);
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error || `HTTP ${res.status}`);
  return body;
}

async function refreshHealth() {
  try {
    const health = await fetchJson("/api/health");
    const missing = health.missing_config || [];
    if (missing.length > 0) {
      el.health.textContent = `Missing config: ${missing.join(", ")}`;
    } else {
      el.health.textContent = health.connected ? "Connected" : "Not connected";
    }
  } catch (err) {
    el.health.textContent = `Health error: ${err.message}`;
  }
}

function renderProjectOptions(projects) {
  el.projectOptions.innerHTML = "";
  for (const p of projects || []) {
    const option = document.createElement("option");
    option.value = p.label;
    el.projectOptions.appendChild(option);
  }
}

function readProjectCache() {
  try {
    const raw = localStorage.getItem(PROJECTS_CACHE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function writeProjectCache(projects, version) {
  localStorage.setItem(PROJECTS_CACHE_KEY, JSON.stringify(projects || []));
  if (version) {
    localStorage.setItem(PROJECTS_CACHE_VERSION_KEY, String(version));
  }
}

async function preloadProjects() {
  const cachedProjects = readProjectCache();
  if (cachedProjects.length > 0) {
    renderProjectOptions(cachedProjects);
  }

  try {
    const versionResp = await fetchJson("/api/projects/version");
    const latestVersion = String(versionResp.version || "");
    const cachedVersion = String(localStorage.getItem(PROJECTS_CACHE_VERSION_KEY) || "");

    if (cachedProjects.length > 0 && latestVersion && latestVersion === cachedVersion) {
      return;
    }

    const payload = await fetchJson("/api/projects");
    const projects = payload.projects || [];
    renderProjectOptions(projects);
    writeProjectCache(projects, latestVersion);
  } catch {
    // Project list load is best-effort and depends on active connection.
  }
}

function formatDateUTC(d) {
  const yyyy = d.getUTCFullYear();
  const mm = String(d.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(d.getUTCDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

function setThisMonthRange() {
  const now = new Date();
  const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  el.start.value = formatDateUTC(start);
  el.end.value = formatDateUTC(now);
}

function setLastMonthRange() {
  const now = new Date();
  const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1));
  const end = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 0));
  el.start.value = formatDateUTC(start);
  el.end.value = formatDateUTC(end);
}

el.connectBtn.addEventListener("click", () => {
  window.location.href = "/auth/start";
});

el.disconnectBtn.addEventListener("click", async () => {
  await fetch("/api/disconnect", { method: "POST" });
  await refreshHealth();
  el.projectOptions.innerHTML = "";
  localStorage.removeItem(PROJECTS_CACHE_KEY);
  localStorage.removeItem(PROJECTS_CACHE_VERSION_KEY);
});

el.thisMonthBtn.addEventListener("click", () => {
  setThisMonthRange();
});

el.lastMonthBtn.addEventListener("click", () => {
  setLastMonthRange();
});

el.clearProjectBtn.addEventListener("click", () => {
  el.project.value = "";
  el.project.focus();
});

el.runBtn.addEventListener("click", async () => {
  try {
    const q = query();

    const ts = await fetchJson(`/api/reports/timesheets?${q}`);
    const tsSummaryRows = objectToRows(ts.summary || {});
    const normalizedByUser = normalizeTimesheetRows(ts.summaryRows || []);

    el.timesheetOut.innerHTML = "";
    const detailTitle = document.createElement("p");
    detailTitle.className = "muted";
    detailTitle.style.marginTop = "10px";
    detailTitle.textContent = "Normalized by user (selected period)";
    el.timesheetOut.appendChild(detailTitle);
    const detailsHost = document.createElement("div");
    el.timesheetOut.appendChild(detailsHost);
    renderTable(
      detailsHost,
      [
        "user_name",
        "user_id",
        "weeks",
        "latest_status",
        "submission_events",
        "total_hours_logged",
        "avg_hours_per_week"
      ],
      normalizedByUser
    );

    const projectResp = await fetchJson(`/api/projects/resolve?${q}`);
    const spend = await fetchJson(
      `/api/reports/spend?${q}&approvedOnly=1&completedWeeksOnly=1`
    );

    renderInvoiceStylePreview(
      el.invoicePreviewOut,
      projectResp.project,
      el.start.value,
      el.end.value,
      spend
    );

    const budget = await fetchJson(`/api/reports/budget?${q}`);
    renderTable(el.budgetOut, ["field", "value"], objectToRows(budget.budget || {}));
  } catch (err) {
    clearAndSetMessage(el.invoicePreviewOut, err.message);
    clearAndSetMessage(el.timesheetOut, "-");
    clearAndSetMessage(el.budgetOut, "-");
  }
});

setLastMonthRange();

refreshHealth();
preloadProjects();
