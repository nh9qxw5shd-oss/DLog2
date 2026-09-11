// ─── NRSDB session persistence (server-side only) ─────────────────────────────
// esr_session holds the captured cookie (a live login — service-role only,
// RLS with no policies); esr_session_checks records every use so the
// session's real lifetime can be read off the history.

import type { SupabaseClient } from '@supabase/supabase-js'

export type SessionStatus = 'ok' | 'expired' | 'blocked' | 'error'
export type CheckTrigger = 'cron' | 'probe' | 'build' | 'supply'

export interface StoredSession {
  routeCode: string
  cookie: string
  suppliedAt: string
  suppliedVia: string | null
  lastCheckAt: string | null
  lastOkAt: string | null
  lastStatus: SessionStatus | null
  lastError: string | null
  checks: number
  failures: number
}

// Public view of the session for the UI/probe — never includes the cookie.
export type SessionSummary = Omit<StoredSession, 'cookie'> & { cookieNames: string[] }

export function cookieNames(cookie: string): string[] {
  return cookie.split(';').map(p => p.trim().split('=')[0]).filter(Boolean)
}

export function summarise(s: StoredSession): SessionSummary {
  const { cookie, ...rest } = s
  return { ...rest, cookieNames: cookieNames(cookie) }
}

function isPermissionError(msg: string): boolean {
  return /permission denied|row-level security|RLS/i.test(msg)
}

export class SessionAccessError extends Error {
  constructor(message: string) { super(message); this.name = 'SessionAccessError' }
}

function wrap(prefix: string, msg: string): never {
  if (isPermissionError(msg)) {
    throw new SessionAccessError(`${prefix}: the server is using the anon key, which cannot read esr_session. Set SUPABASE_SERVICE_ROLE_KEY on the host.`)
  }
  throw new Error(`${prefix}: ${msg}`)
}

export async function getSession(sb: SupabaseClient, routeCode: string): Promise<StoredSession | null> {
  const { data, error } = await sb.from('esr_session').select('*').eq('route_code', routeCode).maybeSingle()
  if (error) wrap('Session read failed', error.message)
  if (!data) return null
  return {
    routeCode: data.route_code, cookie: data.cookie, suppliedAt: data.supplied_at, suppliedVia: data.supplied_via ?? null,
    lastCheckAt: data.last_check_at ?? null, lastOkAt: data.last_ok_at ?? null, lastStatus: data.last_status ?? null,
    lastError: data.last_error ?? null, checks: data.checks ?? 0, failures: data.failures ?? 0,
  }
}

export async function setSession(sb: SupabaseClient, routeCode: string, cookie: string, via: string): Promise<void> {
  const { error } = await sb.from('esr_session').upsert({
    route_code: routeCode, cookie, supplied_at: new Date().toISOString(), supplied_via: via,
    last_check_at: null, last_ok_at: null, last_status: null, last_error: null, checks: 0, failures: 0,
  }, { onConflict: 'route_code' })
  if (error) wrap('Session write failed', error.message)
}

// NRSDB may rotate the session id mid-life (Set-Cookie on a response); keep
// the store current so the next check uses the new value.
export async function updateSessionCookie(sb: SupabaseClient, routeCode: string, cookie: string): Promise<void> {
  const { error } = await sb.from('esr_session').update({ cookie }).eq('route_code', routeCode)
  if (error) wrap('Session cookie update failed', error.message)
}

export interface CheckRecord {
  trigger: CheckTrigger
  status: SessionStatus
  httpStatus?: number | null
  esrCount?: number | null
  detail?: string | null
}

export async function recordCheck(sb: SupabaseClient, routeCode: string, c: CheckRecord, current: StoredSession | null): Promise<void> {
  const now = new Date().toISOString()
  const { error: logErr } = await sb.from('esr_session_checks').insert({
    route_code: routeCode, trigger: c.trigger, status: c.status,
    http_status: c.httpStatus ?? null, esr_count: c.esrCount ?? null, detail: c.detail ? c.detail.slice(0, 500) : null,
  })
  if (logErr) wrap('Session check log failed', logErr.message)
  if (!current) return
  const ok = c.status === 'ok'
  const { error } = await sb.from('esr_session').update({
    last_check_at: now,
    ...(ok ? { last_ok_at: now } : {}),
    last_status: c.status,
    last_error: ok ? null : (c.detail ?? c.status),
    checks: (current.checks ?? 0) + 1,
    failures: ok ? 0 : (current.failures ?? 0) + 1,
  }).eq('route_code', routeCode)
  if (error) wrap('Session status update failed', error.message)
}

export async function recentChecks(sb: SupabaseClient, routeCode: string, limit = 12) {
  const { data, error } = await sb.from('esr_session_checks')
    .select('checked_at, trigger, status, http_status, esr_count, detail')
    .eq('route_code', routeCode).order('checked_at', { ascending: false }).limit(limit)
  if (error) wrap('Session history read failed', error.message)
  return data ?? []
}
