// 1:1 포팅: soldat-ref/soldat/shared/mechanics/Bullets.pas (2806 lines) — 1부 (M2 Task 4)
// TBullet 구조·생성(CreateBullet/ServerCreateBullet)·Update 이동/타임아웃/거리 감쇠·맵 충돌
// (리코셰/수류탄 바운스)·경계 밖 킬.
//
// 이 태스크(Task 4) 스코프
// ------------------------
// * 채택(실동작):
//   - TBullet 필드 전체 (9-37) — 클라 전용 필드(HasHit/PingAdd/PingAddStart)는 제외,
//     {$IFDEF SERVER} DontCheat는 채택 (규약 8a).
//   - HIT_TYPE_* 상수 (59-68).
//   - CreateBullet (94-357): 슬롯 스캔/필드 초기화/FLAME 스폰 전진/BulletParts.CreatePart.
//     ⚠ 규약 9 — TimeOutPrev/HitMultiplyPrev/DegradeCount는 원본에서 {$IFNDEF SERVER}로만
//     초기화되지만(165-171/199-203, 원본 자체 "TODO: Check if this should be used also in
//     server" 주석) 공용 코드(Update 거리 감쇠·렌더 보간)가 읽으므로 무조건 초기화한다.
//   - ServerCreateBullet (359-379) — M2의 표준 스폰 진입점 (규약 8a).
//   - Update (529-737): 충돌 4단계 호출 순서/dist 스레딩 그대로 (sprite/thing/collider 충돌은
//     T8 스텁이 "무충돌"을 반환), 타임아웃 스타일 분기, 거리 감쇠(637-665), FLAME 상승력
//     (724-725). {$IFNDEF SERVER} CreateSpark 호출(FLAMEARROW 연기 703-711, LAW 연기 713-720,
//     출혈 727-736)은 규약 12에 따라 채택. PlaySound는 규약 11의 gs.playSound 훅.
//   - Kill (1060-1071), CheckMapCollision (1073-1359), CheckOutOfBounds (2685-2700),
//     GetWeaponIndex (2791-2806).
// * TODO(T8) 스텁 (시그니처만 보존, "무충돌/무동작" 반환):
//   - CheckSpriteCollision (1361-1900) / CheckThingCollision (1902-2004) /
//     CheckColliderCollision (2006-2118) / Hit (2120-2362) / ExplosionHit (2364-2683) /
//     FilterSpritesByDistance·TargetableSprite·GetComparableSpriteDistance·
//     GetSpriteCollisionPoint (2702-2789).
// * 주석 처리 (shape만 보존):
//   - CreateBullet의 발사억제 게이트 (117-128): 네트워크 지연 보정용 클라/서버 억제 로직 —
//     규약 8b. 이 심은 권위 로컬이라 인간 발사도 ServerCreateBullet(MustCreate=True) 경로.
//   - 네트 전송 (236-259 ClientSendBullet / 336-348·374-375 ServerBulletSnapshot): TODO(M3) NET.
//   - WepStats HUD 통계 (261-334): 규약 8c — 웹 레이어(M4) 소관.
//   - Update의 카메라 트래킹 (669-683)·whizz 사운드 (690-700): CameraFollowSprite 등 클라
//     카메라 상태 의존 — 규약 8c.
//   - BulletCanSend (381-419)·CanHitSpray·CalculateRecoil·HitSpray (421-526): 네트 가시성
//     판정/클라 로컬 이펙트 — 이 태스크 범위 밖 (호출부가 전부 주석 처리된 블록 안).
//
// 접근 규약: sprites.ts와 동일한 gs-보관 클래스 패턴 — 생성 시 GameState를 받아 필드로 보관.
import {
  type TVector2,
  vector2,
  cloneVec2,
  vec2Add,
  vec2Subtract,
  vec2Scale,
  vec2Normalize,
  vec2Length,
  vec2Length2,
} from './vector'
import { pascalRound, trunc, random } from './pascal'
import { lineCircleCollision, sqrDistVec2 } from './calc'
import {
  guns,
  weaponNumToIndex,
  BARRETT,
  M79,
  KNIFE,
  LAW,
  FLAMER,
  CLUSTER,
  FRAGGRENADE,
  CHAINSAW,
  BOW,
  BOW2,
  BULLET_STYLE_PLAIN,
  BULLET_STYLE_FRAGNADE,
  BULLET_STYLE_SHOTGUN,
  BULLET_STYLE_M79,
  BULLET_STYLE_FLAME,
  BULLET_STYLE_PUNCH,
  BULLET_STYLE_ARROW,
  BULLET_STYLE_FLAMEARROW,
  BULLET_STYLE_CLUSTERNADE,
  BULLET_STYLE_CLUSTER,
  BULLET_STYLE_KNIFE,
  BULLET_STYLE_LAW,
  BULLET_STYLE_THROWNKNIFE,
  BULLET_STYLE_M2,
  WEAPON_NOCOLLISION_ENEMY,
  WEAPON_NOCOLLISION_TEAM,
  WEAPON_NOCOLLISION_SELF,
  WEAPON_NOCOLLISION_EXP_ENEMY,
  WEAPON_NOCOLLISION_EXP_TEAM,
  WEAPON_NOCOLLISION_EXP_SELF,
} from './weapons'
import {
  MAX_BULLETS,
  MAX_SPRITES,
  MAX_THINGS,
  MAX_SPARKS,
  HUMAN,
  GRENADE_SURFACECOEF,
  PART_RADIUS,
  FLAG_PART_RADIUS,
  M79GRENADE_EXPLOSION_RADIUS,
  FRAGGRENADE_EXPLOSION_RADIUS,
  CLUSTERGRENADE_EXPLOSION_RADIUS,
  AFTER_EXPLOSION_RADIUS,
  teamCollides,
} from './sprites'
import {
  POLY_TYPE_ONLY_PLAYER,
  POLY_TYPE_DOESNT,
  POLY_TYPE_ONLY_FLAGGERS,
  POLY_TYPE_NOT_FLAGGERS,
  POLY_TYPE_BACKGROUND,
  POLY_TYPE_BACKGROUND_TRANSITION,
} from './polymap'
import {
  BULLET_TIMEOUT,
  GRENADE_TIMEOUT,
  M2BULLET_TIMEOUT,
  FLAMER_TIMEOUT,
  ARROW_RESIST,
  MAX_PUSHTICK,
  EXPLOSION_IMPACT_MULTIPLY,
  EXPLOSION_DEADIMPACT_MULTIPLY,
  THING_COLLISION_COOLDOWN,
  THING_PUSH_MULTIPLIER,
  SMOKE_ANIMS,
  EXPLOSION_ANIMS,
  GAMESTYLE_INF,
  BONUS_FLAMEGOD,
  OBJECT_BRAVO_FLAG,
  OBJECT_STATIONARY_GUN,
  OBJECT_COMBAT_KNIFE,
  SFX_GRENADE_BOUNCE,
  SFX_BULLETBY,
  SFX_HIT_ARG,
  SFX_DEAD_HIT,
  SFX_VESTHIT,
  SFX_RIC,
  SFX_RIC5,
  SFX_M79_EXPLOSION,
  SFX_GRENADE_EXPLOSION,
  SFX_BODYFALL,
  SFX_CLUSTERGRENADE,
  SFX_CLUSTER_EXPLOSION,
  SFX_M2EXPLODE,
  SFX_EXPLOSION_ERG,
  SFX_COLLIDERHIT,
} from './constants'
import { createSpark } from './sparks'
import { createThing, thingCollision, type TThingCollision } from './things'
import type { GameState } from './state'

export { MAX_BULLETS }

// Things.pas:8-11 TThingCollision — 탄환이 이미 부딪친 씽의 재충돌 쿨다운 기록.
// T4에서 여기 임시 정의했다가 things.ts(T5)로 이관 — 기존 import 경로 호환을 위해 재수출.
export type { TThingCollision }

// Bullets.pas:59-68
export const HIT_TYPE_WALL = 1
export const HIT_TYPE_BLOOD = 2
export const HIT_TYPE_EXPLODE = 3
export const HIT_TYPE_FRAGNADE = 4
export const HIT_TYPE_THING = 5
export const HIT_TYPE_CLUSTERNADE = 6
export const HIT_TYPE_CLUSTER = 7
export const HIT_TYPE_FLAK = 8
export const HIT_TYPE_BODYHIT = 9
export const HIT_TYPE_RICOCHET = 10

/* ****************************************************************************
 *                          TBullet (Bullets.pas:9-56)                        *
 **************************************************************************** */

export class TBullet {
  active = false
  // {$IFNDEF SERVER} HasHit — 클라 렌더 전용, 생략.
  style = 0 // Byte
  num = 0 // SmallInt — 자신의 gs.bullet/gs.bulletParts 슬롯 인덱스 (1-based)
  owner = 0 // Byte
  ownerWeapon = 0 // Byte
  timeOutReal = 0 // Single — 렌더 보간용 (web/T13이 세팅)
  timeOut = 0 // SmallInt
  timeOutPrev = 0 // SmallInt
  hitMultiply = 0 // Single
  hitMultiplyPrev = 0 // Single
  velocityPrev = vector2(0, 0)
  whizzed = false
  ownerPingTick = 0 // Byte
  hitBody = 0 // Byte
  hitSpot = vector2(0, 0)
  tracking = 0 // Byte
  imageStyle = 0 // Byte — 원본은 클라에서만 세팅(193); 서버 경로에서는 0 유지 (렌더는 web 소관)
  initial = vector2(0, 0) // 스폰 위치 — 거리 감쇠 기준점 (공용!)
  startUpTime = 0 // Integer
  ricochetCount = 0 // Integer
  degradeCount = 0 // Integer — ⚠ 규약 9: CreateBullet에서 무조건 초기화
  seed = 0 // Word
  thingCollisions: TThingCollision[] = [] // 동적 배열 그대로
  spriteCollisions = new Set<number>() // Set of 1..32
  dontCheat = false // {$IFDEF SERVER} 채택 (규약 8a)
  // {$ELSE} PingAdd, PingAddStart — 클라 네트 보정 전용, 생략.

  constructor(
    private readonly gs: GameState,
    num: number,
  ) {
    this.num = num
  }

