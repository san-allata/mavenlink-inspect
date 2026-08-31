function normalizeTitle(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");
}

function getWeekStart(dateText) {
  const d = new Date(`${dateText}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return "";
  const day = d.getUTCDay();
  const diff = day === 0 ? -6 : 1 - day;
  d.setUTCDate(d.getUTCDate() + diff);
  return d.toISOString().slice(0, 10);
}

function firstFourWeekStartsInMonth(monthKey) {
  const [yearText, monthText] = String(monthKey).split("-");
  const year = Number(yearText);
  const monthIndex = Number(monthText) - 1;
  if (!Number.isInteger(year) || !Number.isInteger(monthIndex) || monthIndex < 0 || monthIndex > 11) {
    return [];
  }

  const starts = [];
  const cursor = new Date(Date.UTC(year, monthIndex, 1));
  while (cursor.getUTCMonth() === monthIndex) {
    if (cursor.getUTCDay() === 1) {
      starts.push(cursor.toISOString().slice(0, 10));
    }
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }

  return starts.slice(0, 4);
}

const PROJECT_MONTHLY_BUDGETS = {
  [normalizeTitle("Associa - Accelerator")]: {
    title: "Associa - Accelerator",
    months: { "2026-04": 100000.0, "2026-05": 0, "2026-06": 0 }
  },
  [normalizeTitle("Associa - Accelerator Professional Services")]: {
    title: "Associa - Accelerator Professional Services",
    months: { "2026-04": 43636.36, "2026-05": 136363.64, "2026-06": 0 }
  },
  [normalizeTitle("Associa - Castle Group Implementation Discovery")]: {
    title: "Associa - Castle Group Implementation Discovery",
    months: { "2026-04": 0, "2026-05": 0, "2026-06": 0 }
  },
  [normalizeTitle("Associa - IIK Assessment")]: {
    title: "Associa - IIK Assessment",
    months: { "2026-04": 0, "2026-05": 0, "2026-06": 0 }
  },
  [normalizeTitle("Associa - ODI 2026")]: {
    title: "Associa - ODI 2026",
    months: { "2026-04": 97835.2, "2026-05": 89931.68, "2026-06": 99045.92 }
  },
  [normalizeTitle("Associa - Sentry Data Platform & ETL")]: {
    title: "Associa - Sentry Data Platform & ETL",
    months: { "2026-04": 0, "2026-05": 0, "2026-06": 0 }
  },
  [normalizeTitle("Associa - Sentry Data Validation and Load")]: {
    title: "Associa - Sentry Data Validation and Load",
    months: { "2026-04": 59690.4, "2026-05": 54264.0, "2026-06": 0 }
  },
  [normalizeTitle("Associa - Sentry Program Governance and OCM")]: {
    title: "Associa - Sentry Program Governance and OCM",
    months: { "2026-04": 137105.67, "2026-05": 126435.6, "2026-06": 139079.16 }
  },
  [normalizeTitle("Associa - Technical Architecture Leadership")]: {
    title: "Associa - Technical Architecture Leadership",
    months: { "2026-04": 40128.0, "2026-05": 36480.0, "2026-06": 40128.0 }
  },
  [normalizeTitle("Associa - Transformation (ATG 1)")]: {
    title: "Associa - Transformation (ATG 1)",
    months: { "2026-04": 13376.0, "2026-05": 12707.2, "2026-06": 14044.8 }
  },
  [normalizeTitle("Associa - Transformation (ATG 2)")]: {
    title: "Associa - Transformation (ATG 2)",
    months: { "2026-04": 95602.06, "2026-05": 89996.25, "2026-06": 98039.08 }
  },
  [normalizeTitle("Associa - Transformation (Data Ingestion)")]: {
    title: "Associa - Transformation (Data Ingestion)",
    months: { "2026-04": 73051.2, "2026-05": 67488.0, "2026-06": 74236.8 }
  },
  [normalizeTitle("Associa - Transformation (Flex)")]: {
    title: "Associa - Transformation (Flex)",
    months: { "2026-04": 62852.0, "2026-05": 57965.2, "2026-06": 99894.4 }
  },
  [normalizeTitle("Associa - Transformation Product Readiness")]: {
    title: "Associa - Transformation Product Readiness",
    months: { "2026-04": 33978.56, "2026-05": 30889.6, "2026-06": 33978.56 }
  },
  [normalizeTitle("Associa - Transformation Program Leadership and Advisory")]: {
    title: "Associa - Transformation Program Leadership and Advisory",
    months: { "2026-04": 45534.6, "2026-05": 42939.3, "2026-06": 42525.0 }
  }
};

export function getProjectBudgetPlan(projectTitle) {
  const plan = PROJECT_MONTHLY_BUDGETS[normalizeTitle(projectTitle)];
  if (!plan) return null;

  const weeklyMap = new Map();
  let total = 0;

  for (const [monthKey, amount] of Object.entries(plan.months)) {
    const monthlyAmount = Number(amount || 0);
    total += monthlyAmount;
    if (monthlyAmount <= 0) continue;

    const weekStarts = firstFourWeekStartsInMonth(monthKey);
    if (weekStarts.length === 0) continue;

    const installment = monthlyAmount / 4;
    for (const weekStart of weekStarts) {
      weeklyMap.set(weekStart, (weeklyMap.get(weekStart) || 0) + installment);
    }
  }

  const weeklyPoints = [...weeklyMap.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([week, amount]) => ({
      week,
      amount: Number(amount.toFixed(2))
    }));

  let cumulative = 0;
  const cumulativePoints = weeklyPoints.map((point) => {
    cumulative += point.amount;
    return {
      week: point.week,
      cumulative: Number(cumulative.toFixed(2))
    };
  });

  const planStart = cumulativePoints[0]?.week || null;
  const planEnd = cumulativePoints[cumulativePoints.length - 1]?.week || null;

  return {
    source: "custom-quarterly-budget-plan",
    title: plan.title,
    months: plan.months,
    total: Number(total.toFixed(2)),
    weeklyPoints,
    cumulativePoints,
    planStart,
    planEnd,
    weekAllocationRule: "Each month is split evenly across the first four weekly buckets in that month."
  };
}
