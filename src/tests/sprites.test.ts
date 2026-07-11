import { describe, it, expect, beforeEach } from 'vitest'
import { setupTestGame } from './helpers'
import type { GameState } from '../core/state'
import { vector2, cloneVec2 } from '../core/vector'
import { distanceVec2 } from '../core/calc'
import { NUM_PARTICLES } from '../core/parts'
import { POLY_TYPE_NORMAL, MAX_SPAWNPOINTS } from '../core/polymap'
import {
  MAX_SPRITES,
  createSprite,
  createTPlayer,
  teamCollides,
  randomizeStart,
} from '../core/sprites'
import { TEAM_ALPHA, TEAM_NONE } from '../core/constants'

// 스폰포인트 하나 골라 스프라이트를 만들어주는 공통 셋업
function spawnAt(gs: GameState, team = TEAM_ALPHA): number {
  const player = createTPlayer()
  player.name = 'Test'
  player.team = team
  const r = randomizeStart(gs, team)
  return createSprite(gs, r.start, vector2(0, 0), 1, 255, player, true)
}

describe('createSprite (Sprites.pas:240-379)', () => {
  let gs: GameState
  beforeEach(() => {
    gs = setupTestGame()
  })

  it('activates the sprite at a spawnpoint with a live skeleton and Stand animations', () => {
    const i = spawnAt(gs)
    expect(i).toBe(1) // first free slot
    const spr = gs.sprite[i]
    expect(spr.active).toBe(true)
    expect(spr.deadMeat).toBe(false)
    expect(spr.num).toBe(i)

    // skeleton = GostekSkeleton copy → has active particles
    let activeParts = 0
    for (let p = 1; p <= NUM_PARTICLES; p++) if (spr.skeleton.active[p]) activeParts++
    expect(activeParts).toBeGreaterThan(0)
    expect(spr.skeleton.constraintCount).toBeGreaterThan(0)
    // CreateSprite: Skeleton := GostekSkeleton (full record copy) then VDamping := 0.9945
    expect(spr.skeleton.vDamping).toBeCloseTo(0.9945)
    expect(spr.skeleton.gravity).toBeCloseTo(1.06 * gs.grav)

    // BodyAnimation := Stand; LegsAnimation := Stand (record copy, not shared reference)
    expect(spr.legsAnimation.id).toBe(gs.anims.stand.id)
    expect(spr.legsAnimation).not.toBe(gs.anims.stand)
    expect(spr.bodyAnimation.id).toBe(gs.anims.stand.id)

    // health/jets from map + Game.pas globals
    expect(spr.health).toBe(gs.startHealth)
    expect(spr.jetsCount).toBe(gs.map.startJet)

    // SpriteParts.CreatePart(sPos, sVelocity=0, 1, i)
    expect(gs.spriteParts.active[i]).toBe(true)
    expect(Number.isNaN(gs.spriteParts.pos[i].x)).toBe(false)

    // MoveSkeleton(sPos.X, sPos.Y, False) moved the skeleton near the spawn position
    expect(Math.abs(spr.skeleton.pos[1].x - gs.spriteParts.pos[i].x)).toBeLessThan(100)
  })

  it('N=255 finds the first free slot; full array returns -1', () => {
    for (let k = 1; k <= MAX_SPRITES; k++) {
      const idx = spawnAt(gs)
      expect(idx).toBe(k)
    }
    const overflow = spawnAt(gs)
    expect(overflow).toBe(-1)
  })
})

describe('checkMapCollision (Sprites.pas:2573-2847)', () => {
  let gs: GameState
  beforeEach(() => {
    gs = setupTestGame()
  })

  // Pascal contract: returns True when Pos+Velocity is inside a colliding polygon, and applies a
  // position/velocity correction (Pos pushed out along the closest perpendicular, velocity damped).
  it('returns true inside terrain and applies a position correction', () => {
    const i = spawnAt(gs)
    const spr = gs.sprite[i]

    // find a NORMAL polygon and use its centroid as a guaranteed inside-terrain point
    let w = 0
    for (let j = 1; j <= gs.map.polyCount; j++) {
      if (gs.map.polyType[j] === POLY_TYPE_NORMAL) {
        w = j
        break
      }
    }
    expect(w).toBeGreaterThan(0)
    const poly = gs.map.polys[w]
    const cx = (poly.vertices[1].x + poly.vertices[2].x + poly.vertices[3].x) / 3
    const cy = (poly.vertices[1].y + poly.vertices[2].y + poly.vertices[3].y) / 3

    gs.spriteParts.pos[i] = vector2(cx, cy)
    gs.spriteParts.oldPos[i] = vector2(cx, cy)
    gs.spriteParts.velocity[i] = vector2(0, 0.1)
    gs.spriteParts.forces[i] = vector2(0, 0)
    const posBefore = cloneVec2(gs.spriteParts.pos[i])

    const collided = spr.checkMapCollision(cx, cy, 0)
    expect(collided).toBe(true)
    // Pascal contract (Area=0): a correction is applied — either Pos := Pos - Perp sticks
    // (wall-ish closest edge), or for a Stand sprite on a floor-ish edge (Step.y > SLIDELIMIT)
    // Pos is restored to OldPos while velocity is killed (STANDSURFACECOEF = 0) and gravity is
    // cancelled in Forces (Forces.Y -= GRAV). Either way the particle state must have changed.
    const moved =
      gs.spriteParts.pos[i].x !== posBefore.x || gs.spriteParts.pos[i].y !== posBefore.y
    const velocityChanged = gs.spriteParts.velocity[i].y !== 0.1
    const forcesChanged = gs.spriteParts.forces[i].y !== 0
    expect(moved || velocityChanged || forcesChanged).toBe(true)
    expect(Number.isNaN(gs.spriteParts.pos[i].x)).toBe(false)
    expect(Number.isNaN(gs.spriteParts.pos[i].y)).toBe(false)
  })

  it('returns false in open air', () => {
    const i = spawnAt(gs)
    const spr = gs.sprite[i]
    // spawnpoints are guaranteed open positions
    const p = gs.spriteParts.pos[i]
    gs.spriteParts.velocity[i] = vector2(0, 0)
    expect(spr.checkMapCollision(p.x, p.y, 0)).toBe(false)
  })
})

