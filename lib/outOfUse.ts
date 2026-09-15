'use client'

// ─── Out of Use Infrastructure Register ───────────────────────────────────────
// A standing register, owned by maintenance, of infrastructure that is out of
// use and UPS units that are offline. It lives in its own Supabase table and
// is edited on the standalone /out-of-use page — which has no route back into
// DLog2, so maintenance staff can be given that link alone. Control put no
// effort in: every log build reads the register as it stands (see
// fetchOutOfUseRegister) and the PDF prints it as its final section.
//
// Without Supabase configured the page still works, backed by localStorage,
// but the data is then per-browser and never reaches the log — the page says
// so. In practice Supabase is required for this feature to do its job.

import { createClient, SupabaseClient } from '@supabase/supabase-js'

// ─── Types ────────────────────────────────────────────────────────────────────

export type OouSection = 'SHORT_TERM' | 'LONG_TERM' | 'UPS'

export const OOU_SECTIONS: OouSection[] = ['SHORT_TERM', 'LONG_TERM', 'UPS']

export interface OouItem {
  id: string
  section: OouSection
  item: string          // Infrastructure item and location / UPS site
  elr: string
  restriction: string   // Restriction and impact
  since: string | null  // YYYY-MM-DD — out of use since
  ref: string           // FMS / CCIL / Ellipse ref
  detail: string
  owner: string         // e.g. IME Derby
  plan: string          // Repair timescale / plan for rectification
  impact: string        // UPS: impact on failure
  sortOrder: number
  createdAt: string
  updatedAt: string
  updatedBy: string
}

export type OouField = 'item' | 'elr' | 'restriction' | 'since' | 'ref' | 'detail' | 'owner' | 'plan' | 'impact'

export type OouDraft = Omit<OouItem, 'id' | 'createdAt' | 'updatedAt' | 'sortOrder'> & { sortOrder?: number }

export interface OouRegister {
  items: OouItem[]
  /** Most recent updated_at across the register, or null when empty */
  lastUpdated: string | null
  /** 'cloud' = Supabase, 'local' = localStorage fallback (not shared) */
  source: 'cloud' | 'local'
}

// ─── Section metadata ─────────────────────────────────────────────────────────
// Which fields each register table shows, and what they are called. The PDF
// and the page both read this, so the two never drift apart.

export interface OouFieldSpec {
  key: OouField
  label: string
  /** Shown as a column in the compact table (vs. in the expandable detail) */
  column: boolean
  multiline?: boolean
  placeholder?: string
}

export interface OouSectionSpec {
  key: OouSection
  title: string
  pdfTitle: string
  blurb: string
  fields: OouFieldSpec[]
}

const F = {
  item:        (label: string, placeholder: string): OouFieldSpec => ({ key: 'item', label, column: true, placeholder }),
  elr:         (): OouFieldSpec => ({ key: 'elr', label: 'ELR', column: true, placeholder: 'e.g. KSL' }),
  restriction: (): OouFieldSpec => ({ key: 'restriction', label: 'Restriction and Impact', column: true, multiline: true, placeholder: 'What is restricted and what that means operationally' }),
  since:       (): OouFieldSpec => ({ key: 'since', label: 'Out of Use Since', column: true }),
  ref:         (): OouFieldSpec => ({ key: 'ref', label: 'FMS / CCIL Ref', column: true, placeholder: 'FMS, CCIL or Ellipse number' }),
  detail:      (): OouFieldSpec => ({ key: 'detail', label: 'Detail', column: false, multiline: true, placeholder: 'Background — what failed, what has been done' }),
  owner:       (): OouFieldSpec => ({ key: 'owner', label: 'Owner', column: false, placeholder: 'e.g. IME Derby' }),
  plan:        (label: string, column: boolean, placeholder: string): OouFieldSpec => ({ key: 'plan', label, column, multiline: true, placeholder }),
  impact:      (): OouFieldSpec => ({ key: 'impact', label: 'Impact on Failure', column: true, multiline: true, placeholder: 'What happens on a power failure at this site' }),
}

