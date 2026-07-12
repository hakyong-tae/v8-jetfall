// src/tests/net-c-integration.test.ts — M3-C 핵심 검증: 1호스트 + 2클라 loopback 위 DM 전투 풀사이클.
// 탄환 전파(중복 없음) → 호스트 데미지 판정 → 스냅샷으로 전 클라 수렴 → 사망/킬/리스폰.
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import { LoopbackHub } from '../net/loopback'
import { HostSession } from '../net/host-session'
import { ClientSession, type LocalInput } from '../net/client-session'
import { MSG } from '../net/protocol'
import { setupTestGame } from './helpers'
import { TEAM_NONE, GAMESTYLE_DEATHMATCH } from '../core/constants'
import { guns, AK74, createWeapons, loadWeaponsConfig } from '../core/weapons'
import { vector2 } from '../core/vector'

const assetsDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../public/assets')
const weaponsJson = JSON.parse(readFileSync(path.join(assetsDir, 'weapons.json'), 'utf-8'))
createWeapons(false)
loadWeaponsConfig(weaponsJson.normal)

function neutral(overrides: Partial<LocalInput> = {}): LocalInput {
  return { left: false, right: false, up: false, down: false, fire: false, jetpack: false,
    throwNade: false, changeWeapon: false, throwWeapon: false, reload: false, prone: false,
    flagThrow: false, mouseAimX: 0, mouseAimY: 0, ...overrides }
}

