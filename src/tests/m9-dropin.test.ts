// src/tests/m9-dropin.test.ts — M9 난입(drop-in join) 검증.
// 1) 진행중 매치에 3번째 클라 난입 → 호스트 syncRoster가 스폰+즉시 ASSIGN, 난입자는 스냅샷으로
//    기존 인원 미러링, 난입자 입력이 호스트에 반영(이동).
// 2) 이탈 정리 — p_ 제거 → 호스트 sprite.kill() + slotOf 정리, 남은 클라도 스냅샷 부재 감지로
//    로컬 스프라이트 정리(knownSlots 포함 — 승격 seed에서 이탈자 부활 방지).
// 3) CTF 자동 팀배정(pickAutoTeam) / 4) 정원 게이트(canJoinRoom) 순수 유닛.
// 하네스: net-b/host-migration 통합테스트와 동일한 LoopbackHub + flush(마이크로태스크 배송) 패턴.
import { describe, it, expect } from 'vitest'
import { LoopbackHub } from '../net/loopback'
import { LobbyClient } from '../net/lobby-client'
import { HostSession, type HostSessionPlayer } from '../net/host-session'
import { ClientSession, type LocalInput } from '../net/client-session'
import { pickAutoTeam, canJoinRoom, ROOM_CAP } from '../net/dropin'
import { setupTestGame } from './helpers'
import {
  TEAM_NONE, TEAM_ALPHA, TEAM_BRAVO, TEAM_SPECTATOR, GAMESTYLE_DEATHMATCH, GAMESTYLE_CTF,
} from '../core/constants'
import type { RoomPlayer } from '../net/types'

const flush = () => Promise.resolve()

function neutral(overrides: Partial<LocalInput> = {}): LocalInput {
  return { left: false, right: false, up: false, down: false, fire: false, jetpack: false,
    throwNade: false, changeWeapon: false, throwWeapon: false, reload: false, prone: false,
    flagThrow: false, mouseAimX: 0, mouseAimY: 0, ...overrides }
}

function rp(team = TEAM_NONE, joinedAt = 0): RoomPlayer {
  return { nick: 'x', team, ready: true, kills: 0, deaths: 0, joinedAt }
}

// main.ts syncRosterIfHost와 동일 변환 — roomState p_ → HostSessionPlayer[].
function rosterOf(lc: LobbyClient): HostSessionPlayer[] {
  return Object.entries(lc.players).map(([acc, p]) => ({ account: acc, team: p.team }))
}

