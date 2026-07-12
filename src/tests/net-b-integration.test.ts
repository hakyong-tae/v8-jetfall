// src/tests/net-b-integration.test.ts
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import { LoopbackHub } from '../net/loopback'
import { HostSession } from '../net/host-session'
import { ClientSession, type LocalInput } from '../net/client-session'
import { encodeSnapshot } from '../net/protocol'
import { setupTestGame } from './helpers'
import { TEAM_NONE } from '../core/constants'
import { createWeapons, loadWeaponsConfig, AK74_NUM } from '../core/weapons'

// 무기 동기화 테스트가 실전 guns[].num(AK74_NUM=3 등)을 요구하므로 실 무기 스탯 적재.
// (client-session.test.ts와 동일 패턴 — guns[]는 모듈 전역이라 파일당 1회면 충분.)
const assetsDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../public/assets')
const weaponsJson = JSON.parse(readFileSync(path.join(assetsDir, 'weapons.json'), 'utf-8'))
createWeapons(false)
loadWeaponsConfig(weaponsJson.normal)

function neutral(overrides: Partial<LocalInput> = {}): LocalInput {
  return { left: false, right: false, up: false, down: false, fire: false, jetpack: false,
    throwNade: false, changeWeapon: false, throwWeapon: false, reload: false, prone: false,
    flagThrow: false, mouseAimX: 0, mouseAimY: 0, ...overrides }
}

// loopback은 queueMicrotask로 배송한다(전송은 참조 그대로). 한 틱에서 큐잉된 메시지가 다음
// 틱 전에 도착하도록 매 반복마다 마이크로태스크 큐를 비운다 — 계획 주석의 "직전 스냅샷 소비" 의미.
const flush = () => Promise.resolve()

