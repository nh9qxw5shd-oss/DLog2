'use client'

import { useState, useCallback, useRef, useEffect } from 'react'
import {
  Upload, FileText, Users, AlertTriangle, ChevronRight,
  Plus, Trash2, Check, X, Download, Eye, RefreshCw,
  Loader2, AlertCircle, Activity, Flame, Shield, Pencil, CloudDownload, MapPin, FlaskConical,
  ExternalLink, ClipboardPaste, Ban, CloudSun,
} from 'lucide-react'
import {
  LogState, Incident, RosterData, ShiftSlot, Severity,
  DEFAULT_ROSTER, CATEGORY_CONFIG, IncidentCategory,
  HazardLevel, RiskLevel, WeatherRisk, DayWeather,
  WEATHER_RISK_OPTIONS, deriveWeatherLevel, deriveUpcomingDays, deriveUpcomingDates,
  makeEmptyLookAheadWeather, makeEmptyLookAheadNotes, normaliseLookAheadWeather, padTo7,
  LOOK_AHEAD_DAYS, FORECAST_AREAS, ForecastAreaKey, ForecastDocument, todayIsoLocal,
  SeasonMode, SteamFireRiskLevel, AdhesionLevel, ADHESION_LEVEL_OPTIONS,
  makeEmptySeasonalData,
} from '@/lib/types'
import {
  parseCCILText, extractPeriod, extractCreatedBy, parsePeriodHeader,
  voteLogDate, londonNow, currentPeriodStartDate,
} from '@/lib/ccilParser'
import { generatePDF } from '@/lib/pdfGenerator'
import {
  isSupabaseConfigured, upsertReportData, fetchHistoricalData, annotateWithContinuations, SaveBlockedError,
  storeForecast, fetchLatestForecast, StoredForecast, LatestForecastSummary,
} from '@/lib/supabaseClient'
import { parseForecastPdf } from '@/lib/weather/forecastParser'
import { applyForecast, describeIssue, sha256Hex } from '@/lib/weather/applyForecast'
import { isRosterhubConfigured, fetchRosterFromHub, fetchKnownStaffNames } from '@/lib/rosterhub'
import { renderHistoricalCharts, ChartImages } from '@/lib/chartRenderer'
import { readCategorySettings } from '@/lib/categorySettings'
import { fetchEsrSnapshot, EsrSnapshotResponse, isEsrFresh, parsePastedFeed, NRSDB_FEED_URL, londonToday } from '@/lib/esrClient'
import { useTestMode } from '@/lib/testMode'
import { fetchOutOfUseRegister, OouRegister, ago as oouAgo, ragCounts } from '@/lib/outOfUse'

// ─── Hydration-safe clock ─────────────────────────────────────────────────────────
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