  // Bullets.pas:529-737 TBullet.Update
  update(): void {
    const gs = this.gs

    this.timeOutPrev = this.timeOut
    this.hitMultiplyPrev = this.hitMultiply
    this.velocityPrev = cloneVec2(gs.bulletParts.velocity[this.num])

    const oldV = cloneVec2(gs.bulletParts.velocity[this.num])
    const oldP = cloneVec2(gs.bulletParts.pos[this.num])
    const oldOP = cloneVec2(gs.bulletParts.oldPos[this.num])
    let dist = -1
    let a: TVector2
    let hitP2 = vector2(0, 0)
    let hitP3 = vector2(0, 0)

    this.checkOutOfBounds()

    // check collision with map
    let hitP: TVector2
    if (this.style !== BULLET_STYLE_FRAGNADE) {
      hitP = this.checkMapCollision(gs.bulletParts.pos[this.num].x, gs.bulletParts.pos[this.num].y)
    } else {
      hitP = this.checkMapCollision(gs.bulletParts.pos[this.num].x, gs.bulletParts.pos[this.num].y - 2)
      hitP = this.checkMapCollision(gs.bulletParts.pos[this.num].x, gs.bulletParts.pos[this.num].y)
    }

    if (!this.active) {
      a = vec2Subtract(hitP, oldOP)
      dist = vec2Length(a)

      gs.bulletParts.velocity[this.num] = cloneVec2(oldV)
      this.ricochetCount--
      gs.bulletParts.pos[this.num] = cloneVec2(oldP)
      gs.bulletParts.oldPos[this.num] = cloneVec2(oldOP)
    }

    // check if hit collider
    hitP2 = this.checkColliderCollision(dist)

    if (!this.active) {
      if (hitP2.x === 0) a = vec2Subtract(hitP, oldOP)
      else a = vec2Subtract(hitP2, oldOP)

      dist = vec2Length(a)
      gs.bulletParts.velocity[this.num] = cloneVec2(oldV)
      gs.bulletParts.pos[this.num] = cloneVec2(oldP)
      gs.bulletParts.oldPos[this.num] = cloneVec2(oldOP)
    }

    // check if hit sprites
    hitP3 = this.checkSpriteCollision(dist)

    if (!this.active) {
      if (hitP3.x === 0) {
        if (hitP2.x === 0) a = vec2Subtract(hitP, oldOP)
        else a = vec2Subtract(hitP2, oldOP)
      } else {
        a = vec2Subtract(hitP3, oldOP)
      }

      dist = vec2Length(a)
    }

    // check if hit things
    hitP = this.checkThingCollision(dist)

    // count Time Out
    this.timeOut--
    if (this.timeOut === 0) {
      switch (this.style) {
        case BULLET_STYLE_PLAIN:
        case BULLET_STYLE_SHOTGUN:
        case BULLET_STYLE_FLAME:
        case BULLET_STYLE_PUNCH:
        case BULLET_STYLE_ARROW:
        case BULLET_STYLE_CLUSTERNADE:
        case BULLET_STYLE_KNIFE:
        case BULLET_STYLE_THROWNKNIFE:
          this.kill()
          break
        case BULLET_STYLE_FRAGNADE:
        case BULLET_STYLE_M79:
        case BULLET_STYLE_FLAMEARROW:
        case BULLET_STYLE_LAW:
          this.hit(HIT_TYPE_FRAGNADE)
          this.kill()
          break
        case BULLET_STYLE_CLUSTER:
          this.hit(HIT_TYPE_CLUSTER)
          this.kill()
          break
        case BULLET_STYLE_M2:
          this.hit(HIT_TYPE_FLAK)
          this.kill()
          break
      }
    } // TimeOut = 0

    // lose power on distance (Bullets.pas:637-665)
    if (this.timeOut % 6 === 0) {
      if (
        this.ownerWeapon !== guns[BARRETT].num &&
        this.ownerWeapon !== guns[M79].num &&
        this.ownerWeapon !== guns[KNIFE].num &&
        this.ownerWeapon !== guns[LAW].num
      ) {
        a = vec2Subtract(this.initial, gs.bulletParts.pos[this.num])
        dist = vec2Length(a)

        if (this.degradeCount === 0) {
          if (dist > 500) {
            this.hitMultiply = this.hitMultiply * 0.5
            this.degradeCount++
          }
        } else if (this.degradeCount === 1) {
          if (dist > 900) {
            this.hitMultiply = this.hitMultiply * 0.5
            this.degradeCount++
          }
        }
      }
    }

    // Bullets.pas:667-683 {$IFNDEF SERVER} Bullet Tracking — 클라 카메라 추적(CameraX/Y 변조),
    // 규약 8c/11로 생략 (MySprite/CameraX/CameraY는 클라 상태).
    // if Owner = MySprite then if Tracking = 255 then Tracking := Owner;
    // if Tracking = MySprite then ... CameraX/CameraY := Bulletparts.Pos/Velocity ...

    // Bullets.pas:685-687 his sound — PlaySound는 규약 11의 훅으로 채택.
    if (this.timeOut === BULLET_TIMEOUT - 25 && this.style !== BULLET_STYLE_SHOTGUN) {
      gs.playSound(SFX_BULLETBY, gs.bulletParts.pos[this.num])
    }

    // Bullets.pas:689-700 whiizz above head — CameraFollowSprite(클라 카메라) 기준 근접 판정이라
    // 규약 8c로 생략. Whizzed 플래그는 이 블록에서만 소비되므로 게임플레이 영향 없음.
    // if not Whizzed then if Style <> BULLET_STYLE_PUNCH then if CameraFollowSprite > 0 then ...
    //   PlaySound(SFX_BULLETBY2 + Random(4), ...); Whizzed := True;

    // fire for flaming arrow ({$IFNDEF SERVER} CreateSpark — 규약 12로 채택.
    // ⚠ 원본 그대로: CreateSpark의 owner 인자가 Owner가 아니라 Num(탄환 슬롯 번호)이다.)
    if (this.style === BULLET_STYLE_FLAMEARROW) {
      // smoke
      if (random(2) === 0) {
        createSpark(gs, cloneVec2(gs.bulletParts.pos[this.num]), vector2(0, -0.5), 37, this.num, 40)
      }
      if (random(2) === 0) {
        createSpark(gs, cloneVec2(gs.bulletParts.pos[this.num]), vector2(0, -0.5), 36, this.num, 40)
      }
    }

    // law missile smoke ({$IFNDEF SERVER} CreateSpark — 규약 12로 채택, owner=Num 동일)
    if (this.style === BULLET_STYLE_LAW) {
      // smoke
      createSpark(gs, cloneVec2(gs.bulletParts.pos[this.num]), vector2(0, -1.5), 59, this.num, 50)
      if (random(2) === 0) {
        createSpark(
          gs,
          cloneVec2(gs.bulletParts.pos[this.num]),
          cloneVec2(gs.bulletParts.velocity[this.num]),
          2,
          this.num,
          5,
        )
      }
    }

    // flame (Bullets.pas:723-725 — 규약 13에 준하는 공용 코드, 서버에서도 동작)
    if (this.style === BULLET_STYLE_FLAME) {
      gs.bulletParts.forces[this.num].y = gs.bulletParts.forces[this.num].y - 0.15
    }

    // bleed ({$IFNDEF SERVER} CreateSpark — 규약 12로 채택; 여기의 owner는 원본대로 Owner)
    if (this.hitBody > 0) {
      if (random(5) === 0) {
        createSpark(
          gs,
          cloneVec2(gs.bulletParts.pos[this.num]),
          vector2(gs.bulletParts.velocity[this.num].x * 0.5, gs.bulletParts.velocity[this.num].y * 0.5),
          4,
          this.owner,
          90,
        )
      }
    }
  }

  // Bullets.pas:1060-1071 TBullet.Kill
  kill(): void {
    this.active = false
    if (this.num > 0) {
      this.gs.bulletParts.active[this.num] = false
    }
    this.thingCollisions = []
    this.spriteCollisions.clear()
  }

