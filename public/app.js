const $ = (id) => document.getElementById(id);
const PROJECTS_CACHE_KEY = "kantata.projects.cache.v1";
const PROJECTS_CACHE_VERSION_KEY = "kantata.projects.cache.version.v1";
const REVENUE_TARGET_STORE_KEY = "kantata.revenue.target.store.v1";

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
  planProject: $("planProject"),
  planMonth1: $("planMonth1"),
  planAmount1: $("planAmount1"),
  planMonth2: $("planMonth2"),
  planAmount2: $("planAmount2"),
  planMonth3: $("planMonth3"),
  planAmount3: $("planAmount3"),
  savePlanBtn: $("savePlanBtn"),
  clearPlanBtn: $("clearPlanBtn"),
  planStatus: $("planStatus"),
  rateNames: $("rateNames"),
  lookupRatesBtn: $("lookupRatesBtn"),
  rateLookupStatus: $("rateLookupStatus"),
  rateLookupOut: $("rateLookupOut"),
  start: $("start"),
  end: $("end"),
  timesheetOut: $("timesheetOut"),
  invoicePreviewOut: $("invoicePreviewOut"),
  budgetOut: $("budgetOut"),
  trendChart: $("trendChart")
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

function getDefaultPlanMonths() {
  const now = new Date();
  const y = now.getUTCFullYear();
  const m = String(now.getUTCMonth() + 1).padStart(2, "0");
  const prev = String((now.getUTCMonth() || 12) - 1).padStart(2, "0");
  const next = String((now.getUTCMonth() % 12) + 1).padStart(2, "0");
  return [`${y}-${prev}`, `${y}-${m}`, `${y}-${next}`];
}

function budgetPlanKey(value) {
  return String(value || "__empty__").toLowerCase().trim();
}

