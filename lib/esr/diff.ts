// ─── ESR flattening + day-to-day diff ────────────────────────────────────────
// Pure functions: NRSDB JSON → EsrRow, and (today, baseline) → EsrDiff.
// No I/O, no environment access — the API route and any future consumer
// (bulk re-processing of stored `raw` payloads) both use this.
//
// Ported from the nrsdb-esr-sync reference script (daily_snapshot_diff.py),
// with two deliberate differences:
//   • ETR is a tracked field — an extension to a restriction is an amendment
//     the log should surface, even when NRSDB doesn't bump the letter.
//   • Duplicate baseRefs within one pull are collapsed to the highest
//     revision so the (date, route, baseRef) key never silently merges rows.

import { EsrRow, EsrDiff, EsrFieldChange, EsrAmended } from './types'
import { parseRefnumSafe, compareRefnum } from './refnum'

type Json = Record<string, unknown>

function obj(v: unknown): Json {
  return v && typeof v === 'object' && !Array.isArray(v) ? (v as Json) : {}
}

function str(v: unknown): string | null {
  if (v === null || v === undefined) return null
  if (typeof v === 'string') { const t = v.trim(); return t ? t : null }
  if (typeof v === 'number' || typeof v === 'boolean') return String(v)
  return null
}

function num(v: unknown): number | null {
  if (typeof v === 'number' && Number.isFinite(v)) return v
  if (typeof v === 'string' && /^\d+$/.test(v.trim())) return parseInt(v, 10)
  return null
}

// NRSDB's `lines` entries look like (from a real EM feed):
//   { elr:{elrcode…}, trackId, routeheader:"Primary Line", direction:"Down Direction",
//     linedescription:"Down Main", boards:[{type:"commencement", miles:30, chains:52}, {type:"termination", …}, …] }
// Render each as "Down Main (30m 52ch – 30m 57ch)" using the commencement and
// termination boards, which is what control staff need to place the ESR.
// Older/other shapes (plain strings, {name}) are still handled.
const LINE_NAME_KEYS = ['linedescription', 'lineDescription', 'line_description', 'name', 'line', 'linename', 'line_name', 'description', 'direction', 'routeheader', 'code', 'linecode']

function mileage(b: Json): string | null {
  const mi = typeof b.miles === 'number' ? b.miles : (typeof b.miles === 'string' && b.miles.trim() ? Number(b.miles) : NaN)
  const ch = typeof b.chains === 'number' ? b.chains : (typeof b.chains === 'string' && b.chains.trim() ? Number(b.chains) : NaN)
  if (!Number.isFinite(mi)) return null
  return Number.isFinite(ch) ? `${mi}m ${String(ch).padStart(2, '0')}ch` : `${mi}m`
}

export function describeLine(line: unknown): string | null {
  if (line === null || line === undefined) return null
  if (typeof line === 'string' || typeof line === 'number') return String(line).trim() || null
  if (typeof line !== 'object') return null
  const o = line as Json
  let name: string | null = null
  for (const k of LINE_NAME_KEYS) { const v = str(o[k]); if (v) { name = v; break } }

  let span: string | null = null
  if (Array.isArray(o.boards)) {
    const boards = o.boards.filter(b => b && typeof b === 'object') as Json[]
    const at = (t: string) => boards.find(b => typeof b.type === 'string' && b.type.toLowerCase() === t)
    const from = at('commencement'), to = at('termination')
    const f = from ? mileage(from) : null, t = to ? mileage(to) : null
    if (f && t) span = `${f} – ${t}`
    else if (f) span = `from ${f}`
    else if (t) span = `to ${t}`
  }
  if (name && span) return `${name} (${span})`
  return name ?? span
}

export function flattenLines(lines: unknown): string | null {
  if (lines === null || lines === undefined) return null
  if (typeof lines === 'string') return lines.trim() || null
  const items = Array.isArray(lines) ? lines : [lines]
  const parts = items.map(describeLine).filter((v): v is string => !!v)
  const out = parts.join('; ')
  return out || null
}

// Europe/London wall-clock → UTC instant. NRSDB is a UK system and emits
// local times with no zone marker; treating them as UTC would shift every
// summer timestamp by an hour in the PDF and in Insight.
function londonOffsetMinutes(utcMs: number): number {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Europe/London', hourCycle: 'h23',
    year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit',
  }).formatToParts(new Date(utcMs))
  const g = (t: string) => parseInt(parts.find(p => p.type === t)?.value ?? '0', 10)
  const asUtc = Date.UTC(g('year'), g('month') - 1, g('day'), g('hour'), g('minute'), g('second'))
  return Math.round((asUtc - utcMs) / 60000)
}

