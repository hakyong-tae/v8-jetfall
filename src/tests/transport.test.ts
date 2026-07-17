// src/tests/transport.test.ts
import { describe, it, expect, vi } from 'vitest'
import { makeAgent8Transport } from '../net/transport'

function mockServer() {
  const handlers: Record<string, (m: any) => void> = {}
  return {
    account: 'srv-acc',
    connect: vi.fn(async () => {}),
    remoteFunction: vi.fn(async (name: string, args: any[]) => {
      if (name === 'listRooms') return [{ key: 'r1', count: 2, mode: 0, started: false }]
      if (name === 'joinRoom') return { ok: true }
      if (name === 'getRoomState') return { mode: 0, hostAccount: 'srv-acc', started: false, roundEndsAt: 0 }
      return null
    }),
    onRoomMessage: vi.fn((roomId: string, event: string, cb: (m: any) => void) => { handlers[event] = cb }),
    _emit: (event: string, m: any) => handlers[event]?.(m),
  }
}

describe('makeAgent8Transport', () => {
  it('offline when not configured (no VITE_AGENT8_VERSE)', async () => {
    const t = makeAgent8Transport({ getInstance: () => mockServer() as any, configured: false })
    expect(await t.connect()).toBe('offline')
    expect(t.status).toBe('offline')
  })
  it('online on successful connect, exposes account', async () => {
    const t = makeAgent8Transport({ getInstance: () => mockServer() as any, configured: true })
    expect(await t.connect()).toBe('online')
    expect(t.account).toBe('srv-acc')
  })
  it('joinRoom forwards mode; touchRoom upserts via remoteFunction', async () => {
    const s = mockServer()
    const t = makeAgent8Transport({ getInstance: () => s as any, configured: true })
    await t.connect()
    await t.joinRoom('r9', 3)
    expect(s.remoteFunction).toHaveBeenCalledWith('joinRoom', ['r9', 3])
    await t.touchRoom!('r9', 3, true)
    expect(s.remoteFunction).toHaveBeenCalledWith('touchRoom', ['r9', 3, true])
  })

  // 실배포 관찰 회귀: 릴레이 WS 플랩 중 fire-and-forget 쓰기가 조용히 유실돼 방 설정/팀/레디
  // 클릭이 "반영 안 됨" — needResponse+재시도로 플랩 사이를 건너뛰고, 소진 시 던져 UI가 알림.
  it('updateRoomState retries through a flap and succeeds', async () => {
    let calls = 0
    const s = mockServer()
    s.remoteFunction = vi.fn(async (name: string) => {
      if (name === 'updateRoomState') { calls++; if (calls === 1) throw new Error('socket closed') }
      return null
    })
    const t = makeAgent8Transport({ getInstance: () => s as any, configured: true, timeoutMs: 100 })
    await t.connect()
    await t.updateRoomState({ x: 1 }) // 1회 실패 후 재시도 성공 — 던지지 않아야 함
    expect(calls).toBe(2)
  })

  it('updateRoomState throws after exhausting retries (UI can toast)', async () => {
    const s = mockServer()
    s.remoteFunction = vi.fn(async (name: string) => {
      if (name === 'updateRoomState') throw new Error('down')
      return null
    })
    const t = makeAgent8Transport({ getInstance: () => s as any, configured: true, timeoutMs: 100 })
    await t.connect()
    await expect(t.updateRoomState({ x: 1 })).rejects.toThrow()
    expect(s.remoteFunction).toHaveBeenCalledTimes(3)
  })

  it('listRooms delegates to remoteFunction', async () => {
    const t = makeAgent8Transport({ getInstance: () => mockServer() as any, configured: true })
    await t.connect()
    const rooms = await t.listRooms()
    expect(rooms[0]).toMatchObject({ key: 'r1', count: 2 })
  })
  it('offline connect times out to offline (does not hang)', async () => {
    // connect도 폴링(remoteFunction)도 응답 없음 → 유한 시간 내 offline (행 금지).
    const hang = { account: 'x', connect: () => new Promise(() => {}), remoteFunction: () => new Promise(() => {}), onRoomMessage: () => {} }
    const t = makeAgent8Transport({ getInstance: () => hang as any, configured: true, timeoutMs: 50, connectAttempts: 2, retryDelayMs: 10 })
    expect(await t.connect()).toBe('offline')
  })

  // 실배포 관찰 회귀 2제: ①첫 connect 실패/타임아웃으로 offline 오판 금지("서버 미배포" 버그)
  // ②재-connect를 다시 부르면 SDK가 붙는 중 소켓을 찢어 플랩 증폭(Connected 직후 connect
  // false 순환) — connect는 정확히 1회, 이후엔 폴링으로 성공만 감지해야 한다.
  it('first connect fails → polls (no re-connect) and goes online; connect called exactly once', async () => {
    const flaky = {
      account: 'srv-acc',
      connect: vi.fn(async () => { throw new Error('WebSocket closed before established') }),
      remoteFunction: vi.fn(async () => []), // SDK 자체 재접속이 성공한 상태를 모사 — 폴링 응답 OK
      onRoomMessage: () => {},
    }
    const t = makeAgent8Transport({ getInstance: () => flaky as any, configured: true, timeoutMs: 100, retryDelayMs: 10 })
    expect(await t.connect()).toBe('online')
    expect(flaky.connect).toHaveBeenCalledTimes(1) // ← 재-connect로 SDK와 싸우지 않음
  })

  // ── SDK 스토어 위임 경로 (라이브 플랩 근본수정) — 스토어가 connect 수명주기를 소유하고,
  // 우리는 connected 플래그만 관찰한다. raw connect()는 절대 직접 부르지 않는다(부르면 스토어
  // focus 핸들러와 경합해 소켓을 찢음).
  function mockStore(initialConnected = false) {
    let state = { connected: initialConnected, account: 'store-acc' }
    const subs: Array<(s: { connected: boolean }) => void> = []
    return {
      getState: () => ({
        ...state,
        connect: vi.fn(async () => { state = { ...state, connected: true }; subs.forEach((f) => f({ connected: true })) }),
      }),
      subscribe: (fn: (s: { connected: boolean }) => void) => { subs.push(fn); return () => {} },
      _drop() { state = { ...state, connected: false }; subs.forEach((f) => f({ connected: false })) },
      _restore() { state = { ...state, connected: true }; subs.forEach((f) => f({ connected: true })) },
    }
  }

  it('store path: delegates connect to the SDK store, never calls raw connect()', async () => {
    const s = mockServer()
    const store = mockStore()
    const t = makeAgent8Transport({ getInstance: () => s as any, store: store as any, configured: true, timeoutMs: 200, retryDelayMs: 10 })
    expect(await t.connect()).toBe('online')
    expect(t.account).toBe('store-acc')
    expect(s.connect).not.toHaveBeenCalled() // ← 핵심: raw connect 미호출(스토어 소유)
  })

  it('store path: mirrors drops as connecting (not offline) and recovers to online', async () => {
    const s = mockServer()
    const store = mockStore()
    const t = makeAgent8Transport({ getInstance: () => s as any, store: store as any, configured: true, timeoutMs: 200, retryDelayMs: 10 })
    await t.connect()
    store._drop() // 스토어가 재접속 중 — 우리는 재-connect 안 하고 상태만 미러링
    expect(t.status).toBe('connecting')
    store._restore()
    expect(t.status).toBe('online')
    expect(s.connect).not.toHaveBeenCalled()
  })

  it('store path: goes offline when the store never connects within budget', async () => {
    const s = mockServer()
    const store = mockStore()
    // connect가 connected를 안 올리는 스토어(백엔드 다운 모사)
    const dead = {
      getState: () => ({ connected: false, account: '', connect: vi.fn(async () => {}) }),
      subscribe: () => () => {},
    }
    void s // (미사용 경고 방지)
    const t = makeAgent8Transport({ getInstance: () => mockServer() as any, store: dead as any, configured: true, timeoutMs: 100, connectAttempts: 1, retryDelayMs: 50 })
    expect(await t.connect()).toBe('offline')
    void store
  })

  it('gives up as offline after connect fails and all polls fail', async () => {
    const dead = {
      account: 'x',
      connect: vi.fn(async () => { throw new Error('down') }),
      remoteFunction: vi.fn(async () => { throw new Error('down') }),
      onRoomMessage: () => {},
    }
    const t = makeAgent8Transport({ getInstance: () => dead as any, configured: true, timeoutMs: 100, connectAttempts: 3, retryDelayMs: 10 })
    expect(await t.connect()).toBe('offline')
    expect(dead.connect).toHaveBeenCalledTimes(1)
    expect(dead.remoteFunction).toHaveBeenCalledTimes(3) // 폴링 3회
  })
})

