// Things.pas 포트(1부) 테스트 — 생성(스타일별 파라미터/스켈레톤 클론/중복 깃발 제거/무기 투척
// 임펄스), 물리(지면 안착 StaticType 동결), 깃발 캐리 부착, 타임아웃/경계 밖 처리, 리스폰,
// spawnBoxes(LastSpawn 회피), moveSkeleton.
import { describe, it, expect, beforeEach } from 'vitest'
import { setupTestGame } from './helpers'
import type { GameState } from '../core/state'
import { vector2, vec2Length, vec2Subtract } from '../core/vector'
import {
  TThing,
  createThing,
  thingCollision,
  spawnBoxes,
  randomizeStart,
} from '../core/things'
import { createWeapons, guns, NOWEAPON, EAGLE, FLAMER, M2, FRAGGRENADE, CLUSTERGRENADE } from '../core/weapons'
import { createSprite, createTPlayer, MAX_THINGS } from '../core/sprites'
import { MAX_BULLETS } from '../core/bullets'
import {
  GUN_RADIUS,
  OBJECT_ALPHA_FLAG,
  OBJECT_BRAVO_FLAG,
  OBJECT_DESERT_EAGLE,
  OBJECT_COMBAT_KNIFE,
  OBJECT_MEDICAL_KIT,
  OBJECT_GRENADE_KIT,
  OBJECT_FLAMER_KIT,
  OBJECT_PREDATOR_KIT,
  OBJECT_VEST_KIT,
  OBJECT_BERSERK_KIT,
  OBJECT_CLUSTER_KIT,
  OBJECT_STATIONARY_GUN,
  FLAG_TIMEOUT,
  FLAG_INTEREST_TIME,
  GUNRESISTTIME,
  KIT_RADIUS,
  TEAM_ALPHA,
  TEAM_BRAVO,
  BONUS_FLAMEGOD,
  BONUS_PREDATOR,
  BONUS_BERSERKER,
  FLAMERBONUSTIME,
  PREDATORBONUSTIME,
  BERSERKERBONUSTIME,
  PREDATORALPHA,
  DEFAULTVEST,
  CLUSTER_GRENADES,
  M2GUN_OVERHEAT,
} from '../core/constants'

// sprites.test.ts/bullets.test.ts와 동일한 스폰 헬퍼 (실제 맵 위 테스트용 — 씽 소유자).
function spawnAt(gs: GameState, team = TEAM_ALPHA): number {
  const player = createTPlayer()
  player.name = 'Test'
  player.team = team
  const r = randomizeStart(gs, team)
  return createSprite(gs, r.start, vector2(0, 0), 1, 255, player, true)
}

// ServerLoop.pas:309-311 틱 오더 그대로: 활성 씽만 Update (Verlet 적분은 TThing.Update 내부).
function runThings(gs: GameState, ticks: number): void {
  for (let t = 0; t < ticks; t++) {
    for (let j = 1; j <= MAX_THINGS; j++) {
      if (gs.thing[j].active) gs.thing[j].update()
    }
  }
}

beforeEach(() => createWeapons(false))

