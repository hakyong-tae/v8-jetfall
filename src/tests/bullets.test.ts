// Bullets.pas 포트(1부) 테스트 — 슬롯 할당/생성 초기화(규약 9 포함), 거리 감쇠(손계산 정합),
// 타임아웃 스타일 분기, 맵 충돌(벽 킬/수류탄 바운스), 경계 밖 킬.
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { setupTestGame } from './helpers'
import type { GameState } from '../core/state'
import { vector2 } from '../core/vector'
import {
  TBullet,
  createBullet,
  serverCreateBullet,
  HIT_TYPE_WALL,
  HIT_TYPE_FRAGNADE,
  MAX_BULLETS,
} from '../core/bullets'
import {
  guns,
  createWeapons,
  EAGLE,
  M79,
  FRAGGRENADE,
  BOW,
  FLAMER,
  THROWNKNIFE,
  BULLET_STYLE_PLAIN,
  BULLET_STYLE_FRAGNADE,
} from '../core/weapons'
import { createSprite, createTPlayer, randomizeStart, MAX_SPRITES } from '../core/sprites'
import { POLY_TYPE_NORMAL } from '../core/polymap'
import { TEAM_ALPHA, TEAM_NONE, BULLET_TIMEOUT, GRENADE_TIMEOUT } from '../core/constants'

// sprites.test.ts/sparks.test.ts와 동일한 스폰 헬퍼 (실제 맵 위 테스트용 — 탄환 소유자).
function spawnAt(gs: GameState, team = TEAM_ALPHA): number {
  const player = createTPlayer()
  player.name = 'Test'
  player.team = team
  const r = randomizeStart(gs, team)
  return createSprite(gs, r.start, vector2(0, 0), 1, 255, player, true)
}

// 빈 맵 테스트용 최소 소유자 — CreateBullet이 읽는 건 Player.ControlMethod와 BulletCount뿐이고
// (발사억제 블록은 규약 8b로 주석 처리됨), 빈 맵에선 TeamCollides 경로도 타지 않는다.
function stubOwner(gs: GameState, i = 1): number {
  gs.sprite[i].player = createTPlayer()
  return i
}

// ServerLoop.pas:303-306 틱 오더 그대로: 활성 탄환 Update → BulletParts.DoEulerTimeStep.
function run(gs: GameState, ticks: number): void {
  for (let t = 0; t < ticks; t++) {
    for (let j = 1; j <= MAX_BULLETS; j++) {
      if (gs.bullet[j].active) gs.bullet[j].update()
    }
    gs.bulletParts.doEulerTimeStep()
  }
}

beforeEach(() => createWeapons(false))

