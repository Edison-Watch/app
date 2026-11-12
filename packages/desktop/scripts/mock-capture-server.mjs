#!/usr/bin/env node
// Local stand-in for PostHog's capture API, for testing the installer funnel
// telemetry without touching a real project. Never point a test build at the
// production PostHog key or Sentry DSN - use this instead.
//
//   node scripts/mock-capture-server.mjs [port]       (default 8787)
//
// Build a test installer against it:
//   SG_INSTALL_TELEMETRY_URL=http://127.0.0.1:8787/i/v0/e/ \
//   SG_INSTALL_TELEMETRY_KEY=phc_local_test node scripts/installer-telemetry-config.mjs
//
// Every POST body is printed as one line and appended to events.jsonl in the
// working directory. GET / shows a live table of the received events.
// On a Windows VM, listen on all interfaces with MOCK_CAPTURE_HOST=0.0.0.0.
// MOCK_CAPTURE_HANG=1 accepts each POST and never answers (a "black hole"
// endpoint), to check that the installer times out and stops sending.

import { appendFileSync } from 'node:fs'
import { createServer } from 'node:http'

const port = Number(process.argv[2] ?? 8787)
const host = process.env.MOCK_CAPTURE_HOST ?? '127.0.0.1'
const events = []
const hang = process.env.MOCK_CAPTURE_HANG === '1'

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => `&#${c.charCodeAt(0)};`)

function page() {
  // Newest first, so a live view always shows the latest event at the top.
  const rows = events
    .map((e, i) => [e, i])
    .reverse()
    .map(([e, i]) => {
      const p = e.properties ?? {}
      const detail = Object.entries(p)
        .filter(([k]) => !['install_id', '$process_person_profile', '$geoip_disable'].includes(k))
        .map(([k, v]) => `${k}=${JSON.stringify(v)}`)
        .join('  ')
      return `<tr><td>${i + 1}</td><td>${esc(e.received)}</td><td><b>${esc(e.event)}</b></td><td>${esc(p.source ?? '')}</td><td>${esc(String(p.install_id ?? e.distinct_id ?? '').slice(0, 8))}</td><td class="d">${esc(detail)}</td></tr>`
    })
    .join('')
  return `<!doctype html><meta charset="utf-8"><meta http-equiv="refresh" content="1"><title>Mock capture endpoint</title>
<style>body{font:14px system-ui,sans-serif;margin:16px;background:#0f1115;color:#e6e6e6}h1{font-size:18px}
table{border-collapse:collapse;width:100%}td,th{border-bottom:1px solid #333;padding:6px;text-align:left;vertical-align:top}
.d{font:12px ui-monospace,monospace;color:#9ad}</style>
<h1>Mock capture endpoint - http://${host}:${port} - ${events.length} event(s)</h1>
<table><tr><th>#</th><th>time</th><th>event</th><th>source</th><th>install_id</th><th>properties</th></tr>${rows}</table>`
}

createServer((req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Headers', 'content-type')
  if (req.method === 'OPTIONS') return res.writeHead(204).end()
  if (req.method === 'GET') {
    if (req.url === '/events.json') {
      return res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify(events))
    }
    return res.writeHead(200, { 'content-type': 'text/html' }).end(page())
  }
  if (hang) {
    console.log(`[mock-capture] hanging on POST ${req.url} at ${new Date().toISOString().slice(11, 23)}`)
    return
  }
  let body = ''
  req.on('data', (c) => (body += c))
  req.on('end', () => {
    let parsed
    try {
      parsed = JSON.parse(body)
    } catch {
      parsed = { event: '(unparseable)', raw: body }
    }
    const list = Array.isArray(parsed?.batch) ? parsed.batch : [parsed]
    for (const ev of list) {
      const rec = { received: new Date().toISOString().slice(11, 23), path: req.url, ...ev }
      events.push(rec)
      appendFileSync('events.jsonl', JSON.stringify(rec) + '\n')
      console.log(JSON.stringify(rec))
    }
    res.writeHead(200, { 'content-type': 'application/json' }).end('{"status":"Ok"}')
  })
}).listen(port, host, () => console.log(`[mock-capture] listening on http://${host}:${port}`))