describe('createThing (Things.pas:72-554)', () => {
  let gs: GameState
  beforeEach(() => {
    gs = setupTestGame()
  })

  it('깃발: 스타일 파라미터(147-179) + FlagSkeleton 클론 + MoveSkeleton 오프셋', () => {
    const i = createThing(gs, vector2(100, 200), 255, OBJECT_ALPHA_FLAG, 255)
    expect(i).toBe(1)
    const t = gs.thing[i]
    expect(t).toBeInstanceOf(TThing)
    expect(t.active).toBe(true)
    expect(t.style).toBe(OBJECT_ALPHA_FLAG)
    expect(t.num).toBe(i)
    expect(t.holdingSprite).toBe(0)
    expect(t.owner).toBe(255)
    expect(t.radius).toBe(19)
    expect(t.timeOut).toBe(FLAG_TIMEOUT)
    expect(t.interest).toBe(FLAG_INTEREST_TIME)
    expect(t.inBase).toBe(true) // POINTMATCH가 아니므로 (162-163)
    expect(t.collideWithBullets).toBe(true) // svGamemode=3(CTF)이라 INF 예외 미적용 (177-178)
    expect(t.staticType).toBe(false)
    // 스켈레톤: FlagSkeleton 클론 + VDamping/Gravity (150-151)
    expect(t.skeleton.partCount).toBe(gs.flagSkeleton.partCount)
    expect(t.skeleton.partCount).toBeGreaterThan(0)
    expect(t.skeleton.vDamping).toBeCloseTo(0.991)
    expect(t.skeleton.gravity).toBeCloseTo(1.0 * gs.grav)
    expect(t.skeleton.timeStep).toBe(1)
    // ALPHA 깃발은 Pos[3]/[4].X = 12 절대 대입 후 MoveSkeleton(+100) (154-160, 515)
    expect(t.skeleton.pos[3].x).toBeCloseTo(12 + 100)
    expect(t.skeleton.pos[4].x).toBeCloseTo(12 + 100)
    expect(t.skeleton.oldPos[3].x).toBeCloseTo(t.skeleton.pos[3].x)
    expect(t.skeleton.pos[1].x).toBeCloseTo(gs.flagSkeleton.pos[1].x + 100)
    expect(t.skeleton.pos[1].y).toBeCloseTo(gs.flagSkeleton.pos[1].y + 200)
  })

  it('같은 스타일 깃발 재생성 시 기존 것 Kill (86-90)', () => {
    const i1 = createThing(gs, vector2(0, 0), 255, OBJECT_ALPHA_FLAG, 255)
    const i2 = createThing(gs, vector2(50, 50), 255, OBJECT_ALPHA_FLAG, 255)
    // 기존 깃발이 Kill되어 슬롯이 비므로 같은 슬롯을 재사용한다
    expect(i2).toBe(i1)
    let count = 0
    for (let k = 1; k <= MAX_THINGS; k++) {
      if (gs.thing[k].active && gs.thing[k].style === OBJECT_ALPHA_FLAG) count++
    }
    expect(count).toBe(1)
    // BRAVO 깃발은 별개 스타일이라 공존
    const i3 = createThing(gs, vector2(0, 0), 255, OBJECT_BRAVO_FLAG, 255)
    expect(i3).not.toBe(i2)
    expect(gs.thing[i2].active).toBe(true)
  })

  it('무기 드롭(Deagle): 파라미터(194-206) + sv_guns_collide=False → CollideWithBullets=false', () => {
    const owner = spawnAt(gs)
    const i = createThing(gs, vector2(0, 0), owner, OBJECT_DESERT_EAGLE, 255)
    const t = gs.thing[i]
    expect(t.radius).toBe(GUN_RADIUS)
    expect(t.timeOut).toBe(GUNRESISTTIME)
    expect(t.interest).toBe(0)
    expect(t.collideWithBullets).toBe(false) // sv_guns_collide Value=False (Cvar.pas:973)
    expect(t.skeleton.vDamping).toBeCloseTo(0.996)
    expect(t.skeleton.gravity).toBeCloseTo(1.09 * gs.grav)
  })

  it('키트: BoxSkeleton record 대입(전체 복사) + KIT_RADIUS (343-355)', () => {
    const i = createThing(gs, vector2(0, 0), 255, OBJECT_MEDICAL_KIT, 255)
    const t = gs.thing[i]
    expect(t.radius).toBe(KIT_RADIUS)
    expect(t.timeOut).toBe(gs.svRespawntime * GUNRESISTTIME) // 360 * 1200 (349)
    expect(t.skeleton.partCount).toBe(gs.boxSkeleton.partCount)
    expect(t.skeleton.vDamping).toBeCloseTo(0.989)
    expect(t.skeleton.gravity).toBeCloseTo(1.05 * gs.grav)
  })

  it('무기 투척 임펄스 (517-547 {$IFDEF SERVER} 채택): 소유자 속도 + 조준 방향 반영', () => {
    const owner = spawnAt(gs)
    const spr = gs.sprite[owner]
    gs.spriteParts.velocity[owner] = vector2(5, 0)
    // 조준을 오른쪽 멀리로 — GetCursorAimDirection ≈ (1, ~0)
    spr.control.mouseAimX = spr.skeleton.pos[15].x + 1000
    spr.control.mouseAimY = spr.skeleton.pos[15].y
    const b = spr.getCursorAimDirection()

    const base = createThing(gs, vector2(0, 0), 255, OBJECT_DESERT_EAGLE, 255)
    const basePos1 = { ...gs.thing[base].skeleton.pos[1] }
    const basePos2 = { ...gs.thing[base].skeleton.pos[2] }
    gs.thing[base].kill()

    const i = createThing(gs, vector2(0, 0), owner, OBJECT_DESERT_EAGLE, 255)
    const t = gs.thing[i]
    // Pos[1] += Velocity + 0.01*b, Pos[2] += Velocity + 3*b (DeadMeat=false: 534-535)
    expect(t.skeleton.pos[1].x).toBeCloseTo(basePos1.x + 5 + 0.01 * b.x, 4)
    expect(t.skeleton.pos[1].y).toBeCloseTo(basePos1.y + 0 + 0.01 * b.y, 4)
    expect(t.skeleton.pos[2].x).toBeCloseTo(basePos2.x + 5 + 3 * b.x, 4)
    expect(t.skeleton.pos[2].y).toBeCloseTo(basePos2.y + 0 + 3 * b.y, 4)
  })

  it('풀 포화 시 -1 (101-107)', () => {
    for (let k = 1; k <= MAX_THINGS; k++) gs.thing[k].active = true
    expect(createThing(gs, vector2(0, 0), 255, OBJECT_DESERT_EAGLE, 255)).toBe(-1)
  })
})

