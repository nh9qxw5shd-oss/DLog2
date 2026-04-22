'use client'

import { useState, useCallback, useRef } from 'react'
import {
  Upload, FileText, Users, AlertTriangle, ChevronRight,
  Plus, Trash2, Edit3, Check, X, Download, Eye, RefreshCw, Loader2,
  Shield, Zap, Flame, AlertCircle, Activity
} from 'lucide-react'
import { LogState, Incident, RosterData, ShiftSlot,
  DEFAULT_ROSTER, CATEGORY_CONFIG, IncidentCategory } from '@/lib/types'
import { parseCCILText, extractPeriod, extractCreatedBy } from '@/lib/ccilParser'
import { generatePDF } from '@/lib/pdfGenerator'
import { format } from 'date-fns'

// ─── Utilities ────────────────────────────────────────────────────────────────

function cn(...classes: (string | false | undefined | null)[]) {
  return classes.filter(Boolean).join(' ')
}

function severityBadge(sev: string) {
  const map: Record<string, string> = {
    CRITICAL: 'badge-critical', HIGH: 'badge-high',
    MEDIUM: 'badge-medium', LOW: 'badge-low', INFO: 'badge-info'
  }
  return `inline-flex items-center px-2 py-0.5 rounded text-xs font-mono font-semibold ${map[sev] || 'badge-info'}`
}

// ─── Step Indicator ───────────────────────────────────────────────────────────

const STEPS = [
  { id: 1, label: 'Upload Log', icon: Upload },
  { id: 2, label: 'Roster Entry', icon: Users },
  { id: 3, label: 'Review', icon: Eye },
  { id: 4, label: 'Generate PDF', icon: Download },
]

function StepBar({ current }: { current: number }) {
  return (
    <div className="flex items-center gap-0">
      {STEPS.map((step, i) => {
        const Icon = step.icon
        const status = current > step.id ? 'complete' : current === step.id ? 'active' : 'inactive'
        return (
          <div key={step.id} className="flex items-center">
            <div className={cn(
              'flex items-center gap-2 px-4 py-2 text-sm font-medium transition-all',
              status === 'active' && 'bg-[#E05206] text-white',
              status === 'complete' && 'bg-[#27AE60] text-white',
              status === 'inactive' && 'bg-[#131C35] text-[#7A8BA8] border border-[rgba(74,111,165,0.25)]',
            )}>
              <Icon size={14} />
              <span className="hidden sm:inline">{step.label}</span>
              <span className="font-mono text-xs opacity-60">0{step.id}</span>
            </div>
            {i < STEPS.length - 1 && (
              <ChevronRight size={16} className="text-[#4A6FA5] mx-0" />
            )}
          </div>
        )
      })}
    </div>
  )
}

// ─── Empty state ──────────────────────────────────────────────────────────────

const DEFAULT_LOG: LogState = {
  date: format(new Date(), 'yyyy-MM-dd'),
  period: '',
  controlCentre: 'East Midlands Control Centre (EMCC)',
  roster: DEFAULT_ROSTER,
  performance: {},
  incidents: [],
  status: 'empty',
}

// ─── Step 1: Upload ───────────────────────────────────────────────────────────