describe('respawn (Sprites.pas:3455-3775)', () => {
  it('puts the sprite at one of the team spawnpoints (within jitter), sane state', () => {
    const gs = setupTestGame()
    const i = spawnAt(gs, TEAM_ALPHA)
    const spr = gs.sprite[i]

    // move it far away, damage it, then respawn
    gs.spriteParts.pos[i] = vector2(0, 0)
    spr.health = 3
    spr.deadMeat = true
    spr.respawn()

    expect(spr.deadMeat).toBe(false)
    expect(spr.health).toBe(gs.startHealth)
    const pos = gs.spriteParts.pos[i]
    expect(Number.isNaN(pos.x)).toBe(false)
    expect(Number.isNaN(pos.y)).toBe(false)

    // within RandomizeStart jitter (X: -4..+4, Y: -4..0) of an active TEAM_ALPHA spawnpoint
    let nearest = Infinity
    for (let s = 1; s <= MAX_SPAWNPOINTS && s < gs.map.spawnpoints.length; s++) {
      const sp = gs.map.spawnpoints[s]
      if (sp.active && sp.team === TEAM_ALPHA) {
        nearest = Math.min(nearest, distanceVec2(pos, vector2(sp.x, sp.y)))
      }
    }
    expect(nearest).toBeLessThanOrEqual(Math.sqrt(4 * 4 + 4 * 4) + 1e-9)

    // map bounds
    const bound = gs.map.sectorsNum * gs.map.sectorsDivision
    expect(Math.abs(pos.x)).toBeLessThan(bound)
    expect(Math.abs(pos.y)).toBeLessThan(bound)

    // velocity/forces zeroed, controls freed, Stand applied
    expect(gs.spriteParts.velocity[i].x).toBe(0)
    expect(gs.spriteParts.velocity[i].y).toBe(0)
    expect(spr.control.left).toBe(false)
    expect(spr.control.mouseDist).toBe(150)
    expect(spr.legsAnimation.id).toBe(gs.anims.stand.id)
  })

  it('DM path: a solo (TEAM_NONE) player falls back over all active spawnpoints', () => {
    const gs = setupTestGame()
    // ctf_Ash has team 1/2 spawnpoints; randomizeStart(team=0) must still find something
    const r = randomizeStart(gs, TEAM_NONE)
    expect(Number.isNaN(r.start.x)).toBe(false)
    expect(r.start.x !== 0 || r.start.y !== 0).toBe(true)
  })
})

describe('moveSkeleton (Sprites.pas:2435-2461)', () => {
  it('translates all active particles by (x1,y1) and syncs OldPos', () => {
    const gs = setupTestGame()
    const i = spawnAt(gs)
    const spr = gs.sprite[i]

    const before: { p: number; x: number; y: number }[] = []
    for (let p = 1; p <= NUM_PARTICLES; p++) {
      if (spr.skeleton.active[p]) before.push({ p, x: spr.skeleton.pos[p].x, y: spr.skeleton.pos[p].y })
    }
    expect(before.length).toBeGreaterThan(0)

    spr.moveSkeleton(10, -5, false)
    for (const b of before) {
      expect(spr.skeleton.pos[b.p].x).toBeCloseTo(b.x + 10)
      expect(spr.skeleton.pos[b.p].y).toBeCloseTo(b.y - 5)
      expect(spr.skeleton.oldPos[b.p].x).toBeCloseTo(b.x + 10)
      expect(spr.skeleton.oldPos[b.p].y).toBeCloseTo(b.y - 5)
    }

    // FromZero=True sets every active particle to exactly (x1,y1)
    spr.moveSkeleton(7, 8, true)
    for (const b of before) {
      expect(spr.skeleton.pos[b.p].x).toBe(7)
      expect(spr.skeleton.pos[b.p].y).toBe(8)
    }
  })
})

describe('teamCollides (Sprites.pas:381-437)', () => {
  it('non-bullet: alpha player passes through POLY_TYPE_RED_BULLETS(10), bravo does not', () => {
    const gs = setupTestGame()
    // fabricate a poly type entry (map poly 1)
    gs.map.polyType[1] = 10 // POLY_TYPE_RED_BULLETS
    expect(teamCollides(gs.map, 1, TEAM_ALPHA, false)).toBe(false)
    gs.map.polyType[1] = 11 // POLY_TYPE_RED_PLAYER — collides only for alpha
    expect(teamCollides(gs.map, 1, TEAM_ALPHA, false)).toBe(true)
    expect(teamCollides(gs.map, 1, 2, false)).toBe(false)
    gs.map.polyType[1] = POLY_TYPE_NORMAL
    expect(teamCollides(gs.map, 1, TEAM_ALPHA, false)).toBe(true)
  })
})
