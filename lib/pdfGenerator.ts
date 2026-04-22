'use client'

import { LogState, Incident, CATEGORY_CONFIG, ShiftSlot } from './types'

type RGB = [number, number, number]

const C: Record<string, RGB> = {
  orange:   [224,  82,   6],
  navy:     [  0,  31,  69],
  blue:     [  0,  51, 102],
  steel:    [ 74, 111, 165],
  red:      [192,  57,  43],
  amber:    [243, 156,  18],
  green:    [ 39, 174,  96],
  white:    [255, 255, 255],
  offWhite: [248, 249, 252],
  lightGray:[220, 225, 232],
  midGray:  [160, 175, 195],
  darkGray: [ 44,  62,  80],
  pageBg:   [248, 249, 252],
}

const SEV_COLOR: Record<string, RGB> = {
  CRITICAL: C.red,
  HIGH:     C.orange,
  MEDIUM:   C.amber,
  LOW:      C.steel,
  INFO:     C.midGray,
}

// ─── Main export ──────────────────────────────────────────────────────────────

export async function generatePDF(log: LogState): Promise<void> {
  const { jsPDF }   = await import('jspdf')
  const autoTable   = (await import('jspdf-autotable')).default

  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' })
  const W = 210, H = 297, M = 14
  let y = 0

  // ── Helpers ──────────────────────────────────────────────────────────────

  const sf  = (style: 'normal'|'bold'|'italic' = 'normal', size = 10) => {
    doc.setFont('helvetica', style); doc.setFontSize(size)
  }
  const stc = (rgb: RGB) => doc.setTextColor(...rgb)
  const sfc = (rgb: RGB) => doc.setFillColor(...rgb)
  const sdc = (rgb: RGB) => doc.setDrawColor(...rgb)
  const tx  = (s: string, x: number, yy: number, opts?: any) => doc.text(s, x, yy, opts)
  const rc  = (x: number, yy: number, w: number, h: number, style: 'F'|'S'|'FD' = 'F') => doc.rect(x, yy, w, h, style)
  const ln  = (x1: number, y1: number, x2: number, y2: number) => doc.line(x1, y1, x2, y2)

  // Track lastY from autoTable — jsPDF-autotable sets doc.lastAutoTable
  const getAutoY = () => (doc as any).lastAutoTable?.finalY ?? y

  const newPage = () => {
    doc.addPage()
    drawCompactHeader()
    y = 22
  }

  const checkPage = (need: number) => { if (y + need > H - 18) newPage() }

  // ── Cover header (page 1) ─────────────────────────────────────────────────

  const drawCoverHeader = (): number => {
    sfc(C.navy); rc(0, 0, W, 52)
    sfc(C.orange); rc(0, 52, W, 4)
    // Classification bar
    sfc([160, 45, 25]); rc(0, 56, W, 7)
    sf('bold', 7); stc(C.white)
    tx('OFFICIAL – SENSITIVE  |  NOT FOR GENERAL DISTRIBUTION', W/2, 61, { align: 'center' })
    // Logo wordmark
    sf('bold', 20); stc(C.white); tx('NetworkRail', M, 19)
    sf('normal', 8); stc(C.steel); tx('EAST MIDLANDS CONTROL CENTRE', M, 27)
    // Report title
    sf('bold', 24); stc(C.orange); tx('DAILY', M, 42)
    sf('normal', 24); stc(C.white); tx(' OPERATIONS REPORT', M + 28, 42)
    // Date top-right
    const dateStr = log.date ? formatDisplayDate(log.date) : ''
    sf('bold', 9); stc(C.orange); tx(dateStr, W - M, 19, { align: 'right' })
    sf('normal', 7); stc(C.midGray); tx(log.period || '', W - M, 26, { align: 'right' })
    return 70
  }

  const drawCompactHeader = () => {
    sfc(C.navy); rc(0, 0, W, 14)
    sfc(C.orange); rc(0, 14, W, 2)
    sf('bold', 8); stc(C.white); tx('EMCC DAILY OPERATIONS REPORT', M, 9)
    sf('normal', 7); stc(C.steel)
    tx(log.date ? formatDisplayDate(log.date) : '', W - M, 9, { align: 'right' })
    sf('bold', 6); stc([180, 50, 30]); tx('OFFICIAL – SENSITIVE', W/2, 9, { align: 'center' })
  }

  // ── Footer ────────────────────────────────────────────────────────────────

  const drawFooter = (p: number, total: number) => {
    sfc(C.navy); rc(0, H - 12, W, 12)
    sf('normal', 6.5); stc(C.midGray)
    tx('Network Rail Infrastructure Ltd  |  East Midlands Control Centre', M, H - 5)
    tx(`Page ${p} of ${total}`, W/2, H - 5, { align: 'center' })
    tx(log.createdBy ? `Compiled: ${log.createdBy}` : 'OFFICIAL – SENSITIVE', W - M, H - 5, { align: 'right' })
  }

  // ── Section heading ───────────────────────────────────────────────────────

  const sectionHead = (title: string, sub?: string) => {
    checkPage(16)
    sfc(C.blue); rc(M, y, W - M*2, 9)
    sfc(C.orange); rc(M, y, 3, 9)
    sf('bold', 9); stc(C.white); tx(title, M + 6, y + 6.2)
    if (sub) { sf('normal', 7); stc(C.steel); tx(sub, W - M, y + 6.2, { align: 'right' }) }
    y += 14
  }

  // ── Roster grid ───────────────────────────────────────────────────────────

  const drawRosterHalf = (slots: ShiftSlot[], label: string, xOff: number): number => {
    const colW = (W - M*2) / 2 - 2
    const sx = M + xOff
    // Shift label
    sfc(C.steel); rc(sx, y, colW, 7)
    sf('bold', 8); stc(C.white); tx(label, sx + colW/2, y + 5, { align: 'center' })
    let ry = y + 8
    // Column headers
    sfc(C.lightGray); rc(sx, ry, colW, 6)
    sf('bold', 7); stc(C.darkGray)
    tx('ROLE', sx + 2, ry + 4.2)
    tx('NAME', sx + colW * 0.38, ry + 4.2)
    tx('PERIOD', sx + colW * 0.78, ry + 4.2)
    ry += 7
    slots.forEach((slot, i) => {
      sfc(i % 2 === 0 ? C.white : C.offWhite); rc(sx, ry, colW, 7)
      sf('bold', 7); stc(C.steel); tx(slot.role, sx + 2, ry + 4.8)
      sf('normal', 7); stc(slot.name ? C.darkGray : C.midGray)
      tx(slot.name || '—', sx + colW * 0.38, ry + 4.8)
      sf('normal', 6.5); stc(C.midGray)
      tx(`${slot.start}–${slot.end}`, sx + colW * 0.78, ry + 4.8)
      ry += 7
    })
    return ry
  }

  // ── Safety infographic stats bar ──────────────────────────────────────────

  const drawSafetyStats = (incidents: Incident[]) => {
    const stats = [
      { label: 'Person Struck', count: incidents.filter(i => ['FATALITY','PERSON_STRUCK'].includes(i.category)).length, urgent: true  },
      { label: 'SPADs',         count: incidents.filter(i => i.category === 'SPAD').length,              urgent: true  },
      { label: 'TPWS',          count: incidents.filter(i => i.category === 'TPWS').length,              urgent: false },
      { label: 'Near Misses',   count: incidents.filter(i => i.category === 'NEAR_MISS').length,        urgent: false },
      { label: 'Bridge Strikes',count: incidents.filter(i => i.category === 'BRIDGE_STRIKE').length,    urgent: true  },
      { label: 'Fires',         count: incidents.filter(i => i.category === 'FIRE').length,              urgent: true  },
      { label: 'Crime/Trespass',count: incidents.filter(i => i.category === 'CRIME').length,            urgent: false },
      { label: 'Irr. Working',  count: incidents.filter(i => i.category === 'IRREGULAR_WORKING').length,urgent: false },
    ]
    const boxW = (W - M*2) / stats.length
    stats.forEach((s, i) => {
      const bx = M + i * boxW
      const hasHit = s.count > 0
      const bg: RGB = hasHit ? (s.urgent ? C.red : C.navy) : C.offWhite
      sfc(bg); rc(bx, y, boxW - 1, 20)
      sf('bold', 16); stc(hasHit ? C.white : C.lightGray)
      tx(String(s.count), bx + (boxW-1)/2, y + 13, { align: 'center' })
      sf('normal', 5.5); stc(hasHit ? C.steel : C.midGray)
      tx(s.label.toUpperCase(), bx + (boxW-1)/2, y + 18.5, { align: 'center' })
    })
    y += 24
  }

  // ── Disruption summary bar ────────────────────────────────────────────────

  const drawDisruptionSummary = (incidents: Incident[]) => {
    const totalMins = incidents.reduce((s, i) => s + (i.minutesDelay || 0), 0)
    const totalCan  = incidents.reduce((s, i) => s + (i.cancelled    || 0), 0)
    const totalPCan = incidents.reduce((s, i) => s + (i.partCancelled|| 0), 0)
    const topInc    = [...incidents].sort((a,b) => (b.minutesDelay||0) - (a.minutesDelay||0))[0]

    const boxes = [
      { label: 'Total Delay',      value: `${totalMins.toLocaleString()} min`, color: C.amber  },
      { label: 'Cancellations',    value: String(totalCan),                    color: C.red    },
      { label: 'Part Cancelled',   value: String(totalPCan),                   color: C.orange },
      { label: 'Worst Incident',   value: topInc ? `${topInc.minutesDelay?.toLocaleString()} min` : '—', color: C.steel },
    ]
    const bw = (W - M*2) / boxes.length
    boxes.forEach((b, i) => {
      const bx = M + i * bw
      sfc(C.offWhite); rc(bx, y, bw - 2, 18)
      sfc(b.color); rc(bx, y, bw - 2, 2)
      sf('bold', 11); stc(b.color)
      tx(b.value, bx + (bw-2)/2, y + 12, { align: 'center' })
      sf('normal', 6); stc(C.midGray)
      tx(b.label.toUpperCase(), bx + (bw-2)/2, y + 17, { align: 'center' })
    })
    y += 22
  }

  // ─────────────────────────────────────────────────────────────────────────
  // BUILD DOCUMENT
  // ─────────────────────────────────────────────────────────────────────────

  y = drawCoverHeader()

  // ── 1. Roster ─────────────────────────────────────────────────────────────
  sectionHead('SHIFT ROSTER', log.period)
  const rosterStartY = y
  const dayEnd   = drawRosterHalf(log.roster.dayShift,   '◑  DAY SHIFT',   0)
  y = rosterStartY
  const nightEnd = drawRosterHalf(log.roster.nightShift, '◐  NIGHT SHIFT', (W - M*2)/2 + 2)
  y = Math.max(dayEnd, nightEnd) + 8

  // ── 2. Safety infographic ─────────────────────────────────────────────────
  newPage()
  sectionHead('SAFETY & INCIDENT SUMMARY', `${log.incidents.length} incidents · ${log.incidents.filter(i => i.isHighlight).length} highlighted`)
  drawSafetyStats(log.incidents)

  // ── 3. Disruption summary ─────────────────────────────────────────────────
  checkPage(28)
  sectionHead('DISRUPTION SUMMARY')
  drawDisruptionSummary(log.incidents)

  // ── 4. Highlighted incidents (cards) ──────────────────────────────────────
  const highlights = log.incidents.filter(i => i.isHighlight)
  if (highlights.length > 0) {
    checkPage(20)
    sectionHead('SIGNIFICANT INCIDENTS', `${highlights.length} flagged`)

    for (const inc of highlights) {
      checkPage(38)
      const cat      = CATEGORY_CONFIG[inc.category]
      const sevColor = SEV_COLOR[inc.severity] || C.midGray
      const cardH    = 34

      // Card background
      sfc(C.offWhite); rc(M, y, W - M*2, cardH)
      // Severity left bar
      sfc(sevColor); rc(M, y, 3, cardH)
      // Category badge
      sfc(C.navy); rc(W - M - 22, y + 2, 20, 6.5)
      sf('bold', 6); stc(C.orange)
      tx(cat.shortLabel, W - M - 12, y + 6.8, { align: 'center' })

      // CCIL ref + time
      sf('bold', 6); stc(C.midGray)
      tx(inc.ccil ? `CCIL ${inc.ccil}` : '', M + 5, y + 6)
      sf('normal', 6.5); stc(C.steel)
      const locStr = [inc.incidentStart, inc.location].filter(Boolean).join('  ·  ')
      tx(locStr, M + 5, y + 11)

      // Title
      sf('bold', 9); stc(C.blue)
      const titleLines = doc.splitTextToSize(inc.title, W - M*2 - 32)
      tx(titleLines.slice(0, 2), M + 5, y + 18)

      // Description snippet
      if (inc.description) {
        const desc = inc.description.length > 200 ? inc.description.slice(0, 200) + '…' : inc.description
        sf('normal', 6.5); stc(C.darkGray)
        const dl = doc.splitTextToSize(desc, W - M*2 - 10)
        tx(dl.slice(0, 2), M + 5, y + 26)
      }

      // Disruption figures right side
      if ((inc.minutesDelay || 0) > 0 || (inc.cancelled || 0) > 0) {
        sf('bold', 9); stc(sevColor)
        if (inc.minutesDelay) tx(`${inc.minutesDelay.toLocaleString()} min`, W - M - 4, y + 16, { align: 'right' })
        sf('normal', 6.5); stc(C.midGray)
        if (inc.cancelled)     tx(`${inc.cancelled} cancelled`, W - M - 4, y + 22, { align: 'right' })
        if (inc.partCancelled) tx(`${inc.partCancelled} part-can`, W - M - 4, y + 28, { align: 'right' })
      }

      y += cardH + 3
    }
  }

  // ── 5. Incident tables by category ────────────────────────────────────────

  const tableSections: Array<{ label: string; filter: (i: Incident) => boolean }> = [
    { label: 'SIGNALS PASSED AT DANGER (SPADs)',        filter: i => i.category === 'SPAD'              },
    { label: 'TPWS ACTIVATIONS',                        filter: i => i.category === 'TPWS'              },
    { label: 'BRIDGE STRIKES',                          filter: i => i.category === 'BRIDGE_STRIKE'     },
    { label: 'NEAR MISSES',                             filter: i => i.category === 'NEAR_MISS'         },
    { label: 'IRREGULAR WORKING',                       filter: i => i.category === 'IRREGULAR_WORKING' },
    { label: 'LEVEL CROSSING INCIDENTS',                filter: i => i.category === 'LEVEL_CROSSING'    },
    { label: 'FIRES & LINESIDE INCIDENTS',              filter: i => i.category === 'FIRE'              },
    { label: 'RAILWAY CRIME & TRESPASS',                filter: i => i.category === 'CRIME'             },
    { label: 'HABD / WILD ACTIVATIONS',                 filter: i => i.category === 'HABD_WILD'         },
    { label: 'PASSENGER & PUBLIC INJURIES / ASSAULTS',  filter: i => i.category === 'PASSENGER_INJURY'  },
    { label: 'PERSON STRUCK BY TRAIN / FATALITIES',     filter: i => ['FATALITY','PERSON_STRUCK'].includes(i.category) },
    { label: 'DERAILMENTS & COLLISIONS',                filter: i => i.category === 'DERAILMENT'        },
    { label: 'INFRASTRUCTURE FAILURES',                 filter: i => i.category === 'INFRASTRUCTURE'    },
    { label: 'TRACTION FAILURES',                       filter: i => i.category === 'TRACTION_FAILURE'  },
    { label: 'POSSESSION ISSUES',                       filter: i => i.category === 'POSSESSION'        },
  ]

  for (const sec of tableSections) {
    const items = log.incidents.filter(sec.filter)
    if (items.length === 0) continue

    checkPage(22)
    sectionHead(sec.label, `${items.length} incident${items.length !== 1 ? 's' : ''}`)

    const tableBody = items.map(i => [
      i.ccil || '—',
      i.location || '—',
      i.incidentStart || '—',
      i.title.length > 65 ? i.title.slice(0, 65) + '…' : i.title,
      (i.minutesDelay || 0) > 0 ? i.minutesDelay!.toLocaleString() : '—',
      (i.cancelled    || 0) > 0 ? String(i.cancelled) : '—',
      i.severity,
    ])

    autoTable(doc, {
      startY: y,
      head:   [['CCIL', 'Location', 'Time', 'Incident', 'Delay (min)', 'Cancelled', 'Sev']],
      body:   tableBody,
      margin: { left: M, right: M },
      theme:  'grid',
      headStyles:         { fillColor: C.blue, textColor: C.white, fontSize: 7, fontStyle: 'bold', cellPadding: 2.5 },
      bodyStyles:         { fontSize: 6.5, textColor: C.darkGray, cellPadding: 2 },
      alternateRowStyles: { fillColor: C.offWhite },
      columnStyles: {
        0: { cellWidth: 18 },
        1: { cellWidth: 30 },
        2: { cellWidth: 14 },
        3: { cellWidth: 'auto' },
        4: { cellWidth: 18, halign: 'right' as const },
        5: { cellWidth: 18, halign: 'right' as const },
        6: { cellWidth: 13 },
      },
      didParseCell: (data: any) => {
        if (data.section === 'body' && data.column.index === 6) {
          data.cell.styles.textColor = SEV_COLOR[data.cell.raw as string] || C.midGray
          data.cell.styles.fontStyle = 'bold'
        }
      },
    })

    y = getAutoY() + 8
  }

  // ── 6. Disruption impact ranked table ─────────────────────────────────────

  const byDelay = [...log.incidents]
    .filter(i => (i.minutesDelay || 0) > 0)
    .sort((a, b) => (b.minutesDelay || 0) - (a.minutesDelay || 0))
    .slice(0, 20)

  if (byDelay.length > 0) {
    checkPage(22)
    sectionHead('DISRUPTION IMPACT — TOP INCIDENTS BY DELAY')

    const totalMins = byDelay.reduce((s, i) => s + (i.minutesDelay || 0), 0)
    const totalCan  = byDelay.reduce((s, i) => s + (i.cancelled    || 0), 0)

    autoTable(doc, {
      startY: y,
      head: [['#', 'CCIL', 'Category', 'Location / Incident', 'Delay (min)', 'Cancelled', 'Part Can']],
      body: byDelay.map((i, idx) => [
        `#${idx + 1}`,
        i.ccil || '—',
        CATEGORY_CONFIG[i.category].shortLabel,
        `${i.location}  —  ${i.title.slice(0, 48)}`,
        i.minutesDelay?.toLocaleString() || '—',
        i.cancelled    || '—',
        i.partCancelled|| '—',
      ]),
      foot: [['', '', '', 'TOTAL', totalMins.toLocaleString(), totalCan, '']],
      margin: { left: M, right: M },
      theme:  'grid',
      headStyles: { fillColor: C.blue,  textColor: C.white,  fontSize: 7,   fontStyle: 'bold' },
      footStyles: { fillColor: C.navy,  textColor: C.orange, fontSize: 7.5, fontStyle: 'bold' },
      bodyStyles: { fontSize: 6.5, textColor: C.darkGray, cellPadding: 2 },
      alternateRowStyles: { fillColor: C.offWhite },
      columnStyles: {
        0: { cellWidth: 9  },
        1: { cellWidth: 18 },
        2: { cellWidth: 16 },
        3: { cellWidth: 'auto' },
        4: { cellWidth: 18, halign: 'right' as const },
        5: { cellWidth: 18, halign: 'right' as const },
        6: { cellWidth: 15, halign: 'right' as const },
      },
    })

    y = getAutoY() + 8
  }

  // ── 7. Verbatim CCIL appendix ─────────────────────────────────────────────
  // Preserve the raw markdown table formatting exactly as CCIL produced it.

  if (log.rawLogText) {
    newPage()
    sectionHead('APPENDIX — FULL CCIL LOG (VERBATIM)', 'Control Centre Incident Log export — unedited')

    sf('italic', 7); stc(C.midGray)
    tx('The following is the unedited CCIL export for this period. Contents are OFFICIAL-SENSITIVE.', M, y)
    y += 8

    // Render line by line preserving the pipe-table structure
    const rawLines = log.rawLogText.split('\n')
    sf('normal', 6)
    stc(C.darkGray)
    doc.setFont('courier', 'normal')  // monospace for table alignment
    doc.setFontSize(5.8)

    for (const raw of rawLines) {
      const line = raw.replace(/\r/g, '')
      checkPage(4)

      // Section dividers (--- lines) — draw as a thin rule
      if (/^\|?\s*---/.test(line)) {
        sdc(C.lightGray)
        doc.setLineWidth(0.2)
        ln(M, y, W - M, y)
        y += 1.5
        continue
      }

      // Render the raw text — preserve pipes and spacing
      const displayLine = line.length > 180 ? line.slice(0, 180) + '…' : line
      if (displayLine.trim()) {
        doc.text(displayLine, M, y, { maxWidth: W - M*2 })
      }
      y += 3.5
    }
  }

  // ── Add footers to all pages ──────────────────────────────────────────────

  const total = doc.getNumberOfPages()
  for (let p = 1; p <= total; p++) {
    doc.setPage(p)
    drawFooter(p, total)
  }

  // ── Save ──────────────────────────────────────────────────────────────────

  const dateStr = log.date ? log.date.replace(/-/g, '') : 'unknown'
  doc.save(`EMCC_Daily_Report_${dateStr}.pdf`)
}

// ─── Utility ──────────────────────────────────────────────────────────────────

function formatDisplayDate(iso: string): string {
  const [yyyy, mm, dd] = iso.split('-')
  const months = ['','Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']
  const days   = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday']
  try {
    const d = new Date(parseInt(yyyy), parseInt(mm) - 1, parseInt(dd))
    return `${days[d.getDay()]} ${parseInt(dd)} ${months[parseInt(mm)]} ${yyyy}`
  } catch {
    return iso
  }
}
