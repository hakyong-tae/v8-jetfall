// src/tests/net-c-ctf-integration.test.ts — M3-C: CTF 깃발 캡처가 전 클라 teamScore로 수렴 +
// 팬텀 깃발 없음(설계 결정 4). 실보행 대신 캐리어/좌표를 스크립트한 "스테이지드" 캡처.
import { describe, it, expect } from 'vitest'
import { LoopbackHub } from '../net/loopback'
import { HostSession } from '../net/host-session'
import { ClientSession, type LocalInput } from '../net/client-session'
import { setupTestGame } from './helpers'
import { GAMESTYLE_CTF, TEAM_ALPHA, TEAM_BRAVO, OBJECT_ALPHA_FLAG, OBJECT_BRAVO_FLAG } from '../core/constants'

function neutral(overrides: Partial<LocalInput> = {}): LocalInput {
  return { left: false, right: false, up: false, down: false, fire: false, jetpack: false,
    throwNade: false, changeWeapon: false, throwWeapon: false, reload: false, prone: false,
    flagThrow: false, mouseAimX: 0, mouseAimY: 0, ...overrides }
}

const activeFlags = (gs: ReturnType<typeof setupTestGame>, style: number) =>
  gs.thing.filter((th, i) => i !== 0 && th.active && th.style === style).length

describe('M3-C integration: CTF flag capture syncs teamScore to all clients', () => {
  it('a staged Bravo-flag grab by an Alpha player, walked to base, increments teamScore1 everywhere; no phantom flags', async () => {
    const hub = new LoopbackHub()
    const hostT = hub.createTransport('host')
    const aT = hub.createTransport('alice')
    const bT = hub.createTransport('bob')
    await Promise.all([hostT.connect(), aT.connect(), bT.connect()])
    await Promise.all([hostT.joinRoom('ctf'), aT.joinRoom('ctf'), bT.joinRoom('ctf')])

    const hostGs = setupTestGame({ emptyMap: false }) // 실제 ctf_Ash 맵 — flagSpawn 필요
    hostGs.svGamemode = GAMESTYLE_CTF
    const host = new HostSession(hostT, hostGs)
    host.spawnPlayers([{ account: 'alice', team: TEAM_ALPHA }, { account: 'bob', team: TEAM_BRAVO }])
    const aliceNum = host.spriteNumOf('alice')!

    const aGs = setupTestGame({ emptyMap: false }); aGs.svGamemode = GAMESTYLE_CTF
    const aClient = new ClientSession(aT, aGs, 'alice', () => neutral())
    const bGs = setupTestGame({ emptyMap: false }); bGs.svGamemode = GAMESTYLE_CTF
    const bClient = new ClientSession(bT, bGs, 'bob', () => neutral())

    // 워밍업 — 코어 CTF 자동생성은 mainTickCounter % (SECOND*2)===0(=120틱째). 여유있게 돌리며
    //   매 반복 flush로 배정/스냅샷/깃발동기화가 실제 전파되게 한다.
    for (let i = 0; i < 140; i++) { aClient.tick(); bClient.tick(); host.tick(); await Promise.resolve() }
    expect(hostGs.teamFlag[1]).toBeGreaterThan(0) // 알파 깃발
    expect(hostGs.teamFlag[2]).toBeGreaterThan(0) // 브라보 깃발

    const bravoFlagNum = hostGs.teamFlag[2]
    const alphaFlagNum = hostGs.teamFlag[1]
    const alphaPos = { x: hostGs.thing[alphaFlagNum].skeleton.pos[1].x, y: hostGs.thing[alphaFlagNum].skeleton.pos[1].y }

    // 스테이지: alice(Alpha)가 브라보 깃발을 들고 자기 베이스(알파 깃발 스폰지점)에 서있게 한다.
    //   캐리어 깃발 pos[1]은 코어가 매 틱 carrier.skeleton.pos[8]로 재설정하므로, alice를 알파
    //   깃발 위에 고정하면 touchdown 반경(28px) 안으로 들어온다.
    for (let i = 0; i < 40 && hostGs.teamScore[1] === 0; i++) {
      hostGs.thing[bravoFlagNum].holdingSprite = aliceNum
      hostGs.thing[alphaFlagNum].holdingSprite = 0
      hostGs.thing[alphaFlagNum].inBase = true
      hostGs.spriteParts.pos[aliceNum].x = alphaPos.x
      hostGs.spriteParts.pos[aliceNum].y = alphaPos.y
      hostGs.spriteParts.velocity[aliceNum].x = 0; hostGs.spriteParts.velocity[aliceNum].y = 0
      hostGs.sprite[aliceNum].moveSkeleton(alphaPos.x, alphaPos.y, true)
      aClient.tick(); bClient.tick(); host.tick(); await Promise.resolve()
    }

    expect(hostGs.teamScore[1]).toBeGreaterThan(0) // 호스트 진실: 캡처 성공

    // 최종 스냅샷이 전 클라에 수렴하도록 몇 틱 더.
    for (let i = 0; i < 8; i++) { aClient.tick(); bClient.tick(); host.tick(); await Promise.resolve() }

    expect(aGs.teamScore[1]).toBe(hostGs.teamScore[1]) // 양쪽 클라 모두 수렴
    expect(bGs.teamScore[1]).toBe(hostGs.teamScore[1])
    expect(Number.isNaN(aGs.teamScore[1])).toBe(false)

    // 팬텀 깃발 없음(설계 결정 4): 각 클라에 스타일별 활성 깃발이 정확히 1개(호스트 권위 슬롯)만.
    for (const gs of [aGs, bGs]) {
      expect(activeFlags(gs, OBJECT_ALPHA_FLAG)).toBe(1)
      expect(activeFlags(gs, OBJECT_BRAVO_FLAG)).toBe(1)
    }
  })
})
