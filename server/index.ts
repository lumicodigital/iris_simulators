import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import { readFile, stat } from 'node:fs/promises'
import { resolve, extname, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { SerialPort } from 'serialport'
import { WebSocketServer, WebSocket } from 'ws'
import { parseHex } from '../src/protocol/pelcoD.ts'

const port = 4311
const root = fileURLToPath(new URL('../dist/', import.meta.url))
const sockets = new WebSocketServer({ noServer: true, maxPayload: 65536 })
let serial: SerialPort | null = null
let changingPort = false
const baudRates = [2400, 4800, 9600, 19200, 38400, 57600, 115200]
function status() {
  return { type: 'status', connected: Boolean(serial?.isOpen), path: serial?.path ?? '', baudRate: serial?.baudRate ?? 2400 }
}
function broadcast(message: object) {
  const data = JSON.stringify(message)
  for (const socket of sockets.clients) {
    if (socket.readyState === WebSocket.OPEN) {
      if (socket.bufferedAmount > 1024 * 1024) socket.close(1013, 'Client cannot keep up with serial input')
      else socket.send(data)
    }
  }
}
function json(response: ServerResponse, code: number, data: unknown) {
  response.writeHead(code, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' })
  response.end(JSON.stringify(data))
}
function trusted(request: IncomingMessage) {
  if (!['127.0.0.1:4311', 'localhost:4311', '127.0.0.1:5174', 'localhost:5174'].includes(request.headers.host ?? '')) return false
  const origin = request.headers.origin
  return !origin || ['http://127.0.0.1:4311', 'http://localhost:4311', 'http://127.0.0.1:5174', 'http://localhost:5174'].includes(origin)
}
async function body(request: IncomingMessage): Promise<Buffer> {
  const chunks: Buffer[] = []
  let size = 0
  for await (const chunk of request) {
    size += chunk.length
    if (size > 65536) throw new Error('Request exceeds 64 KiB.')
    chunks.push(Buffer.from(chunk))
  }
  return Buffer.concat(chunks)
}
async function closeSerial() {
  const current = serial
  if (current?.isOpen) await new Promise<void>((accept, reject) => current.close(error => error ? reject(error) : accept()))
  serial = null
  broadcast(status())
}
const server = createServer(async (request, response) => {
  try {
    if (!trusted(request)) return json(response, 403, { error: 'Only local simulator origins are allowed.' })
    const url = new URL(request.url ?? '/', 'http://127.0.0.1:4311')
    if (request.method === 'GET' && url.pathname === '/api/status') return json(response, 200, status())
    if (request.method === 'GET' && url.pathname === '/api/ports') return json(response, 200, await SerialPort.list())
    if (request.method === 'POST' && ['/api/connect', '/api/disconnect'].includes(url.pathname)) {
      if (changingPort) return json(response, 409, { error: 'A serial connection change is already in progress.' })
      changingPort = true
      try {
        if (url.pathname === '/api/disconnect') { await closeSerial(); return json(response, 200, status()) }
        const options = JSON.parse((await body(request)).toString()) as { path?: string; baudRate?: number }
        if (!options.path || typeof options.path !== 'string' || options.path.length > 512 || !baudRates.includes(options.baudRate ?? 0)) return json(response, 400, { error: 'Choose a serial device path and a supported baud rate.' })
        await closeSerial()
        const candidate = new SerialPort({ path: options.path, baudRate: options.baudRate!, dataBits: 8, stopBits: 1, parity: 'none', autoOpen: false })
        candidate.on('error', error => broadcast({ type: 'error', message: error.message }))
        candidate.on('data', (bytes: Buffer) => broadcast({ type: 'bytes', bytes: [...bytes], source: 'serial', at: Date.now() }))
        candidate.on('close', () => { if (serial === candidate) { serial = null; broadcast(status()) } })
        await new Promise<void>((accept, reject) => candidate.open(error => error ? reject(error) : accept()))
        serial = candidate
        broadcast(status())
        return json(response, 200, status())
      } finally { changingPort = false }
    }
    // External controllers can POST raw binary or {"hex":"FF 01 ..."}.
    // The bridge forwards RX bytes to open simulator UIs and never transmits on the serial port.
    if (request.method === 'POST' && url.pathname === '/api/bytes') {
      const raw = await body(request)
      const bytes = request.headers['content-type']?.startsWith('application/octet-stream') ? [...raw] : parseHex(JSON.parse(raw.toString()).hex)
      if (!bytes.length) return json(response, 400, { error: 'At least one byte is required.' })
      broadcast({ type: 'bytes', bytes, source: 'api', at: Date.now() })
      return json(response, 200, { acceptedBytes: bytes.length, connectedClients: sockets.clients.size })
    }
    if (url.pathname.startsWith('/api/')) return json(response, 404, { error: 'Unknown API route.' })
    if (request.method !== 'GET' && request.method !== 'HEAD') return json(response, 405, { error: 'Method not allowed.' })
    const pathname = decodeURIComponent(url.pathname)
    let target = resolve(root, `.${pathname}`)
    if (target !== resolve(root) && !target.startsWith(resolve(root) + sep)) return json(response, 403, { error: 'Invalid path.' })
    try { if ((await stat(target)).isDirectory()) target = resolve(target, 'index.html') }
    catch { if (extname(pathname)) return json(response, 404, { error: 'File not found.' }); target = resolve(root, 'index.html') }
    const content = await readFile(target)
    const mime: Record<string, string> = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon' }
    response.writeHead(200, { 'Content-Type': mime[extname(target)] ?? 'application/octet-stream', 'X-Content-Type-Options': 'nosniff' })
    response.end(request.method === 'HEAD' ? undefined : content)
  } catch (error) { json(response, 400, { error: error instanceof Error ? error.message : 'Request failed.' }) }
})
server.on('upgrade', (request, socket, head) => {
  if (!trusted(request) || request.url !== '/serial') { socket.destroy(); return }
  sockets.handleUpgrade(request, socket, head, client => {
    client.on('error', () => client.terminate())
    client.send(JSON.stringify(status()))
    sockets.emit('connection', client, request)
  })
})
server.on('error', error => { console.error(`Simulator bridge: ${error.message}`); process.exitCode = 1 })
server.listen(port, '127.0.0.1', () => console.log(`Pelco-D serial bridge / built UI: http://127.0.0.1:${port}`))
async function shutdown() {
  await closeSerial().catch(() => {})
  for (const socket of sockets.clients) socket.terminate()
  sockets.close(); server.close()
}
process.on('SIGINT', shutdown)
process.on('SIGTERM', shutdown)
