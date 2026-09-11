'use client'

// ─── ESR snapshot — browser-side wrapper ─────────────────────────────────────
// The scrape itself runs in the Next.js route handler (app/api/esr/snapshot)
// because it needs the NRSDB account credentials and a cookie session, which
// must never reach the browser. This helper just calls it and normalises
// transport failures into the same { ok:false } shape the route returns.

import type { EsrSnapshotResponse } from './esr/types'

export type { EsrSnapshotResponse, EsrSnapshotResult, EsrSnapshotFailure, EsrRow, EsrStatus, EsrFieldChange } from './esr/types'

export { parsePastedFeed, NRSDB_FEED_URL } from './esr/paste'
export type { PasteParse, PasteProblem } from './esr/paste'

// Today's date in Europe/London, YYYY-MM-DD — the snapshot day boundary.
export function londonToday(): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/London', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date())
}

// Is this result fresh enough to build a log from without operator action?
// Live and pasted results always are; a stored fallback only if it was
// captured today (London date).
export function isEsrFresh(r: EsrSnapshotResponse | null): boolean {
  if (!r || !r.ok) return false
  if (r.source === 'stored') return r.snapshotDate === londonToday()
  return true
}

// `dryRun` (Test Mode) still pulls/diffs against the stored baseline, but the
// server writes nothing. `payload` sends an operator-pasted NRSDB feed instead
// of asking the server to pull (see lib/esr/paste.ts).
export async function fetchEsrSnapshot(reportDate: string, opts: { dryRun?: boolean; payload?: unknown } = {}): Promise<EsrSnapshotResponse> {
  try {
    const resp = await fetch('/api/esr/snapshot', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ reportDate, dryRun: !!opts.dryRun, ...(opts.payload !== undefined ? { payload: opts.payload } : {}) }),
      cache: 'no-store',
    })
    const text = await resp.text()
    let parsed: EsrSnapshotResponse | null = null
    try { parsed = JSON.parse(text) as EsrSnapshotResponse } catch { parsed = null }
    if (parsed && typeof parsed === 'object' && 'ok' in parsed) return parsed
    if (resp.status === 404) {
      // Static export / host without route handlers — treat as not configured.
      return { ok: false, reason: 'not_configured', message: 'ESR API route not available on this deployment.' }
    }
    return { ok: false, reason: 'error', message: `ESR API returned HTTP ${resp.status}.` }
  } catch (e) {
    return { ok: false, reason: 'fetch_failed', message: (e as Error).message || 'ESR API request failed.' }
  }
}
