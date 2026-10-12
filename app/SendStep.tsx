'use client'

// ─── Step 5: Send ─────────────────────────────────────────────────────────────
// After the log is generated and checked, emails it to the distribution list
// through Resend: To the control mailbox, the list by BCC, with the log PDF,
// the forecast PDF and the CCIL export that were dropped into DLog2 attached.
// A test send to one address is always available; a live send needs the
// sender's name and a confirmation, and is refused in Test Mode.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  AlertCircle, AlertTriangle, Check, ChevronDown, ChevronRight, ExternalLink, FileText, FlaskConical,
  Loader2, Mail, Paperclip, RefreshCw, Send, Users,
} from 'lucide-react'
import type { LogState } from '@/lib/types'
import { withBase } from '@/lib/basePath'
import {
  getSourceFiles, setSourceFile, subscribeSourceFiles, readSenderName, writeSenderName,
  fetchDistributionStatus, sendDailyLog, previewUrl, DistributionStatus, PublicSend, SendResult,
} from '@/lib/distribution/client'
import {
  AttachmentKind, ATTACHMENT_ORDER, ATTACHMENT_RULES, MAX_TOTAL_BYTES, BCC_PER_EMAIL, SUBJECT, ukDate,
} from '@/lib/distribution/emailTemplate'

function cn(...cls: (string | false | undefined | null)[]) {
  return cls.filter(Boolean).join(' ')
}

const kb = (n: number) => (n >= 1048576 ? `${(n / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`)
const hhmm = (iso: string) => new Date(iso).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/London' })
const isTestPdf = (f?: File) => !!f && /_TEST\.pdf$/i.test(f.name)

const ROW_LABEL: Record<AttachmentKind, string> = {
  log: 'Daily log PDF (generated)',
  forecast: 'Route 7 Day Forecast PDF',
  ccil: 'CCIL export (.docx)',
}

function useSourceFiles() {
  const [files, setFiles] = useState(getSourceFiles)
  useEffect(() => subscribeSourceFiles(() => setFiles(getSourceFiles())), [])
  return files
}