  // Bullets.pas:1073-1359 TBullet.CheckMapCollision
  // ⚠ 리코셰 처리 블록이 PLAIN계(1133-1211)와 M79계(1250-1328)에 이중으로 존재한다 — 원본
  // 그대로 중복 복사, 통합 금지 (계획서 T4 지시). 차이: PLAIN계만 리코셰 성공 시 OldPos를
  // 재기록(1162)하고, 실패(비리코셰) Hit 타입이 WALL vs EXPLODE로 다르다.
  checkMapCollision(x: number, y: number): TVector2 {
    const gs = this.gs
    const map = gs.map

    let pos = vector2(0, 0)
    let perp = vector2(0, 0)
    let d = 0

    // Result := Pos (조기 Kill/Exit 시 (0,0) 반환)
    const result = cloneVec2(pos)

    // make step
    const largestVelocityComponent = Math.max(
      Math.abs(gs.bulletParts.velocity[this.num].x),
      Math.abs(gs.bulletParts.velocity[this.num].y),
    )

    let detAcc = trunc(largestVelocityComponent / 2.5)
    if (detAcc === 0) detAcc = 1
    const step = vec2Scale(gs.bulletParts.velocity[this.num], 1 / detAcc)

    // make steps for accurate collision detection
    for (let b = 0; b <= detAcc - 1; b++) {
      pos.x = x + b * step.x
      pos.y = y + b * step.y

      // iterate through maps sector polygons
      let kx = pascalRound(pos.x / map.sectorsDivision)
      let ky = pascalRound(pos.y / map.sectorsDivision)
      if (kx < -map.sectorsNum || kx > map.sectorsNum || ky < -map.sectorsNum || ky > map.sectorsNum) {
        this.kill()
        return result
      }

      // Pascal: `if High(...) > 0 then for j := 1 to High(...)` — sparks.ts와 동일하게 if 가드는
      // for 루프 자체 경계와 중복이라 루프 조건 하나로 재현한다.
      const sectorPolys = map.sectorPolys(kx, ky)
      for (let j = 1; j < sectorPolys.length; j++) {
        const w = sectorPolys[j]
        const teamcol = teamCollides(map, w, gs.sprite[this.owner].player!.team, true)
        if (
          teamcol &&
          map.polyType[w] !== POLY_TYPE_ONLY_PLAYER &&
          map.polyType[w] !== POLY_TYPE_DOESNT &&
          map.polyType[w] !== POLY_TYPE_ONLY_FLAGGERS &&
          map.polyType[w] !== POLY_TYPE_NOT_FLAGGERS &&
          map.polyType[w] !== POLY_TYPE_BACKGROUND &&
          map.polyType[w] !== POLY_TYPE_BACKGROUND_TRANSITION
        ) {
          if (map.pointInPolyEdges(pos.x, pos.y, w)) {
            switch (this.style) {
              case BULLET_STYLE_PLAIN:
              case BULLET_STYLE_SHOTGUN:
              case BULLET_STYLE_PUNCH:
              case BULLET_STYLE_KNIFE:
              case BULLET_STYLE_M2: {
                gs.bulletParts.oldPos[this.num] = cloneVec2(gs.bulletParts.pos[this.num])
                gs.bulletParts.pos[this.num] = vec2Subtract(pos, gs.bulletParts.velocity[this.num])
                const temp = cloneVec2(gs.bulletParts.pos[this.num])
                const temp2 = cloneVec2(gs.bulletParts.velocity[this.num])

                perp = vec2Subtract(gs.bulletParts.pos[this.num], this.hitSpot)
                d = vec2Length(perp)
                // ricochet!
                if (d > 50.0) {
                  this.ricochetCount++
                  // Pascal은 var-out D를 받지만 곧바로 |Velocity|로 덮어쓴다 — cp.d는 버려진다.
                  const cp = map.closestPerpendicular(w, gs.bulletParts.pos[this.num])
                  perp = cloneVec2(cp.perp)
                  d = vec2Length(gs.bulletParts.velocity[this.num])
                  perp = vec2Normalize(perp)
                  perp = vec2Scale(perp, -d)

                  gs.bulletParts.velocity[this.num].x =
                    gs.bulletParts.velocity[this.num].x * (25 / 35) + perp.x * (10 / 35)
                  gs.bulletParts.velocity[this.num].y =
                    gs.bulletParts.velocity[this.num].y * (25 / 35) + perp.y * (10 / 35)
                  gs.bulletParts.pos[this.num] = cloneVec2(pos)
                  this.hitSpot = cloneVec2(gs.bulletParts.pos[this.num])

                  perp = vec2Normalize(gs.bulletParts.velocity[this.num])
                  perp = vec2Scale(perp, d / 6)
                  gs.bulletParts.oldPos[this.num] = cloneVec2(gs.bulletParts.pos[this.num])
                  pos.x = gs.bulletParts.pos[this.num].x + perp.x
                  pos.y = gs.bulletParts.pos[this.num].y + perp.y
                  kx = pascalRound(pos.x / map.sectorsDivision)
                  ky = pascalRound(pos.y / map.sectorsDivision)
                  if (kx > -map.sectorsNum && kx < map.sectorsNum && ky > -map.sectorsNum && ky < map.sectorsNum) {
                    const polys2 = map.sectorPolys(kx, ky)
                    for (let k = 1; k < polys2.length; k++) {
                      const w2 = polys2[k]
                      if (
                        map.polyType[w2] !== POLY_TYPE_ONLY_PLAYER &&
                        map.polyType[w2] !== POLY_TYPE_DOESNT &&
                        map.polyType[w2] !== POLY_TYPE_ONLY_FLAGGERS &&
                        map.polyType[w2] !== POLY_TYPE_NOT_FLAGGERS &&
                        map.polyType[w2] !== POLY_TYPE_BACKGROUND &&
                        map.polyType[w2] !== POLY_TYPE_BACKGROUND_TRANSITION &&
                        teamCollides(map, w2, gs.sprite[this.owner].player!.team, true)
                      ) {
                        if (map.pointInPolyEdges(pos.x, pos.y, w2)) {
                          this.kill()
                          break
                        }
                      }
                    }
                  }
                } else {
                  this.kill()
                }

                if (this.active) {
                  gs.bulletParts.pos[this.num] = cloneVec2(temp)
                  perp = cloneVec2(gs.bulletParts.velocity[this.num])
                  gs.bulletParts.velocity[this.num] = cloneVec2(temp2)
                  this.hit(HIT_TYPE_RICOCHET)
                  gs.bulletParts.pos[this.num] = cloneVec2(this.hitSpot)
                  gs.bulletParts.velocity[this.num] = cloneVec2(perp)
                } else {
                  gs.bulletParts.pos[this.num] = cloneVec2(temp)
                  perp = cloneVec2(gs.bulletParts.velocity[this.num])
                  gs.bulletParts.velocity[this.num] = cloneVec2(temp2)
                  this.hit(HIT_TYPE_WALL)
                  gs.bulletParts.pos[this.num] = cloneVec2(this.hitSpot)
                  gs.bulletParts.velocity[this.num] = cloneVec2(perp)
                }
                break
              }
              case BULLET_STYLE_ARROW: {
                gs.bulletParts.pos[this.num] = vec2Subtract(pos, gs.bulletParts.velocity[this.num])
                gs.bulletParts.forces[this.num].y = gs.bulletParts.forces[this.num].y - gs.bulletParts.gravity
                if (this.timeOut > ARROW_RESIST) this.timeOut = ARROW_RESIST
                if (this.timeOut < 20) {
                  gs.bulletParts.forces[this.num].y = gs.bulletParts.forces[this.num].y + gs.bulletParts.gravity
                }
                break
              }
              case BULLET_STYLE_FRAGNADE:
              case BULLET_STYLE_FLAME: {
                // {$IFNDEF SERVER} bounce sound — 규약 11의 훅으로 채택.
                // ⚠ 원본 그대로: 재생 위치가 BulletParts가 아니라 SpriteParts.Pos[Num]이다
                // (탄환 슬롯 번호로 스프라이트 파티클을 인덱싱 — 업스트림 버그, 보존).
                if (this.style === BULLET_STYLE_FRAGNADE) {
                  if (vec2Length(gs.bulletParts.velocity[this.num]) > 1.5) {
                    gs.playSound(SFX_GRENADE_BOUNCE, gs.spriteParts.pos[this.num])
                  }
                }

                const cp = map.closestPerpendicular(w, gs.bulletParts.pos[this.num])
                d = cp.d
                perp = vec2Normalize(cp.perp)
                perp = vec2Scale(perp, d)

                gs.bulletParts.pos[this.num] = cloneVec2(pos)
                gs.bulletParts.velocity[this.num] = vec2Subtract(gs.bulletParts.velocity[this.num], perp)

                gs.bulletParts.velocity[this.num] = vec2Scale(gs.bulletParts.velocity[this.num], GRENADE_SURFACECOEF)

                if (this.style === BULLET_STYLE_FLAME) {
                  if (this.timeOut > 16) this.timeOut = 16
                }
                break
              }
              case BULLET_STYLE_M79:
              case BULLET_STYLE_FLAMEARROW:
              case BULLET_STYLE_LAW: {
                gs.bulletParts.oldPos[this.num] = cloneVec2(gs.bulletParts.pos[this.num])
                gs.bulletParts.pos[this.num] = vec2Subtract(pos, gs.bulletParts.velocity[this.num])
                const temp = cloneVec2(gs.bulletParts.pos[this.num])
                const temp2 = cloneVec2(gs.bulletParts.velocity[this.num])

                perp = vec2Subtract(gs.bulletParts.pos[this.num], this.hitSpot)
                d = vec2Length(perp)
                // ricochet!
                if (d > 50.0) {
                  this.ricochetCount++
                  const cp = map.closestPerpendicular(w, gs.bulletParts.pos[this.num])
                  perp = cloneVec2(cp.perp)
                  d = vec2Length(gs.bulletParts.velocity[this.num])
                  perp = vec2Normalize(perp)
                  perp = vec2Scale(perp, -d)

                  gs.bulletParts.velocity[this.num].x =
                    gs.bulletParts.velocity[this.num].x * (25 / 35) + perp.x * (10 / 35)
                  gs.bulletParts.velocity[this.num].y =
                    gs.bulletParts.velocity[this.num].y * (25 / 35) + perp.y * (10 / 35)
                  gs.bulletParts.pos[this.num] = cloneVec2(pos)
                  this.hitSpot = cloneVec2(gs.bulletParts.pos[this.num])

                  perp = vec2Normalize(gs.bulletParts.velocity[this.num])
                  perp = vec2Scale(perp, d / 6)
                  // (PLAIN계 블록과 달리 여기는 OldPos 재기록이 없다 — 원본 그대로)

                  pos.x = gs.bulletParts.pos[this.num].x + perp.x
                  pos.y = gs.bulletParts.pos[this.num].y + perp.y
                  kx = pascalRound(pos.x / map.sectorsDivision)
                  ky = pascalRound(pos.y / map.sectorsDivision)
                  if (kx > -map.sectorsNum && kx < map.sectorsNum && ky > -map.sectorsNum && ky < map.sectorsNum) {
                    const polys2 = map.sectorPolys(kx, ky)
                    for (let k = 1; k < polys2.length; k++) {
                      const w2 = polys2[k]
                      if (
                        map.polyType[w2] !== POLY_TYPE_ONLY_PLAYER &&
                        map.polyType[w2] !== POLY_TYPE_DOESNT &&
                        map.polyType[w2] !== POLY_TYPE_ONLY_FLAGGERS &&
                        map.polyType[w2] !== POLY_TYPE_NOT_FLAGGERS &&
                        map.polyType[w2] !== POLY_TYPE_BACKGROUND &&
                        map.polyType[w2] !== POLY_TYPE_BACKGROUND_TRANSITION &&
                        teamCollides(map, w2, gs.sprite[this.owner].player!.team, true)
                      ) {
                        if (map.pointInPolyEdges(pos.x, pos.y, w2)) {
                          this.kill()
                          break
                        }
                      }
                    }
                  }
                } else {
                  this.kill()
                }

                if (this.active) {
                  gs.bulletParts.pos[this.num] = cloneVec2(temp)
                  perp = cloneVec2(gs.bulletParts.velocity[this.num])
                  gs.bulletParts.velocity[this.num] = cloneVec2(temp2)
                  this.hit(HIT_TYPE_RICOCHET)
                  gs.bulletParts.pos[this.num] = cloneVec2(this.hitSpot)
                  gs.bulletParts.velocity[this.num] = cloneVec2(perp)
                } else {
                  gs.bulletParts.pos[this.num] = cloneVec2(temp)
                  perp = cloneVec2(gs.bulletParts.velocity[this.num])
                  gs.bulletParts.velocity[this.num] = cloneVec2(temp2)
                  this.hit(HIT_TYPE_EXPLODE)
                  gs.bulletParts.pos[this.num] = cloneVec2(this.hitSpot)
                  gs.bulletParts.velocity[this.num] = cloneVec2(perp)
                }
                break
              }
              case BULLET_STYLE_CLUSTERNADE: {
                this.hit(HIT_TYPE_CLUSTERNADE)
                this.kill()
                break
              }
              case BULLET_STYLE_CLUSTER: {
                this.hit(HIT_TYPE_CLUSTER)
                this.kill()
                break
              }
              case BULLET_STYLE_THROWNKNIFE: {
                gs.bulletParts.pos[this.num] = vec2Subtract(pos, gs.bulletParts.velocity[this.num])

                // create knife thing ({$IFDEF SERVER} — 규약 8a 채택, Bullets.pas:1344-1347)
                createThing(gs, gs.bulletParts.pos[this.num], this.owner, OBJECT_COMBAT_KNIFE, 255)

                this.hit(HIT_TYPE_WALL)
                this.kill()
                break
              }
            } // case

            return cloneVec2(pos) // Result := Pos; Exit
          } // PointInPolyEdges
        }
      } // for j
    } // for b

    return result
  }