// 실 agent8 relay는 payload를 JSON 직렬화한다(nox-arena/kart-rush는 평문 객체만 보냄).
// 이 버스 모의는 그 직렬화를 JSON.parse(JSON.stringify(...))로 재현한다 — 원시 ArrayBuffer면
// {}로 깨지므로, transport의 base64 래핑이 없으면 라운드트립이 실패해야 한다.
function relayBus() {
  const subs: Array<(m: any) => void> = []
  function makeInstance(account: string) {
    return {
      account,
      connect: vi.fn(async () => {}),
      remoteFunction: vi.fn(async (name: string, args: any[]) => {
        if (name === 'relay') {
          const [event, payload] = args
          const serialized = JSON.parse(JSON.stringify({ event, payload, from: account }))
          for (const cb of subs) cb(serialized)
        }
        return null
      }),
      onRoomMessage: vi.fn((_room: string, event: string, cb: (m: any) => void) => {
        if (event === 'relay') subs.push(cb)
      }),
    }
  }
  return { makeInstance }
}

describe('makeAgent8Transport binary relay (base64 wrap — survives JSON serialization)', () => {
  it('a binary payload sent comes back as an equal Uint8Array on another subscriber', async () => {
    const bus = relayBus()
    const sender = makeAgent8Transport({ getInstance: () => bus.makeInstance('alice') as any, configured: true })
    const receiver = makeAgent8Transport({ getInstance: () => bus.makeInstance('bob') as any, configured: true })
    await sender.connect(); await receiver.connect()
    await sender.joinRoom('r'); await receiver.joinRoom('r')

    const got: { event: string; payload: unknown; from: string }[] = []
    receiver.onMessage((event, payload, from) => got.push({ event, payload, from }))

    const bytes = new Uint8Array([1, 2, 3, 250, 0, 255, 128])
    sender.send('input', bytes.buffer)
    await Promise.resolve(); await Promise.resolve()

    expect(got).toHaveLength(1)
    expect(got[0].event).toBe('input')
    expect(got[0].from).toBe('alice')
    expect(got[0].payload instanceof ArrayBuffer).toBe(true)
    expect(new Uint8Array(got[0].payload as ArrayBuffer)).toEqual(bytes)
  })

  it('plain object payloads (e.g. ASSIGN) pass through unchanged (no wrapper)', async () => {
    const bus = relayBus()
    const sender = makeAgent8Transport({ getInstance: () => bus.makeInstance('host') as any, configured: true })
    const receiver = makeAgent8Transport({ getInstance: () => bus.makeInstance('bob') as any, configured: true })
    await sender.connect(); await receiver.connect()
    await sender.joinRoom('r'); await receiver.joinRoom('r')

    const got: unknown[] = []
    receiver.onMessage((_event, payload) => got.push(payload))
    sender.send('assign', { account: 'bob', num: 3 })
    await Promise.resolve(); await Promise.resolve()

    expect(got).toEqual([{ account: 'bob', num: 3 }])
  })
})
