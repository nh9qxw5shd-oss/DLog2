'use client'

// ─── ESR snapshot — browser-side wrapper ─────────────────────────────────────
// The scrape itself runs in the Next.js route handler (app/api/esr/snapshot)
// because it needs the NRSDB account credentials and a cookie session, which
// must never reach the browser. This helper just calls it and normalises
// transport failures into the same { ok:false } shape the route returns.

import type { EsrSnapshotResponse } from './esr/types'

export type { EsrSnapshotResponse, EsrSnapshotResult, EsrSnapshotFailure, EsrRow, EsrStatus, EsrFieldChange } from './esr/types'

// `dryRun` (Test Mode) still pulls from NRSDB and diffs against the stored
// baseline, but the server writes nothing.
export async function fetchEsrSnapshot(reportDate: string, opts: { dryRun?: boolean } = {}): Promise<EsrSnapshotResponse> {
  try {
    const resp = await fetch('/api/esr/snapshot', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ reportDate, dryRun: !!opts.dryRun }),
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
