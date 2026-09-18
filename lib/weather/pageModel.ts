// ─── PDF → page model ─────────────────────────────────────────────────────────
//
// Reduces a PDF to the two things the forecast parser needs: positioned text
// runs and filled rectangles with their colour. The hazard level of a cell in
// the MetDesk forecast is carried by the cell's fill colour (green / yellow /
// amber / red) — the level word is only printed for non-normal cells and the
// temperature cells carry no word at all — so text extraction alone is not
// enough.
//
// Runs in the browser (pdfjs-dist, dynamically imported so it stays out of the
// initial bundle) and, for tests, in Node via the legacy build. Nothing here is
// forecast-specific; forecastParser.ts does the interpretation.

export interface PageText {
  str: string
  x0: number      // left edge, PDF points
  x1: number      // right edge
  yTop: number    // top edge, measured from the TOP of the page (top-down)
  yBottom: number
  yc: number      // vertical centre
  height: number  // ≈ font size
}

export interface PageFill {
  x0: number
  y0: number      // top-down
  x1: number
  y1: number
  rgb: [number, number, number]
}

export interface PageModel {
  index: number
  width: number
  height: number
  texts: PageText[]
  fills: PageFill[]
}

type Matrix = [number, number, number, number, number, number]

function mul(m: Matrix, n: Matrix): Matrix {
  // m × n  (apply m first, then n) — the PDF `cm` convention: CTM' = M × CTM
  return [
    m[0] * n[0] + m[1] * n[2],
    m[0] * n[1] + m[1] * n[3],
    m[2] * n[0] + m[3] * n[2],
    m[2] * n[1] + m[3] * n[3],
    m[4] * n[0] + m[5] * n[2] + n[4],
    m[4] * n[1] + m[5] * n[3] + n[5],
  ]
}

function apply(m: Matrix, x: number, y: number): [number, number] {
  return [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]]
}

type PdfjsModule = typeof import('pdfjs-dist')

let pdfjsPromise: Promise<PdfjsModule> | null = null

/**
 * Loads pdfjs once. In the browser the worker is served from the app's own
 * origin: scripts/copy-pdf-worker.js copies it into public/ before dev/build
 * (Next's minifier cannot bundle the .mjs worker as an asset).
 */
export const PDF_WORKER_URL = '/pdf.worker.min.mjs'

export async function loadPdfjs(): Promise<PdfjsModule> {
  if (!pdfjsPromise) {
    pdfjsPromise = (async () => {
      const lib = await import('pdfjs-dist')
      if (typeof window !== 'undefined' && !lib.GlobalWorkerOptions.workerSrc) {
        lib.GlobalWorkerOptions.workerSrc = PDF_WORKER_URL
      }
      return lib
    })()
  }
  return pdfjsPromise
}

/**
 * Extract the page models of every page. `pdfjs` may be injected (Node tests
 * use the legacy build); otherwise it is loaded lazily.
 */
