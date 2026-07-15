// src/tests/m7-respawn-loadout.test.ts — M7: 매치별 리스폰 대기시간 + 3초 무적 +
// 무기창 개방창(open window) 제한 + 1/2 직접 무기전환.
//
// 코어(src/core/)는 무수정 — 값 세팅(gs.svRespawntime / gs.ceaseFireTime)만으로 기존 코어 로직이
// 반응함을 검증한다. LoadoutMenu는 DOM 오버레이(+hud 경유 pixi)라 Node 환경에서 직접 인스턴스화
// 하지 않는다(loadout-menu.test.ts와 동일 규약) — 대신 개방창 판정/잠금/pick 가드 로직을 그대로
// 재현해 코어 필드(deadMeat/ceaseFireCounter/selWeapon/secWep)와의 맞물림을 검증한다.
// InputState는 pixi 의존이 없어(코어 타입만 참조) 직접 인스턴스화해 엣지 트리거를 검증한다.
import { describe, it, expect, beforeEach } from 'vitest'
import { setupTestGame } from './helpers'
import type { GameState } from '../core/state'
import { vector2 } from '../core/vector'
import {
  NORMAL_DEATH, createSprite, createTPlayer, randomizeStart,
} from '../core/sprites'
import { TEAM_NONE, GAMESTYLE_DEATHMATCH } from '../core/constants'
import {
  createWeapons, loadWeaponsConfig, guns,
  STEYRAUG, LAW, COLT, NOWEAPON, PRIMARY_WEAPONS, MAIN_WEAPONS,
} from '../core/weapons'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import { InputState, shouldSwap, slotTargetNum } from '../web/input'

const assetsDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../public/assets')
const weaponsJson = JSON.parse(readFileSync(path.join(assetsDir, 'weapons.json'), 'utf-8'))
createWeapons(false)
loadWeaponsConfig(weaponsJson.normal)

function spawnBareHanded(gs: GameState): number {
  const player = createTPlayer()
  player.name = 'Test'
  player.team = TEAM_NONE
  const r = randomizeStart(gs, TEAM_NONE)
  const num = createSprite(gs, r.start, vector2(0, 0), 1, 255, player, true)
  gs.sprite[num].respawn()
  return num
}

// ── Task1: 매치별 리스폰 대기시간 ────────────────────────────────────────────
describe('M7 Task1 — per-match respawn time (gs.svRespawntime)', () => {
  it('setting gs.svRespawntime → after death, respawnCounter equals that value (DM)', () => {
    createWeapons(false)
    const gs = setupTestGame()
    gs.svGamemode = GAMESTYLE_DEATHMATCH
    gs.svRespawntime = 120 // 2초 (=main.ts round(2*60))
    const victimNum = spawnBareHanded(gs)
    const killerNum = spawnBareHanded(gs)
    const victim = gs.sprite[victimNum]
    victim.die(NORMAL_DEATH, killerNum, 1, -1, vector2(0, 0))
    expect(victim.deadMeat).toBe(true)
    expect(victim.respawnCounter).toBe(120)
  })

  it('another value (300 = 5s) flows through the same core path', () => {
    createWeapons(false)
    const gs = setupTestGame()
    gs.svGamemode = GAMESTYLE_DEATHMATCH
    gs.svRespawntime = 300
    const victimNum = spawnBareHanded(gs)
    const victim = gs.sprite[victimNum]
    victim.die(NORMAL_DEATH, victimNum, 1, -1, vector2(0, 0)) // 자살도 respawnCounter 세팅
    expect(victim.respawnCounter).toBe(300)
  })
})

// ── Task2: 리스폰 3초 무적 ───────────────────────────────────────────────────
describe('M7 Task2 — 3s spawn invulnerability (gs.ceaseFireTime = 180)', () => {
  it('gs.ceaseFireTime = 180 → after respawn(), ceaseFireCounter === 180', () => {
    createWeapons(false)
    const gs = setupTestGame()
    gs.ceaseFireTime = 180
    const spr = gs.sprite[spawnBareHanded(gs)] // spawnBareHanded가 respawn() 호출
    expect(spr.ceaseFireCounter).toBe(180)
  })
})

