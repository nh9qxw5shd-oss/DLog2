// ─── Daily log distribution: server-side only ─────────────────────────────────
// Configuration, the distribution list and send
// history (service-role tables), and the Resend call. Imported only by the
// /api/distribution route handlers.
//
// Host environment:
//   RESEND_API_KEY          Resend key for the derbycontrol.co.uk domain (required to send)
//   SUPABASE_SERVICE_ROLE_KEY  the list and send history are service-role only
//   DISTRIBUTION_FROM       optional, default "Derby Control <dailylog@derbycontrol.co.uk>"
//   DISTRIBUTION_TO         optional, default CS-LNE-DER-01A@networkrail.co.uk (visible To, gets every
//                           batch; the list, Control.Derby included, is BCC and gets one copy each)
//   DISTRIBUTION_REPLY_TO   optional, default Control.Derby@networkrail.co.uk
//   RESEND_API_URL          optional, default https://api.resend.com (a local stub for testing)

import { createClient, SupabaseClient } from '@supabase/supabase-js'
import { emailKey, isValidEmail, ParsedAddress } from './addresses'

export const DEFAULT_FROM = 'Derby Control <dailylog@derbycontrol.co.uk>'
export const DEFAULT_TO = 'CS-LNE-DER-01A@networkrail.co.uk'
export const DEFAULT_REPLY_TO = 'Control.Derby@networkrail.co.uk'

export interface DistributionConfig {
  from: string
  to: string
  replyTo: string
  resendKey: string | null
  serviceRole: boolean
}

export function config(): DistributionConfig {
  const env = (k: string) => (process.env[k] || '').trim() || null
  return {
    from: env('DISTRIBUTION_FROM') ?? DEFAULT_FROM,
    to: env('DISTRIBUTION_TO') ?? DEFAULT_TO,
    replyTo: env('DISTRIBUTION_REPLY_TO') ?? DEFAULT_REPLY_TO,
    resendKey: env('RESEND_API_KEY'),
    serviceRole: !!env('SUPABASE_SERVICE_ROLE_KEY'),
  }
}

/** What the browser may know about the set-up (never a secret). */
export function publicConfig(c: DistributionConfig = config()) {
  return {
    from: c.from, to: c.to, replyTo: c.replyTo,
    resend: !!c.resendKey, database: c.serviceRole,
    ready: !!c.resendKey && c.serviceRole,
  }
}

export class DistributionError extends Error {
  constructor(message: string, readonly status: number = 500) { super(message); this.name = 'DistributionError' }
}

export function db(): SupabaseClient {
  if (!config().serviceRole) {
    throw new DistributionError('The distribution list is service-role only: set SUPABASE_SERVICE_ROLE_KEY on the host.', 503)
  }
  const url = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL
  if (!url) throw new DistributionError('Supabase is not configured on the host.', 503)
  // Next 14 caches fetch() inside route handlers by default; a cached read of
  // the send history would hide an earlier send from the duplicate-send guard.
  return createClient(url, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { fetch: (input, init) => fetch(input, { ...init, cache: 'no-store' }) },
  })
}

function wrap(prefix: string, msg: string): never {
  if (/relation .* does not exist/i.test(msg)) throw new DistributionError(`${prefix}: run supabase/migrations/015_distribution.sql.`, 503)
  throw new DistributionError(`${prefix}: ${msg}`)
}

// ── Recipients ────────────────────────────────────────────────────────────────

export interface Recipient {
  id: number
  email: string
  name: string | null
  active: boolean
  addedAt: string
  addedBy: string | null
  updatedAt: string
}

function toRecipient(r: any): Recipient {
  return { id: r.id, email: r.email, name: r.name ?? null, active: !!r.active, addedAt: r.added_at, addedBy: r.added_by ?? null, updatedAt: r.updated_at }
}

export async function listRecipients(sb: SupabaseClient): Promise<Recipient[]> {
  const { data, error } = await sb.from('dlog2_distribution_recipients').select('*').order('email', { ascending: true }).limit(5000)
  if (error) wrap('Could not read the distribution list', error.message)
  return (data ?? []).map(toRecipient)
}

