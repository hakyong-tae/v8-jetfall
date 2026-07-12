// tools/save-server.mjs — 브라우저에서 합성한 이미지(dataURL)를 받아 promo/에 저장하는
// 개발용 원샷 서버. 썸네일 제작 파이프라인(스펙 M4-A §6)용.
//   실행: node tools/save-server.mjs   (기본 :9911)
//   페이지에서: fetch('http://localhost:9911/save?name=thumbnail-1024.png', {method:'POST', body: dataURL})
import { createServer } from 'node:http'
import { writeFileSync, mkdirSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const OUT_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../promo')
mkdirSync(OUT_DIR, { recursive: true })
const PORT = Number(process.env.PORT || 9911)

createServer((req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS')
  if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return }
  if (req.method !== 'POST' || !req.url?.startsWith('/save')) { res.writeHead(404); res.end(); return }
  const name = (new URL(req.url, 'http://x').searchParams.get('name') || 'out.png').replace(/[^\w.-]/g, '_')
  let body = ''
  req.on('data', (c) => { body += c })
  req.on('end', () => {
    const m = body.match(/^data:image\/png;base64,(.+)$/s)
    if (!m) { res.writeHead(400); res.end('expect png dataURL'); return }
    const file = path.join(OUT_DIR, name)
    writeFileSync(file, Buffer.from(m[1], 'base64'))
    console.log(`[save-server] wrote ${file} (${m[1].length} b64 chars)`)
    res.writeHead(200); res.end('ok')
  })
}).listen(PORT, () => console.log(`[save-server] listening :${PORT} → ${OUT_DIR}`))
