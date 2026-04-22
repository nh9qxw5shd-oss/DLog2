'use client'

import { LogState, Incident, CATEGORY_CONFIG, ShiftSlot } from './types'
import { format, parseISO } from 'date-fns'

// ─── Colour palette (RGB tuples) ──────────────────────────────────────────────
const C = {
  nrOrange:  [224, 82,   6] as [number,number,number],
  nrNavy:    [0,   31,  69] as [number,number,number],
  nrBlue:    [0,   51, 102] as [number,number,number],
  nrSteel:   [74, 111, 165] as [number,number,number],
  red:       [192,  57,  43] as [number,number,number],
  amber:     [243, 156,  18] as [number,number,number],
  green:     [ 39, 174,  96] as [number,number,number],
  white:     [255, 255, 255] as [number,number,number],
  offWhite:  [245, 247, 250] as [number,number,number],
  lightGray: [220, 225, 232] as [number,number,number],
  midGray:   [160, 175, 195] as [number,number,number],
  darkGray:  [ 44,  62,  80] as [number,number,number],
  black:     [ 10,  15,  30] as [number,number,number],
  pageBg:    [248, 249, 252] as [number,number,number],
}

type RGB = [number, number, number]

// ─── Severity colours ─────────────────────────────────────────────────────────
const SEV_COLOR: Record<string, RGB> = {
  CRITICAL: C.red,
  HIGH:     C.nrOrange,
  MEDIUM:   C.amber,
  LOW:      C.nrSteel,
  INFO:     C.midGray,
}

// ─── Main export ──────────────────────────────────────────────────────────────

