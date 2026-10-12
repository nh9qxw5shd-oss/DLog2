// Tests for the distribution list parser and the email template.
// Run with `npm test` (node --test with type stripping).

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { parseAddressList, formatAddressList, isValidEmail } from './addresses.ts'
import {
  renderHtml, renderText, subjectFor, batches, ukDate, checkAttachment, safeFilename, SUBJECT, BCC_PER_EMAIL,
} from './emailTemplate.ts'

test('parses an Outlook To line with quoted, wrapped and comma-containing names', () => {
  const r = parseAddressList(`Jonathan Adshead <Jonathan.Adshead@networkrail.co.uk>, Dave Allen
\t<Dave.Allen@networkrail.co.uk>, "EXTL: Babcock Control"
\t<babcockrail.control@babcockinternational.com>, Andrew
 Grice <Andrew.Grice@networkrail.co.uk>, "Morris, Ryan" <ryan.morris@btp.police.uk>, "EXTL:
 Control Dutymanager (Northern Rail)"
\t<control.dutymanager@northernrailway.co.uk>, Stephen O'Connell
\t<Stephen.O'Connell@networkrail.co.uk>`)
  assert.deepEqual(r.addresses, [
    { email: 'Jonathan.Adshead@networkrail.co.uk', name: 'Jonathan Adshead' },
    { email: 'Dave.Allen@networkrail.co.uk', name: 'Dave Allen' },
    { email: 'babcockrail.control@babcockinternational.com', name: 'EXTL: Babcock Control' },
    { email: 'Andrew.Grice@networkrail.co.uk', name: 'Andrew Grice' },
    { email: 'ryan.morris@btp.police.uk', name: 'Morris, Ryan' },
    { email: 'control.dutymanager@northernrailway.co.uk', name: 'EXTL: Control Dutymanager (Northern Rail)' },
    { email: "Stephen.O'Connell@networkrail.co.uk", name: "Stephen O'Connell" },
  ])
  assert.deepEqual(r.invalid, [])
})

test('drops repeats regardless of case and keeps the first spelling', () => {
  const r = parseAddressList('Calvin Claxton <Calvin.CLAXTON@networkrail.co.uk>; calvin.claxton@networkrail.co.uk\nother@example.com')
  assert.equal(r.addresses.length, 2)
  assert.equal(r.addresses[0].email, 'Calvin.CLAXTON@networkrail.co.uk')
  assert.deepEqual(r.duplicates, ['calvin.claxton@networkrail.co.uk'])
})

test('reports invalid addresses and accepts bare ones', () => {
  const r = parseAddressList('good@example.com, Bad <not-an-address@>, mailto:x@y.org')
  assert.deepEqual(r.addresses.map(a => a.email), ['good@example.com', 'x@y.org'])
  assert.deepEqual(r.invalid, ['not-an-address@'])
  assert.equal(isValidEmail('a.b@c.co.uk'), true)
  assert.equal(isValidEmail('a b@c.co.uk'), false)
})

test('round-trips through the Outlook format', () => {
  const list = [{ email: 'ryan.morris@btp.police.uk', name: 'Morris, Ryan' }, { email: 'x@y.org', name: null }]
  assert.deepEqual(parseAddressList(formatAddressList(list)).addresses, list)
})

test('splits the list into emails of 49 BCC addresses (50 with the To)', () => {
  const list = Array.from({ length: 331 }, (_, i) => `p${i}@example.com`)
  const b = batches(list)
  assert.equal(BCC_PER_EMAIL, 49)
  assert.equal(b.length, 7)
  assert.ok(b.every(x => x.length <= 49))
  assert.deepEqual(b.flat(), list)
})

test('body lists only what is attached, with the log date as dd/mm/yyyy', () => {
  const img = (k: string) => `cid:${k}`
  const all = renderHtml({ logDate: '2026-10-03', attachments: ['log', 'forecast', 'ccil'] }, img)
  assert.match(all, /East Midlands Route 03\/10\/2026\./)
  assert.match(all, /Current weather forecast/)
  assert.match(all, /Raw CCIL export/)
  assert.match(all, /src="cid:banner"/)
  assert.match(all, /src="cid:signature"/)
  assert.match(all, />OFFICIAL</)
  const logOnly = renderHtml({ logDate: '2026-10-03', attachments: ['log'] }, img)
  assert.doesNotMatch(logOnly, /Current weather forecast|Raw CCIL export/)
  assert.match(renderText({ logDate: '2026-10-03', attachments: ['log', 'ccil'] }), /Raw CCIL export/)
})

test('subject is fixed; test sends are marked', () => {
  assert.equal(SUBJECT, 'East Midlands Daily Control Log & 7 day look ahead')
  assert.equal(subjectFor({ test: null }), SUBJECT)
  assert.equal(subjectFor({ test: { note: 'x' } }), `[TEST] ${SUBJECT}`)
  assert.equal(ukDate('2026-10-03'), '03/10/2026')
})

test('attachments are checked by extension and leading bytes', () => {
  const pdf = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d])
  const zip = new Uint8Array([0x50, 0x4b, 0x03, 0x04])
  assert.equal(checkAttachment('log', 'EMCC_Daily_Report_20261003.pdf', pdf), null)
  assert.equal(checkAttachment('ccil', 'Log-Type10.docx', zip), null)
  assert.match(checkAttachment('ccil', 'Log.docx', pdf) ?? '', /not a valid/)
  assert.match(checkAttachment('forecast', 'forecast.docx', zip) ?? '', /not a \.pdf/)
  assert.equal(safeFilename('C:\\x\\East Midlands 7 Day Forecast - 04-10-2026 0234 BST.pdf', 'f.pdf'), 'East Midlands 7 Day Forecast - 04-10-2026 0234 BST.pdf')
  assert.equal(safeFilename('', 'f.pdf'), 'f.pdf')
})