describe('TThing.update — 물리/안착/캐리 (Things.pas:665-1033)', () => {
  let gs: GameState
  beforeEach(() => {
    gs = setupTestGame()
  })

  it('createThing(깃발): 공중 스폰 → N틱 후 지면 안착·StaticType 동결 (Update 665-747)', () => {
    // ctf_Ash의 ALPHA 깃발 스폰포인트(team=5) 위 50px에 생성 → 낙하 후 안착
    // (200px 위는 ctf_Ash 지형(윗층 플랫폼) 안에 박히므로 50px — 실측으로 자유낙하가 보장되는 높이)
    const spIdx = gs.map.flagSpawn[1]
    expect(spIdx).toBeGreaterThan(0)
    const sp = gs.map.spawnpoints[spIdx]
    const i = createThing(gs, vector2(sp.x, sp.y - 50), 255, OBJECT_ALPHA_FLAG, 255)
    const t = gs.thing[i]
    const startY = t.skeleton.pos[1].y

    runThings(gs, 300)

    expect(Number.isFinite(t.skeleton.pos[1].y)).toBe(true)
    expect(t.skeleton.pos[1].y).toBeGreaterThan(startY) // 낙하했다 (y는 아래로 증가)
    expect(t.staticType).toBe(true) // 이동 델타 < MINMOVEDELTA로 동결 (742-747)
    // 동결 직후 OldPos[1..4] := Pos[1..4] (1031-1032)
    for (let k = 1; k <= 4; k++) {
      expect(t.skeleton.oldPos[k]).toEqual(t.skeleton.pos[k])
    }
    // 스폰포인트 근방(BASE_RADIUS=75) → InBase 유지 + TeamFlag 등록 (775-798)
    expect(t.inBase).toBe(true)
    expect(gs.teamFlag[OBJECT_ALPHA_FLAG]).toBe(i)
  })

  it('깃발 캐리 부착 (750-767): Pos[1]=스프라이트 Pos[8], HoldedThing 역링크, TimeOut 갱신', () => {
    const holder = spawnAt(gs)
    const i = createThing(gs, vector2(gs.spriteParts.pos[holder].x, gs.spriteParts.pos[holder].y), 255, OBJECT_BRAVO_FLAG, 255)
    const t = gs.thing[i]
    t.holdingSprite = holder
    t.timeOut = 10

    t.update()

    expect(t.skeleton.pos[1].x).toBeCloseTo(gs.sprite[holder].skeleton.pos[8].x)
    expect(t.skeleton.pos[1].y).toBeCloseTo(gs.sprite[holder].skeleton.pos[8].y)
    expect(t.skeleton.pos[1]).not.toBe(gs.sprite[holder].skeleton.pos[8]) // 별칭 아님 (record 복사)
    expect(gs.sprite[holder].holdedThing).toBe(i)
    expect(t.timeOut).toBe(FLAG_TIMEOUT - 1) // 대입(760) 후 카운트다운(1006)
    expect(t.interest).toBe(FLAG_INTEREST_TIME)
  })

  it('무기 드롭 타임아웃 → Kill (1005-1027)', () => {
    const i = createThing(gs, vector2(0, 0), 255, OBJECT_COMBAT_KNIFE, 255)
    const t = gs.thing[i]
    t.timeOut = 3
    runThings(gs, 3)
    expect(t.active).toBe(false)
    expect(t.skeleton.active[1]).toBe(false) // Kill이 Skeleton.Destroy 호출 (1458)
  })

  it('깃발 타임아웃 → Respawn (홀더 없음, 1014-1018 서버 분기)', () => {
    const i = createThing(gs, vector2(0, 0), 255, OBJECT_ALPHA_FLAG, 255)
    const t = gs.thing[i]
    t.timeOut = 1
    t.update()
    expect(t.active).toBe(true) // respawn → createThing 재생성
    expect(t.timeOut).toBe(FLAG_TIMEOUT)
    // ALPHA 깃발은 team=5 스폰포인트 근방으로 (Respawn 1541 + RandomizeStart ±4/±4 지터)
    const sp = gs.map.spawnpoints[gs.map.flagSpawn[1]]
    expect(Math.abs(t.skeleton.pos[1].x - sp.x)).toBeLessThan(40)
    expect(Math.abs(t.skeleton.pos[1].y - sp.y)).toBeLessThan(40)
  })
})

