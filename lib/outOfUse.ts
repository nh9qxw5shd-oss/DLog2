'use client'

// ─── Out of Use Infrastructure Register ───────────────────────────────────────
// A standing register, owned by maintenance, of infrastructure that is out of
// use and UPS units that are offline. It lives in its own Supabase table and
// is edited on the standalone /out-of-use page — which has no route back into
// DLog2, so maintenance staff can be given that link alone. Control put no
// effort in: every log build reads the register as it stands (see
// fetchOutOfUseRegister) and the PDF prints it as its final section.
//
// Two parties write to an infrastructure entry:
//   • maintenance — the asset, the issue and restrictions, dates, refs, owner,
//     repair requirements and timescale;
//   • ops — the operational impact and its RAG rating (RED significant,
//     AMBER minimal, GREEN none). The RAG decides the order on the page and
//     in the PDF, most significant first; an entry ops have not yet rated
//     sits above the greens so it gets looked at.
//
// Without Supabase configured the page still works, backed by localStorage,
// but the data is then per-browser and never reaches the log — the page says
// so. In practice Supabase is required for this feature to do its job.

import { createClient, SupabaseClient } from '@supabase/supabase-js'

// ─── Types ────────────────────────────────────────────────────────────────────

export type OouSection = 'INFRA' | 'UPS'

export const OOU_SECTIONS: OouSection[] = ['INFRA', 'UPS']

export type OouRag = 'RED' | 'AMBER' | 'GREEN'

export const OOU_RAGS: OouRag[] = ['RED', 'AMBER', 'GREEN']

export interface OouRagSpec {
  label: string
  short: string
  meaning: string
  /** UI colours (Tailwind-free so the PDF can share them) */
  hex: string
  fg: string
  rgb: [number, number, number]
}

export const OOU_RAG_SPECS: Record<OouRag, OouRagSpec> = {
  RED:   { label: 'Red',   short: 'R', meaning: 'Significant operational impact expected', hex: '#C0392B', fg: '#FFFFFF', rgb: [192,  57,  43] },
  AMBER: { label: 'Amber', short: 'A', meaning: 'Minimal operational impact expected',     hex: '#F39C12', fg: '#001F45', rgb: [243, 156,  18] },
  GREEN: { label: 'Green', short: 'G', meaning: 'No operational impact expected',          hex: '#27AE60', fg: '#FFFFFF', rgb: [ 39, 174,  96] },
}

/** Shown where ops have not yet rated an entry. */
export const OOU_UNRATED = { label: 'Not assessed', hex: '#4A5A72', fg: '#FFFFFF', rgb: [74, 90, 114] as [number, number, number] }

export interface OouItem {
  id: string
  section: OouSection
  item: string          // Infrastructure item and location / UPS site
  elr: string
  since: string | null  // YYYY-MM-DD — out of use since
  ref: string           // FMS / CCIL / Ellipse ref
  detail: string        // Maintenance: issue causing OOU and restrictions imposed
  owner: string         // e.g. IME Derby
  plan: string          // Repair requirements and timescale / UPS plan for rectification
  impact: string        // UPS: impact on failure
  rag: OouRag | null    // Ops: operational impact rating
  opsImpact: string     // Ops: operational impact narrative
  sortOrder: number
  createdAt: string
  updatedAt: string
  updatedBy: string
}

export type OouField = 'item' | 'elr' | 'since' | 'ref' | 'detail' | 'owner' | 'plan' | 'impact' | 'rag' | 'opsImpact'

export type OouDraft = Omit<OouItem, 'id' | 'createdAt' | 'updatedAt' | 'sortOrder'> & { sortOrder?: number }

export interface OouRegister {
  items: OouItem[]
  /** Most recent updated_at across the register, or null when empty */
  lastUpdated: string | null
  /** 'cloud' = Supabase, 'local' = localStorage fallback (not shared) */
  source: 'cloud' | 'local'
}

// ─── Section metadata ─────────────────────────────────────────────────────────
// Which fields each register table shows, what they are called, and who owns
// them. The PDF and the page both read this, so the two never drift apart.

export type OouFieldKind = 'text' | 'multiline' | 'date' | 'rag'
export type OouFieldGroup = 'maintenance' | 'ops'

export interface OouFieldSpec {
  key: OouField
  label: string
  kind: OouFieldKind
  group: OouFieldGroup
  placeholder?: string
  /** Short hint shown under the label on the form */
  hint?: string
}

export interface OouSectionSpec {
  key: OouSection
  title: string
  pdfTitle: string
  blurb: string
  /** Whether ops rate entries in this section (drives RAG ordering + badge) */
  rated: boolean
  fields: OouFieldSpec[]
}

