// src/tests/lobby-client.test.ts
import { describe, it, expect } from 'vitest'
import { LoopbackHub } from '../net/loopback'
import { LobbyClient } from '../net/lobby-client'
import { GAMESTYLE_CTF, TEAM_ALPHA, TEAM_BRAVO } from '../core/constants'

describe('LobbyClient (2 sessions over loopback)', () => {
  it('host creates CTF room, guest joins, both pick teams, host starts', async () => {
    const hub = new LoopbackHub()
    const host = new LobbyClient(hub.createTransport('alice'), 'Alice')
    const guest = new LobbyClient(hub.createTransport('bob'), 'Bob')
    await host.connect(); await guest.connect()

    await host.createRoom('ctfroom', GAMESTYLE_CTF)
    expect(host.isHost).toBe(true)
    expect(host.roomState.mode).toBe(GAMESTYLE_CTF)

    await guest.joinRoom('ctfroom')
    // 게스트 룸상태에 host가 보임
    expect(Object.keys(guest.players)).toContain('alice')

    await host.selectTeam(TEAM_ALPHA)
    await guest.selectTeam(TEAM_BRAVO)
    // 상태 전파 확인
    expect(host.players['alice'].team).toBe(TEAM_ALPHA)
    // guest가 host의 팀변경을 봄 (룸상태 브로드캐스트)
    expect(guest.players['alice'].team).toBe(TEAM_ALPHA)
    expect(host.players['bob'].team).toBe(TEAM_BRAVO)

    await guest.setReady(true)
    expect(host.players['bob'].ready).toBe(true)

    let started = false
    guest.onStart(() => { started = true })
    await host.start()
    await Promise.resolve()
    expect(host.roomState.started).toBe(true)
    expect(started).toBe(true) // START 이벤트 게스트 수신
  })

  it('non-host cannot start', async () => {
    const hub = new LoopbackHub()
    const host = new LobbyClient(hub.createTransport('a'), 'A')
    const guest = new LobbyClient(hub.createTransport('b'), 'B')
    await host.connect(); await guest.connect()
    await host.createRoom('r', 0); await guest.joinRoom('r')
    await expect(guest.start()).rejects.toThrow(/host/i)
  })
})
