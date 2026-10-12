// ─── /api/distribution/send ───────────────────────────────────────────────────
// Sends the daily log email through Resend. Called from the Send step once the
// operator has checked the generated log.
//
// POST multipart/form-data
//   mode      'test' | 'live'
//   logDate   YYYY-MM-DD
//   sentBy    operator name (stamped on the send record)
//   testTo    test sends only: the one address to send to
//   again     '1' to send a live log a second time for the same date
//   resumeId  id of a live send that stopped part-way: send to the rest only
//   log       the generated log PDF (required)
//   forecast  the Route 7 Day Forecast PDF dropped into DLog2 (optional)
//   ccil      the CCIL .docx export dropped into DLog2 (optional)
//
// Live: To is the old RCM mailbox (it receives every email of the batch); the
// list, the control mailbox included, goes by BCC, 49 per email
// (Resend allows 50 addresses per email). Each email that Resend accepts is
// recorded before the next goes, so a failure part-way can be resumed without
// sending anyone a second copy. A second live send for the same log date is
// refused unless `again` is set. A log built in Test Mode (_TEST file) can
// only be sent as a test.

import { NextRequest, NextResponse } from 'next/server'
import { createHash } from 'crypto'
import { emailKey, isValidEmail } from '@/lib/distribution/addresses'
import {
  AttachmentKind, FILE_ORDER, ATTACHMENT_RULES, MAX_TOTAL_BYTES, BCC_PER_EMAIL,
  renderHtml, renderText, subjectFor, batches, safeFilename, checkAttachment, logDateInFilename, ukDate,
} from '@/lib/distribution/emailTemplate'
import { BANNER, SIGNATURE } from '@/lib/distribution/emailImages'
import {
  config, db, activeAddresses, sendsFor, getSend, createSend, updateSend, resendSend,
  publicSend, DistributionError, ResendAttachment, SendRecord,
} from '@/lib/distribution/server'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 60

/** A send still marked "sending" after this long has died part-way. */
const STALE_MS = 5 * 60_000

function fail(message: string, status: number, extra: Record<string, unknown> = {}) {
  return NextResponse.json({ ok: false, error: message, ...extra }, { status })
}

function isLiveInProgressOrDone(s: SendRecord): boolean {
  if (s.isTest) return false
  if (s.status === 'sent' || s.status === 'partial') return true
  return s.status === 'sending' && Date.now() - new Date(s.createdAt).getTime() < STALE_MS
}