export function londonWallToUtc(Y: number, Mo: number, D: number, h = 0, mi = 0, se = 0): Date {
  const naive = Date.UTC(Y, Mo - 1, D, h, mi, se)
  let utc = naive - londonOffsetMinutes(naive) * 60000
  // Re-evaluate once in case the first guess straddled a DST changeover.
  utc = naive - londonOffsetMinutes(utc) * 60000
  return new Date(utc)
}

// Tolerant timestamp parser for the formats NRSDB is likely to emit. Returns
// an ISO 8601 string, or null when the value cannot be read unambiguously.
// Accepts: ISO 8601 (explicit zone honoured), "YYYY-MM-DD HH:MM[:SS]",
// "DD/MM/YYYY[ HH:MM[:SS]]", "DD-MM-YYYY", and epoch seconds/milliseconds.
// Values with no explicit zone are Europe/London wall-clock time. The raw
// text is always stored alongside for reference.
export function parseNrsdbDate(v: unknown): string | null {
  if (v === null || v === undefined) return null
  if (typeof v === 'number') {
    const ms = v > 1e12 ? v : v * 1000
    const d = new Date(ms)
    return Number.isNaN(d.getTime()) ? null : d.toISOString()
  }
  if (typeof v !== 'string') return null
  const s = v.trim()
  if (!s) return null

  let m = /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2})(?::(\d{2}))?)?\s*(Z|[+-]\d{2}:?\d{2})?$/.exec(s)
  if (m) {
    const [, Y, Mo, D, h = '00', mi = '00', se = '00', tz] = m
    const d = tz
      ? new Date(`${Y}-${Mo}-${D}T${h}:${mi}:${se}${tz.replace(/^([+-]\d{2})(\d{2})$/, '$1:$2')}`)
      : londonWallToUtc(+Y, +Mo, +D, +h, +mi, +se)
    return Number.isNaN(d.getTime()) ? null : d.toISOString()
  }
  m = /^(\d{1,2})[\/-](\d{1,2})[\/-](\d{4})(?:[ T](\d{1,2}):(\d{2})(?::(\d{2}))?)?$/.exec(s)
  if (m) {
    const [, D, Mo, Y, h = '0', mi = '0', se = '0'] = m
    const d = londonWallToUtc(+Y, +Mo, +D, +h, +mi, +se)
    return Number.isNaN(d.getTime()) ? null : d.toISOString()
  }
  if (/^\d{10,13}$/.test(s)) return parseNrsdbDate(parseInt(s, 10))
  const d = new Date(s)
  return Number.isNaN(d.getTime()) ? null : d.toISOString()
}

// Map one NRSDB ESR item to a flat, comparable row.
export function flattenEsr(item: unknown): EsrRow {
  const it = obj(item)
  const speed  = obj(it.speed)
  const du     = obj(it.du)
  const elr    = obj(it.elr)
  const lor    = obj(it.lor)
  const reason = obj(it.reason)
  const refs   = obj(it.references)

  const refnum = str(it.refnum) ?? (it.id !== undefined ? `#${String(it.id)}` : '')
  const parsed = parseRefnumSafe(refnum)

  const whenImposedRaw = str(it.whenimposed)
  const etrRaw         = str(it.etr)
  const updatedAtRaw   = str(it.updated_at ?? it.updatedAt)

  return {
    baseRef: parsed.baseRef,
    refnum,
    revisionLetter: parsed.letter,
    revisionRank: parsed.revisionRank,
    nrsdbId: num(it.id),

    speedValue: str(speed.value),
    speedUnit: str(speed.unit),
    linespeed: str(speed.linespeed),
    duName: str(du.name),
    elrCode: str(elr.elrcode),
    elrDescription: str(elr.elrdescription),
    lorCode: str(lor.lorcode),
    lorDescription: str(lor.lordescription),
    location: str(it.location),
    reason: str(reason.reason) ?? (typeof it.reason === 'string' ? str(it.reason) : null),
    lines: it.lines ?? null,
    linesText: flattenLines(it.lines),

    whenImposedRaw,
    whenImposed: parseNrsdbDate(whenImposedRaw),
    etrRaw,
    etr: parseNrsdbDate(etrRaw),
    updatedAtRaw,
    updatedAt: parseNrsdbDate(updatedAtRaw),

    fmsNumber: str(refs.fmsnumber),
    ccilNumber: str(refs.ccilnumber),
    tsrReference: str(refs.tsrreference),
  }
}