describe('createBullet / serverCreateBullet (Bullets.pas:94-379)', () => {
  let gs: GameState
  beforeEach(() => {
    gs = setupTestGame({ emptyMap: true })
    stubOwner(gs)
  })

  it('createBullet: N=255 → 빈 슬롯 스캔, timeout=guns[idx].timeout, 스타일/초기위치 세팅', () => {
    const i = serverCreateBullet(gs, vector2(5, 7), vector2(1, 0), guns[EAGLE].num, 1, 255, 1.0)
    expect(i).toBe(1)
    const b = gs.bullet[i]
    expect(b).toBeInstanceOf(TBullet)
    expect(b.active).toBe(true)
    expect(b.style).toBe(BULLET_STYLE_PLAIN)
    expect(b.num).toBe(i)
    expect(b.owner).toBe(1)
    expect(b.ownerWeapon).toBe(guns[EAGLE].num)
    expect(b.timeOut).toBe(BULLET_TIMEOUT) // guns[EAGLE].timeout = 420
    expect(b.initial).toEqual(vector2(5, 7))
    expect(gs.bulletParts.active[i]).toBe(true)
    expect(gs.bulletParts.pos[i]).toEqual(vector2(5, 7))
    expect(gs.bulletParts.velocity[i]).toEqual(vector2(1, 0))

    // 다음 생성은 다음 빈 슬롯으로
    const j = serverCreateBullet(gs, vector2(0, 0), vector2(1, 0), guns[EAGLE].num, 1, 255, 1.0)
    expect(j).toBe(2)
  })

  it('규약 9: TimeOutPrev/HitMultiplyPrev/DegradeCount는 서버 경로에서도 무조건 초기화 (원본 165-171/199-203 {$IFNDEF SERVER} 버그)', () => {
    const i = serverCreateBullet(gs, vector2(0, 0), vector2(1, 0), guns[EAGLE].num, 1, 255, 2.0)
    const b = gs.bullet[i]
    expect(b.timeOutPrev).toBe(BULLET_TIMEOUT)
    expect(b.hitMultiply).toBeCloseTo(2.0)
    expect(b.hitMultiplyPrev).toBeCloseTo(2.0)
    expect(b.degradeCount).toBe(0)
  })

  it('serverCreateBullet: DontCheat/OwnerPingTick 세팅 + 소유자 범위 가드 (359-379)', () => {
    const i = serverCreateBullet(gs, vector2(0, 0), vector2(1, 0), guns[EAGLE].num, 1, 255, 1.0)
    expect(gs.bullet[i].dontCheat).toBe(true)
    expect(gs.bullet[i].ownerPingTick).toBe(0)
    expect(gs.bullet[i].seed).toBe(0) // ServerCreateBullet은 Seed=0 고정 (369)

    // 원본 가드 그대로: sOwner <= 0 또는 >= MAX_SPRITES(32) → -1 (32번도 거부 — 원본 보존)
    expect(serverCreateBullet(gs, vector2(0, 0), vector2(1, 0), guns[EAGLE].num, 0, 255, 1.0)).toBe(-1)
    expect(serverCreateBullet(gs, vector2(0, 0), vector2(1, 0), guns[EAGLE].num, MAX_SPRITES, 255, 1.0)).toBe(-1)
  })

  it('풀 포화: 슬롯이 전부 활성이면 -1 (134-146)', () => {
    for (let k = 1; k <= MAX_BULLETS; k++) gs.bullet[k].active = true
    expect(createBullet(gs, vector2(0, 0), vector2(1, 0), guns[EAGLE].num, 1, 255, 1.0, false, true, 0)).toBe(-1)
    expect(serverCreateBullet(gs, vector2(0, 0), vector2(1, 0), guns[EAGLE].num, 1, 255, 1.0)).toBe(-1)
  })
})

describe('TBullet.update — 거리 감쇠/타임아웃 (Bullets.pas:529-737)', () => {
  let gs: GameState
  beforeEach(() => {
    gs = setupTestGame({ emptyMap: true })
    stubOwner(gs)
    // 계획서 손계산 전제: 등속 직선 운동 (중력 0, 감쇠 없음) — 파라미터만 테스트용으로 중화.
    gs.bulletParts.gravity = 0
    gs.bulletParts.eDamping = 1
  })

  it('거리 감쇠: 500px 초과 시 ×0.5, 900px 초과 시 ×0.25 (Bullets.pas:637-665)', () => {
    // 빈 맵(폴리곤 0개), 중력 0, 속도 (20,0), 초기 hitMultiply 2.0, EAGLE 탄(=BARRETT/M79/KNIFE/LAW 제외 대상)
    // BULLET_TIMEOUT=420이 6의 배수이므로 timeOut%6===0 ⇔ 틱%6===0
    // 틱30: dist>500 → hitMultiply=1.0 · 틱48: dist>900 → 0.5
    const i = serverCreateBullet(gs, vector2(0, 0), vector2(20, 0), guns[EAGLE].num, 1, 255, 2.0)
    run(gs, 30)
    expect(gs.bullet[i].hitMultiply).toBeCloseTo(1.0)
    run(gs, 18)
    expect(gs.bullet[i].hitMultiply).toBeCloseTo(0.5)
    // degradeCount 2단계에서 정지 — 이후 더 감쇠하지 않는다
    run(gs, 60)
    expect(gs.bullet[i].hitMultiply).toBeCloseTo(0.5)
    expect(gs.bullet[i].degradeCount).toBe(2)
  })

  it('감쇠 제외 무기(M79 등)는 거리와 무관하게 hitMultiply 유지 (640-643)', () => {
    const i = serverCreateBullet(gs, vector2(0, 0), vector2(20, 0), guns[M79].num, 1, 255, 2.0)
    run(gs, 30)
    expect(gs.bullet[i].hitMultiply).toBeCloseTo(2.0)
    expect(gs.bullet[i].degradeCount).toBe(0)
  })

  it('FRAGNADE 타임아웃 시 ExplosionHit 경로 (610-635)', () => {
    const i = serverCreateBullet(gs, vector2(0, 0), vector2(0, 0), guns[FRAGGRENADE].num, 1, 255, 1.0)
    const b = gs.bullet[i]
    expect(b.style).toBe(BULLET_STYLE_FRAGNADE)
    expect(b.timeOut).toBe(GRENADE_TIMEOUT) // 180
    const hitSpy = vi.spyOn(b, 'hit')
    run(gs, GRENADE_TIMEOUT - 1)
    expect(b.active).toBe(true)
    run(gs, 1) // timeOut 0 도달 → Hit(HIT_TYPE_FRAGNADE) + Kill
    expect(hitSpy).toHaveBeenCalledWith(HIT_TYPE_FRAGNADE)
    expect(b.active).toBe(false)
    expect(gs.bulletParts.active[i]).toBe(false)
  })

  it('PLAIN 타임아웃은 Hit 없이 Kill (614-618)', () => {
    const i = serverCreateBullet(gs, vector2(0, 0), vector2(0, 0), guns[EAGLE].num, 1, 255, 1.0)
    const b = gs.bullet[i]
    const hitSpy = vi.spyOn(b, 'hit')
    run(gs, BULLET_TIMEOUT)
    expect(b.active).toBe(false)
    expect(hitSpy).not.toHaveBeenCalled()
  })

  it('checkOutOfBounds: 섹터 경계 밖으로 나가면 Kill (2685-2700)', () => {
    const i = serverCreateBullet(gs, vector2(0, 0), vector2(0, 0), guns[EAGLE].num, 1, 255, 1.0)
    const bound = gs.map.sectorsNum * gs.map.sectorsDivision - 10
    gs.bulletParts.pos[i] = vector2(bound + 1, 0)
    gs.bullet[i].checkOutOfBounds()
    expect(gs.bullet[i].active).toBe(false)
  })
})

