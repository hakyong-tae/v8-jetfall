// src/tests/host-migration-integration.test.ts — M3-E 핵심 검증: 브라우저-호스트 매치에서
// 호스트가 사라져도 남은 참가자 중 하나가 자동 승격해 매치가 안 끊긴다(loopback 3자).
//
// 참고: loopback은 queueMicrotask로 배송하므로(다른 net 통합테스트와 동일) 매 틱 후 await flush()로
// 큐를 비운다 — 계획서의 동기 루프를 이 배송 모델에 맞춰 각색(스냅샷/ASSIGN이 실제로 배송돼야
// knownSlots·미러링·lastSnapshotAt이 채워진다). 시나리오 자체는 계획서 그대로.
import { describe, it, expect } from 'vitest'
import { LoopbackHub } from '../net/loopback'
import { HostSession } from '../net/host-session'
import { ClientSession, type LocalInput } from '../net/client-session'
import { decideMigration } from '../net/host-migration'
import { setupTestGame } from './helpers'
import { TEAM_NONE } from '../core/constants'
import type { RoomPlayer } from '../net/types'

const NO_INPUT: LocalInput = { left: false, right: false, up: false, down: false, fire: false,
  jetpack: false, throwNade: false, changeWeapon: false, throwWeapon: false, reload: false,
  prone: false, flagThrow: false, mouseAimX: 0, mouseAimY: 0 }

const flush = () => Promise.resolve()

describe('M3-E: browser-host migration keeps the match alive', () => {
  it('host A stops; B (earliest joinedAt) is elected and promotes; C keeps receiving from B; no NaN', async () => {
    const hub = new LoopbackHub()
    const tA = hub.createTransport('alice')
    const tB = hub.createTransport('bob')
    const tC = hub.createTransport('carol')
    for (const t of [tA, tB, tC]) { await t.connect(); await t.joinRoom('mroom') }

    const players: Record<string, RoomPlayer> = {
      alice: { nick: 'alice', team: TEAM_NONE, ready: true, kills: 0, deaths: 0, joinedAt: 100 },
      bob: { nick: 'bob', team: TEAM_NONE, ready: true, kills: 0, deaths: 0, joinedAt: 200 },
      carol: { nick: 'carol', team: TEAM_NONE, ready: true, kills: 0, deaths: 0, joinedAt: 300 },
    }
    const hostGs = setupTestGame({ emptyMap: true })
    let hostSession = new HostSession(tA, hostGs)
    hostSession.spawnPlayers([
      { account: 'alice', team: TEAM_NONE },
      { account: 'bob', team: TEAM_NONE },
      { account: 'carol', team: TEAM_NONE },
    ])

    const bGs = setupTestGame({ emptyMap: true })
    let fakeNowB = 1_000_000
    let clientB: ClientSession | null = new ClientSession(tB, bGs, 'bob', () => NO_INPUT, () => fakeNowB)
    const cGs = setupTestGame({ emptyMap: true })
    const clientC = new ClientSession(tC, cGs, 'carol', () => NO_INPUT)

    await flush() // ASSIGN 배송
    for (let i = 0; i < 20; i++) { hostSession.tick(); clientB!.tick(); clientC.tick(); await flush() } // 정상구동 — 미러링 채우기
    expect(clientB!.knownSlots.size).toBe(3)
    expect(clientB!.lastSnapshotAt).toBe(fakeNowB) // 스냅샷 수신 시각(가짜시계)
    const cTicksBefore = cGs.ticks

    // 호스트 A 사망 시뮬 — 이후 tA를 참조하는 hostSession.tick()을 더는 부르지 않는다.
    fakeNowB += 3500 // HOST_TIMEOUT_MS 초과
    const action = decideMigration(clientB!.lastSnapshotAt, {
      getPlayers: () => players, myAccount: 'bob', currentHostAccount: 'alice', nowFn: () => fakeNowB,
    })
    expect(action).toBe('promote') // bob(200) < carol(300)

    const promoted = HostSession.fromPromotedClient(tB, bGs, clientB!.knownSlots)
    expect(promoted.spriteNumOf('alice')).toBeDefined()
    expect(promoted.spriteNumOf('bob')).toBeDefined()
    expect(promoted.spriteNumOf('carol')).toBeDefined()
    clientB = null
    hostSession = promoted // 이제 B가 권위 시뮬 구동

    for (let i = 0; i < 20; i++) { hostSession.tick(); clientC.tick(); await flush() } // 매치 지속

    expect(cGs.ticks).toBeGreaterThan(cTicksBefore) // C가 계속 스냅샷 수신 중(로컬 gs 계속 전진)
    for (const num of [promoted.spriteNumOf('alice')!, promoted.spriteNumOf('bob')!, promoted.spriteNumOf('carol')!]) {
      expect(Number.isNaN(bGs.spriteParts.pos[num].x)).toBe(false)
      expect(Number.isNaN(cGs.spriteParts.pos[num].x)).toBe(false)
    }
  })
})