export async function POST(req: NextRequest) {
  const c = config()
  if (!c.resendKey) return fail('Sending is not set up: RESEND_API_KEY is not set on the host.', 503)

  let form: FormData
  try { form = await req.formData() }
  catch { return fail('The request could not be read (attachments too large?).', 400) }

  const str = (k: string) => { const v = form.get(k); return typeof v === 'string' ? v.trim() : '' }
  const mode = str('mode') === 'live' ? 'live' : 'test'
  const logDate = str('logDate')
  const sentBy = str('sentBy').slice(0, 80) || null
  if (!/^\d{4}-\d{2}-\d{2}$/.test(logDate)) return fail('The log date is missing.', 400)
  if (mode === 'live' && !sentBy) return fail('Enter your name before sending to the list.', 400)

  // ── Attachments ──────────────────────────────────────────────────────────────
  const files: { kind: AttachmentKind; filename: string; bytes: Buffer }[] = []
  let total = 0
  for (const kind of FILE_ORDER) {
    const f = form.get(kind)
    if (!f || typeof f === 'string') continue
    const bytes = Buffer.from(await f.arrayBuffer())
    if (!bytes.length) continue
    const problem = checkAttachment(kind, f.name, bytes.subarray(0, 8))
    if (problem) return fail(problem, 400)
    total += bytes.length
    files.push({ kind, filename: safeFilename(f.name, `${kind}${ATTACHMENT_RULES[kind].ext}`), bytes })
  }
  if (!files.some(f => f.kind === 'log')) return fail('The generated log PDF is missing.', 400)
  if (total > MAX_TOTAL_BYTES) return fail(`The attachments come to ${(total / 1048576).toFixed(1)} MB; the limit is ${MAX_TOTAL_BYTES / 1048576} MB.`, 413)
  const logFile = files.find(f => f.kind === 'log')!
  // The body's date and the PDF are both the log's 06:00 → 06:00 day; refuse a
  // send where they disagree (e.g. a PDF left over from another day's build).
  const pdfDate = logDateInFilename(logFile.filename)
  if (pdfDate && pdfDate !== logDate) {
    return fail(`The log PDF is for ${ukDate(pdfDate)} but this log is ${ukDate(logDate)}. Generate the log again.`, 400)
  }
  if (mode === 'live' && /_TEST\.pdf$/i.test(logFile.filename)) {
    return fail('This log was built in Test Mode. Turn Test Mode off and generate it again before sending to the list.', 400)
  }

  const kinds = files.map(f => f.kind)
  const attachments: ResendAttachment[] = [
    ...files.map(f => ({ filename: f.filename, content: f.bytes.toString('base64'), content_type: ATTACHMENT_RULES[f.kind].contentType })),
    ...[BANNER, SIGNATURE].map(i => ({ filename: i.filename, content: i.base64, content_type: i.contentType, content_id: i.cid })),
  ]
  const cid = (key: 'banner' | 'signature') => `cid:${key === 'banner' ? BANNER.cid : SIGNATURE.cid}`

  try {
    const sb = db()

    // ── Test: one address, To only ────────────────────────────────────────────
    if (mode === 'test') {
      const to = str('testTo')
      if (!isValidEmail(to)) return fail('Enter a valid address for the test.', 400)
      const listed = (await activeAddresses(sb)).length
      const content = { logDate, attachments: kinds, test: { note: `TEST SEND to ${to} only. The live send goes To ${c.to} with ${listed} addresses by BCC.` } }
      const subject = subjectFor(content)
      const rec = await createSend(sb, { logDate, isTest: true, sentBy, subject, toAddress: to, attachments: files.map(f => f.filename), recipientCount: 1 })
      try {
        const id = await resendSend(c.resendKey, {
          from: c.from, to: [to], reply_to: c.replyTo, subject,
          html: renderHtml(content, cid), text: renderText(content), attachments,
          tags: [{ name: 'app', value: 'dlog2' }, { name: 'mode', value: 'test' }],
        }, `dlog2-${rec.id}-test`)
        await updateSend(sb, rec.id, { status: 'sent', sentTo: [to], resendIds: [id], finished: true })
        return NextResponse.json({ ok: true, mode, sendId: rec.id, status: 'sent', sent: 1, total: 1, emails: 1 })
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e)
        await updateSend(sb, rec.id, { status: 'failed', error: msg, finished: true })
        return fail(msg, 502)
      }
    }

    // ── Live: the list by BCC ─────────────────────────────────────────────────
    const listed = await activeAddresses(sb)
    if (!listed.length) return fail('The distribution list has no active addresses.', 400)

    const resumeId = Number(str('resumeId')) || null
    let rec: SendRecord
    let pending: string[]
    if (resumeId) {
      const prev = await getSend(sb, resumeId)
      if (!prev || prev.isTest || prev.logDate !== logDate) return fail('That send cannot be resumed for this log.', 400)
      const stale = prev.status === 'sending' && Date.now() - new Date(prev.createdAt).getTime() >= STALE_MS
      if (!(prev.status === 'partial' || prev.status === 'failed' || stale)) return fail(`That send is ${prev.status}; nothing to resume.`, 409)
      const done = new Set(prev.sentTo.map(emailKey))
      pending = listed.filter(e => !done.has(emailKey(e)))
      rec = prev
      await updateSend(sb, rec.id, { status: 'sending', error: null, recipientCount: prev.sentTo.length + pending.length, sentBy })
    } else {
      const earlier = (await sendsFor(sb, logDate)).filter(isLiveInProgressOrDone)
      if (earlier.length && str('again') !== '1') {
        return fail('This log has already been sent to the distribution list.', 409, { previous: earlier.map(publicSend) })
      }
      rec = await createSend(sb, {
        logDate, isTest: false, sentBy, subject: subjectFor({ test: null }), toAddress: c.to,
        attachments: files.map(f => f.filename), recipientCount: listed.length,
      })
      // Two desks pressing Send together: the earlier record wins.
      if (str('again') !== '1') {
        const race = (await sendsFor(sb, logDate)).filter(s => s.id < rec.id && isLiveInProgressOrDone(s))
        if (race.length) {
          await updateSend(sb, rec.id, { status: 'failed', error: 'Another send for this log started first.', finished: true })
          return fail('Another send for this log started a moment ago.', 409, { previous: race.map(publicSend) })
        }
      }
      pending = listed
    }

    const content = { logDate, attachments: kinds }
    const base = {
      from: c.from, to: [c.to], reply_to: c.replyTo, subject: subjectFor({ test: null }),
      html: renderHtml(content, cid), text: renderText(content), attachments,
      tags: [{ name: 'app', value: 'dlog2' }, { name: 'mode', value: 'live' }],
    }
    const sentTo = [...rec.sentTo]
    const resendIds = [...rec.resendIds]
    const groups = batches(pending, BCC_PER_EMAIL)
    try {
      for (let i = 0; i < groups.length; i++) {
        if (i > 0) await new Promise(r => setTimeout(r, 600)) // inside Resend's rate limit
        const bcc = groups[i]
        const idem = `dlog2-${rec.id}-${createHash('sha256').update(bcc.map(emailKey).join(',')).digest('hex').slice(0, 24)}`
        resendIds.push(await resendSend(c.resendKey, { ...base, bcc }, idem))
        sentTo.push(...bcc)
        await updateSend(sb, rec.id, { sentTo, resendIds })
      }
      await updateSend(sb, rec.id, { status: 'sent', error: null, finished: true })
      return NextResponse.json({ ok: true, mode, sendId: rec.id, status: 'sent', sent: sentTo.length, total: rec.sentTo.length + pending.length, emails: resendIds.length })
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      const status = sentTo.length ? 'partial' : 'failed'
      await updateSend(sb, rec.id, { status, error: msg, finished: true })
      return fail(msg, 502, { sendId: rec.id, status, sent: sentTo.length, total: rec.sentTo.length + pending.length })
    }
  } catch (e) {
    const status = e instanceof DistributionError ? e.status : 500
    return fail(e instanceof Error ? e.message : String(e), status)
  }
}