  // Bullets.pas:1361-1900 TBullet.CheckSpriteCollision — 스프라이트 피격 판정.
  // 부위 판정 BodyPartsPriority, 대미지 5수식(PLAIN/ARROW/M79계/FLAME/THROWNKNIFE), FLAME 재점화
  // 서버 임계(규약 13), 체인 CreateBullet. 규약 10: {$IFNDEF SERVER}srv *{$ENDIF} 관용구는
  // 서버 수식(srv 없음)을 채택. {$IFNDEF SERVER} 스파크/사운드는 규약 12/11로 채택(Hit·훅 경유).
  checkSpriteCollision(lastHitDist: number): TVector2 {
    const gs = this.gs
    // Bullets.pas:1363 BodyPartsPriority — 명중 우선순위(가슴/머리 먼저).
    const bodyPartsPriority = [12, 11, 10, 6, 5, 4, 3]

    // Bullets.pas:1395-1401: Result := Default; ...; Pos.x := 0; Result := Pos.
    let result = vector2(0, 0)

    if (this.style === BULLET_STYLE_ARROW && this.timeOut <= ARROW_RESIST) return result

    // a는 함수 초입에서 Default(TVector2)로 세팅되고 순서정렬 블록에서만 재대입된다 (1399/1495).
    // lastHitDist=-1 경로에서는 (0,0)이 유지되어 ARROW/M79계의 Skeleton.Pos[Where]:=a에 그대로 쓰인다.
    let a = vector2(0, 0)

    // {$IFNDEF SERVER} srv := 0 — 규약 10: 서버 수식 채택이므로 srv 곱셈 자체를 제거한다.
    let bulletVelocity = cloneVec2(gs.bulletParts.velocity[this.num])

    if (this.style !== BULLET_STYLE_CLUSTERNADE) {
      const spritesByDistance: number[] = [] // 1-based (idx 0 미사용)
      const spriteCount = this.filterSpritesByDistance(spritesByDistance)
      let spriteCounter = 0

      while (spriteCounter < spriteCount) {
        spriteCounter++
        const j = spritesByDistance[spriteCounter]

        const col = this.getSpriteCollisionPoint(j)

        let where = 0
        let r: number
        if (this.style !== BULLET_STYLE_FRAGNADE) r = PART_RADIUS
        else r = PART_RADIUS + 1

        const candidateSkeleton = gs.sprite[j].skeleton

        // melee(PUNCH/KNIFE)는 손 스켈레톤(15) 기준 시작점 — Bullets.pas:1439-1453.
        let startPoint: TVector2
        let endPoint: TVector2
        // Pos는 var-out. 초기값: 비-melee=(0,0), melee=BulletParts.Pos[Num]. 이후 LineCircleCollision이
        // "명중 시에만" 덮어쓴다 (Calc.pas 확인) — 명중이 하나도 없으면 Where=0으로 아래 블록 skip.
        let pos: TVector2
        if (this.style === BULLET_STYLE_PUNCH || this.style === BULLET_STYLE_KNIFE) {
          pos = cloneVec2(gs.bulletParts.pos[this.num])
          let buttstock = gs.sprite[this.owner].getHandsAimDirection()
          buttstock = vec2Scale(buttstock, 4)
          startPoint = vec2Add(gs.sprite[this.owner].skeleton.pos[15], buttstock)
          endPoint = vec2Add(pos, bulletVelocity)
        } else {
          pos = vector2(0, 0)
          startPoint = cloneVec2(gs.bulletParts.pos[this.num])
          endPoint = vec2Add(startPoint, bulletVelocity)
        }

        // Bullets.pas:1456-1481 최근접 바디파트 탐색.
        let minDist = Number.MAX_VALUE // MaxSingle
        for (let bpi = 0; bpi < bodyPartsPriority.length; bpi++) {
          const bodyPartId = bodyPartsPriority[bpi]

          const bodyPartOffset = vec2Subtract(candidateSkeleton.pos[bodyPartId], gs.spriteParts.pos[j])
          const colPos = vec2Add(col, bodyPartOffset)

          // FIXME(skoskav) 원본: 비-melee는 스프라이트가 2px 왼쪽으로 어긋나 있어 보정.
          if (this.style !== BULLET_STYLE_PUNCH && this.style !== BULLET_STYLE_KNIFE) colPos.x = colPos.x - 2

          const lcc = lineCircleCollision(startPoint, endPoint, colPos, r)
          if (lcc.hit) {
            // Pos는 명중 시에만 갱신 (원본 var-out 시맨틱 보존 — Where와 별개로 마지막 명중점).
            pos = cloneVec2(lcc.collisionPoint)
            const dist = sqrDistVec2(startPoint, pos)
            if (dist < minDist) {
              where = bodyPartId
              minDist = dist
            }
          }
        }

        if ((this.style !== BULLET_STYLE_PUNCH && this.style !== BULLET_STYLE_KNIFE) || j !== this.owner) {
          if (where > 0) {
            // order collision (1493-1502)
            if (lastHitDist > -1) {
              a = vec2Subtract(pos, gs.bulletParts.oldPos[this.num])
              const dist = vec2Length(a)
              if (dist > lastHitDist) break
            }

            gs.sprite[j].brain.pissedOff = this.owner

            let norm = vec2Subtract(pos, gs.sprite[j].skeleton.pos[where])
            norm = vec2Scale(norm, 1.3)
            norm.y = -norm.y

            result = cloneVec2(pos)

            const noCollision = guns[weaponNumToIndex(this.ownerWeapon)].noCollision

            if ((noCollision & WEAPON_NOCOLLISION_ENEMY) !== 0 && gs.sprite[j].isNotInSameTeam(gs.sprite[this.owner]))
              continue
            if (
              (noCollision & WEAPON_NOCOLLISION_TEAM) !== 0 &&
              gs.sprite[j].isInSameTeam(gs.sprite[this.owner]) &&
              j !== this.owner
            )
              continue
            if ((noCollision & WEAPON_NOCOLLISION_SELF) !== 0 && this.owner === j) continue

            if (gs.sprite[j].ceaseFireCounter < 0) {
              const weaponIndex = this.getWeaponIndex()

              // Collision respond (넉백) — Bullets.pas:1535-1548.
              if (!gs.sprite[j].deadMeat) {
                if (
                  this.style !== BULLET_STYLE_FRAGNADE &&
                  this.style !== BULLET_STYLE_FLAME &&
                  this.style !== BULLET_STYLE_ARROW
                ) {
                  const bulletPush = vec2Scale(bulletVelocity, guns[weaponIndex].push)
                  // Player.PingTicks는 네트 필드(미포팅, 로컬 심 항상 0) → div 2 = 0.
                  let pushTick = 0 + this.ownerPingTick + 1
                  if (pushTick > MAX_PUSHTICK) pushTick = MAX_PUSHTICK
                  gs.sprite[j].nextPush[pushTick] = vec2Add(gs.sprite[j].nextPush[pushTick], bulletPush)
                }
              }

              switch (this.style) {
                case BULLET_STYLE_PLAIN:
                case BULLET_STYLE_SHOTGUN:
                case BULLET_STYLE_PUNCH:
                case BULLET_STYLE_KNIFE:
                case BULLET_STYLE_M2: {
                  gs.bulletParts.pos[this.num] = cloneVec2(pos)

                  // {$IFNDEF SERVER} Blood spark (규약 12 채택). 카메라 셰이크(CHAINSAW)는 규약 11 생략.
                  if (
                    gs.svFriendlyfire ||
                    gs.sprite[this.owner].isSolo() ||
                    gs.sprite[this.owner].isNotInSameTeam(gs.sprite[j]) ||
                    j === this.owner
                  ) {
                    this.hit(HIT_TYPE_BLOOD)
                  }
                  // if (Owner = MySprite) and (OwnerWeapon = Guns[CHAINSAW].Num) then CameraX/Y 셰이크 — 규약 11 생략.

                  // Puff (규약 12). r_maxsparks는 상수 MAX_SPARKS 고정 → 조건 항상 참(형태 보존).
                  let puff = vec2Normalize(bulletVelocity)
                  puff = vec2Scale(puff, 3)
                  puff = vec2Add(gs.bulletParts.pos[this.num], puff)
                  if (MAX_SPARKS > MAX_SPARKS - 10) createSpark(gs, puff, puff, 50, j, 31)

                  // Shread clothes (규약 12)
                  if (MAX_SPARKS > MAX_SPARKS - 10) {
                    let clothesShreadStyle: number
                    if (where <= 4) clothesShreadStyle = 49
                    else if (where <= 11) clothesShreadStyle = 48
                    else clothesShreadStyle = 0

                    if (clothesShreadStyle > 0) {
                      for (let ci = 1; ci <= 2; ci++) {
                        if (random(8) === 0) {
                          const sp = vector2(Math.sin(random(100)), Math.cos(random(100)))
                          createSpark(gs, pos, sp, clothesShreadStyle, j, 120)
                        }
                      }
                    }
                  }

                  // play hit sound (규약 11 훅)
                  if (gs.sprite[j].vest < 1) {
                    if (!gs.sprite[j].deadMeat) gs.playSound(SFX_HIT_ARG + random(3), gs.bulletParts.pos[this.num])
                    else gs.playSound(SFX_DEAD_HIT, gs.bulletParts.pos[this.num])
                  } else {
                    gs.playSound(SFX_VESTHIT, gs.bulletParts.pos[this.num])
                  }

                  // Head/torso/leg hitbox modifier
                  let hitboxModifier: number
                  if (where <= 4) hitboxModifier = guns[weaponNumToIndex(this.ownerWeapon)].modifierLegs
                  else if (where <= 11) hitboxModifier = guns[weaponNumToIndex(this.ownerWeapon)].modifierChest
                  else hitboxModifier = guns[weaponNumToIndex(this.ownerWeapon)].modifierHead

                  const speed = vec2Length(bulletVelocity)
                  const wasDead = gs.sprite[j].deadMeat

                  // 규약 10: 서버 수식 — srv 곱셈 없음.
                  gs.sprite[j].healthHit(speed * this.hitMultiply * hitboxModifier, this.owner, where, this.num, norm)

                  // drop weapon when punched
                  if (this.style === BULLET_STYLE_PUNCH) {
                    if (
                      gs.sprite[j].isSolo() ||
                      (gs.sprite[j].isNotSolo() && gs.sprite[j].isNotInSameTeam(gs.sprite[this.owner]))
                    ) {
                      if (gs.sprite[j].weapon.num !== guns[BOW].num && gs.sprite[j].weapon.num !== guns[BOW2].num) {
                        gs.sprite[j].bodyApplyAnimation(gs.anims.throwWeapon, 11)
                      }
                    }
                  }

                  this.hitBody = j

                  // Pierce check and break to next sprite (1653-1678)
                  if (wasDead) {
                    gs.bulletParts.velocity[this.num] = vec2Scale(bulletVelocity, 0.9)
                    bulletVelocity = cloneVec2(gs.bulletParts.velocity[this.num])
                    this.hit(HIT_TYPE_BODYHIT)
                    continue
                  }
                  if (gs.sprite[j].deadMeat || speed > 23) {
                    gs.bulletParts.velocity[this.num] = vec2Scale(bulletVelocity, 0.75)
                    bulletVelocity = cloneVec2(gs.bulletParts.velocity[this.num])
                    this.hit(HIT_TYPE_BODYHIT)
                    continue
                  }
                  if (speed > 5 && speed / guns[weaponIndex].speed >= 0.9) {
                    gs.bulletParts.velocity[this.num] = vec2Scale(bulletVelocity, 0.66)
                    bulletVelocity = cloneVec2(gs.bulletParts.velocity[this.num])
                    this.hit(HIT_TYPE_BODYHIT)
                    continue
                  }

                  this.kill()
                  break
                }

                case BULLET_STYLE_FRAGNADE: {
                  if (!gs.sprite[j].deadMeat) {
                    this.hit(HIT_TYPE_FRAGNADE, j, where)
                    this.kill()
                  }
                  break
                }

                case BULLET_STYLE_ARROW: {
                  if (this.timeOut > ARROW_RESIST) {
                    gs.bulletParts.pos[this.num] = vec2Subtract(pos, gs.bulletParts.velocity[this.num])
                    gs.bulletParts.forces[this.num].y = gs.bulletParts.forces[this.num].y - gs.bulletParts.gravity
                    if (
                      (!gs.svFriendlyfire &&
                        gs.sprite[this.owner].isNotSolo() &&
                        gs.sprite[this.owner].isInSameTeam(gs.sprite[j])) ||
                      gs.sprite[j].bonusStyle === BONUS_FLAMEGOD
                    ) {
                      // 아군/FlameGod → 출혈 없음
                    } else {
                      this.hit(HIT_TYPE_BLOOD)
                    }

                    // play hit sound (규약 11)
                    if (gs.sprite[j].vest < 1) {
                      if (!gs.sprite[j].deadMeat) gs.playSound(SFX_HIT_ARG + random(3), gs.bulletParts.pos[this.num])
                      else gs.playSound(SFX_DEAD_HIT, gs.bulletParts.pos[this.num])
                    } else {
                      gs.playSound(SFX_VESTHIT, gs.bulletParts.pos[this.num])
                    }

                    let hitboxModifier: number
                    if (where <= 4) hitboxModifier = guns[weaponNumToIndex(this.ownerWeapon)].modifierLegs
                    else if (where <= 11) hitboxModifier = guns[weaponNumToIndex(this.ownerWeapon)].modifierChest
                    else hitboxModifier = guns[weaponNumToIndex(this.ownerWeapon)].modifierHead

                    const speed = vec2Length(gs.bulletParts.velocity[this.num])

                    gs.sprite[j].healthHit(speed * this.hitMultiply * hitboxModifier, this.owner, where, this.num, norm)

                    if (!gs.sprite[j].deadMeat) gs.sprite[j].skeleton.pos[where] = cloneVec2(a)

                    this.kill()
                  }
                  break
                }

                case BULLET_STYLE_M79:
                case BULLET_STYLE_FLAMEARROW:
                case BULLET_STYLE_LAW: {
                  if (!gs.sprite[j].deadMeat) {
                    this.hit(HIT_TYPE_EXPLODE, j, where)
                    gs.bulletParts.pos[this.num] = cloneVec2(pos)
                    this.kill()

                    // 규약 10: 서버 수식 — hitbox 미적용, srv 없음.
                    gs.sprite[j].healthHit(
                      vec2Length(gs.bulletParts.velocity[this.num]) * this.hitMultiply,
                      this.owner,
                      where,
                      this.num,
                      norm,
                    )

                    if (!gs.sprite[j].deadMeat) gs.sprite[j].skeleton.pos[where] = cloneVec2(a)
                  }
                  break
                }

                case BULLET_STYLE_FLAME: {
                  if (this.owner !== j) {
                    gs.bulletParts.pos[this.num] = cloneVec2(gs.sprite[j].skeleton.pos[where])
                    if (!gs.sprite[j].deadMeat) {
                      gs.bulletParts.velocity[this.num] = cloneVec2(gs.spriteParts.velocity[j])
                    } else {
                      gs.bulletParts.velocity[this.num].x = 0
                      gs.bulletParts.velocity[this.num].y = 0
                    }

                    // 규약 13: FLAME 재점화 임계 — 서버 값 (TimeOut<3, RicochetCount<2) 채택.
                    if (this.timeOut < 3 && this.ricochetCount < 2) {
                      if (this.hitMultiply >= guns[FLAMER].hitMultiply / 3) {
                        this.timeOut = FLAMER_TIMEOUT - 1
                        this.ricochetCount++
                        const av = vector2(-gs.spriteParts.velocity[j].x, -gs.spriteParts.velocity[j].y)
                        // 규약 13: 체인 CreateBullet의 MustCreate=False (서버 값).
                        createBullet(
                          gs,
                          gs.sprite[j].skeleton.pos[where],
                          av,
                          guns[FLAMER].num,
                          this.owner,
                          255,
                          (2 * this.hitMultiply) / 3,
                          false,
                          false,
                        )
                      }

                      if (gs.sprite[j].health > -1) {
                        // 규약 10: 서버 수식 — 속도 무관, HitMultiply 그대로.
                        gs.sprite[j].healthHit(this.hitMultiply, this.owner, where, this.num, norm)
                      }
                    }
                  }
                  break
                }

                case BULLET_STYLE_CLUSTER: {
                  this.hit(HIT_TYPE_CLUSTER, j, where)
                  if (!gs.sprite[j].deadMeat) gs.sprite[j].skeleton.pos[where] = cloneVec2(a)
                  this.kill()
                  break
                }

                case BULLET_STYLE_THROWNKNIFE: {
                  // {$IFNDEF SERVER} Blood spark (규약 12)
                  if (
                    gs.svFriendlyfire ||
                    gs.sprite[this.owner].isSolo() ||
                    gs.sprite[this.owner].isNotInSameTeam(gs.sprite[j]) ||
                    j === this.owner
                  ) {
                    this.hit(HIT_TYPE_BLOOD)
                  }

                  // Puff (규약 12)
                  let puff = vec2Normalize(gs.bulletParts.velocity[this.num])
                  puff = vec2Scale(puff, 3)
                  puff = vec2Add(gs.bulletParts.pos[this.num], puff)
                  if (MAX_SPARKS > MAX_SPARKS - 10) createSpark(gs, puff, puff, 50, j, 31)

                  // Shread clothes (규약 12)
                  if (MAX_SPARKS > MAX_SPARKS - 10) {
                    let clothesShreadStyle: number
                    if (where <= 4) clothesShreadStyle = 49
                    else if (where <= 11) clothesShreadStyle = 48
                    else clothesShreadStyle = 0

                    if (clothesShreadStyle > 0) {
                      for (let ci = 1; ci <= 2; ci++) {
                        if (random(8) === 0) {
                          const sp = vector2(Math.sin(random(100)), Math.cos(random(100)))
                          createSpark(gs, pos, sp, clothesShreadStyle, j, 120)
                        }
                      }
                    }
                  }

                  // play hit sound (규약 11) — SpriteCollisions 집합으로 중복 재생 방지.
                  if (!this.spriteCollisions.has(gs.sprite[j].num)) {
                    this.spriteCollisions.add(gs.sprite[j].num)
                    if (gs.sprite[j].vest < 1) {
                      if (!gs.sprite[j].deadMeat) gs.playSound(SFX_HIT_ARG + random(3), gs.bulletParts.pos[this.num])
                      else gs.playSound(SFX_DEAD_HIT, gs.bulletParts.pos[this.num])
                    } else {
                      gs.playSound(SFX_VESTHIT, gs.bulletParts.pos[this.num])
                    }
                  }

                  const wasDead = gs.sprite[j].deadMeat

                  // 규약 10: 서버 수식 — |velocity|*HitMultiply*0.01.
                  gs.sprite[j].healthHit(
                    vec2Length(gs.bulletParts.velocity[this.num]) * this.hitMultiply * 0.01,
                    this.owner,
                    where,
                    this.num,
                    norm,
                  )

                  if (!gs.sprite[j].deadMeat) gs.sprite[j].skeleton.pos[where] = cloneVec2(a)

                  if (!wasDead || gs.svRealisticmode) {
                    // create knife thing ({$IFDEF SERVER} — 규약 8a)
                    createThing(gs, gs.bulletParts.pos[this.num], this.owner, OBJECT_COMBAT_KNIFE, 255)
                    this.kill()
                  }
                  break
                }
              } // switch style

              // Bullet is destroyed, so exit (1890)
              return result
            } // ceaseFireCounter < 0
          } // where > 0
        }
      } // while spriteCounter
    }

    return result
  }

