import { apiGet, apiGetAllPages, extractResults } from "./kantataClient.js";

function asNumber(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function centsToDollars(cents) {
  return asNumber(cents) / 100;
}

function dedupeRowsById(rows) {
  const map = new Map();
  for (const row of rows || []) {
    const id = String(row?.id || "");
    if (!id) continue;
    map.set(id, row);
  }
  return [...map.values()];
}

function isWithinDateRange(dateText, startDate, endDate) {
  const d = String(dateText || "");
  if (!d) return false;
  if (startDate && d < String(startDate)) return false;
  if (endDate && d > String(endDate)) return false;
  return true;
}

function getWeekStart(dateText) {
  const d = new Date(`${dateText}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return "";
  const day = d.getUTCDay();
  const diff = day === 0 ? -6 : 1 - day;
  d.setUTCDate(d.getUTCDate() + diff);
  return d.toISOString().slice(0, 10);
}

function getWeekStartFromDateTime(dateTimeText) {
  const d = new Date(dateTimeText || "");
  if (Number.isNaN(d.getTime())) return "";
  return getWeekStart(d.toISOString().slice(0, 10));
}

function addDays(dateText, days) {
  const d = new Date(`${dateText}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return "";
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function latestDate(a, b) {
  if (!a) return b || "";
  if (!b) return a || "";
  return new Date(a) > new Date(b) ? a : b;
}

export async function resolveProject(token, projectRef) {
  const trimmed = String(projectRef || "").trim();
  if (!trimmed) throw new Error("Project is required.");

  if (/^\d+$/.test(trimmed)) {
    const payload = await apiGet(token, `/workspaces/${trimmed}.json`);
    const rows = extractResults(payload);
    if (!rows[0]) throw new Error(`Project id ${trimmed} not found.`);
    return rows[0];
  }

  const matches = await apiGetAllPages(token, "/workspaces.json", {
    search: trimmed,
    order: "title:asc"
  });

  const exact = matches.find((w) => (w.title || "").toLowerCase() === trimmed.toLowerCase());
  if (exact) return exact;
  if (matches[0]) return matches[0];

  throw new Error(`No project found for name "${trimmed}".`);
}

export async function getTimesheetStatusReport(token, workspaceId, startDate, endDate) {
  const submissions = [];
  const usersById = {};
  let page = 1;
  const perPage = 200;

  // The submissions API filters by week start date, not by individual entry date.
  // Use start_date_after = day before Monday of startDate's week; _after is exclusive.
  const weekAfter = startDate ? addDays(getWeekStart(startDate) || startDate, -1) : undefined;

  while (true) {
    const payload = await apiGet(token, "/timesheet_submissions.json", {
      workspace_id: workspaceId,
      start_date_after: weekAfter,
      include: "user",
      order: "date:asc",
      page,
      per_page: perPage
    });

    const pageRows = extractResults(payload);

    // Client-side upper fence: only keep submissions whose week starts on or before endDate
    const filtered = endDate
      ? pageRows.filter((s) => {
          const sd = s.start_date || "";
          return !sd || sd <= endDate;
        })
      : pageRows;

    submissions.push(...filtered);
    Object.assign(usersById, payload.users || {});

    // If the API already returned nothing past endDate or we got a short page, stop
    if (pageRows.length < perPage) break;
    // If all items in this page are already past endDate, no need for more pages
    if (endDate && pageRows.every((s) => s.start_date && s.start_date > endDate)) break;
    page += 1;
    if (page > 100) break;
  }

  const fetchedEntries = await apiGetAllPages(token, "/time_entries.json", {
    workspace_id: workspaceId,
    date_performed_after: startDate ? addDays(startDate, -1) : undefined,
    date_performed_before: endDate ? addDays(endDate, 1) : undefined,
    optional_fields: "date_performed,time_in_minutes,user_id"
  });
  const entries = dedupeRowsById(fetchedEntries).filter((e) =>
    isWithinDateRange(e.date_performed, startDate, endDate)
  );

  const minutesByUserDate = new Map();
  for (const e of entries) {
    const userId = String(e.user_id || "");
    const datePerformed = String(e.date_performed || "");
    if (!userId || !datePerformed) continue;
    const key = `${userId}|${datePerformed}`;
    minutesByUserDate.set(key, (minutesByUserDate.get(key) || 0) + asNumber(e.time_in_minutes));
  }

  function sumMinutesForSubmissionWeek(userId, weekStartDate) {
    const start = String(weekStartDate || "");
    if (!userId || !start) return 0;
    let total = 0;
    for (let i = 0; i < 7; i += 1) {
      const day = addDays(start, i);
      if (!day) continue;
      total += minutesByUserDate.get(`${userId}|${day}`) || 0;
    }
    return total;
  }

  const rows = submissions.map((s) => ({
    submission_id: s.id,
    workspace_id: s.workspace_id,
    user_id: s.user_id,
    user_name: usersById[String(s.user_id)]?.full_name || "",
    status: s.state || s.status || "unknown",
    week_start_date:
      s.start_date ||
      getWeekStartFromDateTime(s.submitted_at || s.created_at || ""),
    total_minutes: asNumber(s.total_minutes || s.minutes || 0),
    approved_at: s.approved_at || "",
    submitted_at: s.created_at || s.submitted_at || ""
  }));

  const summaryMap = new Map();
  for (const row of rows) {
    const userId = String(row.user_id || "");
    const weekStart = row.week_start_date || "unknown";
    const key = `${userId}|${weekStart}`;
    const existing = summaryMap.get(key) || {
      workspace_id: row.workspace_id,
      user_id: userId,
      user_name: row.user_name || "",
      week_start_date: weekStart,
      latest_status: row.status,
      submission_events: 0,
      latest_submitted_at: "",
      latest_approved_at: "",
      minutes_logged: 0,
      hours_logged: 0
    };

    existing.submission_events += 1;
    if (!existing.user_name && row.user_name) existing.user_name = row.user_name;
    existing.latest_status = row.status || existing.latest_status;
    existing.latest_submitted_at = latestDate(existing.latest_submitted_at, row.submitted_at);
    existing.latest_approved_at = latestDate(existing.latest_approved_at, row.approved_at);

    const inferred = sumMinutesForSubmissionWeek(userId, weekStart);
    existing.minutes_logged = inferred;
    existing.hours_logged = Number((inferred / 60).toFixed(2));

    summaryMap.set(key, existing);
  }

  const summaryRows = [...summaryMap.values()].sort((a, b) => {
    if (a.week_start_date !== b.week_start_date) {
      return a.week_start_date.localeCompare(b.week_start_date);
    }
    return String(a.user_id).localeCompare(String(b.user_id));
  });

  const byStatus = rows.reduce((acc, row) => {
    acc[row.status] = (acc[row.status] || 0) + 1;
    return acc;
  }, {});

  const byLatestStatus = summaryRows.reduce((acc, row) => {
    acc[row.latest_status] = (acc[row.latest_status] || 0) + 1;
    return acc;
  }, {});

  const totalHoursLogged = summaryRows.reduce((sum, row) => sum + row.hours_logged, 0);

  return {
    rows,
    summaryRows,
    summary: {
      total_submissions: rows.length,
      total_user_weeks: summaryRows.length,
      by_status: byStatus,
      by_latest_status: byLatestStatus,
      total_hours_logged: Number(totalHoursLogged.toFixed(2)),
      note:
        "CSV is grouped by user/week with latest status and inferred logged hours. Unsubmitted requires participant/week inference and is not directly returned by submissions endpoint."
    }
  };
}

export async function getSpendReport(
  token,
  workspaceId,
  startDate,
  endDate,
  rateType = "bill",
  onlyApproved = false,
  completedWeeksOnly = false
) {
  const fetchedEntries = await apiGetAllPages(token, "/time_entries.json", {
    workspace_id: workspaceId,
    date_performed_after: startDate ? addDays(startDate, -1) : undefined,
    date_performed_before: endDate ? addDays(endDate, 1) : undefined,
    optional_fields:
      "rate_in_cents,bill_rate_in_cents,cost_rate_in_cents,total_billable_amount_in_cents,total_cost_in_cents,time_in_minutes,date_performed,user_id"
  });
  const entries = dedupeRowsById(fetchedEntries).filter((e) =>
    isWithinDateRange(e.date_performed, startDate, endDate)
  );

  // Fetch user names for all unique user IDs in the result set
  const uniqueUserIds = [...new Set(entries.map((e) => e.user_id).filter(Boolean))];
  const usersById = {};
  if (uniqueUserIds.length > 0) {
    const userPayload = await apiGet(token, "/users.json", { only: uniqueUserIds.join(",") });
    Object.assign(usersById, userPayload.users || {});
  }

  let detailRows = entries.map((e) => {
    const minutes = asNumber(e.time_in_minutes || e.minutes || 0);
    const hoursRaw = minutes / 60;

    const billRate = centsToDollars(e.bill_rate_in_cents || e.rate_in_cents);
    const costRate = centsToDollars(e.cost_rate_in_cents);
    let rate = rateType === "cost" ? costRate : billRate;

    let spend = hoursRaw * rate;
    if (!spend) {
      const cents =
        rateType === "cost"
          ? asNumber(e.total_cost_in_cents)
          : asNumber(e.total_billable_amount_in_cents);
      spend = centsToDollars(cents);
    }

    // If API returns amount but not explicit rate, infer effective rate for reconciliation.
    if (!rate && hoursRaw > 0 && spend > 0) {
      rate = spend / hoursRaw;
    }

    const userId = String(e.user_id || "");
    return {
      time_entry_id: e.id,
      date_performed: e.date_performed || "",
      week_start: getWeekStart(e.date_performed || ""),
      user_id: userId,
      user_name: usersById[userId]?.full_name || userId,
      minutes,
      hours: Number(hoursRaw.toFixed(2)),
      hours_raw: hoursRaw,
      rate: Number(rate.toFixed(2)),
      rate_raw: rate,
      spend: Number(spend.toFixed(2)),
      spend_raw: spend
    };
  });

  if (onlyApproved) {
    const weekAfter = startDate ? addDays(getWeekStart(startDate) || startDate, -1) : undefined;
    const submissions = await apiGetAllPages(token, "/timesheet_submissions.json", {
      workspace_id: workspaceId,
      start_date_after: weekAfter,
      optional_fields: "start_date,state,status,user_id,approved_at"
    });

    const approvedUserDates = new Set();
    for (const s of submissions) {
      const state = String(s.state || s.status || "").toLowerCase();
      const userId = String(s.user_id || "");
      const start = String(s.start_date || "");
      if (state !== "approved" || !userId || !start) continue;

      // Invoice cutoff: only include submission weeks approved on/before endDate.
      const approvedAt = String(s.approved_at || "");
      const approvedDate = approvedAt ? new Date(approvedAt).toISOString().slice(0, 10) : "";
      if (endDate && approvedDate && approvedDate > String(endDate)) continue;

      // Expand approved submission week to concrete dates to avoid week-boundary mismatches.
      for (let i = 0; i < 7; i += 1) {
        const day = addDays(start, i);
        if (!day) continue;
        if (!isWithinDateRange(day, startDate, endDate)) continue;
        approvedUserDates.add(`${userId}|${day}`);
      }
    }

    detailRows = detailRows.filter((r) =>
      approvedUserDates.has(`${r.user_id}|${String(r.date_performed || "")}`)
    );
  }

  // completedWeeksOnly is only meaningful without onlyApproved — when approved-only is active,
  // the submission approval filter already gates partial/in-progress weeks correctly.
  if (completedWeeksOnly && !onlyApproved && endDate) {
    const end = String(endDate);
    detailRows = detailRows.filter((r) => {
      const weekStart = String(r.week_start || "");
      if (!weekStart) return false;
      const weekEnd = addDays(weekStart, 6);
      return Boolean(weekEnd && weekEnd <= end);
    });
  }

  // Weekly totals grouped by person + week (matches invoice line-item detail)
  const weeklyMap = new Map();
  for (const row of detailRows) {
    const key = `${row.user_id}|${row.week_start}`;
    const existing = weeklyMap.get(key) || {
      user_id: row.user_id,
      user_name: row.user_name,
      week_start: row.week_start,
      rate: row.rate,
      rate_weighted_hours: 0,
      hours_raw: 0,
      spend_raw: 0
    };
    existing.hours_raw += row.hours_raw;
    existing.spend_raw += row.spend_raw;
    existing.rate_weighted_hours += row.rate_raw * row.hours_raw;
    weeklyMap.set(key, existing);
  }

  const weeklyTotals = [...weeklyMap.values()]
    .map((w) => ({
      user_id: w.user_id,
      user_name: w.user_name,
      week_start: w.week_start,
      rate:
        w.hours_raw > 0
          ? Number((w.rate_weighted_hours / w.hours_raw).toFixed(2))
          : Number(w.rate.toFixed(2)),
      hours: Number(w.hours_raw.toFixed(2)),
      spend: Number(w.spend_raw.toFixed(2))
    }))
    .sort((a, b) =>
      a.user_name.localeCompare(b.user_name) || a.week_start.localeCompare(b.week_start)
    );

  // Per-person totals — matches the invoice "Statement of Services" section
  const byPersonMap = new Map();
  for (const row of detailRows) {
    const uid = row.user_id;
    const existing = byPersonMap.get(uid) || {
      user_id: uid,
      user_name: row.user_name,
      rate: row.rate,
      rate_weighted_hours: 0,
      hours_raw: 0,
      spend_raw: 0
    };
    existing.hours_raw += row.hours_raw;
    existing.spend_raw += row.spend_raw;
    existing.rate_weighted_hours += row.rate_raw * row.hours_raw;
    byPersonMap.set(uid, existing);
  }
  const byPerson = [...byPersonMap.values()]
    .map((p) => ({
      user_id: p.user_id,
      user_name: p.user_name,
      rate:
        p.hours_raw > 0
          ? Number((p.rate_weighted_hours / p.hours_raw).toFixed(2))
          : Number(p.rate.toFixed(2)),
      hours: Number(p.hours_raw.toFixed(2)),
      spend: Number(p.spend_raw.toFixed(2))
    }))
    .sort((a, b) => a.user_name.localeCompare(b.user_name));

  const totalSpend = byPerson.reduce((sum, p) => sum + p.spend, 0);

  return {
    detailRows,
    weeklyTotals,
    byPerson,
    summary: {
      total_entries: detailRows.length,
      total_spend: Number(totalSpend.toFixed(2)),
      rate_type: rateType
    }
  };
}

export async function getSpendTrend(token, workspaceId, projectTitle = "") {
  // Fetch project metadata for start date and budget
  const wsMeta = await apiGet(token, `/workspaces/${workspaceId}.json`, {
    optional_fields:
      "start_date,due_date,created_at,budget,budget_in_cents,fee,budgeted_amount,price_in_cents,projected_billable_amount_in_cents"
  });
  const ws = extractResults(wsMeta)[0] || {};

  const projectStart =
    ws.start_date ||
    (ws.created_at ? ws.created_at.slice(0, 10) : null) ||
    null;

  const projectEnd = ws.due_date || null;

  const budgetCandidates = [
    centsToDollars(ws.price_in_cents),
    centsToDollars(ws.budget_in_cents),
    asNumber(ws.budget),
    asNumber(ws.fee),
    asNumber(ws.budgeted_amount),
    centsToDollars(ws.projected_billable_amount_in_cents)
  ].filter((n) => n > 0);

  const budget = budgetCandidates[0] || 0;

  // Fetch all approved time entries (project lifetime, no date filter)
  const payload = await apiGetAllPages(token, `/time_entries.json`, {
    workspace_id: workspaceId,
    status: "approved",
    optional_fields:
      "rate_in_cents,bill_rate_in_cents,total_billable_amount_in_cents,time_in_minutes,date_performed,user_id"
  });

  const allRows = dedupeRowsById(payload);

  // Group by week start (ISO Monday) and sum revenue (rate × hours)
  const weeklySpend = new Map();

  for (const row of allRows) {
    const date = (row.date_performed || "").slice(0, 10);
    if (!date) continue;

    const d = new Date(date + "T00:00:00Z");
    const dayOfWeek = (d.getUTCDay() + 6) % 7;
    const weekStart = new Date(d);
    weekStart.setUTCDate(weekStart.getUTCDate() - dayOfWeek);
    const weekKey = weekStart.toISOString().slice(0, 10);

    const minutes = asNumber(row.time_in_minutes || row.minutes || 0);
    const hours = minutes / 60;
    const rate = centsToDollars(row.bill_rate_in_cents || row.rate_in_cents);
    let revenue = hours * rate;
    if (!revenue) {
      revenue = centsToDollars(asNumber(row.total_billable_amount_in_cents));
    }

    weeklySpend.set(weekKey, (weeklySpend.get(weekKey) || 0) + revenue);
  }

  const sortedWeeks = [...weeklySpend.keys()].sort();
  let cumulative = 0;
  const points = sortedWeeks.map((week) => {
    cumulative += weeklySpend.get(week);
    return { week, cumulative: Number(cumulative.toFixed(2)) };
  });

  return {
    points,
    budget: Number(budget.toFixed(2)),
    projectStart: projectStart || (sortedWeeks[0] || null),
    projectEnd,
    revenueTarget: null
  };
}

function normalizeName(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export async function getBillingRatesByEmployeeNames(
  token,
  workspaceId,
  names,
  startDate,
  endDate
) {
  const requestedNames = [...new Set((names || []).map((n) => String(n || "").trim()).filter(Boolean))];
  if (requestedNames.length === 0) {
    return {
      project_id: workspaceId,
      rows: [],
      unmatched_names: [],
      searched_names: 0
    };
  }

  const fetchedEntries = await apiGetAllPages(token, "/time_entries.json", {
    workspace_id: workspaceId,
    date_performed_after: startDate,
    date_performed_before: endDate,
    optional_fields:
      "rate_in_cents,bill_rate_in_cents,total_billable_amount_in_cents,time_in_minutes,date_performed,user_id"
  });

  const entries = dedupeRowsById(fetchedEntries).filter((e) =>
    isWithinDateRange(e.date_performed, startDate, endDate)
  );

  const uniqueUserIds = [...new Set(entries.map((e) => e.user_id).filter(Boolean))];
  const usersById = {};
  if (uniqueUserIds.length > 0) {
    const userPayload = await apiGet(token, "/users.json", { only: uniqueUserIds.join(",") });
    Object.assign(usersById, userPayload.users || {});
  }

  const perUser = new Map();
  for (const e of entries) {
    const userId = String(e.user_id || "");
    if (!userId) continue;

    const minutes = asNumber(e.time_in_minutes || e.minutes || 0);
    const hours = minutes / 60;
    if (hours <= 0) continue;

    let rate = centsToDollars(e.bill_rate_in_cents || e.rate_in_cents);
    if (!rate) {
      const spend = centsToDollars(asNumber(e.total_billable_amount_in_cents));
      if (spend > 0) rate = spend / hours;
    }
    if (!rate || rate <= 0) continue;

    const existing = perUser.get(userId) || {
      user_id: userId,
      user_name: usersById[userId]?.full_name || userId,
      samples: 0,
      hours_total: 0,
      weighted_rate_sum: 0,
      latest_bill_rate: 0,
      latest_date: "",
      min_bill_rate: Number.POSITIVE_INFINITY,
      max_bill_rate: 0
    };

    existing.samples += 1;
    existing.hours_total += hours;
    existing.weighted_rate_sum += rate * hours;
    if (!existing.latest_date || String(e.date_performed || "") > existing.latest_date) {
      existing.latest_date = String(e.date_performed || "");
      existing.latest_bill_rate = rate;
    }
    existing.min_bill_rate = Math.min(existing.min_bill_rate, rate);
    existing.max_bill_rate = Math.max(existing.max_bill_rate, rate);
    perUser.set(userId, existing);
  }

  const users = [...perUser.values()].map((u) => ({
    ...u,
    average_bill_rate:
      u.hours_total > 0 ? Number((u.weighted_rate_sum / u.hours_total).toFixed(2)) : 0,
    latest_bill_rate: Number((u.latest_bill_rate || 0).toFixed(2)),
    min_bill_rate: Number((u.min_bill_rate === Number.POSITIVE_INFINITY ? 0 : u.min_bill_rate).toFixed(2)),
    max_bill_rate: Number((u.max_bill_rate || 0).toFixed(2)),
    hours_total: Number(u.hours_total.toFixed(2))
  }));

  const usersWithNorm = users.map((u) => ({ ...u, _norm: normalizeName(u.user_name) }));

  const rows = [];
  const unmatched = [];

  for (const requestedName of requestedNames) {
    const requestedNorm = normalizeName(requestedName);
    if (!requestedNorm) continue;

    let candidates = usersWithNorm.filter((u) => u._norm === requestedNorm);
    if (candidates.length === 0) {
      candidates = usersWithNorm.filter(
        (u) => u._norm.includes(requestedNorm) || requestedNorm.includes(u._norm)
      );
    }

    if (candidates.length === 0) {
      unmatched.push(requestedName);
      continue;
    }

    candidates.sort((a, b) => b.samples - a.samples || b.hours_total - a.hours_total);
    const best = candidates[0];

    rows.push({
      requested_name: requestedName,
      matched_name: best.user_name,
      user_id: best.user_id,
      latest_bill_rate: best.latest_bill_rate,
      average_bill_rate: best.average_bill_rate,
      min_bill_rate: best.min_bill_rate,
      max_bill_rate: best.max_bill_rate,
      samples: best.samples,
      hours_total: best.hours_total,
      latest_date: best.latest_date || ""
    });
  }

  return {
    project_id: workspaceId,
    rows,
    unmatched_names: unmatched,
    searched_names: requestedNames.length
  };
}

export async function getTeamMemberBillingEntries(token, workspaceId, startDate, endDate) {
  const fetchedEntries = await apiGetAllPages(token, "/time_entries.json", {
    workspace_id: workspaceId,
    date_performed_after: startDate,
    date_performed_before: endDate,
    optional_fields:
      "time_in_minutes,date_performed,user_id,bill_rate_in_cents,rate_in_cents,total_billable_amount_in_cents"
  });

  const entries = dedupeRowsById(fetchedEntries).filter((e) =>
    isWithinDateRange(e.date_performed, startDate, endDate)
  );

  const uniqueUserIds = [...new Set(entries.map((e) => e.user_id).filter(Boolean))];
  const usersById = {};
  if (uniqueUserIds.length > 0) {
    const userPayload = await apiGet(token, "/users.json", { only: uniqueUserIds.join(",") });
    Object.assign(usersById, userPayload.users || {});
  }

  const weekAfter = startDate ? addDays(getWeekStart(startDate) || startDate, -1) : undefined;
  const submissions = await apiGetAllPages(token, "/timesheet_submissions.json", {
    workspace_id: workspaceId,
    start_date_after: weekAfter,
    optional_fields: "start_date,state,status,user_id,approved_at"
  });

  const approvedUserDates = new Set();
  for (const s of submissions) {
    const state = String(s.state || s.status || "").toLowerCase();
    const userId = String(s.user_id || "");
    const start = String(s.start_date || "");
    if (state !== "approved" || !userId || !start) continue;

    const approvedAt = String(s.approved_at || "");
    const approvedDate = approvedAt ? new Date(approvedAt).toISOString().slice(0, 10) : "";
    if (endDate && approvedDate && approvedDate > String(endDate)) continue;

    for (let i = 0; i < 7; i += 1) {
      const day = addDays(start, i);
      if (!day) continue;
      if (!isWithinDateRange(day, startDate, endDate)) continue;
      approvedUserDates.add(`${userId}|${day}`);
    }
  }

  const rows = entries
    .map((e) => {
      const userId = String(e.user_id || "");
      const date = String(e.date_performed || "");
      const minutes = asNumber(e.time_in_minutes || 0);
      const hours = minutes / 60;
      const billRate = centsToDollars(e.bill_rate_in_cents || e.rate_in_cents);
      let amount = hours * billRate;
      if (!amount) {
        amount = centsToDollars(asNumber(e.total_billable_amount_in_cents));
      }

      return {
        user_name: usersById[userId]?.full_name || userId,
        user_id: userId,
        date_performed: date,
        hours: Number(hours.toFixed(2)),
        amount: Number(amount.toFixed(2)),
        approval_status: approvedUserDates.has(`${userId}|${date}`) ? "approved" : "not_approved_yet"
      };
    })
    .sort((a, b) => a.date_performed.localeCompare(b.date_performed) || a.user_name.localeCompare(b.user_name));

  const byMemberMap = new Map();
  for (const row of rows) {
    const key = row.user_id;
    const existing = byMemberMap.get(key) || {
      user_name: row.user_name,
      user_id: row.user_id,
      total_hours: 0,
      total_amount: 0,
      approved_hours: 0,
      not_approved_hours: 0
    };

    existing.total_hours += row.hours;
    existing.total_amount += row.amount;
    if (row.approval_status === "approved") {
      existing.approved_hours += row.hours;
    } else {
      existing.not_approved_hours += row.hours;
    }
    byMemberMap.set(key, existing);
  }

  const byMember = [...byMemberMap.values()]
    .map((m) => ({
      ...m,
      total_hours: Number(m.total_hours.toFixed(2)),
      total_amount: Number(m.total_amount.toFixed(2)),
      approved_hours: Number(m.approved_hours.toFixed(2)),
      not_approved_hours: Number(m.not_approved_hours.toFixed(2))
    }))
    .sort((a, b) => a.user_name.localeCompare(b.user_name));

  return {
    rows,
    by_member: byMember,
    summary: {
      total_entries: rows.length,
      total_team_members: byMember.length,
      total_hours: Number(rows.reduce((sum, r) => sum + r.hours, 0).toFixed(2)),
      total_amount: Number(rows.reduce((sum, r) => sum + r.amount, 0).toFixed(2))
    }
  };
}

export async function getBudgetCheck(token, workspaceId, spendSummary, budgetOverride) {
  const payload = await apiGet(token, `/workspaces/${workspaceId}.json`, {
    optional_fields:
      "budget,budget_in_cents,fee,budgeted_amount,projected_billable_amount_in_cents,price_in_cents,budget_used_in_cents,budget_remaining,percent_of_budget_used,over_budget"
  });
  const rows = extractResults(payload);
  const workspace = rows[0] || {};

  const candidates = [
    asNumber(budgetOverride),
    centsToDollars(workspace.price_in_cents),
    centsToDollars(workspace.budget_in_cents),
    asNumber(workspace.budget),
    asNumber(workspace.fee),
    asNumber(workspace.budgeted_amount),
    centsToDollars(workspace.projected_billable_amount_in_cents)
  ].filter((n) => n > 0);

  const budget = candidates[0] || 0;
  const selectedRangeSpend = asNumber(spendSummary?.total_spend);
  const projectActualSpend = centsToDollars(workspace.budget_used_in_cents);
  const spendForCompare = projectActualSpend > 0 ? projectActualSpend : selectedRangeSpend;
  const remaining = budget - spendForCompare;

  return {
    project_id: workspace.id || workspaceId,
    project_title: workspace.title || "",
    budget: Number(budget.toFixed(2)),
    spend: Number(spendForCompare.toFixed(2)),
    selected_range_spend: Number(selectedRangeSpend.toFixed(2)),
    remaining: Number(remaining.toFixed(2)),
    exceeded: budget > 0 ? spendForCompare > budget : null,
    percent_of_budget_used:
      asNumber(workspace.percent_of_budget_used) > 0
        ? asNumber(workspace.percent_of_budget_used)
        : budget > 0
          ? Number(((spendForCompare / budget) * 100).toFixed(1))
          : null,
    over_budget_flag: workspace.over_budget ?? null,
    note:
      budget > 0
        ? "Budget comparison complete. Project-level actuals are used when available."
        : "No explicit project budget field was found. Supply a budget override in the UI."
  };
}

