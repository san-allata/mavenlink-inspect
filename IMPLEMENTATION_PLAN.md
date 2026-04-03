# Kantata (Mavenlink) Implementation Plan

## Goal
Build a lightweight reporting tool that can target any project by name or ID and provide:
1. Timesheet submission status visibility with CSV export.
2. Spend review (hours x rate) with weekly totals.
3. Budget-overrun warning for the selected date range.

## Confirmed API Areas
- Auth: OAuth2 authorization code flow.
- Project lookup: Workspaces endpoints.
- Timesheets: Timesheet Submissions endpoints.
- Time/spend: Time Entries endpoints plus rate fields.
- Budget comparison: Workspace financial fields and optional override.

## Architecture
- Backend: Node + Express API proxy.
- Frontend: Static HTML/CSS/JS.
- Auth token: Local file storage for developer workflow.

## Phase 1 (Implemented)
- OAuth connect flow (`/auth/start`, `/oauth/callback`).
- Resolve project by ID or by name search.
- Timesheet status report endpoint and CSV endpoint.
- Spend report endpoint with weekly rollups.
- Budget check endpoint with project budget discovery and override support.
- Simple UI with connect/run/download actions.

## Phase 2 (Next)
- Improve status coverage for "unsubmitted" users by cross-checking active project participants and missing weekly submissions.
- Add user names in reports using included user objects.
- Add CSV export for spend detail and weekly totals.
- Add filtering by explicit week boundary and timezone handling.

## Phase 3 (Hardening)
- Add token refresh/rotation behavior and encrypted token storage.
- Add retry/backoff for HTTP 429 rate limits.
- Add tests for report calculation logic.
- Add structured logs and API error diagnostics.

## Phase 4 (Extensions You Mentioned)
- Add expense report submissions and non-labor spend.
- Add invoice status and revenue tracking.
- Add scheduled report generation and email delivery.
- Add multi-project portfolio rollups.

## Key Risks / Notes
- Different Kantata accounts can expose different optional fields depending on features and permissions.
- "Unsubmitted" requires inference; API submissions represent submitted records.
- Rate source can vary (bill vs cost, or precomputed totals).
- Budget field naming can vary by account configuration.

## Definition of Done for This Starter
- User can connect OAuth once and run report by project name or ID.
- User can see timesheet status summary, spend weekly totals, and budget exceeded flag.
- User can download timesheet status CSV.