  // Bullets.pas:1902-2004 TBullet.CheckThingCollision — 씽(깃발 등) 피격 + ThingCollisions 쿨다운.
  checkThingCollision(lastHitDist: number): TVector2 {
    const gs = this.gs

    let result = vector2(0, 0)

    if (this.style !== BULLET_STYLE_FRAGNADE) {
      for (let j = 1; j <= MAX_THINGS; j++) {
        if (
          gs.thing[j].active &&
          this.timeOut < BULLET_TIMEOUT - 1 &&
          gs.thing[j].collideWithBullets &&
          this.owner !== gs.thing[j].holdingSprite &&
          ((gs.svGamemode === GAMESTYLE_INF && gs.thing[j].style === OBJECT_BRAVO_FLAG) ||
            gs.svGamemode !== GAMESTYLE_INF) &&
          gs.thing[j].style !== OBJECT_STATIONARY_GUN
        ) {
          const startPoint = cloneVec2(gs.bulletParts.pos[this.num])
          const endPoint = vec2Add(startPoint, gs.bulletParts.velocity[this.num])

          let where = 0
          let pos = vector2(0, 0)

          for (let i = 1; i <= 2; i++) {
            const colPos = gs.thing[j].skeleton.pos[i]
            const lcc = lineCircleCollision(startPoint, endPoint, colPos, FLAG_PART_RADIUS)
            if (lcc.hit) {
              pos = cloneVec2(lcc.collisionPoint)
              where = i
              break
            }
          }

          if (where === 1 || where === 2) {
            // order collision
            if (lastHitDist > -1) {
              const a = vec2Subtract(pos, gs.bulletParts.oldPos[this.num])
              const dist = vec2Length(a)
              if (dist > lastHitDist) break
            }

            // Thing push cooldown from this bullet
            let skipCollision = false
            for (let i = 0; i < this.thingCollisions.length; i++) {
              if (this.thingCollisions[i].thingNum === gs.thing[j].num) {
                if (gs.mainTickCounter < this.thingCollisions[i].cooldownEnd) {
                  skipCollision = true
                  break
                }
              }
            }
            if (skipCollision) break

            this.thingCollisions.push(thingCollision(gs.thing[j].num, gs.mainTickCounter + THING_COLLISION_COOLDOWN))

            // collision respond
            const thingVel = vec2Subtract(gs.thing[j].skeleton.pos[where], gs.thing[j].skeleton.oldPos[where])
            const velDiff = vec2Subtract(gs.bulletParts.velocity[this.num], thingVel)
            const bulletPush = vec2Scale(velDiff, guns[this.getWeaponIndex()].push * THING_PUSH_MULTIPLIER)
            gs.thing[j].skeleton.pos[where] = vec2Add(gs.thing[j].skeleton.pos[where], bulletPush)

            result = cloneVec2(pos)
            gs.thing[j].staticType = false

            switch (this.style) {
              case BULLET_STYLE_PLAIN:
              case BULLET_STYLE_FRAGNADE:
              case BULLET_STYLE_SHOTGUN:
                this.hit(HIT_TYPE_THING)
                break
            }

            break
          }
        }
      } // for j
    }

    return result
  }

  // Bullets.pas:2006-2118 TBullet.CheckColliderCollision — 맵 콜라이더(원형 장애물) 충돌.
  checkColliderCollision(lastHitDist: number): TVector2 {
    const gs = this.gs
    const map = gs.map

    let result = vector2(0, 0)

    // iterate through colliders (원본은 for j := 1 to 128 — 1-based 콜라이더 배열).
    for (let j = 1; j <= 128; j++) {
      if (map.collider[j] && map.collider[j].active) {
        const startPoint = cloneVec2(gs.bulletParts.pos[this.num])
        const endPoint = vec2Add(startPoint, gs.bulletParts.velocity[this.num])

        const colPos = vector2(map.collider[j].x, map.collider[j].y)

        const lcc = lineCircleCollision(startPoint, endPoint, colPos, map.collider[j].radius / 1.7)
        if (lcc.hit) {
          const pos = cloneVec2(lcc.collisionPoint)

          // order collision
          if (lastHitDist > -1) {
            const a = vec2Subtract(pos, gs.bulletParts.oldPos[this.num])
            const dist = vec2Length(a)
            if (dist > lastHitDist) break
          }

          switch (this.style) {
            case BULLET_STYLE_PLAIN:
            case BULLET_STYLE_SHOTGUN:
            case BULLET_STYLE_PUNCH:
            case BULLET_STYLE_KNIFE:
            case BULLET_STYLE_THROWNKNIFE:
            case BULLET_STYLE_M2: {
              gs.bulletParts.pos[this.num] = vec2Subtract(pos, gs.bulletParts.velocity[this.num])

              // {$IFNDEF SERVER} dirt sparks (규약 12)
              if (MAX_SPARKS > MAX_SPARKS - 10) {
                for (let i = 1; i <= 2; i++) {
                  if (random(4) === 0) {
                    const sp = vector2(Math.sin(random(100)), Math.cos(random(100)))
                    createSpark(gs, pos, sp, 44 + random(4), j, 120)
                  }
                }
              }

              // create knife thing ({$IFDEF SERVER} — 규약 8a)
              if (this.style === BULLET_STYLE_THROWNKNIFE) {
                createThing(gs, gs.bulletParts.pos[this.num], this.owner, OBJECT_COMBAT_KNIFE, 255)
              }

              gs.playSound(SFX_COLLIDERHIT, gs.bulletParts.pos[this.num])

              this.hit(HIT_TYPE_WALL)
              this.kill()
              break
            }
            case BULLET_STYLE_FRAGNADE:
              if (this.timeOut < GRENADE_TIMEOUT - 2) {
                this.hit(HIT_TYPE_FRAGNADE)
                this.kill()
              }
              break
            case BULLET_STYLE_FLAME:
              this.kill()
              break
            case BULLET_STYLE_ARROW:
              if (this.timeOut > ARROW_RESIST) {
                gs.bulletParts.forces[this.num].y = gs.bulletParts.forces[this.num].y - gs.bulletParts.gravity
                this.hit(HIT_TYPE_WALL)
                this.kill()
              }
              break
            case BULLET_STYLE_M79:
            case BULLET_STYLE_FLAMEARROW:
            case BULLET_STYLE_LAW:
              this.hit(HIT_TYPE_EXPLODE) // plays m79 explosion sound
              this.kill()
              break
            case BULLET_STYLE_CLUSTERNADE:
              this.hit(HIT_TYPE_CLUSTERNADE)
              this.kill()
              break
            case BULLET_STYLE_CLUSTER:
              this.hit(HIT_TYPE_CLUSTER)
              this.kill()
              break
          } // switch

          result = cloneVec2(pos)
          return result
        }
      }
    } // for j

    return result
  }

