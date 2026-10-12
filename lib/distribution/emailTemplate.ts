// ─── Daily log email: subject, body and attachment rules ──────────────────────
// Reproduces the Outlook template the desk used to send by hand: OFFICIAL
// marking, the Network Readiness Statement banner, the greeting, the list of
// attachments, and the Route Control Manager signature with the route strip.
// Pure (no images, no I/O) so the send route, the preview route and the tests
// share one copy. Images are referenced by a resolver: `cid:` for the sent
// email, a data URI for the on-screen preview.

export const SUBJECT = 'East Midlands Daily Control Log & 7 day look ahead'

export type AttachmentKind = 'forecast' | 'log' | 'ccil'

/** The order the attachments are listed in the body. */
export const ATTACHMENT_ORDER: AttachmentKind[] = ['log', 'forecast', 'ccil']
/** The order the files are attached (as the Outlook sends had them). */
export const FILE_ORDER: AttachmentKind[] = ['forecast', 'log', 'ccil']

export const ATTACHMENT_RULES: Record<AttachmentKind, { label: string; ext: string; contentType: string; magic: number[] }> = {
  log:      { label: 'Daily log PDF',               ext: '.pdf',  contentType: 'application/pdf', magic: [0x25, 0x50, 0x44, 0x46] }, // %PDF
  forecast: { label: 'Route 7 Day Forecast PDF',    ext: '.pdf',  contentType: 'application/pdf', magic: [0x25, 0x50, 0x44, 0x46] },
  ccil:     { label: 'CCIL export (.docx)',         ext: '.docx', contentType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', magic: [0x50, 0x4b] }, // PK (zip)
}

/** Vercel rejects request bodies over 4.5 MB; keep the three files under this. */
export const MAX_TOTAL_BYTES = 4 * 1024 * 1024

/** Resend accepts at most 50 addresses per email; one is the To address. */
export const BCC_PER_EMAIL = 49

export interface EmailContent {
  logDate: string                      // YYYY-MM-DD, the log's 06:00 → 06:00 day
  attachments: AttachmentKind[]        // which files are attached
  test?: { note: string } | null       // test sends carry a banner and a [TEST] subject
}

export type ImageResolver = (key: 'banner' | 'signature') => string

/** 2026-10-03 → 03/10/2026, as the template wrote it. */
export function ukDate(iso: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso)
  return m ? `${m[3]}/${m[2]}/${m[1]}` : iso
}

export function subjectFor(c: { test?: EmailContent['test'] }): string {
  return c.test ? `[TEST] ${SUBJECT}` : SUBJECT
}

function attachmentLines(c: EmailContent): string[] {
  const lines: string[] = []
  for (const k of ATTACHMENT_ORDER) {
    if (!c.attachments.includes(k)) continue
    if (k === 'log')      lines.push(`Control Centre Incident Log 24 hour (Including 7 Day Look ahead):  East Midlands Route ${ukDate(c.logDate)}.`)
    if (k === 'forecast') lines.push('Current weather forecast')
    if (k === 'ccil')     lines.push('Raw CCIL export')
  }
  return lines
}

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

// Colours and fonts are the template's own (Network Rail Sans falls back on
// machines without it). Paragraph spacing uses empty paragraphs, as Outlook did,
// so the email reads the same in Outlook's Word-based renderer.
const NR = `font-family:'Network Rail Sans',Calibri,Arial,sans-serif`
const BLUE = 'color:#174E86'
const P = 'margin:0;'

