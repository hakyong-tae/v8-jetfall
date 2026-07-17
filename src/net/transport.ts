// src/net/transport.ts — provider 주입식 agent8 래퍼. 미배포/hang 시 offline.
import type { Transport, RoomState, RoomListing, MessageHandler } from './types'

export interface Agent8Provider {
  getInstance: () => {
    account?: string
    connect: () => Promise<void>
    remoteFunction: (name: string, args: unknown[], opts?: object) => Promise<unknown>
    onRoomMessage: (roomId: string, event: string, cb: (m: unknown) => void) => void
  }
  // SDK의 zustand 스토어(딥임포트) — 있으면 접속 수명주기를 전적으로 스토어에 위임한다.
  // 이유(라이브 플랩 근본원인): 스토어는 모듈 로드만으로 window focus/visibility 리스너를 전역
  // 등록하고, 자기 connected 플래그가 false면 focus마다 server.connect()를 강제 재호출해
  // "남이 직접 연결한" 건강한 소켓을 찢는다. 우리가 GameServer를 직접 connect하면 스토어
  // 플래그가 영원히 false → 창 전환마다 재접속 폭풍. 스토어를 통해 접속하면 connected=true가
  // 유지돼 focus 핸들러가 무동작이 되고, 끊김 복구도 스토어의 관리형 백오프가 담당한다.
  store?: {
    getState: () => {
      connected: boolean
      account: string
      connect: (config?: object) => Promise<void>
    }
    subscribe: (fn: (s: { connected: boolean }) => void) => () => void
  }
  configured?: boolean
  timeoutMs?: number
  connectAttempts?: number // 기본 3 — 릴레이 첫 WS가 끊겼다 붙는 패턴 흡수 (테스트 주입용)
  retryDelayMs?: number // 기본 1500 — 재시도 간 대기 (테스트 주입용)
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
      const ATTEMPTS = provider.connectAttempts ?? 3
      const RETRY_DELAY_MS = provider.retryDelayMs ?? 1500
      const s = provider.getInstance()
      // dev 전용 진단 핸들 — 브라우저 콘솔에서 remoteFunction을 직접 때려볼 수 있게.
      if (import.meta.env.DEV && typeof window !== 'undefined') (window as unknown as { __a8?: object }).__a8 = { server: s, store: provider.store, transport: t }
      const adopt = (): Transport['status'] => {
        server = s
        ;(t as { account: string }).account = s.account || 'me'
        setStatus('online')
        return t.status
      }
      // ── 정식 경로: SDK 스토어에 접속 수명주기 위임 (Agent8Provider.store 주석 참조 — 플랩
      // 근본원인 봉합). 스토어 connect는 완료를 promise로 알리지 않고 connected 플래그로
      // 알리므로 폴링으로 성공을 감지한다. 이후 끊김/복구는 스토어 구독으로 상태만 반영
      // (재접속은 스토어의 관리형 백오프 + focus 핸들러가 담당 — 우리는 connect를 다시 부르지 않는다).
      if (provider.store) {
        const st = provider.store
        if (!st.getState().connected) {
          void st.getState().connect().catch(() => { /* 실패는 connected 폴링으로 판정 */ })
          const budgetMs = timeoutMs + ATTEMPTS * RETRY_DELAY_MS
          const deadline = Date.now() + budgetMs
          while (Date.now() < deadline && !st.getState().connected) {
            await new Promise((r) => setTimeout(r, 200))
          }
        }
        if (st.getState().connected) {
          st.subscribe(({ connected: c }) => {
            // 세션 중 상태 미러링 — 스토어가 재접속 중이면 'connecting'(offline 아님: 폴백 방지),
            // 복구되면 'online'. connect 재호출 금지(스토어가 함).
            if (t.status === 'offline') return // 우리가 명시적으로 포기한 뒤에는 미러링 중단
            setStatus(c ? 'online' : 'connecting')
          })
          const acc = st.getState().account
          server = s
          ;(t as { account: string }).account = acc || s.account || 'me'
          setStatus('online')
          return t.status
        }
        setStatus('offline')
        return t.status
      }
      // ── 폴백 경로(스토어 미주입 — 테스트/딥임포트 실패): connect 1회 + remoteFunction 폴링.
      // connect()를 재호출하면 SDK가 붙는 중 소켓을 찢어 자체 재접속과 싸우므로 절대 재호출 금지.
      try {
        await withTimeout(s.connect(), timeoutMs)
        return adopt()
      } catch { /* 느린 성공/자체 재접속 가능 — 아래 폴링으로 확인 */ }
      for (let attempt = 0; attempt < ATTEMPTS; attempt++) {
        await new Promise((r) => setTimeout(r, RETRY_DELAY_MS))
        try {
          await withTimeout(s.remoteFunction('listRooms', []), timeoutMs) // 응답 오면 = 연결 살아있음
          return adopt()
        } catch { /* 아직 — 다음 폴링 */ }
      }
      setStatus('offline')
      return t.status
    },
    async listRooms() {
      if (t.status !== 'online' || !server) return []
      return ((await withTimeout(server.remoteFunction('listRooms', []), timeoutMs)) as RoomListing[]) ?? []
    },
    async joinRoom(key: string, mode?: number) {
      if (t.status !== 'online' || !server) return
      await withTimeout(server.remoteFunction('joinRoom', [key, mode]), timeoutMs)
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
    // 방 목록 컬렉션 upsert 하트비트 — 실 릴레이에서 joinRoom의 컬렉션 쓰기가 조용히 실패하면
    // 다른 브라우저에 방이 영영 안 보인다. 방장이 주기 호출해 자가치유(실패는 호출자에 전파 →
    // 콘솔 경고로 가시화).
    async touchRoom(key: string, mode: number, started: boolean) {
      if (t.status !== 'online' || !server) return
      await withTimeout(server.remoteFunction('touchRoom', [key, mode, started]), timeoutMs)
    },
    async getRoomState() {
      if (t.status !== 'online' || !server) return {} as RoomState
      return ((await server.remoteFunction('getRoomState', [])) as RoomState) ?? ({} as RoomState)
    },
    async updateRoomState(patch: Record<string, unknown>) {
      if (t.status !== 'online' || !server) return
      // 실배포 관찰: 릴레이 WS가 수시로 끊겼다 붙는 동안 fire-and-forget 쓰기가 조용히 유실돼
      // 방 설정/팀/레디 클릭이 "반영 안 되는" 증상이 됨(콘솔 net timeout들이 그 흔적).
      // 응답 확인(needResponse) + 3회 재시도(300ms 증분 대기)로 플랩 사이를 건너뛴다.
      // 최종 실패는 던져서 UI가 토스트로 알리게 한다.
      let lastErr: unknown
      for (let attempt = 0; attempt < 3; attempt++) {
        try {
          await withTimeout(server.remoteFunction('updateRoomState', [patch], { needResponse: true }), timeoutMs)
          return
        } catch (e) {
          lastErr = e
          if (attempt < 2) await new Promise((r) => setTimeout(r, 300 * (attempt + 1)))
        }
      }
      console.warn('[net] updateRoomState failed after retries:', lastErr)
      throw lastErr
    },
    send(event: string, payload: unknown, hot?: boolean) {
      if (t.status !== 'online' || !server || !roomKey) return
      // agent8 remoteFunction 호출 캡은 함수 이름별 — 전부 'relay' 하나로 몰면 스냅샷(고빈도)이
      // 캡을 넘겨 "Too many calls" 에러. 고빈도 latest-wins(스냅샷/입력)는 별도 'relayHot'로
      // throttle(초과분 드롭, 최신만 유지)해 보내고, 개별 이벤트(탄환/킬/배정/로드아웃)는 'relay'로
      // 신뢰성 유지 — nox-arena updatePos(throttle) vs castFx/reportKill(무throttle) 패턴과 동일.
      if (hot) {
        server.remoteFunction('relayHot', [event, wrapForRelay(payload)], { throttle: 50, needResponse: false })
      } else {
        server.remoteFunction('relay', [event, wrapForRelay(payload)], { needResponse: false }) // 바이너리→{__b64}
      }
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
  // SDK 스토어 딥임포트 — index가 재수출하지 않아 내부 경로로 가져온다(패키지에 exports 맵 없음
  // = 서브패스 허용). 실패 시 스토어 없이 폴백 경로(connect 1회+폴링)로 동작(연결은 되지만
  // focus 재접속 폭풍 리스크가 남으므로 콘솔 경고로 가시화).
  let store: Agent8Provider['store']
  try {
    const mod = (await import('@agent8/gameserver/dist/src/store/useGameServerStore')) as {
      useGameServerStore: NonNullable<Agent8Provider['store']>
    }
    store = mod.useGameServerStore
  } catch (e) {
    console.warn('[net] SDK store deep-import failed — falling back to raw connect (focus-reconnect risk):', e)
  }
  return {
    getInstance: () => GameServer.getInstance() as unknown as ReturnType<Agent8Provider['getInstance']>,
    store,
    configured: true,
  }
}
