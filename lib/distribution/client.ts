'use client'

// ─── Daily log distribution: browser side ─────────────────────────────────────
// Keeps hold of the files the email attaches (the CCIL .docx and the forecast
// PDF the operator dropped in, and the log PDF that Generate built) for the
// life of the page, and talks to /api/distribution. Files are held in memory
// only: they are never written to browser storage, and a reload loses them
// (the Send step then asks for them again).

import { withBase } from '@/lib/basePath'
import type { AttachmentKind } from './emailTemplate'

// ── Files for this log ────────────────────────────────────────────────────────

type Listener = () => void
const files: Partial<Record<AttachmentKind, File>> = {}
const listeners = new Set<Listener>()

export function setSourceFile(kind: AttachmentKind, file: File | null): void {
  if (file) files[kind] = file
  else delete files[kind]
  listeners.forEach(l => l())
}

export function getSourceFiles(): Partial<Record<AttachmentKind, File>> {
  return { ...files }
}

export function subscribeSourceFiles(l: Listener): () => void {
  listeners.add(l)
  return () => { listeners.delete(l) }
}

// ── Sender name (per browser) ─────────────────────────────────────────────────

const NAME_KEY = 'dlog2:distribution-name'

function read(k: string): string {
  try { return window.localStorage.getItem(k) ?? '' } catch { return '' }
}
function write(k: string, v: string): void {
  try { if (v) window.localStorage.setItem(k, v); else window.localStorage.removeItem(k) } catch { /* private mode */ }
}

export const readSenderName = () => read(NAME_KEY)
export const writeSenderName = (v: string) => write(NAME_KEY, v.trim())

// ── API ───────────────────────────────────────────────────────────────────────

export interface PublicConfig {
  from: string; to: string; replyTo: string
  resend: boolean; database: boolean; ready: boolean
}

export interface PublicSend {
  id: number
  logDate: string
  isTest: boolean
  status: 'sending' | 'sent' | 'partial' | 'failed'
  sentBy: string | null
  toAddress: string | null
  attachments: string[]
  recipientCount: number
  sentCount: number
  emails: number
  error: string | null
  createdAt: string
  finishedAt: string | null
}

export interface DistributionStatus {
  config: PublicConfig
  activeCount?: number
  sends?: PublicSend[]
  error?: string
}

export interface Recipient {
  id: number; email: string; name: string | null; active: boolean
  addedAt: string; addedBy: string | null; updatedAt: string
}

async function call<T>(path: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(withBase(path), { ...init, cache: 'no-store' })
  const body = await res.json().catch(() => ({}))
  if (!res.ok) {
    const err = new Error(body?.error || `Request failed (${res.status})`) as Error & { status?: number; body?: any }
    err.status = res.status; err.body = body
    throw err
  }
  return body as T
}

export function fetchDistributionStatus(logDate: string): Promise<DistributionStatus> {
  return call(`/api/distribution?date=${encodeURIComponent(logDate)}`)
}

export function fetchRecipients(): Promise<{ recipients: Recipient[]; sends: PublicSend[] }> {
  return call('/api/distribution/recipients')
}

export function addRecipients(text: string, by: string) {
  return call<{ added: number; alreadyListed: number; duplicatesInPaste: number; invalid: string[] }>(
    '/api/distribution/recipients',
    { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text, by }) })
}

export function updateRecipient(id: number, patch: { email?: string; name?: string | null; active?: boolean }) {
  return call<{ ok: true }>('/api/distribution/recipients',
    { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id, ...patch }) })
}

export function removeRecipient(id: number) {
  return call<{ ok: true }>('/api/distribution/recipients',
    { method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id }) })
}

export interface SendResult {
  ok: boolean; mode: 'test' | 'live'; sendId?: number; status?: string
  sent?: number; total?: number; emails?: number; error?: string; previous?: PublicSend[]
}

export async function sendDailyLog(opts: {
  mode: 'test' | 'live'
  logDate: string
  sentBy: string
  testTo?: string
  again?: boolean
  resumeId?: number
  files: Partial<Record<AttachmentKind, File | Blob & { name?: string }>>
}): Promise<SendResult> {
  const fd = new FormData()
  fd.set('mode', opts.mode)
  fd.set('logDate', opts.logDate)
  fd.set('sentBy', opts.sentBy)
  if (opts.testTo) fd.set('testTo', opts.testTo)
  if (opts.again) fd.set('again', '1')
  if (opts.resumeId) fd.set('resumeId', String(opts.resumeId))
  for (const [kind, f] of Object.entries(opts.files)) {
    if (f) fd.set(kind, f, (f as File).name || kind)
  }
  const res = await fetch(withBase('/api/distribution/send'), {
    method: 'POST', body: fd, cache: 'no-store',
  })
  const body = await res.json().catch(() => ({ ok: false, error: `Send failed (${res.status})` }))
  return { ...body, ok: !!body.ok && res.ok }
}

export function previewUrl(logDate: string, kinds: AttachmentKind[]): string {
  return withBase(`/api/distribution/preview?date=${encodeURIComponent(logDate)}&a=${kinds.join(',')}`)
}
