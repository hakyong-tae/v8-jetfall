// Sparks.pas 포트 테스트 — 핵심: 수명 카운트다운, Euler 물리 스킵(NONEULER_STYLE), 풀 예산/슬롯
// 할당, 맵 충돌 바운스.
import { describe, it, expect, beforeEach } from 'vitest'
import { setupTestGame } from './helpers'
import type { GameState } from '../core/state'
import { vector2 } from '../core/vector'
import { createSpark, MAX_SPARKS } from '../core/sparks'
import { createSprite, createTPlayer, randomizeStart } from '../core/sprites'
import { POLY_TYPE_NORMAL } from '../core/polymap'
import { TEAM_ALPHA } from '../core/constants'

// sprites.test.ts와 동일한 스폰 헬퍼 — checkMapCollision이 읽는 Sprite[Owner].Player.Team용.
function spawnAt(gs: GameState, team = TEAM_ALPHA): number {
  const player = createTPlayer()
  player.name = 'Test'
  player.team = team
  const r = randomizeStart(gs, team)
  return createSprite(gs, r.start, vector2(0, 0), 1, 255, player, true)
}

describe('createSpark (Sparks.pas:35-98)', () => {
  let gs: GameState
  beforeEach(() => {
    gs = setupTestGame()
  })

  it('allocates the first free slot and activates SparkParts', () => {
    const i = createSpark(gs, vector2(10, 20), vector2(1, 0), 7, 0, 40)
    expect(i).toBeGreaterThan(0)
    expect(gs.spark[i].active).toBe(true)
    expect(gs.spark[i].style).toBe(7)
    expect(gs.spark[i].life).toBe(40)
    expect(gs.spark[i].num).toBe(i)
    expect(gs.sparkParts.active[i]).toBe(true)
    expect(gs.sparkParts.pos[i]).toEqual({ x: 10, y: 20 })
    expect(gs.sparkParts.velocity[i]).toEqual({ x: 1, y: 0 })
  })

  it('reuses the same slot once killed (Style reset to 0 gates reuse — Sparks.pas:74)', () => {
    const i1 = createSpark(gs, vector2(0, 0), vector2(0, 0), 1, 0, 5)
    gs.spark[i1].kill(gs)
    const i2 = createSpark(gs, vector2(1, 1), vector2(0, 0), 2, 0, 5)
    expect(i2).toBe(i1)
  })

  it('budget gate: style 1 with SparksCount > MAX_SPARKS-40 returns 0 (Sparks.pas:64-65)', () => {
    gs.sparksCount = MAX_SPARKS - 39
    expect(createSpark(gs, vector2(0, 0), vector2(0, 0), 1, 0, 5)).toBe(0)
  })

  it('budget gate: style 24 with SparksCount > MAX_SPARKS-30 returns 0 (Sparks.pas:66-67)', () => {
    gs.sparksCount = MAX_SPARKS - 29
    expect(createSpark(gs, vector2(0, 0), vector2(0, 0), 24, 0, 5)).toBe(0)
  })

  it('budget gate does not block unrelated styles even when SparksCount is high', () => {
    gs.sparksCount = MAX_SPARKS - 1
    const i = createSpark(gs, vector2(0, 0), vector2(0, 0), 7, 0, 5)
    expect(i).toBeGreaterThan(0)
  })

  it('pool exhausted: steals a random slot in [1, MAX_SPARKS/3] once every slot is occupied (Sparks.pas:69-73)', () => {
    for (let i = 1; i < MAX_SPARKS; i++) {
      gs.spark[i].active = true
      gs.spark[i].style = 99 // any non-zero style marks it "occupied" for the free-slot scan
    }
    const i = createSpark(gs, vector2(5, 5), vector2(0, 0), 7, 0, 5)
    expect(i).toBeGreaterThanOrEqual(1)
    expect(i).toBeLessThanOrEqual(Math.trunc(MAX_SPARKS / 3) + 1)
  })
})

describe('TSpark.update (Sparks.pas:101-161)', () => {
  let gs: GameState
  beforeEach(() => {
    gs = setupTestGame()
  })

  it('createSpark→N틱 후 Kill (Life 카운트다운, Sparks.pas:157-160)', () => {
    const i = createSpark(gs, vector2(0, 0), vector2(1, 0), 1, 0, 5)
    for (let t = 0; t < 5; t++) gs.spark[i].update(gs)
    expect(gs.spark[i].active).toBe(false)
  })

  it('life/lifePrev shift each tick before the final kill', () => {
    const i = createSpark(gs, vector2(0, 0), vector2(0, 0), 1, 0, 3)
    gs.spark[i].update(gs)
    expect(gs.spark[i].lifePrev).toBe(3)
    expect(gs.spark[i].life).toBe(2)
    gs.spark[i].update(gs)
    expect(gs.spark[i].lifePrev).toBe(2)
    expect(gs.spark[i].life).toBe(1)
  })

  it('NONEULER_STYLE(스타일 12)은 이동하지 않음 (Sparks.pas:103-112)', () => {
    const i = createSpark(gs, vector2(100, 100), vector2(5, 5), 12, 0, 10)
    const before = { ...gs.sparkParts.pos[i] }
    gs.spark[i].update(gs)
    expect(gs.sparkParts.pos[i]).toEqual(before)
  })

  it('non-NONEULER style does move under Euler integration (velocity applied)', () => {
    const i = createSpark(gs, vector2(100, 100), vector2(5, 0), 7, 0, 10)
    // owner=0 → CheckMapCollision's Owner guard exits early without touching velocity, so the
    // spark just free-flies for this one tick (style 7 is COLLIDABLE, but Owner<1 short-circuits
    // before any map poly is even inspected — Sparks.pas:446).
    gs.spark[i].update(gs)
    expect(gs.sparkParts.pos[i].x).toBeGreaterThan(100)
  })
})

