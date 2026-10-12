// ─── /api/distribution/preview ────────────────────────────────────────────────
// GET ?date=YYYY-MM-DD&a=log,forecast,ccil → the email body exactly as it will
// be sent, with the inline images as data URIs so a browser can show it. The
// template is static, so no key is needed.

import { NextRequest } from 'next/server'
import { renderHtml, AttachmentKind, ATTACHMENT_ORDER } from '@/lib/distribution/emailTemplate'
import { BANNER, SIGNATURE } from '@/lib/distribution/emailImages'

export const runtime = 'nodejs'

export async function GET(req: NextRequest) {
  const p = req.nextUrl.searchParams
  const date = p.get('date') ?? ''
  const logDate = /^\d{4}-\d{2}-\d{2}$/.test(date) ? date : ''
  const wanted = (p.get('a') ?? ATTACHMENT_ORDER.join(',')).split(',')
  const attachments = ATTACHMENT_ORDER.filter(k => wanted.includes(k)) as AttachmentKind[]
  const html = renderHtml({ logDate, attachments }, key => {
    const img = key === 'banner' ? BANNER : SIGNATURE
    return `data:${img.contentType};base64,${img.base64}`
  })
  return new Response(html, {
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'no-store',
      // Shown in a sandboxed frame; it needs nothing but its own inline images.
      'Content-Security-Policy': "default-src 'none'; img-src data:; style-src 'unsafe-inline'",
    },
  })
}