  // Bullets.pas:2120-2362 TBullet.Hit — 히트 이펙트/사운드/스파크 분기 (HIT_TYPE_*별).
  // 스파크는 규약 12로 채택, 사운드는 규약 11의 gs.playSound 훅. HIT_TYPE_EXPLODE/FRAGNADE/
  // CLUSTER/FLAK는 ExplosionHit로 위임 (게임플레이 대미지). r_maxsparks는 상수 MAX_SPARKS 고정.
  hit(t: number, spriteHit = 0, where = 0): void {
    const gs = this.gs
    let a: TVector2
    let b: TVector2

    switch (t) {
      case HIT_TYPE_WALL: {
        b = cloneVec2(gs.bulletParts.velocity[this.num])
        a = vec2Add(gs.bulletParts.pos[this.num], gs.bulletParts.velocity[this.num])
        b = vec2Scale(b, -0.06)
        b.y = b.y - 1.0

        b.x = b.x * (0.6 + random(8) / 10)
        b.y = b.y * (0.8 + random(4) / 10)
        createSpark(gs, a, b, 3, this.owner, 60)

        b.x = b.x * (0.8 + random(4) / 10)
        b.y = b.y * (0.6 + random(8) / 10)
        createSpark(gs, a, b, 3, this.owner, 65)

        b = vec2Scale(b, 0.4 + random(4) / 10)
        createSpark(gs, a, b, 1, this.owner, 60)

        b.x = b.x * (0.5 + random(4) / 10)
        b.y = b.y * (0.7 + random(8) / 10)
        createSpark(gs, a, b, 3, this.owner, 50)

        b.x = 0
        b.y = 0
        if (MAX_SPARKS > MAX_SPARKS - 5) createSpark(gs, a, b, 56, this.owner, 22)

        if (this.timeOut < BULLET_TIMEOUT - 5) {
          gs.playSound(SFX_RIC + random(4), gs.bulletParts.pos[this.num])
        }
        break
      }

      case HIT_TYPE_BLOOD: {
        b = cloneVec2(gs.bulletParts.velocity[this.num])
        a = cloneVec2(gs.bulletParts.pos[this.num])
        b = vec2Scale(b, 0.025)
        b.x = b.x * 1.2
        b.y = b.y * 0.85
        createSpark(gs, a, b, 4, this.owner, 70)

        b.x = b.x * 0.745
        b.y = b.y * 1.1
        createSpark(gs, a, b, 4, this.owner, 75)
        b.x = b.x * 0.9
        b.y = b.y * 0.85
        if (random(2) === 0) createSpark(gs, a, b, 4, this.owner, 75)

        b.x = b.x * 1.2
        b.y = b.y * 0.85
        createSpark(gs, a, b, 5, this.owner, 80)

        b.x = b.x * 1
        b.y = b.y * 1
        createSpark(gs, a, b, 5, this.owner, 85)

        b.x = b.x * 0.5
        b.y = b.y * 1.05
        if (random(2) === 0) createSpark(gs, a, b, 5, this.owner, 75)

        for (let i = 1; i <= 7; i++) {
          if (random(6) === 0) {
            b.x = Math.sin(random(100)) * 1.6
            b.y = Math.cos(random(100)) * 1.6
            createSpark(gs, a, b, 4, this.owner, 55)
          }
        }
        break
      }

      case HIT_TYPE_EXPLODE: {
        a = vector2(0.0, 0.0)
        if (MAX_SPARKS > MAX_SPARKS - 10) createSpark(gs, gs.bulletParts.pos[this.num], a, 60, this.owner, 255)
        if (MAX_SPARKS > MAX_SPARKS - 10)
          createSpark(gs, gs.bulletParts.pos[this.num], a, 54, this.owner, SMOKE_ANIMS * 4 + 10)
        createSpark(gs, gs.bulletParts.pos[this.num], a, 12, this.owner, EXPLOSION_ANIMS * 3)
        gs.playSound(SFX_M79_EXPLOSION, gs.bulletParts.pos[this.num])

        this.explosionHit(HIT_TYPE_EXPLODE, spriteHit, where)
        break
      }

      case HIT_TYPE_FRAGNADE: {
        a = vector2(0.0, 0.0)
        if (MAX_SPARKS > MAX_SPARKS - 10) createSpark(gs, gs.bulletParts.pos[this.num], a, 60, this.owner, 190)
        if (MAX_SPARKS > MAX_SPARKS - 10)
          createSpark(gs, gs.bulletParts.pos[this.num], a, 54, this.owner, SMOKE_ANIMS * 4 + 10)
        createSpark(gs, gs.bulletParts.pos[this.num], a, 17, this.owner, EXPLOSION_ANIMS * 3)
        gs.playSound(SFX_GRENADE_EXPLOSION, gs.bulletParts.pos[this.num])

        this.explosionHit(HIT_TYPE_FRAGNADE, spriteHit, where)
        break
      }

      case HIT_TYPE_THING: {
        b = cloneVec2(gs.bulletParts.velocity[this.num])
        a = vec2Add(gs.bulletParts.pos[this.num], gs.bulletParts.velocity[this.num])
        b = vec2Scale(b, -0.02)
        b = vec2Scale(b, 0.4 + random(4) / 10)
        createSpark(gs, a, b, 1, this.owner, 70)

        gs.playSound(SFX_BODYFALL, gs.bulletParts.pos[this.num])
        break
      }

      case HIT_TYPE_CLUSTERNADE: {
        b = vector2(0, 0)
        createSpark(gs, gs.bulletParts.pos[this.num], b, 29, this.owner, 55)
        gs.playSound(SFX_CLUSTERGRENADE, gs.bulletParts.pos[this.num])

        a = vec2Subtract(gs.bulletParts.pos[this.num], gs.bulletParts.velocity[this.num])

        for (let i = 1; i <= 5; i++) {
          b = cloneVec2(gs.bulletParts.velocity[this.num])
          b = vec2Scale(b, -0.75)
          b.x = -b.x - 2.5 + random(50) / 10
          b.y = b.y - 2.5 + random(25) / 10
          createBullet(gs, a, b, guns[CLUSTER].num, this.owner, 255, guns[FRAGGRENADE].hitMultiply / 2, true, false)
        }
        break
      }

      case HIT_TYPE_CLUSTER: {
        a = vector2(0.0, 0.0)
        createSpark(gs, gs.bulletParts.pos[this.num], a, 28, this.owner, EXPLOSION_ANIMS * 3)
        gs.playSound(SFX_CLUSTER_EXPLOSION, gs.bulletParts.pos[this.num])

        this.explosionHit(HIT_TYPE_CLUSTER, spriteHit, where)
        break
      }

      case HIT_TYPE_FLAK: {
        a = vector2(0.0, 0.0)
        createSpark(gs, gs.bulletParts.pos[this.num], a, 29, this.owner, 55)
        gs.playSound(SFX_M2EXPLODE, gs.bulletParts.pos[this.num])

        this.explosionHit(HIT_TYPE_FLAK, spriteHit, where)
        break
      }

      // {$IFNDEF SERVER} — 클라 전용 장식 스파크(규약 12로 채택). BODYHIT: r_maxsparks<... 조기탈출은
      // 상수 MAX_SPARKS 고정 시 항상 거짓이라 무조건 진행.
      case HIT_TYPE_BODYHIT: {
        if (MAX_SPARKS < MAX_SPARKS - 10) return

        b = cloneVec2(gs.bulletParts.velocity[this.num])
        a = cloneVec2(gs.bulletParts.pos[this.num])
        b = vec2Scale(b, 0.075)

        b.x = b.x * 1.2
        b.y = b.y * 0.85
        createSpark(gs, a, b, 4, this.owner, 60)
        b.x = b.x * 0.745
        b.y = b.y * 1.1
        createSpark(gs, a, b, 4, this.owner, 65)
        b.x = b.x * 1.5
        b.y = b.y * 0.4
        createSpark(gs, a, b, 5, this.owner, 70)
        b.x = b.x * 1
        b.y = b.y * 1
        createSpark(gs, a, b, 5, this.owner, 75)
        b.x = b.x * 0.4
        b.y = b.y * 1.15

        for (let i = 1; i <= 4; i++) {
          if (random(6) === 0) {
            b.x = Math.sin(random(100)) * 1.2
            b.y = Math.cos(random(100)) * 1.2
            createSpark(gs, a, b, 4, this.owner, 50)
          }
        }
        break
      }

      case HIT_TYPE_RICOCHET: {
        a = vec2Add(gs.bulletParts.pos[this.num], gs.bulletParts.velocity[this.num])

        b = vector2(-2.0 + random(40) / 10, -2.0 + random(40) / 10)
        createSpark(gs, a, b, 26, this.owner, 35)
        b = vector2(-2.0 + random(40) / 10, -2.0 + random(40) / 10)
        createSpark(gs, a, b, 26, this.owner, 35)
        b = vector2(-3.0 + random(60) / 10, -3.0 + random(60) / 10)
        createSpark(gs, a, b, 26, this.owner, 35)
        b = vector2(-3.0 + random(60) / 10, -3.0 + random(60) / 10)
        createSpark(gs, a, b, 26, this.owner, 35)
        b = vector2(-3.0 + random(60) / 10, -3.0 + random(60) / 10)
        createSpark(gs, a, b, 26, this.owner, 35)
        b = vector2(-3.0 + random(60) / 10, -3.0 + random(60) / 10)
        createSpark(gs, a, b, 27, this.owner, 35)

        gs.playSound(SFX_RIC5 + random(3), gs.bulletParts.pos[this.num])
        break
      }
    } // switch
  }

