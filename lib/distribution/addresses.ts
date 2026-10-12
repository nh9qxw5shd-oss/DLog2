// ─── Distribution list address parsing ────────────────────────────────────────
// Turns whatever is pasted into the Distribution page (an Outlook To/Cc line,
// one address per line, a spreadsheet column) into { name, email } pairs.
//
// Outlook lines look like:
//   Jonathan Adshead <Jonathan.Adshead@networkrail.co.uk>, "Morris, Ryan"
//   	<ryan.morris@btp.police.uk>, plain@example.com
// Display names may be quoted, contain commas inside the quotes, and wrap onto
// the next line. Addresses are compared without regard to case (as mail
// systems do), so the first spelling seen is kept and later ones are dropped.

export interface ParsedAddress {
  email: string
  name: string | null
}

export interface ParseResult {
  addresses: ParsedAddress[]
  duplicates: string[]   // addresses that appeared more than once in the input
  invalid: string[]      // fragments that looked like an address but are not valid
}

// Deliberately plain: one @, no spaces or angle brackets, a dotted domain.
const EMAIL_RE = /^[^\s@<>(),;:"]+@[^\s@<>(),;:"]+\.[^\s@<>(),;:"]+$/

export function isValidEmail(s: string): boolean {
  return EMAIL_RE.test(s.trim())
}

export function emailKey(s: string): string {
  return s.trim().toLowerCase()
}

function cleanName(raw: string): string | null {
  const n = raw.replace(/\s+/g, ' ').replace(/^[\s,;]+|[\s,;]+$/g, '').replace(/^"(.*)"$/, '$1').trim()
  return n || null
}

/** Splits on commas, semicolons and line breaks that are not inside quotes or <…>. */
function splitEntries(input: string): string[] {
  const out: string[] = []
  let cur = ''
  let inQuote = false
  let inAngle = false
  for (const ch of input) {
    if (ch === '"' && !inAngle) inQuote = !inQuote
    else if (ch === '<' && !inQuote) inAngle = true
    else if (ch === '>' && !inQuote) inAngle = false
    if (!inQuote && !inAngle && (ch === ',' || ch === ';' || ch === '\n' || ch === '\r')) {
      out.push(cur); cur = ''
      continue
    }
    cur += ch
  }
  out.push(cur)
  return out
}

export function parseAddressList(input: string): ParseResult {
  const addresses: ParsedAddress[] = []
  const duplicates: string[] = []
  const invalid: string[] = []
  const seen = new Set<string>()

  // A display name can wrap onto the next line before its <address>; a
  // fragment with no address yet is carried into the next one.
  let pendingName = ''
  for (const fragment of splitEntries(input)) {
    const text = fragment.trim()
    if (!text) continue
    let email: string | null = null
    let name: string | null = null
    const angle = text.match(/^([\s\S]*)<([^<>]+)>\s*$/)
    if (angle) {
      email = angle[2].trim()
      name = cleanName(`${pendingName} ${angle[1]}`)
    } else if (text.includes('@')) {
      email = text.replace(/^mailto:/i, '').replace(/^"|"$/g, '').trim()
      name = cleanName(pendingName)
    } else {
      // No address in this fragment: either half of a wrapped display name
      // ("Morris, Ryan" unquoted) or noise. Hold it for the next fragment.
      pendingName = `${pendingName} ${text}`.trim()
      continue
    }
    pendingName = ''
    if (!isValidEmail(email)) { invalid.push(email); continue }
    const key = emailKey(email)
    if (seen.has(key)) { duplicates.push(email); continue }
    seen.add(key)
    addresses.push({ email, name })
  }
  return { addresses, duplicates, invalid }
}

/** Formats a list back into an Outlook-pasteable line. */
export function formatAddressList(list: ParsedAddress[]): string {
  return list.map(a => (a.name ? `"${a.name.replace(/"/g, '')}" <${a.email}>` : a.email)).join('; ')
}