// NRSDB's getEsrsByRouteCode returns a bare array in the reference script's
// experience; accept a wrapper object too in case that ever changes.
export function extractEsrList(payload: unknown): unknown[] | null {
  if (Array.isArray(payload)) return payload
  const p = obj(payload)
  for (const k of ['data', 'esrs', 'results', 'rows', 'items']) {
    if (Array.isArray(p[k])) return p[k] as unknown[]
  }
  return null
}

// Flatten a whole pull and collapse duplicate baseRefs (highest revision wins,
// then most recently imposed). Withdrawn entries are dropped defensively even
// though the "imposed" filter should already exclude them.
export function flattenPull(payload: unknown[]): EsrRow[] {
  const byBase = new Map<string, EsrRow>()
  for (const item of payload) {
    const it = obj(item)
    if (it.withdrawn === true || it.withdrawn === 1 || it.withdrawn === '1') continue
    const row = flattenEsr(item)
    if (!row.baseRef) continue
    const existing = byBase.get(row.baseRef)
    if (!existing
      || row.revisionRank > existing.revisionRank
      || (row.revisionRank === existing.revisionRank
          && (row.whenImposed ?? '') > (existing.whenImposed ?? ''))) {
      byBase.set(row.baseRef, row)
    }
  }
  return sortRows(Array.from(byBase.values()))
}

export function sortRows<T extends { refnum: string }>(rows: T[]): T[] {
  return [...rows].sort((a, b) => compareRefnum(a.refnum, b.refnum))
}

// Fields (beyond the revision letter) whose change also marks an ESR amended.
export const TRACKED_FIELDS: Array<{ key: keyof EsrRow; label: string }> = [
  { key: 'speedValue', label: 'Speed' },
  { key: 'linespeed',  label: 'Line speed' },
  { key: 'location',   label: 'Location' },
  { key: 'reason',     label: 'Reason' },
  { key: 'etrRaw',     label: 'ETR' },
]

function norm(v: unknown): string | null {
  const s = str(v)
  return s ? s.replace(/\s+/g, ' ').trim() : null
}

export function diffRows(today: EsrRow[], baseline: EsrRow[]): EsrDiff {
  const todayBy = new Map(today.map(r => [r.baseRef, r]))
  const priorBy = new Map(baseline.map(r => [r.baseRef, r]))

  const added: EsrRow[] = []
  const amended: EsrAmended[] = []
  const unchanged: EsrRow[] = []
  const removed: EsrRow[] = []

  for (const row of today) {
    const prior = priorBy.get(row.baseRef)
    if (!prior) { added.push(row); continue }

    const changes: EsrFieldChange[] = []
    if (row.revisionRank !== prior.revisionRank) {
      changes.push({ field: 'revision', label: 'Revision', old: prior.refnum, new: row.refnum })
    }
    for (const f of TRACKED_FIELDS) {
      const a = norm(prior[f.key]); const b = norm(row[f.key])
      if (a !== b) changes.push({ field: f.key, label: f.label, old: a, new: b })
    }
    if (changes.length) amended.push({ row, prior, changes })
    else unchanged.push(row)
  }
  for (const prior of baseline) {
    if (!todayBy.has(prior.baseRef)) removed.push(prior)
  }

  return {
    new: sortRows(added),
    amended: [...amended].sort((a, b) => compareRefnum(a.row.refnum, b.row.refnum)),
    removed: sortRows(removed),
    unchanged: sortRows(unchanged),
  }
}

// Compact "what changed" text for a table cell, e.g.
//   "Revision EM 061B.26 -> EM 061C.26; Speed 20 -> 30; ETR ... -> ..."
// ASCII arrow on purpose: jsPDF's built-in Helvetica has no U+2192 glyph.
export function describeChanges(changes: EsrFieldChange[]): string {
  return changes.map(c => {
    const o = c.old ?? '—'; const n = c.new ?? '—'
    return `${c.label} ${o} -> ${n}`
  }).join('; ')
}