describe('M3-B integration: host-authoritative movement over one LoopbackHub', () => {
  it("client A's rightward movement converges into client B's local view, no NaN, no combat", async () => {
    const hub = new LoopbackHub()
    const hostT = hub.createTransport('host')
    const aT = hub.createTransport('alice')
    const bT = hub.createTransport('bob')
    await Promise.all([hostT.connect(), aT.connect(), bT.connect()])
    await Promise.all([hostT.joinRoom('m3b'), aT.joinRoom('m3b'), bT.joinRoom('m3b')])

    const hostGs = setupTestGame({ emptyMap: true })
    const host = new HostSession(hostT, hostGs)
    host.spawnPlayers([
      { account: 'alice', team: TEAM_NONE },
      { account: 'bob', team: TEAM_NONE },
    ])
    const aliceNum = host.spriteNumOf('alice')!
    const bobNum = host.spriteNumOf('bob')!
    const startX = hostGs.spriteParts.pos[aliceNum].x

    let aliceInput: LocalInput = neutral({ right: true, mouseAimX: startX + 500 })
    void aliceInput
    const aGs = setupTestGame({ emptyMap: true })
    const aClient = new ClientSession(aT, aGs, 'alice', () => aliceInput)

    const bobInput: LocalInput = neutral({ mouseAimX: 0 })
    const bGs = setupTestGame({ emptyMap: true })
    const bClient = new ClientSession(bT, bGs, 'bob', () => bobInput)

    // ASSIGN이 첫 틱 전에 도착하도록 flush (스폰 시 브로드캐스트된 배정 통지 소비)
    await flush()

    // 180틱(3초 @60Hz) — 매 틱 클라 먼저(직전 스냅샷 소비) → 호스트
    for (let i = 0; i < 180; i++) {
      aClient.tick()
      bClient.tick()
      host.tick()
      await flush() // 이 틱에서 큐잉된 INPUT/SNAPSHOT을 다음 틱 전에 배송
    }

    const hostAliceX = hostGs.spriteParts.pos[aliceNum].x
    expect(hostAliceX).toBeGreaterThan(startX) // 호스트에서 실제 이동

    // bob(원격 관찰자)의 로컬 뷰에도 alice의 스프라이트가 존재하고, 호스트 위치에 수렴.
    expect(bGs.sprite[aliceNum].active).toBe(true)
    const bobsViewOfAliceX = bGs.spriteParts.pos[aliceNum].x
    expect(Number.isNaN(bobsViewOfAliceX)).toBe(false)
    expect(bobsViewOfAliceX).toBeGreaterThan(startX) // bob의 화면에서도 alice가 오른쪽으로 감
    expect(Math.abs(bobsViewOfAliceX - hostAliceX)).toBeLessThan(40) // 오차 임계 내 수렴

    // alice 자신의 클라에서도 자기 스프라이트가 호스트와 정합적으로 수렴 (로컬예측+보정).
    const aliceOwnX = aGs.spriteParts.pos[aliceNum].x
    expect(Math.abs(aliceOwnX - hostAliceX)).toBeLessThan(40)

    // 부수 확인: bob 쪽에서 자기 자신(bob)도 정상 렌더 대상(활성)이고 NaN 없음.
    expect(bGs.sprite[bobNum].active).toBe(true)
    expect(Number.isNaN(bGs.spriteParts.pos[bobNum].x)).toBe(false)
  })

  it("remote sprite's weapon loadout syncs from snapshot (cosmetic gap: gostek renders weapon.num)", async () => {
    const hub = new LoopbackHub()
    const hostT = hub.createTransport('host')
    const aT = hub.createTransport('alice')
    const bT = hub.createTransport('bob')
    await Promise.all([hostT.connect(), aT.connect(), bT.connect()])
    await Promise.all([hostT.joinRoom('m3w'), aT.joinRoom('m3w'), bT.joinRoom('m3w')])

    const hostGs = setupTestGame({ emptyMap: true })
    const host = new HostSession(hostT, hostGs)
    host.spawnPlayers([
      { account: 'alice', team: TEAM_NONE },
      { account: 'bob', team: TEAM_NONE },
    ])
    const aliceNum = host.spriteNumOf('alice')!
    expect(hostGs.sprite[aliceNum].weapon.num).toBe(AK74_NUM) // 전제: 호스트는 AK74 지급

    const aGs = setupTestGame({ emptyMap: true })
    const aClient = new ClientSession(aT, aGs, 'alice', () => neutral())
    void aClient
    const bGs = setupTestGame({ emptyMap: true })
    const bClient = new ClientSession(bT, bGs, 'bob', () => neutral())
    await flush()

    // 스냅샷은 2틱마다 — 몇 틱이면 bob이 alice 스프라이트를 지연생성하고 무기까지 받는다.
    for (let i = 0; i < 10; i++) {
      bClient.tick()
      host.tick()
      await flush()
    }

    expect(bGs.sprite[aliceNum].active).toBe(true) // 지연생성은 기존 동작(전제 검증)
    // 핵심: 스냅샷의 weaponNum으로 원격 병사의 로드아웃이 동기화되어 빈총(0)이 아니어야 한다.
    expect(bGs.sprite[aliceNum].weapon.num).toBe(AK74_NUM)
  })

  it('measured snapshot bandwidth for 8 sprites at 30Hz stays in a sane order of magnitude', () => {
    const control = { left: false, right: true, up: false, down: false, fire: false, jetpack: false,
      throwNade: false, changeWeapon: false, throwWeapon: false, reload: false, prone: false,
      flagThrow: false, mouseAimX: 500, mouseAimY: 0 }
    const bytes = encodeSnapshot({
      tick: 1, teamScore1: 0, teamScore2: 0,
      sprites: Array.from({ length: 8 }, (_, i) => ({
        num: i + 1, team: 0, direction: 1, deadMeat: false, health: 150, jetsCount: 30,
        legsAnimId: 2, legsFrame: 5, bodyAnimId: 1, bodyFrame: 1, lastInputSeq: 100,
        posX: 500.5, posY: 300.25, velX: 3, velY: 0, kills: 0, deaths: 0, weaponNum: 3, control,
      })),
    }).byteLength
    expect(bytes).toBeLessThanOrEqual(420) // weaponNum 포함 38B/스프라이트 → 헤더8 + 8×38 = 312B
    const bytesPerSecAt30Hz = bytes * 30
    expect(bytesPerSecAt30Hz).toBeLessThan(15_000) // ≈9.1KB/s 실측, 15KB/s 미만이면 회귀 없음
  })
})