export function renderHtml(c: EmailContent, img: ImageResolver): string {
  const items = attachmentLines(c)
    .map(l => `<li style="${NR};font-size:11pt;${BLUE};margin:0;">${esc(l).replace('):  ', '):&nbsp; ')}</li>`)
    .join('\n')
  const blank = (style = `${NR};font-size:11pt;${BLUE}`) => `<p style="${P}"><span style="${style}">&nbsp;</span></p>`
  const test = c.test
    ? `<div style="margin:0 0 12px;padding:8px 12px;border:1px solid #f59e0b;background:#fffbeb;font-family:Calibri,Arial,sans-serif;font-size:10pt;color:#92400e;">${esc(c.test.note)}</div>`
    : ''
  return `<!doctype html>
<html><head><meta http-equiv="Content-Type" content="text/html; charset=utf-8"><title>${esc(subjectFor(c))}</title></head>
<body dir="ltr" style="margin:0;padding:12px;background:#ffffff;">
${test}<div style="font-family:Calibri,Arial,sans-serif;text-align:center;color:#000000;margin-left:15pt;font-size:10pt;">OFFICIAL</div>
<br>
<p style="${P}"><img src="${img('banner')}" width="693" height="141" alt="East Midlands Route - Network Readiness Statement" style="display:block;width:693px;max-width:100%;height:auto;border:0;"></p>
${blank()}
<p style="${P}"><span style="${NR};font-size:11pt;${BLUE}">Good Morning&nbsp;from the East Midlands Control Centre in Derby. &nbsp;</span></p>
${blank()}
${blank()}
<p style="${P}"><span style="${NR};font-size:11pt;${BLUE}"><b>Attachments</b></span></p>
${blank()}
<ul style="margin-top:0;margin-bottom:0;${BLUE};">
${items}
</ul>
<p style="${P}"><span style="font-family:Calibri,Arial,sans-serif;font-size:12pt;">&nbsp;</span></p>
<p style="${P}"><span style="font-family:Calibri,Arial,sans-serif;font-size:12pt;">&nbsp;</span></p>
<p style="${P}font-family:Calibri,Arial,sans-serif;font-size:11pt;"><span style="${NR};color:#002060;"><b>Route Control Manager - </b></span><span style="${NR};color:#1F497D;">East Midlands Route</span></p>
<p style="${P}"><span style="${NR};font-size:9pt;color:#002060;">&nbsp;</span></p>
<p style="${P}"><span style="${NR};font-size:9pt;color:#002060;">East Midlands Control Centre, Bateman Street, Derby, DE23 8JQ</span></p>
<p style="${P}"><span style="${NR};font-size:9pt;color:#F79646;"><b>Tel int</b>:</span><span style="${NR};font-size:9pt;">&nbsp;&nbsp; </span><span style="${NR};font-size:9pt;color:#1F497D;">085 52400&nbsp; </span><span style="${NR};font-size:9pt;color:#F79646;"><b>Tel ext</b>:</span><span style="${NR};font-size:9pt;">&nbsp;&nbsp; </span><span style="${NR};font-size:9pt;color:#1F497D;">01332 442400</span></p>
<p style="${P}"><span style="${NR};font-size:9pt;color:#F79646;"><b>Email</b>:</span><span style="${NR};font-size:9pt;">&nbsp;&nbsp;&nbsp;&nbsp; </span><span style="${NR};font-size:9pt;"><a href="mailto:Control.Derby@networkrail.co.uk" style="color:#467886;"><u>Control.Derby@networkrail.co.uk</u></a></span></p>
<p style="${P}"><span style="${NR};font-size:9pt;color:#1F497D;">&nbsp;</span></p>
<p style="${P}"><img src="${img('signature')}" width="418" height="98" alt="East Midlands - Putting our passengers and freight customers first" style="display:block;width:418px;max-width:100%;height:auto;border:0;"></p>
</body></html>`
}

export function renderText(c: EmailContent): string {
  const out: string[] = []
  if (c.test) out.push(c.test.note, '')
  out.push('OFFICIAL', '', '', 'Good Morning from the East Midlands Control Centre in Derby.', '', '', 'Attachments', '')
  for (const l of attachmentLines(c)) out.push(`  * ${l}`)
  out.push(
    '', '',
    'Route Control Manager - East Midlands Route', '',
    'East Midlands Control Centre, Bateman Street, Derby, DE23 8JQ',
    'Tel int:   085 52400  Tel ext:   01332 442400',
    'Email:     Control.Derby@networkrail.co.uk',
  )
  return out.join('\n')
}

/** Splits the list into emails of at most `size` BCC addresses each. */
export function batches<T>(list: T[], size: number = BCC_PER_EMAIL): T[][] {
  const out: T[][] = []
  for (let i = 0; i < list.length; i += size) out.push(list.slice(i, i + size))
  return out
}

/** Keeps a filename safe for a mail header while staying recognisable. */
export function safeFilename(name: string, fallback: string): string {
  const base = name.split(/[\\/]/).pop() ?? ''
  const cleaned = base.replace(/[^\w.\- ()&,+]/g, '_').replace(/\s+/g, ' ').trim().slice(0, 150)
  return cleaned || fallback
}

/** Checks a file's name and leading bytes against what that attachment must be. */
export function checkAttachment(kind: AttachmentKind, name: string, head: Uint8Array): string | null {
  const rule = ATTACHMENT_RULES[kind]
  if (!name.toLowerCase().endsWith(rule.ext)) return `${rule.label}: "${name}" is not a ${rule.ext} file.`
  if (!rule.magic.every((b, i) => head[i] === b)) return `${rule.label}: "${name}" is not a valid ${rule.ext} file.`
  return null
}
