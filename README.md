# Kantata Sync Starter

Local Node.js app for Mavenlink/Kantata project review.

## Current Features
- Invoice-style preview from approved timesheet data in a selected date range.
- Timesheet status view normalized by user for the selected period.
- Budget check using project budget fields (with fallback support).
- Project lookup by name or ID.

## Tech Stack
- Node.js + Express (ES modules)
- Vanilla HTML/CSS/JS frontend
- OAuth to Kantata/Mavenlink API

## Project Structure
- `src/server.js`: Express routes, OAuth flow, API handlers
- `src/reports.js`: Timesheet, spend, and budget report logic
- `src/kantataClient.js`: API helpers and pagination
- `public/`: Browser UI
- `.env.example`: Environment variable template
- `HOWTORUN.md`: Share/run guide for colleagues

## Quick Start
1. Install dependencies:
   - `npm install`
2. Create `.env` using `.env.example` and set credentials.
3. Start app:
   - `npm run dev`
4. Open:
   - `http://localhost:3000`

For team handoff and detailed setup instructions, see `HOWTORUN.md`.

## Environment Variables
Preferred keys:
- `KANTATA_CLIENT_ID`
- `KANTATA_CLIENT_SECRET`
- `KANTATA_REDIRECT_URI` (typically `http://localhost:3000/oauth/callback`)
- `PORT` (default `3000`)

Compatibility aliases are also supported:
- `APP_ID` or `AP_ID`
- `SECRET_TOKEN` or `SECRET+TOKEN`
- `CALLBACK_URL`

## OAuth Flow
1. Open the app.
2. Click **Connect Kantata**.
3. Approve access in Kantata.
4. App redirects back and stores token in `.kantata-token.json`.

## Active API Endpoints
- `GET /api/health`
- `GET /auth/start`
- `GET /oauth/callback`
- `POST /api/disconnect`
- `GET /api/projects`
- `GET /api/projects/version`
- `GET /api/projects/resolve?project=<name_or_id>`
- `GET /api/reports/timesheets?project=<...>&start=YYYY-MM-DD&end=YYYY-MM-DD`
- `GET /api/reports/spend?project=<...>&start=YYYY-MM-DD&end=YYYY-MM-DD&rateType=bill|cost&approvedOnly=1&completedWeeksOnly=1`
- `GET /api/reports/budget?project=<...>&start=YYYY-MM-DD&end=YYYY-MM-DD&rateType=bill|cost&budget=<optional_number>`

## Notes
- If API returns `429`, retry after a short delay.
- Budget field availability varies by workspace configuration.
- Redirect URI in Kantata OAuth app settings must exactly match your `.env` value.
