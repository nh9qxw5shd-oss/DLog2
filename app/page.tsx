'use client'

import { useState, useCallback, useRef, useEffect } from 'react'
import {
  Upload, FileText, Users, AlertTriangle, ChevronRight,
  Plus, Trash2, Check, X, Download, Eye, RefreshCw,
  Loader2, AlertCircle, Activity, Flame, Shield, Pencil
} from 'lucide-react'
import {
  LogState, Incident, RosterData, ShiftSlot, Severity,
  DEFAULT_ROSTER, CATEGORY_CONFIG, IncidentCategory
} from '@/lib/types'
import { parseCCILText, extractPeriod, extractCreatedBy } from '@/lib/ccilParser'
import { generatePDF } from '@/lib/pdfGenerator'
import { parseWeatherPDF, deriveDaysFromDate } from '@/lib/weatherParser'
import type { FiveDayWeather, HazardLevel } from '@/lib/types'

// ─── Hydration-safe clock ─────────────────────────────────────────────────────
// Must NOT use Date on first render — server/client will differ → #425

function LiveClock() {
  const [display, setDisplay] = useState('')
  useEffect(() => {
    const fmt = () => {
      const d = new Date()
      const hh = d.getHours().toString().padStart(2, '0')
      const mm = d.getMinutes().toString().padStart(2, '0')
      const day = d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })
      setDisplay(`${hh}:${mm} · ${day}`)
    }
    fmt()
    const t = setInterval(fmt, 30000)
    return () => clearInterval(t)
  }, [])
  return <span className="text-xs text-[#7A8BA8] font-mono">{display}</span>
}

// ─── Utilities ────────────────────────────────────────────────────────────────

function cn(...cls: (string | false | undefined | null)[]) {
  return cls.filter(Boolean).join(' ')
}

function sevBadge(sev: string) {
  const m: Record<string, string> = {
    CRITICAL: 'badge-critical', HIGH: 'badge-high',
    MEDIUM: 'badge-medium', LOW: 'badge-low', INFO: 'badge-info',
  }
  return `inline-flex items-center px-2 py-0.5 rounded text-xs font-mono font-semibold ${m[sev] || 'badge-info'}`
}

// ─── Default log — NO Date() at module scope ──────────────────────────────────

const BLANK_LOG: LogState = {
  date: '',          // filled in after mount via useEffect
  period: '',
  controlCentre: 'East Midlands Control Centre (EMCC)',
  roster: DEFAULT_ROSTER,
  incidents: [],
  lookAheadNotes: { risks: 'Nil', toc: 'Nil', foc: 'Nil' },
  status: 'empty',
}

// ─── Step indicator ───────────────────────────────────────────────────────────

const STEPS = [
  { id: 1, label: 'Upload Log',    icon: Upload   },
  { id: 2, label: 'Roster Entry',  icon: Users    },
  { id: 3, label: 'Review',        icon: Eye      },
  { id: 4, label: 'Generate PDF',  icon: Download },
]

function StepBar({ current }: { current: number }) {
  return (
    <div className="flex items-center">
      {STEPS.map((step, i) => {
        const Icon = step.icon
        const status = current > step.id ? 'complete' : current === step.id ? 'active' : 'inactive'
        return (
          <div key={step.id} className="flex items-center">
            <div className={cn(
              'flex items-center gap-2 px-4 py-2 text-sm font-medium transition-all',
              status === 'active'   && 'bg-[#E05206] text-white',
              status === 'complete' && 'bg-[#27AE60] text-white',
              status === 'inactive' && 'bg-[#131C35] text-[#7A8BA8] border border-[rgba(74,111,165,0.25)]',
            )}>
              <Icon size={14} />
              <span className="hidden sm:inline">{step.label}</span>
              <span className="font-mono text-xs opacity-60">0{step.id}</span>
            </div>
            {i < STEPS.length - 1 && <ChevronRight size={16} className="text-[#4A6FA5]" />}
          </div>
        )
      })}
    </div>
  )
}

// ─── Step 1: Upload ───────────────────────────────────────────────────────────

