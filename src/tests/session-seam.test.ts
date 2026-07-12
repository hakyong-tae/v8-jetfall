// src/tests/session-seam.test.ts — M3-E: Session 전략 seam 타입계약 + 행위 검증.
import { describe, it, expect } from 'vitest'
import { LoopbackHub } from '../net/loopback'
import { HostSession } from '../net/host-session'
import { Session, HostAuthoritativeSession, PeerSession } from '../net/session'
import { setupTestGame } from './helpers'
import { TEAM_NONE } from '../core/constants'

describe('M3-E: Session strategy seam', () => {
  it('HostAuthoritativeSession wraps a real HostSession and satisfies Session (tick/gs/spriteNumOf)', async () => {
    const hub = new LoopbackHub()
    const hostT = hub.createTransport('host')
    await hostT.connect(); await hostT.joinRoom('seam')
    const gs = setupTestGame({ emptyMap: true })
    const host = new HostSession(hostT, gs)
    host.spawnPlayers([{ account: 'alice', team: TEAM_NONE }])
    await Promise.resolve()

    const session: Session = new HostAuthoritativeSession(host) // 대입 성공 = 타입계약 검증
    expect(session.kind).toBe('host-authoritative')
    expect(session.gs).toBe(gs)
    expect(session.spriteNumOf('alice')).toBe(host.spriteNumOf('alice'))
    const before = gs.ticks
    session.tick()
    expect(gs.ticks).toBe(before + 1) // 위임된 tick이 실제 시뮬을 전진시킴
  })

  it('PeerSession satisfies Session with documented no-op stub behavior', () => {
    const hub = new LoopbackHub()
    const t = hub.createTransport('peer')
    const gs = setupTestGame({ emptyMap: true })
    const session: Session = new PeerSession(t, gs, 'peer') // 대입 성공 = 타입계약 검증
    expect(session.kind).toBe('peer')
    expect(session.gs).toBe(gs)
    expect(() => session.tick()).not.toThrow() // 의도적 no-op, 던지지 않음
    expect(session.spriteNumOf('anyone')).toBeUndefined() // 문서화된 스텁 동작
  })

  it('both kinds iterate uniformly through a Session[] — "config flip" is one field', async () => {
    const hub = new LoopbackHub()
    const hostT = hub.createTransport('host')
    await hostT.connect(); await hostT.joinRoom('seam2')
    const gs = setupTestGame({ emptyMap: true })
    const host = new HostSession(hostT, gs)
    host.spawnPlayers([{ account: 'alice', team: TEAM_NONE }])
    await Promise.resolve()

    const sessions: Session[] = [
      new HostAuthoritativeSession(host),
      new PeerSession(hub.createTransport('p2'), setupTestGame({ emptyMap: true }), 'p2'),
    ]
    for (const s of sessions) s.tick() // 균일 순회 — 어느 kind든 동일 인터페이스로 구동
    expect(sessions.map((s) => s.kind)).toEqual(['host-authoritative', 'peer'])
  })
})
