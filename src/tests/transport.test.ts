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
  it('listRooms delegates to remoteFunction', async () => {
    const t = makeAgent8Transport({ getInstance: () => mockServer() as any, configured: true })
    await t.connect()
    const rooms = await t.listRooms()
    expect(rooms[0]).toMatchObject({ key: 'r1', count: 2 })
  })
  it('offline connect times out to offline (does not hang)', async () => {
    const hang = { account: 'x', connect: () => new Promise(() => {}), remoteFunction: async () => null, onRoomMessage: () => {} }
    const t = makeAgent8Transport({ getInstance: () => hang as any, configured: true, timeoutMs: 50 })
    expect(await t.connect()).toBe('offline')
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
