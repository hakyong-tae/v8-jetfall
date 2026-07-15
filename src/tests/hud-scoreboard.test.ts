// src/tests/hud-scoreboard.test.ts — M5: Tab 스코어보드 데이터 집계(buildScoreboardRows)만 검증.
// PIXI 렌더(Hud.showScoreboard)는 캔버스가 필요해 이 파일(Node)에선 다루지 않는다 — 렌더에서
// 분리한 순수 함수(hud.ts)만 테스트 대상(스펙 §검증 "렌더 무관 순수 함수로 팩터링 권장").
import { describe, it, expect } from 'vitest'
import { buildScoreboardRows } from '../web/hud'
import { setupTestGame } from './helpers'
import { vector2 } from '../core/vector'
import { createSprite, createTPlayer, randomizeStart } from '../core/sprites'
import { TEAM_ALPHA, TEAM_BRAVO, TEAM_NONE } from '../core/constants'

function spawn(gs: ReturnType<typeof setupTestGame>, team: number, name: string): number {
  const player = createTPlayer()
  player.name = name
  player.team = team
  const r = randomizeStart(gs, team)
  const num = createSprite(gs, r.start, vector2(0, 0), 1, 255, player, true)
  gs.sprite[num].respawn()
  return num
}

describe('buildScoreboardRows (M5 Tab scoreboard)', () => {
  it('lists only active sprites with a player, ignoring inactive slots', () => {
    const gs = setupTestGame({ emptyMap: true })
    spawn(gs, TEAM_NONE, 'Alice')
    const rows = buildScoreboardRows(gs)
    expect(rows).toHaveLength(1)
    expect(rows[0].name).toBe('Alice')
  })

  it('sorts rows by kills descending (DM)', () => {
    const gs = setupTestGame({ emptyMap: true })
    const a = spawn(gs, TEAM_NONE, 'Low')
    const b = spawn(gs, TEAM_NONE, 'High')
    const c = spawn(gs, TEAM_NONE, 'Mid')
    gs.sprite[a].player!.kills = 2
    gs.sprite[b].player!.kills = 9
    gs.sprite[c].player!.kills = 5

    const rows = buildScoreboardRows(gs)
    expect(rows.map((r) => r.name)).toEqual(['High', 'Mid', 'Low'])
    expect(rows.map((r) => r.kills)).toEqual([9, 5, 2])
  })

  it('CTF rows carry team + caps (player.flags) alongside kills/deaths', () => {
    const gs = setupTestGame({ emptyMap: true })
    const alpha = spawn(gs, TEAM_ALPHA, 'Runner')
    const bravo = spawn(gs, TEAM_BRAVO, 'Defender')
    gs.sprite[alpha].player!.kills = 3
    gs.sprite[alpha].player!.deaths = 1
    gs.sprite[alpha].player!.flags = 2 // Things.pas capture scoring — player.flags += 1 per capture
    gs.sprite[bravo].player!.kills = 1
    gs.sprite[bravo].player!.deaths = 4
    gs.sprite[bravo].player!.flags = 0

    const rows = buildScoreboardRows(gs)
    const runner = rows.find((r) => r.name === 'Runner')!
    const defender = rows.find((r) => r.name === 'Defender')!
    expect(runner.team).toBe(TEAM_ALPHA)
    expect(runner.caps).toBe(2)
    expect(runner.deaths).toBe(1)
    expect(defender.team).toBe(TEAM_BRAVO)
    expect(defender.caps).toBe(0)
    expect(rows[0].name).toBe('Runner') // kills desc: 3 > 1
  })

  it('falls back to "#<num>" for an unnamed player', () => {
    const gs = setupTestGame({ emptyMap: true })
    const num = spawn(gs, TEAM_NONE, '')
    const rows = buildScoreboardRows(gs)
    expect(rows[0].name).toBe(`#${num}`)
  })
})
