// src/tests/host-migration.test.ts — M3-E: 마이그레이션 선행 소품(Task 1) + 선출/판단 순수함수(Task 2).
import { describe, it, expect } from 'vitest'
import { LoopbackHub } from '../net/loopback'
import { HostSession } from '../net/host-session'
import { ClientSession, type LocalInput } from '../net/client-session'
import { electHost, decideMigration, HOST_TIMEOUT_MS } from '../net/host-migration'
import { setupTestGame } from './helpers'
import { TEAM_NONE } from '../core/constants'
import type { RoomPlayer } from '../net/types'

const NO_INPUT: LocalInput = { left: false, right: false, up: false, down: false, fire: false,
  jetpack: false, throwNade: false, changeWeapon: false, throwWeapon: false, reload: false,
  prone: false, flagThrow: false, mouseAimX: 0, mouseAimY: 0 }

// loopback은 queueMicrotask로 배송한다 — 매 틱 후 마이크로태스크 큐를 비워 다음 틱 전 배송을 보장.
const flush = () => Promise.resolve()

function player(joinedAt: number): RoomPlayer {
  return { nick: 'x', team: TEAM_NONE, ready: true, kills: 0, deaths: 0, joinedAt }
}

// ── Task 1: knownSlots(전원 ASSIGN 기록) + lastSnapshotAt(가짜시계) ──
describe('M3-E Task1: client tracks all slots + snapshot arrival time', () => {
  it('knownSlots records every account ASSIGN, matching host slotOf; lastSnapshotAt goes 0→now', async () => {
    const hub = new LoopbackHub()
    const hostT = hub.createTransport('host')
    const aT = hub.createTransport('alice')
    const bT = hub.createTransport('bob')
    await Promise.all([hostT.connect(), aT.connect(), bT.connect()])
    await Promise.all([hostT.joinRoom('m3e1'), aT.joinRoom('m3e1'), bT.joinRoom('m3e1')])

    const hostGs = setupTestGame({ emptyMap: true })
    const host = new HostSession(hostT, hostGs)
    host.spawnPlayers([
      { account: 'alice', team: TEAM_NONE },
      { account: 'bob', team: TEAM_NONE },
    ])

    let fakeNow = 5_000_000
    const aGs = setupTestGame({ emptyMap: true })
    const aClient = new ClientSession(aT, aGs, 'alice', () => NO_INPUT, () => fakeNow)
    const bGs = setupTestGame({ emptyMap: true })
    const bClient = new ClientSession(bT, bGs, 'bob', () => NO_INPUT)

    expect(aClient.lastSnapshotAt).toBe(0) // 아직 스냅샷 미수신

    await flush() // ASSIGN 배송
    // 전원분 기록됐는지 — 자기 것만이 아니라 남의 슬롯도.
    expect(aClient.knownSlots.get('alice')).toBe(host.spriteNumOf('alice'))
    expect(aClient.knownSlots.get('bob')).toBe(host.spriteNumOf('bob'))
    expect(aClient.knownSlots.size).toBe(2)

    // 스냅샷 수신 시 lastSnapshotAt이 가짜시계 값으로.
    for (let i = 0; i < 4; i++) { aClient.tick(); bClient.tick(); host.tick(); await flush() }
    expect(aClient.lastSnapshotAt).toBe(fakeNow)
    fakeNow += 123
    for (let i = 0; i < 2; i++) { aClient.tick(); host.tick(); await flush() }
    expect(aClient.lastSnapshotAt).toBe(fakeNow) // 최신 수신 시각으로 갱신
  })
})

// ── Task 2: electHost(4케이스) + decideMigration(4케이스) ──
describe('M3-E Task2: electHost is a deterministic pure function', () => {
  const players: Record<string, RoomPlayer> = {
    alice: player(100), bob: player(200), carol: player(300),
  }

  it('elects the earliest joinedAt among non-excluded (host death → next earliest)', () => {
    expect(electHost(players, 'alice')).toBe('bob') // alice 죽음 제외 → bob(200)
  })

  it('breaks joinedAt ties by account string ascending (deterministic across all peers)', () => {
    const tied: Record<string, RoomPlayer> = { zoe: player(200), amy: player(200), mia: player(200) }
    expect(electHost(tied, 'nobody')).toBe('amy') // 동률 → 문자열 최소
  })

  it('returns null only when the caller itself is not in players (bookkeeping edge)', () => {
    expect(electHost({}, 'alice')).toBe(null)
    expect(electHost({ alice: player(100) }, 'alice')).toBe(null) // alice 제외하면 후보 0
  })

  it('naturally elects self when sole survivor (no special-case branch)', () => {
    const solo: Record<string, RoomPlayer> = { me: player(500) }
    expect(electHost(solo, 'deadhost')).toBe('me')
  })
})

describe('M3-E Task2: decideMigration gates on timeout + election', () => {
  const players: Record<string, RoomPlayer> = {
    alice: player(100), bob: player(200), carol: player(300),
  }
  const deps = (myAccount: string, now: number) => ({
    getPlayers: () => players, myAccount, currentHostAccount: 'alice', nowFn: () => now,
  })

  it('holds off ("none") while no snapshot ever received (lastSnapshotAt=0)', () => {
    expect(decideMigration(0, deps('bob', 999_999))).toBe('none')
  })

  it('stays "none" before HOST_TIMEOUT_MS elapses', () => {
    const last = 1_000_000
    expect(decideMigration(last, deps('bob', last + HOST_TIMEOUT_MS - 1))).toBe('none')
  })

  it('promotes when I am the elected host after timeout', () => {
    const last = 1_000_000
    expect(decideMigration(last, deps('bob', last + HOST_TIMEOUT_MS + 1))).toBe('promote') // bob elected
  })

  it('waits when someone else is elected after timeout', () => {
    const last = 1_000_000
    expect(decideMigration(last, deps('carol', last + HOST_TIMEOUT_MS + 1))).toBe('wait') // bob elected, not carol
  })
})