function UploadStep({ onComplete }: {
  onComplete: (data: Partial<LogState>, rawText: string) => void
}) {
  const [dragging, setDragging] = useState(false)
  const [file, setFile]         = useState<File | null>(null)
  const [parsing, setParsing]   = useState(false)
  const [progress, setProgress] = useState('')
  const [error, setError]       = useState('')
  const inputRef = useRef<HTMLInputElement>(null)

  const htmlToTableText = useCallback((html: string): string => {
    const doc = new DOMParser().parseFromString(html, 'text/html')
    const lines: string[] = []

    doc.querySelectorAll('tr').forEach((row) => {
      const cells = Array.from(row.querySelectorAll('th,td'))
      if (!cells.length) return
      const values = cells.map((cell) => {
        const text = (cell.textContent || '').replace(/\s+/g, ' ').trim()
        const hasBold = !!cell.querySelector('strong, b')
        return hasBold && text ? `**${text}**` : text
      })
      lines.push(`| ${values.join(' | ')} |`)
    })

    return lines.join('\n')
  }, [])

  const process = useCallback(async (f: File) => {
    setFile(f); setError(''); setParsing(true); setProgress('Reading DOCX…')
    try {
      const mammoth    = await import('mammoth')
      const buf        = await f.arrayBuffer()
      const [{ value: htmlText }, { value: rawText }] = await Promise.all([
        mammoth.convertToHtml({ arrayBuffer: buf }),
        mammoth.extractRawText({ arrayBuffer: buf }),
      ])
      const tableText = htmlText ? htmlToTableText(htmlText) : ''
      const parseSource = tableText.trim() ? tableText : rawText
      setProgress('Parsing incidents…')
      const { period, date } = extractPeriod(rawText || parseSource)
      const createdBy  = extractCreatedBy(rawText || parseSource)
      const incidents  = parseCCILText(parseSource)
      setProgress(`Done — ${incidents.length} incidents extracted`)
      onComplete({ period, date, createdBy, incidents, rawLogText: rawText }, rawText)
    } catch (e: any) {
      setError(e.message || 'Parse failed')
      setParsing(false)
      setProgress('')
    }
  }, [htmlToTableText, onComplete])

  const onDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault(); setDragging(false)
    const f = e.dataTransfer.files[0]
    if (f?.name.toLowerCase().endsWith('.docx')) process(f)
    else setError('Please upload a .docx file (CCIL export)')
  }, [process])

  return (
    <div className="max-w-2xl mx-auto space-y-6">
      <div>
        <h2 className="text-xl font-semibold text-white mb-1">Upload CCIL Log Export</h2>
        <p className="text-sm text-[#7A8BA8]">Drop the CCIL .docx export. All processing is local — nothing leaves your browser.</p>
      </div>

      <div
        className={cn('drop-zone rounded-lg p-12 text-center cursor-pointer', dragging && 'dragover')}
        onDragOver={e => { e.preventDefault(); setDragging(true) }}
        onDragLeave={() => setDragging(false)}
        onDrop={onDrop}
        onClick={() => inputRef.current?.click()}
      >
        <input ref={inputRef} type="file" accept=".docx" className="hidden"
          onChange={e => e.target.files?.[0] && process(e.target.files[0])} />

        {parsing ? (
          <div className="space-y-4">
            <Loader2 size={40} className="mx-auto text-[#E05206] animate-spin" />
            <p className="text-[#7A8BA8] text-sm font-mono">{progress}</p>
          </div>
        ) : file ? (
          <div className="space-y-2">
            <FileText size={40} className="mx-auto text-[#27AE60]" />
            <p className="text-white font-medium">{file.name}</p>
            <p className="text-[#7A8BA8] text-xs">{(file.size / 1024).toFixed(1)} KB · {progress}</p>
          </div>
        ) : (
          <div className="space-y-3">
            <Upload size={40} className="mx-auto text-[#4A6FA5]" />
            <p className="text-white font-medium">Drop CCIL .docx here</p>
            <p className="text-[#7A8BA8] text-sm">or click to browse</p>
            <p className="text-xs text-[#4A5A72] font-mono">CCIL EXPORT · DOCX FORMAT ONLY</p>
          </div>
        )}
      </div>

      {error && (
        <div className="flex items-start gap-3 p-4 rounded bg-[rgba(192,57,43,0.1)] border border-[rgba(192,57,43,0.3)]">
          <AlertCircle size={16} className="text-red-400 mt-0.5 shrink-0" />
          <p className="text-red-400 text-sm">{error}</p>
        </div>
      )}

      <div className="card p-4 space-y-3">
        <p className="text-xs text-[#7A8BA8] font-semibold uppercase tracking-wider">Or start blank (manual entry)</p>
        <button
          className="w-full py-2 px-4 border border-[rgba(74,111,165,0.4)] text-[#4A6FA5] text-sm rounded hover:bg-[rgba(74,111,165,0.1)] transition-colors"
          onClick={() => onComplete({}, '')}
        >Start with empty log</button>
      </div>
    </div>
  )
}

// ─── Hazard level helpers ─────────────────────────────────────────────────────

const HAZARD_BG: Record<HazardLevel, string> = {
  GREEN:   'bg-[#27AE60]',
  AWARE:   'bg-[#F1C40F]',
  ADVERSE: 'bg-[#E67E22]',
  EXTREME: 'bg-[#C0392B]',
}
const HAZARD_TEXT: Record<HazardLevel, string> = {
  GREEN:   'text-white',
  AWARE:   'text-[#001F45]',
  ADVERSE: 'text-[#001F45]',
  EXTREME: 'text-white',
}

function HazardBadge({ level, triggers }: { level: HazardLevel; triggers: string[] }) {
  return (
    <div className={`${HAZARD_BG[level]} ${HAZARD_TEXT[level]} rounded px-1 py-0.5 text-center leading-tight`}>
      <div className="text-xs font-bold">{level}</div>
      {triggers.length > 0 && (
        <div className="text-[9px] font-normal opacity-90 mt-0.5">{triggers.join(', ')}</div>
      )}
    </div>
  )
}

// ─── 5 Day Look Ahead config component ───────────────────────────────────────

