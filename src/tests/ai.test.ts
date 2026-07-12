import { describe, it, expect, beforeAll } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import { setupTestGame } from './helpers'
import {
  checkDistance,
  controlBot,
  DIST_TOO_CLOSE,
  DIST_ROCK_THROW,
  DIST_TOO_FAR,
} from '../core/ai'
import {
  TWaypoints,
  loadWaypoints,
  zeroWaypoint,
  type TWaypoint,
} from '../core/waypoints'
import {
  createSprite,
  createTPlayer,
  addBotPlayer,
  BOT,
  HUMAN,
  type BotConfigEntry,
} from '../core/sprites'
import { createWeapons, guns, AK74, weaponNameToNum } from '../core/weapons'
import { vector2 } from '../core/vector'
import { GAMESTYLE_DEATHMATCH, TEAM_NONE, TEAM_ALPHA } from '../core/constants'
import type { GameState } from '../core/state'

const assetsDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../public/assets')
const bots: Record<string, BotConfigEntry> = JSON.parse(
  readFileSync(path.join(assetsDir, 'bots.json'), 'utf-8'),
)

function wp(x: number, y: number): TWaypoint {
  const w = zeroWaypoint()
  w.active = true
  w.x = x
  w.y = y
  return w
}

// 빈 맵에 스프라이트 하나를 지정 좌표로 생성 (createSprite가 moveSkeleton으로 스켈레톤도 배치).
function makeSprite(gs: GameState, method: number, team: number, x: number, y: number): number {
  const p = createTPlayer()
  p.controlMethod = method
  p.team = team
  p.name = method === BOT ? 'Bot' : 'Enemy'
  return createSprite(gs, vector2(x, y), vector2(0, 0), 1, 255, p, true)
}

describe('ai (AI.pas + Waypoints.pas)', () => {
  beforeAll(() => createWeapons(false))

  it('findClosest: 반경 내 "첫 번째" 웨이포인트 반환 — 최근접 아님 (Waypoints.pas:42-60)', () => {
    const bp = new TWaypoints()
    // waypoint[1]=(100,0), waypoint[2]=(10,0) — 2가 더 가깝지만 첫-매치(1)를 돌려줘야 한다.
    loadWaypoints(bp, [wp(100, 0), wp(10, 0)])
    expect(bp.findClosest(0, 0, 200, 0)).toBe(1)
    // 반경 밖이면 0
    expect(bp.findClosest(0, 0, 5, 0)).toBe(0)
    // currWaypoint 제외: currWaypoint=1이면 1을 건너뛰고 2를 반환
    expect(bp.findClosest(0, 0, 200, 1)).toBe(2)
  })

  it('checkDistance 거리 브래킷 (AI.pas:41-69, 경계값 17-27)', () => {
    expect(checkDistance(0, 30)).toBe(DIST_TOO_CLOSE) // |30| ≤ 35
    expect(checkDistance(0, 100)).toBe(DIST_ROCK_THROW) // 95 < 100 ≤ 180
    expect(checkDistance(0, 600)).toBe(DIST_TOO_FAR) // 500 < 600 ≤ 730
  })

  it('controlBot: 빈 맵에서 우측 적 발견 → control.fire + mouseAim이 타깃 방향 (SimpleDecision 71-456)', () => {
    const gs = setupTestGame({ emptyMap: true })
    gs.svGamemode = GAMESTYLE_DEATHMATCH // 비팀전 (팀전이면 TEAM_NONE끼리 아군 처리되어 미교전)

    const bot = makeSprite(gs, BOT, TEAM_NONE, 0, 0)
    const enemy = makeSprite(gs, HUMAN, TEAM_NONE, 80, 0) // 우측 DIST_CLOSE(≤95) 범위
    gs.sprite[bot].applyWeaponByNum(guns[AK74].num, 1) // speed>0 + 탄약 지급

    controlBot(gs, gs.sprite[bot])

    expect(gs.sprite[bot].brain.targetNum).toBe(enemy)
    expect(gs.sprite[bot].control.fire).toBe(true)
    // 타깃이 오른쪽 → mouseAimX가 봇 X(0)보다 크다 (조준이 타깃 쪽)
    expect(gs.sprite[bot].control.mouseAimX).toBeGreaterThan(0)
    expect(Number.isFinite(gs.sprite[bot].control.mouseAimY)).toBe(true)
  })

  it('controlBot: 적 없으면 웨이포인트 내비게이션 활성 (ctf_Ash, 652-862)', () => {
    const gs = setupTestGame() // ctf_Ash — 실제 웨이포인트 그래프 로드됨
    expect(gs.botPath.count).toBeGreaterThan(0) // 브리지가 웨이포인트를 채웠는지

    const bot = addBotPlayer(gs, bots['Admiral'], TEAM_ALPHA)
    expect(bot).toBeGreaterThan(0)

    // 적이 없으므로 seeClosest=false → 웨이포인트 탐색. 봇은 스폰 반경(350) 내 웨이포인트를
    // 찾아 currentWaypoint를 잡고 그 방향 컨트롤을 적용한다.
    controlBot(gs, gs.sprite[bot])

    expect(gs.sprite[bot].brain.currentWaypoint).toBeGreaterThan(0)
    // 적용된 이동 컨트롤은 nextWaypoint의 방향 플래그와 일치해야 한다.
    const nextWp = gs.botPath.at(gs.sprite[bot].brain.nextWaypoint)
    expect(gs.sprite[bot].control.left).toBe(nextWp.left)
    expect(gs.sprite[bot].control.right).toBe(nextWp.right)
  })

  it('addBotPlayer: bots.json 항목 → brain/player 적재 + 스폰 (SharedConfig 133-220, Server 925)', () => {
    const gs = setupTestGame()
    const p = addBotPlayer(gs, bots['Admiral'], TEAM_ALPHA)

    expect(p).toBeGreaterThan(0)
    const spr = gs.sprite[p]
    expect(spr.active).toBe(true)
    expect(spr.player!.controlMethod).toBe(BOT)
    expect(spr.player!.name).toBe('Admiral')
    expect(spr.player!.team).toBe(TEAM_ALPHA)
    expect(spr.brain.favWeapon).toBe(weaponNameToNum('FN Minimi'))
    expect(spr.brain.accuracy).toBe(70) // trunc(70 * botsDifficulty(100)/100)
    expect(spr.health).toBe(gs.startHealth) // respawn 완료
  })
})