export async function activeAddresses(sb: SupabaseClient): Promise<string[]> {
  const { data, error } = await sb.from('dlog2_distribution_recipients').select('email').eq('active', true).order('id').limit(5000)
  if (error) wrap('Could not read the distribution list', error.message)
  const seen = new Set<string>()
  const out: string[] = []
  for (const r of data ?? []) {
    const e = String(r.email).trim()
    if (!isValidEmail(e) || seen.has(emailKey(e))) continue
    seen.add(emailKey(e)); out.push(e)
  }
  return out
}

/** Adds new addresses; ones already on the list (any case) are left as they are. */
export async function addRecipients(sb: SupabaseClient, entries: ParsedAddress[], by: string | null) {
  const existing = new Set((await listRecipients(sb)).map(r => emailKey(r.email)))
  const fresh = entries.filter(e => isValidEmail(e.email) && !existing.has(emailKey(e.email)))
  if (fresh.length) {
    const rows = fresh.map(e => ({ email: e.email.trim(), name: e.name?.trim() || null, added_by: by }))
    const { error } = await sb.from('dlog2_distribution_recipients').insert(rows)
    if (error) wrap('Could not add to the distribution list', error.message)
  }
  return { added: fresh.length, alreadyListed: entries.length - fresh.length }
}

export async function updateRecipient(sb: SupabaseClient, id: number, patch: { email?: string; name?: string | null; active?: boolean }) {
  const row: Record<string, unknown> = { updated_at: new Date().toISOString() }
  if (patch.email !== undefined) {
    if (!isValidEmail(patch.email)) throw new DistributionError(`"${patch.email}" is not a valid email address.`, 400)
    row.email = patch.email.trim()
  }
  if (patch.name !== undefined) row.name = patch.name?.trim() || null
  if (patch.active !== undefined) row.active = !!patch.active
  const { error } = await sb.from('dlog2_distribution_recipients').update(row).eq('id', id)
  if (error) {
    if (/duplicate key/i.test(error.message)) throw new DistributionError('That address is already on the list.', 409)
    wrap('Could not update the address', error.message)
  }
}

export async function removeRecipient(sb: SupabaseClient, id: number) {
  const { error } = await sb.from('dlog2_distribution_recipients').delete().eq('id', id)
  if (error) wrap('Could not remove the address', error.message)
}

// ── Send history ──────────────────────────────────────────────────────────────

export type SendStatus = 'sending' | 'sent' | 'partial' | 'failed'

export interface SendRecord {
  id: number
  logDate: string
  isTest: boolean
  status: SendStatus
  sentBy: string | null
  toAddress: string | null
  attachments: string[]
  attachmentHashes: string[]   // "kind:sha256" per file; a resume must carry the same set
  recipientCount: number
  sentCount: number
  sentTo: string[]
  resendIds: string[]
  error: string | null
  createdAt: string
  finishedAt: string | null
}

function toSend(r: any): SendRecord {
  const sentTo: string[] = r.sent_to ?? []
  return {
    id: r.id, logDate: r.log_date, isTest: !!r.is_test, status: r.status, sentBy: r.sent_by ?? null,
    toAddress: r.to_address ?? null, attachments: r.attachments ?? [], attachmentHashes: r.attachment_hashes ?? [], recipientCount: r.recipient_count ?? 0,
    sentCount: sentTo.length, sentTo, resendIds: r.resend_ids ?? [], error: r.error ?? null,
    createdAt: r.created_at, finishedAt: r.finished_at ?? null,
  }
}

/** The send history without addresses, for the browser. */
export function publicSend(s: SendRecord) {
  const { sentTo, resendIds, attachmentHashes, ...rest } = s
  return { ...rest, emails: resendIds.length }
}

export async function sendsFor(sb: SupabaseClient, logDate: string | null, limit = 20): Promise<SendRecord[]> {
  let q = sb.from('dlog2_distribution_sends').select('*').order('created_at', { ascending: false }).limit(limit)
  if (logDate) q = q.eq('log_date', logDate)
  const { data, error } = await q
  if (error) wrap('Could not read the send history', error.message)
  return (data ?? []).map(toSend)
}

