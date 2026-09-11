// ─── NRSDB reference-number parser ───────────────────────────────────────────
// ESR references take the form:
//
//   EM 061C.26  → baseRef "EM 061.26", revisionLetter "C", revisionRank 3
//   EM 088.26   → baseRef "EM 088.26", revisionLetter "",  revisionRank 0
//   EM 099A.26  → baseRef "EM 099.26", revisionLetter "A", revisionRank 1
//
// baseRef is the stable identity of one restriction across its revisions;
// revisionRank turns the letter into a comparable integer so an advance in
// revision can be detected. Anything that does not match the pattern is kept
// whole as its own baseRef (rank 0) so it is still tracked day to day.
//
// Ported from the nrsdb-esr-sync reference script (refnum.py).

export interface ParsedRefnum {
  raw: string
  prefix: string
  number: string
  letter: string
  year: string
  baseRef: string
  revisionRank: number
}

const REFNUM_PATTERN = /^([A-Z]+)\s+(\d+)([A-Za-z]?)\.(\d+)$/

export function parseRefnum(refnum: string | null | undefined): ParsedRefnum | null {
  if (!refnum) return null
  const trimmed = refnum.trim()
  const m = REFNUM_PATTERN.exec(trimmed)
  if (!m) return null
  const [, prefix, number, rawLetter, year] = m
  const letter = rawLetter.toUpperCase()
  return {
    raw: trimmed,
    prefix,
    number,
    letter,
    year,
    baseRef: `${prefix} ${number}.${year}`,
    revisionRank: letter ? letter.charCodeAt(0) - 'A'.charCodeAt(0) + 1 : 0,
  }
}

export function parseRefnumSafe(refnum: string | null | undefined): ParsedRefnum {
  const parsed = parseRefnum(refnum)
  if (parsed) return parsed
  const raw = (refnum ?? '').trim()
  return { raw, prefix: '', number: '', letter: '', year: '', baseRef: raw, revisionRank: 0 }
}

// Sort key that orders "EM 061.26" before "EM 061A.26" before "EM 062.26" and
// keeps unparseable refs (sorted lexically) at the end. Compare keys with
// compareRefnum (plain code-unit order), not localeCompare — ICU collation
// would rank the "~" sentinel first.
export function refnumSortKey(refnum: string): string {
  const p = parseRefnum(refnum)
  if (!p) return `~${refnum}`
  return `${p.prefix} ${p.year.padStart(4, '0')} ${p.number.padStart(6, '0')} ${p.revisionRank.toString().padStart(3, '0')}`
}

export function compareRefnum(a: string, b: string): number {
  const ka = refnumSortKey(a), kb = refnumSortKey(b)
  return ka < kb ? -1 : ka > kb ? 1 : 0
}
