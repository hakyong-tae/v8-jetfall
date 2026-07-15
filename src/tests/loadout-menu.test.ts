// src/tests/loadout-menu.test.ts — M5: 무기선택(림보) 메뉴 배선 검증.
// LoadoutMenu(src/web/loadout-menu.ts)는 DOM 오버레이 클래스라 이 파일(Node 환경, jsdom 없음)에서
// 직접 인스턴스화하지 않는다 — 대신 그 pick()이 실제로 하는 필드 조작(gs.weaponSel/selWeapon/
// player.secWep 갱신 + 살아있으면 applyWeaponByNum 즉시장착)을 그대로 재현해, 코어(src/core/)의
// 기존 공개 API(respawn/applyWeaponByNum)와 올바르게 맞물리는지만 검증한다. 코어 내부 무수정.
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import { setupTestGame } from './helpers'
import { vector2 } from '../core/vector'
import { createSprite, createTPlayer, randomizeStart } from '../core/sprites'
import {
  createWeapons, loadWeaponsConfig, guns,
  EAGLE, STEYRAUG, LAW, PRIMARY_WEAPONS, MAIN_WEAPONS, NOWEAPON_NUM,
} from '../core/weapons'
import { TEAM_NONE } from '../core/constants'
import { LoopbackHub } from '../net/loopback'
import { HostSession } from '../net/host-session'
import { ClientSession } from '../net/client-session'
import { MSG } from '../net/protocol'

const assetsDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../public/assets')
const weaponsJson = JSON.parse(readFileSync(path.join(assetsDir, 'weapons.json'), 'utf-8'))
createWeapons(false)
loadWeaponsConfig(weaponsJson.normal)

function spawnBareHanded(gs: ReturnType<typeof setupTestGame>) {
  const player = createTPlayer()
  player.name = 'Test'
  player.team = TEAM_NONE
  const r = randomizeStart(gs, TEAM_NONE)
  const num = createSprite(gs, r.start, vector2(0, 0), 1, 255, player, true)
  gs.sprite[num].respawn() // 맨손 스폰 (selWeapon=0/secWep=0 기본값, M5 하드코딩 제거 후 실제 배선)
  return num
}

// LoadoutMenu.pick()이 하는 일을 그대로 재현 — 그룹 단일선택 + selWeapon/secWep 갱신 +
// 살아있으면 즉시 장착(코어 applyWeaponByNum 재사용, 죽어있으면 미호출).
function simulatePick(gs: ReturnType<typeof setupTestGame>, num: number, weaponIndex: number, isPrimary: boolean): void {
  const spr = gs.sprite[num]
  const groupStart = isPrimary ? 1 : PRIMARY_WEAPONS + 1
  const groupEnd = isPrimary ? PRIMARY_WEAPONS : MAIN_WEAPONS
  for (let w = groupStart; w <= groupEnd; w++) gs.weaponSel[num][w] = w === weaponIndex ? 1 : 0
  if (isPrimary) {
    spr.selWeapon = guns[weaponIndex].num
    if (!spr.deadMeat) spr.applyWeaponByNum(guns[weaponIndex].num, 1)
  } else {
    spr.player!.secWep = weaponIndex - PRIMARY_WEAPONS - 1
    if (!spr.deadMeat) spr.applyWeaponByNum(guns[weaponIndex].num, 2)
  }
}

describe('loadout menu <-> core respawn/applyWeaponByNum wiring (M5)', () => {
  it('spawns bare-handed by default (no AK74 hardcode) — selWeapon=0, weapon=NOWEAPON', () => {
    const gs = setupTestGame({ emptyMap: true })
    const num = spawnBareHanded(gs)
    expect(gs.sprite[num].selWeapon).toBe(0)
    expect(gs.sprite[num].weapon.num).toBe(NOWEAPON_NUM)
  })

  it('picking a primary weapon while dead does NOT instant-equip, but grants it on the next respawn()', () => {
    const gs = setupTestGame({ emptyMap: true })
    const num = spawnBareHanded(gs)
    const spr = gs.sprite[num]
    spr.deadMeat = true // 사망 상태 흉내 (재오픈된 로드아웃 메뉴가 선택하는 상황)

    simulatePick(gs, num, STEYRAUG, true)
    expect(spr.weapon.num).not.toBe(guns[STEYRAUG].num) // 죽어있으므로 즉시장착 안 됨
    expect(spr.selWeapon).toBe(guns[STEYRAUG].num) // 선택은 기록됨

    spr.respawn() // 코어 respawn()이 selWeapon을 읽어 그대로 지급 (Sprites.pas:3593-3597)
    expect(spr.weapon.num).toBe(guns[STEYRAUG].num)
  })

  it('picking a secondary weapon while dead grants it via player.secWep on the next respawn()', () => {
    const gs = setupTestGame({ emptyMap: true })
    const num = spawnBareHanded(gs)
    const spr = gs.sprite[num]
    spr.deadMeat = true

    simulatePick(gs, num, LAW, false)
    expect(spr.player!.secWep).toBe(LAW - PRIMARY_WEAPONS - 1)

    spr.respawn()
    expect(spr.secondaryWeapon.num).toBe(guns[LAW].num)
  })

  it('picking a primary weapon while alive instant-equips via applyWeaponByNum (no respawn needed)', () => {
    const gs = setupTestGame({ emptyMap: true })
    const num = spawnBareHanded(gs)
    const spr = gs.sprite[num]
    expect(spr.deadMeat).toBe(false)

    simulatePick(gs, num, EAGLE, true)
    expect(spr.weapon.num).toBe(guns[EAGLE].num) // 즉시 반영 — respawn() 호출 없이
  })

  it('switching primary picks clears the previous primary weaponSel slot (single-select group)', () => {
    const gs = setupTestGame({ emptyMap: true })
    const num = spawnBareHanded(gs)
    simulatePick(gs, num, EAGLE, true)
    expect(gs.weaponSel[num][EAGLE]).toBe(1)
    simulatePick(gs, num, STEYRAUG, true)
    expect(gs.weaponSel[num][EAGLE]).toBe(0)
    expect(gs.weaponSel[num][STEYRAUG]).toBe(1)
  })
})