function UploadStep({ onComplete }: { onComplete: (log: Partial<LogState>, rawText: string) => void }) {
  const [dragging, setDragging] = useState(false)
  const [file, setFile] = useState<File | null>(null)
  const [parsing, setParsing] = useState(false)
  const [error, setError] = useState('')
  const [progress, setProgress] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)

  const processFile = useCallback(async (f: File) => {
    setFile(f)
    setError("")
    setParsing(true)
    setProgress("Reading DOCX...")

    try {
      const mammoth = await import("mammoth")
      const arrayBuffer = await f.arrayBuffer()
      const result = await mammoth.extractRawText({ arrayBuffer })
      const rawText = result.value

      setProgress("Parsing incidents...")

      // All parsing is local — no API calls
      const { period, date } = extractPeriod(rawText)
      const createdBy = extractCreatedBy(rawText)
      const incidents = parseCCILText(rawText)

      setProgress("Done!")
      onComplete({ period, date, createdBy, incidents, rawLogText: rawText }, rawText)
    } catch (e: any) {
      setError(e.message)
      setParsing(false)
      setProgress("")
    }
  }, [onComplete])

  const onDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    setDragging(false)
    const f = e.dataTransfer.files[0]
    if (f?.name.endsWith('.docx')) processFile(f)
    else setError('Please upload a .docx file (CCIL export)')
  }, [processFile])

  return (
    <div className="max-w-2xl mx-auto space-y-6">
      <div>
        <h2 className="text-xl font-semibold text-white mb-1">Upload CCIL Log Export</h2>
        <p className="text-sm text-[#7A8BA8]">
          Upload the CCIL .docx export. Claude will automatically extract and classify all incidents.
        </p>
      </div>

      <div
        className={cn('drop-zone rounded-lg p-12 text-center cursor-pointer transition-all', dragging && 'dragover')}
        onDragOver={e => { e.preventDefault(); setDragging(true) }}
        onDragLeave={() => setDragging(false)}
        onDrop={onDrop}
        onClick={() => inputRef.current?.click()}
      >
        <input ref={inputRef} type="file" accept=".docx" className="hidden"
          onChange={e => e.target.files?.[0] && processFile(e.target.files[0])} />

        {parsing ? (
          <div className="space-y-4">
            <Loader2 size={40} className="mx-auto text-[#E05206] animate-spin" />
            <p className="text-[#7A8BA8] text-sm font-mono">{progress}</p>
          </div>
        ) : file ? (
          <div className="space-y-2">
            <FileText size={40} className="mx-auto text-[#27AE60]" />
            <p className="text-white font-medium">{file.name}</p>
            <p className="text-[#7A8BA8] text-xs">{(file.size / 1024).toFixed(1)} KB</p>
          </div>
        ) : (
          <div className="space-y-3">
            <Upload size={40} className="mx-auto text-[#4A6FA5]" />
            <div>
              <p className="text-white font-medium">Drop CCIL .docx file here</p>
              <p className="text-[#7A8BA8] text-sm mt-1">or click to browse</p>
            </div>
            <p className="text-xs text-[#4A5A72] font-mono">CCIL EXPORT → DOCX FORMAT ONLY</p>
          </div>
        )}
      </div>

      {error && (
        <div className="flex items-start gap-3 p-4 rounded bg-[rgba(192,57,43,0.1)] border border-[rgba(192,57,43,0.3)]">
          <AlertCircle size={16} className="text-red-400 mt-0.5 shrink-0" />
          <p className="text-red-400 text-sm">{error}</p>
        </div>
      )}

      {/* Manual date / period entry fallback */}
      <div className="card p-4 space-y-3">
        <p className="text-xs text-[#7A8BA8] font-semibold uppercase tracking-wider">Or skip upload — enter manually</p>
        <button
          className="w-full py-2 px-4 border border-[rgba(74,111,165,0.4)] text-[#4A6FA5] text-sm rounded hover:bg-[rgba(74,111,165,0.1)] transition-colors"
          onClick={() => onComplete({}, '')}
        >
          Start with blank log (manual entry only)
        </button>
      </div>
    </div>
  )
}

// ─── Step 2: Roster ───────────────────────────────────────────────────────────