export function SendStep({ log, onBack, testMode }: { log: LogState; onBack: () => void; testMode: boolean }) {
  const files = useSourceFiles()
  const [name, setName] = useState('')
  const [testTo, setTestTo] = useState('')
  const [status, setStatus] = useState<DistributionStatus | null>(null)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState<'test' | 'live' | null>(null)
  const [result, setResult] = useState<SendResult | null>(null)
  const [confirming, setConfirming] = useState(false)
  const [again, setAgain] = useState(false)
  const [allowMissing, setAllowMissing] = useState(false)
  const [showPreview, setShowPreview] = useState(true)
  const [fileError, setFileError] = useState('')

  // Name and test address are remembered per browser.
  useEffect(() => {
    setName(readSenderName())
    setTestTo(readTestTo())
  }, [])

  const refresh = useCallback(async () => {
    if (!log.date) return
    setLoading(true)
    try { setStatus(await fetchDistributionStatus(log.date)) }
    catch (e: any) { setStatus(null); setResult({ ok: false, mode: 'test', error: e?.message || 'Could not reach the server' }) }
    finally { setLoading(false) }
  }, [log.date])
  useEffect(() => { refresh() }, [refresh])

  // The log PDF as a link the operator can open to check it once more.
  const logUrl = useMemo(() => (files.log ? URL.createObjectURL(files.log) : null), [files.log])
  useEffect(() => () => { if (logUrl) URL.revokeObjectURL(logUrl) }, [logUrl])

  const kinds = ATTACHMENT_ORDER.filter(k => files[k])
  const missing = (['forecast', 'ccil'] as AttachmentKind[]).filter(k => !files[k])
  const total = kinds.reduce((s, k) => s + (files[k]?.size ?? 0), 0)
  const tooBig = total > MAX_TOTAL_BYTES
  const cfg = status?.config
  const active = status?.activeCount ?? 0
  const emails = Math.ceil(active / BCC_PER_EMAIL)
  const liveSends = (status?.sends ?? []).filter(s => !s.isTest)
  const lastLive = liveSends[0] as PublicSend | undefined
  const resumable = lastLive && (lastLive.status === 'partial' || lastLive.status === 'failed' ||
    (lastLive.status === 'sending' && Date.now() - new Date(lastLive.createdAt).getTime() > 5 * 60_000)) ? lastLive : undefined
  // Sent, or part-sent: either way a fresh live send needs "send again".
  const alreadySent = liveSends.some(s => s.status === 'sent' || s.status === 'partial')

  const pick = (kind: AttachmentKind, f: File | undefined) => {
    setFileError('')
    if (!f) return
    if (!f.name.toLowerCase().endsWith(ATTACHMENT_RULES[kind].ext)) { setFileError(`${ROW_LABEL[kind]}: choose a ${ATTACHMENT_RULES[kind].ext} file.`); return }
    setSourceFile(kind, f)
  }

  const send = async (mode: 'test' | 'live', resumeId?: number) => {
    setBusy(mode); setResult(null)
    if (name) writeSenderName(name)
    if (mode === 'test' && testTo) writeTestTo(testTo)
    try {
      const r = await sendDailyLog({
        mode, logDate: log.date, sentBy: name, testTo: mode === 'test' ? testTo : undefined,
        again: mode === 'live' && again, resumeId, files: Object.fromEntries(kinds.map(k => [k, files[k]!])),
      })
      setResult(r)
    } catch (e: any) {
      setResult({ ok: false, mode, error: e?.message || 'Send failed' })
    } finally {
      setBusy(null); setConfirming(false)
      refresh()
    }
  }

  const liveBlock =
    testMode ? 'Test Mode is on: only test sends are possible.'
    : !files.log ? 'Generate the log first.'
    : isTestPdf(files.log) ? 'This log was built in Test Mode. Turn Test Mode off and generate it again.'
    : !status ? 'Checking the email set-up…'
    : !cfg?.ready ? 'Sending is not set up on the host (see above).'
    : !name.trim() ? 'Enter your name.'
    : active === 0 ? 'The distribution list has no active addresses.'
    : tooBig ? 'The attachments are over the size limit.'
    : missing.length && !allowMissing ? `Attach the ${missing.map(k => ROW_LABEL[k]).join(' and ')}, or tick to send without.`
    : alreadySent && !again ? 'Already sent for this log date: tick "send again" to send it a second time.'
    : null
  const testBlock =
    !files.log ? 'Generate the log first.'
    : !status ? 'Checking the email set-up…'
    : !cfg?.resend ? 'Sending is not set up on the host (see above).'
    : !/^\S+@\S+\.\S+$/.test(testTo.trim()) ? 'Enter an address for the test.'
    : tooBig ? 'The attachments are over the size limit.'
    : null

  return (
    <div className="max-w-2xl mx-auto space-y-6">
      <div>
        <h2 className="text-xl font-semibold text-white mb-1">Send to Distribution</h2>
        <p className="text-sm text-[#7A8BA8]">
          Check the generated log, then email it with the forecast and the CCIL export. The list goes by BCC, so nobody can reply to all.
        </p>
      </div>

      {testMode && (
        <div className="flex items-start gap-3 p-4 rounded bg-[rgba(243,156,18,0.12)] border border-[rgba(243,156,18,0.5)]">
          <FlaskConical size={16} className="text-amber-400 mt-0.5 shrink-0" />
          <p className="text-amber-300 text-sm">Test Mode is on. You can send a test to one address; sending to the distribution list is switched off.</p>
        </div>
      )}

      {/* Host set-up */}
      {loading && !status ? (
        <div className="card p-4 flex items-center gap-2 text-sm text-[#7A8BA8]"><Loader2 size={14} className="animate-spin" /> Checking the email set-up…</div>
      ) : cfg && !cfg.ready ? (
        <div className="p-4 rounded bg-[rgba(192,57,43,0.1)] border border-[rgba(192,57,43,0.3)] space-y-1">
          <p className="text-red-400 text-sm font-semibold flex items-center gap-2"><AlertCircle size={14} /> Email sending is not set up on this deployment</p>
          <ul className="text-xs text-[#C9A0A0] list-disc pl-5 space-y-0.5">
            {!cfg.resend && <li><span className="font-mono">RESEND_API_KEY</span> is not set.</li>}
            {!cfg.database && <li><span className="font-mono">SUPABASE_SERVICE_ROLE_KEY</span> is not set (the list is service-role only).</li>}
          </ul>
        </div>
      ) : null}
      {status?.error && cfg?.ready && (
        <div className="p-3 rounded bg-[rgba(192,57,43,0.1)] border border-[rgba(192,57,43,0.3)] text-red-400 text-xs">{status.error}</div>
      )}

      {/* Already sent / part-sent */}
      {lastLive && (
        <div className={cn('p-4 rounded border space-y-2',
          lastLive.status === 'sent' ? 'bg-[rgba(39,174,96,0.08)] border-[rgba(39,174,96,0.35)]' : 'bg-[rgba(243,156,18,0.1)] border-[rgba(243,156,18,0.45)]')}>
          <p className={cn('text-sm font-semibold flex items-center gap-2', lastLive.status === 'sent' ? 'text-green-400' : 'text-amber-300')}>
            {lastLive.status === 'sent' ? <Check size={14} /> : <AlertTriangle size={14} />}
            {lastLive.status === 'sent'
              ? `Sent for ${ukDate(log.date)} at ${hhmm(lastLive.finishedAt ?? lastLive.createdAt)}${lastLive.sentBy ? ` by ${lastLive.sentBy}` : ''}`
              : `A send for ${ukDate(log.date)} stopped part-way (${lastLive.status})`}
          </p>
          <p className="text-xs text-[#7A8BA8]">
            {lastLive.sentCount} of {lastLive.recipientCount} addresses reached in {lastLive.emails} email{lastLive.emails === 1 ? '' : 's'}.
            {lastLive.error && <span className="text-red-400"> {lastLive.error}</span>}
            {liveSends.length > 1 && ` ${liveSends.length} live sends for this date in all.`}
          </p>
          {resumable && (
            <button onClick={() => send('live', resumable.id)} disabled={!!busy || !!(liveBlock && !liveBlock.startsWith('Already sent'))}
              title={liveBlock ?? undefined}
              className="px-3 py-1.5 text-xs font-semibold rounded bg-[#E05206] text-white hover:bg-[#c4480a] disabled:opacity-50 inline-flex items-center gap-2">
              {busy === 'live' ? <Loader2 size={12} className="animate-spin" /> : <RefreshCw size={12} />}
              Send to the {lastLive.recipientCount - lastLive.sentCount} addresses not yet reached
            </button>
          )}
        </div>
      )}

      {/* Attachments */}
      <div className="card p-4 space-y-3">
        <p className="text-xs text-[#7A8BA8] font-semibold uppercase tracking-wider flex items-center gap-2"><Paperclip size={12} /> Attachments</p>
        {(['log', 'forecast', 'ccil'] as AttachmentKind[]).map(kind => (
          <AttachmentRow key={kind} kind={kind} file={files[kind]} logUrl={kind === 'log' ? logUrl : null}
            onPick={f => pick(kind, f)} onGenerate={onBack} />
        ))}
        {fileError && <p className="text-red-400 text-xs">{fileError}</p>}
        <p className={cn('text-[11px]', tooBig ? 'text-red-400' : 'text-[#4A5A72]')}>
          {kb(total)} in all{tooBig ? ` — over the ${MAX_TOTAL_BYTES / 1048576} MB limit` : ''}. Files stay in this page only; a reload clears them.
        </p>
        {missing.length > 0 && files.log && !testMode && (
          <label className="flex items-start gap-2 text-xs text-amber-300 cursor-pointer">
            <input type="checkbox" checked={allowMissing} onChange={e => setAllowMissing(e.target.checked)} className="mt-0.5" />
            Send to the list without the {missing.map(k => ROW_LABEL[k]).join(' and ')}
          </label>
        )}
      </div>

      {/* The email */}
      <div className="card p-4 space-y-3">
        <p className="text-xs text-[#7A8BA8] font-semibold uppercase tracking-wider flex items-center gap-2"><Mail size={12} /> Email</p>
        <dl className="grid grid-cols-[auto,1fr] gap-x-4 gap-y-1 text-xs">
          <dt className="text-[#7A8BA8]">From</dt><dd className="text-white break-all">{cfg?.from ?? '—'}</dd>
          <dt className="text-[#7A8BA8]">To</dt><dd className="text-white break-all">{cfg?.to ?? '—'}</dd>
          <dt className="text-[#7A8BA8]">BCC</dt>
          <dd className="text-white">
            {status?.activeCount != null ? `${active} addresses on the distribution list` : '—'}
            {active > BCC_PER_EMAIL && <span className="text-[#7A8BA8]"> · sent as {emails} emails of up to {BCC_PER_EMAIL}</span>}
            {' '}<a href={withBase('/distribution')} target="_blank" rel="noopener noreferrer" className="text-[#4A6FA5] hover:text-white underline underline-offset-2 whitespace-nowrap">manage <ExternalLink size={10} className="inline" /></a>
          </dd>
          <dt className="text-[#7A8BA8]">Reply to</dt><dd className="text-white break-all">{cfg?.replyTo ?? '—'}</dd>
          <dt className="text-[#7A8BA8]">Subject</dt><dd className="text-white">{SUBJECT}</dd>
        </dl>
        <button onClick={() => setShowPreview(v => !v)} className="text-xs text-[#4A6FA5] hover:text-white inline-flex items-center gap-1">
          {showPreview ? <ChevronDown size={12} /> : <ChevronRight size={12} />} {showPreview ? 'Hide' : 'Show'} the email
        </button>
        {showPreview && log.date && (
          <div className="rounded border border-[rgba(74,111,165,0.3)] bg-white overflow-hidden">
            <iframe title="Email preview" src={previewUrl(log.date, kinds.length ? kinds : ['log'])} sandbox=""
              className="w-full h-[560px] block" />
          </div>
        )}
      </div>

      {/* Sender, test and live send */}
      <div className="card p-4 space-y-4">
        <div className="space-y-1">
          <label className="text-xs text-[#7A8BA8] font-semibold uppercase tracking-wider" htmlFor="sender-name">Your name</label>
          <input id="sender-name" value={name} onChange={e => setName(e.target.value)} onBlur={() => writeSenderName(name)} maxLength={80}
            placeholder="Recorded against the send"
            className="w-full bg-[#0A0F1E] border border-[rgba(74,111,165,0.3)] rounded px-3 py-2 text-sm text-white focus:outline-none focus:border-[#E05206]" />
        </div>

        <div className="space-y-1">
          <label className="text-xs text-[#7A8BA8] font-semibold uppercase tracking-wider" htmlFor="test-to">Test send</label>
          <div className="flex gap-2 flex-wrap sm:flex-nowrap">
            <input id="test-to" type="email" value={testTo} onChange={e => setTestTo(e.target.value)} placeholder="your.name@networkrail.co.uk"
              className="flex-1 min-w-0 bg-[#0A0F1E] border border-[rgba(74,111,165,0.3)] rounded px-3 py-2 text-sm text-white focus:outline-none focus:border-[#E05206]" />
            <button onClick={() => send('test')} disabled={!!busy || !!testBlock} title={testBlock ?? undefined}
              className="px-4 py-2 border border-[rgba(74,111,165,0.5)] text-white text-sm rounded hover:border-[#E05206] disabled:opacity-50 inline-flex items-center gap-2 shrink-0">
              {busy === 'test' ? <Loader2 size={14} className="animate-spin" /> : <FlaskConical size={14} />} Send test
            </button>
          </div>
          <p className="text-[11px] text-[#4A5A72]">{testBlock ?? 'Sends the same email, marked TEST, to this one address only.'}</p>
        </div>

        <div className="pt-3 border-t border-[rgba(74,111,165,0.15)] space-y-2">
          {alreadySent && !testMode && (
            <label className="flex items-start gap-2 text-xs text-amber-300 cursor-pointer">
              <input type="checkbox" checked={again} onChange={e => { setAgain(e.target.checked); setConfirming(false) }} className="mt-0.5" />
              Send again: this log has already gone to the list (in full or in part) — everyone gets the current files
            </label>
          )}
          {!confirming ? (
            <button onClick={() => setConfirming(true)} disabled={!!busy || !!liveBlock} title={liveBlock ?? undefined}
              className={cn('w-full py-3 text-white text-sm font-bold rounded flex items-center justify-center gap-3 transition-all',
                (busy || liveBlock) ? 'bg-[#4A6FA5] cursor-not-allowed opacity-70' : 'bg-[#E05206] hover:bg-[#c44804]')}>
              <Users size={16} /> Send to distribution list{active ? ` (${active}, BCC)` : ''}
            </button>
          ) : (
            <div className="p-4 rounded border border-[#E05206] bg-[rgba(224,82,6,0.08)] space-y-3">
              <p className="text-sm text-white">
                Email the {ukDate(log.date)} log to <strong>{active}</strong> addresses by BCC, To {cfg?.to}, as {emails} email{emails === 1 ? '' : 's'},
                with {kinds.length} attachment{kinds.length === 1 ? '' : 's'}?
              </p>
              <div className="flex gap-2">
                <button onClick={() => send('live')} disabled={!!busy}
                  className="flex-1 py-2 bg-[#E05206] text-white text-sm font-bold rounded hover:bg-[#c44804] disabled:opacity-60 inline-flex items-center justify-center gap-2">
                  {busy === 'live' ? <><Loader2 size={14} className="animate-spin" /> Sending…</> : <><Send size={14} /> Send now</>}
                </button>
                <button onClick={() => setConfirming(false)} disabled={!!busy}
                  className="px-4 py-2 border border-[rgba(74,111,165,0.4)] text-[#7A8BA8] text-sm rounded hover:text-white">Cancel</button>
              </div>
            </div>
          )}
          {liveBlock && !confirming && <p className="text-center text-[11px] text-[#7A8BA8]">{liveBlock}</p>}
        </div>
      </div>

      {result && (
        result.ok ? (
          <div className="flex items-start gap-3 p-4 rounded bg-[rgba(39,174,96,0.1)] border border-[rgba(39,174,96,0.3)]">
            <Check size={16} className="text-green-400 mt-0.5 shrink-0" />
            <p className="text-green-400 text-sm">
              {result.mode === 'test'
                ? `Test sent to ${testTo}. Check it arrived and looks right before sending to the list.`
                : `Sent to ${result.sent} of ${result.total} addresses in ${result.emails} email${result.emails === 1 ? '' : 's'}.`}
            </p>
          </div>
        ) : (
          <div className="flex items-start gap-3 p-4 rounded bg-[rgba(192,57,43,0.1)] border border-[rgba(192,57,43,0.3)]">
            <AlertCircle size={16} className="text-red-400 mt-0.5 shrink-0" />
            <div className="text-sm text-red-400 space-y-1">
              <p>{result.error || 'Send failed.'}</p>
              {result.status === 'partial' && <p className="text-xs">{result.sent} of {result.total} addresses were reached. Use the resume button above to send to the rest.</p>}
            </div>
          </div>
        )
      )}

      <button onClick={onBack} className="w-full py-2.5 border border-[rgba(74,111,165,0.4)] text-[#7A8BA8] text-sm rounded hover:text-white transition-colors">← Back to Generate</button>
    </div>
  )
}