// ── Task3: 무기창 개방창(open window) 제한 ───────────────────────────────────
// loadout-menu.ts의 inOpenWindow / poll 엣지 / pick 가드를 그대로 재현(코어 무수정 검증 목적).
function inOpenWindow(spr: { deadMeat: boolean; ceaseFireCounter: number }): boolean {
  return spr.deadMeat === true || spr.ceaseFireCounter > 0
}

// loadout-menu.ts pick()의 필드 조작 + 개방창 가드를 그대로 재현.
function simulatePick(gs: GameState, num: number, weaponIndex: number, isPrimary: boolean): void {
  const spr = gs.sprite[num]
  if (!inOpenWindow(spr)) return // M7: 개방창 밖에선 무기 변경 불가(잠금)
  const groupStart = isPrimary ? 1 : PRIMARY_WEAPONS + 1
  const groupEnd = isPrimary ? PRIMARY_WEAPONS : MAIN_WEAPONS
  for (let w = groupStart; w <= groupEnd; w++) gs.weaponSel[num][w] = w === weaponIndex ? 1 : 0
  if (isPrimary) {
    const nnum = guns[weaponIndex].num
    const changed = spr.selWeapon !== nnum
    spr.selWeapon = nnum
    if (!spr.deadMeat && changed) spr.applyWeaponByNum(nnum, 1)
  } else {
    const secWep = weaponIndex - PRIMARY_WEAPONS - 1
    spr.player!.secWep = secWep
    if (!spr.deadMeat) spr.applyWeaponByNum(guns[weaponIndex].num, 2)
  }
}

describe('M7 Task3 — loadout open window (deadMeat OR ceaseFireCounter>0)', () => {
  let gs: GameState
  beforeEach(() => { createWeapons(false); gs = setupTestGame({ emptyMap: true }) })

  it('(a) while deadMeat → in window, pick records selWeapon for next respawn (no instant equip)', () => {
    const num = spawnBareHanded(gs)
    const spr = gs.sprite[num]
    spr.deadMeat = true
    spr.ceaseFireCounter = -1
    expect(inOpenWindow(spr)).toBe(true)
    simulatePick(gs, num, STEYRAUG, true)
    expect(spr.selWeapon).toBe(guns[STEYRAUG].num) // 선택 기록됨
    expect(spr.weapon.num).not.toBe(guns[STEYRAUG].num) // 죽어있으므로 즉시장착 X
    spr.respawn()
    expect(spr.weapon.num).toBe(guns[STEYRAUG].num) // 리스폰이 지급
  })

  it('(b) alive & ceaseFireCounter>0 → in window, pick equips immediately', () => {
    const num = spawnBareHanded(gs)
    const spr = gs.sprite[num]
    spr.deadMeat = false
    spr.ceaseFireCounter = 180
    expect(inOpenWindow(spr)).toBe(true)
    simulatePick(gs, num, STEYRAUG, true)
    expect(spr.weapon.num).toBe(guns[STEYRAUG].num) // 무적중 살아있으면 즉시 장착
  })

  it('(c) alive & ceaseFireCounter<=0 → out of window: pick is a no-op (locked)', () => {
    const num = spawnBareHanded(gs)
    const spr = gs.sprite[num]
    spr.deadMeat = false
    spr.ceaseFireCounter = 0
    const before = spr.weapon.num
    expect(inOpenWindow(spr)).toBe(false)
    simulatePick(gs, num, STEYRAUG, true)
    expect(spr.selWeapon).not.toBe(guns[STEYRAUG].num) // 기록조차 안 됨
    expect(spr.weapon.num).toBe(before) // 무기 변경 없음
  })

  it('(d) poll edge machine: enter window → open; exit window → close (locked until next window)', () => {
    // poll()의 상태머신을 그대로 재현: inWindow 진입 엣지=open, 이탈 엣지=close.
    let prevInWindow = false
    let open = false
    const step = (deadMeat: boolean, ceaseFire: number): void => {
      const inWin = inOpenWindow({ deadMeat, ceaseFireCounter: ceaseFire })
      if (inWin && !prevInWindow) open = true
      else if (!inWin && prevInWindow) open = false
      prevInWindow = inWin
    }
    step(false, 180); expect(open).toBe(true)   // 첫 스폰 무적 → 오픈
    step(false, 90); expect(open).toBe(true)    // 무적 진행 → 유지
    step(false, 0); expect(open).toBe(false)    // 무적 종료 → 자동 닫힘(잠금)
    step(false, 0); expect(open).toBe(false)    // 잠금 유지 — 재오픈 없음
    step(true, -1); expect(open).toBe(true)     // 사망 → 다시 개방(잠금 해제)
    step(false, 180); expect(open).toBe(true)   // 리스폰 무적 → 창 연속 유지
    step(false, 0); expect(open).toBe(false)    // 다시 종료 → 닫힘
  })
})

