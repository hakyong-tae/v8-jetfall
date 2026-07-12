// src/tests/reconnect.test.ts — M3-E: 재접속 시도 + 포기(→오프라인 폴백) 순수 검증.
import { describe, it, expect, vi } from 'vitest'
import { attemptReconnect } from '../net/reconnect'
import type { Transport } from '../net/types'

// connect()가 미리 준비된 상태 시퀀스를 순서대로 반환하는 가짜 Transport.
function fakeTransport(statuses: Transport['status'][]) {
  const connect = vi.fn(async () => statuses.shift() ?? 'offline')
  const joinRoom = vi.fn(async () => {})
  const t = { connect, joinRoom } as unknown as Transport
  return { t, connect, joinRoom }
}

describe('M3-E: attemptReconnect with backoff', () => {
  it('succeeds on first attempt → reconnected + joinRoom(roomKey) called', async () => {
    const { t, connect, joinRoom } = fakeTransport(['online'])
    const sleepFn = vi.fn((_ms: number) => Promise.resolve())
    const result = await attemptReconnect({ transport: t, roomKey: 'r1', sleepFn })
    expect(result).toBe('reconnected')
    expect(connect).toHaveBeenCalledTimes(1)
    expect(joinRoom).toHaveBeenCalledWith('r1')
    expect(sleepFn).not.toHaveBeenCalled()
  })

  it('offline,offline,online → reconnects after retries; sleepFn called with escalating backoff', async () => {
    const { t, connect, joinRoom } = fakeTransport(['offline', 'offline', 'online'])
    const sleepFn = vi.fn((_ms: number) => Promise.resolve())
    const result = await attemptReconnect({ transport: t, roomKey: 'r2', backoffMs: 1000, sleepFn })
    expect(result).toBe('reconnected')
    expect(connect).toHaveBeenCalledTimes(3)
    expect(joinRoom).toHaveBeenCalledWith('r2')
    expect(sleepFn.mock.calls.map((c) => c[0])).toEqual([1000, 2000]) // backoffMs*attempt
  })

  it('all offline → gave-up; joinRoom never called', async () => {
    const { t, connect, joinRoom } = fakeTransport(['offline', 'offline', 'offline'])
    const sleepFn = vi.fn((_ms: number) => Promise.resolve())
    const result = await attemptReconnect({ transport: t, roomKey: 'r3', maxAttempts: 3, backoffMs: 1000, sleepFn })
    expect(result).toBe('gave-up')
    expect(connect).toHaveBeenCalledTimes(3)
    expect(joinRoom).not.toHaveBeenCalled()
    expect(sleepFn.mock.calls.map((c) => c[0])).toEqual([1000, 2000]) // 마지막 시도 뒤엔 sleep 안 함
  })
})
