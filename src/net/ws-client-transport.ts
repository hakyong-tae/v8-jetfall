// src/net/ws-client-transport.ts — 브라우저측(네이티브 WebSocket). 전용호스트가 플랜B일 때만
// main.ts가 이걸로 스위칭(설계 결정 3) — agent8 트랜스포트와 동일 인터페이스라 ClientSession 무수정.
import type { Transport, RoomState, RoomListing, MessageHandler } from './types'

export function makeWsClientTransport(url: string, account: string): Transport {
  let sock: WebSocket | null = null
  let msgHandler: MessageHandler = () => {}
  const t: Transport = {
    account,
    status: 'offline',
    async connect() {
      return new Promise((resolve) => {
        sock = new WebSocket(url)
        sock.onopen = () => {
          sock!.send(JSON.stringify({ type: 'hello', account }))
          ;(t as { status: Transport['status'] }).status = 'online'
          resolve('online')
        }
        sock.onerror = () => { (t as { status: Transport['status'] }).status = 'offline'; resolve('offline') }
        sock.onmessage = (ev) => {
          const parsed = JSON.parse(ev.data as string)
          if (parsed.type !== 'msg') return
          const payload = parsed.b64 ? base64ToArrayBuffer(parsed.b64) : parsed.payload
          msgHandler(parsed.event, payload, 'host') // 플랜B는 항상 호스트발 — 전용서버가 유일 발신자
        }
      })
    },
    async listRooms() { return [] as RoomListing[] },
    async joinRoom() {}, // 플랜B: 프로세스=매치1개, room 개념 없음(agent8이 로비 담당)
    async leaveRoom() { sock?.close() },
    async getRoomState() { return {} as RoomState },
    async updateRoomState() {},
    send(event, payload) {
      if (t.status !== 'online' || !sock) return
      const frame = isBinary(payload)
        ? JSON.stringify({ type: 'msg', event, b64: bytesToBase64(toBytes(payload)) })
        : JSON.stringify({ type: 'msg', event, payload })
      sock.send(frame)
    },
    onMessage(h) { msgHandler = h },
    onRoomState() {},
  }
  return t
}

function isBinary(v: unknown): v is ArrayBuffer | ArrayBufferView {
  return v instanceof ArrayBuffer || ArrayBuffer.isView(v)
}
function toBytes(v: ArrayBuffer | ArrayBufferView): Uint8Array {
  return v instanceof ArrayBuffer ? new Uint8Array(v) : new Uint8Array(v.buffer, v.byteOffset, v.byteLength)
}
function bytesToBase64(bytes: Uint8Array): string {
  let bin = ''
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i])
  return btoa(bin)
}
function base64ToArrayBuffer(b64: string): ArrayBuffer {
  const bin = atob(b64)
  const out = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i)
  return out.buffer
}
