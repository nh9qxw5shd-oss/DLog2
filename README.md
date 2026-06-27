# EMCC Daily Report Generator

**Network Rail · East Midlands Control Centre**  
Automated daily operations report: CCIL `.docx` export → structured PDF. No backend, no API keys, no data leaves the browser.

---

## How It Works

1. **Upload** — Drop in a CCIL `.docx` export
2. **Parse** — mammoth.js reads the DOCX; regex parser extracts and classifies every incident locally
3. **Roster** — Enter daily shift staffing manually
4. **Review** — Add, edit, remove, or re-flag incidents
5. **Generate** — jsPDF builds the report in-browser → download PDF

Everything runs client-side. No data is sent anywhere.

---

## PDF Output

- Cover page (NR branding, OFFICIAL-SENSITIVE classification)
- Shift roster grid (day / night)
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

**No server components. No API keys. No database.**

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

- Fully client-side — CCIL data never leaves the user's browser
- No server, no database, no third-party API calls
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
│   ├── globals.css
│   ├── layout.tsx
│   └── page.tsx          ← Full app (upload → roster → review → generate)
├── lib/
│   ├── types.ts           ← Data types + category config
│   ├── ccilParser.ts      ← CCIL DOCX regex parser
│   └── pdfGenerator.ts   ← jsPDF report builder
├── vercel.json
├── package.json
└── README.md
```
