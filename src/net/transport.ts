// src/net/transport.ts — provider 주입식 agent8 래퍼. 미배포/hang 시 offline.
import type { Transport, RoomState, RoomListing, MessageHandler } from './types'

export interface Agent8Provider {
  getInstance: () => {
    account?: string
    connect: () => Promise<void>
    remoteFunction: (name: string, args: unknown[], opts?: object) => Promise<unknown>
    onRoomMessage: (roomId: string, event: string, cb: (m: unknown) => void) => void
  }
  configured?: boolean
  timeoutMs?: number
}

const withTimeout = <T>(p: Promise<T>, ms: number): Promise<T> =>
  Promise.race([p, new Promise<T>((_, rej) => setTimeout(() => rej(new Error('net timeout')), ms))])

// ── 바이너리 페이로드 base64 래핑 (loopback 아님 — 실 agent8 relay 전용) ──────────────
// 왜: agent8 relay는 payload를 JSON 직렬화해 나른다(nox-arena/kart-rush는 평문 객체만 보냄 —
// 바이너리 전례 없음). 원시 ArrayBuffer/Uint8Array는 JSON.stringify에서 {}로 깨지므로,
// send 시 base64 문자열로 감싸 JSON-안전한 {__b64:string} 래퍼로 보내고, 수신 시 되돌린다.
// loopback은 참조 그대로 넘기므로 이 경로를 타지 않는다(무변경). 세션은 양쪽에서 동일하게
// ArrayBuffer를 받으므로 차이를 알 수 없다 — 바이너리 효율 유지 + 실 relay 투명 통과.
interface B64Wrapped { __b64: string }
function isBinary(v: unknown): v is ArrayBuffer | ArrayBufferView {
  return v instanceof ArrayBuffer || ArrayBuffer.isView(v)
}
function isWrapped(v: unknown): v is B64Wrapped {
  return typeof v === 'object' && v !== null && typeof (v as B64Wrapped).__b64 === 'string'
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
function wrapForRelay(payload: unknown): unknown {
  if (!isBinary(payload)) return payload
  const bytes = payload instanceof ArrayBuffer
    ? new Uint8Array(payload)
    : new Uint8Array(payload.buffer, payload.byteOffset, payload.byteLength)
  return { __b64: bytesToBase64(bytes) } satisfies B64Wrapped
}
function unwrapFromRelay(payload: unknown): unknown {
  return isWrapped(payload) ? base64ToArrayBuffer(payload.__b64) : payload
}

export function makeAgent8Transport(provider: Agent8Provider): Transport {
  const timeoutMs = provider.timeoutMs ?? 4000
  const configured = provider.configured ?? true
  let server: ReturnType<Agent8Provider['getInstance']> | null = null
  let roomKey: string | null = null
  let msgHandler: MessageHandler = () => {}
  let stateHandler: (s: RoomState) => void = () => {}

  const t: Transport = {
    account: '',
    status: 'offline',
    async connect() {
      const setStatus = (v: Transport['status']) => { (t as { status: Transport['status'] }).status = v }
      if (!configured) { setStatus('offline'); return t.status }
      setStatus('connecting')
      try {
        const s = provider.getInstance()
        await withTimeout(s.connect(), timeoutMs)
        server = s
        ;(t as { account: string }).account = s.account || 'me'
        setStatus('online')
      } catch { setStatus('offline') }
      return t.status
    },
    async listRooms() {
      if (t.status !== 'online' || !server) return []
      return ((await withTimeout(server.remoteFunction('listRooms', []), timeoutMs)) as RoomListing[]) ?? []
    },
    async joinRoom(key: string) {
      if (t.status !== 'online' || !server) return
      await withTimeout(server.remoteFunction('joinRoom', [key]), timeoutMs)
      roomKey = key
      server.onRoomMessage(key, 'relay', (m) => {
        const { event, payload, from } = m as { event: string; payload: unknown; from: string }
        msgHandler(event, unwrapFromRelay(payload), from) // {__b64}면 ArrayBuffer로 복원
      })
      server.onRoomMessage(key, 'state', (m) => stateHandler(m as RoomState))
    },
    async leaveRoom() {
      if (t.status !== 'online' || !server) return
      await server.remoteFunction('leaveRoom', []).catch(() => {})
      roomKey = null
    },
    async getRoomState() {
      if (t.status !== 'online' || !server) return {} as RoomState
      return ((await server.remoteFunction('getRoomState', [])) as RoomState) ?? ({} as RoomState)
    },
    async updateRoomState(patch: Record<string, unknown>) {
      if (t.status !== 'online' || !server) return
      await server.remoteFunction('updateRoomState', [patch], { needResponse: false })
    },
    send(event: string, payload: unknown) {
      if (t.status !== 'online' || !server || !roomKey) return
      server.remoteFunction('relay', [event, wrapForRelay(payload)], { needResponse: false }) // 바이너리→{__b64}
    },
    onMessage(h: MessageHandler) { msgHandler = h },
    onRoomState(h: (s: RoomState) => void) { stateHandler = h },
  }
  return t
}

// 실 SDK provider (lazy — 테스트/미배포에서 SDK 미로드)
export async function realProvider(): Promise<Agent8Provider> {
  // 미배포(VITE_AGENT8_VERSE 미설정)면 SDK를 아예 로드하지 않고 offline provider 반환 →
  // connect()가 getInstance 호출 없이 즉시 'offline'. (미설치 dev에서 import hang/error 방지)
  const configured = !!import.meta.env.VITE_AGENT8_VERSE
  if (!configured) {
    return { getInstance: () => { throw new Error('agent8 not configured') }, configured: false }
  }
  // @agent8/gameserver는 이제 정식 의존성(package.json) — vite가 번들에 포함한다. 동적 import는
  // VITE_AGENT8_VERSE가 세팅됐을 때만 실행되므로(위 게이트) 오프라인 빌드에선 로드 코드가 안 돈다.
  const { GameServer } = (await import('@agent8/gameserver')) as { GameServer: { getInstance: () => unknown } }
  return {
    getInstance: () => GameServer.getInstance() as unknown as ReturnType<Agent8Provider['getInstance']>,
    configured: true,
  }
}
