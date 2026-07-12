import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { setupTestGame } from './helpers'
import type { GameState } from '../core/state'
import { vector2, cloneVec2, vec2Length } from '../core/vector'
import { distanceVec2 } from '../core/calc'
import { NUM_PARTICLES } from '../core/parts'
import { POLY_TYPE_NORMAL, MAX_SPAWNPOINTS } from '../core/polymap'
import {
  MAX_SPRITES,
  MAX_BULLETS,
  NORMAL_DEATH,
  TSprite,
  createSprite,
  createTPlayer,
  teamCollides,
  randomizeStart,
} from '../core/sprites'
import {
  TEAM_ALPHA,
  TEAM_BRAVO,
  TEAM_NONE,
  GAMESTYLE_DEATHMATCH,
  MULTIKILLINTERVAL,
  BRUTALDEATHHEALTH,
  OBJECT_ALPHA_FLAG,
  OBJECT_AK74,
  OBJECT_PARACHUTE,
} from '../core/constants'
import {
  createWeapons,
  calculateBink,
  guns,
  AK74,
  COLT,
  EAGLE,
  M79,
  SPAS12,
  FRAGGRENADE,
  NOWEAPON_NUM,
  BULLET_STYLE_FRAGNADE,
} from '../core/weapons'
import { createThing } from '../core/things'

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