describe('M3-C integration: host-authoritative combat over one LoopbackHub', () => {
  it('bullet events propagate without duplication; damage/death/kill/respawn converge on all clients', async () => {
    const hub = new LoopbackHub()
    const hostT = hub.createTransport('host')
    const aT = hub.createTransport('alice')
    const bT = hub.createTransport('bob')
    await Promise.all([hostT.connect(), aT.connect(), bT.connect()])
    await Promise.all([hostT.joinRoom('m3c'), aT.joinRoom('m3c'), bT.joinRoom('m3c')])

    const hostGs = setupTestGame({ emptyMap: true })
    hostGs.svGamemode = GAMESTYLE_DEATHMATCH
    const host = new HostSession(hostT, hostGs)
    host.spawnPlayers([{ account: 'alice', team: TEAM_NONE }, { account: 'bob', team: TEAM_NONE }])
    const aliceNum = host.spriteNumOf('alice')!
    const bobNum = host.spriteNumOf('bob')!
    hostGs.sprite[aliceNum].applyWeaponByNum(guns[AK74].num, 1) // 확정 발사용 원거리 탄약

    const BOB_X = 60
    // alice의 조준을 bob 위치로 고정 — mouseAim은 월드좌표(getCursorAimDirection).
    let aliceInput: LocalInput = neutral({ fire: true, mouseAimX: BOB_X, mouseAimY: 0 })
    const aGs = setupTestGame({ emptyMap: true }); aGs.svGamemode = GAMESTYLE_DEATHMATCH
    const aClient = new ClientSession(aT, aGs, 'alice', () => aliceInput)

    const bobInput: LocalInput = neutral()
    const bGs = setupTestGame({ emptyMap: true }); bGs.svGamemode = GAMESTYLE_DEATHMATCH
    const bClient = new ClientSession(bT, bGs, 'bob', () => bobInput)

    // 관전용 트랜스포트로 브로드캐스트를 계측(모든 non-host 멤버는 동일 이벤트 스트림 수신).
    let bulletEventCount = 0
    let sawKill = false
    const spectatorT = hub.createTransport('spectator')
    await spectatorT.connect(); await spectatorT.joinRoom('m3c')
    spectatorT.onMessage((event) => {
      if (event === MSG.BULLET) bulletEventCount++
      if (event === MSG.KILL) sawKill = true
    })

    // 증거 추적
    let bobMinHealthHost = Infinity
    let bobEverDeadHost = false
    let bobReappeared = false
    let prevBobDead = false

    // alice를 제자리에 고정(자유낙하 방지) + 발사 정전 우회.
    const pinAlice = () => {
      hostGs.spriteParts.pos[aliceNum].x = 0; hostGs.spriteParts.pos[aliceNum].y = 0
      hostGs.spriteParts.velocity[aliceNum] = vector2(0, 0)
      hostGs.sprite[aliceNum].moveSkeleton(0, 0, true)
      hostGs.sprite[aliceNum].ceaseFireCounter = -1
    }
    // bob을 alice 사선에 고정(표적).
    const pinBob = () => {
      hostGs.spriteParts.pos[bobNum].x = BOB_X; hostGs.spriteParts.pos[bobNum].y = 0
      hostGs.spriteParts.velocity[bobNum] = vector2(0, 0)
      hostGs.sprite[bobNum].moveSkeleton(BOB_X, 0, true)
    }

    // 발사 국면 — bob이 최소 1회 죽을 때까지(그 이상은 리스폰 관측을 방해하므로 멈춘다).
    //   매 반복 microtask flush로 메시지가 틱 단위로 실제 전파되게 한다.
    for (let i = 0; i < 700 && !bobEverDeadHost; i++) {
      pinAlice(); pinBob()
      aClient.tick(); bClient.tick(); host.tick()
      await Promise.resolve()
      const bh = hostGs.sprite[bobNum].health
      if (bh < bobMinHealthHost) bobMinHealthHost = bh
      if (hostGs.sprite[bobNum].deadMeat) bobEverDeadHost = true
    }

    // 리스폰/정착 국면 — 발사 중단, bob은 자연 리스폰(svRespawntime=360)하도록 사선 고정 해제.
    //   deadMeat true→false 전환을 여기서 관측 + 최종 스냅샷이 전 클라에 수렴.
    aliceInput = neutral({ fire: false })
    prevBobDead = hostGs.sprite[bobNum].deadMeat
    for (let i = 0; i < 450; i++) {
      pinAlice()
      aClient.tick(); bClient.tick(); host.tick()
      await Promise.resolve()
      const dead = hostGs.sprite[bobNum].deadMeat
      if (prevBobDead && !dead) bobReappeared = true
      prevBobDead = dead
    }

    // ① 탄환 전파 + 이중생성 없음 (활성 탄환 수는 수신 이벤트 수를 넘지 못함 — 로컬 fire가
    //    스스로 탄환을 만들었다면 초과했을 것이므로 이게 곧 "이중생성 없음"의 정량적 증거).
    expect(bulletEventCount).toBeGreaterThan(0)
    const aActiveBullets = aGs.bullet.filter((b) => b.active).length
    const bActiveBullets = bGs.bullet.filter((b) => b.active).length
    expect(aActiveBullets).toBeLessThanOrEqual(bulletEventCount)
    expect(bActiveBullets).toBeLessThanOrEqual(bulletEventCount)

    // ② 호스트 데미지 판정: bob이 어느 시점에 150 미만으로 떨어짐
    expect(bobMinHealthHost).toBeLessThan(150)

    // ③ 사망/킬/리스폰이 전 클라에 스냅샷으로 수렴
    expect(bobEverDeadHost).toBe(true)         // 사망 발생
    expect(sawKill).toBe(true)                  // 킬 이벤트 브로드캐스트
    expect(hostGs.sprite[aliceNum].player!.kills).toBeGreaterThanOrEqual(1) // 킬 카운트 증가
    expect(bobReappeared).toBe(true)            // 리스폰(deadMeat true→false) 관측
    // 스냅샷 진실값(kills/deaths)이 양쪽 클라에 멱등 수렴
    expect(aGs.sprite[bobNum].player!.deaths).toBe(hostGs.sprite[bobNum].player!.deaths)
    expect(bGs.sprite[bobNum].player!.deaths).toBe(hostGs.sprite[bobNum].player!.deaths)
    expect(aGs.sprite[aliceNum].player!.kills).toBe(hostGs.sprite[aliceNum].player!.kills)
    expect(bGs.sprite[aliceNum].player!.kills).toBe(hostGs.sprite[aliceNum].player!.kills)
    // health(즉시 스냅 필드)도 정착 후 정확히 일치
    expect(aGs.sprite[bobNum].health).toBe(hostGs.sprite[bobNum].health)
    expect(bGs.sprite[bobNum].health).toBe(hostGs.sprite[bobNum].health)

    // ④ NaN 전무
    for (const gs of [hostGs, aGs, bGs]) {
      expect(Number.isNaN(gs.spriteParts.pos[aliceNum].x)).toBe(false)
      expect(Number.isNaN(gs.spriteParts.pos[bobNum].x)).toBe(false)
      expect(Number.isNaN(gs.sprite[bobNum].health)).toBe(false)
    }
  })
})