export async function generatePDF(log: LogState): Promise<void> {
  // Dynamic import – jsPDF is client-only
  const { jsPDF } = await import('jspdf')
  const autoTable = (await import('jspdf-autotable')).default

  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' })
  const W = 210  // A4 width mm
  const H = 297  // A4 height mm
  const M = 14   // margin

  let y = 0      // current y cursor

  // ── Helper functions ──────────────────────────────────────────────────────

  const setFont = (style: 'normal'|'bold'|'italic' = 'normal', size = 10) => {
    doc.setFont('helvetica', style)
    doc.setFontSize(size)
  }

  const setColor = (rgb: RGB) => doc.setTextColor(...rgb)
  const setFill  = (rgb: RGB) => doc.setFillColor(...rgb)
  const setDraw  = (rgb: RGB) => doc.setDrawColor(...rgb)

  const text = (str: string, x: number, yy: number, opts?: Parameters<typeof doc.text>[3]) =>
    doc.text(str, x, yy, opts)

  const rect = (x: number, yy: number, w: number, h: number, style: 'F'|'S'|'FD' = 'F') =>
    doc.rect(x, yy, w, h, style)

  const line = (x1: number, y1: number, x2: number, y2: number) =>
    doc.line(x1, y1, x2, y2)

  const newPage = () => {
    doc.addPage()
    y = drawPageHeader(false)  // compact header on subsequent pages
  }

  const checkPage = (needed: number) => {
    if (y + needed > H - 20) newPage()
  }

  // ── Cover / Page 1 header ─────────────────────────────────────────────────

  const drawCoverHeader = (): number => {
    // Deep navy band
    setFill(C.nrNavy)
    rect(0, 0, W, 52)

    // Orange accent stripe
    setFill(C.nrOrange)
    rect(0, 52, W, 4)

    // Classification bar
    setFill([180, 50, 30])
    rect(0, 56, W, 7)
    setFont('bold', 7)
    setColor(C.white)
    text('OFFICIAL – SENSITIVE  |  NOT FOR GENERAL DISTRIBUTION', W / 2, 61, { align: 'center' })

    // NR logo text (bold wordmark-style)
    setFont('bold', 22)
    setColor(C.white)
    text('NetworkRail', M, 20)

    // Subtitle
    setFont('normal', 9)
    setColor(C.nrSteel)
    text('EAST MIDLANDS CONTROL CENTRE', M, 28)

    // Report title
    setFont('bold', 26)
    setColor(C.nrOrange)
    text('DAILY', M, 42)
    setFont('normal', 26)
    setColor(C.white)
    text(' OPERATIONS REPORT', M + 32, 42)

    // Date top right
    const dateStr = log.date
      ? format(parseISO(log.date), 'EEEE d MMMM yyyy')
      : format(new Date(), 'EEEE d MMMM yyyy')
    setFont('bold', 10)
    setColor(C.nrOrange)
    text(dateStr, W - M, 20, { align: 'right' })

    // Period
    setFont('normal', 7.5)
    setColor(C.midGray)
    text(log.period, W - M, 27, { align: 'right' })

    return 72  // next y after header
  }

  const drawPageHeader = (isCover: boolean): number => {
    if (isCover) return drawCoverHeader()

    // Compact header for subsequent pages
    setFill(C.nrNavy)
    rect(0, 0, W, 14)
    setFill(C.nrOrange)
    rect(0, 14, W, 2)

    setFont('bold', 8)
    setColor(C.white)
    text('EMCC DAILY OPERATIONS REPORT', M, 9)

    const dateStr = log.date
      ? format(parseISO(log.date), 'd MMMM yyyy')
      : format(new Date(), 'd MMMM yyyy')
    setFont('normal', 7)
    setColor(C.nrSteel)
    text(dateStr, W - M, 9, { align: 'right' })

    setFont('bold', 6)
    setColor([180, 50, 30])
    text('OFFICIAL – SENSITIVE', W / 2, 9, { align: 'center' })

    return 22
  }

  // ── Page footer ───────────────────────────────────────────────────────────

  const drawFooter = (pageNum: number, totalPages: number) => {
    const fy = H - 10
    setFill(C.nrNavy)
    rect(0, H - 14, W, 14)

    setFont('normal', 6.5)
    setColor(C.midGray)
    text('Network Rail Infrastructure Ltd  |  East Midlands Control Centre', M, fy)
    text(`Page ${pageNum} of ${totalPages}`, W / 2, fy, { align: 'center' })
    text(log.createdBy ? `Compiled by: ${log.createdBy}` : 'OFFICIAL – SENSITIVE', W - M, fy, { align: 'right' })
  }

  // ── Section heading ───────────────────────────────────────────────────────

  const sectionHeading = (title: string, subtitle?: string) => {
    checkPage(18)
    setFill(C.nrBlue)
    rect(M, y, W - M * 2, 9)

    // Left accent bar
    setFill(C.nrOrange)
    rect(M, y, 3, 9)

    setFont('bold', 9)
    setColor(C.white)
    text(title, M + 6, y + 6.2)

    if (subtitle) {
      setFont('normal', 7)
      setColor(C.nrSteel)
      text(subtitle, W - M, y + 6.2, { align: 'right' })
    }

    y += 13
  }

  // ── Subsection heading ────────────────────────────────────────────────────

  const subHeading = (title: string) => {
    checkPage(12)
    setFill(C.offWhite)
    rect(M, y, W - M * 2, 7)
    setFill(C.nrSteel)
    rect(M, y, 2, 7)

    setFont('bold', 8)
    setColor(C.nrBlue)
    text(title, M + 5, y + 5)

    y += 10
  }

  // ─────────────────────────────────────────────────────────────────────────
  // PAGE 1 – Cover + Roster
  // ─────────────────────────────────────────────────────────────────────────

  y = drawPageHeader(true)

  // ── Roster section ────────────────────────────────────────────────────────

  sectionHeading('SHIFT ROSTER', log.period)

  const drawRosterHalf = (slots: ShiftSlot[], label: string, xOffset: number) => {
    const colW = (W - M * 2) / 2 - 3
    const startX = M + xOffset

    // Shift label bar
    setFill(C.nrSteel)
    rect(startX, y, colW, 7)
    setFont('bold', 8)
    setColor(C.white)
    text(label, startX + colW / 2, y + 5, { align: 'center' })
    let ry = y + 9

    // Column headers
    setFill(C.lightGray)
    rect(startX, ry, colW, 6)
    setFont('bold', 7)
    setColor(C.darkGray)
    text('ROLE', startX + 2, ry + 4.3)
    text('NAME', startX + colW * 0.55, ry + 4.3)
    text('PERIOD', startX + colW * 0.82, ry + 4.3)
    ry += 7

    slots.forEach((slot, i) => {
      setFill(i % 2 === 0 ? C.white : C.offWhite)
      rect(startX, ry, colW, 7)

      setFont('normal', 6.8)
      setColor(C.darkGray)
      const roleText = doc.splitTextToSize(slot.role, colW * 0.52)
      text(roleText, startX + 2, ry + 4.5)

      setFont('bold', 7)
      setColor(slot.name ? C.nrBlue : C.midGray)
      text(slot.name || '—', startX + colW * 0.55, ry + 4.5)

      setFont('normal', 6.5)
      setColor(C.midGray)
      text(`${slot.start}–${slot.end}`, startX + colW * 0.82, ry + 4.5)

      ry += 7
    })

    return ry
  }

  const rosterY = y
  const leftEnd = drawRosterHalf(log.roster.dayShift, '◑  DAY SHIFT  06:00–18:00', 0)
  const savedY = y
  y = rosterY
  const rightEnd = drawRosterHalf(log.roster.nightShift, '◐  NIGHT SHIFT  18:00–06:00', (W - M * 2) / 2 + 3)
  y = Math.max(leftEnd, rightEnd) + 6

  // ── Performance Metrics ───────────────────────────────────────────────────

  if (log.performance && Object.values(log.performance).some(v => v !== undefined)) {
    checkPage(30)
    sectionHeading('HEADLINE PERFORMANCE METRICS')

    const metrics = [
      { label: 'Time to 3', value: log.performance.timeTo3, suffix: '%', threshold: [85, 80], good: 'high' },
      { label: 'Cancellations', value: log.performance.cancellations, suffix: '%', threshold: [2, 4], good: 'low' },
      { label: 'PPM', value: log.performance.ppm, suffix: '%', threshold: [92, 89], good: 'high' },
      { label: 'Freight T-15', value: log.performance.freightArrivalT15, suffix: '%', threshold: [87, 80], good: 'high' },
    ].filter(m => m.value !== undefined)

    const boxW = (W - M * 2) / metrics.length - 3
    metrics.forEach((m, i) => {
      const bx = M + i * (boxW + 3)
      const isGood = m.good === 'high'
        ? (m.value! >= m.threshold[0])
        : (m.value! <= m.threshold[0])
      const isWarn = m.good === 'high'
        ? (m.value! >= m.threshold[1] && m.value! < m.threshold[0])
        : (m.value! > m.threshold[0] && m.value! <= m.threshold[1])

      const barColor: RGB = isGood ? C.green : isWarn ? C.amber : C.red

      setFill(C.offWhite)
      rect(bx, y, boxW, 22)

      setFill(barColor)
      rect(bx, y, boxW, 3)

      setFont('normal', 7)
      setColor(C.midGray)
      text(m.label.toUpperCase(), bx + boxW / 2, y + 9, { align: 'center' })

      setFont('bold', 14)
      setColor(barColor)
      text(`${m.value}${m.suffix}`, bx + boxW / 2, y + 18, { align: 'center' })
    })

    y += 26
  }

  // ─────────────────────────────────────────────────────────────────────────
  // PAGE 2+ – Incident Summary
  // ─────────────────────────────────────────────────────────────────────────

  newPage()
  sectionHeading('SIGNIFICANT INCIDENTS SUMMARY', `${log.incidents.filter(i => i.isHighlight).length} flagged incidents`)

  // Safety stats bar
  const safetyStats = [
    { label: 'SPADs', count: log.incidents.filter(i => i.category === 'SPAD').length },
    { label: 'Near Misses', count: log.incidents.filter(i => i.category === 'NEAR_MISS').length },
    { label: 'Bridge Strikes', count: log.incidents.filter(i => i.category === 'BRIDGE_STRIKE').length },
    { label: 'Fatalities', count: log.incidents.filter(i => i.category === 'FATALITY' || i.category === 'PERSON_STRUCK').length },
    { label: 'TPWS Acts', count: log.incidents.filter(i => i.category === 'TPWS').length },
    { label: 'Crimes', count: log.incidents.filter(i => i.category === 'CRIME').length },
    { label: 'Fires', count: log.incidents.filter(i => i.category === 'FIRE').length },
  ]

  const statW = (W - M * 2) / safetyStats.length
  safetyStats.forEach((s, i) => {
    const sx = M + i * statW
    setFill(s.count > 0 ? (s.label === 'Fatalities' ? C.red : C.nrNavy) : C.offWhite)
    rect(sx, y, statW - 1, 18)

    setFont('bold', 14)
    setColor(s.count > 0 ? C.white : C.lightGray)
    text(String(s.count), sx + statW / 2, y + 11, { align: 'center' })

    setFont('normal', 6)
    setColor(s.count > 0 ? C.nrSteel : C.midGray)
    text(s.label.toUpperCase(), sx + statW / 2, y + 16.5, { align: 'center' })
  })
  y += 22

  // ── Highlighted incidents ─────────────────────────────────────────────────

  const highlightIncidents = log.incidents.filter(i => i.isHighlight)

  if (highlightIncidents.length === 0) {
    setFont('italic', 9)
    setColor(C.midGray)
    text('No significant incidents to report for this period.', M, y + 6)
    y += 12
  }

  for (const incident of highlightIncidents) {
    checkPage(40)
    const catCfg = CATEGORY_CONFIG[incident.category]
    const sevColor = SEV_COLOR[incident.severity] || C.midGray

    // Card background
    setFill(C.offWhite)
    rect(M, y, W - M * 2, 30)

    // Severity left border
    setFill(sevColor)
    rect(M, y, 3, 30)

    // Category badge (top right)
    setFill(C.nrNavy)
    rect(W - M - 25, y + 2, 23, 7)
    setFont('bold', 6)
    setColor(C.nrOrange)
    text(catCfg.shortLabel, W - M - 13.5, y + 6.8, { align: 'center' })

    // CCIL ref
    setFont('bold', 6.5)
    setColor(C.midGray)
    text(incident.ccil ? `CCIL ${incident.ccil}` : '', M + 5, y + 6)

    // Time/location
    setFont('normal', 6.5)
    setColor(C.nrSteel)
    if (incident.incidentStart) text(`${incident.incidentStart}  |  ${incident.location}`, M + 5, y + 11)

    // Title
    setFont('bold', 9)
    setColor(C.nrBlue)
    const titleLines = doc.splitTextToSize(incident.title, W - M * 2 - 35)
    text(titleLines, M + 5, y + 17)

    // Description snippet
    const descMaxChars = 220
    const desc = (incident.description || '').slice(0, descMaxChars) + ((incident.description || '').length > descMaxChars ? '…' : '')
    setFont('normal', 7)
    setColor(C.darkGray)
    const descLines = doc.splitTextToSize(desc, W - M * 2 - 10)
    text(descLines.slice(0, 2), M + 5, y + 23)

    // Right: disruption stats
    if (incident.minutesDelay || incident.cancelled) {
      setFont('bold', 8)
      setColor(sevColor)
      if (incident.minutesDelay) text(`${incident.minutesDelay.toLocaleString()} min`, W - M - 5, y + 16, { align: 'right' })
      setFont('normal', 6.5)
      setColor(C.midGray)
      if (incident.cancelled) text(`${incident.cancelled} cancelled`, W - M - 5, y + 21, { align: 'right' })
      if (incident.partCancelled) text(`${incident.partCancelled} part-cancelled`, W - M - 5, y + 26, { align: 'right' })
    }

    y += 33
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Incident Tables by Category
  // ─────────────────────────────────────────────────────────────────────────

  const tableCategories: Array<{ cat: string; label: string; filter: (i: Incident) => boolean }> = [
    { cat: 'SPAD_TPWS', label: 'SIGNALS PASSED AT DANGER & TPWS ACTIVATIONS',
      filter: i => i.category === 'SPAD' || i.category === 'TPWS' },
    { cat: 'BRIDGE', label: 'BRIDGE STRIKES',
      filter: i => i.category === 'BRIDGE_STRIKE' },
    { cat: 'NEAR_MISS', label: 'NEAR MISSES',
      filter: i => i.category === 'NEAR_MISS' },
    { cat: 'IRR', label: 'IRREGULAR WORKING',
      filter: i => i.category === 'IRREGULAR_WORKING' },
    { cat: 'LC', label: 'LEVEL CROSSING INCIDENTS',
      filter: i => i.category === 'LEVEL_CROSSING' },
    { cat: 'FIRE', label: 'FIRES & LINESIDE INCIDENTS',
      filter: i => i.category === 'FIRE' },
    { cat: 'CRIME', label: 'RAILWAY CRIME',
      filter: i => i.category === 'CRIME' },
    { cat: 'HABD', label: 'HABD / WILD ACTIVATIONS',
      filter: i => i.category === 'HABD_WILD' },
    { cat: 'PAX', label: 'PASSENGER / PUBLIC INJURIES & ASSAULTS',
      filter: i => i.category === 'PASSENGER_INJURY' },
    { cat: 'INFRA', label: 'INFRASTRUCTURE FAILURES',
      filter: i => i.category === 'INFRASTRUCTURE' },
    { cat: 'TRACT', label: 'TRACTION FAILURES',
      filter: i => i.category === 'TRACTION_FAILURE' },
  ]

  for (const section of tableCategories) {
    const items = log.incidents.filter(section.filter)
    if (items.length === 0) continue

    checkPage(24)
    sectionHeading(section.label, `${items.length} incident${items.length > 1 ? 's' : ''}`)

    const tableData = items.map(i => [
      i.ccil || '—',
      i.location || '—',
      i.incidentStart || '—',
      doc.splitTextToSize(i.title, 60).join('\n'),
      i.minutesDelay ? i.minutesDelay.toLocaleString() : '—',
      i.cancelled ? String(i.cancelled) : '—',
      i.severity,
    ])

    autoTable(doc, {
      startY: y,
      head: [['CCIL', 'Location', 'Time', 'Incident', 'Delay (min)', 'Cancelled', 'Sev']],
      body: tableData,
      margin: { left: M, right: M },
      theme: 'grid',
      headStyles: {
        fillColor: C.nrBlue,
        textColor: C.white,
        fontSize: 7,
        fontStyle: 'bold',
        cellPadding: 2.5,
      },
      bodyStyles: {
        fontSize: 7,
        textColor: C.darkGray,
        cellPadding: 2,
      },
      alternateRowStyles: { fillColor: C.offWhite },
      columnStyles: {
        0: { cellWidth: 18 },
        1: { cellWidth: 32 },
        2: { cellWidth: 15 },
        3: { cellWidth: 'auto' },
        4: { cellWidth: 18, halign: 'right' },
        5: { cellWidth: 18, halign: 'right' },
        6: { cellWidth: 14 },
      },
      didParseCell: (data) => {
        if (data.section === 'body' && data.column.index === 6) {
          const sev = data.cell.raw as string
          data.cell.styles.textColor = SEV_COLOR[sev] || C.midGray
          data.cell.styles.fontStyle = 'bold'
        }
      },
      didDrawPage: () => { y = (doc as any).lastAutoTable.finalY + 4 }
    })

    y = (doc as any).lastAutoTable.finalY + 8
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Disruption Impact Table
  // ─────────────────────────────────────────────────────────────────────────

  const impactIncidents = log.incidents
    .filter(i => (i.minutesDelay || 0) > 0 || (i.cancelled || 0) > 0)
    .sort((a, b) => (b.minutesDelay || 0) - (a.minutesDelay || 0))
    .slice(0, 15)

  if (impactIncidents.length > 0) {
    checkPage(24)
    sectionHeading('DISRUPTION IMPACT – TOP INCIDENTS BY DELAY')

    const totalMins = impactIncidents.reduce((s, i) => s + (i.minutesDelay || 0), 0)
    const totalCan = impactIncidents.reduce((s, i) => s + (i.cancelled || 0), 0)

    autoTable(doc, {
      startY: y,
      head: [['Rank', 'CCIL', 'Category', 'Location / Incident', 'Delay (min)', 'Cancelled', 'Part-Can']],
      body: impactIncidents.map((i, idx) => [
        `#${idx + 1}`,
        i.ccil || '—',
        CATEGORY_CONFIG[i.category].shortLabel,
        `${i.location} — ${i.title.slice(0, 50)}`,
        i.minutesDelay?.toLocaleString() || '—',
        i.cancelled || '—',
        i.partCancelled || '—',
      ]),
      foot: [['', '', '', 'TOTAL', totalMins.toLocaleString(), totalCan, '']],
      margin: { left: M, right: M },
      theme: 'grid',
      headStyles: { fillColor: C.nrBlue, textColor: C.white, fontSize: 7, fontStyle: 'bold', cellPadding: 2.5 },
      footStyles: { fillColor: C.nrNavy, textColor: C.nrOrange, fontSize: 7.5, fontStyle: 'bold' },
      bodyStyles: { fontSize: 7, textColor: C.darkGray, cellPadding: 2 },
      alternateRowStyles: { fillColor: C.offWhite },
      columnStyles: {
        0: { cellWidth: 10 },
        1: { cellWidth: 18 },
        2: { cellWidth: 16 },
        3: { cellWidth: 'auto' },
        4: { cellWidth: 18, halign: 'right' },
        5: { cellWidth: 16, halign: 'right' },
        6: { cellWidth: 16, halign: 'right' },
      },
    })

    y = (doc as any).lastAutoTable.finalY + 8
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Appendix – Full CCIL Log
  // ─────────────────────────────────────────────────────────────────────────

  if (log.rawLogText) {
    newPage()
    sectionHeading('APPENDIX — FULL CCIL LOG (VERBATIM)', 'Control Centre Incident Log Export')

    setFont('italic', 7)
    setColor(C.midGray)
    text('The following is the unedited CCIL export for this period. Contents are OFFICIAL-SENSITIVE.', M, y)
    y += 8

    // Paginate the raw text
    const rawLines = log.rawLogText.split('\n')
    setFont('normal', 6.5)
    setColor(C.darkGray)

    for (const rawLine of rawLines) {
      checkPage(5)
      const wrapped = doc.splitTextToSize(rawLine || ' ', W - M * 2)
      doc.text(wrapped, M, y)
      y += wrapped.length * 3.8
    }
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Add footers to all pages
  // ─────────────────────────────────────────────────────────────────────────

  const totalPages = doc.getNumberOfPages()
  for (let p = 1; p <= totalPages; p++) {
    doc.setPage(p)
    drawFooter(p, totalPages)
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Save
  // ─────────────────────────────────────────────────────────────────────────

  const dateStr = log.date || format(new Date(), 'yyyy-MM-dd')
  doc.save(`EMCC_Daily_Report_${dateStr.replace(/-/g, '')}.pdf`)
}