describe('TThing.checkOutOfBounds / kill / moveSkeleton (Things.pas:1450-1600)', () => {
  let gs: GameState
  beforeEach(() => {
    gs = setupTestGame()
  })

  it('무기 씽 경계 밖 → Kill (1496-1502)', () => {
    const i = createThing(gs, vector2(0, 0), 255, OBJECT_DESERT_EAGLE, 255)
    const t = gs.thing[i]
    const bound = gs.map.sectorsNum * gs.map.sectorsDivision - 10
    t.moveSkeleton(bound + 100, 0, true)
    t.checkOutOfBounds()
    expect(t.active).toBe(false)
  })

  it('깃발 경계 밖 → Respawn (1484-1494; 클라 전용 Kill은 미채택 — 서버는 리스폰만)', () => {
    const i = createThing(gs, vector2(0, 0), 255, OBJECT_ALPHA_FLAG, 255)
    const t = gs.thing[i]
    const bound = gs.map.sectorsNum * gs.map.sectorsDivision - 10
    t.moveSkeleton(bound + 100, 0, true)
    t.checkOutOfBounds()
    expect(t.active).toBe(true)
    expect(Math.abs(t.skeleton.pos[1].x)).toBeLessThan(bound)
  })

  it('moveSkeleton: FromZero=true는 절대 이동, false는 상대 이동 (1574-1600)', () => {
    const i = createThing(gs, vector2(10, 20), 255, OBJECT_DESERT_EAGLE, 255)
    const t = gs.thing[i]
    t.moveSkeleton(50, 60, true)
    for (let k = 1; k <= t.skeleton.partCount; k++) {
      if (t.skeleton.active[k]) {
        expect(t.skeleton.pos[k]).toEqual(vector2(50, 60))
        expect(t.skeleton.oldPos[k]).toEqual(vector2(50, 60))
      }
    }
    t.moveSkeleton(5, -5, false)
    expect(t.skeleton.pos[1]).toEqual(vector2(55, 55))
  })

  it('kill: num<=0 가드 (1456-1457)', () => {
    const t = new TThing(gs, 0)
    t.active = true
    t.kill() // num=0 → skip
    expect(t.active).toBe(true)
  })
})

describe('spawnBoxes / thingCollision (Things.pas:556-618)', () => {
  let gs: GameState
  beforeEach(() => {
    gs = setupTestGame()
  })

  it('thingCollision: 필드 세팅 (556-560)', () => {
    expect(thingCollision(7, 123)).toEqual({ thingNum: 7, cooldownEnd: 123 })
  })

  it('spawnBoxes: LastSpawn 스폰포인트 회피 + LastSpawn 갱신 (581-617)', () => {
    const num = createThing(gs, vector2(0, 0), 255, OBJECT_MEDICAL_KIT, 255)
    const t = gs.thing[num]
    expect(t.lastSpawn).toBe(0)
    // ctf_Ash의 team=1(알파 플레이어) 스폰포인트는 2개 이상 — 연속 호출은 직전 스폰을 제외한다
    const r1 = spawnBoxes(gs, TEAM_ALPHA, num)
    expect(r1.result).toBe(true)
    const first = t.lastSpawn
    expect(first).toBeGreaterThan(0)
    const r2 = spawnBoxes(gs, TEAM_ALPHA, num)
    expect(r2.result).toBe(true)
    expect(t.lastSpawn).not.toBe(first)
  })

  it('spawnBoxes: 요청 팀 스폰이 없으면 result=false + 전체 활성 스폰 폴백 (592-609)', () => {
    const num = createThing(gs, vector2(0, 0), 255, OBJECT_MEDICAL_KIT, 255)
    const r = spawnBoxes(gs, 99, num)
    expect(r.result).toBe(false)
    // 폴백 스폰포인트 근방 좌표가 나온다 (RandomizeStart와 동일한 ±4/±4 지터)
    let near = false
    for (let k = 1; k < gs.map.spawnpoints.length; k++) {
      const sp = gs.map.spawnpoints[k]
      if (sp.active && vec2Length(vec2Subtract(vector2(sp.x, sp.y), r.start)) < 12) near = true
    }
    expect(near).toBe(true)
  })
})