  // Bullets.pas:2364-2683 TBullet.ExplosionHit — 폭발 반경 대미지/넉백.
  // 생존/랙돌 이중 루프 + 씽 임펄스 + 체인 기폭. 규약 10: srv 곱셈 제거(서버 수식). Where=1 하드코딩과
  // Active:=False 중간 세팅(2557) 원본 보존. {$IFNDEF SERVER} 장식 스파크류는 규약 12로 채택.
  explosionHit(typ: number, spriteHit: number, where: number): void {
    const gs = this.gs

    const afterExplosionRadius2 = AFTER_EXPLOSION_RADIUS * AFTER_EXPLOSION_RADIUS
    const bodyParts = [12, 11, 10, 6, 5, 4, 3]

    let iGun: number
    let explosionRadius: number
    switch (typ) {
      case HIT_TYPE_FRAGNADE:
        iGun = FRAGGRENADE
        explosionRadius = FRAGGRENADE_EXPLOSION_RADIUS
        break
      case HIT_TYPE_EXPLODE:
        iGun = M79
        explosionRadius = M79GRENADE_EXPLOSION_RADIUS
        break
      case HIT_TYPE_CLUSTER:
      case HIT_TYPE_FLAK:
        iGun = FRAGGRENADE
        explosionRadius = CLUSTERGRENADE_EXPLOSION_RADIUS
        break
      default:
        return
    }

    const explosionRadius2 = explosionRadius * explosionRadius

    // check explosion collision with sprites
    for (let i = 1; i <= MAX_SPRITES; i++) {
      if (!gs.sprite[i].active || gs.sprite[i].isSpectator()) continue

      const noCollision = guns[weaponNumToIndex(this.ownerWeapon)].noCollision

      if ((noCollision & WEAPON_NOCOLLISION_EXP_ENEMY) !== 0 && gs.sprite[i].isNotInSameTeam(gs.sprite[this.owner]))
        continue
      if (
        (noCollision & WEAPON_NOCOLLISION_EXP_TEAM) !== 0 &&
        gs.sprite[i].isInSameTeam(gs.sprite[this.owner]) &&
        i !== this.owner
      )
        continue
      if ((noCollision & WEAPON_NOCOLLISION_EXP_SELF) !== 0 && this.owner === i) continue

      if (!gs.sprite[i].deadMeat) {
        let col = this.getSpriteCollisionPoint(i)
        let hitboxModifier = 1.0

        let a = vector2(0, 0)
        let s = 0
        let s2 = 0.0

        // if hitpoint is not given find closest one
        let w = where
        if (i !== spriteHit || where === 0) {
          s = Number.MAX_VALUE
          for (let j = 0; j < bodyParts.length; j++) {
            a = vector2(
              col.x + (gs.sprite[i].skeleton.pos[bodyParts[j]].x - gs.spriteParts.pos[i].x),
              col.y + (gs.sprite[i].skeleton.pos[bodyParts[j]].y - gs.spriteParts.pos[i].y),
            )
            a = vec2Subtract(gs.bulletParts.pos[this.num], a)
            s2 = vec2Length2(a)

            if (s2 < s) {
              s = s2 // squared distance
              w = bodyParts[j] // hitpoint index
            }
          }
        }

        if (w <= 4) hitboxModifier = guns[iGun].modifierLegs
        else if (w <= 11) hitboxModifier = guns[iGun].modifierChest
        else hitboxModifier = guns[iGun].modifierHead

        col = vector2(
          col.x + (gs.sprite[i].skeleton.pos[w].x - gs.spriteParts.pos[i].x),
          col.y + (gs.sprite[i].skeleton.pos[w].y - gs.spriteParts.pos[i].y),
        )

        a = vec2Subtract(gs.bulletParts.pos[this.num], col)
        s = vec2Length2(a)

        if (s < explosionRadius2) {
          s = Math.sqrt(s)

          createSpark(gs, gs.spriteParts.pos[i], vector2(0, -0.01), 5, this.owner, 80)
          gs.playSound(SFX_EXPLOSION_ERG, gs.spriteParts.pos[i])

          // collision respond
          a.x = a.x * (1 / (s + 1)) * EXPLOSION_IMPACT_MULTIPLY
          a.y = a.y * (1 / (s + 1)) * EXPLOSION_IMPACT_MULTIPLY

          if (typ === HIT_TYPE_FRAGNADE || typ === HIT_TYPE_EXPLODE) a.y *= 2.0
          else hitboxModifier *= 0.5 // cluster/flak is halved

          // Player.PingTicks 네트 필드(로컬 심 0) → div 2 = 0.
          let pushTick = 0 + this.ownerPingTick + 1
          pushTick = Math.min(pushTick, MAX_PUSHTICK)
          gs.sprite[i].nextPush[pushTick].x -= a.x
          gs.sprite[i].nextPush[pushTick].y -= a.y

          if (gs.sprite[i].ceaseFireCounter < 0) {
            s = (1 / (s + 1)) * guns[iGun].hitMultiply * hitboxModifier
            // 규약 10: 서버 수식. Where=1 하드코딩 보존.
            gs.sprite[i].healthHit(s, this.owner, 1, this.num, a)
          }
        } // s < explosion radius
      } // not DeadMeat

      if (gs.sprite[i].deadMeat) {
        let partHit = false
        let s2 = 0.0
        // `a`는 j 루프 전체에서 공유되는 지역변수 — 루프 종료 후 j=16의 값(반경 안이면 스케일된 값,
        // 밖이면 raw subtract)이 그대로 healthHit impact 인자로 넘어간다 (원본 공유 시맨틱 보존).
        let a = vector2(0, 0)

        for (let j = 1; j <= 16; j++) {
          a = vec2Subtract(gs.bulletParts.pos[this.num], gs.sprite[i].skeleton.pos[j])
          let s = vec2Length2(a)

          if (s < explosionRadius2) {
            s = Math.sqrt(s)
            a = vec2Scale(a, (1 / (s + 1)) * EXPLOSION_DEADIMPACT_MULTIPLY)
            gs.sprite[i].skeleton.oldPos[j].x += a.x
            gs.sprite[i].skeleton.oldPos[j].y += a.y

            partHit = true
            s2 = s
          }
        }

        if (partHit) {
          let hitboxModifier = 1.0

          if (typ === HIT_TYPE_EXPLODE) s2 = Math.max(s2, 20.0000001)
          else if (typ === HIT_TYPE_CLUSTER || typ === HIT_TYPE_FLAK) hitboxModifier = 0.5

          s2 = (1 / (s2 + 1)) * guns[iGun].hitMultiply * hitboxModifier
          // Where=1 하드코딩 보존. impact 인자 = 위 루프 마지막 a (원본 그대로).
          gs.sprite[i].healthHit(s2, this.owner, 1, this.num, a)
        }
      }
    } // for Sprite[i]

    // check explosion collision with things
    for (let i = 1; i <= MAX_THINGS; i++) {
      if (!gs.thing[i].active || !gs.thing[i].collideWithBullets) continue

      for (let j = 1; j <= 4; j++) {
        let a = vec2Subtract(gs.bulletParts.pos[this.num], gs.thing[i].skeleton.pos[j])
        let s = vec2Length2(a)

        if (s < explosionRadius2) {
          s = Math.sqrt(s)
          a = vec2Scale(a, 0.5 * (1 / (s + 1)) * EXPLOSION_IMPACT_MULTIPLY)
          gs.thing[i].skeleton.oldPos[j].x += a.x
          gs.thing[i].skeleton.oldPos[j].y += a.y
          gs.thing[i].staticType = false
        }
      }
    } // for Thing[i]

    // ⚠ 원본 2553-2554: `if not Typ in [HIT_TYPE_FRAGNADE, HIT_TYPE_EXPLODE] then Exit;`
    // Pascal에서 `not`는 `in`보다 우선순위가 높아 `(not Typ) in [...]`로 파싱된다. `not Typ`는
    // 정수 비트보수(양수 Typ→음수)라 집합 [3,4]에 절대 포함되지 않으므로 조건은 **항상 거짓** →
    // Exit는 결코 실행되지 않는다 (FPC로 검증: FRAGNADE/EXPLODE/CLUSTER/FLAK 모두 chain 진입).
    // 따라서 아래 Active:=False + 체인 기폭 루프는 모든 폭발 타입에서 실행된다 — 업스트림 버그를
    // 그대로 보존한다 (원본 라인은 dead code라 옮기지 않음).

    // check explosion collision with bullets — Active:=False 중간 세팅(2557) 원본 보존.
    this.active = false
    for (let i = 1; i <= MAX_BULLETS; i++) {
      if (
        i !== this.num &&
        gs.bullet[i].active &&
        (gs.bullet[i].style === BULLET_STYLE_FRAGNADE ||
          gs.bullet[i].style === BULLET_STYLE_M79 ||
          gs.bullet[i].style === BULLET_STYLE_LAW)
      ) {
        const a = vec2Subtract(gs.bulletParts.pos[this.num], gs.bulletParts.pos[i])
        const s = vec2Length2(a)

        if (s < afterExplosionRadius2) {
          switch (gs.bullet[i].style) {
            case BULLET_STYLE_FRAGNADE:
              gs.bullet[i].hit(HIT_TYPE_FRAGNADE)
              break
            case BULLET_STYLE_M79:
              gs.bullet[i].hit(HIT_TYPE_EXPLODE)
              break
            case BULLET_STYLE_LAW:
              gs.bullet[i].hit(HIT_TYPE_EXPLODE)
              break
          }
          gs.bullet[i].kill()
        }
      }
    }

    // {$IFNDEF SERVER} Grenade Effect(화면 흔들림/HUM) + dirt/iskry/plomyki 장식 스파크 — 규약 11/12.
    // 카메라·GrenadeEffectTimer는 클라 상태(규약 11)라 생략하고, 장식 스파크(규약 12)는 채택한다.
    let aSpark = vec2Subtract(gs.bulletParts.pos[this.num], gs.bulletParts.velocity[this.num])
    let b: TVector2

    // dirt fly
    if (MAX_SPARKS > MAX_SPARKS - 10) {
      const n = typ === HIT_TYPE_FRAGNADE ? 6 : 7
      const s = typ === HIT_TYPE_FRAGNADE ? -0.2 : -0.15
      for (let i = 1; i <= n; i++) {
        b = vec2Scale(gs.bulletParts.velocity[this.num], s)
        b.x = -b.x - 3.5 + random(70) / 10
        b.y = b.y - 3.5 + random(65) / 10
        if (random(4) === 0) createSpark(gs, aSpark, b, 40, this.owner, 180 + random(50))
        if (random(4) === 0) createSpark(gs, aSpark, b, 41, this.owner, 180 + random(50))
        if (random(4) === 0) createSpark(gs, aSpark, b, 42, this.owner, 180 + random(50))
        if (random(4) === 0) createSpark(gs, aSpark, b, 43, this.owner, 180 + random(50))
      }
    }

    // smaller dirt fly
    if (MAX_SPARKS > MAX_SPARKS - 10) {
      const n = typ === HIT_TYPE_FRAGNADE ? 7 : 5
      const s = typ === HIT_TYPE_FRAGNADE ? -0.2 : -0.15
      const rnd = typ === HIT_TYPE_FRAGNADE ? 4 : 3
      for (let i = 1; i <= n; i++) {
        b = vec2Scale(gs.bulletParts.velocity[this.num], s)
        b.x = -b.x - 3.5 + random(70) / 10
        b.y = b.y - 3.5 + random(65) / 10
        if (random(rnd) === 0) createSpark(gs, aSpark, b, 44, this.owner, 120)
        if (random(rnd) === 0) createSpark(gs, aSpark, b, 45, this.owner, 120)
        if (random(rnd) === 0) createSpark(gs, aSpark, b, 46, this.owner, 120)
        if (random(rnd) === 0) createSpark(gs, aSpark, b, 47, this.owner, 120)
      }
    }

    // iskry fly
    if (MAX_SPARKS > MAX_SPARKS - 10) {
      const n = typ === HIT_TYPE_FRAGNADE ? 3 : 4
      const rnd = typ === HIT_TYPE_FRAGNADE ? 23 : 22
      for (let i = 1; i <= n; i++) {
        b = vec2Scale(gs.bulletParts.velocity[this.num], -0.3)
        b.x = -b.x - 3.5 + random(70) / 10
        b.y = b.y - 3.5 + random(65) / 10
        if (random(rnd) === 0) createSpark(gs, aSpark, b, 2, this.owner, 120)
        if (random(rnd) === 0) createSpark(gs, aSpark, b, 2, this.owner, 120)
        if (random(rnd) === 0) createSpark(gs, aSpark, b, 2, this.owner, 120)
      }
    }

    // plomyki
    if (MAX_SPARKS > MAX_SPARKS - 10) {
      const n = typ === HIT_TYPE_FRAGNADE ? 3 : 4
      const jj = typ === HIT_TYPE_FRAGNADE ? 25 : 20
      const rnd = typ === HIT_TYPE_FRAGNADE ? 50 : 40
      const s = typ === HIT_TYPE_FRAGNADE ? -0.05 : -0.1
      for (let i = 1; i <= n; i++) {
        aSpark.x = aSpark.x - jj + random(rnd)
        aSpark.y = aSpark.y - jj + random(rnd)
        b = vec2Scale(gs.bulletParts.velocity[this.num], s)
        b.x = -b.x - 3.5 + random(70) / 10
        b.y = b.y - 3.5 + random(65) / 10
        createSpark(gs, aSpark, b, 64, this.owner, 35)
      }
    }
  }