describe('TBullet.checkMapCollision (Bullets.pas:1073-1359) — 실제 맵', () => {
  let gs: GameState
  let ownerId: number
  beforeEach(() => {
    gs = setupTestGame()
    ownerId = spawnAt(gs)
  })

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

  it('PLAIN 탄: HitSpot에서 50px 이내 벽 충돌 → 리코셰 없이 Kill + Hit(HIT_TYPE_WALL)', () => {
    const { x: cx, y: cy } = findNormalPolyCentroid()
    const i = serverCreateBullet(gs, vector2(cx, cy), vector2(1, 0), guns[EAGLE].num, ownerId, 255, 1.0)
    const b = gs.bullet[i]
    b.hitSpot = vector2(cx, cy) // D = |Pos-Velocity-HitSpot| = 1 < 50 → 리코셰 대신 Kill
    const hitSpy = vi.spyOn(b, 'hit')
    b.checkMapCollision(cx, cy)
    expect(b.active).toBe(false)
    expect(hitSpy).toHaveBeenCalledWith(HIT_TYPE_WALL)
    expect(b.ricochetCount).toBe(0)
  })

  it('PLAIN 탄: HitSpot에서 50px 초과 벽 충돌 → 리코셰 (RicochetCount 증가, 속도 반사 혼합)', () => {
    const { x: cx, y: cy } = findNormalPolyCentroid()
    const i = serverCreateBullet(gs, vector2(cx, cy), vector2(1, 0), guns[EAGLE].num, ownerId, 255, 1.0)
    const b = gs.bullet[i]
    b.hitSpot = vector2(cx - 200, cy - 200) // D > 50 → 리코셰 경로
    b.checkMapCollision(cx, cy)
    expect(b.ricochetCount).toBe(1)
  })

  it('FRAGNADE: 벽에서 GRENADE_SURFACECOEF 바운스, 살아있음 (1224-1249)', () => {
    const { x: cx, y: cy } = findNormalPolyCentroid()
    const i = serverCreateBullet(gs, vector2(cx, cy), vector2(0, 2), guns[FRAGGRENADE].num, ownerId, 255, 1.0)
    const b = gs.bullet[i]
    b.checkMapCollision(cx, cy)
    expect(b.active).toBe(true)
    // v' = (v − Perp·D)×GRENADE_SURFACECOEF(0.88) — 반사+감쇠로 속도 벡터가 바뀌었어야 한다
    // (크기 자체는 Perp·D 성분 때문에 커질 수도 있어 방향 변화만 검증)
    const vAfter = gs.bulletParts.velocity[i]
    expect(vAfter.y).not.toBeCloseTo(2)
  })
})

