'use client'

import React, { useState, useCallback, useRef } from 'react'
import Link from 'next/link'
import { ArrowLeft, Upload, Loader2, CheckCircle2, XCircle, Clock, AlertTriangle, Database } from 'lucide-react'
import { parseCCILCSV, makeHistoricLogState, PeriodSlice } from '@/lib/bulkImport'
import { upsertReportData, isSupabaseConfigured } from '@/lib/supabaseClient'
import { readCategorySettings } from '@/lib/categorySettings'

// ─── Types ────────────────────────────────────────────────────────────────────

type Phase = 'idle' | 'parsing' | 'preview' | 'importing' | 'done'

interface RowResult {
  date: string
  period: string
  count: number
  status: 'pending' | 'saving' | 'saved' | 'error'
  error?: string
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function cn(...cls: (string | false | undefined | null)[]) {
  return cls.filter(Boolean).join(' ')
}

function formatDate(iso: string): string {
  const [y, m, d] = iso.split('-').map(Number)
  const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']
  return `${d} ${MONTHS[m - 1]} ${y}`
}

// ─── Status icon ──────────────────────────────────────────────────────────────

function StatusIcon({ status }: { status: RowResult['status'] }) {
  if (status === 'pending')
    return <Clock size={13} className="text-[#4A6FA5]" />
  if (status === 'saving')
    return <Loader2 size={13} className="text-[#F39C12] animate-spin" />
  if (status === 'saved')
    return <CheckCircle2 size={13} className="text-[#27AE60]" />
  return <XCircle size={13} className="text-[#E74C3C]" />
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function ImportPage() {
  const [phase, setPhase]         = useState<Phase>('idle')
  const [parseError, setParseError] = useState('')
  const [periods, setPeriods]     = useState<PeriodSlice[]>([])
  const [createdBy, setCreatedBy] = useState<string | undefined>()
  const [rows, setRows]           = useState<RowResult[]>([])
  const [currentIdx, setCurrentIdx] = useState(0)
  const [dragover, setDragover]   = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const supabaseReady = isSupabaseConfigured()

  // ── Parse uploaded file ────────────────────────────────────────────────────

  const processFile = useCallback(async (file: File) => {
    if (!file.name.endsWith('.csv')) {
      setParseError('Only .csv files are supported.')
      return
    }
    setParseError('')
    setPhase('parsing')

    try {
      const csvText = await file.text()

      const catSettings     = readCategorySettings()
      const groupSeverities = Object.fromEntries(
        Object.entries(catSettings.groups).map(([k, v]) => [k, v.severity])
      )

      const slices = parseCCILCSV(csvText, catSettings.labelOverrides, groupSeverities)

      if (slices.length === 0) {
        setParseError('No incidents found. Check the file is a valid CCIL CSV export.')
        setPhase('idle')
        return
      }

      setPeriods(slices)
      setCreatedBy(undefined)
      setRows(slices.map(s => ({
        date:   s.date,
        period: s.period,
        count:  s.incidents.length,
        status: 'pending',
      })))
      setPhase('preview')
    } catch (e) {
      setParseError(`Parse failed: ${e instanceof Error ? e.message : String(e)}`)
      setPhase('idle')
    }
  }, [])

  // ── Drop handlers ──────────────────────────────────────────────────────────

  const onDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    setDragover(false)
    const file = e.dataTransfer.files[0]
    if (file) processFile(file)
  }, [processFile])