export async function extractPageModels(
  data: ArrayBuffer | Uint8Array,
  pdfjs?: PdfjsModule,
): Promise<PageModel[]> {
  const lib = pdfjs ?? (await loadPdfjs())
  const bytes = data instanceof Uint8Array ? data : new Uint8Array(data)
  const doc = await lib.getDocument({ data: bytes, isEvalSupported: false }).promise
  const pages: PageModel[] = []
  try {
    for (let p = 1; p <= doc.numPages; p++) {
      const page = await doc.getPage(p)
      const vp = page.getViewport({ scale: 1 })
      const H = vp.height
      const model: PageModel = { index: p - 1, width: vp.width, height: H, texts: [], fills: [] }

      // ── text ────────────────────────────────────────────────────────────
      const tc = await page.getTextContent()
      const seen: { str: string; x: number; y: number }[] = []
      for (let i = 0; i < tc.items.length; i++) {
        const it = tc.items[i] as { str?: string; transform?: number[]; width?: number; height?: number }
        if (!it.str || !it.str.trim() || !it.transform) continue
        const x0 = it.transform[4]
        const yBase = it.transform[5]
        const h = it.height || Math.abs(it.transform[3]) || 0
        // The forecast draws every run twice (a faux-bold offset of ~0.7pt); collapse duplicates.
        let dup = false
        for (let s = 0; s < seen.length; s++) {
          const q = seen[s]
          if (q.str === it.str && Math.abs(q.x - x0) < 2 && Math.abs(q.y - yBase) < 2) { dup = true; break }
        }
        if (dup) continue
        seen.push({ str: it.str, x: x0, y: yBase })
        const yTop = H - (yBase + h)
        const yBottom = H - yBase
        model.texts.push({
          str: it.str.replace(/\s+/g, ' ').trim(),
          x0,
          x1: x0 + (it.width || 0),
          yTop,
          yBottom,
          yc: (yTop + yBottom) / 2,
          height: h,
        })
      }

      // ── fills ───────────────────────────────────────────────────────────
      const ops = await page.getOperatorList()
      const OPS = lib.OPS
      const base: Matrix = [vp.transform[0], vp.transform[1], vp.transform[2], vp.transform[3], vp.transform[4], vp.transform[5]]
      // Work in the viewport's own space: pdfjs' viewport transform already
      // flips y so that y grows downwards from the top of the page.
      let ctm: Matrix = base
      const stack: Matrix[] = []
      let fill: [number, number, number] = [0, 0, 0]
      const fillStack: [number, number, number][] = []
      let pending: PageFill[] = []

      const pushRect = (x: number, y: number, w: number, h: number) => {
        const a = apply(ctm, x, y), b = apply(ctm, x + w, y + h)
        pending.push({
          x0: Math.min(a[0], b[0]), x1: Math.max(a[0], b[0]),
          y0: Math.min(a[1], b[1]), y1: Math.max(a[1], b[1]),
          rgb: [fill[0], fill[1], fill[2]],
        })
      }

      for (let i = 0; i < ops.fnArray.length; i++) {
        const fn = ops.fnArray[i]
        const args = ops.argsArray[i] as any
        switch (fn) {
          case OPS.save:
            stack.push(ctm); fillStack.push(fill); break
          case OPS.restore:
            ctm = stack.pop() ?? base; fill = fillStack.pop() ?? fill; break
          case OPS.transform:
            ctm = mul([args[0], args[1], args[2], args[3], args[4], args[5]], ctm); break
          case OPS.paintFormXObjectBegin: {
            stack.push(ctm); fillStack.push(fill)
            const m = args && args[0]
            if (m && m.length === 6) ctm = mul([m[0], m[1], m[2], m[3], m[4], m[5]], ctm)
            break
          }
          case OPS.paintFormXObjectEnd:
            ctm = stack.pop() ?? base; fill = fillStack.pop() ?? fill; break
          case OPS.setFillRGBColor:
            fill = [Number(args[0]), Number(args[1]), Number(args[2])]; break
          case OPS.setFillGray: {
            const g = Math.round(Number(args[0]) * 255); fill = [g, g, g]; break
          }
          case OPS.setFillCMYKColor: {
            const c = Number(args[0]), m = Number(args[1]), y = Number(args[2]), k = Number(args[3])
            fill = [Math.round(255 * (1 - c) * (1 - k)), Math.round(255 * (1 - m) * (1 - k)), Math.round(255 * (1 - y) * (1 - k))]
            break
          }
          case OPS.constructPath: {
            // args = [opcodes[], coords[], minMax?]
            const codes: number[] = Array.prototype.slice.call(args[0] || [])
            const coords: number[] = Array.prototype.slice.call(args[1] || [])
            let k = 0
            // Track a polygon so 4-point moveTo/lineTo boxes are also caught.
            let poly: [number, number][] = []
            const flushPoly = () => {
              if (poly.length >= 4) {
                const xs = poly.map(p => p[0]), ys = poly.map(p => p[1])
                const minX = Math.min.apply(null, xs), maxX = Math.max.apply(null, xs)
                const minY = Math.min.apply(null, ys), maxY = Math.max.apply(null, ys)
                pushRect(minX, minY, maxX - minX, maxY - minY)
              }
              poly = []
            }
            for (let c = 0; c < codes.length; c++) {
              const code = codes[c]
              if (code === OPS.rectangle) { pushRect(coords[k], coords[k + 1], coords[k + 2], coords[k + 3]); k += 4 }
              else if (code === OPS.moveTo) { flushPoly(); poly.push([coords[k], coords[k + 1]]); k += 2 }
              else if (code === OPS.lineTo) { poly.push([coords[k], coords[k + 1]]); k += 2 }
              else if (code === OPS.curveTo) { k += 6; poly = [] }
              else if (code === OPS.curveTo2 || code === OPS.curveTo3) { k += 4; poly = [] }
              else if (code === OPS.closePath) { flushPoly() }
            }
            flushPoly()
            break
          }
          case OPS.fill:
          case OPS.eoFill:
          case OPS.fillStroke:
          case OPS.eoFillStroke:
          case OPS.closeFillStroke:
          case OPS.closeEOFillStroke:
            for (let r = 0; r < pending.length; r++) {
              const f = pending[r]
              // Ignore hairlines and the full-page white background.
              if (f.x1 - f.x0 < 1 || f.y1 - f.y0 < 1) continue
              model.fills.push(f)
            }
            pending = []
            break
          case OPS.stroke:
          case OPS.closeStroke:
          case OPS.endPath:
          case OPS.clip:
          case OPS.eoClip:
            pending = []
            break
          default:
            break
        }
      }
      page.cleanup()
      pages.push(model)
    }
  } finally {
    await doc.destroy()
  }
  return pages
}