function mergeNames(a: string[], b: string[]): string[] {
  const set = new Set<string>()
  for (const n of a) { const t = n.trim(); if (t) set.add(t) }
  for (const n of b) { const t = n.trim(); if (t) set.add(t) }
  return Array.from(set).sort((x, y) => x.localeCompare(y))
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
  lookAheadWeather: makeEmptyLookAheadWeather(),
  lookAheadNotes: makeEmptyLookAheadNotes(),
  forecast: null,
  forecastFileName: null,
  ...makeEmptySeasonalData(),
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

// ─── Forecast PDF import (shared by the Upload step and the look-ahead) ───────

interface ForecastImportResult {
  forecast:   ForecastDocument
  fileName:   string
  stored:     StoredForecast | null
  storeError: string | null
}

async function importForecastFile(f: File, opts: { testMode: boolean }): Promise<ForecastImportResult> {
  const buf = await f.arrayBuffer()
  const forecast = await parseForecastPdf(buf)
  if (!forecast.areas.length) {
    throw new Error(`"${f.name}" does not look like a Route 7 Day Forecast — no hazard tables were found.`)
  }
  let stored: StoredForecast | null = null
  let storeError: string | null = null
  if (isSupabaseConfigured() && !opts.testMode) {
    try {
      const hash = await sha256Hex(buf)
      stored = await storeForecast(forecast, { fileName: f.name, hash })
    } catch (e: any) {
      storeError = e?.message || 'Forecast could not be saved to the database'
    }
  }
  return { forecast, fileName: f.name, stored, storeError }
}

function ForecastCard({ forecast, fileName, notes, stored, storeError, compact }: {
  forecast:   ForecastDocument
  fileName?:  string | null
  notes?:     string[]
  stored?:    StoredForecast | null
  storeError?: string | null
  compact?:   boolean
}) {
  const stale = forecast.validFromDate && forecast.validFromDate !== todayIsoLocal()
  const problems = [...(forecast.warnings || []), ...(notes || [])]
  return (
    <div className={cn('rounded border', stale ? 'border-[rgba(243,156,18,0.5)] bg-[rgba(243,156,18,0.06)]' : 'border-[rgba(39,174,96,0.4)] bg-[rgba(39,174,96,0.06)]', compact ? 'p-2' : 'p-3')}>
      <div className="flex items-start gap-2">
        <CloudSun size={16} className={cn('mt-0.5 shrink-0', stale ? 'text-[#F39C12]' : 'text-[#27AE60]')} />
        <div className="min-w-0 flex-1 space-y-0.5">
          <p className="text-white text-sm font-medium truncate">{forecast.title || 'Route 7 Day Forecast'}{fileName ? <span className="text-[#7A8BA8] font-normal"> · {fileName}</span> : null}</p>
          <p className="text-[#7A8BA8] text-xs">
            {describeIssue(forecast)}{forecast.validFromDate ? ` · valid from ${forecast.validFromDate}` : ''}
            {' · '}{forecast.areas.length} areas × {forecast.areas[0]?.days.length ?? 0} days
          </p>
          {stale && <p className="text-[#F39C12] text-xs">This forecast is not today&apos;s issue — days were matched by date; check the grid.</p>}
          {stored && !storeError && (
            <p className="text-[#7A8BA8] text-[11px]">{stored.alreadyStored ? 'Already in the shared forecast store (refreshed).' : 'Saved to the shared forecast store for the 09:00 call and 05:30 message.'}</p>
          )}
          {storeError && <p className="text-red-400 text-xs">Not saved to the database: {storeError}</p>}
          {problems.length > 0 && (
            <ul className="text-[11px] text-[#F39C12] list-disc pl-4 space-y-0.5">
              {problems.slice(0, 8).map((w, i) => <li key={i}>{w}</li>)}
              {problems.length > 8 && <li>… {problems.length - 8} more</li>}
            </ul>
          )}
        </div>
      </div>
    </div>
  )
}

// ─── Step 1: Upload ─────────────────────────────────────────────────────────────

function UploadStep({ onComplete, testMode }: {
  onComplete: (data: Partial<LogState>, rawText: string) => void
  testMode:   boolean
}) {
  const [dragging, setDragging] = useState(false)
  const [file, setFile]         = useState<File | null>(null)
  const [parsing, setParsing]   = useState(false)
  const [progress, setProgress] = useState('')
  const [error, setError]       = useState('')
  const [parsed, setParsed]     = useState<{ data: Partial<LogState>; rawText: string } | null>(null)
  const [fcState, setFcState]   = useState<{ status: 'idle' | 'parsing' | 'done' | 'error'; result?: ForecastImportResult; notes?: string[]; error?: string }>({ status: 'idle' })
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

  const processDocx = useCallback(async (f: File) => {
    setFile(f); setError(''); setParsing(true); setProgress('Reading DOCX…'); setParsed(null)
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
      const createdBy  = extractCreatedBy(rawText || parseSource)
      const catSettings = readCategorySettings()
      const groupSeverities = Object.fromEntries(
        Object.entries(catSettings.groups).map(([k, v]) => [k, v.severity])
      )
      const incidents  = parseCCILText(parseSource, catSettings.labelOverrides, groupSeverities)

      // System-derived Log Date. Authority order:
      //   1. The incidents' own CCIL header timestamps (machine-stamped by
      //      CCIL — cannot be hand-edited into the wrong day). A clear
      //      majority mapped onto the 06:00→06:00 grid IS the log date.
      //   2. The document's period header (hand-edited; has been wrong).
      //   3. Yesterday (the operational default for a morning upload).
      // The operator never types this date in the normal flow — the Roster
      // step displays it read-only with its provenance.
      const header = extractPeriod(rawText || parseSource)
      const vote = voteLogDate(incidents)
      const rowsWin = !!(vote && vote.share >= 0.6)
      const date       = rowsWin ? vote!.date : header.date
      const dateSource = rowsWin ? 'rows' as const : header.dateSource
      const period = header.period

      setProgress(`Done — ${incidents.length} incidents extracted`)
      setParsed({ data: { period, date, dateSource, createdBy, incidents, rawLogText: rawText }, rawText })
    } catch (e: any) {
      setError(e.message || 'Parse failed')
      setProgress('')
    } finally {
      setParsing(false)
    }
  }, [htmlToTableText])

  const processForecast = useCallback(async (f: File) => {
    setFcState({ status: 'parsing' })
    try {
      const result = await importForecastFile(f, { testMode })
      const applied = applyForecast(result.forecast, todayIsoLocal())
      setFcState({ status: 'done', result, notes: applied.notes })
    } catch (e: any) {
      setFcState({ status: 'error', error: e?.message || 'Forecast parse failed' })
    }
  }, [testMode])

  const handleFiles = useCallback((files: FileList | File[]) => {
    const list = Array.from(files)
    let unknown = 0
    for (const f of list) {
      const name = f.name.toLowerCase()
      if (name.endsWith('.docx')) processDocx(f)
      else if (name.endsWith('.pdf')) processForecast(f)
      else unknown++
    }
    if (unknown) setError('Drop the CCIL .docx export and, optionally, the Route 7 Day Forecast .pdf. Other file types are ignored.')
  }, [processDocx, processForecast])

  const onDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault(); setDragging(false)
    handleFiles(e.dataTransfer.files)
  }, [handleFiles])

  const forecastPatch = (): Partial<LogState> => {
    if (fcState.status !== 'done' || !fcState.result) return {}
    const applied = applyForecast(fcState.result.forecast, todayIsoLocal())
    return { lookAheadWeather: applied.weather, forecast: fcState.result.forecast, forecastFileName: fcState.result.fileName }
  }

  const proceed = () => { if (parsed) onComplete({ ...parsed.data, ...forecastPatch() }, parsed.rawText) }

  return (
    <div className="max-w-2xl mx-auto space-y-6">
      <div>
        <h2 className="text-xl font-semibold text-white mb-1">Upload CCIL Log Export &amp; Route Forecast</h2>
        <p className="text-sm text-[#7A8BA8]">Drop the CCIL .docx export and the Route 7 Day Forecast .pdf together or one at a time. Parsing is local — the forecast&apos;s figures are shared with the 09:00 call and 05:30 message once read.</p>
      </div>

      <div
        className={cn('drop-zone rounded-lg p-10 text-center cursor-pointer', dragging && 'dragover')}
        onDragOver={e => { e.preventDefault(); setDragging(true) }}
        onDragLeave={() => setDragging(false)}
        onDrop={onDrop}
        onClick={() => inputRef.current?.click()}
      >
        <input ref={inputRef} type="file" accept=".docx,.pdf" multiple className="hidden"
          onChange={e => { if (e.target.files?.length) handleFiles(e.target.files); e.target.value = '' }} />

        {parsing ? (
          <div className="space-y-4">
            <Loader2 size={40} className="mx-auto text-[#E05206] animate-spin" />
            <p className="text-[#7A8BA8] text-sm font-mono">{progress}</p>
          </div>
        ) : (
          <div className="space-y-3">
            <Upload size={40} className="mx-auto text-[#4A6FA5]" />
            <p className="text-white font-medium">Drop CCIL .docx and forecast .pdf here</p>
            <p className="text-[#7A8BA8] text-sm">or click to browse</p>
            <p className="text-xs text-[#4A5A72] font-mono">CCIL EXPORT · DOCX &nbsp;|&nbsp; ROUTE 7 DAY FORECAST · PDF</p>
          </div>
        )}
      </div>

      <div className="grid sm:grid-cols-2 gap-3">
        <div className={cn('card p-3 flex items-start gap-3', parsed && 'border-[rgba(39,174,96,0.4)]')}>
          {parsed ? <FileText size={18} className="text-[#27AE60] mt-0.5 shrink-0" /> : <FileText size={18} className="text-[#4A5A72] mt-0.5 shrink-0" />}
          <div className="min-w-0">
            <p className="text-xs text-[#7A8BA8] font-semibold uppercase tracking-wider">CCIL log</p>
            {parsed && file ? (
              <>
                <p className="text-white text-sm truncate">{file.name}</p>
                <p className="text-[#7A8BA8] text-xs">{(file.size / 1024).toFixed(1)} KB · {progress}</p>
              </>
            ) : <p className="text-[#4A5A72] text-xs">Not loaded yet — required.</p>}
          </div>
        </div>
        <div className={cn('card p-3 flex items-start gap-3', fcState.status === 'done' && 'border-[rgba(39,174,96,0.4)]')}>
          {fcState.status === 'parsing'
            ? <Loader2 size={18} className="text-[#E05206] animate-spin mt-0.5 shrink-0" />
            : <CloudSun size={18} className={cn('mt-0.5 shrink-0', fcState.status === 'done' ? 'text-[#27AE60]' : 'text-[#4A5A72]')} />}
          <div className="min-w-0">
            <p className="text-xs text-[#7A8BA8] font-semibold uppercase tracking-wider">Route 7 Day Forecast</p>
            {fcState.status === 'done' && fcState.result ? (
              <>
                <p className="text-white text-sm truncate">{fcState.result.fileName}</p>
                <p className="text-[#7A8BA8] text-xs">{describeIssue(fcState.result.forecast)}</p>
              </>
            ) : fcState.status === 'parsing' ? <p className="text-[#7A8BA8] text-xs">Reading forecast…</p>
              : fcState.status === 'error' ? <p className="text-red-400 text-xs">{fcState.error}</p>
              : <p className="text-[#4A5A72] text-xs">Optional here — can also be added on the next step.</p>}
          </div>
        </div>
      </div>

      {fcState.status === 'done' && fcState.result && (
        <ForecastCard forecast={fcState.result.forecast} fileName={fcState.result.fileName} notes={fcState.notes}
          stored={fcState.result.stored} storeError={fcState.result.storeError} />
      )}

      {error && (
        <div className="flex items-start gap-3 p-4 rounded bg-[rgba(192,57,43,0.1)] border border-[rgba(192,57,43,0.3)]">
          <AlertCircle size={16} className="text-red-400 mt-0.5 shrink-0" />
          <p className="text-red-400 text-sm">{error}</p>
        </div>
      )}

      {parsed && (
        <button
          className="w-full py-2.5 px-4 bg-[#E05206] text-white text-sm font-semibold rounded hover:bg-[#c4480a] transition-colors flex items-center justify-center gap-2"
          onClick={proceed}
          disabled={fcState.status === 'parsing'}
        >
          Continue to Roster {fcState.status !== 'done' && <span className="font-normal opacity-80">(without forecast)</span>} <ChevronRight size={14} />
        </button>
      )}

      <div className="card p-4 space-y-3">
        <p className="text-xs text-[#7A8BA8] font-semibold uppercase tracking-wider">Or start blank (manual entry)</p>
        <button
          className="w-full py-2 px-4 border border-[rgba(74,111,165,0.4)] text-[#4A6FA5] text-sm rounded hover:bg-[rgba(74,111,165,0.1)] transition-colors"
          onClick={() => onComplete(forecastPatch(), '')}
        >Start with empty log{fcState.status === 'done' ? ' (keeping the forecast)' : ''}</button>
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
const RISK_LEVEL_DOT: Record<RiskLevel, string> = {
  AWARE:   'bg-[#F1C40F]',
  ADVERSE: 'bg-[#E67E22]',
  EXTREME: 'bg-[#C0392B]',
}

// ─── Seasonal cell display constants ───────────────────────────────────────────

const STEAM_FIRE_BG: Record<SteamFireRiskLevel, string> = {
  GREEN: 'bg-[#27AE60]',
  AMBER: 'bg-[#F59E0B]',
  RED:   'bg-[#E74C3C]',
  BLACK: 'bg-[#111111]',
}
const STEAM_FIRE_TEXT: Record<SteamFireRiskLevel, string> = {
  GREEN: 'text-white',
  AMBER: 'text-[#001F45]',
  RED:   'text-white',
  BLACK: 'text-white',
}
const STEAM_FIRE_LABELS: Record<SteamFireRiskLevel, string> = {
  GREEN: 'Green',
  AMBER: 'Amber',
  RED:   'Red',
  BLACK: 'Black',
}

const ADHESION_BG: Record<AdhesionLevel, string> = {
  GOOD_1_2:        'bg-[#1A5631]',
  DAMP_3:          'bg-[#27AE60]',
  MODERATE_4_5:    'bg-[#F1C40F]',
  POOR_5_8:        'bg-[#E74C3C]',
  VERY_POOR_9_10:  'bg-[#111111]',
}
const ADHESION_TEXT: Record<AdhesionLevel, string> = {
  GOOD_1_2:        'text-white',
  DAMP_3:          'text-white',
  MODERATE_4_5:    'text-[#001F45]',
  POOR_5_8:        'text-white',
  VERY_POOR_9_10:  'text-white',
}

// ─── Steam Fire Risk cell ─────────────────────────────────────────────────────

const STEAM_OPTIONS: SteamFireRiskLevel[] = ['GREEN', 'AMBER', 'RED', 'BLACK']

function SteamFireRiskCell({ value, isOpen, onOpen, onClose, onChange }: {
  value:    SteamFireRiskLevel
  isOpen:   boolean
  onOpen:   () => void
  onClose:  () => void
  onChange: (v: SteamFireRiskLevel) => void
}) {
  const wrapRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!isOpen) return
    const handler = (e: MouseEvent) => {
      if (!wrapRef.current?.contains(e.target as Node)) onClose()
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [isOpen, onClose])

  return (
    <div ref={wrapRef} className="relative">
      <button
        type="button"
        onClick={onOpen}
        className={cn(
          STEAM_FIRE_BG[value], STEAM_FIRE_TEXT[value],
          'w-full min-h-[42px] rounded px-1 py-1 text-center leading-tight',
          'hover:ring-2 hover:ring-white transition-all',
          isOpen && 'ring-2 ring-white',
        )}
      >
        <div className="text-[10px] font-bold">{STEAM_FIRE_LABELS[value]}</div>
      </button>

      {isOpen && (
        <div className="absolute z-50 top-full mt-1 left-0 w-28 bg-[#0F1629] border border-[rgba(74,111,165,0.4)] rounded p-1.5 shadow-xl">
          <div className="space-y-1">
            {STEAM_OPTIONS.map(opt => (
              <button
                key={opt}
                type="button"
                onClick={() => { onChange(opt); onClose() }}
                className={cn(
                  STEAM_FIRE_BG[opt], STEAM_FIRE_TEXT[opt],
                  'w-full text-[10px] font-bold py-1.5 rounded transition-all',
                  value === opt && 'ring-2 ring-white',
                )}
              >
                {STEAM_FIRE_LABELS[opt]}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

// ─── Adhesion cell ──────────────────────────────────────────────────────────────

function AdhesionCell({ value, isOpen, onOpen, onClose, onChange }: {
  value:    AdhesionLevel
  isOpen:   boolean
  onOpen:   () => void
  onClose:  () => void
  onChange: (v: AdhesionLevel) => void
}) {
  const wrapRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!isOpen) return
    const handler = (e: MouseEvent) => {
      if (!wrapRef.current?.contains(e.target as Node)) onClose()
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [isOpen, onClose])

  return (
    <div ref={wrapRef} className="relative">
      <button
        type="button"
        onClick={onOpen}
        className={cn(
          ADHESION_BG[value], ADHESION_TEXT[value],
          'w-full min-h-[42px] rounded px-1 py-1 text-center leading-tight',
          'hover:ring-2 hover:ring-white transition-all',
          isOpen && 'ring-2 ring-white',
        )}
      >
        <div className="text-[10px] font-bold">
          {ADHESION_LEVEL_OPTIONS.find(o => o.value === value)?.label ?? value}
        </div>
      </button>

      {isOpen && (
        <div className="absolute z-50 top-full mt-1 left-0 w-36 bg-[#0F1629] border border-[rgba(74,111,165,0.4)] rounded p-1.5 shadow-xl">
          <div className="space-y-1">
            {ADHESION_LEVEL_OPTIONS.map(opt => (
              <button
                key={opt.value}
                type="button"
                onClick={() => { onChange(opt.value); onClose() }}
                className={cn(
                  ADHESION_BG[opt.value], ADHESION_TEXT[opt.value],
                  'w-full text-[10px] font-bold py-1.5 rounded transition-all',
                  value === opt.value && 'ring-2 ring-white',
                )}
              >
                {opt.label}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

// ─── Weather cell with inline risk editor ────────────────────────────────────────

function fmtTemp(n: number | null | undefined): string {
  return n === null || n === undefined || isNaN(n) ? '–' : n.toFixed(1).replace(/\.0$/, '')
}

function WeatherCell({ day, isOpen, onOpen, onClose, onToggle }: {
  day:      DayWeather
  isOpen:   boolean
  onOpen:   () => void
  onClose:  () => void
  onToggle: (risk: WeatherRisk, level: RiskLevel | null) => void
}) {
  const level    = deriveWeatherLevel(day)
  const selected = Object.entries(day.risks) as Array<[WeatherRisk, RiskLevel]>
  const wrapRef  = useRef<HTMLDivElement>(null)
  const temps    = day.temps

  useEffect(() => {
    if (!isOpen) return
    const handler = (e: MouseEvent) => {
      if (!wrapRef.current?.contains(e.target as Node)) onClose()
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [isOpen, onClose])

  return (
    <div ref={wrapRef} className="relative">
      <button
        type="button"
        onClick={onOpen}
        className={cn(
          HAZARD_BG[level], HAZARD_TEXT[level],
          'w-full min-h-[46px] rounded px-0.5 py-1 text-left leading-tight',
          'hover:ring-2 hover:ring-white transition-all',
          isOpen && 'ring-2 ring-white',
        )}
      >
        {level === 'GREEN' ? (
          <div className="text-center text-[10px] font-medium opacity-80">{temps ? 'Normal' : '—'}</div>
        ) : (
          <>
            <div className="text-[10px] font-bold text-center">{level}</div>
            {selected.length > 0 && (
              <div className="text-[8px] opacity-90 text-center break-words">
                {selected.map(([r]) => r).join(', ')}
              </div>
            )}
          </>
        )}
        {temps && (
          <div className="text-[8.5px] font-mono text-center opacity-90 mt-0.5" title="Max (06-18) / Min night (18-06) · Min morning (06-11)">
            {fmtTemp(temps.max)}° / {fmtTemp(temps.minNight)}°
          </div>
        )}
      </button>

      {isOpen && (
        <div className="absolute z-50 top-full mt-1 left-0 w-60 bg-[#0F1629] border border-[rgba(74,111,165,0.4)] rounded p-2 shadow-xl">
          {temps && (
            <p className="text-[10px] text-[#7A8BA8] font-mono pb-1 mb-1 border-b border-[rgba(74,111,165,0.2)]">
              Morn {fmtTemp(temps.minMorning)}° · Max {fmtTemp(temps.max)}° · Night {fmtTemp(temps.minNight)}°
            </p>
          )}
          <div className="space-y-1 max-h-72 overflow-y-auto">
            {WEATHER_RISK_OPTIONS.map(risk => {
              const current = day.risks[risk]
              return (
                <div key={risk} className="flex items-center justify-between gap-2 py-0.5">
                  <label className="flex items-center gap-1.5 flex-1 cursor-pointer text-[11px] text-white">
                    <input
                      type="checkbox"
                      className="accent-[#E05206]"
                      checked={!!current}
                      onChange={e => onToggle(risk, e.target.checked ? (current ?? 'AWARE') : null)}
                    />
                    {current && <span className={cn('w-2 h-2 rounded-full', RISK_LEVEL_DOT[current])} />}
                    <span>{risk}</span>
                  </label>
                  <select
                    disabled={!current}
                    value={current ?? 'AWARE'}
                    onChange={e => onToggle(risk, e.target.value as RiskLevel)}
                    className={cn(
                      'bg-[#0A0F1E] text-white text-[10px] px-1 py-0.5 rounded',
                      'border border-[rgba(74,111,165,0.3)] disabled:opacity-40',
                    )}
                  >
                    <option value="AWARE">AWARE</option>
                    <option value="ADVERSE">ADVERSE</option>
                    <option value="EXTREME">EXTREME</option>
                  </select>
                </div>
              )
            })}
          </div>
          <div className="flex justify-end pt-1.5 mt-1 border-t border-[rgba(74,111,165,0.2)]">
            <button
              type="button"
              onClick={onClose}
              className="text-[10px] text-[#E05206] hover:text-white px-2 py-0.5"
            >
              Done
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

// ─── 7 Day Look Ahead config component ─────────────────────────────────────────

const SEASON_MODES: SeasonMode[] = ['Standard', 'Summer', 'Autumn']

function LookAheadSection({ log, onChange, testMode }: {
  log:      LogState
  onChange: (updates: Partial<LogState>) => void
  testMode: boolean
}) {
  type EditTarget =
    | { kind: 'weather';   area: ForecastAreaKey; dayIdx: number }
    | { kind: 'steam';     dayIdx: number }
    | { kind: 'adhesion';  row: 'eastMids' | 'lincoln';           dayIdx: number }
  const [editing, setEditing] = useState<EditTarget | null>(null)

  const weather  = normaliseLookAheadWeather(log.lookAheadWeather)
  const notes    = {
    risks: padTo7(log.lookAheadNotes?.risks),
    toc:   padTo7(log.lookAheadNotes?.toc),
    foc:   padTo7(log.lookAheadNotes?.foc),
  }
  const season   = log.seasonMode ?? 'Standard'

  const [days, setDays] = useState<string[]>(Array.from({ length: LOOK_AHEAD_DAYS }, () => ''))
  const [dates, setDates] = useState<string[]>(Array.from({ length: LOOK_AHEAD_DAYS }, () => ''))
  useEffect(() => { setDays(deriveUpcomingDays()); setDates(deriveUpcomingDates()) }, [])

  // Forecast import from this step (drop-in or file picker) and the option to
  // reuse an issue somebody else already stored this morning.
  const fileRef = useRef<HTMLInputElement>(null)
  const [fcBusy, setFcBusy] = useState(false)
  const [fcError, setFcError] = useState('')
  const [fcNotes, setFcNotes] = useState<string[]>([])
  const [fcStored, setFcStored] = useState<StoredForecast | null>(null)
  const [fcStoreError, setFcStoreError] = useState<string | null>(null)
  const [latest, setLatest] = useState<LatestForecastSummary | null>(null)
  const [dragging, setDragging] = useState(false)

  useEffect(() => {
    if (log.forecast || !isSupabaseConfigured()) return
    let cancelled = false
    fetchLatestForecast().then(l => { if (!cancelled && l) setLatest(l) }).catch(() => {})
    return () => { cancelled = true }
  }, [log.forecast])

  const applyDoc = (forecast: ForecastDocument, fileName: string | null) => {
    const applied = applyForecast(forecast, todayIsoLocal(), weather)
    setFcNotes(applied.notes)
    onChange({ lookAheadWeather: applied.weather, forecast, forecastFileName: fileName })
  }

  const loadFile = async (f: File) => {
    if (!f.name.toLowerCase().endsWith('.pdf')) { setFcError('Drop the Route 7 Day Forecast .pdf'); return }
    setFcBusy(true); setFcError(''); setFcStored(null); setFcStoreError(null)
    try {
      const r = await importForecastFile(f, { testMode })
      setFcStored(r.stored); setFcStoreError(r.storeError)
      applyDoc(r.forecast, r.fileName)
    } catch (e: any) {
      setFcError(e?.message || 'Forecast parse failed')
    } finally {
      setFcBusy(false)
    }
  }

  const useStored = () => {
    if (!latest) return
    applyDoc(latest.document, null)
    setFcStored({ id: latest.id, issuedAt: latest.issuedAt, alreadyStored: true })
  }

  const updateNote = (key: keyof typeof notes, dayIdx: number, val: string) => {
    const next = [...notes[key]]
    next[dayIdx] = val
    onChange({ lookAheadNotes: { ...notes, [key]: next } })
  }

  const toggleRisk = (
    area: ForecastAreaKey,
    dayIdx: number,
    risk: WeatherRisk,
    level: RiskLevel | null,
  ) => {
    const areaDays = [...weather[area]]
    const nextRisks = { ...areaDays[dayIdx].risks }
    if (level === null) delete nextRisks[risk]
    else nextRisks[risk] = level
    areaDays[dayIdx] = { ...areaDays[dayIdx], risks: nextRisks }
    onChange({ lookAheadWeather: { ...weather, [area]: areaDays } })
  }

  const updateSteamFire = (dayIdx: number, val: SteamFireRiskLevel) => {
    const next = [...padTo7(log.steamFireRisk as string[] | undefined, 'GREEN')]
    next[dayIdx] = val
    onChange({ steamFireRisk: next as SteamFireRiskLevel[] })
  }

  const updateAdhesion = (row: 'eastMids' | 'lincoln', dayIdx: number, val: AdhesionLevel) => {
    const key = row === 'eastMids' ? 'eastMidsAdhesion' : 'lincolnAdhesion'
    const next = [...padTo7(log[key] as string[] | undefined, 'GOOD_1_2')]
    next[dayIdx] = val
    onChange({ [key]: next as AdhesionLevel[] })
  }

  const bottomTextRows: Array<{ key: 'toc' | 'foc'; label: string }> = [
    { key: 'toc', label: 'TOC Operations & Depot start up' },
    { key: 'foc', label: 'FOC Operations'                  },
  ]

  const steamFireRisk    = padTo7(log.steamFireRisk    as string[] | undefined, 'GREEN')
  const eastMidsAdhesion = padTo7(log.eastMidsAdhesion as string[] | undefined, 'GOOD_1_2')
  const lincolnAdhesion  = padTo7(log.lincolnAdhesion  as string[] | undefined, 'GOOD_1_2')

  const labelCell = 'px-2 py-1 text-[11px] font-semibold text-[#4A6FA5] bg-[rgba(74,111,165,0.08)] border border-[rgba(74,111,165,0.2)]'

  return (
    <div
      className={cn('card p-4 space-y-3', dragging && 'ring-2 ring-[#E05206]')}
      onDragOver={e => { if (e.dataTransfer.types.includes('Files')) { e.preventDefault(); setDragging(true) } }}
      onDragLeave={() => setDragging(false)}
      onDrop={e => { e.preventDefault(); setDragging(false); const f = e.dataTransfer.files[0]; if (f) loadFile(f) }}
    >
      <div className="flex items-baseline justify-between gap-2 flex-wrap">
        <p className="text-xs text-[#7A8BA8] font-semibold uppercase tracking-wider">7 Day Look Ahead</p>
        <p className="text-[10px] text-[#4A5A72]">Weather cells are filled from the Route 7 Day Forecast and stay editable · text cells are free-form (default Nil)</p>
      </div>

      {/* Forecast provenance / import */}
      <div className="flex items-start gap-3 flex-wrap">
        <div className="flex-1 min-w-[16rem]">
          {log.forecast ? (
            <ForecastCard forecast={log.forecast} fileName={log.forecastFileName} notes={fcNotes} stored={fcStored} storeError={fcStoreError} compact />
          ) : (
            <div className="rounded border border-dashed border-[rgba(74,111,165,0.4)] p-2 text-xs text-[#7A8BA8] flex items-start gap-2">
              <CloudSun size={14} className="text-[#4A6FA5] mt-0.5 shrink-0" />
              <div className="space-y-1">
                <p>No Route 7 Day Forecast loaded — drop the forecast .pdf on this panel or pick it below. Cells can still be set by hand.</p>
                {latest && (
                  <button type="button" onClick={useStored}
                    className="text-[#E05206] hover:text-white underline underline-offset-2">
                    Use the forecast already stored today ({describeIssue(latest.document) || latest.issuedAt}{latest.validFromDate !== todayIsoLocal() ? ` · valid from ${latest.validFromDate}` : ''})
                  </button>
                )}
              </div>
            </div>
          )}
          {fcError && <p className="text-red-400 text-xs mt-1">{fcError}</p>}
        </div>
        <div className="flex items-center gap-2">
          <input ref={fileRef} type="file" accept=".pdf" className="hidden"
            onChange={e => { const f = e.target.files?.[0]; if (f) loadFile(f); e.target.value = '' }} />
          <button type="button" onClick={() => fileRef.current?.click()} disabled={fcBusy}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-[11px] font-semibold rounded bg-[#0A0F1E] text-[#7A8BA8] border border-[rgba(74,111,165,0.3)] hover:border-[#E05206] hover:text-white transition-all disabled:opacity-50">
            {fcBusy ? <Loader2 size={12} className="animate-spin" /> : <CloudDownload size={12} />}
            {log.forecast ? 'Replace forecast PDF' : 'Load forecast PDF'}
          </button>
        </div>
      </div>

      {/* Season selector */}
      <div className="flex items-center gap-2">
        <span className="text-[10px] text-[#4A5A72] font-semibold uppercase tracking-wider">Season:</span>
        <div className="flex gap-1">
          {SEASON_MODES.map(mode => (
            <button
              key={mode}
              type="button"
              onClick={() => onChange({ seasonMode: mode })}
              className={cn(
                'px-3 py-1 text-[11px] font-semibold rounded transition-all',
                season === mode
                  ? 'bg-[#E05206] text-white'
                  : 'bg-[#0A0F1E] text-[#7A8BA8] border border-[rgba(74,111,165,0.3)] hover:border-[#E05206] hover:text-white',
              )}
            >
              {mode}
            </button>
          ))}
        </div>
      </div>

      <div className="overflow-visible">
        <table className="w-full border-collapse table-fixed">
          <thead>
            <tr>
              <th className="text-left px-2 py-1.5 w-32 text-[10px] text-[#4A6FA5] font-semibold uppercase tracking-wider bg-[#0A0F1E] border border-[rgba(74,111,165,0.2)]">
                East Midlands Route<br />7 Day Look Ahead
              </th>
              {days.map((d, i) => (
                <th key={i} className="text-center px-1 py-1.5 text-[#7A8BA8] font-semibold text-[11px] bg-[#0A0F1E] border border-[rgba(74,111,165,0.2)]">
                  {d.length > 9 ? d.slice(0, 3) : d}
                  <div className="text-[9px] font-mono font-normal text-[#4A5A72]">{dates[i] ? dates[i].slice(8, 10) + '/' + dates[i].slice(5, 7) : ''}</div>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {/* Risks row */}
            <tr>
              <td className={labelCell}>Risks</td>
              {notes.risks.map((v, i) => (
                <td key={i} className="p-0.5 border border-[rgba(74,111,165,0.2)] align-top">
                  <textarea
                    value={v}
                    rows={1}
                    onChange={e => updateNote('risks', i, e.target.value)}
                    className="w-full bg-transparent text-white text-xs px-1 py-1 outline-none focus:bg-[#0A0F1E] rounded resize-none overflow-hidden [field-sizing:content]"
                    style={{ minHeight: '1.75rem' }}
                  />
                </td>
              ))}
            </tr>

            {/* Weather rows — one per forecast area */}
            {FORECAST_AREAS.map(area => (
              <tr key={area.key}>
                <td className={labelCell}>Weather {area.label}</td>
                {weather[area.key].map((d, i) => (
                  <td key={i} className="p-1 border border-[rgba(74,111,165,0.2)] align-top">
                    <WeatherCell
                      day={d}
                      isOpen={editing?.kind === 'weather' && editing.area === area.key && editing.dayIdx === i}
                      onOpen={() => setEditing({ kind: 'weather', area: area.key, dayIdx: i })}
                      onClose={() => setEditing(null)}
                      onToggle={(risk, level) => toggleRisk(area.key, i, risk, level)}
                    />
                  </td>
                ))}
              </tr>
            ))}

            {/* TOC / FOC rows */}
            {bottomTextRows.map(({ key, label }) => (
              <tr key={key}>
                <td className={labelCell}>{label}</td>
                {notes[key].map((v, i) => (
                  <td key={i} className="p-0.5 border border-[rgba(74,111,165,0.2)] align-top">
                    <textarea
                      value={v}
                      rows={1}
                      onChange={e => updateNote(key, i, e.target.value)}
                      className="w-full bg-transparent text-white text-xs px-1 py-1 outline-none focus:bg-[#0A0F1E] rounded resize-none overflow-hidden [field-sizing:content]"
                      style={{ minHeight: '1.75rem' }}
                    />
                  </td>
                ))}
              </tr>
            ))}

            {/* Summer: Steam Fire Risk row */}
            {season === 'Summer' && (
              <tr>
                <td className={labelCell}>Steam Fire Risk</td>
                {steamFireRisk.map((v, i) => (
                  <td key={i} className="p-1 border border-[rgba(74,111,165,0.2)] align-top">
                    <SteamFireRiskCell
                      value={v as SteamFireRiskLevel}
                      isOpen={editing?.kind === 'steam' && editing.dayIdx === i}
                      onOpen={() => setEditing({ kind: 'steam', dayIdx: i })}
                      onClose={() => setEditing(null)}
                      onChange={val => updateSteamFire(i, val)}
                    />
                  </td>
                ))}
              </tr>
            )}

            {/* Autumn: Adhesion rows */}
            {season === 'Autumn' && (
              <>
                {([
                  { rowKey: 'eastMids' as const, label: 'East Mids Adhesion', data: eastMidsAdhesion },
                  { rowKey: 'lincoln'  as const, label: 'Lincoln Adhesion',   data: lincolnAdhesion  },
                ] as const).map(({ rowKey, label, data }) => (
                  <tr key={rowKey}>
                    <td className={labelCell}>{label}</td>
                    {data.map((v, i) => (
                      <td key={i} className="p-1 border border-[rgba(74,111,165,0.2)] align-top">
                        <AdhesionCell
                          value={v as AdhesionLevel}
                          isOpen={editing?.kind === 'adhesion' && editing.row === rowKey && editing.dayIdx === i}
                          onOpen={() => setEditing({ kind: 'adhesion', row: rowKey, dayIdx: i })}
                          onClose={() => setEditing(null)}
                          onChange={val => updateAdhesion(rowKey, i, val)}
                        />
                      </td>
                    ))}
                  </tr>
                ))}
              </>
            )}
          </tbody>
        </table>
      </div>

      {log.forecast?.summary24h && (
        <div className="grid md:grid-cols-2 gap-3 text-xs">
          <div className="rounded bg-[#0A0F1E] border border-[rgba(74,111,165,0.2)] p-2">
            <p className="text-[10px] text-[#4A6FA5] font-semibold uppercase tracking-wider mb-1">Forecast – 24 hours</p>
            <p className="text-[#C9D1E0] leading-relaxed">{log.forecast.summary24h}</p>
          </div>
          <div className="rounded bg-[#0A0F1E] border border-[rgba(74,111,165,0.2)] p-2">
            <p className="text-[10px] text-[#4A6FA5] font-semibold uppercase tracking-wider mb-1">Forecast – 2 to 7 days</p>
            <p className="text-[#C9D1E0] leading-relaxed">{log.forecast.summary2to7 || '—'}</p>
          </div>
        </div>
      )}
    </div>
  )
}

// ─── Step 2: Roster ─────────────────────────────────────────────────────────────

function RosterStep({ log, onChange, onNext, onBack, knownNames, onLearnNames, testMode }: {
  log:          LogState
  onChange:     (updates: Partial<LogState>) => void
  onNext:       () => void
  onBack:       () => void
  knownNames:   string[]
  onLearnNames: (names: string[]) => void
  testMode:     boolean
}) {
  const [importing, setImporting]       = useState(false)
  const [importMsg, setImportMsg]       = useState<string>('')
  const [importError, setImportError]   = useState<string>('')
  // The Log Date is system-derived (incident timestamps → header → default)
  // and displayed read-only. Manual editing exists only for exceptional cases
  // (e.g. backfilling an old day) behind an explicit unlock — hand-typed
  // dates are how days went missing from the analytics.
  const [dateUnlocked, setDateUnlocked] = useState(false)

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

  const importFromRosterhub = async () => {
    setImporting(true)
    setImportMsg('')
    setImportError('')
    try {
      const result = await fetchRosterFromHub(log.date)
      onChange({ roster: result.roster })
      onLearnNames(result.knownNames)
      const [y, m, d] = result.date.split('-').map(Number)
      const human = new Date(Date.UTC(y, m - 1, d)).toLocaleDateString('en-GB', {
        weekday: 'short', day: '2-digit', month: 'short', year: 'numeric', timeZone: 'UTC',
      })
      const parts: string[] = []
      parts.push(`Loaded ${result.roster.dayShift.length} day + ${result.roster.nightShift.length} night for ${human}`)
      if (result.sourceLinks.length > 0) parts.push(`from ${result.sourceLinks.join('+')}`)
      const notes: string[] = []
      if (result.leaveSkipped > 0) notes.push(`${result.leaveSkipped} on leave`)
      if (result.skippedRows > 0)  notes.push(`${result.skippedRows} non-time cells`)
      if (notes.length > 0) parts.push(`· skipped: ${notes.join(', ')}`)
      setImportMsg(parts.join(' '))
    } catch (e: unknown) {
      setImportError(e instanceof Error ? e.message : String(e))
    } finally {
      setImporting(false)
    }
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
                    list="rosterhub-staff-names"
                    autoComplete="off"
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

  // Date-confidence checks. The log date drives report_date on every saved
  // incident row, so a wrong value here silently corrupts the analytics
  // (Insight) as well as this report. Two conditions are decisive and BLOCK
  // progress (mirrored by hard gates at the save boundary in supabaseClient);
  // the rest stay advisory.
  const todayISO = (() => {
    const d = new Date()
    const pad = (n: number) => n.toString().padStart(2, '0')
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
  })()
  const nowLdn = londonNow()
  const activePeriodDate = currentPeriodStartDate()

  // Blocker 1 — the chosen date's 06:00→06:00 period hasn't started yet. This
  // is the recurring "Sunday vanished from Insight" failure: a small-hours
  // upload stamped with the new day instead of the day being reported.
  const periodNotStarted = !!log.date &&
    (log.date > nowLdn.date || (log.date === nowLdn.date && nowLdn.time < '06:00'))

  // Blocker 2 — the incidents' own machine-stamped CCIL timestamps point
  // overwhelmingly at a different period than the chosen date. (Vote includes
  // carried-over incidents, whose timestamps are legitimately older, so the
  // threshold is high; the save-time gate re-checks precisely on fresh rows.)
  const rowVote = voteLogDate(log.incidents)
  const rowConflict = rowVote && rowVote.date !== log.date &&
    rowVote.share >= 0.7 && rowVote.total >= 5 ? rowVote : null

  const dateBlocker = periodNotStarted
    ? {
        text: `The Log Date is ${log.date}, but that 06:00→06:00 period has not started yet ` +
              `(it is ${nowLdn.time} UK time). A log compiled overnight covers the previous ` +
              `day — the period in progress right now is ${activePeriodDate}.`,
        fixDate: activePeriodDate,
        fixSource: undefined as 'rows' | undefined,
      }
    : rowConflict
    ? {
        text: `${rowConflict.votes} of ${rowConflict.total} incidents in this document are ` +
              `timestamped inside the ${rowConflict.date} 06:00→06:00 period, but the Log Date ` +
              `is ${log.date || 'not set'}. The incident timestamps are machine-stamped by ` +
              `CCIL, so the Log Date (from the hand-edited header) is almost certainly wrong.`,
        fixDate: rowConflict.date,
        fixSource: 'rows' as const,
      }
    : null

  const periodDate = log.period ? parsePeriodHeader(log.period)?.date : undefined
  const dateWarning = dateBlocker ? null :
    log.dateSource === 'fallback'
      ? 'The period header could not be read from the uploaded document, so the Log Date has defaulted to yesterday. Confirm the date and period below before generating.'
    : log.date === todayISO && log.incidents.length > 0 && log.dateSource !== 'rows'
      ? 'Log Date is today. A daily log covers the previous 06:00→06:00 period, so this should normally be yesterday’s date — check before generating.'
    : log.dateSource === 'header' && log.date &&
      Math.abs(new Date(log.date + 'T00:00:00Z').getTime() - new Date(todayISO + 'T00:00:00Z').getTime()) > 7 * 86_400_000
      ? `The document's period header reads as ${log.date}, more than a week from today. If this is a fresh daily log the header is probably wrong (a month typo, e.g. April for July, has caused this before) — correct the Log Date before generating.`
    : periodDate && log.date && periodDate !== log.date
      ? `The Period text reads as ${periodDate} but the Log Date is ${log.date}. One of them is wrong — the Log Date is what the report and analytics are filed under.`
    : null

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-semibold text-white mb-1">Shift Roster</h2>
        <p className="text-sm text-[#7A8BA8]">Enter staff on duty. This appears at the top of the PDF.</p>
      </div>

      {/* Log metadata */}
      <div className="card p-4 grid grid-cols-2 gap-4">
        <div>
          <label className="block text-xs text-[#7A8BA8] mb-1 font-semibold uppercase tracking-wider">Log Date</label>
          <div className="flex items-center gap-2">
            <input type="date" value={log.date} disabled={!dateUnlocked}
              onChange={e => onChange({ date: e.target.value })}
              className="w-full bg-[#0A0F1E] text-white text-sm px-3 py-2 rounded border border-[rgba(74,111,165,0.25)] focus:border-[#E05206] outline-none font-mono disabled:opacity-70 disabled:cursor-not-allowed" />
            {!dateUnlocked && (
              <button onClick={() => setDateUnlocked(true)}
                title="The Log Date is set by the system from the document itself. Unlock only for exceptional cases such as backfilling an old day."
                className="shrink-0 px-2.5 py-2 border border-[rgba(74,111,165,0.4)] text-[#7A8BA8] text-xs rounded hover:text-white transition-colors">
                Unlock
              </button>
            )}
          </div>
          <p className="mt-1 text-[10px] text-[#4A5A72] leading-snug">
            {log.dateSource === 'rows'
              ? 'Set by the system from the incidents’ own CCIL timestamps.'
              : log.dateSource === 'header'
              ? 'Set by the system from the document’s period header.'
              : log.dateSource === 'fallback'
              ? 'Defaulted to yesterday — the document’s dates could not be read.'
              : 'Default for a manually-entered log.'}
            {dateUnlocked && ' Manual editing unlocked — integrity checks still apply on save.'}
          </p>
        </div>
        <div>
          <label className="block text-xs text-[#7A8BA8] mb-1 font-semibold uppercase tracking-wider">Period</label>
          <input type="text" value={log.period} placeholder="e.g. 21 Apr 2026 06:00 TO 22 Apr 2026 06:00"
            onChange={e => onChange({ period: e.target.value })}
            className="w-full bg-[#0A0F1E] text-white text-sm px-3 py-2 rounded border border-[rgba(74,111,165,0.25)] focus:border-[#E05206] outline-none" />
        </div>
      </div>

      {dateBlocker && (
        <div className="card p-3 border border-[rgba(192,57,43,0.5)] bg-[rgba(192,57,43,0.1)] space-y-2">
          <div className="flex items-start gap-2">
            <AlertCircle size={16} className="text-red-400 mt-0.5 shrink-0" />
            <p className="text-xs text-red-400 leading-relaxed">
              <span className="font-bold">Log Date blocked — </span>{dateBlocker.text}
            </p>
          </div>
          <button
            onClick={() => onChange({ date: dateBlocker.fixDate, dateSource: dateBlocker.fixSource })}
            className="ml-6 px-3 py-1.5 bg-[#C0392B] text-white text-xs font-semibold rounded hover:bg-[#a93226] transition-colors">
            Set Log Date to {dateBlocker.fixDate}
          </button>
        </div>
      )}

      {dateWarning && (
        <div className="card p-3 border border-[rgba(243,156,18,0.4)] bg-[rgba(243,156,18,0.08)] flex items-start gap-2">
          <AlertTriangle size={16} className="text-[#F39C12] mt-0.5 shrink-0" />
          <p className="text-xs text-[#F39C12] leading-relaxed">{dateWarning}</p>
        </div>
      )}

      <LookAheadSection log={log} onChange={onChange} testMode={testMode} />

      {isRosterhubConfigured() && (
        <div className="card p-4">
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <div>
              <h3 className="text-sm font-semibold text-white">Import from rosterhub</h3>
              <p className="text-xs text-[#7A8BA8] mt-0.5">
                Auto-fills day / night shifts for the Log Date above using the published roster.
                You can still edit names and times after import.
              </p>
            </div>
            <button
              onClick={importFromRosterhub}
              disabled={importing || !log.date}
              className="flex items-center gap-2 px-4 py-2 bg-[#4A6FA5] text-white text-xs font-semibold rounded hover:bg-[#5A7FB5] disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              {importing
                ? <><Loader2 size={14} className="animate-spin" /> Importing…</>
                : <><CloudDownload size={14} /> Import roster</>}
            </button>
          </div>
          {importMsg && (
            <div className="mt-3 text-xs text-[#27AE60] font-mono flex items-start gap-2">
              <Check size={12} className="mt-0.5 flex-shrink-0" />
              <span>{importMsg}</span>
            </div>
          )}
          {importError && (
            <div className="mt-3 text-xs text-red-400 flex items-start gap-2">
              <AlertCircle size={12} className="mt-0.5 flex-shrink-0" />
              <span>{importError}</span>
            </div>
          )}
        </div>
      )}

      {knownNames.length > 0 && (
        <datalist id="rosterhub-staff-names">
          {knownNames.map(n => <option key={n} value={n} />)}
        </datalist>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        {renderShiftTable('dayShift',   '◑  Day Shift')}
        {renderShiftTable('nightShift', '◐  Night Shift')}
      </div>

      <div className="flex gap-3 pt-2">
        <button onClick={onBack} className="px-6 py-2.5 border border-[rgba(74,111,165,0.4)] text-[#7A8BA8] text-sm rounded hover:text-white transition-colors">
          ← Back
        </button>
        <button onClick={onNext} disabled={!!dateBlocker}
          title={dateBlocker ? 'Fix the Log Date above to continue' : undefined}
          className="flex-1 py-2.5 bg-[#E05206] text-white text-sm font-semibold rounded hover:bg-[#c44804] disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:bg-[#E05206] transition-colors">
          Continue to Review →
        </button>
      </div>
    </div>
  )
}

// ─── Step 3: Review ─────────────────────────────────────────────────────────────

const CAT_ICON_MAP: Partial<Record<IncidentCategory, typeof Shield>> = {
  FATALITY: Shield, PERSON_STRUCK: Shield, SPAD: AlertTriangle,
  FIRE: Flame, CRIME: AlertCircle, HABD_WILD: Activity, NEAR_MISS: AlertTriangle,
}

function IncidentCard({ incident, onRemove, onToggleHighlight, onToggleOffRoute, onEdit }: {
  incident: Incident
  onRemove: () => void
  onToggleHighlight: () => void
  onToggleOffRoute: () => void
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
    <div className={cn(
      'card p-4 space-y-2 transition-all',
      incident.isOffRoute ? 'border-l-2 border-l-[#6B47DC] opacity-80' : incident.isHighlight ? 'border-l-2 border-l-[#E05206]' : ''
    )}>
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-start gap-2 min-w-0">
          <Icon size={14} className="shrink-0 mt-0.5" style={{ color: cat.color }} />
          <div className="min-w-0">
            <p className="text-white text-sm font-medium leading-snug line-clamp-2">{incident.title}</p>
            <div className="flex items-center gap-2 mt-0.5 flex-wrap">
              {incident.location && <span className="text-xs text-[#7A8BA8] font-mono">{incident.location}</span>}
              {incident.area && (
                <span className="text-xs font-mono px-1.5 py-0.5 rounded bg-[rgba(74,111,165,0.12)] border border-[rgba(74,111,165,0.3)] text-[#4A6FA5]" title="Area code from CCIL">
                  {incident.area}
                </span>
              )}
              {incident.ccil     && <span className="text-xs text-[#4A5A72] font-mono">CCIL {incident.ccil}</span>}
              {incident.incidentStart && <span className="text-xs text-[#4A5A72] font-mono">{incident.incidentStart}</span>}
              {incident.isContinuation && (
                <span className="text-xs font-mono px-1.5 py-0.5 rounded bg-[rgba(243,156,18,0.12)] border border-[rgba(243,156,18,0.3)] text-[#F39C12]">
                  carried over from prior log
                </span>
              )}
              {incident.isOffRoute && (
                <span className="text-xs font-mono px-1.5 py-0.5 rounded bg-[rgba(107,71,220,0.12)] border border-[rgba(107,71,220,0.4)] text-[#6B47DC]">
                  off route
                </span>
              )}
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
          <span style={{ color: cat.color }}>{incident.incidentTypeLabel || cat.shortLabel}</span>
          {incident.isContinuation
            ? (incident.delayDelta ?? 0) > 0
              ? <span className="text-[#F39C12]">+{(incident.delayDelta!).toLocaleString()} min additional delay</span>
              : (incident.minutesDelay || 0) > 0
                ? <span className="text-[#4A5A72]">{incident.minutesDelay!.toLocaleString()} min (no change)</span>
                : null
            : (incident.minutesDelay || 0) > 0
              ? <span className="text-[#4A5A72]">{incident.minutesDelay!.toLocaleString()} min delay</span>
              : null
          }
          {(incident.cancelled || 0) > 0 && <span className="text-[#4A5A72]">{incident.cancelled} cancelled</span>}
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
          <button onClick={onToggleOffRoute} title={incident.isOffRoute ? 'Mark as on route' : 'Mark as off route (excluded from totals)'}
            className={cn('p-1.5 rounded transition-colors', incident.isOffRoute ? 'text-[#6B47DC]' : 'text-[#4A5A72] hover:text-[#7A8BA8]')}>
            <MapPin size={12} />
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

  // On mount, query DB for prior occurrences of any CCIL in this log so that
  // carried-over incidents are flagged before the user reviews or exports.
  useEffect(() => {
    if (!isSupabaseConfigured()) return
    annotateWithContinuations(log).then(annotated => {
      onUpdate(annotated.incidents)
    }).catch(() => {})
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const cats = ['ALL', 'HIGHLIGHTS', 'OFF_ROUTE', ...Array.from(new Set(log.incidents.map(i => i.category)))]

  const filtered = filter === 'ALL'        ? log.incidents
    : filter === 'HIGHLIGHTS'              ? log.incidents.filter(i => i.isHighlight)
    : filter === 'OFF_ROUTE'               ? log.incidents.filter(i => i.isOffRoute)
    : log.incidents.filter(i => i.category === filter)

  const stats = {
    total:      log.incidents.filter(i => !i.isContinuation).length,
    highlights: log.incidents.filter(i => i.isHighlight && !i.isContinuation).length,
    critical:   log.incidents.filter(i => ['CRITICAL','HIGH'].includes(i.severity) && !i.isContinuation).length,
    offRoute:   log.incidents.filter(i => !!i.isOffRoute).length,
    routeMins:  log.incidents
      .filter(i => !i.isOffRoute)
      .reduce((s, i) => s + (i.isContinuation ? (i.delayDelta ?? 0) : (i.minutesDelay || 0)), 0),
    totalCan:   log.incidents.reduce((s, i) => s + (i.cancelled    || 0), 0),
    withArea:   log.incidents.filter(i => !!i.area).length,
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
      <div className="grid grid-cols-3 sm:grid-cols-7 gap-3">
        {[
          { label: 'Total',          value: stats.total,                                                               color: '#4A6FA5' },
          { label: 'Highlighted',    value: stats.highlights,                                                          color: '#E05206' },
          { label: 'Critical/High',  value: stats.critical,                                                            color: '#C0392B' },
          { label: 'Route Delay',    value: stats.routeMins.toLocaleString() + ' min',                                 color: '#F39C12' },
          { label: 'Cancelled',      value: stats.totalCan,                                                            color: '#E05206' },
          { label: 'Off Route',      value: stats.offRoute,                                                            color: '#6B47DC' },
          { label: 'Area codes',     value: `${stats.withArea}/${log.incidents.length}`,                               color: stats.withArea === log.incidents.length ? '#27AE60' : stats.withArea === 0 ? '#C0392B' : '#F39C12' },
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
          const count = cat === 'ALL'        ? stats.total
            : cat === 'HIGHLIGHTS'           ? stats.highlights
            : cat === 'OFF_ROUTE'            ? stats.offRoute
            : log.incidents.filter(i => i.category === cat && !i.isContinuation).length
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
                : cat === 'OFF_ROUTE'  ? `⊘ Off Route (${count})`
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
              onToggleOffRoute={() => toggle(inc.id, 'isOffRoute')}
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

// ─── ESR data card (Generate step) ──────────────────────────────────────────────
// nrsdb.uk blocks logins from hosted servers, so on production the operator
// supplies the feed from their own logged-in browser: open the feed address
// in a tab, Ctrl+A, Ctrl+C, click Paste here. The card validates the paste
// and says exactly what went wrong if it is the login page, a tree view, the
// wrong route, or cut off. Generate stays locked until the data is fresh or
// the operator explicitly chooses to build without it.

function EsrCard({ esr, loading, fresh, skipped, testMode, onSkip, onUnskip, onPasted }: {
  esr: EsrSnapshotResponse | null
  loading: boolean
  fresh: boolean
  skipped: boolean
  testMode: boolean
  onSkip: () => void
  onUnskip: () => void
  onPasted: (payload: unknown) => Promise<EsrSnapshotResponse>
}) {
  const [problem, setProblem]   = useState<string>('')
  const [manual, setManual]     = useState(false)
  const [manualText, setManualText] = useState('')
  const [busy, setBusy]         = useState(false)
  const routeCode = (esr && esr.ok ? esr.routeCode : '') || 'EM'
  const feedUrl = NRSDB_FEED_URL(routeCode)

  const submit = async (text: string) => {
    setProblem('')
    const parsed = parsePastedFeed(text, routeCode)
    if (!parsed.ok) { setProblem(parsed.message); return }
    setBusy(true)
    try {
      const r = await onPasted(parsed.payload)
      if (!r.ok) setProblem(r.message)
      else { setManual(false); setManualText('') }
    } finally { setBusy(false) }
  }

  const pasteFromClipboard = async () => {
    setProblem('')
    try {
      const text = await navigator.clipboard.readText()
      await submit(text)
    } catch {
      // Clipboard read refused (permission / browser policy): fall back to a
      // box the operator can Ctrl+V into.
      setManual(true)
      setProblem('This browser would not hand over the clipboard. Click in the box below and press Ctrl+V instead.')
    }
  }

  const fmt = (iso: string) => {
    const d = new Date(iso)
    return Number.isNaN(d.getTime()) ? iso : d.toLocaleString('en-GB', { timeZone: 'Europe/London', day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })
  }

  // ── Resolved states ──────────────────────────────────────────────────────
  const tone = fresh ? 'green' : skipped ? 'amber' : 'amber'
  const border = tone === 'green' ? 'border-[rgba(39,174,96,0.5)] bg-[rgba(39,174,96,0.06)]' : 'border-[rgba(243,156,18,0.5)] bg-[rgba(243,156,18,0.08)]'

  let headline: string
  let sub: string | null = null
  if (loading) { headline = 'Checking for ESR data…'; }
  else if (fresh && esr?.ok) {
    headline = `ESR data ready — ${esr.counts.active} imposed · ${esr.counts.new} new · ${esr.counts.amended} amended · ${esr.counts.removed} removed`
    sub = (esr.source === 'pasted' ? 'From the NRSDB feed you pasted' : esr.source === 'stored' ? 'From a snapshot taken earlier today' : 'Pulled live from NRSDB')
      + ` at ${fmt(esr.capturedAt)}`
      + (esr.baselineDate ? `, compared with ${esr.baselineDate}` : ', first snapshot so no comparison yet')
      + (esr.dryRun ? ' · Test Mode, not stored' : esr.persisted ? '' : ' · NOT STORED')
  } else if (skipped) {
    headline = 'Building without ESR data'
    sub = 'The PDF will state that no ESR data was supplied for this log.'
  } else if (esr?.ok && esr.source === 'stored') {
    headline = `Latest stored ESR snapshot is from ${esr.snapshotDate} — a fresh feed is needed for today`
    sub = 'Follow the three steps below. It takes about fifteen seconds.'
  } else {
    headline = 'ESR data needed — the server cannot reach NRSDB from here'
    sub = 'Follow the three steps below. It takes about fifteen seconds.'
  }

  return (
    <div className={cn('rounded border p-4 space-y-3', border)}>
      <div className="flex items-start gap-3">
        {loading ? <Loader2 size={16} className="animate-spin text-[#7A8BA8] mt-0.5 shrink-0" />
          : fresh ? <Check size={16} className="text-green-400 mt-0.5 shrink-0" />
          : <AlertTriangle size={16} className="text-amber-400 mt-0.5 shrink-0" />}
        <div className="min-w-0 flex-1">
          <p className={cn('text-sm font-semibold', fresh ? 'text-green-300' : 'text-amber-300')}>{headline}</p>
          {sub && <p className="text-xs text-[#7A8BA8] mt-0.5">{sub}</p>}
        </div>
      </div>

      {!loading && !fresh && !skipped && (
        <ol className="space-y-2 text-xs text-[#C9D3E3]">
          <li className="flex items-center gap-3">
            <span className="w-5 h-5 rounded-full bg-[#E05206] text-white text-[10px] font-bold flex items-center justify-center shrink-0">1</span>
            <a href={feedUrl} target="_blank" rel="noopener noreferrer"
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded bg-[#003366] text-white font-semibold hover:bg-[#00427f] transition-colors">
              <ExternalLink size={12} /> Open NRSDB feed
            </a>
            <span className="text-[#7A8BA8]">opens in a new tab — you must be logged in to NRSDB in this browser</span>
          </li>
          <li className="flex items-center gap-3">
            <span className="w-5 h-5 rounded-full bg-[#E05206] text-white text-[10px] font-bold flex items-center justify-center shrink-0">2</span>
            <span>In that tab press <kbd className="px-1 py-0.5 rounded bg-[#1A2740] font-mono">Ctrl</kbd>+<kbd className="px-1 py-0.5 rounded bg-[#1A2740] font-mono">A</kbd> then <kbd className="px-1 py-0.5 rounded bg-[#1A2740] font-mono">Ctrl</kbd>+<kbd className="px-1 py-0.5 rounded bg-[#1A2740] font-mono">C</kbd>, then come back here</span>
          </li>
          <li className="flex items-center gap-3">
            <span className="w-5 h-5 rounded-full bg-[#E05206] text-white text-[10px] font-bold flex items-center justify-center shrink-0">3</span>
            <button onClick={pasteFromClipboard} disabled={busy}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded bg-[#E05206] text-white font-semibold hover:bg-[#c44804] disabled:opacity-50 transition-colors">
              {busy ? <Loader2 size={12} className="animate-spin" /> : <ClipboardPaste size={12} />} Paste ESR data
            </button>
            <button onClick={() => { setManual(m => !m); setProblem('') }} className="text-[#7A8BA8] hover:text-white underline underline-offset-2">
              {manual ? 'hide paste box' : 'paste box instead'}
            </button>
          </li>
        </ol>
      )}

      {!loading && !fresh && !skipped && manual && (
        <div className="space-y-2">
          <textarea
            value={manualText}
            onChange={e => setManualText(e.target.value)}
            onPaste={e => { const t = e.clipboardData.getData('text'); if (t) { e.preventDefault(); setManualText(t); submit(t) } }}
            placeholder='Click here and press Ctrl+V. The data starts with {"count":'
            className="w-full h-24 text-xs font-mono p-2 rounded bg-[#0F1729] border border-[rgba(74,111,165,0.4)] text-white"
          />
          <button onClick={() => submit(manualText)} disabled={busy || !manualText.trim()}
            className="px-3 py-1.5 rounded bg-[#E05206] text-white text-xs font-semibold disabled:opacity-50">Use this data</button>
        </div>
      )}

      {problem && (
        <div className="flex items-start gap-2 p-3 rounded bg-[rgba(192,57,43,0.12)] border border-[rgba(192,57,43,0.4)] text-xs text-red-300">
          <AlertCircle size={13} className="mt-0.5 shrink-0" />
          <span>{problem}</span>
        </div>
      )}

      {!loading && !fresh && (
        <div className="pt-2 border-t border-[rgba(74,111,165,0.2)] flex items-center justify-between gap-3 text-xs">
          {skipped
            ? <button onClick={onUnskip} className="text-[#7A8BA8] hover:text-white underline underline-offset-2">Actually, I will supply the ESR feed</button>
            : <>
                <span className="text-[#4A5A72]">NRSDB unavailable? You can still build the log, and the PDF will say ESR data was not supplied.</span>
                <button onClick={onSkip} className="shrink-0 inline-flex items-center gap-1.5 px-3 py-1.5 rounded border border-[rgba(243,156,18,0.5)] text-amber-300 hover:bg-[rgba(243,156,18,0.15)] transition-colors">
                  <Ban size={12} /> Build without ESR data
                </button>
              </>}
        </div>
      )}

      {!loading && fresh && esr?.ok && esr.source !== 'live' && (
        <div className="pt-2 border-t border-[rgba(74,111,165,0.2)] text-xs text-[#4A5A72] flex items-center gap-3">
          <span>Need to refresh it?</span>
          <a href={feedUrl} target="_blank" rel="noopener noreferrer" className="text-[#7A8BA8] hover:text-white underline underline-offset-2 inline-flex items-center gap-1"><ExternalLink size={11} /> Open NRSDB feed</a>
          <button onClick={pasteFromClipboard} disabled={busy} className="text-[#7A8BA8] hover:text-white underline underline-offset-2 inline-flex items-center gap-1"><ClipboardPaste size={11} /> Paste again</button>
          {testMode && <span className="text-amber-400">(Test Mode: nothing is stored)</span>}
        </div>
      )}
    </div>
  )
}

// ─── Step 4: Generate ───────────────────────────────────────────────────────────

function GenerateStep({ log, onBack, testMode }: { log: LogState; onBack: () => void; testMode: boolean }) {
  const [generating, setGenerating] = useState(false)
  const [done, setDone]             = useState(false)
  const [error, setError]           = useState('')
  const [canOverride, setCanOverride] = useState(false)
  const [statusMsg, setStatusMsg]   = useState('')
  const [dbReports, setDbReports]   = useState<number | null>(null)
  const [esr, setEsr]               = useState<EsrSnapshotResponse | null>(null)
  const [esrLoading, setEsrLoading] = useState(true)
  const [esrSkipped, setEsrSkipped] = useState(false)
  const [oou, setOou]               = useState<(OouRegister & { error?: string }) | null>(null)

  // The Out of Use register is maintenance's, read as it stands. Fetched when
  // the step opens and again at build so a last-minute edit is not missed.
  useEffect(() => {
    let cancelled = false
    fetchOutOfUseRegister().then(r => { if (!cancelled) setOou(r) })
    return () => { cancelled = true }
  }, [])

  // Ask the server for ESR data as soon as the step opens: a live pull where
  // that works (local dev), otherwise today's stored snapshot if one exists.
  // On production NRSDB blocks the server, so most mornings this comes back
  // as "stored, from yesterday" or a failure and the operator pastes the feed.
  useEffect(() => {
    let cancelled = false
    setEsrLoading(true)
    fetchEsrSnapshot(log.date, { dryRun: testMode }).then(r => {
      if (!cancelled) { setEsr(r); setEsrLoading(false) }
    })
    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [log.date, testMode])

  const esrFresh = isEsrFresh(esr)
  const esrReady = esrFresh || esrSkipped

  const handle = async (force = false) => {
    setGenerating(true); setError(''); setCanOverride(false); setStatusMsg('')

    let chartImages: ChartImages | undefined
    // Use a local annotated copy so the PDF always reflects carryover status
    // even if the ReviewStep annotation hasn't propagated yet.
    let pdfLog = log

    try {
      if (isSupabaseConfigured()) {
        // 1. Annotate continuations (read-only), then push to Supabase —
        //    unless Test Mode is on, in which case nothing is written.
        setStatusMsg('Checking for carried-over incidents…')
        pdfLog = await annotateWithContinuations(log)

        if (testMode) {
          setStatusMsg('Test Mode — skipping database save…')
        } else {
          setStatusMsg('Syncing with database…')
          await upsertReportData(pdfLog, { force })
        }

        // 2. Fetch all historical data for chart rendering
        setStatusMsg('Fetching historical trends…')
        const historical = await fetchHistoricalData()

        if (historical && historical.trendPoints.length > 0) {
          setDbReports(historical.reportCount)
          // 3. Render Chart.js charts to PNG data URLs
          setStatusMsg('Rendering trend charts…')
          chartImages = await renderHistoricalCharts(historical)
        }
      }

      // 3b. ESR data was resolved when the step opened (live pull, today's
      // stored snapshot, or the feed the operator pasted). If the operator
      // chose to build without it, the PDF says so explicitly.
      const esrResult: EsrSnapshotResponse | null = esrFresh
        ? esr
        : { ok: false, reason: 'skipped', message: 'The operator built this log without ESR data (no fresh NRSDB feed was supplied).' }

      // 3c. Out of Use register — re-read at build time, read-only, never blocks.
      setStatusMsg('Reading Out of Use register…')
      const oouResult = await fetchOutOfUseRegister()
      setOou(oouResult)

      // 4. Build and download PDF (with charts + ESRs + register if available)
      setStatusMsg('Building PDF…')
      await generatePDF(pdfLog, chartImages, readCategorySettings(), esrResult, { testMode, outOfUse: oouResult })
      setDone(true)
    } catch (e: any) {
      setError(e.message || 'PDF generation failed')
      // Heuristic date gates may be consciously overridden; the
      // impossible-period gate may not.
      setCanOverride(e instanceof SaveBlockedError && e.overridable)
    } finally {
      setGenerating(false); setStatusMsg('')
    }
  }

  const highlights   = log.incidents.filter(i => i.isHighlight)
  const offRoute     = log.incidents.filter(i => i.isOffRoute)
  const routeDelay   = log.incidents
    .filter(i => !i.isOffRoute)
    .reduce((s, i) => s + (i.minutesDelay || 0), 0)
  const totalCan     = log.incidents.reduce((s, i) => s + (i.cancelled || 0), 0)

  const summaryRows = [
    { l: 'Total incidents',  v: log.incidents.length },
    { l: 'Highlighted',      v: highlights.length },
    { l: 'Off route',        v: offRoute.length },
    { l: 'Route delay',      v: `${routeDelay.toLocaleString()} min` },
    { l: 'Cancellations',    v: totalCan },
    { l: 'Person Struck',     v: log.incidents.filter(i => ['FATALITY','PERSON_STRUCK'].includes(i.category)).length },
    { l: 'SPADs',             v: log.incidents.filter(i => i.category === 'SPAD').length },
    { l: 'TPWS',              v: log.incidents.filter(i => i.category === 'TPWS').length },
    { l: 'Near Misses',       v: log.incidents.filter(i => i.category === 'NEAR_MISS').length },
    { l: 'Crime / Trespass',  v: log.incidents.filter(i => i.category === 'CRIME').length },
    { l: 'Irregular Working', v: log.incidents.filter(i => i.category === 'IRREGULAR_WORKING').length },
  ]

  return (
    <div className="max-w-2xl mx-auto space-y-6">
      <div>
        <h2 className="text-xl font-semibold text-white mb-1">Generate PDF Report</h2>
        <p className="text-sm text-[#7A8BA8]">Review summary then generate the OFFICIAL-SENSITIVE PDF.</p>
      </div>

      <EsrCard
        esr={esr}
        loading={esrLoading}
        fresh={esrFresh}
        skipped={esrSkipped}
        testMode={testMode}
        onSkip={() => setEsrSkipped(true)}
        onUnskip={() => setEsrSkipped(false)}
        onPasted={async (payload) => {
          setEsrLoading(true); setEsrSkipped(false)
          const r = await fetchEsrSnapshot(log.date, { dryRun: testMode, payload })
          setEsr(r); setEsrLoading(false)
          return r
        }}
      />

      {testMode && (
        <div className="flex items-start gap-3 p-4 rounded bg-[rgba(243,156,18,0.12)] border border-[rgba(243,156,18,0.5)]">
          <FlaskConical size={16} className="text-amber-400 mt-0.5 shrink-0" />
          <div className="text-sm">
            <p className="text-amber-300 font-semibold">Test Mode is on — nothing will be saved.</p>
            <p className="text-[#C9A257] text-xs mt-0.5">
              The PDF builds exactly as normal (continuation check, historical charts and the NRSDB ESR pull all run read-only),
              but no report, incidents, weather statement or ESR snapshot are written. The PDF is watermarked TEST and saved with a _TEST suffix.
            </p>
          </div>
        </div>
      )}

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
          <div className="flex items-center gap-2"><Check size={11} className="text-[#27AE60]" /> 7 Day Look Ahead {log.forecast ? `(forecast ${describeIssue(log.forecast).replace(/^Issued /, 'issued ')})` : '(manual entry — no forecast PDF loaded)'}</div>
          {esrFresh && esr?.ok
            ? <div className="flex items-center gap-2">
                <Check size={11} className="text-[#27AE60]" />
                Emergency Speed Restrictions
                <span className="text-[#7A8BA8]">
                  ({esr.counts.active} imposed · {esr.counts.new} new · {esr.counts.amended} amended · {esr.counts.removed} removed
                  {esr.baselineDate ? ` vs ${esr.baselineDate}` : ' · first snapshot'})
                </span>
              </div>
            : esrSkipped
            ? <div className="flex items-center gap-2 text-amber-400"><Ban size={11} /> Emergency Speed Restrictions — building WITHOUT ESR data (stated on the PDF)</div>
            : <div className="flex items-center gap-2 text-amber-400"><AlertTriangle size={11} /> Emergency Speed Restrictions — needs the NRSDB feed (see above)</div>
          }
          {log.rawLogText && <div className="flex items-center gap-2"><Check size={11} className="text-[#27AE60]" /> Verbatim CCIL log appendix</div>}
          {oou && (oou.source === 'cloud' || oou.items.length > 0) && (
            oou.error
              ? <div className="flex items-center gap-2 text-amber-400"><AlertTriangle size={11} /> Out of Use register could not be read ({oou.error})</div>
              : <div className="flex items-center gap-2">
                  <Check size={11} className="text-[#27AE60]" />
                  Out of Use Infrastructure Register
                  <span className="text-[#7A8BA8]">
                    ({oou.items.length} item{oou.items.length === 1 ? '' : 's'}
                    {(() => { const c = ragCounts(oou.items); const bits = [c.RED && `${c.RED} red`, c.AMBER && `${c.AMBER} amber`, c.GREEN && `${c.GREEN} green`, c.UNRATED && `${c.UNRATED} not assessed`].filter(Boolean); return bits.length ? ` · ${bits.join(' · ')}` : '' })()}
                    {oou.lastUpdated ? ` · last change ${oouAgo(oou.lastUpdated)}` : ''}{oou.source === 'local' ? ' · this browser only' : ''})
                  </span>
                  <a href="/out-of-use" target="_blank" rel="noopener noreferrer" className="text-[#4A6FA5] hover:text-white underline underline-offset-2">open</a>
                </div>
          )}
          {isSupabaseConfigured() && (
            testMode
              ? <div className="flex items-center gap-2 text-amber-400"><FlaskConical size={11} /> Database save SKIPPED (Test Mode)</div>
              : <div className="flex items-center gap-2"><Check size={11} className="text-[#27AE60]" /> Report, incidents &amp; weather statement saved to database</div>
          )}
          {isSupabaseConfigured()
            ? <div className="flex items-center gap-2">
                <Check size={11} className="text-[#27AE60]" />
                Historical trend charts
                {dbReports !== null && <span className="text-[#7A8BA8]">({dbReports} report{dbReports !== 1 ? 's' : ''} in DB)</span>}
              </div>
            : <div className="flex items-center gap-2 text-[#4A5A72] opacity-50">
                <span className="w-[11px] h-[11px] rounded-full border border-current inline-block" />
                Historical trends (Supabase not configured)
              </div>
          }
        </div>
      </div>

      {error && (
        <div className="p-4 rounded bg-[rgba(192,57,43,0.1)] border border-[rgba(192,57,43,0.3)] space-y-3">
          <div className="flex items-start gap-3">
            <AlertCircle size={16} className="text-red-400 mt-0.5 shrink-0" />
            <p className="text-red-400 text-sm font-mono">{error}</p>
          </div>
          {canOverride && (
            <button onClick={() => handle(true)} disabled={generating}
              className="ml-7 px-3 py-1.5 border border-[rgba(192,57,43,0.5)] text-red-400 text-xs font-semibold rounded hover:bg-[rgba(192,57,43,0.15)] disabled:opacity-50 transition-colors">
              I have verified the Log Date is correct — save anyway
            </button>
          )}
        </div>
      )}

      {done && (
        <div className="flex items-center gap-3 p-4 rounded bg-[rgba(39,174,96,0.1)] border border-[rgba(39,174,96,0.3)]">
          <Check size={16} className="text-green-400" />
          <p className="text-green-400 text-sm font-medium">
            {testMode ? 'TEST PDF downloaded — nothing was saved.' : 'PDF downloaded successfully.'}
            {dbReports !== null && ` Historical trends from ${dbReports} report${dbReports !== 1 ? 's' : ''} included.`}
            {esr?.ok && ` ${esr.counts.active} ESR${esr.counts.active !== 1 ? 's' : ''} listed.`}
          </p>
        </div>
      )}

      <div className="space-y-2">
        <button onClick={() => handle()} disabled={generating || !esrReady}
          title={!esrReady ? 'Supply the NRSDB ESR feed above, or choose to build without it.' : undefined}
          className={cn(
            'w-full py-3 text-white text-sm font-bold rounded flex items-center justify-center gap-3 transition-all',
            (generating || !esrReady) ? 'bg-[#4A6FA5] cursor-not-allowed'
              : testMode ? 'bg-[#B7791F] hover:bg-[#9A6519]'
              : 'bg-[#E05206] hover:bg-[#c44804]'
          )}>
          {generating
            ? <><Loader2 size={16} className="animate-spin" /> {statusMsg || 'Building PDF…'}</>
            : done
            ? <><RefreshCw size={16} /> {testMode ? 'Regenerate TEST PDF' : 'Regenerate PDF'}</>
            : testMode
            ? <><FlaskConical size={16} /> Generate TEST PDF (no save)</>
            : <><Download size={16} /> Generate &amp; Download PDF</>}
        </button>
        <p className="text-center text-xs text-[#4A5A72] font-mono">
          {testMode ? 'TEST MODE — output is watermarked and not a live log' : 'OFFICIAL-SENSITIVE — Handle per NR information policy'}
        </p>
      </div>

      <button onClick={onBack} className="w-full py-2.5 border border-[rgba(74,111,165,0.4)] text-[#7A8BA8] text-sm rounded hover:text-white transition-colors">← Back to Review</button>
    </div>
  )
}

// ─── Test Mode toggle (header) ────────────────────────────────────────────────

function TestModeToggle({ on, onChange }: { on: boolean; onChange: (v: boolean) => void }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      aria-label="Test Mode"
      title={on
        ? 'Test Mode ON — Generate writes nothing to the database. Click to return to live.'
        : 'Test Mode OFF — live. Click to run the process without saving anything.'}
      onClick={() => onChange(!on)}
      className={cn(
        'flex items-center gap-2 px-2 py-1 rounded border text-xs font-mono transition-colors',
        on
          ? 'border-amber-400 bg-[rgba(243,156,18,0.15)] text-amber-300'
          : 'border-[rgba(74,111,165,0.4)] text-[#4A5A72] hover:text-[#7A8BA8]'
      )}
    >
      <FlaskConical size={12} />
      <span>Test Mode</span>
      <span className={cn(
        'relative inline-block w-7 h-3.5 rounded-full transition-colors',
        on ? 'bg-amber-400' : 'bg-[#2A3A55]'
      )}>
        <span className={cn(
          'absolute top-0.5 w-2.5 h-2.5 rounded-full bg-white transition-all',
          on ? 'left-4' : 'left-0.5'
        )} />
      </span>
    </button>
  )
}

// ─── Root app ─────────────────────────────────────────────────────────────────

export default function Home() {
  const [step, setStep] = useState(1)
  const [log,  setLog]  = useState<LogState>(BLANK_LOG)
  const [knownNames, setKnownNames] = useState<string[]>([])
  const [testMode, setTestMode] = useTestMode()

  // Set a default date safely after mount — avoids SSR/client hydration
  // mismatch. Default to the date of the 06:00→06:00 period currently in
  // progress: for a night-shift operator compiling a blank log at 02:00 that
  // is YESTERDAY's date, not today's — the old today-default is how logs got
  // filed a day late and blanked their real day in the analytics.
  useEffect(() => {
    setLog(prev => prev.date ? prev : { ...prev, date: currentPeriodStartDate() })
  }, [])

  // Preload the rosterhub staff directory so manual entry has typeahead even
  // before the user clicks Import. Silent failure: if rosterhub isn't
  // configured or the table isn't publicly readable, autocomplete is just off.
  useEffect(() => {
    if (!isRosterhubConfigured()) return
    fetchKnownStaffNames().then(names => {
      if (names.length > 0) setKnownNames(prev => mergeNames(prev, names))
    })
  }, [])

  const learnNames = useCallback((names: string[]) => {
    setKnownNames(prev => mergeNames(prev, names))
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
            <a href="/out-of-use" target="_blank" rel="noopener noreferrer" title="Out of Use Infrastructure Register — maintained by maintenance, printed at the end of every log. Opens in a new tab; the register page has no way back here."
              className="inline-flex items-center gap-1 text-xs px-2 py-1 rounded border border-[rgba(74,111,165,0.35)] text-[#7A8BA8] hover:text-white hover:border-[#4A6FA5] transition-colors font-mono">
              <ExternalLink size={11} /> Out of Use Register
            </a>
            <a href="/settings" className="text-xs text-[#4A5A72] hover:text-[#7A8BA8] transition-colors font-mono">Settings</a>
            <TestModeToggle on={testMode} onChange={setTestMode} />
            <span className={cn('pulse-dot w-2 h-2 rounded-full inline-block', testMode ? 'bg-amber-400' : 'bg-[#27AE60]')} />
            <LiveClock />
          </div>
        </div>
      </header>

      {testMode && (
        <div className="bg-[#B7791F] text-[#0F1729]">
          <div className="max-w-5xl mx-auto px-6 py-1.5 flex items-center gap-2 text-xs font-semibold">
            <FlaskConical size={13} />
            TEST MODE — run the full process as normal; on Generate nothing is written to the database and the PDF is watermarked TEST.
          </div>
        </div>
      )}

      {/* Step bar */}
      <div className="border-b border-[rgba(74,111,165,0.15)] bg-[#0F1729]">
        <div className="max-w-5xl mx-auto px-6 py-3">
          <StepBar current={step} />
        </div>
      </div>

      {/* Content */}
      <main className="max-w-5xl mx-auto px-6 py-8">
        {step === 1 && <UploadStep onComplete={onUploadComplete} testMode={testMode} />}
        {step === 2 && (
          <RosterStep log={log} onChange={update}
            onNext={() => setStep(3)} onBack={() => setStep(1)}
            knownNames={knownNames} onLearnNames={learnNames} testMode={testMode} />
        )}
        {step === 3 && (
          <ReviewStep log={log}
            onUpdate={incidents => update({ incidents })}
            onNext={() => setStep(4)} onBack={() => setStep(2)} />
        )}
        {step === 4 && <GenerateStep log={log} onBack={() => setStep(3)} testMode={testMode} />}
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
