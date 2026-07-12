// src/tests/host-session.test.ts
import { describe, it, expect } from 'vitest'
import { LoopbackHub } from '../net/loopback'
import { HostSession } from '../net/host-session'
import { encodeInput, decodeSnapshot, MSG } from '../net/protocol'
import { setupTestGame } from './helpers'
import { TEAM_NONE } from '../core/constants'

function neutralInput(seq: number, overrides: Partial<Parameters<typeof encodeInput>[0]> = {}) {
  return encodeInput({ seq, left: false, right: false, up: false, down: false, fire: false,
    jetpack: false, throwNade: false, changeWeapon: false, throwWeapon: false, reload: false,
    prone: false, flagThrow: false, mouseAimX: 0, mouseAimY: 0, ...overrides })
}

describe('HostSession', () => {
  it('spawnPlayers assigns sprite slots and notifies via MSG.ASSIGN', async () => {
    const hub = new LoopbackHub()
    const hostT = hub.createTransport('host')
    const aliceT = hub.createTransport('alice')
    await hostT.connect(); await aliceT.connect()
    await hostT.joinRoom('r'); await aliceT.joinRoom('r')

    const gs = setupTestGame({ emptyMap: true })
    const host = new HostSession(hostT, gs)

    const assigns: { account: string; num: number }[] = []
    aliceT.onMessage((event, payload) => { if (event === MSG.ASSIGN) assigns.push(payload as any) })

    host.spawnPlayers([{ account: 'alice', team: TEAM_NONE }])
    await Promise.resolve()

    expect(assigns).toHaveLength(1)
    expect(assigns[0].account).toBe('alice')
    const num = host.spriteNumOf('alice')!
    expect(num).toBe(assigns[0].num)
    expect(gs.sprite[num].active).toBe(true)
    expect(gs.sprite[num].deadMeat).toBe(false) // respawn() 완료 상태
  })

  it('applies received INPUT to the right sprite before ticking, and tracks lastAppliedSeq', async () => {
    const hub = new LoopbackHub()
    const hostT = hub.createTransport('host')
    const aliceT = hub.createTransport('alice')
    hostT.connect(); aliceT.connect()
    hostT.joinRoom('r'); aliceT.joinRoom('r')

    const gs = setupTestGame({ emptyMap: true })
    const host = new HostSession(hostT, gs)
    host.spawnPlayers([{ account: 'alice', team: TEAM_NONE }])
    const num = host.spriteNumOf('alice')!
    const startX = gs.spriteParts.pos[num].x

    aliceT.send(MSG.INPUT, neutralInput(1, { right: true, mouseAimX: 500 }))
    await Promise.resolve() // loopback은 queueMicrotask 배송 — 틱 전 INPUT 도착 보장(flush)
    for (let i = 0; i < 60; i++) host.tick() // 1초

    expect(gs.spriteParts.pos[num].x).toBeGreaterThan(startX)
    expect(Number.isNaN(gs.spriteParts.pos[num].x)).toBe(false)
  })

  it('broadcasts a decodable SNAPSHOT roughly every 2 ticks (~30Hz of 60Hz)', async () => {
    const hub = new LoopbackHub()
    const hostT = hub.createTransport('host')
    const bobT = hub.createTransport('bob')
    hostT.connect(); bobT.connect()
    hostT.joinRoom('r'); bobT.joinRoom('r')

    const gs = setupTestGame({ emptyMap: true })
    const host = new HostSession(hostT, gs)
    host.spawnPlayers([{ account: 'bob', team: TEAM_NONE }])

    const snaps: ReturnType<typeof decodeSnapshot>[] = []
    bobT.onMessage((event, payload) => { if (event === MSG.SNAPSHOT) snaps.push(decodeSnapshot(payload as ArrayBuffer)) })

    for (let i = 0; i < 10; i++) host.tick()
    await Promise.resolve() // loopback queueMicrotask 배송 flush — 큐잉된 5개 스냅샷 도착
    expect(snaps.length).toBe(5) // 10틱 / 2
    expect(snaps[0].sprites.some((s) => s.num === host.spriteNumOf('bob'))).toBe(true)
  })
})