function readRevenueTargetStore() {
  try {
    const parsed = JSON.parse(localStorage.getItem(REVENUE_TARGET_STORE_KEY) || "{}");
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

function writeRevenueTargetStore(store) {
  localStorage.setItem(REVENUE_TARGET_STORE_KEY, JSON.stringify(store || {}));
}

function getCurrentPlanProjectTitle() {
  return el.planProject.value?.trim() || "";
}

function buildfirstFourWeekStartsInMonth(monthKey) {
  const [year, month] = monthKey.split("-").map(Number);
  const starts = [];
  const firstDay = new Date(Date.UTC(year, month - 1, 1));
  const dayOfWeek = (firstDay.getUTCDay() + 6) % 7;
  const weekStart = new Date(firstDay);
  weekStart.setUTCDate(weekStart.getUTCDate() - dayOfWeek);

  for (let i = 0; i < 4; i++) {
    starts.push(weekStart.toISOString().slice(0, 10));
    weekStart.setUTCDate(weekStart.getUTCDate() + 7);
  }
  return starts;
}

function buildRevenueTargetFromMonths(months) {
  const weeklyMap = new Map();
  let total = 0;

  for (const [monthKey, amount] of Object.entries(months || {})) {
    const monthAmount = Number(amount || 0);
    total += monthAmount;
    if (!monthKey || monthAmount <= 0) continue;
    const weekStarts = buildfirstFourWeekStartsInMonth(monthKey);
    const installment = monthAmount / 4;
    for (const weekStart of weekStarts) {
      weeklyMap.set(weekStart, (weeklyMap.get(weekStart) || 0) + installment);
    }
  }

  const weeklyPoints = [...weeklyMap.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([week, amount]) => ({ week, amount: Number(amount.toFixed(2)) }));

  let cumulative = 0;
  const cumulativePoints = weeklyPoints.map((point) => {
    cumulative += point.amount;
    return { week: point.week, cumulative: Number(cumulative.toFixed(2)) };
  });

  return {
    source: "browser-local-monthly-revenue-targets",
    total: Number(total.toFixed(2)),
    months,
    weeklyPoints,
    cumulativePoints,
    planStart: cumulativePoints[0]?.week || null,
    planEnd: cumulativePoints[cumulativePoints.length - 1]?.week || null,
    weekAllocationRule: "Each month is split evenly across the first four weekly buckets in that month."
  };
}

function buildTargetMonthsFromForm() {
  const months = {};
  const fields = [
    [el.planMonth1.value, el.planAmount1.value],
    [el.planMonth2.value, el.planAmount2.value],
    [el.planMonth3.value, el.planAmount3.value]
  ];
  for (const [monthKey, amount] of fields) {
    if (!monthKey) continue;
    months[monthKey] = Number(amount || 0);
  }
  return months;
}

function fillPlanFormFromSavedTarget(projectTitle) {
  const defaults = getDefaultPlanMonths();
  const store = readRevenueTargetStore();
  const saved = store[budgetPlanKey(projectTitle)] || null;
  const monthKeys = saved ? Object.keys(saved.months || {}).sort() : defaults;

  el.planProject.value = projectTitle || "";
  el.planMonth1.value = monthKeys[0] || defaults[0] || "";
  el.planMonth2.value = monthKeys[1] || defaults[1] || "";
  el.planMonth3.value = monthKeys[2] || defaults[2] || "";
  el.planAmount1.value = saved?.months?.[el.planMonth1.value] ?? "";
  el.planAmount2.value = saved?.months?.[el.planMonth2.value] ?? "";
  el.planAmount3.value = saved?.months?.[el.planMonth3.value] ?? "";
  el.planStatus.textContent = saved ? `Using saved revenue targets: ${Number(saved.total).toLocaleString('en-US', {style: 'currency', currency: 'USD'})}.` : "No saved targets yet for this project.";
}

function applySavedRevenueTarget(trendData, projectTitle) {
  const store = readRevenueTargetStore();
  const saved = store[budgetPlanKey(projectTitle)] || null;
  if (!saved || saved.total <= 0) return trendData;
  return {
    ...trendData,
    revenueTarget: saved
  };
}

let _trendChartInstance = null;

function linReg(yValues) {
  if (!yValues || yValues.length < 2) return null;
  const n = yValues.length;
  const xValues = Array.from({ length: n }, (_, i) => i);
  const xMean = xValues.reduce((a, b) => a + b) / n;
  const yMean = yValues.reduce((a, b) => a + b) / n;
  const numerator = xValues.reduce((sum, x, i) => sum + (x - xMean) * (yValues[i] - yMean), 0);
  const denominator = xValues.reduce((sum, x) => sum + (x - xMean) * (x - xMean), 0);
  if (denominator === 0) return null;
  const slope = numerator / denominator;
  const intercept = yMean - slope * xMean;
  return { slope, intercept };
}

function renderTrendChart(canvas, trendData) {
  if (_trendChartInstance) { _trendChartInstance.destroy(); _trendChartInstance = null; }

  const { points, budget, projectEnd, revenueTarget } = trendData;
  if (!points || points.length === 0) return;

  const today = new Date().toISOString().slice(0, 10);
  const actualLabels = [];
  const actualValues = [];
  for (const p of points) {
    actualLabels.push(p.week);
    actualValues.push(p.cumulative);
  }

  const reg = linReg(actualValues);
  const lastWeek = actualLabels[actualLabels.length - 1];
  const labelSet = new Set(actualLabels);
  const lastDate = new Date(lastWeek + "T00:00:00Z");

  if (revenueTarget?.cumulativePoints?.length) {
    for (const point of revenueTarget.cumulativePoints) {
      labelSet.add(point.week);
    }
  }

  if (projectEnd && projectEnd > today) {
    let cur = new Date(lastDate);
    cur.setUTCDate(cur.getUTCDate() + 7);
    while (cur.toISOString().slice(0, 10) <= projectEnd) {
      labelSet.add(cur.toISOString().slice(0, 10));
      cur.setUTCDate(cur.getUTCDate() + 7);
    }
    labelSet.add(projectEnd);
  } else {
    const d = new Date(lastDate);
    for (let i = 1; i <= 13; i++) {
      d.setUTCDate(d.getUTCDate() + 7);
      labelSet.add(d.toISOString().slice(0, 10));
    }
  }

  const projectLabels = [...labelSet].sort();
  const totalWeeks = projectLabels.length;
  const actualMap = new Map(points.map((point) => [point.week, point.cumulative]));

  const revenueTargetMap = new Map((revenueTarget?.cumulativePoints || []).map((point) => [point.week, point.cumulative]));
  let lastTargetValue = 0;
  const targetValues = revenueTarget?.cumulativePoints?.length
    ? projectLabels.map((label) => {
        if (revenueTargetMap.has(label)) {
          lastTargetValue = revenueTargetMap.get(label);
        }
        return Number(lastTargetValue.toFixed(2));
      })
    : (budget > 0 && projectEnd)
      ? projectLabels.map((_, i) => Number(((budget / Math.max(totalWeeks - 1, 1)) * i).toFixed(2)))
      : null;

  const forecastValues = projectLabels.map((_, i) => {
    if (!reg) return null;
    const y = reg.intercept + reg.slope * i;
    return Number(Math.max(0, y).toFixed(2));
  });

  const datasets = [
    {
      label: "Actual Revenue (cumulative)",
      data: projectLabels.map((label) => (actualMap.has(label) ? actualMap.get(label) : null)),
      borderColor: "#0d6a4f",
      backgroundColor: "rgba(13,106,79,0.08)",
      fill: true,
      tension: 0.3,
      pointRadius: 2,
      borderWidth: 2.5
    },
    {
      label: "Revenue Forecast (at current rate)",
      data: forecastValues,
      borderColor: "#f39c12",
      borderDash: [6, 3],
      fill: false,
      tension: 0,
      pointRadius: 0,
      borderWidth: 1.5
    }
  ];

  if (targetValues) {
    datasets.push({
      label: revenueTarget?.cumulativePoints?.length
        ? `Revenue Targets (${toCurrency(revenueTarget.total)})`
        : "Revenue Targets (budget ÷ project weeks)",
      data: targetValues,
      borderColor: "#27ae60",
      borderDash: [4, 4],
      fill: false,
      tension: 0,
      pointRadius: 0,
      borderWidth: 1.5
    });
  }

  if (budget > 0 && !revenueTarget?.total) {
    datasets.push({
      label: `Revenue Target Ceiling (${toCurrency(budget)})`,
      data: projectLabels.map(() => budget),
      borderColor: "#c0392b",
      borderDash: [3, 3],
      fill: false,
      pointRadius: 0,
      borderWidth: 1.5
    });
  }

  _trendChartInstance = new Chart(canvas, {
    type: "line",
    data: { labels: projectLabels, datasets },
    options: {
      responsive: true,
      interaction: { mode: "index", intersect: false },
      plugins: {
        legend: {
          position: "bottom",
          labels: { usePointStyle: true, pointStyleWidth: 20, padding: 16 }
        },
        tooltip: {
          callbacks: {
            label: (ctx) => {
              if (ctx.parsed.y == null) return null;
              return ` ${ctx.dataset.label}: ${toCurrency(ctx.parsed.y)}`;
            }
          }
        }
      },
      scales: {
        x: { ticks: { maxTicksLimit: 12, maxRotation: 45 } },
        y: {
          ticks: {
            callback: (v) => {
              if (v >= 1000000) return `$${(v/1000000).toFixed(1)}M`;
              if (v >= 1000) return `$${(v/1000).toFixed(0)}K`;
              return `$${v}`;
            }
          }
        }
      }
    }
  });
}

function updateTrendChartIfPossible() {
  if (!el.project.value) {
    return Promise.resolve();
  }
  return fetch(
    `/api/reports/trend?${new URLSearchParams({ project: normalizeProjectRef(el.project.value) })}`
  )
    .then((res) => res.json())
    .then((data) => {
      const projectTitle = (data.project?.title || el.project.value);
      renderTrendChart(el.trendChart, applySavedRevenueTarget(data, projectTitle));
    })
    .catch(() => {});
}

function parseEmployeeNames(raw) {
  return [...new Set(
    String(raw || "")
      .split(/[\n,;]/)
      .map((s) => s.trim())
      .filter(Boolean)
  )];
}

function renderRateLookup(rows, unmatched) {
  const tableRows = (rows || []).map((r) => ({
    requested_name: r.requested_name,
    matched_name: r.matched_name,
    user_id: r.user_id,
    latest_bill_rate: toCurrency(r.latest_bill_rate),
    average_bill_rate: toCurrency(r.average_bill_rate),
    min_bill_rate: toCurrency(r.min_bill_rate),
    max_bill_rate: toCurrency(r.max_bill_rate),
    samples: String(r.samples || 0),
    hours_total: Number(r.hours_total || 0).toFixed(2),
    latest_date: r.latest_date || ""
  }));

  renderTable(
    el.rateLookupOut,
    [
      "requested_name",
      "matched_name",
      "user_id",
      "latest_bill_rate",
      "average_bill_rate",
      "min_bill_rate",
      "max_bill_rate",
      "samples",
      "hours_total",
      "latest_date"
    ],
    tableRows
  );

  if ((unmatched || []).length > 0) {
    const unmatchedP = document.createElement("p");
    unmatchedP.className = "muted";
    unmatchedP.style.marginTop = "8px";
    unmatchedP.textContent = `No match found for: ${unmatched.join(", ")}`;
    el.rateLookupOut.appendChild(unmatchedP);
  }
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

el.project.addEventListener("change", () => {
  const projectTitle = String(el.project.value || "").split(" (")[0].trim();
  fillPlanFormFromSavedTarget(projectTitle);
});

el.savePlanBtn.addEventListener("click", async () => {
  const projectTitle = getCurrentPlanProjectTitle();
  if (!projectTitle) {
    el.planStatus.textContent = "Select a project first, then save the targets.";
    return;
  }

  const target = buildRevenueTargetFromMonths(buildTargetMonthsFromForm());
  if (!Object.keys(target.months || {}).length || target.total <= 0) {
    el.planStatus.textContent = "Please enter at least one positive amount.";
    return;
  }

  const store = readRevenueTargetStore();
  store[budgetPlanKey(projectTitle)] = { ...target, title: projectTitle };
  writeRevenueTargetStore(store);
  el.planProject.value = projectTitle;
  el.planStatus.textContent = `Saved revenue targets for ${projectTitle}: ${toCurrency(target.total)}.`;
  await updateTrendChartIfPossible();
});

el.clearPlanBtn.addEventListener("click", () => {
  const projectTitle = getCurrentPlanProjectTitle();
  if (!projectTitle) {
    el.planStatus.textContent = "Nothing to clear until a project is selected.";
    return;
  }

  const store = readRevenueTargetStore();
  delete store[budgetPlanKey(projectTitle)];
  writeRevenueTargetStore(store);
  fillPlanFormFromSavedTarget(projectTitle);
  el.planStatus.textContent = `Cleared saved revenue targets for ${projectTitle}.`;
  updateTrendChartIfPossible();
});

el.lookupRatesBtn.addEventListener("click", async () => {
  try {
    const project = normalizeProjectRef(el.project.value);
    if (!project) {
      el.rateLookupStatus.textContent = "Select a project first.";
      return;
    }

    const names = parseEmployeeNames(el.rateNames.value);
    if (names.length === 0) {
      el.rateLookupStatus.textContent = "Paste at least one employee name.";
      return;
    }

    el.rateLookupStatus.textContent = "Looking up rates...";
    const res = await fetch("/api/tools/billing-rates", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        project,
        start: el.start.value,
        end: el.end.value,
        names
      })
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) {
      throw new Error(body.error || `HTTP ${res.status}`);
    }

    renderRateLookup(body.rows || [], body.unmatched_names || []);
    el.rateLookupStatus.textContent = `Matched ${body.rows?.length || 0} of ${body.searched_names || names.length} names.`;
  } catch (err) {
    el.rateLookupStatus.textContent = `Lookup error: ${err.message}`;
  }
});

el.runBtn.addEventListener("click", async () => {
  try {
    const q = query();

    const projectResp = await fetchJson(`/api/projects/resolve?${q}`);
    fillPlanFormFromSavedTarget(projectResp.project?.title || String(el.project.value || "").split(" (")[0].trim());

    const projectRef = new URLSearchParams({ project: normalizeProjectRef(el.project.value) });
    const trend = await fetchJson(`/api/reports/trend?${projectRef}`);
    renderTrendChart(el.trendChart, applySavedRevenueTarget(trend, projectResp.project?.title || ""));

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
fillPlanFormFromSavedTarget("");

refreshHealth();
preloadProjects();
