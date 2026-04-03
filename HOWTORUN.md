# HOW TO RUN (Share With Colleagues)

This app is a local Node.js web app for Kantata project review.

## 1. What To Share

Share the full project folder (`kantata-sync`) with your colleagues using one of these:
- Git repo clone (recommended)
- Zip file of the folder

They need all files, including:
- `src/`
- `public/`
- `package.json`
- `.env.example`

Do not share your `.env` with secrets unless your internal policy allows it.

## 2. Prerequisites

Each colleague needs:
- Node.js 18+ (Node 20 LTS recommended)
- npm (included with Node)
- Kantata OAuth app credentials:
  - Client ID
  - Client Secret
  - Redirect URI

## 3. First-Time Setup

From the project folder:

```bash
npm install
```

Create `.env` from `.env.example` and fill real values:

```env
KANTATA_CLIENT_ID=your_client_id
KANTATA_CLIENT_SECRET=your_client_secret
KANTATA_REDIRECT_URI=http://localhost:3000/oauth/callback
PORT=3000
```

Compatibility aliases also work if your team already uses them:
- `APP_ID` or `AP_ID`
- `SECRET_TOKEN` or `SECRET+TOKEN`
- `CALLBACK_URL`

## 4. Start The App

Development mode:

```bash
npm run dev
```

or normal mode:

```bash
npm start
```

Open in browser:
- `http://localhost:3000`

## 5. Connect To Kantata (OAuth)

1. Click **Connect Kantata**.
2. Complete auth in the Kantata page.
3. You will be redirected back to the app.

The access token is stored locally in:
- `.kantata-token.json`

If you need to reset connection, click **Disconnect** in the app.

## 6. Daily Use

1. Enter/select **Project Name or ID**.
2. Select **Start Date** and **End Date**.
3. Click **Run Review**.

You will get:
- Invoice-Style Preview
- Timesheet Status Summary (normalized by user)
- Budget Check

## 7. Common Issues

`Missing config` on page:
- `.env` is missing or values are blank.

OAuth callback error:
- Ensure your Kantata app redirect URI exactly matches `.env` value, including port and path:
  - `http://localhost:3000/oauth/callback`

`Not connected` API error:
- Click **Connect Kantata** again.

Port already in use:
- Change `PORT` in `.env` (for example `PORT=3001`) and update redirect URI accordingly.

## 8. Optional: Run Behind A Different Port

If someone uses a different port, both must match:
- `.env` `PORT`
- `.env` `KANTATA_REDIRECT_URI`
- Kantata OAuth app redirect URI setting

Example:

```env
PORT=3001
KANTATA_REDIRECT_URI=http://localhost:3001/oauth/callback
```
