// ─── /api/distribution/recipients ─────────────────────────────────────────────
// Manage the daily log distribution list. Every method needs the desk key in
// the x-distribution-key header: the list is people's names and addresses.
//
// GET                         → { recipients, sends } (recent sends, no addresses)
// POST   { text, by }         → parse pasted text (Outlook line, one per line…) and add new addresses
// PATCH  { id, email?, name?, active? }
// DELETE { id }

import { NextRequest, NextResponse } from 'next/server'
import { parseAddressList } from '@/lib/distribution/addresses'
import {
  keyOk, db, listRecipients, addRecipients, updateRecipient, removeRecipient, sendsFor, publicSend, DistributionError,
} from '@/lib/distribution/server'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

function fail(e: unknown) {
  const status = e instanceof DistributionError ? e.status : 500
  return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status })
}

function guard(req: NextRequest): NextResponse | null {
  return keyOk(req.headers.get('x-distribution-key'))
    ? null
    : NextResponse.json({ error: 'The desk key is missing or wrong.' }, { status: 401 })
}

function name(v: unknown): string | null {
  return typeof v === 'string' && v.trim() ? v.trim().slice(0, 80) : null
}

export async function GET(req: NextRequest) {
  const denied = guard(req); if (denied) return denied
  try {
    const sb = db()
    const [recipients, sends] = await Promise.all([listRecipients(sb), sendsFor(sb, null, 30)])
    return NextResponse.json({ recipients, sends: sends.map(publicSend) }, { headers: { 'Cache-Control': 'no-store' } })
  } catch (e) { return fail(e) }
}

export async function POST(req: NextRequest) {
  const denied = guard(req); if (denied) return denied
  try {
    const body = await req.json().catch(() => ({}))
    const text = typeof body.text === 'string' ? body.text : ''
    if (!text.trim()) throw new DistributionError('Paste one or more addresses.', 400)
    const parsed = parseAddressList(text)
    const result = parsed.addresses.length ? await addRecipients(db(), parsed.addresses, name(body.by)) : { added: 0, alreadyListed: 0 }
    return NextResponse.json({ ...result, duplicatesInPaste: parsed.duplicates.length, invalid: parsed.invalid })
  } catch (e) { return fail(e) }
}

export async function PATCH(req: NextRequest) {
  const denied = guard(req); if (denied) return denied
  try {
    const body = await req.json().catch(() => ({}))
    const id = Number(body.id)
    if (!Number.isInteger(id)) throw new DistributionError('No address chosen.', 400)
    await updateRecipient(db(), id, {
      email: typeof body.email === 'string' ? body.email : undefined,
      name: typeof body.name === 'string' || body.name === null ? body.name : undefined,
      active: typeof body.active === 'boolean' ? body.active : undefined,
    })
    return NextResponse.json({ ok: true })
  } catch (e) { return fail(e) }
}

export async function DELETE(req: NextRequest) {
  const denied = guard(req); if (denied) return denied
  try {
    const body = await req.json().catch(() => ({}))
    const id = Number(body.id)
    if (!Number.isInteger(id)) throw new DistributionError('No address chosen.', 400)
    await removeRecipient(db(), id)
    return NextResponse.json({ ok: true })
  } catch (e) { return fail(e) }
}