function FiveDaySection({ log, onChange }: {
  log:      LogState
  onChange: (updates: Partial<LogState>) => void
}) {
  const [parsing,  setParsing]  = useState(false)
  const [error,    setError]    = useState('')
  const [fileName, setFileName] = useState(log.fiveDayWeather ? 'Loaded' : '')
  const inputRef = useRef<HTMLInputElement>(null)

  const weather = log.fiveDayWeather
  const notes   = log.lookAheadNotes

  const updateNote = (key: keyof typeof notes, val: string) =>
    onChange({ lookAheadNotes: { ...notes, [key]: val } })

  const handleFile = async (file: File) => {
    if (!file.name.toLowerCase().endsWith('.pdf')) {
      setError('Please upload a PDF file (Network Rail 5 day forecast)')
      return
    }
    setError(''); setParsing(true); setFileName(file.name)
    try {
      const result = await parseWeatherPDF(file)
      if (!result.eastMidlands.length && !result.londonNorth.length) {
        setError('No East Midlands or London North hazard tables found. Ensure this is the Network Rail LNE & EM 5 day forecast PDF.')
        setParsing(false)
        return
      }
      onChange({ fiveDayWeather: result })
    } catch (e: any) {
      setError(e.message || 'Failed to parse weather PDF')
    } finally {
      setParsing(false)
    }
  }

  const days = weather?.eastMidlands.map(d => d.day) ?? []

  return (
    <div className="card p-4 space-y-4">
      <p className="text-xs text-[#7A8BA8] font-semibold uppercase tracking-wider">5 Day Look Ahead</p>

      {/* ── Weather PDF upload ── */}
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <p className="text-xs text-[#4A5A72]">Weather forecast PDF (NR LNE &amp; EM 5 day)</p>
          {weather && (
            <button
              onClick={() => { onChange({ fiveDayWeather: undefined }); setFileName('') }}
              className="text-xs text-[#4A5A72] hover:text-red-400 transition-colors flex items-center gap-1">
              <X size={11} /> Clear
            </button>
          )}
        </div>

        {!weather ? (
          <div
            className="border border-dashed border-[rgba(74,111,165,0.4)] rounded p-3 text-center cursor-pointer hover:border-[#4A6FA5] transition-colors"
            onClick={() => inputRef.current?.click()}
            onDragOver={e => e.preventDefault()}
            onDrop={e => { e.preventDefault(); const f = e.dataTransfer.files[0]; if (f) handleFile(f) }}
          >
            <input ref={inputRef} type="file" accept=".pdf" className="hidden"
              onChange={e => e.target.files?.[0] && handleFile(e.target.files[0])} />
            {parsing ? (
              <div className="flex items-center justify-center gap-2 text-[#7A8BA8] text-xs">
                <Loader2 size={14} className="animate-spin" /> Parsing weather tables…
              </div>
            ) : (
              <div className="flex items-center justify-center gap-2">
                <FileText size={16} className="text-[#4A6FA5]" />
                <p className="text-[#7A8BA8] text-xs">{fileName || 'Drop forecast PDF or click to browse'}</p>
              </div>
            )}
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-xs border-collapse">
              <thead>
                <tr>
                  <th className="text-left px-2 py-1 text-[#7A8BA8] font-medium w-28" />
                  {days.map(d => (
                    <th key={d} className="text-center px-1 py-1 text-[#7A8BA8] font-medium text-[10px]">{d.slice(0, 3)}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {([
                  { label: 'East Midlands', data: weather.eastMidlands },
                  { label: 'London North',  data: weather.londonNorth  },
                ] as const).map(row => (
                  <tr key={row.label}>
                    <td className="px-2 py-1 text-[#7A8BA8] font-medium whitespace-nowrap text-[11px]">{row.label}</td>
                    {row.data.map((d, i) => (
                      <td key={i} className="px-1 py-1">
                        <HazardBadge level={d.level} triggers={d.triggers} />
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
            {weather.issuedBy && (
              <p className="text-[#4A5A72] text-[10px] font-mono mt-1.5 truncate">Issued: {weather.issuedBy}</p>
            )}
          </div>
        )}

        {error && (
          <div className="flex items-start gap-2 p-2 rounded bg-[rgba(192,57,43,0.1)] border border-[rgba(192,57,43,0.3)]">
            <AlertCircle size={12} className="text-red-400 mt-0.5 shrink-0" />
            <p className="text-red-400 text-xs">{error}</p>
          </div>
        )}
      </div>

      {/* ── Editable rows ── */}
      <div className="space-y-2">
        <p className="text-xs text-[#4A5A72]">Other rows (applied across all 5 days)</p>
        <div className="grid grid-cols-3 gap-3">
          {([
            { key: 'risks' as const, label: 'Risks' },
            { key: 'toc'   as const, label: 'TOC Operations & Depot' },
            { key: 'foc'   as const, label: 'FOC Operations' },
          ]).map(({ key, label }) => (
            <div key={key}>
              <label className="block text-[10px] text-[#7A8BA8] mb-1 font-medium uppercase tracking-wider">{label}</label>
              <input
                type="text"
                value={notes[key]}
                onChange={e => updateNote(key, e.target.value)}
                className="w-full bg-[#0A0F1E] text-white text-xs px-2 py-1.5 rounded border border-[rgba(74,111,165,0.25)] focus:border-[#E05206] outline-none"
              />
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

// ─── Step 2: Roster ───────────────────────────────────────────────────────────

function RosterStep({ log, onChange, onNext, onBack }: {
  log:      LogState
  onChange: (updates: Partial<LogState>) => void
  onNext:   () => void
  onBack:   () => void
}) {
  const updateSlot = (shift: 'dayShift' | 'nightShift', idx: number, field: keyof ShiftSlot, value: string) => {
    const r = { ...log.roster }
    r[shift] = r[shift].map((s, i) => i === idx ? { ...s, [field]: value } : s)
    onChange({ roster: r })
  }
  const addSlot = (shift: 'dayShift' | 'nightShift') => {
    const r = { ...log.roster }
    r[shift] = [...r[shift], { role: '', name: '', start: '06:00', end: '18:00' }]
    onChange({ roster: r })
  }
  const removeSlot = (shift: 'dayShift' | 'nightShift', idx: number) => {
    const r = { ...log.roster }
    r[shift] = r[shift].filter((_, i) => i !== idx)
    onChange({ roster: r })
  }

  const renderShiftTable = (shift: 'dayShift' | 'nightShift', label: string) => (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-[#4A6FA5] uppercase tracking-wider">{label}</h3>
        <button onClick={() => addSlot(shift)} className="flex items-center gap-1 text-xs text-[#E05206] hover:text-white transition-colors">
          <Plus size={12} /> Add row
        </button>
      </div>
      <div className="card overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-[#0A0F1E]">
              {['ROLE','NAME','FROM','TO',''].map(h => (
                <th key={h} className="text-left px-3 py-2 text-xs text-[#7A8BA8] font-medium">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {log.roster[shift].map((slot, i) => (
              <tr key={i} className={i % 2 === 0 ? '' : 'bg-[rgba(74,111,165,0.05)]'}>
                <td className="px-2 py-1.5 w-28">
                  <input value={slot.role} onChange={e => updateSlot(shift, i, 'role', e.target.value)}
                    className="w-full bg-transparent text-[#4A6FA5] text-xs font-semibold outline-none border-b border-transparent focus:border-[#4A6FA5]"
                    placeholder="Role…" />
                </td>
                <td className="px-2 py-1.5">
                  <input value={slot.name} onChange={e => updateSlot(shift, i, 'name', e.target.value)}
                    className="w-full bg-transparent text-white text-xs font-medium outline-none border-b border-transparent focus:border-[#E05206]"
                    placeholder="Name…" />
                </td>
                <td className="px-2 py-1.5 w-20">
                  <input type="time" value={slot.start} onChange={e => updateSlot(shift, i, 'start', e.target.value)}
                    className="bg-transparent text-[#7A8BA8] text-xs font-mono outline-none w-full" />
                </td>
                <td className="px-2 py-1.5 w-20">
                  <input type="time" value={slot.end} onChange={e => updateSlot(shift, i, 'end', e.target.value)}
                    className="bg-transparent text-[#7A8BA8] text-xs font-mono outline-none w-full" />
                </td>
                <td className="px-2 py-1.5 w-8">
                  <button onClick={() => removeSlot(shift, i)} className="text-[#4A5A72] hover:text-red-400 transition-colors">
                    <Trash2 size={12} />
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )

  return (
    <div className="max-w-3xl mx-auto space-y-6">
      <div>
        <h2 className="text-xl font-semibold text-white mb-1">Shift Roster</h2>
        <p className="text-sm text-[#7A8BA8]">Enter staff on duty. This appears at the top of the PDF.</p>
      </div>

      {/* Log metadata */}
      <div className="card p-4 grid grid-cols-2 gap-4">
        <div>
          <label className="block text-xs text-[#7A8BA8] mb-1 font-semibold uppercase tracking-wider">Log Date</label>
          <input type="date" value={log.date}
            onChange={e => onChange({ date: e.target.value })}
            className="w-full bg-[#0A0F1E] text-white text-sm px-3 py-2 rounded border border-[rgba(74,111,165,0.25)] focus:border-[#E05206] outline-none font-mono" />
        </div>
        <div>
          <label className="block text-xs text-[#7A8BA8] mb-1 font-semibold uppercase tracking-wider">Period</label>
          <input type="text" value={log.period} placeholder="e.g. 21 Apr 2026 06:00 TO 22 Apr 2026 06:00"
            onChange={e => onChange({ period: e.target.value })}
            className="w-full bg-[#0A0F1E] text-white text-sm px-3 py-2 rounded border border-[rgba(74,111,165,0.25)] focus:border-[#E05206] outline-none" />
        </div>
      </div>

      <FiveDaySection log={log} onChange={onChange} />

      {renderShiftTable('dayShift', '◑  Day Shift')}
      {renderShiftTable('nightShift', '◐  Night Shift')}

      <div className="flex gap-3 pt-2">
        <button onClick={onBack} className="px-6 py-2.5 border border-[rgba(74,111,165,0.4)] text-[#7A8BA8] text-sm rounded hover:text-white transition-colors">
          ← Back
        </button>
        <button onClick={onNext} className="flex-1 py-2.5 bg-[#E05206] text-white text-sm font-semibold rounded hover:bg-[#c44804] transition-colors">
          Continue to Review →
        </button>
      </div>
    </div>
  )
}

// ─── Step 3: Review ───────────────────────────────────────────────────────────

const CAT_ICON_MAP: Partial<Record<IncidentCategory, typeof Shield>> = {
  FATALITY: Shield, PERSON_STRUCK: Shield, SPAD: AlertTriangle,
  FIRE: Flame, CRIME: AlertCircle, HABD_WILD: Activity, NEAR_MISS: AlertTriangle,
}

function IncidentCard({ incident, onRemove, onToggleHighlight, onEdit }: {
  incident: Incident
  onRemove: () => void
  onToggleHighlight: () => void
  onEdit: (updates: Pick<Incident, 'title' | 'severity' | 'category'>) => void
}) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft]     = useState({ title: incident.title, severity: incident.severity, category: incident.category })

  const startEdit = () => {
    setDraft({ title: incident.title, severity: incident.severity, category: incident.category })
    setEditing(true)
  }
  const saveEdit = () => { onEdit(draft); setEditing(false) }
  const cancelEdit = () => setEditing(false)

  const cat  = CATEGORY_CONFIG[editing ? draft.category : incident.category]
  const Icon = CAT_ICON_MAP[incident.category] || AlertCircle

  if (editing) {
    return (
      <div className="card p-4 space-y-3 border border-[rgba(74,111,165,0.5)]">
        <div className="flex items-center gap-2 pb-1 border-b border-[rgba(74,111,165,0.2)]">
          <Pencil size={12} className="text-[#4A6FA5]" />
          <span className="text-xs font-semibold text-[#4A6FA5] uppercase tracking-wider">Edit Incident</span>
          {incident.ccil && <span className="text-xs text-[#4A5A72] font-mono ml-auto">CCIL {incident.ccil}</span>}
        </div>
        <div>
          <label className="block text-xs text-[#7A8BA8] mb-1">Title</label>
          <input
            type="text"
            value={draft.title}
            onChange={e => setDraft(p => ({ ...p, title: e.target.value }))}
            className="w-full bg-[#0A0F1E] text-white text-sm px-3 py-2 rounded border border-[rgba(74,111,165,0.25)] focus:border-[#E05206] outline-none"
          />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-xs text-[#7A8BA8] mb-1">Incident Type</label>
            <select
              value={draft.category}
              onChange={e => setDraft(p => ({ ...p, category: e.target.value as IncidentCategory }))}
              className="w-full bg-[#0A0F1E] text-white text-sm px-3 py-2 rounded border border-[rgba(74,111,165,0.25)] focus:border-[#E05206] outline-none"
            >
              {Object.entries(CATEGORY_CONFIG).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-xs text-[#7A8BA8] mb-1">Severity</label>
            <select
              value={draft.severity}
              onChange={e => setDraft(p => ({ ...p, severity: e.target.value as Severity }))}
              className="w-full bg-[#0A0F1E] text-white text-sm px-3 py-2 rounded border border-[rgba(74,111,165,0.25)] focus:border-[#E05206] outline-none"
            >
              {(['CRITICAL','HIGH','MEDIUM','LOW','INFO'] as Severity[]).map(s => (
                <option key={s} value={s}>{s}</option>
              ))}
            </select>
          </div>
        </div>
        <div className="flex gap-2 pt-1">
          <button onClick={saveEdit}
            className="flex items-center gap-2 px-4 py-2 bg-[#E05206] text-white text-sm rounded hover:bg-[#c44804] transition-colors">
            <Check size={13} /> Save
          </button>
          <button onClick={cancelEdit}
            className="flex items-center gap-2 px-4 py-2 border border-[rgba(74,111,165,0.3)] text-[#7A8BA8] text-sm rounded hover:text-white transition-colors">
            <X size={13} /> Cancel
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className={cn('card p-4 space-y-2 transition-all', incident.isHighlight && 'border-l-2 border-l-[#E05206]')}>
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-start gap-2 min-w-0">
          <Icon size={14} className="shrink-0 mt-0.5" style={{ color: cat.color }} />
          <div className="min-w-0">
            <p className="text-white text-sm font-medium leading-snug line-clamp-2">{incident.title}</p>
            <div className="flex items-center gap-2 mt-0.5 flex-wrap">
              {incident.location && <span className="text-xs text-[#7A8BA8] font-mono">{incident.location}</span>}
              {incident.ccil     && <span className="text-xs text-[#4A5A72] font-mono">CCIL {incident.ccil}</span>}
              {incident.incidentStart && <span className="text-xs text-[#4A5A72] font-mono">{incident.incidentStart}</span>}
            </div>
          </div>
        </div>
        <span className={sevBadge(incident.severity)}>{incident.severity}</span>
      </div>

      {incident.description && (
        <p className="text-xs text-[#7A8BA8] line-clamp-2 pl-5">{incident.description}</p>
      )}

      <div className="flex items-center justify-between pt-1 pl-5">
        <div className="flex items-center gap-3 text-xs font-mono">
          <span style={{ color: cat.color }}>{cat.shortLabel}</span>
          {(incident.minutesDelay || 0) > 0 && <span className="text-[#4A5A72]">{incident.minutesDelay!.toLocaleString()} min delay</span>}
          {(incident.cancelled    || 0) > 0 && <span className="text-[#4A5A72]">{incident.cancelled} cancelled</span>}
        </div>
        <div className="flex items-center gap-1">
          <button onClick={startEdit} title="Edit incident"
            className="p-1.5 rounded text-[#4A5A72] hover:text-[#4A6FA5] transition-colors">
            <Pencil size={12} />
          </button>
          <button onClick={onToggleHighlight} title={incident.isHighlight ? 'Remove from highlights' : 'Add to highlights'}
            className={cn('p-1.5 rounded transition-colors', incident.isHighlight ? 'text-[#E05206]' : 'text-[#4A5A72] hover:text-[#7A8BA8]')}>
            <AlertTriangle size={12} />
          </button>
          <button onClick={onRemove} className="p-1.5 rounded text-[#4A5A72] hover:text-red-400 transition-colors">
            <Trash2 size={12} />
          </button>
        </div>
      </div>
    </div>
  )
}

function ReviewStep({ log, onUpdate, onNext, onBack }: {
  log: LogState
  onUpdate: (incidents: Incident[]) => void
  onNext: () => void
  onBack: () => void
}) {
  const [filter, setFilter]           = useState('ALL')
  const [addingManual, setAddingManual] = useState(false)
  const [newInc, setNewInc]           = useState<Partial<Incident>>({ category: 'GENERAL', severity: 'LOW', isHighlight: false })

  const cats = ['ALL', 'HIGHLIGHTS', ...Array.from(new Set(log.incidents.map(i => i.category)))]

  const filtered = filter === 'ALL'        ? log.incidents
    : filter === 'HIGHLIGHTS'              ? log.incidents.filter(i => i.isHighlight)
    : log.incidents.filter(i => i.category === filter)

  const stats = {
    total:      log.incidents.length,
    highlights: log.incidents.filter(i => i.isHighlight).length,
    critical:   log.incidents.filter(i => ['CRITICAL','HIGH'].includes(i.severity)).length,
    totalMins:  log.incidents.reduce((s, i) => s + (i.minutesDelay || 0), 0),
    totalCan:   log.incidents.reduce((s, i) => s + (i.cancelled    || 0), 0),
  }

  const toggle = (id: string, field: keyof Incident) =>
    onUpdate(log.incidents.map(i => i.id === id ? { ...i, [field]: !(i as any)[field] } : i))

  const addManual = () => {
    const inc: Incident = {
      id: `manual-${Date.now()}`,
      category: newInc.category || 'GENERAL',
      severity:  newInc.severity  || 'LOW',
      title:     newInc.title     || 'Manual Entry',
      location:  newInc.location  || '',
      description: newInc.description || '',
      isHighlight: newInc.isHighlight || false,
      cancelled: 0, partCancelled: 0, trainsDelayed: 0, minutesDelay: 0,
    }
    onUpdate([...log.incidents, inc])
    setAddingManual(false)
    setNewInc({ category: 'GENERAL', severity: 'LOW', isHighlight: false })
  }

  return (
    <div className="max-w-4xl mx-auto space-y-5">
      <div className="flex items-start justify-between">
        <div>
          <h2 className="text-xl font-semibold text-white mb-1">Review Incidents</h2>
          <p className="text-sm text-[#7A8BA8]">Verify, flag, or add incidents before generating the PDF.</p>
        </div>
        <button onClick={() => setAddingManual(true)}
          className="flex items-center gap-2 px-4 py-2 bg-[rgba(74,111,165,0.15)] border border-[rgba(74,111,165,0.3)] text-[#4A6FA5] text-sm rounded hover:bg-[rgba(74,111,165,0.25)] transition-colors">
          <Plus size={14} /> Add Manual
        </button>
      </div>

      {/* KPI stats bar */}
      <div className="grid grid-cols-5 gap-3">
        {[
          { label: 'Total',         value: stats.total,                         color: '#4A6FA5' },
          { label: 'Highlighted',   value: stats.highlights,                    color: '#E05206' },
          { label: 'Critical/High', value: stats.critical,                      color: '#C0392B' },
          { label: 'Delay (min)',   value: stats.totalMins.toLocaleString(),    color: '#F39C12' },
          { label: 'Cancelled',     value: stats.totalCan,                      color: '#E05206' },
        ].map(s => (
          <div key={s.label} className="card p-3 text-center">
            <div className="text-2xl font-bold font-mono" style={{ color: s.color }}>{s.value}</div>
            <div className="text-xs text-[#7A8BA8] mt-0.5">{s.label}</div>
          </div>
        ))}
      </div>

      {/* Category filter tabs */}
      <div className="flex gap-2 overflow-x-auto pb-1">
        {cats.map(cat => {
          const count = cat === 'ALL'        ? log.incidents.length
            : cat === 'HIGHLIGHTS'           ? stats.highlights
            : log.incidents.filter(i => i.category === cat).length
          const cfg = CATEGORY_CONFIG[cat as IncidentCategory]
          return (
            <button key={cat} onClick={() => setFilter(cat)}
              className={cn(
                'shrink-0 px-3 py-1.5 text-xs font-mono rounded border transition-colors',
                filter === cat
                  ? 'bg-[#003366] border-[#4A6FA5] text-white'
                  : 'border-[rgba(74,111,165,0.25)] text-[#7A8BA8] hover:text-white'
              )}>
              {cat === 'ALL' ? `All (${count})`
                : cat === 'HIGHLIGHTS' ? `★ Highlights (${count})`
                : `${cfg?.shortLabel || cat} (${count})`}
            </button>
          )
        })}
      </div>

      {/* Incident list */}
      {filtered.length === 0 ? (
        <div className="card p-8 text-center">
          <FileText size={32} className="mx-auto text-[#4A5A72] mb-3" />
          <p className="text-[#7A8BA8]">No incidents. Upload a CCIL log or add manually.</p>
        </div>
      ) : (
        <div className="space-y-2">
          {filtered.map(inc => (
            <IncidentCard key={inc.id} incident={inc}
              onRemove={() => onUpdate(log.incidents.filter(i => i.id !== inc.id))}
              onToggleHighlight={() => toggle(inc.id, 'isHighlight')}
              onEdit={updates => onUpdate(log.incidents.map(i => i.id === inc.id ? { ...i, ...updates } : i))} />
          ))}
        </div>
      )}

      {/* Manual add form */}
      {addingManual && (
        <div className="card p-4 space-y-3 border border-[rgba(224,82,6,0.4)]">
          <h3 className="text-sm font-semibold text-[#E05206]">Add Manual Incident</h3>
          <div className="grid grid-cols-2 gap-3">
            {[
              { label: 'Title *', key: 'title', type: 'text' },
              { label: 'Location', key: 'location', type: 'text' },
            ].map(f => (
              <div key={f.key}>
                <label className="block text-xs text-[#7A8BA8] mb-1">{f.label}</label>
                <input type={f.type} value={(newInc as any)[f.key] || ''}
                  onChange={e => setNewInc(p => ({ ...p, [f.key]: e.target.value }))}
                  className="w-full bg-[#0A0F1E] text-white text-sm px-3 py-2 rounded border border-[rgba(74,111,165,0.25)] focus:border-[#E05206] outline-none" />
              </div>
            ))}
            <div>
              <label className="block text-xs text-[#7A8BA8] mb-1">Category</label>
              <select value={newInc.category}
                onChange={e => setNewInc(p => ({ ...p, category: e.target.value as IncidentCategory }))}
                className="w-full bg-[#0A0F1E] text-white text-sm px-3 py-2 rounded border border-[rgba(74,111,165,0.25)] focus:border-[#E05206] outline-none">
                {Object.entries(CATEGORY_CONFIG).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-xs text-[#7A8BA8] mb-1">Severity</label>
              <select value={newInc.severity}
                onChange={e => setNewInc(p => ({ ...p, severity: e.target.value as any }))}
                className="w-full bg-[#0A0F1E] text-white text-sm px-3 py-2 rounded border border-[rgba(74,111,165,0.25)] focus:border-[#E05206] outline-none">
                {['CRITICAL','HIGH','MEDIUM','LOW','INFO'].map(s => <option key={s}>{s}</option>)}
              </select>
            </div>
          </div>
          <div>
            <label className="block text-xs text-[#7A8BA8] mb-1">Description</label>
            <textarea rows={2} value={newInc.description || ''}
              onChange={e => setNewInc(p => ({ ...p, description: e.target.value }))}
              className="w-full bg-[#0A0F1E] text-white text-sm px-3 py-2 rounded border border-[rgba(74,111,165,0.25)] focus:border-[#E05206] outline-none resize-none" />
          </div>
          <label className="flex items-center gap-2 text-sm text-[#7A8BA8] cursor-pointer">
            <input type="checkbox" checked={!!newInc.isHighlight}
              onChange={e => setNewInc(p => ({ ...p, isHighlight: e.target.checked }))}
              className="accent-[#E05206]" />
            Include in highlights section
          </label>
          <div className="flex gap-2">
            <button onClick={addManual} className="flex items-center gap-2 px-4 py-2 bg-[#E05206] text-white text-sm rounded hover:bg-[#c44804] transition-colors">
              <Check size={14} /> Add
            </button>
            <button onClick={() => setAddingManual(false)} className="px-4 py-2 border border-[rgba(74,111,165,0.3)] text-[#7A8BA8] text-sm rounded hover:text-white transition-colors">
              <X size={14} />
            </button>
          </div>
        </div>
      )}

      <div className="flex gap-3 pt-2">
        <button onClick={onBack} className="px-6 py-2.5 border border-[rgba(74,111,165,0.4)] text-[#7A8BA8] text-sm rounded hover:text-white transition-colors">← Back</button>
        <button onClick={onNext} className="flex-1 py-2.5 bg-[#E05206] text-white text-sm font-semibold rounded hover:bg-[#c44804] transition-colors">Generate Report PDF →</button>
      </div>
    </div>
  )
}

// ─── Step 4: Generate ─────────────────────────────────────────────────────────

function GenerateStep({ log, onBack }: { log: LogState; onBack: () => void }) {
  const [generating, setGenerating] = useState(false)
  const [done, setDone]             = useState(false)
  const [error, setError]           = useState('')

  const handle = async () => {
    setGenerating(true); setError('')
    try {
      await generatePDF(log)
      setDone(true)
    } catch (e: any) {
      setError(e.message || 'PDF generation failed')
    } finally {
      setGenerating(false)
    }
  }

  const highlights = log.incidents.filter(i => i.isHighlight)
  const totalDelay = log.incidents.reduce((s, i) => s + (i.minutesDelay || 0), 0)
  const totalCan   = log.incidents.reduce((s, i) => s + (i.cancelled    || 0), 0)

  const summaryRows = [
    { l: 'Total incidents',  v: log.incidents.length },
    { l: 'Highlighted',      v: highlights.length },
    { l: 'Total delay',      v: `${totalDelay.toLocaleString()} min` },
    { l: 'Cancellations',    v: totalCan },
    { l: 'Person Struck',    v: log.incidents.filter(i => ['FATALITY','PERSON_STRUCK'].includes(i.category)).length },
    { l: 'SPADs',            v: log.incidents.filter(i => i.category === 'SPAD').length },
    { l: 'Fires',            v: log.incidents.filter(i => i.category === 'FIRE').length },
    { l: 'Crime / Trespass', v: log.incidents.filter(i => i.category === 'CRIME').length },
  ]

  return (
    <div className="max-w-2xl mx-auto space-y-6">
      <div>
        <h2 className="text-xl font-semibold text-white mb-1">Generate PDF Report</h2>
        <p className="text-sm text-[#7A8BA8]">Review summary then generate the OFFICIAL-SENSITIVE PDF.</p>
      </div>

      <div className="card p-5 space-y-4">
        <div className="flex items-center gap-3 pb-3 border-b border-[rgba(74,111,165,0.2)]">
          <div className="w-2 h-8 bg-[#E05206] rounded" />
          <div>
            <p className="text-white font-semibold">EMCC Daily Operations Report</p>
            <p className="text-xs text-[#7A8BA8] font-mono">{log.period || log.date || '—'}</p>
          </div>
        </div>
        <div className="grid grid-cols-2 gap-x-8 gap-y-1.5">
          {summaryRows.map(r => (
            <div key={r.l} className="flex justify-between text-xs">
              <span className="text-[#7A8BA8]">{r.l}</span>
              <span className="text-white font-mono font-semibold">{r.v}</span>
            </div>
          ))}
        </div>
        <div className="pt-1 border-t border-[rgba(74,111,165,0.15)] space-y-1 text-xs text-[#4A5A72]">
          <div className="flex items-center gap-2"><Check size={11} className="text-[#27AE60]" /> Shift roster ({log.roster.dayShift.length + log.roster.nightShift.length} positions)</div>
          <div className="flex items-center gap-2"><Check size={11} className="text-[#27AE60]" /> Incident summary infographics</div>
          <div className="flex items-center gap-2"><Check size={11} className="text-[#27AE60]" /> Categorised incident tables</div>
          <div className="flex items-center gap-2"><Check size={11} className="text-[#27AE60]" /> Disruption impact ranking</div>
          {log.fiveDayWeather && <div className="flex items-center gap-2"><Check size={11} className="text-[#27AE60]" /> 5 Day Look Ahead (weather parsed)</div>}
          {!log.fiveDayWeather && <div className="flex items-center gap-2"><AlertCircle size={11} className="text-[#4A5A72]" /> 5 Day Look Ahead (no weather PDF — placeholder)</div>}
          {log.rawLogText && <div className="flex items-center gap-2"><Check size={11} className="text-[#27AE60]" /> Verbatim CCIL log appendix</div>}
        </div>
      </div>

      {error && (
        <div className="flex items-start gap-3 p-4 rounded bg-[rgba(192,57,43,0.1)] border border-[rgba(192,57,43,0.3)]">
          <AlertCircle size={16} className="text-red-400 mt-0.5 shrink-0" />
          <p className="text-red-400 text-sm font-mono">{error}</p>
        </div>
      )}

      {done && (
        <div className="flex items-center gap-3 p-4 rounded bg-[rgba(39,174,96,0.1)] border border-[rgba(39,174,96,0.3)]">
          <Check size={16} className="text-green-400" />
          <p className="text-green-400 text-sm font-medium">PDF downloaded successfully.</p>
        </div>
      )}

      <div className="space-y-2">
        <button onClick={handle} disabled={generating}
          className={cn(
            'w-full py-3 text-white text-sm font-bold rounded flex items-center justify-center gap-3 transition-all',
            generating ? 'bg-[#4A6FA5] cursor-not-allowed' : 'bg-[#E05206] hover:bg-[#c44804]'
          )}>
          {generating ? <><Loader2 size={16} className="animate-spin" /> Building PDF…</>
           : done      ? <><RefreshCw size={16} /> Regenerate PDF</>
           :             <><Download size={16} /> Generate &amp; Download PDF</>}
        </button>
        <p className="text-center text-xs text-[#4A5A72] font-mono">OFFICIAL-SENSITIVE — Handle per NR information policy</p>
      </div>

      <button onClick={onBack} className="w-full py-2.5 border border-[rgba(74,111,165,0.4)] text-[#7A8BA8] text-sm rounded hover:text-white transition-colors">← Back to Review</button>
    </div>
  )
}

// ─── Root app ─────────────────────────────────────────────────────────────────

export default function Home() {
  const [step, setStep] = useState(1)
  const [log,  setLog]  = useState<LogState>(BLANK_LOG)

  // Set today's date safely after mount — avoids SSR/client hydration mismatch
  useEffect(() => {
    const d = new Date()
    const pad = (n: number) => n.toString().padStart(2, '0')
    const today = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
    setLog(prev => prev.date ? prev : { ...prev, date: today })
  }, [])

  const update = (patch: Partial<LogState>) => setLog(prev => ({ ...prev, ...patch }))

  const onUploadComplete = (data: Partial<LogState>, rawText: string) => {
    setLog(prev => ({
      ...prev,
      ...data,
      rawLogText: rawText,
      roster: prev.roster,   // keep roster defaults
      status: 'parsed',
    }))
    setStep(2)
  }

  return (
    <div className="min-h-screen" style={{ background: 'var(--bg-primary)', position: 'relative', zIndex: 2 }}>
      {/* Header */}
      <header className="border-b border-[rgba(74,111,165,0.2)] bg-[#0F1729]">
        <div className="max-w-5xl mx-auto px-6 py-3 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="flex items-center gap-1">
              <div className="w-5 h-5 bg-[#E05206]" style={{ clipPath: 'polygon(0 0,100% 0,80% 100%,0 100%)' }} />
              <div className="w-3 h-5 bg-[#E05206]" style={{ clipPath: 'polygon(20% 0,100% 0,100% 100%,0 100%)' }} />
            </div>
            <div>
              <p className="text-white text-sm font-bold leading-none">Network Rail</p>
              <p className="text-[#7A8BA8] text-xs leading-none">EMCC Daily Report Generator</p>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <span className="pulse-dot w-2 h-2 rounded-full bg-[#27AE60] inline-block" />
            <LiveClock />
          </div>
        </div>
      </header>

      {/* Step bar */}
      <div className="border-b border-[rgba(74,111,165,0.15)] bg-[#0F1729]">
        <div className="max-w-5xl mx-auto px-6 py-3">
          <StepBar current={step} />
        </div>
      </div>

      {/* Content */}
      <main className="max-w-5xl mx-auto px-6 py-8">
        {step === 1 && <UploadStep onComplete={onUploadComplete} />}
        {step === 2 && (
          <RosterStep log={log} onChange={update}
            onNext={() => setStep(3)} onBack={() => setStep(1)} />
        )}
        {step === 3 && (
          <ReviewStep log={log}
            onUpdate={incidents => update({ incidents })}
            onNext={() => setStep(4)} onBack={() => setStep(2)} />
        )}
        {step === 4 && <GenerateStep log={log} onBack={() => setStep(3)} />}
      </main>

      <footer className="border-t border-[rgba(74,111,165,0.15)] mt-12">
        <div className="max-w-5xl mx-auto px-6 py-4 flex items-center justify-between">
          <p className="text-xs text-[#4A5A72] font-mono">EMCC DAILY LOG SYSTEM · OFFICIAL-SENSITIVE</p>
          <p className="text-xs text-[#4A5A72]">Network Rail Infrastructure Ltd</p>
        </div>
      </footer>
    </div>
  )
}
