// src/tests/loopback.test.ts
import { describe, it, expect } from 'vitest'
import { LoopbackHub } from '../net/loopback'

describe('LoopbackHub', () => {
  it('two transports join same room and see each other in room state', async () => {
    const hub = new LoopbackHub()
    const a = hub.createTransport('alice')
    const b = hub.createTransport('bob')
    await a.connect(); await b.connect()
    expect(a.status).toBe('online')
    await a.joinRoom('room1')
    await a.updateRoomState({ mode: 0, hostAccount: 'alice', started: false, roundEndsAt: 0, p_alice: { nick: 'Alice', team: 0, ready: false, kills: 0, deaths: 0, joinedAt: 1 } })
    await b.joinRoom('room1')
    await b.updateRoomState({ p_bob: { nick: 'Bob', team: 0, ready: false, kills: 0, deaths: 0, joinedAt: 2 } })
    const state = await a.getRoomState()
    expect((state.p_alice as any).nick).toBe('Alice')
    expect((state.p_bob as any).nick).toBe('Bob')
  })

  it('broadcast reaches other members but not sender-only, includes fromAccount', async () => {
    const hub = new LoopbackHub()
    const a = hub.createTransport('alice'); const b = hub.createTransport('bob')
    await a.connect(); await b.connect()
    await a.joinRoom('r'); await b.joinRoom('r')
    const got: any[] = []
    b.onMessage((event, payload, from) => got.push({ event, payload, from }))
    a.send('ping', { n: 42 })
    await Promise.resolve() // flush microtasks
    expect(got).toEqual([{ event: 'ping', payload: { n: 42 }, from: 'alice' }])
  })

  it('updateRoomState null deletes a key and notifies onRoomState', async () => {
    const hub = new LoopbackHub()
    const a = hub.createTransport('alice'); await a.connect(); await a.joinRoom('r')
    let last: any = null; a.onRoomState((s) => { last = s })
    await a.updateRoomState({ p_alice: { nick: 'A', team: 1, ready: false, kills: 0, deaths: 0, joinedAt: 1 } })
    expect(last.p_alice.team).toBe(1)
    await a.updateRoomState({ p_alice: null })
    expect(last.p_alice).toBeUndefined()
  })

  it('listRooms reflects joined rooms with counts', async () => {
    const hub = new LoopbackHub()
    const a = hub.createTransport('alice'); await a.connect(); await a.joinRoom('room1')
    await a.updateRoomState({ mode: 3, started: false })
    const rooms = await a.listRooms()
    expect(rooms.find((r) => r.key === 'room1')).toMatchObject({ key: 'room1', count: 1, mode: 3 })
  })
})