/* ****************************************************************************
 *   T8: 스프라이트/씽/콜라이더 충돌 + Hit/ExplosionHit (Bullets.pas:1361-2683)  *
 **************************************************************************** */

// 빈 맵에 임의 위치로 스프라이트를 하나 만든다 (스폰포인트 불필요 — sPos 직접 지정).
function makeSprite(gs: GameState, pos: { x: number; y: number }, team = TEAM_NONE): number {
  const player = createTPlayer()
  player.name = 'S'
  player.team = team
  return createSprite(gs, vector2(pos.x, pos.y), vector2(0, 0), 1, 255, player, true)
}

// 스켈레톤 특정 파트만 목표점 P에, 나머지 관심 파트는 멀리 치운다 (Where 결정론화).
function placeSkeleton(gs: GameState, num: number, part: number, p: { x: number; y: number }): void {
  const sk = gs.sprite[num].skeleton
  // BodyPartsPriority = [12,11,10,6,5,4,3] — 전부 far로, 지정 파트만 P로.
  for (const bp of [12, 11, 10, 6, 5, 4, 3]) {
    sk.pos[bp] = vector2(1e6, 1e6)
  }
  sk.pos[part] = vector2(p.x, p.y)
}

describe('TBullet.checkSpriteCollision — 대미지 수식 (Bullets.pas:1361-1900)', () => {
  let gs: GameState
  beforeEach(() => {
    gs = setupTestGame({ emptyMap: true })
  })

  it('PLAIN 명중: healthHit(amount = speed*hitMultiply*hitboxModifier, Where, Num), 규약 10(srv 없음) (1628-1630)', () => {
    // owner=1, target=2 (둘 다 solo=TEAM_NONE). 흉부 파트(11)만 탄 경로에 배치.
    const owner = makeSprite(gs, { x: 0, y: 0 })
    const target = makeSprite(gs, { x: 1000, y: 1000 })
    expect(owner).toBe(1)
    expect(target).toBe(2)
    gs.sprite[target].ceaseFireCounter = -1
    gs.sprite[target].deadMeat = false
    placeSkeleton(gs, target, 11, { x: 100, y: 100 })

    // 탄: (90,100)에서 속도 (15,0) → 세그먼트가 (98,100) 원(r=7)을 관통. speed=15, hitM=2.0.
    // speed=15 → 15/guns[EAGLE].speed(19)=0.789<0.9 이고 speed<=23 → 관통(pierce) 없이 Kill (1669-1678).
    const i = serverCreateBullet(gs, vector2(90, 100), vector2(15, 0), guns[EAGLE].num, owner, 255, 2.0)
    const b = gs.bullet[i]
    const spy = vi.spyOn(gs.sprite[target], 'healthHit')

    b.checkSpriteCollision(-1)

    expect(spy).toHaveBeenCalledTimes(1)
    const [amount, who, where, what] = spy.mock.calls[0]
    // 15 * 2.0 * guns[EAGLE].modifierChest(0.95) = 28.5
    expect(amount).toBeCloseTo(15 * 2.0 * guns[EAGLE].modifierChest)
    expect(amount).toBeCloseTo(28.5)
    expect(who).toBe(owner)
    expect(where).toBe(11) // 흉부 파트
    expect(what).toBe(i) // Num
    expect(b.active).toBe(false) // Kill
  })

  it('M79계 명중: 직격 healthHit(amount = |velocity|*hitMultiply) — hitboxModifier 미적용 (1745-1747)', () => {
    const owner = makeSprite(gs, { x: 0, y: 0 })
    const target = makeSprite(gs, { x: 1000, y: 1000 })
    gs.sprite[target].ceaseFireCounter = -1
    gs.sprite[target].deadMeat = false
    // 머리 파트(12)에 배치 — M79 직격은 hitbox 안 곱하므로 결과 |vel|*hitM 그대로.
    placeSkeleton(gs, target, 12, { x: 100, y: 100 })

    const i = serverCreateBullet(gs, vector2(90, 100), vector2(10, 0), guns[M79].num, owner, 255, 3.0)
    const b = gs.bullet[i]
    const spy = vi.spyOn(gs.sprite[target], 'healthHit')

    b.checkSpriteCollision(-1)

    // M79계는 Hit(HIT_TYPE_EXPLODE)로 폭발도 일으켜 같은 스프라이트에 폭발 대미지(Where=1 하드코딩)를
    // 추가로 넣는다. 직격 호출은 Where=명중파트(12)로 구분 (폭발은 Where=1).
    const directCall = spy.mock.calls.find((c) => c[2] === 12)
    expect(directCall).toBeDefined()
    // |velocity|(10) * hitMultiply(3.0) — 모디파이어 없음 = 30.0
    expect(directCall![0]).toBeCloseTo(30.0)
  })

  it('ARROW 명중: healthHit(amount = speed*hitMultiply*hitboxModifier), speed=live velocity (1728-1730)', () => {
    const owner = makeSprite(gs, { x: 0, y: 0 })
    const target = makeSprite(gs, { x: 1000, y: 1000 })
    gs.sprite[target].ceaseFireCounter = -1
    gs.sprite[target].deadMeat = false
    placeSkeleton(gs, target, 11, { x: 100, y: 100 }) // 흉부

    const i = serverCreateBullet(gs, vector2(90, 100), vector2(10, 0), guns[BOW].num, owner, 255, 2.0)
    const b = gs.bullet[i]
    b.timeOut = 400 // > ARROW_RESIST(280) — 조기 return 회피 + ARROW 케이스 진입
    const spy = vi.spyOn(gs.sprite[target], 'healthHit')

    b.checkSpriteCollision(-1)

    expect(spy).toHaveBeenCalledTimes(1)
    // 10 * 2.0 * guns[BOW].modifierChest(1) = 20.0
    expect(spy.mock.calls[0][0]).toBeCloseTo(10 * 2.0 * guns[BOW].modifierChest)
    expect(spy.mock.calls[0][0]).toBeCloseTo(20.0)
  })

  it('FLAME 명중: healthHit(amount = hitMultiply) — 속도 무관 (1787-1788, 서버 재점화 임계 TimeOut<3)', () => {
    const owner = makeSprite(gs, { x: 0, y: 0 })
    const target = makeSprite(gs, { x: 1000, y: 1000 })
    gs.sprite[target].ceaseFireCounter = -1
    gs.sprite[target].deadMeat = false
    gs.sprite[target].health = 150 // > -1
    placeSkeleton(gs, target, 11, { x: 100, y: 100 })

    // hitM=2.0 < guns[FLAMER].hitMultiply/3(≈6.33) → 재점화 CreateBullet 미발동, healthHit만.
    const i = serverCreateBullet(gs, vector2(90, 100), vector2(10, 0), guns[FLAMER].num, owner, 255, 2.0)
    const b = gs.bullet[i]
    b.timeOut = 1 // < 3, ricochetCount 0 < 2 → 재점화/대미지 게이트 통과 (규약 13 서버값)
    const spy = vi.spyOn(gs.sprite[target], 'healthHit')

    b.checkSpriteCollision(-1)

    expect(spy).toHaveBeenCalledTimes(1)
    // 속도(10)와 무관하게 HitMultiply(2.0) 그대로
    expect(spy.mock.calls[0][0]).toBeCloseTo(2.0)
  })

  it('THROWNKNIFE 명중: healthHit(amount = |velocity|*hitMultiply*0.01) (1871-1873)', () => {
    const owner = makeSprite(gs, { x: 0, y: 0 })
    const target = makeSprite(gs, { x: 1000, y: 1000 })
    gs.sprite[target].ceaseFireCounter = -1
    gs.sprite[target].deadMeat = false
    placeSkeleton(gs, target, 11, { x: 100, y: 100 })

    const i = serverCreateBullet(gs, vector2(90, 100), vector2(10, 0), guns[THROWNKNIFE].num, owner, 255, 5.0)
    const b = gs.bullet[i]
    const spy = vi.spyOn(gs.sprite[target], 'healthHit')

    b.checkSpriteCollision(-1)

    expect(spy).toHaveBeenCalledTimes(1)
    // |velocity|(10) * hitMultiply(5.0) * 0.01 = 0.5
    expect(spy.mock.calls[0][0]).toBeCloseTo(0.5)
  })
})