  const onFileChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (file) processFile(file)
  }, [processFile])

  // ── Sequential import ──────────────────────────────────────────────────────

  const runImport = useCallback(async () => {
    setPhase('importing')

    for (let i = 0; i < periods.length; i++) {
      setCurrentIdx(i)
      setRows((prev: RowResult[]) => prev.map((r: RowResult, idx: number) => idx === i ? { ...r, status: 'saving' } : r))

      try {
        const log = makeHistoricLogState(periods[i], createdBy)
        await upsertReportData(log)
        setRows((prev: RowResult[]) => prev.map((r: RowResult, idx: number) => idx === i ? { ...r, status: 'saved' } : r))
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e)
        setRows((prev: RowResult[]) => prev.map((r: RowResult, idx: number) => idx === i ? { ...r, status: 'error', error: msg } : r))
      }
    }

    setPhase('done')
  }, [periods, createdBy])

  // ── Derived summary stats ──────────────────────────────────────────────────

  const totalIncidents  = rows.reduce((s: number, r: RowResult) => s + r.count, 0)
  const savedCount      = rows.filter((r: RowResult) => r.status === 'saved').length
  const errorCount      = rows.filter((r: RowResult) => r.status === 'error').length
  const firstDate       = rows[0]?.date
  const lastDate        = rows[rows.length - 1]?.date

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <div className="min-h-screen" style={{ background: 'var(--bg-primary)' }}>

      {/* ── Header ── */}
      <header className="border-b sticky top-0 z-10" style={{ background: 'var(--bg-secondary)', borderColor: 'var(--border)' }}>
        <div className="max-w-4xl mx-auto px-6 py-3 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-7 h-7 flex items-center justify-center rounded" style={{ background: '#E05206' }}>
              <Database size={14} className="text-white" />
            </div>
            <div>
              <p className="text-white text-sm font-bold leading-none">Historical Import</p>
              <p className="text-[#7A8BA8] text-xs leading-none font-mono">Bulk CCIL seeding · Network Rail</p>
            </div>
          </div>
          <Link href="/" className="flex items-center gap-1.5 text-xs text-[#7A8BA8] hover:text-white transition-colors font-mono">
            <ArrowLeft size={12} /> Back to Report Generator
          </Link>
        </div>
      </header>

      <main className="max-w-4xl mx-auto px-6 py-8 space-y-6">

        {/* ── Supabase warning ── */}
        {!supabaseReady && (
          <div className="flex items-start gap-3 p-4 rounded border" style={{ background: 'rgba(243,156,18,0.08)', borderColor: 'rgba(243,156,18,0.3)' }}>
            <AlertTriangle size={16} className="text-[#F39C12] mt-0.5 shrink-0" />
            <div>
              <p className="text-sm text-white font-semibold">Supabase not configured</p>
              <p className="text-xs text-[#7A8BA8] mt-0.5">
                Historical import requires a live Supabase connection. Add your credentials to <span className="font-mono text-[#E8EDF5]">.env.local</span> before proceeding.
              </p>
            </div>
          </div>
        )}

        {/* ── Intro card ── */}
        {phase === 'idle' && (
          <div className="card p-5 space-y-2">
            <h2 className="text-white font-semibold">Bulk Historical CCIL Import</h2>
            <p className="text-sm text-[#7A8BA8] leading-relaxed">
              Upload a multi-date CCIL export (covering weeks or months) and the system will automatically detect each 24-hour period, parse incidents correctly, and save them as individual daily reports — identical to uploading each day manually. Continuation incidents are detected in chronological order.
            </p>
            <ul className="text-xs text-[#7A8BA8] space-y-1 pt-1 font-mono">
              <li>· Shift boundary: 06:00 → 06:00 next day</li>
              <li>· Incidents before 06:00 roll back to the previous period</li>
              <li>· Each period upserts independently — safe to re-run</li>
            </ul>
          </div>
        )}

        {/* ── Upload zone ── */}
        {(phase === 'idle' || phase === 'parsing') && (
          <div
            className={cn('drop-zone rounded p-12 flex flex-col items-center justify-center gap-3 cursor-pointer', dragover && 'dragover')}
            onDragOver={(e) => { e.preventDefault(); setDragover(true) }}
            onDragLeave={() => setDragover(false)}
            onDrop={onDrop}
            onClick={() => fileInputRef.current?.click()}
          >
            <input ref={fileInputRef} type="file" accept=".csv" className="hidden" onChange={onFileChange} />
            {phase === 'parsing' ? (
              <>
                <Loader2 size={32} className="text-[#E05206] animate-spin" />
                <p className="text-sm text-[#7A8BA8]">Parsing CSV and splitting into periods…</p>
              </>
            ) : (
              <>
                <Upload size={32} className="text-[#4A6FA5]" />
                <div className="text-center">
                  <p className="text-sm text-[#E8EDF5] font-medium">Drop your CCIL CSV export here</p>
                  <p className="text-xs text-[#7A8BA8] mt-1">or click to browse · .csv files only</p>
                </div>
              </>
            )}
          </div>
        )}

        {parseError && (
          <div className="flex items-center gap-2 text-sm text-[#E74C3C] px-1">
            <XCircle size={14} />
            {parseError}
          </div>
        )}

        {/* ── Preview / results table ── */}
        {(phase === 'preview' || phase === 'importing' || phase === 'done') && rows.length > 0 && (
          <div className="space-y-4">

            {/* Summary bar */}
            <div className="flex items-center justify-between">
              <div className="space-y-0.5">
                <p className="text-white font-semibold text-sm">
                  {rows.length} period{rows.length !== 1 ? 's' : ''} detected
                  {firstDate && lastDate && firstDate !== lastDate && (
                    <span className="text-[#7A8BA8] font-normal font-mono text-xs ml-2">
                      {formatDate(firstDate)} → {formatDate(lastDate)}
                    </span>
                  )}
                </p>
                <p className="text-xs text-[#7A8BA8] font-mono">
                  {totalIncidents} total incidents
                  {createdBy && <span className="ml-2">· Created by {createdBy}</span>}
                </p>
              </div>

              {phase === 'preview' && (
                <button
                  disabled={!supabaseReady}
                  onClick={runImport}
                  className="flex items-center gap-2 px-4 py-2 text-sm font-semibold rounded transition-all disabled:opacity-40 disabled:cursor-not-allowed"
                  style={{ background: '#E05206', color: 'white' }}
                >
                  <Database size={14} />
                  Begin Import
                </button>
              )}

              {phase === 'importing' && (
                <div className="flex items-center gap-2 text-sm text-[#F39C12] font-mono">
                  <Loader2 size={14} className="animate-spin" />
                  Saving period {currentIdx + 1} of {rows.length}
                </div>
              )}

              {phase === 'done' && (
                <div className={cn(
                  'flex items-center gap-2 text-sm font-mono font-semibold',
                  errorCount === 0 ? 'text-[#27AE60]' : 'text-[#F39C12]'
                )}>
                  {errorCount === 0
                    ? <><CheckCircle2 size={14} /> Import complete</>
                    : <><AlertTriangle size={14} /> {errorCount} error{errorCount !== 1 ? 's' : ''}</>
                  }
                </div>
              )}
            </div>

            {/* Done summary */}
            {phase === 'done' && (
              <div className="p-3 rounded border text-xs font-mono" style={{ background: 'rgba(39,174,96,0.07)', borderColor: errorCount > 0 ? 'rgba(243,156,18,0.3)' : 'rgba(39,174,96,0.3)' }}>
                {savedCount} of {rows.length} periods saved · {totalIncidents} incidents · {errorCount} errors
                {errorCount === 0 && (
                  <span className="text-[#7A8BA8] ml-2">— historical trend charts will now reflect this data</span>
                )}
              </div>
            )}

            {/* Period table */}
            <div className="card overflow-hidden">
              <div className="grid text-xs font-mono text-[#7A8BA8] px-4 py-2 border-b" style={{ gridTemplateColumns: '1fr 2fr auto auto', borderColor: 'var(--border)' }}>
                <span>Date</span>
                <span>Period</span>
                <span className="text-right">Incidents</span>
                <span className="text-right pl-4">Status</span>
              </div>
              <div className="max-h-[480px] overflow-y-auto divide-y" style={{ borderColor: 'var(--border)' }}>
                {rows.map((row, i) => (
                  <div
                    key={row.date}
                    className="grid items-center px-4 py-2.5 text-xs"
                    style={{ gridTemplateColumns: '1fr 2fr auto auto' }}
                  >
                    <span className="font-mono text-[#E8EDF5]">{formatDate(row.date)}</span>
                    <span className="font-mono text-[#7A8BA8] truncate pr-2">{row.period}</span>
                    <span className="font-mono text-right text-[#4A6FA5]">{row.count}</span>
                    <span className="flex items-center justify-end gap-1.5 pl-4">
                      <StatusIcon status={row.status} />
                      <span className={cn(
                        'font-mono',
                        row.status === 'saved'  && 'text-[#27AE60]',
                        row.status === 'saving' && 'text-[#F39C12]',
                        row.status === 'error'  && 'text-[#E74C3C]',
                        row.status === 'pending' && 'text-[#4A6FA5]',
                      )}>
                        {row.status === 'pending' ? 'queued'
                          : row.status === 'saving' ? 'saving…'
                          : row.status === 'saved'  ? 'saved'
                          : 'error'}
                      </span>
                    </span>
                    {row.error && (
                      <span className="col-span-4 text-[#E74C3C] mt-1 pl-0 font-mono truncate" title={row.error}>
                        ↳ {row.error}
                      </span>
                    )}
                  </div>
                ))}
              </div>
            </div>

            {phase === 'done' && (
              <div className="flex items-center gap-4 pt-1">
                <Link href="/" className="text-xs font-mono text-[#7A8BA8] hover:text-white transition-colors flex items-center gap-1.5">
                  <ArrowLeft size={12} /> Return to Report Generator
                </Link>
                <button
                  onClick={() => { setPhase('idle'); setRows([]); setPeriods([]); setParseError('') }}
                  className="text-xs font-mono text-[#7A8BA8] hover:text-white transition-colors"
                >
                  Import another file
                </button>
              </div>
            )}
          </div>
        )}

      </main>
    </div>
  )
}
