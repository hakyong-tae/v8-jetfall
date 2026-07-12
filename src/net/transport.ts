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
        msgHandler(event, payload, from)
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
      server.remoteFunction('relay', [event, payload], { needResponse: false })
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
  // @agent8/gameserver는 배포시에만 설치되는 선택적 의존성. 변수 지정자 + @vite-ignore로
  // Vite/Rollup 정적 분석·번들에서 제외 → 미설치 dev/build에서 resolve 에러 방지. 배포시 실제 로드.
  const mod = '@agent8/gameserver'
  const { GameServer } = (await import(/* @vite-ignore */ mod)) as { GameServer: { getInstance: () => unknown } }
  return {
    getInstance: () => GameServer.getInstance() as unknown as ReturnType<Agent8Provider['getInstance']>,
    configured: true,
  }
}