describe('M9 drop-in: late joiner enters an in-progress match', () => {
  it('host syncRoster spawns the late joiner (immediate ASSIGN); joiner mirrors all 3; joiner input moves on host', async () => {
    const hub = new LoopbackHub()
    const aliceLc = new LobbyClient(hub.createTransport('alice'), 'Alice')
    const bobLc = new LobbyClient(hub.createTransport('bob'), 'Bob')
    await aliceLc.connect(); await bobLc.connect()
    await aliceLc.createRoom('m9', GAMESTYLE_DEATHMATCH)
    await bobLc.joinRoom('m9')
    await aliceLc.start() // started=true 기록 (settings.mapKey 해석은 매치 로딩 관심사 — 여기선 심만)

    const hostGs = setupTestGame({ emptyMap: true })
    const host = new HostSession(aliceLc.net, hostGs)
    host.spawnPlayers(rosterOf(aliceLc))
    const bGs = setupTestGame({ emptyMap: true })
    const bob = new ClientSession(bobLc.net, bGs, 'bob', () => neutral())
    await flush() // ASSIGN 배송

    for (let i = 0; i < 10; i++) { bob.tick(); host.tick(); await flush() } // 매치 진행 중

    // ── 난입: carol이 로비에서 Join(live) — joinRoom이 p_ 기록, roomState.started 확인 가능
    const carolLc = new LobbyClient(hub.createTransport('carol'), 'Carol')
    await carolLc.connect()
    await carolLc.joinRoom('m9')
    expect(carolLc.roomState.started).toBe(true) // enterRoom의 난입 분기 신호

    const cGs = setupTestGame({ emptyMap: true })
    let carolInput = neutral()
    const carol = new ClientSession(carolLc.net, cGs, 'carol', () => carolInput)

    // 호스트가 roomState 변화를 감지해 syncRoster (main.ts는 onChange dirty 플래그 경유)
    expect(host.spriteNumOf('carol')).toBeUndefined()
    host.syncRoster(rosterOf(aliceLc))
    const carolNum = host.spriteNumOf('carol')
    expect(carolNum).toBeDefined() // 스폰 + slotOf 등록
    await flush() // 즉시 ASSIGN 배송 (60틱 재방송 안 기다림)
    expect(carol.myNum).toBe(carolNum)

    const startX = hostGs.spriteParts.pos[carolNum!].x
    carolInput = neutral({ right: true, mouseAimX: startX + 500 })
    for (let i = 0; i < 120; i++) { bob.tick(); carol.tick(); host.tick(); await flush() }

    // 난입자 로컬 뷰에 3인 전원 활성(스냅샷 full-state 캐치업)
    for (const acc of ['alice', 'bob', 'carol']) {
      const num = host.spriteNumOf(acc)!
      expect(cGs.sprite[num].active).toBe(true)
      expect(Number.isNaN(cGs.spriteParts.pos[num].x)).toBe(false)
    }
    // 난입자 INPUT이 호스트 권위심에 반영(우로 이동)
    expect(hostGs.spriteParts.pos[carolNum!].x).toBeGreaterThan(startX)
    // 기존 클라(bob)도 난입자를 미러링
    expect(bGs.sprite[carolNum!].active).toBe(true)
  })

  it('leave cleanup: p_ removed → host kills sprite + prunes slotOf; remaining client prunes local sprite/knownSlots', async () => {
    const hub = new LoopbackHub()
    const tHost = hub.createTransport('alice')
    const tBob = hub.createTransport('bob')
    await tHost.connect(); await tBob.connect()
    await tHost.joinRoom('m9x'); await tBob.joinRoom('m9x')

    const hostGs = setupTestGame({ emptyMap: true })
    const host = new HostSession(tHost, hostGs)
    host.spawnPlayers([
      { account: 'alice', team: TEAM_NONE },
      { account: 'bob', team: TEAM_NONE },
      { account: 'carol', team: TEAM_NONE },
    ])
    const carolNum = host.spriteNumOf('carol')!
    const bGs = setupTestGame({ emptyMap: true })
    const bob = new ClientSession(tBob, bGs, 'bob', () => neutral())
    await flush()
    for (let i = 0; i < 10; i++) { bob.tick(); host.tick(); await flush() }
    expect(bGs.sprite[carolNum].active).toBe(true) // 전제: bob이 carol을 미러링 중
    expect(bob.knownSlots.get('carol')).toBe(carolNum)

    host.syncRoster([ // carol의 p_가 사라진 로스터
      { account: 'alice', team: TEAM_NONE },
      { account: 'bob', team: TEAM_NONE },
    ])
    expect(hostGs.sprite[carolNum].active).toBe(false) // 코어 규약 sprite.kill()로 비활성
    expect(host.spriteNumOf('carol')).toBeUndefined()  // slotOf 정리

    for (let i = 0; i < 6; i++) { bob.tick(); host.tick(); await flush() } // 스냅샷 부재 감지
    expect(bGs.sprite[carolNum].active).toBe(false)      // 남은 클라 로컬 정리(고스트 방지)
    expect(bob.knownSlots.has('carol')).toBe(false)      // 승격 seed에서도 제거(부활 방지)
  })
})