export const OOU_SECTION_SPECS: Record<OouSection, OouSectionSpec> = {
  INFRA: {
    key: 'INFRA',
    title: 'Infrastructure Out of Use',
    pdfTitle: 'INFRASTRUCTURE OUT OF USE',
    blurb: 'Every asset currently out of use, whatever the expected duration. Maintenance enter the asset, the issue and the repair plan; ops rate the operational impact. Most significant impact sits at the top.',
    rated: true,
    fields: [
      { key: 'item',      label: 'Infrastructure Item and Location', kind: 'text',      group: 'maintenance', placeholder: 'e.g. 617 pts, Branston Jn' },
      { key: 'elr',       label: 'ELR',                              kind: 'text',      group: 'maintenance', placeholder: 'e.g. KSL' },
      { key: 'detail',    label: 'Issue and Restrictions Imposed',   kind: 'multiline', group: 'maintenance', placeholder: 'What has failed or been taken out of use, and what restrictions apply as a result', hint: 'Maintenance overall detail for the entry' },
      { key: 'since',     label: 'Out of Use Since',                 kind: 'date',      group: 'maintenance' },
      { key: 'ref',       label: 'FMS / CCIL Ref',                   kind: 'text',      group: 'maintenance', placeholder: 'FMS, CCIL or Ellipse number' },
      { key: 'owner',     label: 'Owner',                            kind: 'text',      group: 'maintenance', placeholder: 'e.g. IME Derby' },
      { key: 'plan',      label: 'Repair Requirements and Timescale', kind: 'multiline', group: 'maintenance', placeholder: 'What is needed to return it to use, funding / plan status, expected date, next review' },
      { key: 'rag',       label: 'RAG Rating',                       kind: 'rag',       group: 'ops', hint: 'Red significant · Amber minimal · Green no impact expected' },
      { key: 'opsImpact', label: 'Operational Impact',               kind: 'multiline', group: 'ops', placeholder: 'How this affects the train service, regulation, degraded working, freight paths, contingency plans…' },
    ],
  },
  UPS: {
    key: 'UPS',
    title: 'UPS Offline',
    pdfTitle: 'UPS OFFLINE',
    blurb: 'Signalling power supply UPS units that are failed, bypassed or obsolete, and what a mains failure at that site would do.',
    rated: false,
    fields: [
      { key: 'item',   label: 'UPS / Site',              kind: 'text',      group: 'maintenance', placeholder: 'e.g. Bestwood Park' },
      { key: 'plan',   label: 'Plan for Rectification',  kind: 'multiline', group: 'maintenance', placeholder: 'Renewal, design, bypass in place…' },
      { key: 'impact', label: 'Impact on Failure',       kind: 'multiline', group: 'maintenance', placeholder: 'What happens on a power failure at this site' },
      { key: 'owner',  label: 'Owner',                   kind: 'text',      group: 'maintenance', placeholder: 'e.g. E&P Derby' },
    ],
  },
}

