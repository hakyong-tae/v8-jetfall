// server/ws-host-transport.ts — Node측 자체 ws 서버. Transport 인터페이스 구현(HostSession이
// 그대로 사용). `ws` 패키지 필요(package.json에 T4에서 추가).
import { WebSocketServer, type WebSocket } from 'ws'
import type { Transport, RoomState, RoomListing, MessageHandler } from '../src/net/types'

export interface WsHostHandle { transport: Transport; port: number; close: () => Promise<void> }

export async function startWsHostTransport(opts: { port: number }): Promise<WsHostHandle> {
  const clients = new Map<WebSocket, string>() // socket → account(첫 hello 메시지로 등록)
  let msgHandler: MessageHandler = () => {}

  const wss = new WebSocketServer({ port: opts.port })
  const actualPort: number = await new Promise((resolve) => {
    wss.once('listening', () => resolve((wss.address() as { port: number }).port))
  })

  wss.on('connection', (sock) => {
    sock.on('message', (data, isBin) => {
      const parsed = JSON.parse(isBin ? Buffer.from(data as Buffer).toString('utf-8') : String(data))
      if (parsed.type === 'hello') { clients.set(sock, parsed.account); return }
      if (parsed.type === 'msg') {
        const account = clients.get(sock) ?? 'unknown'
        const payload = parsed.b64 ? base64ToArrayBuffer(parsed.b64) : parsed.payload
        msgHandler(parsed.event, payload, account)
      }
    })
    sock.on('close', () => clients.delete(sock))
  })

  const transport: Transport = {
    account: 'host',
    status: 'online',
    async connect() { return 'online' },
    async listRooms() { return [] as RoomListing[] },
    async joinRoom() {},
    async leaveRoom() {},
    async getRoomState() { return {} as RoomState },
    async updateRoomState() {},
    send(event, payload) {
      const frame = isBinary(payload)
        ? JSON.stringify({ type: 'msg', event, b64: bytesToBase64(toBytes(payload)) })
        : JSON.stringify({ type: 'msg', event, payload })
      for (const sock of clients.keys()) sock.send(frame)
    },
    onMessage(h) { msgHandler = h },
    onRoomState() {},
  }

  return {
    transport,
    port: actualPort,
    // wss.close()의 콜백은 열린 클라 소켓이 남아 있으면 발화하지 않는다(ws 8.x) — 먼저 강제 종료.
    close: () => new Promise<void>((resolve) => {
      for (const sock of wss.clients) sock.terminate()
      wss.close(() => resolve())
    }),
  }
}

function isBinary(v: unknown): v is ArrayBuffer | ArrayBufferView {
  return v instanceof ArrayBuffer || ArrayBuffer.isView(v)
}
function toBytes(v: ArrayBuffer | ArrayBufferView): Uint8Array {
  return v instanceof ArrayBuffer ? new Uint8Array(v) : new Uint8Array(v.buffer, v.byteOffset, v.byteLength)
}
function bytesToBase64(b: Uint8Array): string { return Buffer.from(b).toString('base64') }
function base64ToArrayBuffer(b64: string): ArrayBuffer {
  const buf = Buffer.from(b64, 'base64')
  return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength)
}