export const OOU_SECTION_SPECS: Record<OouSection, OouSectionSpec> = {
  SHORT_TERM: {
    key: 'SHORT_TERM',
    title: 'Short Term Infrastructure Out of Use',
    pdfTitle: 'SHORT TERM INFRASTRUCTURE OUT OF USE',
    blurb: 'Assets expected back in use within weeks — points signed OOU, RT3187s, temporary restrictions. Move to Long Term if it drags on.',
    fields: [
      F.item('Infrastructure Item and Location', 'e.g. 617 pts, Branston Jn'),
      F.elr(),
      F.restriction(),
      F.since(),
      F.ref(),
      F.detail(),
      F.owner(),
      F.plan('Repair Timescale', false, 'When it is expected back in use'),
    ],
  },
  LONG_TERM: {
    key: 'LONG_TERM',
    title: 'Long Term Infrastructure Out of Use',
    pdfTitle: 'LONG TERM INFRASTRUCTURE OUT OF USE',
    blurb: 'Assets with no near-term return — awaiting business case, Network Change, renewal funding or removal.',
    fields: [
      F.item('Infrastructure Item and Location', 'e.g. Skegness Sidings'),
      F.elr(),
      F.restriction(),
      F.since(),
      F.ref(),
      F.detail(),
      F.owner(),
      F.plan('Repair Timescale', false, 'Plans, funding, next review date'),
    ],
  },
  UPS: {
    key: 'UPS',
    title: 'UPS Offline',
    pdfTitle: 'UPS OFFLINE',
    blurb: 'Signalling power supply UPS units that are failed, bypassed or obsolete, and what a mains failure at that site would do.',
    fields: [
      F.item('UPS / Site', 'e.g. Bestwood Park'),
      F.plan('Plan for Rectification', true, 'Renewal, design, bypass in place…'),
      F.impact(),
      F.owner(),
    ],
  },
}

export function blankDraft(section: OouSection): OouDraft {
  return {
    section, item: '', elr: '', restriction: '', since: null, ref: '',
    detail: '', owner: '', plan: '', impact: '', updatedBy: '',
  }
}

// ─── Supabase client (own singleton — same env vars as the main app) ─────────

let _client: SupabaseClient | null = null

function getClient(): SupabaseClient | null {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  if (!url || !key) return null
  if (!_client) _client = createClient(url, key)
  return _client
}

export function isOouCloud(): boolean {
  return !!(process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY)
}

const TABLE = 'out_of_use_register'

type Row = {
  id: string; section: OouSection; item: string; elr: string; restriction: string
  since: string | null; ref: string; detail: string; owner: string; plan: string
  impact: string; sort_order: number; created_at: string; updated_at: string; updated_by: string
}

function fromRow(r: Row): OouItem {
  return {
    id: r.id, section: r.section, item: r.item ?? '', elr: r.elr ?? '',
    restriction: r.restriction ?? '', since: r.since ?? null, ref: r.ref ?? '',
    detail: r.detail ?? '', owner: r.owner ?? '', plan: r.plan ?? '', impact: r.impact ?? '',
    sortOrder: r.sort_order ?? 0, createdAt: r.created_at, updatedAt: r.updated_at,
    updatedBy: r.updated_by ?? '',
  }
}

function toRow(d: OouDraft, now: string): Omit<Row, 'id' | 'created_at'> {
  return {
    section: d.section,
    item: d.item.trim(),
    elr: d.elr.trim(),
    restriction: d.restriction.trim(),
    since: d.since || null,
    ref: d.ref.trim(),
    detail: d.detail.trim(),
    owner: d.owner.trim(),
    plan: d.plan.trim(),
    impact: d.impact.trim(),
    sort_order: d.sortOrder ?? 0,
    updated_at: now,
    updated_by: d.updatedBy.trim(),
  }
}

// ─── localStorage fallback ────────────────────────────────────────────────────

const LOCAL_KEY = 'dlog2:out-of-use-register'

function readLocal(): OouItem[] {
  try {
    const raw = typeof window !== 'undefined' ? window.localStorage.getItem(LOCAL_KEY) : null
    if (!raw) return []
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed as OouItem[] : []
  } catch { return [] }
}

function writeLocal(items: OouItem[]): void {
  try { window.localStorage.setItem(LOCAL_KEY, JSON.stringify(items)) } catch { /* private mode */ }
}

function localId(): string {
  try { return crypto.randomUUID() } catch { return `local-${Date.now()}-${Math.random().toString(36).slice(2, 8)}` }
}

// ─── Ordering ─────────────────────────────────────────────────────────────────
// Section order, then explicit sort order, then oldest out-of-use first, then
// creation order — so the register reads the same on the page and in the PDF.

function sortItems(items: OouItem[]): OouItem[] {
  const rank: Record<OouSection, number> = { SHORT_TERM: 0, LONG_TERM: 1, UPS: 2 }
  return [...items].sort((a, b) =>
    rank[a.section] - rank[b.section]
    || a.sortOrder - b.sortOrder
    || (a.since || '9999').localeCompare(b.since || '9999')
    || a.createdAt.localeCompare(b.createdAt)
  )
}

function build(items: OouItem[], source: 'cloud' | 'local'): OouRegister {
  const sorted = sortItems(items)
  const lastUpdated = sorted.reduce<string | null>((m, i) => (!m || i.updatedAt > m ? i.updatedAt : m), null)
  return { items: sorted, lastUpdated, source }
}

// ─── Public API ───────────────────────────────────────────────────────────────

export class OouError extends Error {}

/** The whole register. Never throws — an unreachable database yields an
 *  empty cloud register with `error` set, so a log build is never blocked. */
