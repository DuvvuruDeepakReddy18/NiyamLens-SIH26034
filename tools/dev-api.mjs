import { createServer } from 'node:http'
const routes = ['health', 'ocr', 'cases', 'evidence', 'reviews', 'assignments']
const handlers = Object.fromEntries(await Promise.all(routes.map(async (name) => [name, (await import(`../api/${name}.js`)).default])))
createServer(async (req, res) => {
  res.status = (code) => { res.statusCode = code; return res }
  res.json = (value) => { res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify(value)) }
  const url = new URL(req.url, 'http://127.0.0.1:8787')
  const handler = handlers[url.pathname.replace(/^\/api\//, '')]
  if (!handler) return res.status(404).json({ error: 'Not found' })
  req.query = Object.fromEntries(url.searchParams)
  try {
    const chunks = []; let bytes = 0
    for await (const chunk of req) { bytes += chunk.length; if (bytes > 4_200_000) { res.status(413).json({ error: 'Request too large' }); return } chunks.push(chunk) }
    req.body = bytes ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : {}
    await handler(req, res)
  } catch { if (!res.writableEnded) res.status(400).json({ error: 'Invalid request' }) }
}).listen(8787, '127.0.0.1', () => console.log('Local API: http://127.0.0.1:8787 (credentials from .env.local)'))
