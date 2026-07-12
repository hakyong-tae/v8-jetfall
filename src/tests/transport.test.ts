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
