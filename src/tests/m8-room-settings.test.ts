// src/tests/m8-room-settings.test.ts — M8: 멀티 방 상세설정 + 맵 디싱크 수정.
// 스펙: docs/superpowers/specs/2026-07-16-m8-room-settings-design.md
// 코어 무수정 검증 — applyMatchSettings가 기존 코어 필드에 값만 흘려 넣는지,
// 설정이 LoopbackHub 위 roomState로 왕복하는지, 매치 시작 시 전원이 같은 mapKey를 읽는지.
import { describe, it, expect } from 'vitest'
import { createGameState } from '../core/state'
import { PRIMARY_WEAPONS, MAIN_WEAPONS } from '../core/weapons'
import { LoopbackHub } from '../net/loopback'
import { LobbyClient } from '../net/lobby-client'
import { GAMESTYLE_DEATHMATCH, GAMESTYLE_CTF } from '../core/constants'
import {
  defaultRoomSettings, mergeRoomSettings, applyMatchSettings, canDisableWeapon,
  UNLIMITED_TIME, type RoomSettings,
} from '../net/room-settings'

// ── applyMatchSettings — 각 필드가 코어 필드에 정확히 착지 ─────────────────────
describe('M8 applyMatchSettings — settings → core fields', () => {
  it('weaponActive lands on gs.weaponActive[1..14] as a defensive 0/1 copy (slot 0 untouched)', () => {
    const gs = createGameState()
    const wa = new Array<number>(MAIN_WEAPONS).fill(1)
    wa[0] = 0  // Desert Eagles off
    wa[13] = 0 // 보조 마지막 off
    const s: RoomSettings = { ...defaultRoomSettings(), weaponActive: wa }
    applyMatchSettings(gs, s)
    expect(gs.weaponActive[0]).toBe(0) // Pascal zero-init 규약 보존
    expect(gs.weaponActive[1]).toBe(0)
    expect(gs.weaponActive[2]).toBe(1)
    expect(gs.weaponActive[14]).toBe(0)
    // 방어적 복사 — 원본 배열 변조가 gs로 새지 않는다
    wa[1] = 0
    expect(gs.weaponActive[2]).toBe(1)
  })

  it('killLimit / respawnSeconds / timeLimitMin land (min→ticks) with timeLimitCounter re-armed', () => {
    const gs = createGameState()
    applyMatchSettings(gs, { ...defaultRoomSettings(), killLimit: 15, respawnSeconds: 2, timeLimitMin: 5 })
    expect(gs.svKilllimit).toBe(15)
    expect(gs.svRespawntime).toBe(120)         // 2s * 60틱
    expect(gs.svTimelimit).toBe(5 * 60 * 60)   // 18000틱 = 5분
    // 잠복버그 처리: state.ts 기본 timeLimitCounter=3600(60초) → 반드시 svTimelimit로 재무장
    expect(gs.timeLimitCounter).toBe(gs.svTimelimit)
  })

  it('unlimited time (0 min) → BOTH svTimelimit and timeLimitCounter = UNLIMITED_TIME', () => {
    const gs = createGameState()
    applyMatchSettings(gs, { ...defaultRoomSettings(), timeLimitMin: 0 })
    // svTimelimit도 UNLIMITED — nextMap 라운드 리셋이 timeLimitCounter=svTimelimit로 재무장하므로
    // (core game.ts:470) counter만 크게 두면 리셋 후 다시 유한으로 돌아간다.
    expect(gs.svTimelimit).toBe(UNLIMITED_TIME)
    expect(gs.timeLimitCounter).toBe(UNLIMITED_TIME)
  })

  it('missing / partial / malformed settings → defaults, never throws', () => {
    for (const raw of [undefined, null, 42, 'x', {}, { killLimit: 15 }, { weaponActive: [1, 0] }]) {
      const gs = createGameState()
      expect(() => applyMatchSettings(gs, raw)).not.toThrow()
      // weaponActive 길이 불일치([1,0])·누락 → 전부 1 폴백
      for (let w = 1; w <= MAIN_WEAPONS; w++) expect(gs.weaponActive[w]).toBe(1)
      expect(gs.svRespawntime).toBe(360)      // 기본 6s
      expect(gs.svTimelimit).toBe(36000)      // 기본 10분
      expect(gs.timeLimitCounter).toBe(36000) // 재무장(잠복버그 수정)
      if (raw && typeof raw === 'object' && 'killLimit' in raw) expect(gs.svKilllimit).toBe(15)
      else expect(gs.svKilllimit).toBe(10)
    }
  })
})