/* ****************************************************************************
 *   T9: CheckSpriteCollision — 픽업/깃발 (Things.pas:1602-2145 {$IFDEF SERVER})
 **************************************************************************** */

describe('checkSpriteCollision — 픽업·깃발 (Things.pas:1602-2145)', () => {
  let gs: GameState

  // 특정 좌표에 스프라이트 스폰 (씽 픽업 판정은 SpriteParts.Pos / Skeleton.Pos[8]을 읽는다).
  function spawnSpriteAt(gs2: GameState, x: number, y: number, team = TEAM_ALPHA): number {
    const player = createTPlayer()
    player.name = 'Test'
    player.team = team
    const n = createSprite(gs2, vector2(x, y), vector2(0, 0), 1, 255, player, true)
    gs2.sprite[n].ceaseFireCounter = 0 // 스폰 무적 해제 (선정 게이트 1658, 키트 게이트 2007 등)
    return n
  }

  beforeEach(() => {
    gs = setupTestGame()
  })

  it('무기 픽업: 맨손 스프라이트가 반경 내 → applyWeaponByNum + thing.ammoCount 복원 (1895-1927)', () => {
    const s = spawnSpriteAt(gs, 100, 100)
    const spr = gs.sprite[s]
    spr.applyWeaponByNum(guns[NOWEAPON].num, 1) // 맨손
    expect(spr.weapon.num).toBe(guns[NOWEAPON].num)

    const p = gs.spriteParts.pos[s]
    const ti = createThing(gs, vector2(p.x, p.y), 255, OBJECT_DESERT_EAGLE, 255)
    const t = gs.thing[ti]
    t.ammoCount = 3 // DropWeapon이 저장했던 잔탄
    t.timeOut = 0 // < GUNRESISTTIME - 30 (직후 재픽업 방지 게이트 통과)

    const r = t.checkSpriteCollision()
    expect(r).toBe(s)
    // OBJECT_DESERT_EAGLE(5) - (OBJECT_NUM_FLAGS+1) = 1 → WeaponNumToIndex(1) = EAGLE
    expect(spr.weapon.num).toBe(guns[EAGLE].num)
    expect(spr.weapon.ammoCount).toBe(3)
    expect(spr.weapon.fireIntervalPrev).toBe(spr.weapon.fireInterval)
    expect(spr.weapon.fireIntervalCount).toBe(spr.weapon.fireInterval)
    expect(t.active).toBe(false) // 픽업된 무기는 Kill (1721-1722)
  })

  it('무기 픽업 게이트: TimeOut >= GUNRESISTTIME-30 (갓 떨어진 무기)는 못 집는다 (1673)', () => {
    const s = spawnSpriteAt(gs, 100, 100)
    const spr = gs.sprite[s]
    spr.applyWeaponByNum(guns[NOWEAPON].num, 1)

    const p = gs.spriteParts.pos[s]
    const ti = createThing(gs, vector2(p.x, p.y), 255, OBJECT_DESERT_EAGLE, 255)
    const t = gs.thing[ti]
    t.ammoCount = 3 // createThing이 timeOut = GUNRESISTTIME 세팅 (게이트에 걸린다)

    const r = t.checkSpriteCollision()
    expect(r).toBe(s) // 충돌 자체는 성립 (Result := j)
    expect(spr.weapon.num).toBe(guns[NOWEAPON].num) // 하지만 픽업은 안 됨
    expect(t.active).toBe(true)
  })

  it('메디킷: health<150일 때만 픽업, health=150 복구 + respawn (1971-1990)', () => {
    const s = spawnSpriteAt(gs, 100, 100)
    const spr = gs.sprite[s]
    spr.health = 50

    const p = gs.spriteParts.pos[s]
    const ti = createThing(gs, vector2(p.x, p.y), 255, OBJECT_MEDICAL_KIT, 255)
    const t = gs.thing[ti]

    const r = t.checkSpriteCollision()
    expect(r).toBe(s)
    expect(spr.health).toBe(gs.startHealth) // 150 정확 복구
    expect(spr.hasPack).toBe(true) // sv_healthcooldown 기본 2 > 0 (1978-1980)
    expect(t.active).toBe(true) // Kill 후 case에서 Respawn — 재생성돼 살아있다 (1719/1983)
    expect(t.team).toBe(TEAM_ALPHA) // Team := Sprite[j].Player.Team (1976)
  })

  it('메디킷: 풀피 스프라이트는 최근접 선정에서 제외 → 미픽업 (1653)', () => {
    const s = spawnSpriteAt(gs, 100, 100)
    const spr = gs.sprite[s]
    expect(spr.health).toBe(gs.startHealth)

    const p = gs.spriteParts.pos[s]
    const ti = createThing(gs, vector2(p.x, p.y), 255, OBJECT_MEDICAL_KIT, 255)
    const t = gs.thing[ti]

    const r = t.checkSpriteCollision()
    expect(r).toBe(-1) // 후보 자체가 없다
    expect(t.active).toBe(true)
    expect(spr.hasPack).toBe(false)
  })

  it('CTF 캡처: 적 깃발 소지자가 자기 베이스(자팀 깃발 InBase) 도달 → teamScore+1, player.flags+1, 깃발 리스폰 (812-938, 알파 833/브라보 885)', () => {
    // ctf_Ash의 실제 깃발 스폰포인트 사용
    const aSpawn = gs.map.spawnpoints[gs.map.flagSpawn[1]]
    const bSpawn = gs.map.spawnpoints[gs.map.flagSpawn[2]]
    const f1 = createThing(gs, vector2(aSpawn.x, aSpawn.y), 255, OBJECT_ALPHA_FLAG, 255)
    const f2 = createThing(gs, vector2(bSpawn.x, bSpawn.y), 255, OBJECT_BRAVO_FLAG, 255)
    expect(gs.thing[f1].inBase).toBe(true) // POINTMATCH가 아닌 깃발은 생성 시 InBase (162-163)

    // 알파 팀 캐리어가 브라보 깃발을 든 채 알파 베이스에 서 있다
    const s = spawnSpriteAt(gs, aSpawn.x, aSpawn.y, TEAM_ALPHA)
    gs.thing[f2].holdingSprite = s

    gs.thing[f2].update() // 캐리 부착(750-767) → 터치다운 판정(812-938)

    expect(gs.teamScore[1]).toBe(1)
    expect(gs.sprite[s].player!.flags).toBe(1)
    // 캡처된 깃발은 Respawn — 소지 해제 + 브라보 베이스로 복귀 (930)
    const t2 = gs.thing[f2]
    expect(t2.active).toBe(true)
    expect(t2.holdingSprite).toBe(0)
    expect(gs.sprite[s].holdedThing).toBe(0)
    expect(
      vec2Length(vec2Subtract(t2.skeleton.pos[1], vector2(bSpawn.x, bSpawn.y))),
    ).toBeLessThan(20) // RandomizeStart(±4/±4 지터) 근방
  })

  it('깃발 그랩: flagGrabCooldown 준수 (1726-1893, 1744)', () => {
    const bSpawn = gs.map.spawnpoints[gs.map.flagSpawn[2]]
    const f2 = createThing(gs, vector2(bSpawn.x, bSpawn.y), 255, OBJECT_BRAVO_FLAG, 255)
    const t = gs.thing[f2]

    // 알파 팀 스프라이트가 브라보 깃발 위에 서 있다
    const s = spawnSpriteAt(gs, bSpawn.x, bSpawn.y, TEAM_ALPHA)
    gs.sprite[s].flagGrabCooldown = 10

    let r = t.checkSpriteCollision()
    expect(r).toBe(s) // 충돌은 성립하지만
    expect(t.holdingSprite).toBe(0) // 쿨다운 중 그랩 불가 (1744)
    expect(t.timeOut).toBe(FLAG_TIMEOUT) // 그랩 전 공통 블록은 실행 (1740-1742)

    gs.sprite[s].flagGrabCooldown = 0
    r = t.checkSpriteCollision()
    expect(r).toBe(s)
    expect(t.holdingSprite).toBe(s) // 그랩 성공 (1749)
    expect(t.staticType).toBe(false)
  })

  it('CTF 자팀 깃발 반환: 베이스 밖 자기 깃발 터치 → Respawn (1812-1836)', () => {
    const bSpawn = gs.map.spawnpoints[gs.map.flagSpawn[2]]
    // 브라보 깃발이 베이스 밖(멀리)에 떨어져 있다
    const f2 = createThing(gs, vector2(bSpawn.x + 300, bSpawn.y), 255, OBJECT_BRAVO_FLAG, 255)
    const t = gs.thing[f2]
    t.inBase = false

    const s = spawnSpriteAt(gs, bSpawn.x + 300, bSpawn.y, TEAM_BRAVO)
    const r = t.checkSpriteCollision()
    expect(r).toBe(s)
    expect(t.holdingSprite).toBe(0) // 자팀 깃발은 들지 않고 즉시 반환
    expect(vec2Length(vec2Subtract(t.skeleton.pos[1], vector2(bSpawn.x, bSpawn.y)))).toBeLessThan(20)
  })

  it('수류탄킷: TertiaryWeapon = 프라그 sv_maxgrenades발 + respawn (1993-2006)', () => {
    const s = spawnSpriteAt(gs, 100, 100)
    const spr = gs.sprite[s]
    expect(spr.tertiaryWeapon.ammoCount).toBeLessThan(gs.svMaxgrenades + 1)
    spr.tertiaryWeapon.ammoCount = 0

    const p = gs.spriteParts.pos[s]
    const ti = createThing(gs, vector2(p.x, p.y), 255, OBJECT_GRENADE_KIT, 255)
    const t = gs.thing[ti]

    const r = t.checkSpriteCollision()
    expect(r).toBe(s)
    expect(spr.tertiaryWeapon.num).toBe(guns[FRAGGRENADE].num)
    expect(spr.tertiaryWeapon.ammoCount).toBe(gs.svMaxgrenades)
    expect(t.active).toBe(true) // Respawn (2002)
  })

  it('보너스 키트 4종: flamer/predator/berserker/cluster 정확값 (2008-2106)', () => {
    // flamer: 주무기 → 2번 슬롯 스택 + FLAMER 장착 + BonusTime/Style + 풀피
    let s = spawnSpriteAt(gs, 100, 100)
    let spr = gs.sprite[s]
    spr.health = 90
    let p = gs.spriteParts.pos[s]
    let ti = createThing(gs, vector2(p.x, p.y), 255, OBJECT_FLAMER_KIT, 255)
    expect(gs.thing[ti].checkSpriteCollision()).toBe(s)
    expect(spr.weapon.num).toBe(guns[FLAMER].num)
    expect(spr.bonusStyle).toBe(BONUS_FLAMEGOD)
    expect(spr.bonusTime).toBe(FLAMERBONUSTIME) // 600
    expect(spr.health).toBe(gs.startHealth)
    expect(gs.thing[ti].active).toBe(false) // 보너스킷은 Kill만 (Respawn 없음)
    spr.kill()

    // predator: Alpha=PREDATORALPHA + BonusTime/Style + 풀피
    s = spawnSpriteAt(gs, 200, 100)
    spr = gs.sprite[s]
    spr.health = 90
    p = gs.spriteParts.pos[s]
    ti = createThing(gs, vector2(p.x, p.y), 255, OBJECT_PREDATOR_KIT, 255)
    expect(gs.thing[ti].checkSpriteCollision()).toBe(s)
    expect(spr.alpha).toBe(PREDATORALPHA) // 5
    expect(spr.bonusStyle).toBe(BONUS_PREDATOR)
    expect(spr.bonusTime).toBe(PREDATORBONUSTIME) // 1500
    expect(spr.health).toBe(gs.startHealth)
    spr.kill()

    // berserker
    s = spawnSpriteAt(gs, 300, 100)
    spr = gs.sprite[s]
    spr.health = 90
    p = gs.spriteParts.pos[s]
    ti = createThing(gs, vector2(p.x, p.y), 255, OBJECT_BERSERK_KIT, 255)
    expect(gs.thing[ti].checkSpriteCollision()).toBe(s)
    expect(spr.bonusStyle).toBe(BONUS_BERSERKER)
    expect(spr.bonusTime).toBe(BERSERKERBONUSTIME) // 900
    expect(spr.health).toBe(gs.startHealth)
    spr.kill()

    // cluster: TertiaryWeapon = 클러스터 CLUSTER_GRENADES발
    s = spawnSpriteAt(gs, 400, 100)
    spr = gs.sprite[s]
    p = gs.spriteParts.pos[s]
    ti = createThing(gs, vector2(p.x, p.y), 255, OBJECT_CLUSTER_KIT, 255)
    expect(gs.thing[ti].checkSpriteCollision()).toBe(s)
    expect(spr.tertiaryWeapon.num).toBe(guns[CLUSTERGRENADE].num)
    expect(spr.tertiaryWeapon.ammoCount).toBe(CLUSTER_GRENADES) // 3
  })

  it('베스트킷: Vest = DEFAULTVEST (2069-2081)', () => {
    const s = spawnSpriteAt(gs, 100, 100)
    const spr = gs.sprite[s]
    expect(spr.vest).toBe(0)
    const p = gs.spriteParts.pos[s]
    const ti = createThing(gs, vector2(p.x, p.y), 255, OBJECT_VEST_KIT, 255)
    expect(gs.thing[ti].checkSpriteCollision()).toBe(s)
    expect(spr.vest).toBe(DEFAULTVEST) // 100
    expect(gs.thing[ti].active).toBe(false)
  })
})