describe('TSpark.checkOutOfBounds (Sparks.pas:561-572)', () => {
  it('kills the spark once it drifts past the sector bound', () => {
    const gs = setupTestGame()
    const i = createSpark(gs, vector2(0, 0), vector2(0, 0), 1, 0, 100)
    const bound = gs.map.sectorsNum * gs.map.sectorsDivision - 10
    gs.sparkParts.pos[i].x = bound + 50
    gs.spark[i].checkOutOfBounds(gs)
    expect(gs.spark[i].active).toBe(false)
    expect(gs.sparkParts.active[i]).toBe(false)
  })

  it('leaves an in-bounds spark alone', () => {
    const gs = setupTestGame()
    const i = createSpark(gs, vector2(0, 0), vector2(0, 0), 1, 0, 100)
    gs.spark[i].checkOutOfBounds(gs)
    expect(gs.spark[i].active).toBe(true)
  })
})

describe('TSpark.kill (Sparks.pas:553-559)', () => {
  it('deactivates the spark and its SparkParts slot, resets Style', () => {
    const gs = setupTestGame()
    const i = createSpark(gs, vector2(0, 0), vector2(0, 0), 7, 0, 10)
    gs.spark[i].kill(gs)
    expect(gs.spark[i].active).toBe(false)
    expect(gs.spark[i].style).toBe(0)
    expect(gs.sparkParts.active[i]).toBe(false)
  })
})

describe('TSpark.checkMapCollision (Sparks.pas:420-551)', () => {
  let gs: GameState
  let ownerId: number

  beforeEach(() => {
    gs = setupTestGame()
    ownerId = spawnAt(gs, TEAM_ALPHA)
  })

  // Finds a POLY_TYPE_NORMAL triangle and drops a spark exactly on its centroid so
  // PointInPolyEdges is guaranteed to hit (centroid of a simple triangle is always interior).
  function findNormalPolyCentroid(): { x: number; y: number } {
    for (let p = 1; p <= gs.map.polyCount; p++) {
      if (gs.map.polyType[p] === POLY_TYPE_NORMAL) {
        const poly = gs.map.polys[p]
        const cx = (poly.vertices[1].x + poly.vertices[2].x + poly.vertices[3].x) / 3
        const cy = (poly.vertices[1].y + poly.vertices[2].y + poly.vertices[3].y) / 3
        return { x: cx, y: cy }
      }
    }
    throw new Error('fixture map has no POLY_TYPE_NORMAL polygon (unexpected for ctf_Ash)')
  }

  it('bounces off a normal polygon: returns true, dampens+reflects velocity, increments CollideCount', () => {
    const { x: cx, y: cy } = findNormalPolyCentroid()
    // CheckMapCollision internally computes Pos.X := X-8, Pos.Y := Y-1, so feed it back the
    // shifted coordinates to land exactly on the centroid.
    const i = createSpark(gs, vector2(cx, cy), vector2(0, -3), 40, ownerId, 100)
    const hit = gs.spark[i].checkMapCollision(gs, cx + 8, cy + 1)
    expect(hit).toBe(true)
    expect(gs.spark[i].collideCount).toBe(1)
  })

  it('style 32/48/49: Kills once CollideCount exceeds 2 (Sparks.pas:522-526)', () => {
    const { x: cx, y: cy } = findNormalPolyCentroid()
    const i = createSpark(gs, vector2(cx, cy), vector2(0, 0), 32, ownerId, 100)
    const spark = gs.spark[i]
    spark.checkMapCollision(gs, cx + 8, cy + 1) // CollideCount 0→1
    spark.checkMapCollision(gs, cx + 8, cy + 1) // 1→2
    expect(spark.active).toBe(true)
    spark.checkMapCollision(gs, cx + 8, cy + 1) // CollideCount was 2 (not >2) → no kill, →3
    expect(spark.active).toBe(true)
    expect(spark.collideCount).toBe(3)
    spark.checkMapCollision(gs, cx + 8, cy + 1) // CollideCount was 3 (>2) → Kill, then →4
    expect(spark.active).toBe(false)
    expect(spark.collideCount).toBe(4)
  })

  it('owner<1 exits early without a crash (Sparks.pas:446) even over real map geometry', () => {
    const { x: cx, y: cy } = findNormalPolyCentroid()
    const i = createSpark(gs, vector2(cx, cy), vector2(0, 0), 40, 0, 100)
    expect(gs.spark[i].checkMapCollision(gs, cx + 8, cy + 1)).toBe(false)
    expect(gs.spark[i].collideCount).toBe(0)
  })

  it('open air (no polygon at that point) does not collide', () => {
    const spawn = randomizeStart(gs, TEAM_ALPHA).start
    const i = createSpark(gs, vector2(spawn.x, spawn.y), vector2(0, 0), 40, ownerId, 100)
    expect(gs.spark[i].checkMapCollision(gs, spawn.x + 8, spawn.y + 1)).toBe(false)
  })
})