// ── mergeRoomSettings — 필드별 검증/폴백 ──────────────────────────────────────
describe('M8 mergeRoomSettings', () => {
  it('partial patch keeps other fields at defaults', () => {
    const s = mergeRoomSettings({ killLimit: 20 })
    expect(s.killLimit).toBe(20)
    expect(s.mapKey).toBe('random')
    expect(s.respawnSeconds).toBe(6)
    expect(s.timeLimitMin).toBe(10)
    expect(s.weaponActive).toHaveLength(MAIN_WEAPONS)
  })

  it('rejects invalid values (negative, NaN, wrong types) field-by-field', () => {
    const s = mergeRoomSettings({ killLimit: -5, respawnSeconds: NaN, timeLimitMin: 'x', mapKey: '' } as unknown)
    expect(s.killLimit).toBe(10)
    expect(s.respawnSeconds).toBe(6)
    expect(s.timeLimitMin).toBe(10)
    expect(s.mapKey).toBe('random')
  })

  it('clamps weaponActive entries to 0/1', () => {
    const wa = new Array<number>(MAIN_WEAPONS).fill(7)
    wa[3] = 0
    const s = mergeRoomSettings({ weaponActive: wa })
    expect(s.weaponActive[0]).toBe(1)
    expect(s.weaponActive[3]).toBe(0)
  })
})

// ── canDisableWeapon — 그룹별 최소 1종 가드 ───────────────────────────────────
describe('M8 canDisableWeapon — each group keeps ≥1 enabled', () => {
  it('all on → any weapon can be disabled', () => {
    const wa = new Array<number>(MAIN_WEAPONS).fill(1)
    expect(canDisableWeapon(wa, 0)).toBe(true)
    expect(canDisableWeapon(wa, PRIMARY_WEAPONS)).toBe(true)
  })

  it('last enabled primary cannot be disabled (secondary group independent)', () => {
    const wa = new Array<number>(MAIN_WEAPONS).fill(0)
    wa[4] = 1 // 주무기 1종만
    for (let i = PRIMARY_WEAPONS; i < MAIN_WEAPONS; i++) wa[i] = 1 // 보조 전부 on
    expect(canDisableWeapon(wa, 4)).toBe(false)      // 마지막 주무기 — 못 끔
    expect(canDisableWeapon(wa, PRIMARY_WEAPONS)).toBe(true) // 보조는 여럿 → 끌 수 있음
  })

  it('last enabled secondary cannot be disabled', () => {
    const wa = new Array<number>(MAIN_WEAPONS).fill(1)
    for (let i = PRIMARY_WEAPONS; i < MAIN_WEAPONS; i++) wa[i] = 0
    wa[PRIMARY_WEAPONS + 2] = 1 // 보조 1종만
    expect(canDisableWeapon(wa, PRIMARY_WEAPONS + 2)).toBe(false)
    expect(canDisableWeapon(wa, 0)).toBe(true) // 주무기는 전부 on → 끌 수 있음
  })

  it('turning ON (already-off slot) is always allowed', () => {
    const wa = new Array<number>(MAIN_WEAPONS).fill(0)
    wa[0] = 1; wa[PRIMARY_WEAPONS] = 1
    expect(canDisableWeapon(wa, 1)).toBe(true) // 꺼진 슬롯 → 가드 비대상
  })
})