  // Bullets.pas:2685-2700 TBullet.CheckOutOfBounds
  checkOutOfBounds(): void {
    const gs = this.gs
    const bound = gs.map.sectorsNum * gs.map.sectorsDivision - 10
    const p = gs.bulletParts.pos[this.num]

    if (Math.abs(p.x) > bound || Math.abs(p.y) > bound) {
      this.kill()
    }
  }

  // Bullets.pas:2702-2733 TBullet.FilterSpritesByDistance — 타깃 가능 스프라이트를 근접거리 오름차순
  // 삽입정렬로 채운다. spriteIndexes는 var-out (1-based, idx 0 미사용). Move(...) 오버랩 시프트를
  // 고차→저차 복사로 재현.
  filterSpritesByDistance(spriteIndexes: number[]): number {
    let spriteCount = 0
    const distances: number[] = new Array(MAX_SPRITES + 2).fill(0)

    for (let i = 1; i <= MAX_SPRITES; i++) {
      if (this.targetableSprite(i)) {
        const roughDistance = this.getComparableSpriteDistance(i)

        spriteCount++
        let j = spriteCount
        while (j > 1 && roughDistance < distances[j - 1]) j = j - 1

        // Move(Distances[j], Distances[j+1], (SpriteCount - j)) — [j..count-1] → [j+1..count].
        for (let k = spriteCount; k > j; k--) {
          distances[k] = distances[k - 1]
          spriteIndexes[k] = spriteIndexes[k - 1]
        }
        distances[j] = roughDistance
        spriteIndexes[j] = i
      }
    }

    return spriteCount
  }

  // Bullets.pas:2735-2752 TBullet.TargetableSprite — 소유자 자기피격 유예/HitBody/스펙테이터 게이트.
  targetableSprite(i: number): boolean {
    const gs = this.gs
    let ownerVulnerableTime: number
    if (this.style === BULLET_STYLE_FRAGNADE) ownerVulnerableTime = GRENADE_TIMEOUT - 50
    else if (this.style === BULLET_STYLE_M2) ownerVulnerableTime = M2BULLET_TIMEOUT - 20
    else if (this.style === BULLET_STYLE_FLAME) ownerVulnerableTime = FLAMER_TIMEOUT
    else ownerVulnerableTime = BULLET_TIMEOUT - 20

    return (
      gs.sprite[i].active &&
      (this.owner !== i || this.timeOut < ownerVulnerableTime) &&
      this.hitBody !== i &&
      gs.sprite[i].isNotSpectator()
    )
  }

  // Bullets.pas:2754-2764 TBullet.GetComparableSpriteDistance — 정렬용 제곱거리(Sqrt 생략).
  getComparableSpriteDistance(i: number): number {
    const spriteCol = this.getSpriteCollisionPoint(i)
    const distance = vec2Subtract(this.gs.bulletParts.pos[this.num], spriteCol)
    return distance.x * distance.x + distance.y * distance.y
  }

  // Bullets.pas:2766-2789 TBullet.GetSpriteCollisionPoint — 규약 8a: 서버 분기 채택.
  // {$IFNDEF SERVER} FLAME 예외 + 핑 보정(OldSpritePos)은 클라 전용 — 로컬 심은 SpriteParts.Pos.
  getSpriteCollisionPoint(i: number): TVector2 {
    return cloneVec2(this.gs.spriteParts.pos[i])
  }

  // Bullets.pas:2791-2806 TBullet.GetWeaponIndex
  getWeaponIndex(): number {
    for (let weaponIndex = 1; weaponIndex <= guns.length - 1; weaponIndex++) {
      if (this.ownerWeapon === guns[weaponIndex].num) {
        return weaponIndex
      }
    }
    return 0 // Not possible (원본 주석)
  }
}

/* ****************************************************************************
 *                    CreateBullet (Bullets.pas:94-357)                       *
 **************************************************************************** */

export function createBullet(
  gs: GameState,
  sPosIn: TVector2,
  sVelocity: TVector2,
  sNum: number,
  sOwner: number,
  n: number,
  hitM: number,
  net: boolean,
  mustCreate: boolean,
  seed = -1,
): number {
  // Pascal의 sPos는 값 파라미터(로컬 복사) — FLAME 스폰 전진(221-226)이 로컬만 수정한다.
  const sPos = cloneVec2(sPosIn)

  const weaponIndex = weaponNumToIndex(sNum)
  const sStyle = guns[weaponIndex].bulletStyle

  // Bullets.pas:108-111 {$IFNDEF SERVER} DemoPlayer 게이트 — 클라 데모 재생 전용, 생략.

  // Bullets.pas:117-128 발사억제 게이트 — 규약 8b: 네트워크 지연 보정(원격 인간 플레이어의
  // 고속 연사 탄환을 로컬 생성 대신 스냅샷에 맡기는 최적화). 이 심은 권위 로컬(원격 클라가
  // 없음)이라 게이트 자체가 무의미 — shape만 보존.
  // if not MustCreate and (sOwner > 0) then
  //   if {client: (sOwner <> MySprite) and} (Sprite[sOwner].Player.ControlMethod <> BOT) and
  //      ((Sprite[sOwner].Weapon.FireInterval > FIREINTERVAL_NET)
  //       or (((sStyle = FRAGNADE) or (sStyle = CLUSTERNADE)) {client: and False})) then
  //     {client: if BulletCanSend(...) then} Exit;

  let i: number
  if (n === 255) {
    i = -1
    for (let k = 1; k <= MAX_BULLETS + 1; k++) {
      if (k === MAX_BULLETS + 1) {
        return -1
      }
      if (!gs.bullet[k].active) {
        i = k
        break
      }
    }
  } else {
    i = n
  }

  // i is now the active sprite
  // activate sprite
  gs.bullet[i].active = true
  // {$IFNDEF SERVER} Bullet[i].HasHit := False — 클라 전용 필드, 생략.
  gs.bullet[i].style = sStyle
  gs.bullet[i].num = i
  gs.bullet[i].owner = sOwner
  gs.bullet[i].timeOut = guns[weaponIndex].timeout
  // 규약 9: 원본은 {$IFNDEF SERVER}에서만 초기화(165-171, 원본 자체에 "TODO: Check if this
  // should be used also in server") — 공용 코드가 읽으므로 무조건 초기화한다.
  gs.bullet[i].timeOutPrev = guns[weaponIndex].timeout
  gs.bullet[i].hitMultiply = hitM
  gs.bullet[i].hitMultiplyPrev = hitM // 규약 9 (169-171)
  gs.bullet[i].whizzed = false

  // {client: (sOwner = CameraFollowSprite) or} — 서버 분기 채택 (규약 8a)
  if (sStyle === BULLET_STYLE_FLAMEARROW || sStyle === BULLET_STYLE_FLAME) {
    gs.bullet[i].whizzed = true
  }

  if (gs.sprite[sOwner].player!.controlMethod === HUMAN) {
    // Sprite[sOwner].Player.PingTicksB {$IFDEF SERVER} + PingTicksAdd(=0, Net.pas:853){$ENDIF}
    // — PingTicksB는 Net.pas TPlayer 필드로 미포팅이며 네트워크 없는 로컬 심에선 항상 0.
    gs.bullet[i].ownerPingTick = 0
  } else {
    gs.bullet[i].ownerPingTick = 0
  }

  gs.bullet[i].ownerWeapon = sNum
  gs.bullet[i].hitBody = 0
  gs.bullet[i].hitSpot.x = 0
  gs.bullet[i].hitSpot.y = 0
  gs.bullet[i].tracking = 0

  // Bullets.pas:189-196 — 클라 분기(AimDistCoef<DEFAULTAIMDIST → Tracking=255,
  // ImageStyle=Weapon.BulletImageStyle)는 카메라 추적/렌더 전용이라 생략하고 {$ELSE}(서버)
  // 분기를 채택한다 (규약 8a): Initial := sPos. (아래 228에서 FLAME 전진 반영 후 한 번 더
  // 대입된다 — 원본 그대로 이중 대입.)
  gs.bullet[i].initial = cloneVec2(sPos)

  gs.bullet[i].startUpTime = gs.mainTickCounter
  gs.bullet[i].ricochetCount = 0
  gs.bullet[i].degradeCount = 0 // 규약 9 (199-203; PingAdd/PingAddStart는 클라 전용이라 생략)

  if (seed === -1) {
    if (gs.sprite[sOwner].bulletCount === 65535 /* High(Word) */) {
      gs.sprite[sOwner].bulletCount = 0
    } else {
      gs.sprite[sOwner].bulletCount++
    }
    seed = gs.sprite[sOwner].bulletCount
  }
  gs.bullet[i].seed = seed

  const mass = 1.0

  if (!mustCreate) {
    if (sStyle === BULLET_STYLE_FLAME) {
      sPos.x = sPos.x + sVelocity.x
      sPos.y = sPos.y + sVelocity.y
    }
  }

  gs.bullet[i].initial = cloneVec2(sPos)

  // activate sprite part
  gs.bulletParts.createPart(sPos, sVelocity, mass, i)

  // Bullets.pas:236-259 {$IFNDEF SERVER} SEND BULLET THROUGH NETWORK (ClientSendBullet /
  // ForceClientSpriteSnapshotMov) — 규약 8b. TODO(M3) NET: ClientSendBullet(i)
  // Bullets.pas:261-334 {$IFNDEF SERVER} WepStats 사격 통계 — 규약 8c: HUD 통계는 웹 레이어(M4).
  // Bullets.pas:335-349 {$ELSE}(서버) 네트 스냅샷 — 규약 8b.
  // TODO(M3) NET: if Net then ServerBulletSnapshot(i, 0/j, False)
  if (net) {
    // (자리만 보존 — 네트 전송은 M3)
  }

  return i
}

// Bullets.pas:359-379 {$IFDEF SERVER} ServerCreateBullet — 규약 8a 채택. M2의 표준 스폰 진입점.
// `net`은 원본 필수 인자지만 로컬 심은 전송할 곳이 없으므로 기본값 false를 둔다 (TODO(M3) NET).
export function serverCreateBullet(
  gs: GameState,
  sPos: TVector2,
  sVelocity: TVector2,
  sNum: number,
  sOwner: number,
  n: number,
  hitM: number,
  net = false,
): number {
  if (sOwner <= 0 || sOwner >= MAX_SPRITES) {
    // ⚠ 원본 가드 그대로: `>= MAX_SPRITES`라 32번(마지막 슬롯) 소유 탄환도 거부된다 — 보존.
    return -1
  }

  const i = createBullet(gs, sPos, sVelocity, sNum, sOwner, n, hitM, net, true, 0)

  // 원본은 i 검사 없이 Bullet[i]에 쓴다 — 풀 포화로 CreateBullet이 -1을 돌려주면 Pascal은
  // 범위 밖 접근(레인지체크 오류/UB)이 된다 (업스트림 잠재 버그). TS에서는 UB를 재현할 수
  // 없으므로 여기서만 가드한다 (동작 차이: 풀 포화 시 조용히 -1 반환).
  if (i > 0) {
    gs.bullet[i].ownerPingTick = 0
    gs.bullet[i].dontCheat = true
  }

  // TODO(M3) NET: if Net then ServerBulletSnapshot(i, 0, True)

  return i
}

// Bullets.pas:381-419 BulletCanSend — 탄환 스냅샷 가시성 판정 (네트 전송 게이트). 호출부가 전부
// 주석 처리된 네트 블록 안이라 이 태스크에서는 포팅하지 않는다. TODO(M3) NET.
// Bullets.pas:421-526 {$IFNDEF SERVER} CanHitSpray / HitSpray / CalculateRecoil — 클라 로컬
// 피격 스프레이·리코일 커서 변조 (MySprite/HitSprayCounter 의존). 규약 8c — 웹 레이어 소관.
