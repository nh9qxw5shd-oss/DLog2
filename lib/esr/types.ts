// ─── ESR (Emergency Speed Restriction) types ──────────────────────────────────
// Shared between the server-side scrape/snapshot code (app/api/esr), the
// client fetch wrapper (lib/esrClient.ts) and the PDF renderer. No runtime
// dependencies — safe to import from either side.

// One imposed ESR, flattened from the NRSDB JSON shape and normalised so that
// two captures of the same restriction compare field-for-field.
export interface EsrRow {
  baseRef: string            // "EM 061.26" — stable identity across revisions
  refnum: string             // "EM 061C.26" — as NRSDB shows it
  revisionLetter: string     // "" | "A" | "B" …
  revisionRank: number       // 0 = original, 1 = A, 2 = B …
  nrsdbId: number | null

  speedValue: string | null
  speedUnit: string | null
  linespeed: string | null
  duName: string | null
  elrCode: string | null
  elrDescription: string | null
  lorCode: string | null
  lorDescription: string | null
  location: string | null
  reason: string | null
  lines: unknown             // NRSDB structure verbatim (jsonb)
  linesText: string | null   // flattened for display

  whenImposedRaw: string | null
  whenImposed: string | null // ISO 8601 when parseable, else null
  etrRaw: string | null
  etr: string | null         // ISO 8601 when parseable, else null

  fmsNumber: string | null
  ccilNumber: string | null
  tsrReference: string | null
}

export interface EsrFieldChange {
  field: string              // 'revision' | 'speedValue' | 'linespeed' | 'location' | 'reason' | 'etr'
  label: string              // human label for the PDF
  old: string | null
  new: string | null
}

export interface EsrAmended {
  row: EsrRow
  prior: EsrRow
  changes: EsrFieldChange[]
}

export interface EsrDiff {
  new: EsrRow[]
  amended: EsrAmended[]
  removed: EsrRow[]
  unchanged: EsrRow[]
}

export type EsrStatus = 'NEW' | 'AMENDED' | 'UNCHANGED'

// What the API returns and what the PDF renders.
export interface EsrSnapshotResult {
  ok: true
  routeCode: string
  snapshotDate: string       // YYYY-MM-DD, Europe/London date of capture
  capturedAt: string         // ISO timestamp of capture
  baselineDate: string | null
  baselineCapturedAt: string | null
  persisted: boolean         // false when Supabase was not configured or dryRun
  dryRun?: boolean           // true when the caller asked for no writes (Test Mode)
  persistError?: string      // set when the snapshot could not be stored
  counts: {
    active: number
    new: number
    amended: number
    removed: number
    unchanged: number
  }
  // Every currently imposed ESR, sorted by refnum, with its status vs the
  // baseline and (for amendments) what changed.
  active: Array<{ row: EsrRow; status: EsrStatus; changes?: EsrFieldChange[] }>
  removed: EsrRow[]
}

export interface EsrSnapshotFailure {
  ok: false
  // 'not_configured' — NRSDB credentials absent on the server; the log omits
  //                    the section silently.
  // Anything else   — configured but the scrape/persist failed; the log prints
  //                    the message in place of the table so the gap is visible.
  reason: 'not_configured' | 'auth_failed' | 'fetch_failed' | 'bad_payload' | 'persist_failed' | 'error'
  message: string
}

export type EsrSnapshotResponse = EsrSnapshotResult | EsrSnapshotFailure