export function blankDraft(section: OouSection): OouDraft {
  return {
    section, item: '', elr: '', since: null, ref: '',
    detail: '', owner: '', plan: '', impact: '', rag: null, opsImpact: '', updatedBy: '',
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
  id: string; section: string; item: string; elr: string
  since: string | null; ref: string; detail: string; owner: string; plan: string
  impact: string; rag: string | null; ops_impact: string
  sort_order: number; created_at: string; updated_at: string; updated_by: string
  /** Pre-migration-013 column; folded into detail if it ever appears */
  restriction?: string
}

// Anything that is not INFRA or UPS (the pre-013 SHORT_TERM / LONG_TERM) is
// infrastructure. Tolerated so a page built before the migration ran, or a
// stale localStorage copy, still renders.
function normaliseSection(s: string | null | undefined): OouSection {
  return s === 'UPS' ? 'UPS' : 'INFRA'
}

function normaliseRag(r: string | null | undefined): OouRag | null {
  return r === 'RED' || r === 'AMBER' || r === 'GREEN' ? r : null
}

function joinDetail(restriction: string | undefined, detail: string | undefined): string {
  const parts = [restriction, detail].map(s => (s ?? '').trim()).filter(Boolean)
  return parts.join('\n')
}

function fromRow(r: Row): OouItem {
  return {
    id: r.id, section: normaliseSection(r.section), item: r.item ?? '', elr: r.elr ?? '',
    since: r.since ?? null, ref: r.ref ?? '',
    detail: joinDetail(r.restriction, r.detail), owner: r.owner ?? '', plan: r.plan ?? '', impact: r.impact ?? '',
    rag: normaliseRag(r.rag), opsImpact: r.ops_impact ?? '',
    sortOrder: r.sort_order ?? 0, createdAt: r.created_at, updatedAt: r.updated_at,
    updatedBy: r.updated_by ?? '',
  }
}

function toRow(d: OouDraft, now: string): Omit<Row, 'id' | 'created_at' | 'restriction'> {
  return {
    section: d.section,
    item: d.item.trim(),
    elr: d.elr.trim(),
    since: d.since || null,
    ref: d.ref.trim(),
    detail: d.detail.trim(),
    owner: d.owner.trim(),
    plan: d.plan.trim(),
    impact: d.impact.trim(),
    rag: d.section === 'INFRA' ? d.rag : null,
    ops_impact: d.opsImpact.trim(),
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
    if (!Array.isArray(parsed)) return []
    // Normalise whatever shape an earlier build stored.
    return (parsed as any[]).map(p => ({
      id: String(p.id),
      section: normaliseSection(p.section),
      item: p.item ?? '', elr: p.elr ?? '',
      since: p.since ?? null, ref: p.ref ?? '',
      detail: joinDetail(p.restriction, p.detail),
      owner: p.owner ?? '', plan: p.plan ?? '', impact: p.impact ?? '',
      rag: normaliseRag(p.rag), opsImpact: p.opsImpact ?? '',
      sortOrder: p.sortOrder ?? 0,
      createdAt: p.createdAt ?? new Date(0).toISOString(),
      updatedAt: p.updatedAt ?? p.createdAt ?? new Date(0).toISOString(),
      updatedBy: p.updatedBy ?? '',
    }))
  } catch { return [] }
}

function writeLocal(items: OouItem[]): void {
  try { window.localStorage.setItem(LOCAL_KEY, JSON.stringify(items)) } catch { /* private mode */ }
}

function localId(): string {
  try { return crypto.randomUUID() } catch { return `local-${Date.now()}-${Math.random().toString(36).slice(2, 8)}` }
}

// ─── Ordering ─────────────────────────────────────────────────────────────────
// Section, then RAG (RED, AMBER, not-yet-rated, GREEN), then explicit sort
// order, then oldest out-of-use first, then creation order — so the register
// reads the same on the page and in the PDF.

export function ragRank(rag: OouRag | null): number {
  switch (rag) {
    case 'RED':   return 0
    case 'AMBER': return 1
    case null:    return 2
    case 'GREEN': return 3
  }
}

function sortItems(items: OouItem[]): OouItem[] {
  const sectionRank: Record<OouSection, number> = { INFRA: 0, UPS: 1 }
  return [...items].sort((a, b) =>
    sectionRank[a.section] - sectionRank[b.section]
    || (a.section === 'INFRA' ? ragRank(a.rag) - ragRank(b.rag) : 0)
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

/** RAG counts for the infrastructure part — for checklists and headers. */
export function ragCounts(items: OouItem[]): Record<OouRag | 'UNRATED', number> {
  const c: Record<OouRag | 'UNRATED', number> = { RED: 0, AMBER: 0, GREEN: 0, UNRATED: 0 }
  for (const i of items) if (i.section === 'INFRA') c[i.rag ?? 'UNRATED']++
  return c
}

// ─── Public API ───────────────────────────────────────────────────────────────

export class OouError extends Error {}

/** The whole register. Never throws — an unreachable database yields an
 *  empty cloud register with `error` set, so a log build is never blocked. */
export async function fetchOutOfUseRegister(): Promise<OouRegister & { error?: string }> {
  const sb = getClient()
  if (!sb) return build(readLocal(), 'local')
  const { data, error } = await sb.from(TABLE).select('*')
  if (error) return { ...build([], 'cloud'), error: explain(error.message) }
  return build((data as Row[]).map(fromRow), 'cloud')
}

export async function createOouItem(draft: OouDraft): Promise<OouItem> {
  if (!draft.item.trim()) throw new OouError('The item / location is required.')
  const now = new Date().toISOString()
  const sb = getClient()
  if (!sb) {
    const items = readLocal()
    const item: OouItem = fromRow({ ...toRow(draft, now), id: localId(), created_at: now })
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

/** Move an item to the other section, keeping everything else as it is. */
export async function moveOouItem(item: OouItem, section: OouSection, updatedBy: string): Promise<OouItem> {
  return updateOouItem(item.id, { ...item, section, updatedBy: updatedBy || item.updatedBy })
}

function explain(msg: string): string {
  if (/relation .* does not exist|schema cache/i.test(msg) && /out_of_use_register/.test(msg) && !/column/i.test(msg))
    return 'The out_of_use_register table does not exist yet — run supabase/migrations/012_out_of_use_register.sql in the Supabase SQL editor.'
  if (/column .*(rag|ops_impact)/i.test(msg) || /(rag|ops_impact).* column/i.test(msg))
    return 'The database is missing the RAG / operational impact columns — run supabase/migrations/013_out_of_use_rag.sql in the Supabase SQL editor.'
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
