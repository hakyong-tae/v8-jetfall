// src/tests/client-session.test.ts
import { describe, it, expect } from 'vitest'
import { LoopbackHub } from '../net/loopback'
import { ClientSession } from '../net/client-session'
import { encodeSnapshot, MSG, type SnapshotSprite } from '../net/protocol'
import { setupTestGame } from './helpers'

function neutralControl(overrides: Partial<SnapshotSprite['control']> = {}) {
  return { left: false, right: false, up: false, down: false, fire: false, jetpack: false,
    throwNade: false, changeWeapon: false, throwWeapon: false, reload: false, prone: false,
    flagThrow: false, mouseAimX: 0, mouseAimY: 0, ...overrides }
}

describe('ClientSession', () => {
  it('creates a local ghost sprite on first snapshot sighting, at the exact host-assigned slot', async () => {
    const hub = new LoopbackHub()
    const t = hub.createTransport('bob')
    t.connect(); t.joinRoom('r')
    const gs = setupTestGame({ emptyMap: true })
    const client = new ClientSession(t, gs, 'bob', () => neutralControl())
    void client

    expect(gs.sprite[5].active).toBe(false)
    // 다른 트랜스포트에서 스냅샷을 보내 bob에게 전달
    const senderT = hub.createTransport('host')
    senderT.connect(); senderT.joinRoom('r')
    senderT.send(MSG.SNAPSHOT, encodeSnapshot({ tick: 1, sprites: [{
      num: 5, team: 0, direction: 1, deadMeat: false, health: 150, jetsCount: 0,
      legsAnimId: 1, legsFrame: 1, bodyAnimId: 1, bodyFrame: 1, lastInputSeq: 0,
      posX: 100, posY: 200, velX: 0, velY: 0, control: neutralControl(),
    }] }))
    await Promise.resolve()
    expect(gs.sprite[5].active).toBe(true)
    expect(gs.spriteParts.pos[5].x).toBeCloseTo(100, 0)
  })

  it("own sprite moves from local input; ASSIGN routes control writes to the right slot", async () => {
    const hub = new LoopbackHub()
    const t = hub.createTransport('alice')
    t.connect(); t.joinRoom('r')
    const gs = setupTestGame({ emptyMap: true })
    let input = neutralControl({ right: true, mouseAimX: 500 })
    void input
    const client = new ClientSession(t, gs, 'alice', () => input)

    const hostT = hub.createTransport('host')
    hostT.connect(); hostT.joinRoom('r')
    hostT.send(MSG.ASSIGN, { account: 'alice', num: 3 })
    hostT.send(MSG.SNAPSHOT, encodeSnapshot({ tick: 1, sprites: [{
      num: 3, team: 0, direction: 1, deadMeat: false, health: 150, jetsCount: 0,
      legsAnimId: 1, legsFrame: 1, bodyAnimId: 1, bodyFrame: 1, lastInputSeq: 0,
      posX: 0, posY: 0, velX: 0, velY: 0, control: neutralControl(),
    }] }))
    await Promise.resolve()

    expect(client.myNum).toBe(3)
    const startX = gs.spriteParts.pos[3].x
    for (let i = 0; i < 60; i++) client.tick()
    expect(gs.spriteParts.pos[3].x).toBeGreaterThan(startX)
  })

  it('position correction pulls a diverged sprite toward the snapshot over successive corrections', async () => {
    const hub = new LoopbackHub()
    const t = hub.createTransport('bob')
    t.connect(); t.joinRoom('r')
    const gs = setupTestGame({ emptyMap: true })
    const client = new ClientSession(t, gs, 'bob', () => neutralControl())
    void client
    const hostT = hub.createTransport('host')
    hostT.connect(); hostT.joinRoom('r')

    const snap = (posX: number) => encodeSnapshot({ tick: 1, sprites: [{
      num: 4, team: 0, direction: 1, deadMeat: false, health: 150, jetsCount: 0,
      legsAnimId: 1, legsFrame: 1, bodyAnimId: 1, bodyFrame: 1, lastInputSeq: 0,
      posX, posY: 0, velX: 0, velY: 0, control: neutralControl(),
    }] })

    hostT.send(MSG.SNAPSHOT, snap(0)) // 최초 생성 — pos=0
    await Promise.resolve()
    const errors: number[] = []
    for (let i = 0; i < 5; i++) {
      hostT.send(MSG.SNAPSHOT, snap(100)) // 호스트는 계속 x=100이라 보고(자기는 안 움직임 가정)
      await Promise.resolve()
      errors.push(Math.abs(gs.spriteParts.pos[4].x - 100))
    }
    // 오차가 단조 감소하며 수렴 (지수 스무딩 — 튐 없음)
    for (let i = 1; i < errors.length; i++) expect(errors[i]).toBeLessThanOrEqual(errors[i - 1])
    expect(errors[errors.length - 1]).toBeLessThan(errors[0])
  })
})