// ── Task4: 1/2 직접 무기전환 ─────────────────────────────────────────────────
describe('M7 Task4 — slot switch (1=primary / 2=secondary)', () => {
  it('shouldSwap: only when target differs from current', () => {
    expect(shouldSwap(5, 5)).toBe(false)
    expect(shouldSwap(5, 7)).toBe(true)
    expect(shouldSwap(guns[STEYRAUG].num, guns[LAW].num)).toBe(true)
  })

  it('slotTargetNum: bare-hands primary maps to NOWEAPON num (finding #1 regression)', () => {
    const NO = guns[NOWEAPON].num // 255
    // 맨손(selWeapon=0) + 1(주무기) → 타겟은 NOWEAPON num이어야 함(0 아님).
    expect(slotTargetNum(1, 0, NO, guns[COLT].num)).toBe(NO)
    // 그래서 이미 맨손을 들고 있으면 shouldSwap(255,255)=false → 오작동 스왑 없음.
    expect(shouldSwap(NO, slotTargetNum(1, 0, NO, guns[COLT].num)!)).toBe(false)
    // 주무기 선택돼 있으면 그 num 그대로.
    expect(slotTargetNum(1, guns[STEYRAUG].num, NO, guns[COLT].num)).toBe(guns[STEYRAUG].num)
    // 2(보조무기)는 항상 보조 num.
    expect(slotTargetNum(2, 0, NO, guns[COLT].num)).toBe(guns[COLT].num)
  })

  it('consumeSlotSwitch returns the slot once then null (edge-triggered)', () => {
    const input = new InputState()
    input.noteKeyDown('Digit2')
    expect(input.consumeSlotSwitch()).toBe(2)
    expect(input.consumeSlotSwitch()).toBe(null)
    input.noteKeyDown('Digit1') // Digit1 이 아직 안 눌렸다가 눌림 → 엣지
    expect(input.consumeSlotSwitch()).toBe(1)
  })

  it('auto-repeat does NOT re-trigger (keys Set as pressed-latch)', () => {
    const input = new InputState()
    input.noteKeyDown('Digit1')
    expect(input.consumeSlotSwitch()).toBe(1)
    input.noteKeyDown('Digit1') // 아직 keyup 안 됨 → 오토리핏 → 재트리거 금지
    expect(input.consumeSlotSwitch()).toBe(null)
    input.noteKeyUp('Digit1')
    input.noteKeyDown('Digit1') // keyup 후 재입력 → 다시 엣지
    expect(input.consumeSlotSwitch()).toBe(1)
  })

  it('Numpad1/Numpad2 map to slots 1/2', () => {
    const input = new InputState()
    input.noteKeyDown('Numpad1')
    expect(input.consumeSlotSwitch()).toBe(1)
    input.noteKeyDown('Numpad2')
    expect(input.consumeSlotSwitch()).toBe(2)
  })

  it('slot switch is suppressed while the loadout menu is open (menuOpen gate)', () => {
    const input = new InputState()
    input.setMenuOpen(true)
    input.noteKeyDown('Digit1')
    expect(input.consumeSlotSwitch()).toBe(null)
    input.setMenuOpen(false)
    input.noteKeyUp('Digit1')
    input.noteKeyDown('Digit1')
    expect(input.consumeSlotSwitch()).toBe(1)
  })
})