function AttachmentRow({ kind, file, logUrl, onPick, onGenerate }: {
  kind: AttachmentKind
  file?: File
  logUrl: string | null
  onPick: (f: File | undefined) => void
  onGenerate: () => void
}) {
  const ref = useRef<HTMLInputElement>(null)
  const test = kind === 'log' && isTestPdf(file)
  return (
    <div className={cn('flex items-start gap-3 p-2 rounded border',
      file && !test ? 'border-[rgba(39,174,96,0.35)]' : 'border-[rgba(243,156,18,0.45)]')}>
      <FileText size={16} className={cn('mt-0.5 shrink-0', file && !test ? 'text-[#27AE60]' : 'text-amber-400')} />
      <div className="min-w-0 flex-1">
        <p className="text-xs text-[#7A8BA8]">{ROW_LABEL[kind]}</p>
        {file
          ? <p className="text-sm text-white truncate">{file.name} <span className="text-[#7A8BA8] text-xs">· {kb(file.size)}</span></p>
          : <p className="text-xs text-amber-300">{kind === 'log' ? 'Not generated in this session.' : 'Not loaded in this session.'}</p>}
        {test && <p className="text-xs text-amber-300">Built in Test Mode: test sends only.</p>}
      </div>
      <div className="flex items-center gap-2 shrink-0">
        {kind === 'log' && logUrl && (
          <a href={logUrl} target="_blank" rel="noopener noreferrer" className="text-xs text-[#4A6FA5] hover:text-white underline underline-offset-2">Open</a>
        )}
        {kind === 'log' ? (
          !file && <button onClick={onGenerate} className="text-xs text-[#E05206] hover:text-white underline underline-offset-2">Generate</button>
        ) : (
          <>
            <input ref={ref} type="file" accept={ATTACHMENT_RULES[kind].ext} className="hidden"
              onChange={e => { onPick(e.target.files?.[0]); e.target.value = '' }} />
            <button onClick={() => ref.current?.click()} className="text-xs text-[#4A6FA5] hover:text-white underline underline-offset-2">
              {file ? 'Replace' : 'Choose file'}
            </button>
          </>
        )}
      </div>
    </div>
  )
}

const TEST_TO_KEY = 'dlog2:distribution-test-to'
function readTestTo(): string { try { return window.localStorage.getItem(TEST_TO_KEY) ?? '' } catch { return '' } }
function writeTestTo(v: string): void { try { window.localStorage.setItem(TEST_TO_KEY, v.trim()) } catch { /* private mode */ } }