describe('combat 1부 — healthHit/die/kill/dropWeapon/applyWeaponByNum (Task 6)', () => {
  let gs: GameState
  beforeEach(() => {
    createWeapons(false)
    gs = setupTestGame()
  })

  // DM 전투 셋업: 솔로(TEAM_NONE) 2명 — friendly-fire 가드(IsNotSolo)가 걸리지 않는다.
  function spawnTwo(): [number, number] {
    return [spawnAt(gs, TEAM_NONE), spawnAt(gs, TEAM_NONE)]
  }

  it('healthHit: 대미지만큼 health 감소, 0 이하 → die + 클램프 (HealthHit 3250-3376)', () => {
    const [v, k] = spawnTwo()
    const victim = gs.sprite[v]
    expect(victim.health).toBe(gs.startHealth) // 150

    victim.healthHit(50, k, 1, -1, vector2(0, 0))
    expect(victim.health).toBe(100)
    expect(victim.deadMeat).toBe(false)

    victim.healthHit(4000, k, 1, -1, vector2(0, 0))
    expect(victim.deadMeat).toBe(true)
    // safety precaution: Health < BRUTALDEATHHEALTH-1 → Health := BRUTALDEATHHEALTH (3352-3353)
    expect(victim.health).toBe(BRUTALDEATHHEALTH)
    expect(victim.player!.deaths).toBe(1)
  })

  it('healthHit: Vest 흡수 — Vest -= Round(0.33*Amt), Health -= Round(0.25*Amt) (3288-3293)', () => {
    const [v, k] = spawnTwo()
    const victim = gs.sprite[v]
    victim.vest = 100
    victim.healthHit(60, k, 1, -1, vector2(0, 0))
    expect(victim.vest).toBe(100 - 20) // Round(0.33*60) = Round(19.8) = 20
    expect(victim.health).toBe(150 - 15) // Round(0.25*60) = 15
  })

  it('die: DM에서 who≠num이면 sprite[who].player.kills +1 + 멀티킬 (Die 1552-2318, DM 분기 1648)', () => {
    gs.svGamemode = GAMESTYLE_DEATHMATCH
    const [v, k] = spawnTwo()
    const victim = gs.sprite[v]

    victim.die(NORMAL_DEATH, k, 1, -1, vector2(0, 0))

    expect(gs.sprite[k].player!.kills).toBe(1)
    // 멀티킬 카운트는 {$IFDEF SERVER} 채택 (규약 8a)
    expect(gs.sprite[k].multiKills).toBe(1)
    expect(gs.sprite[k].multiKillTime).toBe(MULTIKILLINTERVAL)
    expect(victim.player!.deaths).toBe(1)
    expect(victim.deadMeat).toBe(true)
    // DM 리스폰 카운터 = sv_respawntime (1597-1599)
    expect(victim.respawnCounter).toBe(gs.svRespawntime)
  })

  it('die: 자살(who===num)은 kills 증가 없음, deaths는 항상 +1 (1601)', () => {
    gs.svGamemode = GAMESTYLE_DEATHMATCH
    const [v] = spawnTwo()
    const victim = gs.sprite[v]
    victim.die(NORMAL_DEATH, v, 1, -1, vector2(0, 0))
    expect(victim.player!.kills).toBe(0)
    expect(victim.player!.deaths).toBe(1)
    expect(victim.deadMeat).toBe(true)
  })

  it('die: 깃발 운반 중 사망 → HoldingSprite/HoldedThing 해제 (Die 2186-2191 + 2301)', () => {
    const v = spawnAt(gs, TEAM_ALPHA)
    const victim = gs.sprite[v]
    const f = createThing(gs, vector2(100, 100), 255, OBJECT_ALPHA_FLAG, 255)
    gs.thing[f].holdingSprite = v
    victim.holdedThing = f

    victim.die(NORMAL_DEATH, v, 1, -1, vector2(0, 0))

    expect(gs.thing[f].holdingSprite).toBe(0)
    expect(victim.holdedThing).toBe(0)
    expect(gs.thing[f].active).toBe(true) // 깃발 자체는 살아서 필드에 남는다
  })

  it('applyWeaponByNum: guns[] 깊은복사와 슬롯 규칙 (3200-3248)', () => {
    const [v] = spawnTwo()
    const spr = gs.sprite[v]

    spr.applyWeaponByNum(guns[AK74].num, 1)
    expect(spr.weapon.name).toBe(guns[AK74].name)
    expect(spr.weapon).not.toBe(guns[AK74]) // record 대입 = 깊은복사 (규약 3)
    // LastWeapon* 기록 (3236-3243)
    expect(spr.lastWeaponHM).toBe(guns[AK74].hitMultiply)
    spr.weapon.ammoCount = 1
    expect(guns[AK74].ammoCount).not.toBe(1) // guns[] 원본 오염 금지

    // Gun=2 → SecondaryWeapon 슬롯
    spr.applyWeaponByNum(guns[COLT].num, 2)
    expect(spr.secondaryWeapon.num).toBe(guns[COLT].num)

    // Ammo 인자는 슬롯과 무관하게 Weapon.AmmoCount에 적용 (3224-3225 원본 그대로)
    spr.applyWeaponByNum(guns[EAGLE].num, 1, 7)
    expect(spr.weapon.ammoCount).toBe(7)

    // RestorePrimaryState && Gun=2 → SecondaryWeapon := Weapon (3212-3215)
    spr.applyWeaponByNum(guns[AK74].num, 2, -1, true)
    expect(spr.secondaryWeapon.num).toBe(guns[EAGLE].num)
  })

  it('dropWeapon: Thing 생성 + Thing.ammoCount 이월 + 반환값=Thing 인덱스 (2320-2393)', () => {
    const [v] = spawnTwo()
    const spr = gs.sprite[v]
    spr.applyWeaponByNum(guns[AK74].num, 1)
    spr.weapon.ammoCount = 13

    const t = spr.dropWeapon()

    expect(t).toBeGreaterThan(0)
    expect(gs.thing[t].active).toBe(true)
    expect(gs.thing[t].style).toBe(OBJECT_AK74)
    expect(gs.thing[t].ammoCount).toBe(13)
    // 드롭 후 손은 NOWEAPON (2391)
    expect(spr.weapon.num).toBe(NOWEAPON_NUM)
  })

  it('kill: 스프라이트 비활성 + 깃발 해제 (Kill 1424-1490)', () => {
    const v = spawnAt(gs, TEAM_ALPHA)
    const spr = gs.sprite[v]
    const f = createThing(gs, vector2(100, 100), 255, OBJECT_ALPHA_FLAG, 255)
    gs.thing[f].holdingSprite = v
    spr.holdedThing = f

    spr.kill()

    expect(spr.active).toBe(false)
    expect(gs.spriteParts.active[v]).toBe(false)
    expect(gs.thing[f].holdingSprite).toBe(0)
    expect(spr.holdedThing).toBe(0)
  })

  it('parachute: 발밑 여유가 PARA_DISTANCE-10 초과면 낙하산 Thing 생성 (3785-3821)', () => {
    const gs2 = setupTestGame({ emptyMap: true }) // 폴리곤 0개 → 레이캐스트 미스
    const player = createTPlayer()
    player.name = 'P'
    player.team = TEAM_NONE
    const i = createSprite(gs2, vector2(0, -700), vector2(0, 0), 1, 255, player, true)
    const spr = gs2.sprite[i]

    spr.parachute(vector2(0, -700))

    expect(spr.holdedThing).toBeGreaterThan(0)
    expect(gs2.thing[spr.holdedThing].style).toBe(OBJECT_PARACHUTE)
    expect(gs2.thing[spr.holdedThing].holdingSprite).toBe(i)
  })

  it('changeTeam: 무기 드롭 + 팀 변경 + 리스폰 (3823-3972)', () => {
    const v = spawnAt(gs, TEAM_ALPHA)
    const spr = gs.sprite[v]
    spr.applyWeaponByNum(guns[AK74].num, 1)

    spr.changeTeam(TEAM_BRAVO)

    expect(spr.player!.team).toBe(TEAM_BRAVO)
    expect(spr.active).toBe(true)
    expect(spr.deadMeat).toBe(false)
    // DropWeapon 경유 — 이전 무기가 Thing으로 필드에 떨어져 있다
    expect(gs.thing.some((t) => t.active && t.style === OBJECT_AK74)).toBe(true)
  })
})