export async function fetchOutOfUseRegister(): Promise<OouRegister & { error?: string }> {
  const sb = getClient()
  if (!sb) return build(readLocal(), 'local')
  const { data, error } = await sb.from(TABLE).select('*')
  if (error) return { ...build([], 'cloud'), error: error.message }
  return build((data as Row[]).map(fromRow), 'cloud')
}

export async function createOouItem(draft: OouDraft): Promise<OouItem> {
  if (!draft.item.trim()) throw new OouError('The item / location is required.')
  const now = new Date().toISOString()
  const sb = getClient()
  if (!sb) {
    const items = readLocal()
    const item: OouItem = { ...fromRow({ ...toRow(draft, now), id: localId(), created_at: now }) }
    writeLocal([...items, item])
    return item
  }
  const { data, error } = await sb.from(TABLE).insert(toRow(draft, now)).select('*').single()
  if (error) throw new OouError(explain(error.message))
  return fromRow(data as Row)
}

export async function updateOouItem(id: string, draft: OouDraft): Promise<OouItem> {
  if (!draft.item.trim()) throw new OouError('The item / location is required.')
  const now = new Date().toISOString()
  const sb = getClient()
  if (!sb) {
    const items = readLocal()
    const idx = items.findIndex(i => i.id === id)
    if (idx < 0) throw new OouError('Item no longer exists.')
    const item: OouItem = fromRow({ ...toRow(draft, now), id, created_at: items[idx].createdAt })
    items[idx] = item
    writeLocal(items)
    return item
  }
  const { data, error } = await sb.from(TABLE).update(toRow(draft, now)).eq('id', id).select('*').single()
  if (error) throw new OouError(explain(error.message))
  return fromRow(data as Row)
}

export async function deleteOouItem(id: string): Promise<void> {
  const sb = getClient()
  if (!sb) { writeLocal(readLocal().filter(i => i.id !== id)); return }
  const { error } = await sb.from(TABLE).delete().eq('id', id)
  if (error) throw new OouError(explain(error.message))
}

/** Move an item to another section (e.g. Short Term → Long Term), keeping
 *  everything else as it is. */
export async function moveOouItem(item: OouItem, section: OouSection, updatedBy: string): Promise<OouItem> {
  return updateOouItem(item.id, { ...item, section, updatedBy: updatedBy || item.updatedBy })
}

function explain(msg: string): string {
  if (/relation .* does not exist|schema cache/i.test(msg))
    return 'The out_of_use_register table does not exist yet — run supabase/migrations/012_out_of_use_register.sql in the Supabase SQL editor.'
  if (/row-level security|permission denied/i.test(msg))
    return 'The database refused the write (row-level security). Check the policy in migration 012.'
  return msg
}

// ─── Editor name (remembered per browser) ────────────────────────────────────

const NAME_KEY = 'dlog2:out-of-use-editor'

export function readEditorName(): string {
  try { return window.localStorage.getItem(NAME_KEY) || '' } catch { return '' }
}

export function writeEditorName(name: string): void {
  try { window.localStorage.setItem(NAME_KEY, name.trim()) } catch { /* ignore */ }
}

// ─── Formatting ───────────────────────────────────────────────────────────────

/** YYYY-MM-DD → DD/MM/YYYY, as the register has always shown it. */
export function fmtSince(iso: string | null | undefined): string {
  if (!iso) return '—'
  const [y, m, d] = iso.split('-')
  if (!y || !m || !d) return iso
  return `${d}/${m}/${y}`
}

/** Whole days since an ISO date, or null. */
export function daysSince(iso: string | null | undefined): number | null {
  if (!iso) return null
  const t = new Date(`${iso}T00:00:00`).getTime()
  if (Number.isNaN(t)) return null
  return Math.max(0, Math.floor((Date.now() - t) / 864e5))
}

/** "3 days ago", "6 weeks ago", "2 years ago" — for the "last updated" stamps. */
export function ago(isoStamp: string | null | undefined): string {
  if (!isoStamp) return 'never'
  const s = (Date.now() - new Date(isoStamp).getTime()) / 1000
  if (s < 60) return 'just now'
  const m = s / 60; if (m < 60) return `${Math.floor(m)} min ago`
  const h = m / 60; if (h < 24) return `${Math.floor(h)} h ago`
  const d = h / 24; if (d < 14) return `${Math.floor(d)} day${Math.floor(d) === 1 ? '' : 's'} ago`
  const w = d / 7; if (w < 9) return `${Math.floor(w)} weeks ago`
  const mo = d / 30.44; if (mo < 18) return `${Math.floor(mo)} months ago`
  return `${Math.floor(d / 365.25)} years ago`
}

export function fmtStamp(isoStamp: string | null | undefined): string {
  if (!isoStamp) return '—'
  const d = new Date(isoStamp)
  if (Number.isNaN(d.getTime())) return isoStamp
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Europe/London', day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit',
  }).format(d)
}