function RosterStep({ log, onChange, onNext, onBack }: {
  log: LogState
  onChange: (r: RosterData) => void
  onNext: () => void
  onBack: () => void
}) {
  const updateSlot = (shift: 'dayShift' | 'nightShift', idx: number, field: keyof ShiftSlot, value: string) => {
    const updated = { ...log.roster }
    updated[shift] = updated[shift].map((s, i) => i === idx ? { ...s, [field]: value } : s)
    onChange(updated)
  }

  const addSlot = (shift: 'dayShift' | 'nightShift') => {
    const updated = { ...log.roster }
    updated[shift] = [...updated[shift], { role: '', name: '', start: '06:00', end: '18:00' }]
    onChange(updated)
  }

  const removeSlot = (shift: 'dayShift' | 'nightShift', idx: number) => {
    const updated = { ...log.roster }
    updated[shift] = updated[shift].filter((_, i) => i !== idx)
    onChange(updated)
  }

  const ShiftTable = ({ shift, label }: { shift: 'dayShift' | 'nightShift'; label: string }) => (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-[#4A6FA5] uppercase tracking-wider">{label}</h3>
        <button onClick={() => addSlot(shift)}
          className="flex items-center gap-1 text-xs text-[#E05206] hover:text-white transition-colors">
          <Plus size={12} /> Add row
        </button>
      </div>

      <div className="card overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-[#0A0F1E]">
              <th className="text-left px-3 py-2 text-xs text-[#7A8BA8] font-medium">ROLE</th>
              <th className="text-left px-3 py-2 text-xs text-[#7A8BA8] font-medium">NAME</th>
              <th className="text-left px-3 py-2 text-xs text-[#7A8BA8] font-medium">FROM</th>
              <th className="text-left px-3 py-2 text-xs text-[#7A8BA8] font-medium">TO</th>
              <th className="px-2 py-2 w-8"></th>
            </tr>
          </thead>
          <tbody>
            {log.roster[shift].map((slot, i) => (
              <tr key={i} className={i % 2 === 0 ? '' : 'bg-[rgba(74,111,165,0.05)]'}>
                <td className="px-2 py-1.5">
                  <input
                    value={slot.role}
                    onChange={e => updateSlot(shift, i, 'role', e.target.value)}
                    className="w-full bg-transparent text-white text-xs outline-none border-b border-transparent focus:border-[#4A6FA5] transition-colors"
                    placeholder="Role title…"
                  />
                </td>
                <td className="px-2 py-1.5">
                  <input
                    value={slot.name}
                    onChange={e => updateSlot(shift, i, 'name', e.target.value)}
                    className="w-full bg-transparent text-white text-xs font-medium outline-none border-b border-transparent focus:border-[#E05206] transition-colors"
                    placeholder="Name…"
                  />
                </td>
                <td className="px-2 py-1.5">
                  <input type="time" value={slot.start}
                    onChange={e => updateSlot(shift, i, 'start', e.target.value)}
                    className="bg-transparent text-[#7A8BA8] text-xs font-mono outline-none" />
                </td>
                <td className="px-2 py-1.5">
                  <input type="time" value={slot.end}
                    onChange={e => updateSlot(shift, i, 'end', e.target.value)}
                    className="bg-transparent text-[#7A8BA8] text-xs font-mono outline-none" />
                </td>
                <td className="px-2 py-1.5">
                  <button onClick={() => removeSlot(shift, i)}
                    className="text-[#4A5A72] hover:text-red-400 transition-colors">
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
        <p className="text-sm text-[#7A8BA8]">Enter staff on duty for this 24-hour period. This appears at the top of the PDF report.</p>
      </div>

      {/* Log metadata */}
      <div className="card p-4 grid grid-cols-2 gap-4">
        <div>
          <label className="block text-xs text-[#7A8BA8] mb-1 font-semibold uppercase tracking-wider">Log Date</label>
          <input type="date" value={log.date}
            onChange={e => {}}
            className="w-full bg-[#0A0F1E] text-white text-sm px-3 py-2 rounded border border-[rgba(74,111,165,0.25)] focus:border-[#E05206] outline-none font-mono"
          />
        </div>
        <div>
          <label className="block text-xs text-[#7A8BA8] mb-1 font-semibold uppercase tracking-wider">Period</label>
          <input type="text" value={log.period} placeholder="e.g. 21 Apr 2026 06:00 TO 22 Apr 2026 06:00"
            onChange={e => {}}
            className="w-full bg-[#0A0F1E] text-white text-sm px-3 py-2 rounded border border-[rgba(74,111,165,0.25)] focus:border-[#E05206] outline-none"
          />
        </div>
      </div>

      <ShiftTable shift="dayShift" label="◑ Day Shift" />
      <ShiftTable shift="nightShift" label="◐ Night Shift" />

      {/* Performance metrics */}
      <div className="space-y-2">
        <h3 className="text-sm font-semibold text-[#4A6FA5] uppercase tracking-wider">Performance Metrics (optional)</h3>
        <div className="card p-4 grid grid-cols-2 sm:grid-cols-4 gap-4">
          {[
            { key: 'timeTo3', label: 'Time to 3 %', placeholder: '86.7' },
            { key: 'cancellations', label: 'Cancellations %', placeholder: '4.5' },
            { key: 'ppm', label: 'PPM %', placeholder: '93' },
            { key: 'freightArrivalT15', label: 'Freight T-15 %', placeholder: '89' },
          ].map(m => (
            <div key={m.key}>
              <label className="block text-xs text-[#7A8BA8] mb-1">{m.label}</label>
              <input
                type="number" step="0.1" placeholder={m.placeholder}
                defaultValue={(log.performance as any)[m.key] || ''}
                className="w-full bg-[#0A0F1E] text-white text-sm px-2 py-2 rounded border border-[rgba(74,111,165,0.25)] focus:border-[#E05206] outline-none font-mono"
              />
            </div>
          ))}
        </div>
      </div>

      <div className="flex gap-3 pt-2">
        <button onClick={onBack}
          className="px-6 py-2.5 border border-[rgba(74,111,165,0.4)] text-[#7A8BA8] text-sm rounded hover:text-white transition-colors">
          ← Back
        </button>
        <button onClick={onNext}
          className="flex-1 py-2.5 bg-[#E05206] text-white text-sm font-semibold rounded hover:bg-[#c44804] transition-colors">
          Continue to Review →
        </button>
      </div>
    </div>
  )
}

// ─── Step 3: Review ───────────────────────────────────────────────────────────

const CAT_ICONS: Partial<Record<IncidentCategory, typeof Shield>> = {
  FATALITY: Shield, PERSON_STRUCK: Shield, SPAD: AlertTriangle,
  FIRE: Flame, CRIME: AlertCircle, HABD_WILD: Activity,
  NEAR_MISS: Zap, BRIDGE_STRIKE: AlertTriangle,
}

function IncidentCard({ incident, onEdit, onRemove, onToggleHighlight }: {
  incident: Incident
  onEdit: (i: Incident) => void
  onRemove: () => void
  onToggleHighlight: () => void
}) {
  const cat = CATEGORY_CONFIG[incident.category]
  const Icon = CAT_ICONS[incident.category] || AlertCircle

  return (
    <div className={cn(
      'card p-4 space-y-2 transition-all',
      incident.isHighlight && 'border-l-2 border-l-[#E05206]'
    )}>
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-start gap-2 min-w-0">
          <Icon size={14} className="shrink-0 mt-1" style={{ color: cat.color }} />
          <div className="min-w-0">
            <p className="text-white text-sm font-medium leading-snug line-clamp-2">{incident.title}</p>
            <div className="flex items-center gap-2 mt-1 flex-wrap">
              <span className="text-xs text-[#7A8BA8] font-mono">{incident.location}</span>
              {incident.ccil && <span className="text-xs text-[#4A5A72] font-mono">CCIL {incident.ccil}</span>}
            </div>
          </div>
        </div>
        <div className="flex items-center gap-1 shrink-0">
          <span className={severityBadge(incident.severity)}>{incident.severity}</span>
        </div>
      </div>

      <p className="text-xs text-[#7A8BA8] line-clamp-2">{incident.description}</p>

      <div className="flex items-center justify-between pt-1">
        <div className="flex items-center gap-3 text-xs text-[#4A5A72] font-mono">
          <span style={{ color: cat.color }}>{cat.shortLabel}</span>
          {incident.minutesDelay ? <span>{incident.minutesDelay.toLocaleString()} min</span> : null}
          {incident.cancelled ? <span>{incident.cancelled} canc</span> : null}
        </div>
        <div className="flex items-center gap-1">
          <button
            onClick={onToggleHighlight}
            title={incident.isHighlight ? 'Remove from highlights' : 'Add to highlights'}
            className={cn(
              'p-1.5 rounded text-xs transition-colors',
              incident.isHighlight ? 'text-[#E05206]' : 'text-[#4A5A72] hover:text-[#7A8BA8]'
            )}
          >
            <AlertTriangle size={12} />
          </button>
          <button onClick={() => onEdit(incident)}
            className="p-1.5 rounded text-[#4A5A72] hover:text-[#4A6FA5] transition-colors">
            <Edit3 size={12} />
          </button>
          <button onClick={onRemove}
            className="p-1.5 rounded text-[#4A5A72] hover:text-red-400 transition-colors">
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
  const [filter, setFilter] = useState<string>('ALL')
  const [editingId, setEditingId] = useState<string | null>(null)
  const [addingManual, setAddingManual] = useState(false)
  const [newIncident, setNewIncident] = useState<Partial<Incident>>({
    category: 'GENERAL', severity: 'LOW', isHighlight: false
  })

  const categories = ['ALL', 'HIGHLIGHTS', ...Array.from(new Set(log.incidents.map(i => i.category)))]

  const filtered = filter === 'ALL' ? log.incidents
    : filter === 'HIGHLIGHTS' ? log.incidents.filter(i => i.isHighlight)
    : log.incidents.filter(i => i.category === filter)

  const toggle = (id: string, field: keyof Incident) => {
    onUpdate(log.incidents.map(i => i.id === id ? { ...i, [field]: !(i as any)[field] } : i))
  }

  const remove = (id: string) => {
    onUpdate(log.incidents.filter(i => i.id !== id))
  }

  const addManual = () => {
    const incident: Incident = {
      id: `manual-${Date.now()}`,
      category: newIncident.category || 'GENERAL',
      severity: newIncident.severity || 'LOW',
      title: newIncident.title || 'Manual Entry',
      location: newIncident.location || '',
      description: newIncident.description || '',
      isHighlight: newIncident.isHighlight || false,
      cancelled: 0, partCancelled: 0, trainsDelayed: 0, minutesDelay: 0,
    }
    onUpdate([...log.incidents, incident])
    setAddingManual(false)
    setNewIncident({ category: 'GENERAL', severity: 'LOW', isHighlight: false })
  }

  const stats = {
    total: log.incidents.length,
    highlights: log.incidents.filter(i => i.isHighlight).length,
    critical: log.incidents.filter(i => i.severity === 'CRITICAL').length,
    totalMins: log.incidents.reduce((s, i) => s + (i.minutesDelay || 0), 0),
  }

  return (
    <div className="max-w-4xl mx-auto space-y-5">
      <div className="flex items-start justify-between">
        <div>
          <h2 className="text-xl font-semibold text-white mb-1">Review Extracted Incidents</h2>
          <p className="text-sm text-[#7A8BA8]">Verify, edit, or add incidents before generating the PDF.</p>
        </div>
        <button
          onClick={() => setAddingManual(true)}
          className="flex items-center gap-2 px-4 py-2 bg-[rgba(74,111,165,0.15)] border border-[rgba(74,111,165,0.3)] text-[#4A6FA5] text-sm rounded hover:bg-[rgba(74,111,165,0.25)] transition-colors"
        >
          <Plus size={14} /> Add Manual
        </button>
      </div>

      {/* Stats bar */}
      <div className="grid grid-cols-4 gap-3">
        {[
          { label: 'Total Incidents', value: stats.total, color: '#4A6FA5' },
          { label: 'Highlighted', value: stats.highlights, color: '#E05206' },
          { label: 'Critical/High', value: stats.critical, color: '#C0392B' },
          { label: 'Total Delay (min)', value: stats.totalMins.toLocaleString(), color: '#F39C12' },
        ].map(s => (
          <div key={s.label} className="card p-3 text-center">
            <div className="text-2xl font-bold font-mono" style={{ color: s.color }}>{s.value}</div>
            <div className="text-xs text-[#7A8BA8] mt-0.5">{s.label}</div>
          </div>
        ))}
      </div>

      {/* Category filter */}
      <div className="flex gap-2 overflow-x-auto pb-1">
        {categories.map(cat => (
          <button
            key={cat}
            onClick={() => setFilter(cat)}
            className={cn(
              'shrink-0 px-3 py-1.5 text-xs font-mono rounded border transition-colors',
              filter === cat
                ? 'bg-[#003366] border-[#4A6FA5] text-white'
                : 'border-[rgba(74,111,165,0.25)] text-[#7A8BA8] hover:text-white'
            )}
          >
            {cat === 'ALL' ? `All (${log.incidents.length})`
              : cat === 'HIGHLIGHTS' ? `★ Highlights (${stats.highlights})`
              : `${CATEGORY_CONFIG[cat as IncidentCategory]?.shortLabel || cat} (${log.incidents.filter(i => i.category === cat).length})`}
          </button>
        ))}
      </div>

      {/* Incident list */}
      {log.incidents.length === 0 ? (
        <div className="card p-8 text-center">
          <FileText size={32} className="mx-auto text-[#4A5A72] mb-3" />
          <p className="text-[#7A8BA8]">No incidents extracted. Upload a CCIL log or add manually.</p>
        </div>
      ) : (
        <div className="space-y-2">
          {filtered.map(incident => (
            <IncidentCard
              key={incident.id}
              incident={incident}
              onEdit={() => setEditingId(incident.id)}
              onRemove={() => remove(incident.id)}
              onToggleHighlight={() => toggle(incident.id, 'isHighlight')}
            />
          ))}
        </div>
      )}

      {/* Manual add form */}
      {addingManual && (
        <div className="card p-4 space-y-3 border-[rgba(224,82,6,0.4)]">
          <h3 className="text-sm font-semibold text-[#E05206]">Add Manual Incident</h3>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs text-[#7A8BA8] mb-1">Title *</label>
              <input value={newIncident.title || ''} onChange={e => setNewIncident(p => ({ ...p, title: e.target.value }))}
                className="w-full bg-[#0A0F1E] text-white text-sm px-3 py-2 rounded border border-[rgba(74,111,165,0.25)] focus:border-[#E05206] outline-none" />
            </div>
            <div>
              <label className="block text-xs text-[#7A8BA8] mb-1">Location</label>
              <input value={newIncident.location || ''} onChange={e => setNewIncident(p => ({ ...p, location: e.target.value }))}
                className="w-full bg-[#0A0F1E] text-white text-sm px-3 py-2 rounded border border-[rgba(74,111,165,0.25)] focus:border-[#E05206] outline-none" />
            </div>
            <div>
              <label className="block text-xs text-[#7A8BA8] mb-1">Category</label>
              <select value={newIncident.category} onChange={e => setNewIncident(p => ({ ...p, category: e.target.value as IncidentCategory }))}
                className="w-full bg-[#0A0F1E] text-white text-sm px-3 py-2 rounded border border-[rgba(74,111,165,0.25)] focus:border-[#E05206] outline-none">
                {Object.entries(CATEGORY_CONFIG).map(([k, v]) => (
                  <option key={k} value={k}>{v.label}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-xs text-[#7A8BA8] mb-1">Severity</label>
              <select value={newIncident.severity} onChange={e => setNewIncident(p => ({ ...p, severity: e.target.value as any }))}
                className="w-full bg-[#0A0F1E] text-white text-sm px-3 py-2 rounded border border-[rgba(74,111,165,0.25)] focus:border-[#E05206] outline-none">
                {['CRITICAL','HIGH','MEDIUM','LOW','INFO'].map(s => <option key={s}>{s}</option>)}
              </select>
            </div>
          </div>
          <div>
            <label className="block text-xs text-[#7A8BA8] mb-1">Description</label>
            <textarea value={newIncident.description || ''} onChange={e => setNewIncident(p => ({ ...p, description: e.target.value }))}
              rows={2}
              className="w-full bg-[#0A0F1E] text-white text-sm px-3 py-2 rounded border border-[rgba(74,111,165,0.25)] focus:border-[#E05206] outline-none resize-none" />
          </div>
          <label className="flex items-center gap-2 text-sm text-[#7A8BA8] cursor-pointer">
            <input type="checkbox" checked={!!newIncident.isHighlight} onChange={e => setNewIncident(p => ({ ...p, isHighlight: e.target.checked }))}
              className="accent-[#E05206]" />
            Include in highlights section
          </label>
          <div className="flex gap-2">
            <button onClick={addManual}
              className="flex items-center gap-2 px-4 py-2 bg-[#E05206] text-white text-sm rounded hover:bg-[#c44804] transition-colors">
              <Check size={14} /> Add Incident
            </button>
            <button onClick={() => setAddingManual(false)}
              className="px-4 py-2 border border-[rgba(74,111,165,0.3)] text-[#7A8BA8] text-sm rounded hover:text-white transition-colors">
              <X size={14} />
            </button>
          </div>
        </div>
      )}

      <div className="flex gap-3 pt-2">
        <button onClick={onBack}
          className="px-6 py-2.5 border border-[rgba(74,111,165,0.4)] text-[#7A8BA8] text-sm rounded hover:text-white transition-colors">
          ← Back
        </button>
        <button onClick={onNext}
          className="flex-1 py-2.5 bg-[#E05206] text-white text-sm font-semibold rounded hover:bg-[#c44804] transition-colors">
          Generate Report PDF →
        </button>
      </div>
    </div>
  )
}

// ─── Step 4: Generate ─────────────────────────────────────────────────────────

function GenerateStep({ log, onBack }: { log: LogState; onBack: () => void }) {
  const [generating, setGenerating] = useState(false)
  const [done, setDone] = useState(false)
  const [error, setError] = useState('')

  const handleGenerate = async () => {
    setGenerating(true)
    setError('')
    try {
      await generatePDF(log)
      setDone(true)
    } catch (e: any) {
      setError(e.message)
    } finally {
      setGenerating(false)
    }
  }

  const highlights = log.incidents.filter(i => i.isHighlight)
  const totalDelay = log.incidents.reduce((s, i) => s + (i.minutesDelay || 0), 0)

  return (
    <div className="max-w-2xl mx-auto space-y-6">
      <div>
        <h2 className="text-xl font-semibold text-white mb-1">Generate PDF Report</h2>
        <p className="text-sm text-[#7A8BA8]">Review the summary below then generate the OFFICIAL-SENSITIVE PDF.</p>
      </div>

      {/* Report preview summary */}
      <div className="card p-5 space-y-4">
        <div className="flex items-center gap-2 pb-3 border-b border-[rgba(74,111,165,0.2)]">
          <div className="w-2 h-8 bg-[#E05206] rounded" />
          <div>
            <p className="text-white font-semibold">EMCC Daily Operations Report</p>
            <p className="text-xs text-[#7A8BA8] font-mono">{log.period || log.date}</p>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-4 text-sm">
          <div>
            <p className="text-[#7A8BA8] text-xs mb-2 font-semibold uppercase tracking-wider">Report Contents</p>
            <ul className="space-y-1.5 text-[#7A8BA8]">
              <li className="flex items-center gap-2"><Check size={12} className="text-[#27AE60]" /> Shift roster ({log.roster.dayShift.length + log.roster.nightShift.length} slots)</li>
              {Object.values(log.performance).some(v => v !== undefined) && (
                <li className="flex items-center gap-2"><Check size={12} className="text-[#27AE60]" /> Performance metrics</li>
              )}
              <li className="flex items-center gap-2"><Check size={12} className="text-[#27AE60]" /> {highlights.length} highlighted incidents</li>
              <li className="flex items-center gap-2"><Check size={12} className="text-[#27AE60]" /> {log.incidents.length} total incidents (categorised tables)</li>
              <li className="flex items-center gap-2"><Check size={12} className="text-[#27AE60]" /> Disruption impact table</li>
              {log.rawLogText && <li className="flex items-center gap-2"><Check size={12} className="text-[#27AE60]" /> Full CCIL log appendix</li>}
            </ul>
          </div>
          <div>
            <p className="text-[#7A8BA8] text-xs mb-2 font-semibold uppercase tracking-wider">Key Figures</p>
            <div className="space-y-1.5">
              {[
                { l: 'Total Delay', v: `${totalDelay.toLocaleString()} min` },
                { l: 'Cancellations', v: log.incidents.reduce((s, i) => s + (i.cancelled || 0), 0) },
                { l: 'SPADs', v: log.incidents.filter(i => i.category === 'SPAD').length },
                { l: 'Critical Incidents', v: log.incidents.filter(i => i.severity === 'CRITICAL').length },
              ].map(r => (
                <div key={r.l} className="flex justify-between text-xs">
                  <span className="text-[#7A8BA8]">{r.l}</span>
                  <span className="text-white font-mono font-semibold">{r.v}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>

      {error && (
        <div className="flex items-start gap-3 p-4 rounded bg-[rgba(192,57,43,0.1)] border border-[rgba(192,57,43,0.3)]">
          <AlertCircle size={16} className="text-red-400 mt-0.5 shrink-0" />
          <p className="text-red-400 text-sm">{error}</p>
        </div>
      )}

      {done && (
        <div className="flex items-center gap-3 p-4 rounded bg-[rgba(39,174,96,0.1)] border border-[rgba(39,174,96,0.3)]">
          <Check size={16} className="text-green-400" />
          <p className="text-green-400 text-sm font-medium">PDF generated and downloaded successfully.</p>
        </div>
      )}

      <div className="space-y-2">
        <button
          onClick={handleGenerate}
          disabled={generating}
          className={cn(
            'w-full py-3 text-white text-sm font-bold rounded flex items-center justify-center gap-3 transition-all',
            generating
              ? 'bg-[#4A6FA5] cursor-not-allowed'
              : 'bg-[#E05206] hover:bg-[#c44804] active:scale-[0.99]'
          )}
        >
          {generating ? (
            <><Loader2 size={16} className="animate-spin" /> Generating PDF…</>
          ) : done ? (
            <><RefreshCw size={16} /> Regenerate PDF</>
          ) : (
            <><Download size={16} /> Generate & Download PDF</>
          )}
        </button>

        <p className="text-center text-xs text-[#4A5A72] font-mono">
          OFFICIAL-SENSITIVE — Handle in accordance with NR information policy
        </p>
      </div>

      <button onClick={onBack}
        className="w-full py-2.5 border border-[rgba(74,111,165,0.4)] text-[#7A8BA8] text-sm rounded hover:text-white transition-colors">
        ← Back to Review
      </button>
    </div>
  )
}

// ─── Main App ─────────────────────────────────────────────────────────────────

export default function Home() {
  const [step, setStep] = useState(1)
  const [log, setLog] = useState<LogState>(DEFAULT_LOG)

  const handleUploadComplete = (data: Partial<LogState>, rawText: string) => {
    setLog(prev => ({
      ...prev,
      ...data,
      rawLogText: rawText,
      roster: prev.roster,  // preserve roster defaults
      status: 'parsed',
    }))
    setStep(2)
  }

  const handleRosterChange = (roster: RosterData) => {
    setLog(prev => ({ ...prev, roster }))
  }

  return (
    <div className="min-h-screen" style={{ background: 'var(--bg-primary)', position: 'relative', zIndex: 2 }}>
      {/* Top nav */}
      <header className="border-b border-[rgba(74,111,165,0.2)] bg-[#0F1729]">
        <div className="max-w-5xl mx-auto px-6 py-3 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="flex items-center gap-1.5">
              <div className="w-5 h-5 bg-[#E05206]" style={{ clipPath: 'polygon(0 0, 100% 0, 80% 100%, 0 100%)' }} />
              <div className="w-3 h-5 bg-[#E05206]" style={{ clipPath: 'polygon(20% 0, 100% 0, 100% 100%, 0 100%)' }} />
            </div>
            <div>
              <p className="text-white text-sm font-bold leading-none">Network Rail</p>
              <p className="text-[#7A8BA8] text-xs leading-none">EMCC Daily Report Generator</p>
            </div>
          </div>

          <div className="flex items-center gap-3">
            <div className="pulse-dot w-2 h-2 rounded-full bg-[#27AE60]" />
            <span className="text-xs text-[#7A8BA8] font-mono">
              {format(new Date(), 'HH:mm')} · {format(new Date(), 'dd MMM yyyy')}
            </span>
          </div>
        </div>
      </header>

      {/* Step bar */}
      <div className="border-b border-[rgba(74,111,165,0.15)] bg-[#0F1729]">
        <div className="max-w-5xl mx-auto px-6 py-3">
          <StepBar current={step} />
        </div>
      </div>

      {/* Main content */}
      <main className="max-w-5xl mx-auto px-6 py-8">
        {step === 1 && (
          <UploadStep onComplete={handleUploadComplete} />
        )}
        {step === 2 && (
          <RosterStep
            log={log}
            onChange={handleRosterChange}
            onNext={() => setStep(3)}
            onBack={() => setStep(1)}
          />
        )}
        {step === 3 && (
          <ReviewStep
            log={log}
            onUpdate={incidents => setLog(prev => ({ ...prev, incidents }))}
            onNext={() => setStep(4)}
            onBack={() => setStep(2)}
          />
        )}
        {step === 4 && (
          <GenerateStep log={log} onBack={() => setStep(3)} />
        )}
      </main>

      {/* Footer */}
      <footer className="border-t border-[rgba(74,111,165,0.15)] mt-12">
        <div className="max-w-5xl mx-auto px-6 py-4 flex items-center justify-between">
          <p className="text-xs text-[#4A5A72] font-mono">EMCC DAILY LOG SYSTEM · OFFICIAL-SENSITIVE</p>
          <p className="text-xs text-[#4A5A72]">Network Rail Infrastructure Ltd</p>
        </div>
      </footer>
    </div>
  )
}