describe('TBullet.explosionHit — 폭발 대미지/체인 (Bullets.pas:2364-2683)', () => {
  let gs: GameState
  beforeEach(() => {
    gs = setupTestGame({ emptyMap: true })
  })

  it('FRAGNADE 폭발: 반경 내 생존 스프라이트 → (1/(dist+1))*guns[FRAGGRENADE].hitMultiply*hitbox, Where=1 하드코딩 (2484-2485)', () => {
    const owner = makeSprite(gs, { x: -2000, y: -2000 }) // 폭발 반경 밖
    const target = makeSprite(gs, { x: 1000, y: 1000 })
    gs.sprite[target].ceaseFireCounter = -1
    gs.sprite[target].deadMeat = false
    // 모든 바디파트를 (550,500)에 — 폭발원 (500,500)에서 dist=50 (반경 85 이내).
    for (let p = 1; p <= 16; p++) gs.sprite[target].skeleton.pos[p] = vector2(550, 500)

    const i = serverCreateBullet(gs, vector2(500, 500), vector2(0, 0), guns[FRAGGRENADE].num, owner, 255, 1.0)
    const b = gs.bullet[i]
    gs.bulletParts.pos[i] = vector2(500, 500)
    const spy = vi.spyOn(gs.sprite[target], 'healthHit')

    b.explosionHit(HIT_TYPE_FRAGNADE, 0, 0)

    expect(spy).toHaveBeenCalledTimes(1)
    const [amount, , where] = spy.mock.calls[0]
    // 가장 가까운 파트=12(머리) → guns[FRAGGRENADE].modifierHead(1). dist=50.
    // (1/(50+1)) * 1500 * 1 = 29.41176...
    expect(amount).toBeCloseTo((1 / 51) * guns[FRAGGRENADE].hitMultiply * guns[FRAGGRENADE].modifierHead)
    expect(amount).toBeCloseTo(29.41176, 3)
    expect(where).toBe(1) // Where=1 하드코딩 보존
    expect(b.active).toBe(false) // 2557: Active := False
  })

  it('수류탄 체인: AFTER_EXPLOSION_RADIUS(50) 내 다른 FRAGNADE 연쇄 기폭 (2556-2577)', () => {
    stubOwner(gs, 1)
    const a = serverCreateBullet(gs, vector2(500, 500), vector2(0, 0), guns[FRAGGRENADE].num, 1, 255, 1.0)
    const bIdx = serverCreateBullet(gs, vector2(520, 500), vector2(0, 0), guns[FRAGGRENADE].num, 1, 255, 1.0)
    gs.bulletParts.pos[a] = vector2(500, 500)
    gs.bulletParts.pos[bIdx] = vector2(520, 500) // dist 20 < 50

    const bulletB = gs.bullet[bIdx]
    const hitSpy = vi.spyOn(bulletB, 'hit')

    gs.bullet[a].explosionHit(HIT_TYPE_FRAGNADE, 0, 0)

    expect(hitSpy).toHaveBeenCalledWith(HIT_TYPE_FRAGNADE)
    expect(bulletB.active).toBe(false)
  })

  it('업스트림 버그 보존: CLUSTER 폭발도 체인함 (2553 `not Typ in [...]` 연산자우선순위 버그 → Exit 미실행, FPC 검증)', () => {
    // 원본은 FRAGNADE/EXPLODE만 체인 의도였으나 `(not Typ) in [...]`가 항상 거짓이라 Exit가 죽은
    // 코드가 되어 모든 폭발 타입이 체인 루프에 진입한다. 원본 런타임 동작 그대로 보존.
    stubOwner(gs, 1)
    const a = serverCreateBullet(gs, vector2(500, 500), vector2(0, 0), guns[FRAGGRENADE].num, 1, 255, 1.0)
    const bIdx = serverCreateBullet(gs, vector2(520, 500), vector2(0, 0), guns[FRAGGRENADE].num, 1, 255, 1.0)
    gs.bulletParts.pos[a] = vector2(500, 500)
    gs.bulletParts.pos[bIdx] = vector2(520, 500)

    const bulletB = gs.bullet[bIdx]
    const hitSpy = vi.spyOn(bulletB, 'hit')
    // HIT_TYPE_CLUSTER=7 — "의도상" 체인 안 해야 하나, 버그로 체인함.
    gs.bullet[a].explosionHit(7 /* HIT_TYPE_CLUSTER */, 0, 0)

    expect(hitSpy).toHaveBeenCalledWith(HIT_TYPE_FRAGNADE)
    expect(bulletB.active).toBe(false)
  })
})
