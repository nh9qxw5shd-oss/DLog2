# EMCC Daily Report Generator

**Network Rail · East Midlands Control Centre**  
Automated daily operations report: CCIL `.docx` export → structured PDF. Parsing and PDF generation run entirely in the browser; the only server code is a single route handler that pulls the route's Emergency Speed Restrictions from NRSDB at build time (optional).

---

## How It Works

1. **Upload** — Drop in a CCIL `.docx` export
2. **Parse** — mammoth.js reads the DOCX; regex parser extracts and classifies every incident locally
3. **Roster** — Enter daily shift staffing manually
4. **Review** — Add, edit, remove, or re-flag incidents
5. **Generate** — jsPDF builds the report in-browser → download PDF. When NRSDB
   credentials are configured, this step also pulls the route's imposed ESRs
   (see below) before the PDF is built.

CCIL data never leaves the browser. Incident data and ESR snapshots are written
to Supabase only when those integrations are configured.

---

## PDF Output

- Cover page (NR branding, OFFICIAL-SENSITIVE classification)
- Shift roster grid (day / night)
- 5 Day Look Ahead
- Emergency Speed Restrictions — every imposed ESR for the route, NEW and AMENDED rows highlighted, plus a table of restrictions REMOVED since the previous snapshot (optional, needs NRSDB credentials)
- Headline performance metrics
- Significant incidents summary
- Categorised incident tables: SPADs, TPWS, Bridge Strikes, Near Misses, Irregular Working, Level Crossings, Fires, Crime, HABD/WILD, Passenger Injuries, Infrastructure, Traction
- Disruption impact ranked table
- Full CCIL log appendix (verbatim)

---

## Stack

| Layer | Technology |
|-------|-----------|
| Framework | Next.js 14 (App Router) |
| Hosting | Vercel (free tier) |
| DOCX reading | mammoth.js (browser) |
| CCIL parsing | Custom regex parser |
| PDF generation | jsPDF + jspdf-autotable (browser) |
| Styling | Tailwind CSS |

**One route handler** (`app/api/esr/snapshot`) for the NRSDB ESR scrape — everything else is client-side. All integrations (Supabase, rosterhub, NRSDB) are optional.

---

## Deployment — 4 steps

### 1. Push to GitHub

```bash
git init
git add .
git commit -m "Initial commit"
git remote add origin https://github.com/YOUR_ORG/emcc-daily-log.git
git push -u origin main
```

### 2. Import to Vercel

Go to https://vercel.com/new → Import the repo → Framework auto-detects as Next.js.

### 3. Deploy

Click Deploy. No environment variables needed. Done.

### 4. (Optional) Custom domain

Vercel project → Settings → Domains.

---

## Deployment — Netlify (alternative)

This app runs equally well on Netlify. It is a fully client-side Next.js 14
app — no API routes, no server actions, no SSR — so Netlify's built-in Next.js
runtime handles it with no extra work. A `netlify.toml` is included.

1. **Import** — https://app.netlify.com → Add new site → Import the repo.
   Netlify auto-detects Next.js; build command `npm run build`.
2. **Environment variables** — Site config → Environment variables. All are
   **optional**; set only the features you want. Because they are all
   `NEXT_PUBLIC_*`, they are inlined at **build time** — set them *before* the
   build and **trigger a rebuild** after any change:

   | Variable | Enables |
   |----------|---------|
   | `NEXT_PUBLIC_SUPABASE_URL` | Incident DB save + historical trend charts |
   | `NEXT_PUBLIC_SUPABASE_ANON_KEY` | (same — public anon key, secure with RLS) |
   | `NEXT_PUBLIC_ROSTERHUB_SUPABASE_URL` | "Import roster" button |
   | `NEXT_PUBLIC_ROSTERHUB_SUPABASE_ANON_KEY` | (same) |
   | `NEXT_PUBLIC_ROSTERHUB_LINKS` | Roster groups (optional, default `CTRL,SNDM`) |
   | `NRSDB_EMAIL` / `NRSDB_PASSWORD` | ESR section in the PDF (server-only, read at request time — not inlined) |
   | `SUPABASE_SERVICE_ROLE_KEY` | ESR snapshot writes (server-only; falls back to the anon key) |

   With none set, the full upload → parse → roster → PDF flow still works.
3. **Deploy** — Click Deploy.

> `vercel.json` is Vercel-specific and ignored by Netlify.

---

## Local Development

```bash
git clone https://github.com/YOUR_ORG/emcc-daily-log.git
cd emcc-daily-log
npm install
npm run dev
# Open http://localhost:3000
```

No `.env` file needed.

---

## Security Notes

- CCIL parsing and PDF generation are fully client-side — CCIL data never leaves the user's browser
- The only server code is the ESR route handler; NRSDB credentials live in server-only env vars and are never sent to the browser
- Add Vercel Password Protection (Pro plan) for access control
- Mark your Vercel deployment as OFFICIAL-SENSITIVE and restrict access

---

## Customising the Roster Defaults

Edit `lib/types.ts` → `DEFAULT_ROSTER`.

### Auto-import roster from rosterhub (optional)

If you run the sibling rosterhub project, DLog2 can fetch the published roster
for the Log Date and pre-fill day / night shifts. The Roster Entry step grows
an "Import roster" button when these env vars are set on the Vercel project:

