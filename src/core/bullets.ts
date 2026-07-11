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
import { type TVector2, vector2, cloneVec2, vec2Subtract, vec2Scale, vec2Normalize, vec2Length } from './vector'
import { pascalRound, trunc, random } from './pascal'
import {
  guns,
  weaponNumToIndex,
  BARRETT,
  M79,
  KNIFE,
  LAW,
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
} from './weapons'
import { MAX_BULLETS, MAX_SPRITES, HUMAN, GRENADE_SURFACECOEF, teamCollides } from './sprites'
import {
  POLY_TYPE_ONLY_PLAYER,
  POLY_TYPE_DOESNT,
  POLY_TYPE_ONLY_FLAGGERS,
  POLY_TYPE_NOT_FLAGGERS,
  POLY_TYPE_BACKGROUND,
  POLY_TYPE_BACKGROUND_TRANSITION,
} from './polymap'
import { BULLET_TIMEOUT, ARROW_RESIST, SFX_GRENADE_BOUNCE, SFX_BULLETBY, OBJECT_COMBAT_KNIFE } from './constants'
import { createSpark } from './sparks'
import { createThing, type TThingCollision } from './things'
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

  // Bullets.pas:1361-1900 TBullet.CheckSpriteCollision — TODO(T8): 스프라이트 피격 판정 전체
  // (부위 판정 BodyPartsPriority, 대미지 수식, FLAME 재점화 임계(규약 13 — 서버 값 채택 예정),
  // 체인 CreateBullet). 지금은 "무충돌"(Result 기본값 (0,0) — Update의 HitP3.x=0 판정과 정합)만
  // 반환한다.
  // eslint 없음 — 미사용 인자 이름 앞 _ 로 tsc(noUnusedParameters) 회피.
  checkSpriteCollision(_lastHitDist: number): TVector2 {
    return vector2(0, 0)
  }

  // Bullets.pas:1902-2004 TBullet.CheckThingCollision — TODO(T8): 씽(깃발 등) 피격 + ThingCollisions
  // 쿨다운 기록. 지금은 무충돌 반환.
  checkThingCollision(_lastHitDist: number): TVector2 {
    return vector2(0, 0)
  }

  // Bullets.pas:2006-2118 TBullet.CheckColliderCollision — TODO(T8): 맵 콜라이더(원형 장애물) 충돌.
  // 지금은 무충돌 반환 (Update의 HitP2.x=0 판정과 정합).
  checkColliderCollision(_lastHitDist: number): TVector2 {
    return vector2(0, 0)
  }

  // Bullets.pas:2120-2362 TBullet.Hit — TODO(T8): 히트 이펙트/사운드/스파크 분기 (HIT_TYPE_*별).
  // 지금은 no-op (테스트는 스파이로 호출 여부/인자만 검증).
  hit(_t: number, _spriteHit = 0, _where = 0): void {}

  // Bullets.pas:2364-2683 TBullet.ExplosionHit — TODO(T8): 폭발 반경 대미지/넉백 (규약 10 —
  // srv*damage 클라 관용구 제거하고 서버 수식 채택 예정).
  explosionHit(_typ: number, _spriteHit: number, _where: number): void {}

  // Bullets.pas:2685-2700 TBullet.CheckOutOfBounds
  checkOutOfBounds(): void {
    const gs = this.gs
    const bound = gs.map.sectorsNum * gs.map.sectorsDivision - 10
    const p = gs.bulletParts.pos[this.num]

    if (Math.abs(p.x) > bound || Math.abs(p.y) > bound) {
      this.kill()
    }
  }

  // Bullets.pas:2702-2733 FilterSpritesByDistance / 2735-2752 TargetableSprite /
  // 2754-2764 GetComparableSpriteDistance / 2766-2789 GetSpriteCollisionPoint — TODO(T8):
  // CheckSpriteCollision 전용 헬퍼 4종. T8에서 함께 포팅.

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
