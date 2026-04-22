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