```
NEXT_PUBLIC_ROSTERHUB_SUPABASE_URL   = https://<rosterhub-project>.supabase.co
NEXT_PUBLIC_ROSTERHUB_SUPABASE_ANON_KEY = <rosterhub anon key>
NEXT_PUBLIC_ROSTERHUB_LINKS          = CTRL,SNDM   # optional, default CTRL,SNDM
```

rosterhub's `roster_weeks` and `staff_directory` tables must allow anonymous
SELECT (a public RLS policy) for the import + name typeahead to work.

Shift cells that contain times (`07:00-19:00`, `0700-1900`, etc.) are mapped
into DLog2 slots; cells like `AL`, `OFF`, `SPARE` are skipped. A shift whose
start hour is between 06:00 and 17:59 lands on the day shift, otherwise the
night shift. Manual entry remains available — the import only pre-fills.

## Test Mode

The **Test Mode** switch in the header (next to Settings) lets you run the whole
process — upload a CCIL export, roster, weather, review — exactly as for a real
log, and build the PDF, without writing anything to the database. Use it to
trial new features or rehearse without risking duplicate reports or corrupted
analytics.

While it is on:

- Generate skips the report / incidents / team-member / weather-statement save.
- The NRSDB ESR pull still runs (so the section renders) but the route is told
  `dryRun` and stores no snapshot; the stored baseline is untouched.
- Read-only steps still run so the PDF is representative: continuation
  lookup, historical charts, ESR baseline diff.
- The PDF carries a TEST banner on every page, a diagonal TEST watermark, and
  is saved as `EMCC_Daily_Report_<date>_TEST.pdf`.
- The historical bulk import page is disabled.

The setting is per browser (localStorage), survives reloads, and is shown as an
amber banner under the header while active.

## Emergency Speed Restrictions (NRSDB snapshot)

At the Generate step DLog2 calls `POST /api/esr/snapshot`, a Next.js route
handler that runs server-side (Vercel function / Netlify function). It:

1. Logs in to `nrsdb.uk` with the configured account (session-cookie auth —
   the same thing the site's export button does, automated) and calls
   `getEsrsByRouteCode` for `NRSDB_ROUTECODE` (default `EM`) with
   `filter=imposed`. Re-authenticates once if the session has expired.
2. Flattens each ESR and parses its reference into a stable `base_ref`
   (`EM 061C.26` → `EM 061.26`, revision `C`). Amendments keep the base number
   and step the letter, so the base ref is what is tracked day to day.
3. Upserts today's list into `esr_snapshots` keyed on
   `(snapshot_date, route_code, base_ref)` — Europe/London calendar date —
   and writes a summary row plus the full diff JSON to `esr_snapshot_runs`.
   Re-running the build the same day overwrites that day's snapshot.
4. Diffs against the most recent **prior** snapshot date:
   - **NEW** — base ref not in the prior snapshot
   - **AMENDED** — present in both, but the revision letter advanced or the
     speed, line speed, location, reason or ETR changed
   - **REMOVED** — in the prior snapshot, not imposed today
5. Returns the classified list; the PDF renders it on its own page after the
   5 Day Look Ahead, with NEW rows tinted green, AMENDED rows tinted amber
   (with a sub-row stating what changed) and a separate REMOVED table.

Failure never blocks the log: if NRSDB is unreachable or the login fails, the
PDF prints the reason in place of the table and the Generate step shows a
warning. If the credentials are not set at all, the section is omitted.

Setup:

```
NRSDB_EMAIL               = you@networkrail.co.uk      # server-only
NRSDB_PASSWORD            = ...                        # server-only
NRSDB_ROUTECODE           = EM                         # optional
SUPABASE_SERVICE_ROLE_KEY = ...                        # server-only, preferred for snapshot writes
```

Run `supabase/migrations/009_esr_snapshots.sql` in the Supabase SQL editor.
It also creates an `esr_current` view (the latest snapshot per route) for use
by Insight, the messaging assistant, or ad-hoc queries; `esr_snapshot_runs.diff`
holds the ready-made `{new, amended, removed}` breakdown per day.

The route caches a successful scrape in-process for 60 seconds so repeated
"Regenerate PDF" clicks do not re-hit the NRSDB login endpoint.

## Modifying the PDF

Edit `lib/pdfGenerator.ts` — sections are clearly commented.

## Tuning Incident Classification

Edit `lib/ccilParser.ts` → `CATEGORY_PATTERNS` array.  
Patterns are tested in order; first match wins.

---

## File Structure

```
emcc-daily-log/
├── app/
│   ├── api/esr/snapshot/route.ts ← NRSDB ESR scrape + snapshot + diff (server)
│   ├── globals.css
│   ├── layout.tsx
│   └── page.tsx          ← Full app (upload → roster → review → generate)
├── lib/
│   ├── types.ts           ← Data types + category config
│   ├── ccilParser.ts      ← CCIL DOCX regex parser
│   ├── pdfGenerator.ts    ← jsPDF report builder
│   ├── esrClient.ts       ← browser wrapper for /api/esr/snapshot
│   └── esr/
│       ├── types.ts       ← shared ESR types
│       ├── refnum.ts      ← "EM 061C.26" → base ref + revision rank
│       ├── diff.ts        ← NRSDB JSON flattening + new/amended/removed diff
│       ├── nrsdbClient.ts ← session-cookie login + getEsrsByRouteCode (server)
│       └── snapshotStore.ts ← esr_snapshots / esr_snapshot_runs persistence (server)
├── vercel.json
├── package.json
└── README.md
```
