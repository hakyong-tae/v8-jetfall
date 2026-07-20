// src/tests/client-session.test.ts
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import { LoopbackHub } from '../net/loopback'
import { ClientSession } from '../net/client-session'
import {
  encodeSnapshot, encodeBullet, MSG,
  type SnapshotSprite, type BulletMsg, type KillMsg, type FlagState,
} from '../net/protocol'
import { setupTestGame } from './helpers'
import { OBJECT_ALPHA_FLAG, GAMESTYLE_CTF } from '../core/constants'
import { createWeapons, loadWeaponsConfig, AK74_NUM, MP5_NUM, NOWEAPON_NUM } from '../core/weapons'

// MSG.BULLET 수신 시 createBullet()가 전역 guns[]를 인덱싱하므로 실전 무기 스탯을 적재해 둔다.
const assetsDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../public/assets')
const weaponsJson = JSON.parse(readFileSync(path.join(assetsDir, 'weapons.json'), 'utf-8'))
createWeapons(false)
loadWeaponsConfig(weaponsJson.normal)

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
    senderT.send(MSG.SNAPSHOT, encodeSnapshot({ tick: 1, teamScore1: 0, teamScore2: 0, sprites: [{
      num: 5, team: 0, direction: 1, deadMeat: false, health: 150, jetsCount: 0,
      legsAnimId: 1, legsFrame: 1, bodyAnimId: 1, bodyFrame: 1, lastInputSeq: 0,
      posX: 100, posY: 200, velX: 0, velY: 0, kills: 0, deaths: 0, weaponNum: 3, control: neutralControl(),
    }] }))
    await Promise.resolve()
    expect(gs.sprite[5].active).toBe(true)
    expect(gs.spriteParts.pos[5].x).toBeCloseTo(100, 0)
  })

  // 렉 완화 회귀(2026-07-20): 자기 스프라이트는 ~1 RTT 뒤처진 스냅샷에 끌려가면 안 된다(고무줄).
  // 로컬 예측이 앞서 있을 때(작은 오차) 스냅샷은 위치를 당기지 말고, 속도는 하드스냅이 아니라 lerp.
  it('local sprite is NOT yanked back by a stale (behind) snapshot — no self rubber-band', async () => {
    const hub = new LoopbackHub()
    const t = hub.createTransport('alice')
    t.connect(); t.joinRoom('r')
    const gs = setupTestGame({ emptyMap: true })
    const client = new ClientSession(t, gs, 'alice', () => neutralControl())
    const hostT = hub.createTransport('host')
    hostT.connect(); hostT.joinRoom('r')
    hostT.send(MSG.ASSIGN, { account: 'alice', num: 3 })
    const snap = (posX: number, velX: number) => encodeSnapshot({ tick: 1, teamScore1: 0, teamScore2: 0, sprites: [{
      num: 3, team: 0, direction: 1, deadMeat: false, health: 150, jetsCount: 0,
      legsAnimId: 1, legsFrame: 1, bodyAnimId: 1, bodyFrame: 1, lastInputSeq: 0,
      posX, posY: 0, velX, velY: 0, kills: 0, deaths: 0, weaponNum: 3, control: neutralControl(),
    }] })
    hostT.send(MSG.SNAPSHOT, snap(100, 5)); await Promise.resolve()
    expect(client.myNum).toBe(3)

    // 로컬 예측이 앞서감(오차 20px < 임계 28px). 속도 5로 우이동 중.
    gs.spriteParts.pos[3].x = 130
    gs.spriteParts.velocity[3].x = 5
    hostT.send(MSG.SNAPSHOT, snap(110, 2)); await Promise.resolve() // 뒤처진 스냅샷(x=110, vel=2)
    // 위치는 임계 내이므로 당겨지지 않아야(고무줄 없음) — 예전엔 25%씩 뒤로 끌려 125가 됐다.
    expect(gs.spriteParts.pos[3].x).toBe(130)
    // 속도는 하드스냅(2) 금지 — lerp만: 5 + (2-5)*0.10 = 4.7
    expect(gs.spriteParts.velocity[3].x).toBeGreaterThan(4)
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
    hostT.send(MSG.SNAPSHOT, encodeSnapshot({ tick: 1, teamScore1: 0, teamScore2: 0, sprites: [{
      num: 3, team: 0, direction: 1, deadMeat: false, health: 150, jetsCount: 0,
      legsAnimId: 1, legsFrame: 1, bodyAnimId: 1, bodyFrame: 1, lastInputSeq: 0,
      posX: 0, posY: 0, velX: 0, velY: 0, kills: 0, deaths: 0, weaponNum: 3, control: neutralControl(),
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

    const snap = (posX: number) => encodeSnapshot({ tick: 1, teamScore1: 0, teamScore2: 0, sprites: [{
      num: 4, team: 0, direction: 1, deadMeat: false, health: 150, jetsCount: 0,
      legsAnimId: 1, legsFrame: 1, bodyAnimId: 1, bodyFrame: 1, lastInputSeq: 0,
      posX, posY: 0, velX: 0, velY: 0, kills: 0, deaths: 0, weaponNum: 3, control: neutralControl(),
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

  it('own local input with fire=true never spawns a local bullet by itself (suppressed); only MSG.BULLET does', async () => {
    const hub = new LoopbackHub()
    const t = hub.createTransport('alice')
    t.connect(); t.joinRoom('r')
    const gs = setupTestGame({ emptyMap: true })
    const client = new ClientSession(t, gs, 'alice', () => neutralControl({ fire: true, mouseAimX: 500 }))
    void client
    const hostT = hub.createTransport('host')
    hostT.connect(); hostT.joinRoom('r')
    hostT.send(MSG.ASSIGN, { account: 'alice', num: 3 })
    hostT.send(MSG.SNAPSHOT, encodeSnapshot({ tick: 1, teamScore1: 0, teamScore2: 0, sprites: [{
      num: 3, team: 0, direction: 1, deadMeat: false, health: 150, jetsCount: 0,
      legsAnimId: 1, legsFrame: 1, bodyAnimId: 1, bodyFrame: 1, lastInputSeq: 0,
      posX: 0, posY: 0, velX: 0, velY: 0, kills: 0, deaths: 0, weaponNum: 3, control: neutralControl(),
    }] }))
    await Promise.resolve()

    for (let i = 0; i < 120; i++) client.tick() // 2초 — 무기쿨다운 여러 번 찼을 시간
    const activeBulletCount = gs.bullet.filter((b) => b.active).length
    expect(activeBulletCount).toBe(0) // 로컬 fire=true 만으로는 절대 안 생김(설계 결정 2)

    const bm: BulletMsg = { seq: 1, owner: 3, weaponNum: 1, style: 0, hitMultiply: 1, seed: 1,
      posX: 10, posY: 20, velX: 5, velY: 0 }
    hostT.send(MSG.BULLET, encodeBullet(bm))
    await Promise.resolve()
    expect(gs.bullet.filter((b) => b.active).length).toBe(1) // BULLET 이벤트로만 정확히 1개 생성
  })

  it('MSG.KILL populates killFeed; snapshot kills/deaths overwrite player fields', async () => {
    const hub = new LoopbackHub()
    const t = hub.createTransport('bob')
    t.connect(); t.joinRoom('r')
    const gs = setupTestGame({ emptyMap: true })
    const client = new ClientSession(t, gs, 'bob', () => neutralControl())
    const hostT = hub.createTransport('host')
    hostT.connect(); hostT.joinRoom('r')
    hostT.send(MSG.SNAPSHOT, encodeSnapshot({ tick: 1, teamScore1: 0, teamScore2: 0, sprites: [{
      num: 6, team: 0, direction: 1, deadMeat: false, health: 150, jetsCount: 0,
      legsAnimId: 1, legsFrame: 1, bodyAnimId: 1, bodyFrame: 1, lastInputSeq: 0,
      posX: 0, posY: 0, velX: 0, velY: 0, kills: 4, deaths: 1, weaponNum: 3, control: neutralControl(),
    }] }))
    await Promise.resolve()
    expect(gs.sprite[6].player!.kills).toBe(4)
    expect(gs.sprite[6].player!.deaths).toBe(1)

    const km: KillMsg = { killer: 6, victim: 9, weaponNum: 2 }
    hostT.send(MSG.KILL, km)
    await Promise.resolve()
    expect(client.killFeed).toHaveLength(1)
    expect(client.killFeed[0]).toEqual(km)
  })

  it('respawn (deadMeat true→false) snaps position instantly, bypassing smoothing', async () => {
    const hub = new LoopbackHub()
    const t = hub.createTransport('carol')
    t.connect(); t.joinRoom('r')
    const gs = setupTestGame({ emptyMap: true })
    const client = new ClientSession(t, gs, 'carol', () => neutralControl())
    void client
    const hostT = hub.createTransport('host')
    hostT.connect(); hostT.joinRoom('r')

    const snap = (deadMeat: boolean, posX: number) => encodeSnapshot({ tick: 1, teamScore1: 0, teamScore2: 0, sprites: [{
      num: 8, team: 0, direction: 1, deadMeat, health: deadMeat ? 0 : 150, jetsCount: 0,
      legsAnimId: 1, legsFrame: 1, bodyAnimId: 1, bodyFrame: 1, lastInputSeq: 0,
      posX, posY: 0, velX: 0, velY: 0, kills: 0, deaths: 0, weaponNum: 3, control: neutralControl(),
    }] })

    hostT.send(MSG.SNAPSHOT, snap(true, 500)) // 사망 상태로 첫 생성
    hostT.send(MSG.SNAPSHOT, snap(false, 9999)) // 리스폰 — 완전히 다른 좌표로 순간이동
    await Promise.resolve()
    expect(gs.spriteParts.pos[8].x).toBeCloseTo(9999, 0) // 스무딩 없이 즉시 정확히 스냅
  })

  it('own sprite adopts snapshot weapon loadout when locally empty-handed (spawn race: ASSIGN before first SNAPSHOT)', async () => {
    const hub = new LoopbackHub()
    const t = hub.createTransport('alice')
    t.connect(); t.joinRoom('r')
    const gs = setupTestGame({ emptyMap: true })
    const client = new ClientSession(t, gs, 'alice', () => neutralControl())
    void client
    const hostT = hub.createTransport('host')
    hostT.connect(); hostT.joinRoom('r')
    hostT.send(MSG.ASSIGN, { account: 'alice', num: 3 }) // ASSIGN 먼저 — myNum 확정 후 스냅샷 도착
    hostT.send(MSG.SNAPSHOT, encodeSnapshot({ tick: 1, teamScore1: 0, teamScore2: 0, sprites: [{
      num: 3, team: 0, direction: 1, deadMeat: false, health: 150, jetsCount: 0,
      legsAnimId: 1, legsFrame: 1, bodyAnimId: 1, bodyFrame: 1, lastInputSeq: 0,
      posX: 0, posY: 0, velX: 0, velY: 0, kills: 0, deaths: 0, weaponNum: AK74_NUM, control: neutralControl(),
    }] }))
    await Promise.resolve()
    // 로컬 respawn은 selWeapon=0이라 Hands(NOWEAPON)를 쥐어줌 — 스냅샷 로드아웃을 채용해야 함
    expect(gs.sprite[3].weapon.num).toBe(AK74_NUM)
  })

  it("own sprite's locally held weapon is NOT overridden by snapshot (no fight with local switch prediction)", async () => {
    const hub = new LoopbackHub()
    const t = hub.createTransport('alice')
    t.connect(); t.joinRoom('r')
    const gs = setupTestGame({ emptyMap: true })
    const client = new ClientSession(t, gs, 'alice', () => neutralControl())
    void client
    const hostT = hub.createTransport('host')
    hostT.connect(); hostT.joinRoom('r')
    hostT.send(MSG.ASSIGN, { account: 'alice', num: 3 })
    const snap = (weaponNum: number) => encodeSnapshot({ tick: 1, teamScore1: 0, teamScore2: 0, sprites: [{
      num: 3, team: 0, direction: 1, deadMeat: false, health: 150, jetsCount: 0,
      legsAnimId: 1, legsFrame: 1, bodyAnimId: 1, bodyFrame: 1, lastInputSeq: 0,
      posX: 0, posY: 0, velX: 0, velY: 0, kills: 0, deaths: 0, weaponNum, control: neutralControl(),
    }] })
    hostT.send(MSG.SNAPSHOT, snap(AK74_NUM)) // 스프라이트 생성 + 초기 로드아웃
    await Promise.resolve()
    gs.sprite[3].applyWeaponByNum(MP5_NUM, 1) // 로컬 무기전환(예측) 가정
    hostT.send(MSG.SNAPSHOT, snap(AK74_NUM)) // 호스트는 아직 AK74라 보고
    await Promise.resolve()
    expect(gs.sprite[3].weapon.num).toBe(MP5_NUM) // 빈손이 아니면 자기 무기는 로컬 우선
    expect(NOWEAPON_NUM).toBe(255) // 가드 상수 회귀 감지(빈손 판정 기준)
  })

  it('CTF: kills any local phantom flag of the same style not at the host slot, then adopts host slot', async () => {
    const hub = new LoopbackHub()
    const t = hub.createTransport('dave')
    t.connect(); t.joinRoom('r')
    const gs = setupTestGame({ emptyMap: false })
    gs.svGamemode = GAMESTYLE_CTF
    const client = new ClientSession(t, gs, 'dave', () => neutralControl())
    void client
    // 로컬 공유심의 CTF 자동생성은 mainTickCounter % (SECOND*2)===0(=120틱째) — 팬텀 발생 유도
    for (let i = 0; i < 125; i++) client.tick()

    const phantomCount = gs.thing.filter((th) => th.active && th.style === OBJECT_ALPHA_FLAG).length
    expect(phantomCount).toBeGreaterThanOrEqual(1) // 팬텀이 실재함을 먼저 확인(전제 검증)

    const hostT = hub.createTransport('host')
    hostT.connect(); hostT.joinRoom('r')
    const authoritativeSlot = 55 // 호스트가 골랐다고 가정한, 팬텀과 다른 슬롯
    const f: FlagState = { style: OBJECT_ALPHA_FLAG, thingNum: authoritativeSlot, holdingSprite: 0, posX: 111, posY: 222 }
    hostT.send(MSG.SNAPSHOT, encodeSnapshot({ tick: 1, teamScore1: 0, teamScore2: 0, sprites: [], flags: [f] }))
    await Promise.resolve()

    const activeAlpha = gs.thing.filter((th, i) => th.active && th.style === OBJECT_ALPHA_FLAG && i !== 0)
    expect(activeAlpha).toHaveLength(1) // 팬텀 제거 + 권위 슬롯 1개만 남음
    expect(gs.thing[authoritativeSlot].active).toBe(true)
    expect(gs.thing[authoritativeSlot].skeleton.pos[1].x).toBeCloseTo(111, 2)
  })
})
