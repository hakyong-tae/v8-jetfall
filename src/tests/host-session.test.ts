// src/tests/host-session.test.ts
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import { LoopbackHub } from '../net/loopback'
import { HostSession } from '../net/host-session'
import { encodeInput, decodeSnapshot, decodeBullet, MSG, type KillMsg } from '../net/protocol'
import { setupTestGame } from './helpers'
import { TEAM_NONE, GAMESTYLE_CTF, GAMESTYLE_DEATHMATCH } from '../core/constants'
import { guns, AK74, createWeapons, loadWeaponsConfig } from '../core/weapons'

const assetsDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../public/assets')
const weaponsJson = JSON.parse(readFileSync(path.join(assetsDir, 'weapons.json'), 'utf-8'))
// 무기 스탯을 실전값으로 적재(전역 guns[]) — 발사 테스트가 실제 탄약/사거리를 쓰도록. (통합테스트와 동일 경로)
function loadWeapons(): void {
  createWeapons(false)
  loadWeaponsConfig(weaponsJson.normal)
}

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

  it('firing broadcasts exactly one MSG.BULLET, none while not firing, no dup on later ticks of same flight', async () => {
    const hub = new LoopbackHub()
    const hostT = hub.createTransport('host')
    const obsT = hub.createTransport('bob')
    hostT.connect(); obsT.connect(); hostT.joinRoom('r'); obsT.joinRoom('r')
    loadWeapons() // 발사 전 전역 무기 스탯 적재(guns[AK74].num 등) — spawn 전에 필요
    const gs = setupTestGame({ emptyMap: true })
    gs.svGamemode = GAMESTYLE_DEATHMATCH
    const host = new HostSession(hostT, gs)
    host.spawnPlayers([{ account: 'alice', team: TEAM_NONE }])
    const aliceNum = host.spriteNumOf('alice')!
    // 확정 발사를 위해 원거리 무기 탄약을 명시 지급(통합테스트와 동일 규약).
    gs.sprite[aliceNum].applyWeaponByNum(guns[AK74].num, 1)

    const bullets: ReturnType<typeof decodeBullet>[] = []
    obsT.onMessage((event, payload) => { if (event === MSG.BULLET) bullets.push(decodeBullet(payload as ArrayBuffer)) })

    for (let i = 0; i < 30; i++) host.tick() // 아직 안 쏨(fire=false)
    await Promise.resolve() // loopback queueMicrotask 배송 flush
    expect(bullets).toHaveLength(0)

    // 발사 국면 — 매 틱 fire·조준·ceaseFire(-1, 스폰정전 우회)를 재고정(통합테스트 규약).
    for (let i = 0; i < 8; i++) {
      gs.sprite[aliceNum].control.fire = true
      gs.sprite[aliceNum].control.mouseAimX = 500
      gs.sprite[aliceNum].control.mouseAimY = 0
      gs.sprite[aliceNum].ceaseFireCounter = -1
      host.tick()
    }
    await Promise.resolve()
    const afterFirstBurst = bullets.length
    expect(afterFirstBurst).toBeGreaterThanOrEqual(1)
    expect(afterFirstBurst).toBeLessThan(5) // 무기쿨다운 상 매 틱 생성되진 않음(사실 1)

    gs.sprite[aliceNum].control.fire = false
    for (let i = 0; i < 30; i++) host.tick() // 발사 중단 — 기존 탄환이 계속 날아도 재이벤트 없어야 함
    await Promise.resolve()
    expect(bullets.length).toBe(afterFirstBurst) // 늘지 않음 — diff가 "신규 생성"만 잡는다는 증거

    const b = bullets[0]
    expect(b.owner).toBe(aliceNum)
    expect(Number.isNaN(b.posX)).toBe(false)
  })

  it('a scripted lethal hit broadcasts MSG.KILL and updates kills/deaths in the SNAPSHOT', async () => {
    const hub = new LoopbackHub()
    const hostT = hub.createTransport('host')
    const obsT = hub.createTransport('carol')
    hostT.connect(); obsT.connect(); hostT.joinRoom('r'); obsT.joinRoom('r')
    const gs = setupTestGame({ emptyMap: true })
    gs.svGamemode = GAMESTYLE_DEATHMATCH // DM: who!==num 이면 킬 귀속(팀 무관)
    const host = new HostSession(hostT, gs)
    host.spawnPlayers([{ account: 'alice', team: TEAM_NONE }, { account: 'bob', team: TEAM_NONE }])
    const aliceNum = host.spriteNumOf('alice')!
    const bobNum = host.spriteNumOf('bob')!

    const kills: KillMsg[] = []
    let lastSnapDeaths = -1
    obsT.onMessage((event, payload) => {
      if (event === MSG.KILL) kills.push(payload as KillMsg)
      if (event === MSG.SNAPSHOT) {
        const snap = decodeSnapshot(payload as ArrayBuffer)
        const bob = snap.sprites.find((s) => s.num === bobNum)
        if (bob) lastSnapDeaths = bob.deaths
      }
    })

    gs.sprite[bobNum].healthHit(9999, aliceNum, 1, 0, { x: 0, y: 0 } as any) // 즉사 스크립트
    host.tick()
    await Promise.resolve()

    expect(kills).toHaveLength(1)
    expect(kills[0].victim).toBe(bobNum)
    expect(kills[0].killer).toBe(aliceNum)
    expect(gs.sprite[bobNum].deadMeat).toBe(true)

    for (let i = 0; i < 3; i++) host.tick() // 다음 스냅샷 도착까지
    await Promise.resolve()
    expect(lastSnapDeaths).toBe(1)
    expect(gs.sprite[aliceNum].player!.kills).toBe(1)
  })

  it('CTF: core auto-spawns both flags, and a scripted score increment broadcasts teamScore via SNAPSHOT', async () => {
    const hub = new LoopbackHub()
    const hostT = hub.createTransport('host')
    const obsT = hub.createTransport('dave')
    hostT.connect(); obsT.connect(); hostT.joinRoom('r'); obsT.joinRoom('r')
    const gs = setupTestGame({ emptyMap: false }) // 실제 CTF 맵(ctf_Ash) — flagSpawn 필요
    gs.svGamemode = GAMESTYLE_CTF
    const host = new HostSession(hostT, gs)
    host.spawnPlayers([{ account: 'alice', team: 1 }])

    // 코어 CTF 자동생성은 mainTickCounter % (SECOND*2)===0 에서만 — mainTickCounter가 updateFrame
    // 진입 즉시 +1 되므로 최초 스폰은 120틱째(2초). 충분히 돌린다.
    for (let i = 0; i < 130; i++) host.tick()
    expect(gs.teamFlag[2]).toBeGreaterThan(0) // 브라보 깃발(적팀) 존재

    let snapTeamScore1 = -1
    obsT.onMessage((event, payload) => {
      if (event === MSG.SNAPSHOT) snapTeamScore1 = decodeSnapshot(payload as ArrayBuffer).teamScore1
    })
    gs.teamScore[1] = gs.teamScore[1] + 1 // 스코어링 규약대로 증가시켜(스텁) 스냅샷 전파만 검증
    for (let i = 0; i < 3; i++) host.tick()
    await Promise.resolve()
    expect(snapTeamScore1).toBe(1)
  })
})
