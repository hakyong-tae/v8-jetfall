// src/net/reconnect.ts — ClientSession은 재구성하지 않는다: Transport 객체 동일성이 재연결
// 전후로 유지되는 한(agent8/loopback 모두 그렇다) onMessage 핸들러가 살아있어 재접속 후 자동으로
// 스냅샷을 이어 받는다. 필요한 건 connect() 재시도 + 같은 방 rejoin뿐.
import type { Transport } from './types'

export interface ReconnectOptions {
  transport: Transport
  roomKey: string
  maxAttempts?: number
  backoffMs?: number
  sleepFn?: (ms: number) => Promise<void>
}
export type ReconnectResult = 'reconnected' | 'gave-up'
const defaultSleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))

export async function attemptReconnect(opts: ReconnectOptions): Promise<ReconnectResult> {
  const maxAttempts = opts.maxAttempts ?? 3
  const backoffMs = opts.backoffMs ?? 1000
  const sleep = opts.sleepFn ?? defaultSleep
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const status = await opts.transport.connect()
    if (status === 'online') {
      await opts.transport.joinRoom(opts.roomKey)
      return 'reconnected'
    }
    if (attempt < maxAttempts) await sleep(backoffMs * attempt)
  }
  return 'gave-up'
}