describe('LOADOUT network round-trip (M5) — LOOPBACK client -> host applies to correct slot', () => {
  it('host applies selWeapon/secWep from a LOADOUT message to the sender-owned sprite', async () => {
    const hub = new LoopbackHub()
    const hostT = hub.createTransport('host')
    const aliceT = hub.createTransport('alice')
    await hostT.connect(); await aliceT.connect()
    await hostT.joinRoom('r'); await aliceT.joinRoom('r')

    const gs = setupTestGame({ emptyMap: true })
    const host = new HostSession(hostT, gs)
    host.spawnPlayers([{ account: 'alice', team: TEAM_NONE }])
    const num = host.spriteNumOf('alice')!
    expect(gs.sprite[num].selWeapon).toBe(0) // M5: 맨손 스폰 확인 (host-session.ts AK74 하드코딩 제거)

    aliceT.send(MSG.LOADOUT, { selWeapon: guns[STEYRAUG].num, secWep: LAW - PRIMARY_WEAPONS - 1 })
    await Promise.resolve() // loopback queueMicrotask 배송 flush

    expect(gs.sprite[num].selWeapon).toBe(guns[STEYRAUG].num)
    expect(gs.sprite[num].player!.secWep).toBe(LAW - PRIMARY_WEAPONS - 1)
    // 살아있는 상태에서 수신했으므로 즉시 장착까지 반영되어야 한다 (host-session.ts applyLoadout).
    expect(gs.sprite[num].weapon.num).toBe(guns[STEYRAUG].num)
    expect(gs.sprite[num].secondaryWeapon.num).toBe(guns[LAW].num)
  })

  it('a dead sprite receiving LOADOUT records selWeapon/secWep but does not instant-equip', async () => {
    const hub = new LoopbackHub()
    const hostT = hub.createTransport('host')
    const bobT = hub.createTransport('bob')
    await hostT.connect(); await bobT.connect()
    await hostT.joinRoom('r2'); await bobT.joinRoom('r2')

    const gs = setupTestGame({ emptyMap: true })
    const host = new HostSession(hostT, gs)
    host.spawnPlayers([{ account: 'bob', team: TEAM_NONE }])
    const num = host.spriteNumOf('bob')!
    gs.sprite[num].deadMeat = true
    const weaponBefore = gs.sprite[num].weapon.num

    bobT.send(MSG.LOADOUT, { selWeapon: guns[EAGLE].num, secWep: 0 })
    await Promise.resolve()

    expect(gs.sprite[num].selWeapon).toBe(guns[EAGLE].num) // 기록은 됨
    expect(gs.sprite[num].weapon.num).toBe(weaponBefore) // 죽어있으니 즉시장착은 안 됨

    gs.sprite[num].respawn()
    expect(gs.sprite[num].weapon.num).toBe(guns[EAGLE].num) // 다음 리스폰에 코어가 자동 지급
  })

  it('ClientSession.sendLoadout() transmits a MSG.LOADOUT the host can decode and apply', async () => {
    const hub = new LoopbackHub()
    const hostT = hub.createTransport('host')
    const aliceT = hub.createTransport('alice')
    await hostT.connect(); await aliceT.connect()
    await hostT.joinRoom('r3'); await aliceT.joinRoom('r3')

    const hostGs = setupTestGame({ emptyMap: true })
    const host = new HostSession(hostT, hostGs)
    host.spawnPlayers([{ account: 'alice', team: TEAM_NONE }])
    const num = host.spriteNumOf('alice')!

    const aliceGs = setupTestGame({ emptyMap: true })
    const client = new ClientSession(aliceT, aliceGs, 'alice', () => ({
      left: false, right: false, up: false, down: false, fire: false, jetpack: false,
      throwNade: false, changeWeapon: false, throwWeapon: false, reload: false, prone: false,
      flagThrow: false, mouseAimX: 0, mouseAimY: 0,
    }))
    void client

    client.sendLoadout(guns[STEYRAUG].num, 0)
    await Promise.resolve()

    expect(hostGs.sprite[num].selWeapon).toBe(guns[STEYRAUG].num)
    expect(hostGs.sprite[num].weapon.num).toBe(guns[STEYRAUG].num)
  })
})