/* ****************************************************************************
 * T9: CheckStationaryGunCollision — 고정포 (Things.pas:2147-2310)
 **************************************************************************** */

describe('checkStationaryGunCollision — 고정포 (Things.pas:2147-2310)', () => {
  let gs: GameState

  function spawnSpriteAt(gs2: GameState, x: number, y: number): number {
    const player = createTPlayer()
    player.name = 'Gunner'
    player.team = TEAM_ALPHA
    const n = createSprite(gs2, vector2(x, y), vector2(0, 0), 1, 255, player, true)
    gs2.sprite[n].ceaseFireCounter = 0
    return n
  }

  beforeEach(() => {
    gs = setupTestGame()
  })

  it('마운트: Stand 스프라이트가 반경 내 → Stat=Num + StaticType (2264-2295)', () => {
    const s = spawnSpriteAt(gs, 100, 100)
    const p = gs.spriteParts.pos[s]
    const ti = createThing(gs, vector2(p.x, p.y), 255, OBJECT_STATIONARY_GUN, 255)
    const t = gs.thing[ti]
    expect(t.timeOut).toBe(60)
    expect(t.checkStationaryGunCollision()).toBe(-1) // TimeOut > 0 → Exit (2158-2159)

    t.timeOut = 0
    const r = t.checkStationaryGunCollision()
    expect(r).toBe(s)
    expect(gs.sprite[s].stat).toBe(t.num)
    expect(t.staticType).toBe(true)
  })

  it('발사: 마운트 상태 + Fire + Stand + FireInterval 틱 → M2 탄환 생성 + UseTime 증가 (2204-2253)', () => {
    const s = spawnSpriteAt(gs, 100, 100)
    const spr = gs.sprite[s]
    const p = gs.spriteParts.pos[s]
    const ti = createThing(gs, vector2(p.x, p.y), 255, OBJECT_STATIONARY_GUN, 255)
    const t = gs.thing[ti]
    t.timeOut = 0
    t.checkStationaryGunCollision() // 마운트
    expect(spr.stat).toBe(t.num)

    spr.control.fire = true
    spr.control.mouseAimX = Math.round(p.x + 200)
    spr.control.mouseAimY = Math.round(p.y)
    gs.mainTickCounter = guns[M2].fireInterval * 10 // mod FireInterval = 0

    const before: boolean[] = []
    for (let i = 1; i <= MAX_BULLETS; i++) before[i] = gs.bullet[i].active
    const r = t.checkStationaryGunCollision()
    expect(r).toBe(-1) // 발사 경로는 Result 대입 전에 Exit (2253)
    let created = 0
    for (let i = 1; i <= MAX_BULLETS; i++) {
      if (gs.bullet[i].active && !before[i]) created++
    }
    expect(created).toBe(1)
    expect(spr.useTime).toBe(1) // Inc(UseTime) (2252)
  })

  it('과열: UseTime > M2GUN_OVERHEAT → 발사 안 됨 (2209-2216)', () => {
    const s = spawnSpriteAt(gs, 100, 100)
    const spr = gs.sprite[s]
    const p = gs.spriteParts.pos[s]
    const ti = createThing(gs, vector2(p.x, p.y), 255, OBJECT_STATIONARY_GUN, 255)
    const t = gs.thing[ti]
    t.timeOut = 0
    t.checkStationaryGunCollision()

    spr.control.fire = true
    spr.useTime = M2GUN_OVERHEAT + 1
    gs.mainTickCounter = guns[M2].fireInterval * 10

    const before: boolean[] = []
    for (let i = 1; i <= MAX_BULLETS; i++) before[i] = gs.bullet[i].active
    t.checkStationaryGunCollision()
    let created = 0
    for (let i = 1; i <= MAX_BULLETS; i++) {
      if (gs.bullet[i].active && !before[i]) created++
    }
    expect(created).toBe(0)
    expect(spr.useTime).toBe(M2GUN_OVERHEAT + 1) // 증가 없음
  })
})
