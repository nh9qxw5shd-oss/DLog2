// Copies the pdf.js worker into public/ so the browser can load it from the
// app's own origin. Runs before `next dev` and `next build` (see package.json).
// The copy is git-ignored — it is a build artefact of the pinned pdfjs-dist.
const fs = require('fs')
const path = require('path')
const src = path.join(__dirname, '..', 'node_modules', 'pdfjs-dist', 'build', 'pdf.worker.min.mjs')
const dst = path.join(__dirname, '..', 'public', 'pdf.worker.min.mjs')
if (!fs.existsSync(src)) {
  console.warn('[pdf-worker] pdfjs-dist not installed; forecast PDF parsing will not work in the browser')
  process.exit(0)
}
fs.mkdirSync(path.dirname(dst), { recursive: true })
fs.copyFileSync(src, dst)
console.log('[pdf-worker] copied pdf.worker.min.mjs to public/')
