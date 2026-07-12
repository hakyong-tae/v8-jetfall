// server/node-transport.ts — D단계 결정 게이트. transport.ts의 realProvider()는 Vite의
// import.meta.env를 읽어 esbuild Node 번들에선 못 쓴다(선행 사실 2) — Node 전용으로 새로 작성.
import type { Transport } from '../src/net/types'
import { startWsHostTransport } from './ws-host-transport'

// 주입 가능한 "agent8 연결 시도" 함수 — 실제 구현은 아래 realAgent8Attempt, 테스트는 가짜 주입.
export type Agent8Attempt = () => Promise<{ status: string; account?: string; raw?: unknown }>

export async function realAgent8Attempt(): Promise<{ status: string; account?: string; raw?: unknown }> {
  if (!process.env.VITE_AGENT8_VERSE) throw new Error('VITE_AGENT8_VERSE not set')
  // 변수 지정자 — esbuild가 정적 분석으로 번들에 끼워넣지 않도록(미설치 시 빌드 자체는 성공해야 함).
  const mod = '@agent8/gameserver'
  const { GameServer } = (await import(/* @vite-ignore */ mod)) as { GameServer: { getInstance: () => any } }
  const server = GameServer.getInstance()
  await server.connect()
  return { status: 'online', account: server.account, raw: server }
}

export interface ResolveOptions {
  attemptAgent8?: Agent8Attempt
  timeoutMs?: number
  wsPort?: number
  roomKey?: string
}

export interface ResolvedHostTransport {
  mode: 'agent8' | 'own-ws'
  transport: Transport
  publicUrlHint?: string // own-ws일 때만 — 실 URL은 터널 기동 후 CLI --public-url로 별도 주입(host.ts)
  close(): Promise<void>
}

// 설계 결정 1의 구현체: 실측 → 성공하면 agent8 트랜스포트, 실패/타임아웃이면 자체 ws로 폴백.
export async function resolveHostTransport(opts: ResolveOptions = {}): Promise<ResolvedHostTransport> {
  const attempt = opts.attemptAgent8 ?? realAgent8Attempt
  const timeoutMs = opts.timeoutMs ?? 4000
  try {
    const withTimeout = Promise.race([
      attempt(),
      new Promise<never>((_, rej) => setTimeout(() => rej(new Error('agent8-in-node timeout')), timeoutMs)),
    ])
    const r = await withTimeout
    if (r.status !== 'online') throw new Error(`agent8 status=${r.status}`)
    console.log('[host] agent8-in-node OK — using agent8 relay (happy path)')
    // 실제 배포에서는 여기서 raw(GameServer 인스턴스)를 src/net/transport.ts의 makeAgent8Transport와
    // 동등한 어댑터로 감싼다(브라우저와 동일 프로토콜) — 어댑터 자체는 transport.ts 재사용 가능
    // (import.meta.env 회피만 하면 되므로, provider.getInstance를 이미 연결된 인스턴스를 돌려주는
    // 클로저로 바꿔치기하면 됨). 상세 배선은 T3(host.ts)에서.
    return { mode: 'agent8', transport: null as unknown as Transport, close: async () => {} }
  } catch (err) {
    console.log(`[host] agent8-in-node unavailable (${(err as Error).message}) — falling back to own-ws`)
    const ws = await startWsHostTransport({ port: opts.wsPort ?? 8765 })
    return { mode: 'own-ws', transport: ws.transport, publicUrlHint: `ws://localhost:${ws.port}/`, close: ws.close }
  }
}