/** Every live send for the date that is sent, part-sent or still going: the
 *  once-per-date guard. Unlimited, so test sends can never push one out of view. */
export async function liveSendsFor(sb: SupabaseClient, logDate: string): Promise<SendRecord[]> {
  const { data, error } = await sb.from('dlog2_distribution_sends').select('*')
    .eq('log_date', logDate).eq('is_test', false).in('status', ['sending', 'sent', 'partial'])
    .order('created_at', { ascending: false })
  if (error) wrap('Could not read the send history', error.message)
  return (data ?? []).map(toSend)
}

export async function getSend(sb: SupabaseClient, id: number): Promise<SendRecord | null> {
  const { data, error } = await sb.from('dlog2_distribution_sends').select('*').eq('id', id).maybeSingle()
  if (error) wrap('Could not read the send', error.message)
  return data ? toSend(data) : null
}

export async function createSend(sb: SupabaseClient, row: {
  logDate: string; isTest: boolean; sentBy: string | null; subject: string; toAddress: string; attachments: string[]; attachmentHashes: string[]; recipientCount: number
}): Promise<SendRecord> {
  const { data, error } = await sb.from('dlog2_distribution_sends').insert({
    log_date: row.logDate, is_test: row.isTest, sent_by: row.sentBy, subject: row.subject,
    to_address: row.toAddress, attachments: row.attachments, attachment_hashes: row.attachmentHashes,
    recipient_count: row.recipientCount, status: 'sending',
  }).select('*').single()
  if (error) wrap('Could not record the send', error.message)
  return toSend(data)
}

export async function updateSend(sb: SupabaseClient, id: number, patch: Partial<{
  status: SendStatus; sentTo: string[]; resendIds: string[]; error: string | null; finished: boolean; recipientCount: number; sentBy: string | null; attachments: string[]
}>) {
  const row: Record<string, unknown> = {}
  if (patch.status !== undefined) row.status = patch.status
  if (patch.sentTo !== undefined) row.sent_to = patch.sentTo
  if (patch.resendIds !== undefined) row.resend_ids = patch.resendIds
  if (patch.error !== undefined) row.error = patch.error
  if (patch.recipientCount !== undefined) row.recipient_count = patch.recipientCount
  if (patch.sentBy !== undefined) row.sent_by = patch.sentBy
  if (patch.attachments !== undefined) row.attachments = patch.attachments
  if (patch.finished) row.finished_at = new Date().toISOString()
  const { error } = await sb.from('dlog2_distribution_sends').update(row).eq('id', id)
  if (error) wrap('Could not update the send record', error.message)
}

// ── Resend ────────────────────────────────────────────────────────────────────

export interface ResendAttachment {
  filename: string
  content: string            // base64
  content_type?: string
  content_id?: string        // inline image, referenced as cid:<content_id>
}

export interface ResendEmail {
  from: string
  to: string[]
  bcc?: string[]
  reply_to?: string
  subject: string
  html: string
  text: string
  attachments: ResendAttachment[]
  tags?: { name: string; value: string }[]
}

/** One email through Resend, retrying a rate-limit answer twice. Returns the Resend id. */
export async function resendSend(apiKey: string, email: ResendEmail, idempotencyKey: string): Promise<string> {
  let res: Response | null = null
  let body: any = {}
  for (let attempt = 0; attempt < 3; attempt++) {
    const base = (process.env.RESEND_API_URL || 'https://api.resend.com').replace(/\/$/, '')
    res = await fetch(`${base}/emails`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json', 'Idempotency-Key': idempotencyKey },
      body: JSON.stringify(email),
    })
    body = await res.json().catch(() => ({}))
    if (res.status !== 429) break
    await new Promise(r => setTimeout(r, 1500))
  }
  if (!res?.ok) throw new DistributionError(`Resend ${res?.status}: ${body?.message ?? JSON.stringify(body)}`, 502)
  return String(body?.id ?? '?')
}