describe('M9 pickAutoTeam — CTF 난입자 자동 팀배정', () => {
  it('picks the team with fewer players', () => {
    expect(pickAutoTeam({
      a: rp(TEAM_ALPHA), b: rp(TEAM_ALPHA), c: rp(TEAM_BRAVO),
    })).toBe(TEAM_BRAVO)
    expect(pickAutoTeam({
      a: rp(TEAM_BRAVO), b: rp(TEAM_BRAVO), c: rp(TEAM_ALPHA),
    })).toBe(TEAM_ALPHA)
  })
  it('tie (or empty room) → TEAM_ALPHA', () => {
    expect(pickAutoTeam({ a: rp(TEAM_ALPHA), b: rp(TEAM_BRAVO) })).toBe(TEAM_ALPHA)
    expect(pickAutoTeam({})).toBe(TEAM_ALPHA)
  })
  it('spectators and TEAM_NONE (fresh joiner self) do not count', () => {
    expect(pickAutoTeam({
      a: rp(TEAM_ALPHA), s1: rp(TEAM_SPECTATOR), s2: rp(TEAM_SPECTATOR), me: rp(TEAM_NONE),
    })).toBe(TEAM_BRAVO)
  })
})

describe('M9 canJoinRoom — 정원 게이트', () => {
  it('allows below cap, blocks at/over cap (CAP=8, server.js 규약 동일)', () => {
    expect(ROOM_CAP).toBe(8)
    expect(canJoinRoom(0)).toBe(true)
    expect(canJoinRoom(7)).toBe(true)
    expect(canJoinRoom(8)).toBe(false)
    expect(canJoinRoom(9)).toBe(false)
  })
})

// ── 리뷰 후속(request-changes 반영) ─────────────────────────────────────────────

describe('M9 리뷰 #1 — CTF 난입 팀배정 레이스: 호스트가 스폰 시점에 권위 배정', () => {
  it('p_ 팀이 아직 NONE인 채 syncRoster가 돌아도 무소속으로 스폰되지 않는다', () => {
    const hub = new LoopbackHub()
    const gs = setupTestGame()
    gs.svGamemode = GAMESTYLE_CTF
    const host = new HostSession(hub.createTransport('host'), gs)
    // 기존 로스터: 알파 2 / 브라보 1 → NONE 난입자는 브라보로 배정돼야 함
    host.spawnPlayers([
      { account: 'a1', team: TEAM_ALPHA },
      { account: 'a2', team: TEAM_ALPHA },
      { account: 'b1', team: TEAM_BRAVO },
    ])
    host.syncRoster([
      { account: 'a1', team: TEAM_ALPHA },
      { account: 'a2', team: TEAM_ALPHA },
      { account: 'b1', team: TEAM_BRAVO },
      { account: 'late', team: TEAM_NONE }, // ← selectTeam 에코가 아직 안 온 순간의 난입자
    ])
    const num = host.spriteNumOf('late')!
    expect(num).toBeGreaterThan(0)
    expect(gs.sprite[num].player!.team).toBe(TEAM_BRAVO) // 무소속 아님 + 적은 팀
  })

  it('DM(비CTF)에서는 팀을 건드리지 않는다(NONE 그대로)', () => {
    const hub = new LoopbackHub()
    const gs = setupTestGame()
    gs.svGamemode = GAMESTYLE_DEATHMATCH
    const host = new HostSession(hub.createTransport('host'), gs)
    host.syncRoster([{ account: 'solo', team: TEAM_NONE }])
    const num = host.spriteNumOf('solo')!
    expect(gs.sprite[num].player!.team).toBe(TEAM_NONE)
  })
})

describe('M9 리뷰 #2 — ASSIGN 역방향 유일성(슬롯 재사용 시 옛 계정 매핑 제거)', () => {
  it('같은 num으로 새 ASSIGN이 오면 그 num의 옛 계정 매핑이 제거된다', async () => {
    const hub = new LoopbackHub()
    const hostT = hub.createTransport('host')
    const clientT = hub.createTransport('watcher')
    await hostT.joinRoom('r')
    await clientT.joinRoom('r')
    const gs = setupTestGame()
    const cs = new ClientSession(clientT, gs, 'watcher', () => neutral())
    hostT.send('assign', { account: 'old', num: 2 })
    await flush()
    expect(cs.knownSlots.get('old')).toBe(2)
    hostT.send('assign', { account: 'new', num: 2 }) // 슬롯 2 재사용(이탈+난입 동시)
    await flush()
    expect(cs.knownSlots.get('new')).toBe(2)
    expect(cs.knownSlots.has('old')).toBe(false) // ← 승격 시 kill 오발 방지
  })
})
