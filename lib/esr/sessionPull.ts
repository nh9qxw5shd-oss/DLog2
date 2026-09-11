// ─── Session-based ESR pull (server-side only) ───────────────────────────────
// The unattended path: read the stored NRSDB session cookie, call the data
// route with it (no login), record the outcome, and on success run the
// normal flatten → diff → store pipeline. Used by the keep-alive cron, the
// probe, the session-supply endpoint and the log build.

import type { SupabaseClient } from '@supabase/supabase-js'
import { NrsdbClient } from './nrsdbClient'
import { buildFromPayload } from './pipeline'
import { getSession, recordCheck, updateSessionCookie, summarise, SessionAccessError, type CheckTrigger, type SessionSummary, type SessionStatus } from './sessionStore'
import type { EsrSnapshotResult } from './types'

export interface SessionPullOptions {
  trigger: CheckTrigger
  persist: boolean            // store the snapshot (false for probes / Test Mode)
  reportDate?: string | null
  filter?: string
}

export type SessionPullOutcome =
  | { status: 'ok'; result: EsrSnapshotResult; session: SessionSummary; esrCount: number }
  | { status: 'none'; message: string }                              // no session stored
  | { status: 'unavailable'; message: string }                       // cannot read the store (anon key)
  | { status: Exclude<SessionStatus, 'ok'>; message: string; httpStatus: number; session: SessionSummary }

export async function pullWithStoredSession(sb: SupabaseClient, routeCode: string, o: SessionPullOptions): Promise<SessionPullOutcome> {
  let session
  try {
    session = await getSession(sb, routeCode)
  } catch (e) {
    if (e instanceof SessionAccessError) return { status: 'unavailable', message: e.message }
    throw e
  }
  if (!session) return { status: 'none', message: 'No NRSDB session stored. Supply one from Settings (bookmark or paste).' }

  const client = new NrsdbClient({ cookie: session.cookie })
  const pull = await client.pullWithSession(routeCode, o.filter ?? 'imposed')

  if (!pull.ok) {
    await recordCheck(sb, routeCode, { trigger: o.trigger, status: pull.status, httpStatus: pull.httpStatus, detail: pull.detail }, session)
    const refreshed = await getSession(sb, routeCode)
    const msg = pull.status === 'expired'
      ? `NRSDB no longer accepts the stored session (${pull.detail}). Supply a fresh one from Settings.`
      : pull.status === 'blocked'
      ? `NRSDB's edge blocked the data route from this server (${pull.detail}); the session path is closed on this host.`
      : `Session pull failed: ${pull.detail}`
    return { status: pull.status, message: msg, httpStatus: pull.httpStatus, session: summarise(refreshed ?? session) }
  }

  // Rotated session id? Keep the store current.
  if (pull.cookie && pull.cookie !== session.cookie) {
    try { await updateSessionCookie(sb, routeCode, pull.cookie) } catch { /* non-fatal */ }
  }

  const result = await buildFromPayload({ payload: pull.payload, routeCode, reportDate: o.reportDate ?? null, dryRun: !o.persist, sb, source: 'live' })
  const esrCount = result.ok ? result.counts.active : 0
  await recordCheck(sb, routeCode, {
    trigger: o.trigger, status: result.ok ? 'ok' : 'error', httpStatus: pull.httpStatus, esrCount,
    detail: result.ok ? (o.persist ? `stored ${esrCount}` : `dry run ${esrCount}`) : result.message,
  }, session)
  if (!result.ok) {
    const refreshed = await getSession(sb, routeCode)
    return { status: 'error', message: result.message, httpStatus: pull.httpStatus, session: summarise(refreshed ?? session) }
  }
  const refreshed = await getSession(sb, routeCode)
  return { status: 'ok', result, session: summarise(refreshed ?? session), esrCount }
}