// ── LOOPBACK 통합: 설정 왕복 + 맵 디싱크 회귀 ─────────────────────────────────
describe('M8 settings round-trip over LoopbackHub', () => {
  it('createRoom writes default settings into roomState (visible to both members)', async () => {
    const hub = new LoopbackHub()
    const host = new LobbyClient(hub.createTransport('alice'), 'Alice')
    const guest = new LobbyClient(hub.createTransport('bob'), 'Bob')
    await host.connect(); await guest.connect()
    await host.createRoom('r1', GAMESTYLE_DEATHMATCH)
    await guest.joinRoom('r1')
    expect(host.settings).toEqual(defaultRoomSettings(GAMESTYLE_DEATHMATCH))
    expect(guest.settings).toEqual(defaultRoomSettings(GAMESTYLE_DEATHMATCH))
  })

  it('host updateSettings({killLimit:15}) → guest roomState sees merged settings', async () => {
    const hub = new LoopbackHub()
    const host = new LobbyClient(hub.createTransport('alice'), 'Alice')
    const guest = new LobbyClient(hub.createTransport('bob'), 'Bob')
    await host.connect(); await guest.connect()
    await host.createRoom('r2', GAMESTYLE_DEATHMATCH)
    await guest.joinRoom('r2')
    let guestSawChange = false
    guest.onChange(() => { guestSawChange = true })
    await host.updateSettings({ killLimit: 15 })
    expect(guestSawChange).toBe(true)
    expect(guest.settings.killLimit).toBe(15)
    // 나머지 필드는 병합 보존
    expect(guest.settings.respawnSeconds).toBe(6)
    expect(guest.settings.mapKey).toBe('random')
    // 연속 패치도 누적 병합
    await host.updateSettings({ timeLimitMin: 0 })
    expect(guest.settings.killLimit).toBe(15)
    expect(guest.settings.timeLimitMin).toBe(0)
  })

  // ★ 디싱크 수정 회귀 테스트 — M5 이후 각 클라가 각자 랜덤 맵을 뽑던 치명 버그.
  it('REGRESSION: host resolves random → concrete mapKey written with started:true; both read the SAME key', async () => {
    const eligible = ['ctf_Ash', 'ctf_B2b', 'ctf_Cobra'] // 모드 소속 후보 풀(호출자=UI가 전달)
    const hub = new LoopbackHub()
    const host = new LobbyClient(hub.createTransport('alice'), 'Alice')
    const guest = new LobbyClient(hub.createTransport('bob'), 'Bob')
    await host.connect(); await guest.connect()
    await host.createRoom('r3', GAMESTYLE_CTF)
    await guest.joinRoom('r3')
    expect(host.settings.mapKey).toBe('random')

    await host.start(eligible)
    // 시작 시점에 양쪽 트랜스포트가 읽는 mapKey가 '동일'하고 '확정'이며 후보 풀 소속이어야 한다.
    const hostKey = mergeRoomSettings(host.roomState.settings).mapKey
    const guestKey = mergeRoomSettings(guest.roomState.settings).mapKey
    expect(hostKey).not.toBe('random')
    expect(eligible).toContain(hostKey)
    expect(guestKey).toBe(hostKey) // ← 디싱크 수정의 핵심 단언
    expect(guest.roomState.started).toBe(true)
  })

  it('host-picked concrete mapKey survives start() untouched', async () => {
    const hub = new LoopbackHub()
    const host = new LobbyClient(hub.createTransport('alice'), 'Alice')
    const guest = new LobbyClient(hub.createTransport('bob'), 'Bob')
    await host.connect(); await guest.connect()
    await host.createRoom('r4', GAMESTYLE_CTF)
    await guest.joinRoom('r4')
    await host.updateSettings({ mapKey: 'ctf_Kampf' })
    await host.start(['ctf_Ash', 'ctf_B2b'])
    expect(mergeRoomSettings(host.roomState.settings).mapKey).toBe('ctf_Kampf')
    expect(mergeRoomSettings(guest.roomState.settings).mapKey).toBe('ctf_Kampf')
  })

  it('old rooms without settings: lc.settings falls back to defaults (no crash)', async () => {
    const hub = new LoopbackHub()
    const host = new LobbyClient(hub.createTransport('alice'), 'Alice')
    await host.connect()
    // createRoom을 우회해 settings 없는 옛 방 상태를 흉내
    await host.net.joinRoom('legacy')
    await host.net.updateRoomState({ mode: GAMESTYLE_DEATHMATCH, hostAccount: 'alice', started: false })
    expect(host.settings).toEqual(defaultRoomSettings())
  })
})
