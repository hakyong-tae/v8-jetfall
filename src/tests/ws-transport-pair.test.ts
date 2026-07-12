// src/tests/ws-transport-pair.test.ts
import { describe, it, expect, afterEach } from 'vitest'
import { startWsHostTransport } from '../../server/ws-host-transport'
import { makeWsClientTransport } from '../net/ws-client-transport'

describe('ws-host-transport <-> ws-client-transport (Plan B round-trip)', () => {
  let close: () => Promise<void> = async () => {}
  afterEach(() => close())

  it('client connects, host broadcasts binary payload, client receives it with sender account', async () => {
    const host = await startWsHostTransport({ port: 0 }) // port 0 = OS가 빈 포트 배정
    close = host.close
    const received: { event: string; payload: unknown; from: string }[] = []
    host.transport.onMessage((event, payload, from) => received.push({ event, payload, from }))

    const client = makeWsClientTransport(`ws://localhost:${host.port}/`, 'alice')
    await client.connect()
    await client.joinRoom('ignored') // 플랜B는 프로세스=매치 1개라 room key 무시(로그만)

    const clientGot: unknown[] = []
    client.onMessage((event, payload) => clientGot.push({ event, payload }))

    const buf = new Uint8Array([1, 2, 3]).buffer
    client.send('snap', buf)
    await new Promise((r) => setTimeout(r, 50))
    expect(received).toHaveLength(1)
    expect(received[0].from).toBe('alice')
    expect(new Uint8Array(received[0].payload as ArrayBuffer)).toEqual(new Uint8Array([1, 2, 3]))

    host.transport.send('snap', new Uint8Array([9, 9]).buffer)
    await new Promise((r) => setTimeout(r, 50))
    expect(clientGot).toHaveLength(1)
  })
})