describe('combat 2부 — fire/throwGrenade/throwFlag/respawn 무기 (Task 7)', () => {
  let gs: GameState

  // randomizeStart(스폰 위치)의 Random() 을 결정적으로 만드는 시드 LCG (game.test.ts와 동일 패턴).
  // throwFlag 테스트가 스폰 지형에 의존(벽 근접 스폰이면 투척 레이캐스트가 막혀 flaky)하므로,
  // 그 테스트만 열린 스폰이 나오는 시드로 고정한다.
  const realRandom = Math.random
  let seed = 0
  function seedRandom(s: number): void {
    seed = s
    Math.random = () => {
      seed = (seed * 1103515245 + 12345) % 2147483648
      return seed / 2147483648
    }
  }

  beforeEach(() => {
    createWeapons(false)
    gs = setupTestGame()
  })

  afterEach(() => {
    Math.random = realRandom
  })

  // 전투 셋업: 스폰 + 발사 게이트(ceaseFire) 해제 + 오른쪽 조준
  function combatSpawn(team = TEAM_NONE): TSprite {
    const i = spawnAt(gs, team)
    const spr = gs.sprite[i]
    spr.ceaseFireCounter = -1
    spr.control.mouseAimX = Math.trunc(gs.spriteParts.pos[i].x) + 300
    spr.control.mouseAimY = Math.trunc(gs.spriteParts.pos[i].y)
    return spr
  }

  function activeBullets(): number[] {
    const list: number[] = []
    for (let i = 1; i <= MAX_BULLETS; i++) if (gs.bullet[i].active) list.push(i)
    return list
  }

  it('fire: control.fire 세팅 후 update → 탄환 생성, ammoCount 감소, fireIntervalCount 리셋 (Fire 3974-4597)', () => {
    const spr = combatSpawn()
    spr.applyWeaponByNum(guns[AK74].num, 1)
    spr.weapon.fireIntervalCount = 0
    const ammoBefore = spr.weapon.ammoCount
    spr.control.fire = true

    spr.update() // → controlSprite FIRE 블록 → fire()

    const bullets = activeBullets()
    expect(bullets.length).toBe(1)
    expect(spr.weapon.ammoCount).toBe(ammoBefore - 1)
    // Fire가 FireIntervalCount := FireInterval로 리셋(4233-4234)한 뒤, 같은 update 틱의
    // WEAPON HANDLING 블록(Sprites.pas:855-869)이 1 감소시킨다 (ControlSprite가 먼저 도는
    // 원본 순서 그대로)
    expect(spr.weapon.fireIntervalCount).toBe(spr.weapon.fireInterval - 1)
    expect(spr.fired).toBe(spr.weapon.fireStyle)

    const bn = bullets[0]
    expect(gs.bullet[bn].ownerWeapon).toBe(guns[AK74].num)
    expect(gs.bullet[bn].owner).toBe(spr.num)
    // 탄속: |v| = Weapon.Speed (spread는 방향에만 작용 — 정규화 후 스케일) + 관성(정지=0)
    const v = gs.bulletParts.velocity[bn]
    expect(vec2Length(v)).toBeCloseTo(guns[AK74].speed, 5)
    expect(v.x).toBeGreaterThan(0) // 오른쪽 조준
  })

  it('fire: bink — 인간 스프라이트 발사 후 hitSprayCounter에 자기 bink 누적 (4529-4546)', () => {
    const spr = combatSpawn()
    spr.applyWeaponByNum(guns[AK74].num, 1)
    spr.weapon.fireIntervalCount = 0
    // AK74 normal ini: Bink < 0 (음수 = 발사 시 자기 bink 누적)
    expect(guns[AK74].bink).toBeLessThan(0)
    gs.hitSprayCounter = 0
    spr.fire()
    // 서서 발사 → CalculateBink(HitSprayCounter, -Weapon.Bink)
    expect(gs.hitSprayCounter).toBe(calculateBink(0, -guns[AK74].bink))
  })

  it('fire: SPAS12(BulletStyle=SHOTGUN)는 1회 발사에 산탄 다수 생성', () => {
    const spr = combatSpawn()
    spr.applyWeaponByNum(guns[SPAS12].num, 1)
    spr.weapon.fireIntervalCount = 0
    const ammoBefore = spr.weapon.ammoCount
    const velBefore = cloneVec2(gs.spriteParts.velocity[spr.num])

    spr.fire()

    // 산탄 1+5 = 6발 (4149-4165)
    expect(activeBullets().length).toBe(6)
    expect(spr.weapon.ammoCount).toBe(ammoBefore - 1)
    // 반동: Velocity -= (b.x*0.0412, b.y*0.041) — 오른쪽 발사라 -x 반동 (4167-4169)
    expect(gs.spriteParts.velocity[spr.num].x).toBeLessThan(velBefore.x)
    // CanAutoReloadSpas := False (4230-4231)
    expect(spr.canAutoReloadSpas).toBe(false)
  })

  it('throwGrenade: tertiaryWeapon.ammoCount>0 → FRAGNADE 탄 생성+감소 (4698-4811)', () => {
    const spr = combatSpawn()
    expect(spr.tertiaryWeapon.num).toBe(guns[FRAGGRENADE].num) // createSprite 지급 (293)
    spr.tertiaryWeapon.ammoCount = 2

    // 던지기 시작: ThrowNade 눌림 → Throw 애니메이션
    spr.grenadeCanThrow = true
    spr.control.throwNade = true
    spr.throwGrenade()
    expect(spr.bodyAnimation.id).toBe(gs.anims.throw.id)

    // 홀드 최대 프레임(36) 도달 → 투척
    spr.bodyAnimation.currFrame = 36
    spr.throwGrenade()

    const bullets = activeBullets()
    expect(bullets.length).toBe(1)
    expect(gs.bullet[bullets[0]].style).toBe(BULLET_STYLE_FRAGNADE)
    expect(gs.bullet[bullets[0]].ownerWeapon).toBe(guns[FRAGGRENADE].num)
    expect(spr.tertiaryWeapon.ammoCount).toBe(1)
    expect(spr.grenadeCanThrow).toBe(false)
  })

  it('throwFlag: 운반 깃발 투척 — holdingSprite/holdedThing 해제 + flagGrabCooldown (4599-4696)', () => {
    // 시드 고정: 이 시드는 브라보 스폰이 우측(조준 방향)으로 열린 지형이라 투척 레이캐스트가 통과한다.
    seedRandom(12)
    const spr = combatSpawn(TEAM_BRAVO)
    const f = createThing(gs, cloneVec2(gs.spriteParts.pos[spr.num]), 255, OBJECT_ALPHA_FLAG, 255)
    gs.thing[f].holdingSprite = spr.num
    spr.holdedThing = f
    // 깃발 스켈레톤을 스프라이트 위치로 (투척 전 레이캐스트/충돌 검사 통과 위치)
    for (let j = 1; j <= 4; j++) {
      gs.thing[f].skeleton.pos[j] = cloneVec2(gs.spriteParts.pos[spr.num])
      gs.thing[f].skeleton.oldPos[j] = cloneVec2(gs.spriteParts.pos[spr.num])
    }

    spr.control.flagThrow = true
    spr.throwFlag()

    expect(gs.thing[f].holdingSprite).toBe(0)
    expect(spr.holdedThing).toBe(0)
    expect(spr.flagGrabCooldown).toBe(15) // SECOND div 4
    expect(gs.thing[f].staticType).toBe(false)
  })

  it('respawn: selWeapon 지급 + secWep 규칙 + M79 빈탄창 (Respawn 3580-3612)', () => {
    const spr = combatSpawn()
    spr.selWeapon = guns[M79].num // 7 (프라이머리는 index=num)
    spr.player!.secWep = 0 // SecWep := 0+1 → SecondaryWeapon = Guns[PRIMARY_WEAPONS+1] = COLT

    spr.respawn()

    expect(spr.weapon.num).toBe(guns[M79].num)
    expect(spr.weapon.ammoCount).toBe(0) // Weapons.pas:1354 Force M79 reload on spawn
    expect(spr.secondaryWeapon.num).toBe(guns[COLT].num)
    // TertiaryWeapon := Guns[FRAGGRENADE] + sv_maxgrenades div 2 (3548-3550)
    expect(spr.tertiaryWeapon.num).toBe(guns[FRAGGRENADE].num)
    expect(spr.tertiaryWeapon.ammoCount).toBe(Math.trunc(gs.svMaxgrenades / 2))
  })

  it('respawn: selWeapon=0이면 맨손(NOWEAPON) 유지 (3581)', () => {
    const spr = combatSpawn()
    spr.selWeapon = 0
    spr.applyWeaponByNum(guns[AK74].num, 1)
    spr.respawn()
    expect(spr.weapon.num).toBe(NOWEAPON_NUM)
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
