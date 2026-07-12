// 1:1 포팅: soldat-ref/soldat/shared/mechanics/Things.pas (2312 lines) — 1부 (M2 Task 5)
// TThing — 깃발/무기드롭/키트/낙하산/고정포 오브젝트: 구조·생성·스켈레톤 물리·맵 충돌·
// 깃발 캐리 부착·타임아웃/경계 밖/리스폰.
//
// 이 태스크(Task 5) 스코프
// ------------------------
// * 채택(실동작):
//   - TThingCollision (8-11) — T4에서 bullets.ts에 임시 정의했던 것을 여기로 이관
//     (bullets.ts는 re-export로 전환).
//   - TThing 필드 전체 (13-50) — {$IFNDEF SERVER} Tex1/Tex2/Texture/Color는 렌더 상태라 생략
//     (web 소관). Polys[1..2]는 record 필드라 유지하되 core는 안 읽는다 (깃발 천 렌더용 —
//     web/T13이 채움).
//   - CreateThing (72-554): 스타일별 case의 VDamping/Gravity/Radius/TimeOut/Interest 값 전부.
//     낙하산 슬롯 스캔 시작점(95-99)은 {$IFNDEF SERVER} 분기 대신 서버 동작(=1번부터) 채택
//     (규약 13). 무기드롭 투척 임펄스(517-547)는 {$IFDEF SERVER} 채택 (규약 8a).
//   - ThingCollision (556-560), SpawnBoxes (562-618), RandomizeStart (620-663 — M1에서
//     sprites.ts에 임시 거처였던 것을 여기로 이동, sprites.ts는 re-export).
//   - Update (665-1033): 깃발 4점 프로브+FLAG_STAND_FORCEUP(686-727), Verlet(733), StaticType
//     동결(742-747), 깃발 캐리 부착(750-767), InBase 판정(775-798), 타임아웃 리스폰(1005-1027).
//   - CheckMapCollision (1307-1448): 깃발 바운스 FIXME(1364-1389)는 고치지 않고 보존.
//   - Kill (1450-1463), CheckOutOfBounds (1465-1516), Respawn (1518-1572),
//     MoveSkeleton (1574-1600).
// * 채택(실동작, M2 Task 9):
//   - CheckSpriteCollision (1602-2145): 전신 {$IFDEF SERVER} — 규약 8a 채택. 최근접 스프라이트
//     선정(1620-1663), 깃발 그랩/반환(1726-1893 — CTF 완전, INF/HTF/PM은 구조+스텁), 무기
//     (1895-1927), 활(1928-1970), 키트 7종(1971-2106), 나이프·톱·LAW(2107-2139).
//     Kill→case→Respawn 이중 순서(1719-1720) 그대로 보존. 콘솔/BigMessage 문자열과
//     GrabbedInBase/GrabsPerSecond/ScoresPerSecond(ServerLoop.pas:400 안티매스플래그 통계)는
//     생략+주석, ServerThingTaken은 TODO(M3) NET, 봇챗(913-919)은 생략 (계획서 T9 명세).
//   - Update의 터치다운 스코어링 블록 (812-938): 캡처 스코어링 + SortPlayers 훅 + 서바이벌
//     라운드 종료. ServerFlagInfo는 TODO(M3) NET.
//   - CheckStationaryGunCollision (2147-2310): 고정포 마운트/조준/발사/과열. 클라 시그니처의
//     ClientCheck 파라미터는 제거 — 서버는 항상 풀 체크 (계획서 T9 "단일 시그니처").
// * 주석 처리 (shape만 보존):
//   - 네트 전송 ServerThingMustSnapshot/ServerThingTaken/ServerFlagInfo: TODO(M3) NET.
//   - Render/PolygonsRender (1035-1305): 클라 렌더 전용 — web/bulletsrender.ts(T13) 소관.
//   - {$IFNDEF SERVER} 게임플레이 분기(낙하산 TimeOut 180 클램프 977-999, 경계 밖 낙하산/깃발
//     Kill 1491-1511, POINTMATCH TeamFlag[1] 801-803): 규약 13 — 서버 동작 채택(=생략).
//   - PlaySound는 전부 gs.playSound 훅 (규약 11). {$IFNDEF SERVER} 사운드 블록(깃발 바람 소리
//     968-974, 무기/키트 낙하 소리 1398-1430)도 훅으로 채택 (bullets.ts 수류탄 바운스와 동일).
//
// 접근 규약: sprites.ts/bullets.ts와 동일한 gs-보관 클래스 패턴. 자유 함수(createThing/
// spawnBoxes/randomizeStart)는 gs를 첫 인자로 받는다.
import { type TVector2, vector2, cloneVec2, vec2Add, vec2Subtract, vec2Scale, vec2Normalize, vec2Length } from './vector'
import { random, pascalRound, trunc } from './pascal'
import { distance, distanceVec2 } from './calc'
import { ParticleSystem, NUM_PARTICLES } from './parts'
import type { TMapPolygon } from './mapfile'
import {
  MAX_SPAWNPOINTS,
  POLY_TYPE_LAVA,
  POLY_TYPE_BOUNCY,
  POLY_TYPE_ONLY_BULLETS,
  POLY_TYPE_ONLY_PLAYER,
  POLY_TYPE_DOESNT,
  POLY_TYPE_ONLY_FLAGGERS,
  POLY_TYPE_NOT_FLAGGERS,
  BACKGROUND_TRANSITION,
  BACKGROUND_POLY_UNKNOWN,
} from './polymap'
import {
  TBackgroundState,
  teamCollides,
  MAX_THINGS,
  MAX_SPRITES,
  BASE_RADIUS,
  TOUCHDOWN_RADIUS,
  FLAG_STAND_FORCEUP,
  FLAG_HOLDING_FORCEUP,
  BOT,
} from './sprites'
import {
  guns,
  BOW,
  BOW2,
  FLAMER,
  M2,
  NOWEAPON,
  FRAGGRENADE,
  CLUSTERGRENADE,
  weaponNumToIndex,
} from './weapons'
import { createBullet } from './bullets'
import { createSpark } from './sparks'
import {
  OBJECT_ALPHA_FLAG,
  OBJECT_BRAVO_FLAG,
  OBJECT_POINTMATCH_FLAG,
  OBJECT_USSOCOM,
  OBJECT_DESERT_EAGLE,
  OBJECT_HK_MP5,
  OBJECT_AK74,
  OBJECT_STEYR_AUG,
  OBJECT_SPAS12,
  OBJECT_RUGER77,
  OBJECT_M79,
  OBJECT_BARRET_M82A1,
  OBJECT_MINIMI,
  OBJECT_MINIGUN,
  OBJECT_RAMBO_BOW,
  OBJECT_MEDICAL_KIT,
  OBJECT_GRENADE_KIT,
  OBJECT_FLAMER_KIT,
  OBJECT_PREDATOR_KIT,
  OBJECT_VEST_KIT,
  OBJECT_BERSERK_KIT,
  OBJECT_CLUSTER_KIT,
  OBJECT_PARACHUTE,
  OBJECT_COMBAT_KNIFE,
  OBJECT_CHAINSAW,
  OBJECT_LAW,
  OBJECT_STATIONARY_GUN,
  FLAG_TIMEOUT,
  FLAG_INTEREST_TIME,
  BOW_INTEREST_TIME,
  DEFAULT_INTEREST_TIME,
  GUNRESISTTIME,
  GUN_RADIUS,
  BOW_RADIUS,
  KIT_RADIUS,
  STAT_RADIUS,
  MINMOVEDELTA,
  GAMESTYLE_INF,
  GAMESTYLE_CTF,
  GAMESTYLE_POINTMATCH,
  GAMESTYLE_HTF,
  TEAM_ALPHA,
  TEAM_BRAVO,
  BONUS_NONE,
  BONUS_FLAMEGOD,
  BONUS_PREDATOR,
  BONUS_BERSERKER,
  FLAMERBONUSTIME,
  PREDATORBONUSTIME,
  BERSERKERBONUSTIME,
  PREDATORALPHA,
  DEFAULTVEST,
  CLUSTER_GRENADES,
  OBJECT_NUM_FLAGS,
  OBJECT_NUM_NONWEAPON,
  M2GUN_OVERHEAT,
  M2GUN_OVERAIM,
  SFX_WEAPONHIT,
  SFX_KIT_FALL,
  SFX_FLAG,
  SFX_CAPTURE,
  SFX_TAKEGUN,
  SFX_TAKEBOW,
  SFX_TAKEMEDIKIT,
  SFX_PICKUPGUN,
  SFX_GODFLAME,
  SFX_PREDATOR,
  SFX_VESTTAKE,
  SFX_BERSERKER,
  SFX_M2OVERHEAT,
  SFX_M2FIRE,
  SFX_M2USE,
} from './constants'
import type { GameState } from './state'

// Things.pas:8-11 TThingCollision — 탄환이 이미 부딪친 씽의 재충돌 쿨다운 기록
// (TBullet.thingCollisions가 사용 — T4에서 bullets.ts에 임시 정의했던 정의의 이관).
export interface TThingCollision {
  thingNum: number // Byte
  cooldownEnd: number // LongInt
}

// Pascal record 대입 `Thing[i].Skeleton := BoxSkeleton` — 전체 복사(파티클/제약 + 스칼라).
// parts.ts clone()은 파티클/제약만 복사하므로 스칼라 4종을 명시적으로 따라 복사한다
// (sprites.ts 헤더의 "record 대입 = 깊은 복사" 규약과 동일).
function recordAssignSkeleton(dst: ParticleSystem, src: ParticleSystem): void {
  dst.destroy()
  dst.clone(src)
  dst.timeStep = src.timeStep
  dst.gravity = src.gravity
  dst.vDamping = src.vDamping
  dst.eDamping = src.eDamping
}

/* ****************************************************************************
 *                         TThing (Things.pas:13-50)                          *
 **************************************************************************** */

export class TThing {
  active = false
  style = 0 // Byte
  num = 0 // Byte — 자신의 gs.thing 슬롯 인덱스 (1-based)
  owner = 0 // Byte — 255 = 소유자 없음
  holdingSprite = 0 // Byte
  ammoCount = 0 // Byte — 무기드롭의 남은 탄약 (DropWeapon(T6)이 세팅, 픽업(T9)이 소비)
  radius = 0 // Single
  timeOut = 0 // Integer
  staticType = false
  interest = 0 // Integer
  collideWithBullets = false
  inBase = false
  lastSpawn = 0 // Byte
  team = 0 // Byte
  skeleton: ParticleSystem
  collideCount = [0, 0, 0, 0, 0] // array[1..4] of Byte — [0] 미사용 패딩
  // Things.pas:27 Polys: array[1..2] of TMapPolygon — 깃발 천 렌더용 폴리곤. core는 읽지도
  // 쓰지도 않는다 (web/T13이 채움) — 구조 동등성을 위해 필드만 유지 (빈 배열 = zero-init).
  polys: TMapPolygon[] = []
  bgState: TBackgroundState
  // {$IFNDEF SERVER} Tex1/Tex2: Integer; Texture: LongInt; Color: LongWord — 렌더 상태, 생략
  // (web 소관; CreateThing의 Tex1/Tex2/Texture 대입 라인들도 함께 생략).

  constructor(
    private readonly gs: GameState,
    num: number,
  ) {
    this.num = num
    this.skeleton = new ParticleSystem()
    this.bgState = new TBackgroundState()
  }

  // Things.pas:665-1033 TThing.Update
  update(): void {
    const gs = this.gs

    const wasStatic = this.staticType

    if (!this.staticType) {
      let collided = false
      let collided2 = false

      // Reset the background poly test before collision checks
      this.bgState.backgroundTestPrepare()

      for (let i = 1; i <= 4; i++) {
        if (
          this.skeleton.active[i] &&
          (this.holdingSprite === 0 || (this.holdingSprite > 0 && i === 2))
        ) {
          if (this.style < OBJECT_USSOCOM) {
            if (i === 1) {
              // 깃발 자루 바닥은 4점 프로브 (695-698). Pascal의 or은 단락 평가가 아니라 완전
              // 평가일 수 있으나(코드 스타일상 boolean or), CheckMapCollision은 부수효과(위치
              // 보정)를 갖는 호출이라 단락 여부가 관찰 결과를 바꾼다 — FPC 기본은 단락 평가
              // ({$B-})이므로 JS의 ||와 동일하다.
              if (
                this.checkMapCollision(i, this.skeleton.pos[i].x - 10, this.skeleton.pos[i].y - 8) ||
                this.checkMapCollision(i, this.skeleton.pos[i].x + 10, this.skeleton.pos[i].y - 8) ||
                this.checkMapCollision(i, this.skeleton.pos[i].x - 10, this.skeleton.pos[i].y) ||
                this.checkMapCollision(i, this.skeleton.pos[i].x + 10, this.skeleton.pos[i].y)
              ) {
                if (collided) collided2 = true
                collided = true

                // 원본 그대로: 바로 위에서 Collided := True 했으므로 항상 참인 if (704-705)
                if (collided) {
                  this.skeleton.forces[2].y = this.skeleton.forces[2].y + FLAG_STAND_FORCEUP * gs.grav
                }
              }
            } else {
              if (this.checkMapCollision(i, this.skeleton.pos[i].x, this.skeleton.pos[i].y)) {
                if (collided) collided2 = true
                collided = true
              }
            }
          } else if (this.style >= OBJECT_USSOCOM) {
            if (this.checkMapCollision(i, this.skeleton.pos[i].x, this.skeleton.pos[i].y)) {
              if (collided) collided2 = true
              collided = true
            }
          }
        } // Skeleton.Active[i]
      }

      // If no background poly contact then reset any background poly status
      this.bgState.backgroundTestReset()

      this.skeleton.doVerletTimeStep()

      if (this.style === OBJECT_STATIONARY_GUN && this.timeOut < 0) {
        this.skeleton.pos[2] = cloneVec2(this.skeleton.oldPos[2])
        this.skeleton.pos[3] = cloneVec2(this.skeleton.oldPos[3])
      }

      // Make the thing static if not moving much
      const a = vec2Subtract(this.skeleton.pos[1], this.skeleton.oldPos[1])
      const b = vec2Subtract(this.skeleton.pos[2], this.skeleton.oldPos[2])
      if (this.style !== OBJECT_STATIONARY_GUN) {
        if (collided && collided2) {
          if ((vec2Length(a) + vec2Length(b)) / 2 < MINMOVEDELTA) {
            this.staticType = true
          }
        }
      }

      // Sprite is Holding this Flag
      if (this.style < OBJECT_USSOCOM) {
        if (this.holdingSprite > 0 && this.holdingSprite < MAX_SPRITES + 1) {
          this.skeleton.pos[1] = cloneVec2(gs.sprite[this.holdingSprite].skeleton.pos[8])
          this.skeleton.forces[2].y = this.skeleton.forces[2].y + FLAG_HOLDING_FORCEUP * gs.grav
          // 원본 그대로: Interest 이중 대입 (755-757)
          this.interest = DEFAULT_INTEREST_TIME
          this.interest = FLAG_INTEREST_TIME

          gs.sprite[this.holdingSprite].holdedThing = this.num
          this.timeOut = FLAG_TIMEOUT

          if (this.bgState.backgroundStatus !== BACKGROUND_TRANSITION) {
            this.bgState.backgroundStatus = gs.sprite[this.holdingSprite].bgState.backgroundStatus
            this.bgState.backgroundPoly = gs.sprite[this.holdingSprite].bgState.backgroundPoly
          }
        } // HoldingSprite > 0
      }
    }

    // check if flag is in base (775-805)
    switch (this.style) {
      case OBJECT_ALPHA_FLAG:
      case OBJECT_BRAVO_FLAG: {
        const ax = gs.map.spawnpoints[gs.map.flagSpawn[this.style]].x
        const ay = gs.map.spawnpoints[gs.map.flagSpawn[this.style]].y

        if (distance(this.skeleton.pos[1].x, this.skeleton.pos[1].y, ax, ay) < BASE_RADIUS) {
          this.inBase = true
          this.timeOut = FLAG_TIMEOUT
          this.interest = FLAG_INTEREST_TIME

          // {$IFDEF SERVER} 자기 팀 깃발을 든 채 베이스 진입 → 즉시 반환 (787-791, 규약 8a)
          if (this.holdingSprite > 0 && this.holdingSprite < MAX_SPRITES + 1) {
            if (gs.sprite[this.holdingSprite].player!.team === this.style) {
              this.respawn()
            }
          }
        } else {
          this.inBase = false
        }

        gs.teamFlag[this.style] = this.num
        break
      }
      case OBJECT_POINTMATCH_FLAG:
        // {$IFNDEF SERVER} TeamFlag[1] := Num — 클라 전용 (801-803), 서버는 미기록 (규약 13).
        break
    }

    // check if flag is touchdown {$IFDEF SERVER} (812-938) — 규약 8a 채택
    if (this.style === OBJECT_ALPHA_FLAG || this.style === OBJECT_BRAVO_FLAG) {
      if (this.holdingSprite > 0 && this.holdingSprite < MAX_SPRITES + 1) {
        if (gs.sprite[this.holdingSprite].player!.team !== this.style) {
          // check if other flag is inbase
          for (let i = 1; i <= MAX_THINGS; i++) {
            if (
              gs.thing[i].active &&
              gs.thing[i].inBase &&
              i !== this.num &&
              gs.thing[i].holdingSprite === 0
            ) {
              // check if flags are close
              if (distanceVec2(this.skeleton.pos[1], gs.thing[i].skeleton.pos[1]) < TOUCHDOWN_RADIUS) {
                if (gs.sprite[this.holdingSprite].player!.team === TEAM_ALPHA) {
                  // {$IFNDEF SERVER} SFX_INFILTMUS/SFX_CTF (825-830) — 포지션 없는 UI 징글,
                  // 생략+주석 (web M4; sprites.ts SFX_BOOMHEADSHOT 선례)

                  gs.sprite[this.holdingSprite].player!.flags =
                    gs.sprite[this.holdingSprite].player!.flags + 1
                  gs.teamScore[1] = gs.teamScore[1] + 1

                  const b = vector2(0, 0)
                  if (gs.svGamemode === GAMESTYLE_INF) {
                    gs.teamScore[1] = gs.teamScore[1] + (gs.svInfRedaward - 1)
                    // penalty
                    if (gs.playersTeamNum[1] > gs.playersTeamNum[2]) {
                      gs.teamScore[1] = gs.teamScore[1] - 5 * (gs.playersTeamNum[1] - gs.playersTeamNum[2])
                    }
                    if (gs.teamScore[1] < 0) gs.teamScore[1] = 0

                    // {$IFNDEF SERVER} flame it (845-855) — 규약 12: CreateSpark 채택
                    for (let j = 1; j <= 10; j++) {
                      const a = vector2(
                        gs.thing[i].skeleton.pos[2].x - 10 + random(20),
                        gs.thing[i].skeleton.pos[2].y - 10 + random(20),
                      )
                      createSpark(gs, a, b, 36, 0, 35)
                      if (random(2) === 0) createSpark(gs, a, b, 37, 0, 75)
                    }
                  }

                  // {$IFNDEF SERVER} cap spark (859-862) — 규약 12: CreateSpark 채택
                  createSpark(gs, gs.thing[i].skeleton.pos[2], b, 61, this.holdingSprite, 18)

                  gs.sortPlayers?.()
                  // {$IFDEF SERVER} mainconsole '%s scores for Alpha Team' — 콘솔 UI, 생략.
                  // Inc(ScoresPerSecond) — 안티매스플래그 통계(ServerLoop.pas:400), 생략+주석.

                  // TODO(M3) NET: ServerFlagInfo(CAPTURERED, HoldingSprite)
                }
                if (gs.sprite[this.holdingSprite].player!.team === TEAM_BRAVO) {
                  // {$IFNDEF SERVER} PlaySound(SFX_CTF) (881-883) — 포지션 없는 UI 징글, 생략

                  gs.sprite[this.holdingSprite].player!.flags =
                    gs.sprite[this.holdingSprite].player!.flags + 1
                  gs.teamScore[2] = gs.teamScore[2] + 1

                  // {$IFNDEF SERVER} cap spark (888-893) — 규약 12: CreateSpark 채택
                  const b = vector2(0, 0)
                  createSpark(gs, gs.thing[i].skeleton.pos[2], b, 61, this.holdingSprite, 15)

                  gs.sortPlayers?.()
                  // {$IFDEF SERVER} mainconsole '%s scores for Bravo Team' — 콘솔 UI, 생략.
                  // Inc(ScoresPerSecond) — 안티매스플래그 통계, 생략+주석.

                  // TODO(M3) NET: ServerFlagInfo(CAPTUREBLUE, HoldingSprite)
                }
                // {$IFDEF SCRIPT} OnFlagScore — 스크립트 없음, 생략.
                // bots_chat ChatWinning (913-919) — 봇챗 생략 (계획서 T9 명세).

                this.respawn()

                if (gs.svSurvivalmode) {
                  gs.survivalEndRound = true

                  // Everyone should die in realistic after cap
                  // because if nobody is dead the round will not end
                  for (let j = 1; j <= MAX_SPRITES; j++) {
                    if (gs.sprite[j].active && !gs.sprite[j].deadMeat) {
                      // {$IFDEF SERVER}4000{$ELSE}150{$ENDIF} — 서버값 채택 (규약 8a)
                      gs.sprite[j].healthHit(4000, j, 1, -1, gs.sprite[j].skeleton.pos[12])
                      gs.sprite[j].player!.deaths--
                    }
                  }
                }
              }
            }
          }
        }
      }
    }

    if (this.style === OBJECT_STATIONARY_GUN) {
      this.checkStationaryGunCollision() // (943-946) — 서버는 항상 풀 체크 (ClientCheck 없음)
    }

    // check if sprite grabs thing {$IFDEF SERVER} (949-952)
    if (this.style !== OBJECT_STATIONARY_GUN) {
      this.checkSpriteCollision()
    }

    if (this.style === OBJECT_RAMBO_BOW) {
      for (let i = 1; i <= MAX_SPRITES; i++) {
        if (gs.sprite[i].active) {
          if (gs.sprite[i].weapon.num === guns[BOW].num || gs.sprite[i].weapon.num === guns[BOW2].num) {
            // {$IFNDEF SERVER} GameThingTarget := 0 — 클라 조준 표시 상태, 생략 (961-963)
            this.kill()
          }
        }
      }
    }

    // {$IFNDEF SERVER} flag on wind sound - and para (968-974) — 규약 11의 훅으로 채택
    if (this.style < OBJECT_USSOCOM || this.style === OBJECT_PARACHUTE) {
      if (random(75) === 0) {
        if (vec2Length(vec2Subtract(this.skeleton.pos[2], this.skeleton.oldPos[2])) > 1.0) {
          gs.playSound(SFX_FLAG + random(2), this.skeleton.pos[2])
        }
      }
    }

    // Parachute (976-999)
    if (this.style === OBJECT_PARACHUTE) {
      if (this.holdingSprite > 0 && this.holdingSprite < MAX_SPRITES + 1) {
        this.skeleton.pos[4] = cloneVec2(gs.sprite[this.holdingSprite].skeleton.pos[12])
        this.skeleton.forces[1].y = -gs.spriteParts.velocity[this.holdingSprite].y
        gs.sprite[this.holdingSprite].holdedThing = this.num

        if (this.skeleton.pos[3].x < this.skeleton.pos[4].x) {
          const a = cloneVec2(this.skeleton.pos[4])
          this.skeleton.pos[4] = cloneVec2(this.skeleton.pos[3])
          this.skeleton.oldPos[4] = cloneVec2(this.skeleton.pos[3])
          this.skeleton.pos[3] = a
          this.skeleton.oldPos[3] = cloneVec2(a)
          gs.spriteParts.forces[this.holdingSprite].y = gs.grav
        }
      } else {
        // {$IFNDEF SERVER} if TimeOut > 180 then TimeOut := 180 — 클라 전용 클램프 (995-998),
        // 규약 13: 서버 동작(클램프 없음) 채택.
      }
    }

    // count Time Out (1005-1027)
    this.timeOut = this.timeOut - 1
    if (this.timeOut < -1000) this.timeOut = -1000
    if (this.timeOut === 0) {
      switch (this.style) {
        case OBJECT_ALPHA_FLAG:
        case OBJECT_BRAVO_FLAG:
        case OBJECT_POINTMATCH_FLAG:
        case OBJECT_RAMBO_BOW:
          // {$IFDEF SERVER} 채택 (1014-1018)
          if (this.holdingSprite > 0) {
            this.timeOut = FLAG_TIMEOUT
          } else {
            this.respawn()
          }
          break
        case OBJECT_USSOCOM:
        case OBJECT_DESERT_EAGLE:
        case OBJECT_HK_MP5:
        case OBJECT_AK74:
        case OBJECT_STEYR_AUG:
        case OBJECT_SPAS12:
        case OBJECT_RUGER77:
        case OBJECT_M79:
        case OBJECT_BARRET_M82A1:
        case OBJECT_MINIMI:
        case OBJECT_MINIGUN:
        case OBJECT_COMBAT_KNIFE:
        case OBJECT_CHAINSAW:
        case OBJECT_LAW:
          this.kill()
          break
        case OBJECT_FLAMER_KIT:
        case OBJECT_PREDATOR_KIT:
        case OBJECT_VEST_KIT:
        case OBJECT_BERSERK_KIT:
        case OBJECT_CLUSTER_KIT:
        case OBJECT_PARACHUTE:
          this.kill()
          break
        // (MEDICAL_KIT/GRENADE_KIT은 원본에도 케이스 없음 — 음수로 계속 내려가 -1000에 클램프)
      }
    } // TimeOut = 0

    this.checkOutOfBounds()

    // Move(Skeleton.Pos[1], Skeleton.OldPos[1], 4 * sizeof(TVector2)) — Pos[1..4]를 OldPos[1..4]로
    if (!wasStatic && this.staticType) {
      for (let i = 1; i <= 4; i++) {
        this.skeleton.oldPos[i] = cloneVec2(this.skeleton.pos[i])
      }
    }
  }

  // Things.pas:1307-1448 TThing.CheckMapCollision — 스켈레톤 파티클 i의 (X, Y) 지점 맵 충돌.
  // ⚠ 원본 그대로: 충돌해도 Exit하지 않고 섹터의 나머지 폴리곤을 계속 검사한다
  // (bullets.ts CheckMapCollision과 다른 점 — 통합/조기 종료 금지).
  checkMapCollision(i: number, x: number, y: number): boolean {
    const gs = this.gs
    const map = gs.map

    let result = false
    const pos = vector2(x, y - 0.5)

    // iterate through map polygons
    const rx = pascalRound(pos.x / map.sectorsDivision)
    const ry = pascalRound(pos.y / map.sectorsDivision)
    if (rx > -map.sectorsNum && rx < map.sectorsNum && ry > -map.sectorsNum && ry < map.sectorsNum) {
      this.bgState.backgroundTestBigPolyCenter(map, pos)

      const sectorPolys = map.sectorPolys(rx, ry)
      for (let j = 1; j < sectorPolys.length; j++) {
        const w = sectorPolys[j]

        let teamcol = true

        if (this.owner > 0 && this.owner < MAX_SPRITES + 1) {
          teamcol = teamCollides(map, w, gs.sprite[this.owner].player!.team, false)
        }

        if (this.style < OBJECT_USSOCOM && map.polyType[w] > POLY_TYPE_LAVA && map.polyType[w] < POLY_TYPE_BOUNCY) {
          teamcol = false
        }

        if (
          teamcol &&
          map.polyType[w] !== POLY_TYPE_ONLY_BULLETS &&
          map.polyType[w] !== POLY_TYPE_ONLY_PLAYER &&
          map.polyType[w] !== POLY_TYPE_DOESNT &&
          map.polyType[w] !== POLY_TYPE_ONLY_FLAGGERS &&
          map.polyType[w] !== POLY_TYPE_NOT_FLAGGERS
        ) {
          if (map.pointInPolyEdges(pos.x, pos.y, w)) {
            if (this.bgState.backgroundTest(map, w)) continue

            const cp = map.closestPerpendicular(w, pos)
            const d = cp.d
            let perp = vec2Normalize(cp.perp)
            perp = vec2Scale(perp, d)

            switch (this.style) {
              case OBJECT_ALPHA_FLAG:
              case OBJECT_BRAVO_FLAG:
              case OBJECT_POINTMATCH_FLAG: {
                if (i === 1) {
                  this.skeleton.pos[i] = cloneVec2(this.skeleton.oldPos[i])
                } else {
                  // FIXME(skoskav): For more accurate bounce, it should be the sum of the object's
                  // momentum and the intrusion on the polygon's perpendicular
                  // (원본 FIXME — 고치지 않고 보존, 1373-1375)

                  // Bounce back the Pos with Perp and move the OldPos behind the new Pos, so it now
                  // travels in the direction of Perp
                  const posDiff = vec2Subtract(this.skeleton.pos[i], this.skeleton.oldPos[i])
                  const posDiffLen = vec2Length(posDiff)
                  let posDiffPerp = vec2Normalize(perp)
                  posDiffPerp = vec2Scale(posDiffPerp, posDiffLen)

                  this.skeleton.pos[i] = vec2Subtract(this.skeleton.pos[i], perp)
                  this.skeleton.oldPos[i] = vec2Add(this.skeleton.pos[i], posDiffPerp)

                  if (i === 2 && this.holdingSprite === 0) {
                    this.skeleton.forces[i].y = this.skeleton.forces[i].y - 1
                  }
                }
                break
              }

              case OBJECT_USSOCOM:
              case OBJECT_DESERT_EAGLE:
              case OBJECT_HK_MP5:
              case OBJECT_AK74:
              case OBJECT_STEYR_AUG:
              case OBJECT_SPAS12:
              case OBJECT_RUGER77:
              case OBJECT_M79:
              case OBJECT_BARRET_M82A1:
              case OBJECT_MINIMI:
              case OBJECT_MINIGUN:
              case OBJECT_COMBAT_KNIFE:
              case OBJECT_CHAINSAW:
              case OBJECT_LAW: {
                this.skeleton.pos[i] = cloneVec2(this.skeleton.oldPos[i])
                this.skeleton.pos[i] = vec2Subtract(this.skeleton.pos[i], perp)

                // {$IFNDEF SERVER} 무기 낙하 소리 (1398-1403) — 규약 11의 훅으로 채택
                if (
                  this.collideCount[i] === 0 ||
                  (vec2Length(vec2Subtract(this.skeleton.pos[i], this.skeleton.oldPos[i])) > 1.5 &&
                    this.collideCount[i] < 30)
                ) {
                  gs.playSound(SFX_WEAPONHIT, this.skeleton.pos[i])
                }
                break
              }

              case OBJECT_RAMBO_BOW:
              case OBJECT_MEDICAL_KIT:
              case OBJECT_GRENADE_KIT:
              case OBJECT_FLAMER_KIT:
              case OBJECT_PREDATOR_KIT:
              case OBJECT_VEST_KIT:
              case OBJECT_BERSERK_KIT:
              case OBJECT_CLUSTER_KIT: {
                this.skeleton.pos[i] = cloneVec2(this.skeleton.oldPos[i])
                this.skeleton.pos[i] = vec2Subtract(this.skeleton.pos[i], perp)

                // {$IFNDEF SERVER} 키트 낙하 소리 (1412-1417) — 규약 11의 훅으로 채택
                if (
                  this.collideCount[i] === 0 ||
                  (vec2Length(vec2Subtract(this.skeleton.pos[i], this.skeleton.oldPos[i])) > 1.5 &&
                    this.collideCount[i] < 3)
                ) {
                  gs.playSound(SFX_KIT_FALL + random(2), this.skeleton.pos[i])
                }
                break
              }

              case OBJECT_PARACHUTE: {
                this.skeleton.pos[i] = cloneVec2(this.skeleton.oldPos[i])
                this.skeleton.pos[i] = vec2Subtract(this.skeleton.pos[i], perp)

                // {$IFNDEF SERVER} 낙하산 소리 (1425-1430) — 규약 11의 훅으로 채택
                if (
                  this.collideCount[i] === 0 ||
                  (vec2Length(vec2Subtract(this.skeleton.pos[i], this.skeleton.oldPos[i])) > 1.5 &&
                    this.collideCount[i] < 3)
                ) {
                  gs.playSound(SFX_FLAG + random(2), this.skeleton.pos[i])
                }
                break
              }

              case OBJECT_STATIONARY_GUN: {
                this.skeleton.pos[i] = cloneVec2(this.skeleton.oldPos[i])
                this.skeleton.pos[i] = vec2Subtract(this.skeleton.pos[i], perp)
                break
              }
            }

            // avoid overflow error — CollideCount[i] := Byte(CollideCount[i] + 1)
            this.collideCount[i] = (this.collideCount[i] + 1) & 0xff

            result = true
          }
        }
      }
    }

    return result
  }

  // Things.pas:1450-1463 TThing.Kill
  kill(): void {
    if (this.num <= 0) {
      // skip uninited Things
      return
    }
    this.gs.thing[this.num].skeleton.destroy() // Thing[Num].Skeleton.Destroy — 원본 그대로 배열 경유
    this.active = false
    // {$IFNDEF SERVER} Texture := 0 — 렌더 상태, 생략
  }

  // Things.pas:1465-1516 TThing.CheckOutOfBounds
  checkOutOfBounds(): void {
    const gs = this.gs
    const bound = gs.map.sectorsNum * gs.map.sectorsDivision - 10

    for (let i = 1; i <= 4; i++) {
      const skeletonPos = this.skeleton.pos[i]

      if (Math.abs(skeletonPos.x) > bound || Math.abs(skeletonPos.y) > bound) {
        switch (this.style) {
          case OBJECT_ALPHA_FLAG:
          case OBJECT_BRAVO_FLAG:
          case OBJECT_POINTMATCH_FLAG:
          case OBJECT_RAMBO_BOW:
          case OBJECT_MEDICAL_KIT:
          case OBJECT_GRENADE_KIT:
          case OBJECT_FLAMER_KIT:
          case OBJECT_PREDATOR_KIT:
          case OBJECT_VEST_KIT:
          case OBJECT_BERSERK_KIT:
          case OBJECT_CLUSTER_KIT:
            this.respawn()
            // {$IFNDEF SERVER} Kill — 클라 전용 (1491-1493), 규약 13: 서버는 리스폰만.
            break

          case OBJECT_USSOCOM:
          case OBJECT_DESERT_EAGLE:
          case OBJECT_HK_MP5:
          case OBJECT_AK74:
          case OBJECT_STEYR_AUG:
          case OBJECT_SPAS12:
          case OBJECT_RUGER77:
          case OBJECT_M79:
          case OBJECT_BARRET_M82A1:
          case OBJECT_MINIMI:
          case OBJECT_MINIGUN:
          case OBJECT_COMBAT_KNIFE:
          case OBJECT_CHAINSAW:
          case OBJECT_LAW:
          case OBJECT_STATIONARY_GUN:
            this.kill()
            break

          case OBJECT_PARACHUTE:
            // 전체가 {$IFNDEF SERVER} (1506-1511) — 규약 13: 서버는 아무것도 하지 않는다.
            // (클라: HoldedThing 해제 + HoldingSprite := 0 + Kill)
            break
        }
      }
    }
  }

  // Things.pas:1518-1572 TThing.Respawn
  respawn(): void {
    const gs = this.gs

    if (this.holdingSprite > 0 && this.holdingSprite < MAX_SPRITES + 1) {
      gs.sprite[this.holdingSprite].holdedThing = 0
      if (gs.sprite[this.holdingSprite].player!.team === TEAM_ALPHA) {
        gs.sprite[this.holdingSprite].brain.pathNum = 1
      }
      if (gs.sprite[this.holdingSprite].player!.team === TEAM_BRAVO) {
        gs.sprite[this.holdingSprite].brain.pathNum = 2
      }
    }

    this.kill()
    // a := Default(TVector2); RandomizeStart(a, 0) — var 파라미터라 a가 결과로 채워진다
    // (case에 없는 스타일의 폴백 + RNG 스트림 소모까지 원본 그대로).
    let a = randomizeStart(gs, 0).start

    switch (this.style) {
      case OBJECT_ALPHA_FLAG:
        a = randomizeStart(gs, 5).start
        break
      case OBJECT_BRAVO_FLAG:
        a = randomizeStart(gs, 6).start
        break
      case OBJECT_POINTMATCH_FLAG:
        a = randomizeStart(gs, 14).start
        break
      case OBJECT_RAMBO_BOW:
        a = randomizeStart(gs, 15).start
        break
      case OBJECT_MEDICAL_KIT:
        a = spawnBoxes(gs, 8, this.num).start
        break
      case OBJECT_GRENADE_KIT:
        a = spawnBoxes(gs, 7, this.num).start
        break
      case OBJECT_FLAMER_KIT:
        a = randomizeStart(gs, 11).start
        break
      case OBJECT_PREDATOR_KIT:
        a = randomizeStart(gs, 13).start
        break
      case OBJECT_VEST_KIT:
        a = randomizeStart(gs, 10).start
        break
      case OBJECT_BERSERK_KIT:
        a = randomizeStart(gs, 12).start
        break
      case OBJECT_CLUSTER_KIT:
        a = randomizeStart(gs, 9).start
        break
    }

    createThing(gs, a, 255, this.style, this.num)
    // 아래의 Thing[Num].* 대입들은 재생성된 자기 자신(this === gs.thing[this.num])에 대한 것.
    gs.thing[this.num].timeOut = FLAG_TIMEOUT
    gs.thing[this.num].interest = DEFAULT_INTEREST_TIME
    gs.thing[this.num].staticType = false

    for (let i = 1; i <= 4; i++) {
      gs.thing[this.num].collideCount[i] = 0
    }

    if (this.style === OBJECT_RAMBO_BOW) {
      gs.thing[this.num].interest = BOW_INTEREST_TIME
    }
    if (this.style < OBJECT_USSOCOM) {
      gs.thing[this.num].interest = FLAG_INTEREST_TIME
    }

    // send net info — TODO(M3) NET: ServerThingMustSnapshot(Num)
  }

  // Things.pas:1574-1600 TThing.MoveSkeleton
  moveSkeleton(x1: number, y1: number, fromZero: boolean): void {
    if (!fromZero) {
      for (let i = 1; i <= NUM_PARTICLES; i++) {
        if (this.skeleton.active[i]) {
          this.skeleton.pos[i].x = this.skeleton.pos[i].x + x1
          this.skeleton.pos[i].y = this.skeleton.pos[i].y + y1
          this.skeleton.oldPos[i] = cloneVec2(this.skeleton.pos[i])
        }
      }
    }

    if (fromZero) {
      for (let i = 1; i <= NUM_PARTICLES; i++) {
        if (this.skeleton.active[i]) {
          this.skeleton.pos[i].x = x1
          this.skeleton.pos[i].y = y1
          this.skeleton.oldPos[i] = cloneVec2(this.skeleton.pos[i])
        }
      }
    }
  }

  // Things.pas:1602-2145 {$IFDEF SERVER} TThing.CheckSpriteCollision — 규약 8a 채택.
  // 픽업 판정(무기/키트/활), 깃발 그랩·반환(CTF 완전 / INF·HTF·PM 구조+스텁), 키트 7종 효과.
  // ⚠ Kill(1721-1722) → case의 효과 적용 → 키트류 Respawn(재Kill 포함) 이중 순서 그대로 보존
  //   (리스크 지도 3번 — 순서 재배열 금지).
  // 콘솔/BigMessage 문자열(CapColor/SmallCapText류)과 GrabbedInBase/GrabsPerSecond(HTF·CTF
  // 그랩 통계 — ServerLoop.pas:400 안티매스플래그 검사 전용)는 생략+주석.
  checkSpriteCollision(): number {
    const gs = this.gs

    let result = -1

    let a = vec2Subtract(this.skeleton.pos[1], this.skeleton.pos[2])
    const k = vec2Length(a) / 2
    a = vec2Normalize(a)
    a = vec2Scale(a, -k)
    let pos = vec2Add(this.skeleton.pos[1], a)

    // iterate through sprites
    let closestdist = 9999999
    let closestplayer = -1
    for (let j = 1; j <= MAX_SPRITES; j++) {
      if (gs.sprite[j].active && !gs.sprite[j].deadMeat && gs.sprite[j].isNotSpectator()) {
        let colPos = cloneVec2(gs.spriteParts.pos[j])
        let norm = vec2Subtract(pos, colPos)
        if (vec2Length(norm) >= this.radius) {
          // 원본 그대로: pos를 재대입한 채 다음 반복으로 넘어간다 (1638-1647 — 루프 캐리 상태)
          pos = cloneVec2(this.skeleton.pos[1])
          colPos = cloneVec2(gs.spriteParts.pos[j])
          norm = vec2Subtract(pos, colPos)

          if (vec2Length(norm) >= this.radius) {
            pos = cloneVec2(this.skeleton.pos[2])
            colPos = cloneVec2(gs.spriteParts.pos[j])
            norm = vec2Subtract(pos, colPos)
          }
        }

        const dist = vec2Length(norm)
        if (dist < this.radius) {
          if (dist < closestdist) {
            // {$IFDEF SERVER} 메디킷 풀피/수류탄킷 풀수류탄 후보 제외 (1652-1655) — 규약 8a
            if (!(this.style === OBJECT_MEDICAL_KIT && gs.sprite[j].health === gs.startHealth)) {
              if (
                !(
                  this.style === OBJECT_GRENADE_KIT &&
                  gs.sprite[j].tertiaryWeapon.ammoCount === gs.svMaxgrenades &&
                  gs.sprite[j].tertiaryWeapon.num === guns[FRAGGRENADE].num
                )
              ) {
                if (!(this.style < OBJECT_USSOCOM && gs.sprite[j].ceaseFireCounter > 0)) {
                  closestdist = dist
                  closestplayer = j
                }
              }
            }
          }
        }
      }
    } // for j

    let j = closestplayer

    if (j > 0) {
      // collision
      const spr = gs.sprite[j]

      // 픽업 성립 시 사운드 + 씽 소멸 (1668-1722)
      if (
        (((this.style > OBJECT_POINTMATCH_FLAG &&
          this.style < OBJECT_RAMBO_BOW &&
          spr.bodyAnimation.id !== gs.anims.change.id) ||
          (this.style > OBJECT_PARACHUTE && spr.bodyAnimation.id !== gs.anims.change.id)) &&
          spr.weapon.num === guns[NOWEAPON].num &&
          spr.brain.favWeapon !== guns[NOWEAPON].num &&
          this.timeOut < GUNRESISTTIME - 30) ||
        (this.style === 15 /* OBJECT_RAMBO_BOW — 원본 그대로 매직넘버 (1675) */ &&
          spr.weapon.num === guns[NOWEAPON].num &&
          this.timeOut < gs.svRespawntime * FLAG_TIMEOUT - 100) ||
        (this.style === OBJECT_MEDICAL_KIT &&
          spr.health < gs.startHealth &&
          /* {$IFDEF SERVER} */ !spr.hasPack) ||
        (this.style === OBJECT_GRENADE_KIT &&
          spr.tertiaryWeapon.ammoCount < gs.svMaxgrenades &&
          (spr.tertiaryWeapon.num !== guns[CLUSTERGRENADE].num || spr.tertiaryWeapon.ammoCount === 0)) ||
        (((this.style === OBJECT_FLAMER_KIT &&
          spr.weapon.num !== guns[BOW].num &&
          spr.weapon.num !== guns[BOW2].num) ||
          this.style === OBJECT_PREDATOR_KIT ||
          this.style === OBJECT_BERSERK_KIT) &&
          spr.bonusStyle === BONUS_NONE &&
          spr.ceaseFireCounter < 1) ||
        (this.style === OBJECT_VEST_KIT && /* {$IFDEF SERVER} */ spr.vest < DEFAULTVEST) ||
        (this.style === OBJECT_CLUSTER_KIT &&
          /* {$IFDEF SERVER} */ (spr.tertiaryWeapon.num === guns[FRAGGRENADE].num ||
            spr.tertiaryWeapon.ammoCount === 0))
      ) {
        // {$IFNDEF SERVER} take sound (1698-1717) — 규약 11 훅으로 채택
        if (
          (this.style > OBJECT_POINTMATCH_FLAG && this.style < OBJECT_RAMBO_BOW) ||
          this.style > OBJECT_PARACHUTE
        ) {
          gs.playSound(SFX_TAKEGUN, gs.spriteParts.pos[spr.num])
        } else if (this.style === OBJECT_RAMBO_BOW) {
          gs.playSound(SFX_TAKEBOW, gs.spriteParts.pos[spr.num])
        } else if (this.style === OBJECT_MEDICAL_KIT) {
          gs.playSound(SFX_TAKEMEDIKIT, gs.spriteParts.pos[spr.num])
        } else if (this.style === OBJECT_GRENADE_KIT) {
          gs.playSound(SFX_PICKUPGUN, gs.spriteParts.pos[spr.num])
        } else if (this.style === OBJECT_FLAMER_KIT) {
          gs.playSound(SFX_GODFLAME, gs.spriteParts.pos[spr.num])
        } else if (this.style === OBJECT_PREDATOR_KIT) {
          gs.playSound(SFX_PREDATOR, gs.spriteParts.pos[spr.num])
        } else if (this.style === OBJECT_VEST_KIT) {
          gs.playSound(SFX_VESTTAKE, gs.spriteParts.pos[spr.num])
        } else if (this.style === OBJECT_BERSERK_KIT) {
          gs.playSound(SFX_BERSERKER, gs.spriteParts.pos[spr.num])
        } else if (this.style === OBJECT_CLUSTER_KIT) {
          gs.playSound(SFX_PICKUPGUN, gs.spriteParts.pos[spr.num])
        }

        // TODO(M3) NET: ServerThingTaken(Num, j)
        if (this.style !== OBJECT_RAMBO_BOW) {
          this.kill()
        }
      }

      // {$IFDEF SERVER} KnifeCan[j] := True (1723) — 클라 발사 패킷 검증 전역
      //   (NetworkServerBullet.pas:247), TODO(M3) NET (sprites.ts와 동일 처리).

      switch (this.style) {
        case OBJECT_ALPHA_FLAG:
        case OBJECT_BRAVO_FLAG:
        case OBJECT_POINTMATCH_FLAG: {
          if (gs.svGamemode === GAMESTYLE_INF && this.style === OBJECT_ALPHA_FLAG) {
            return result // Exit (1729-1730) — Result는 아직 -1 (원본 그대로)
          }

          // Dont allow flag cap when round has ended
          if (
            gs.survivalEndRound &&
            (this.style === OBJECT_ALPHA_FLAG ||
              this.style === OBJECT_BRAVO_FLAG ||
              this.style === OBJECT_POINTMATCH_FLAG)
          ) {
            return result // Exit (1733-1738)
          }

          this.staticType = false
          this.timeOut = FLAG_TIMEOUT
          this.interest = FLAG_INTEREST_TIME

          if (spr.player!.team !== this.style || !this.inBase) {
            if (this.holdingSprite === 0 && spr.flagGrabCooldown < 1) {
              // {$IFNDEF SERVER} capture sound (1746-1749) — 규약 11 훅으로 채택
              gs.playSound(SFX_CAPTURE, this.skeleton.pos[1])
              this.holdingSprite = j
              // TODO(M3) NET: ServerThingTaken(Num, j)

              // CapColor/SmallCapTextStr (1753-1771) — 콘솔 메시지 색/문자열, 생략.

              switch (gs.svGamemode) {
                case GAMESTYLE_POINTMATCH:
                case GAMESTYLE_HTF:
                  // '%s got the Yellow Flag' 콘솔 — 생략.
                  // HTF: GrabbedInBase/GrabsPerSecond (1779-1782) — 안티매스플래그 통계, 생략.
                  // TODO(M2후속): HTF 틱 스코어는 T10 ⑫에서.
                  break
                case GAMESTYLE_CTF:
                  if (spr.player!.team === this.style) {
                    // 자팀 깃발 반환 — '%s returned the Red/Blue Flag' 콘솔 생략 (1794-1815)
                    this.respawn()
                  } else {
                    // 적팀 깃발 캡처 — '%s captured the Blue/Red Flag' 콘솔 생략 (1818-1843).
                    // GrabbedInBase := Thing[2/1].InBase + Inc(GrabsPerSecond) — 통계, 생략.
                  }
                  break
                case GAMESTYLE_INF:
                  if (spr.player!.team === this.style) {
                    // '%s returned the Objective' (TEAM_BRAVO) 콘솔/통계 생략 (1846-1859)
                    this.respawn()
                  } else {
                    // '%s captured the Objective' (TEAM_ALPHA) 콘솔/통계 생략 (1863-1877)
                  }
                  break
              }

              // mainconsole/BigMessage 출력 (1881-1890) — 생략.
            }
          }
          break
        }

        case OBJECT_USSOCOM:
        case OBJECT_DESERT_EAGLE:
        case OBJECT_HK_MP5:
        case OBJECT_AK74:
        case OBJECT_STEYR_AUG:
        case OBJECT_SPAS12:
        case OBJECT_RUGER77:
        case OBJECT_M79:
        case OBJECT_BARRET_M82A1:
        case OBJECT_MINIMI:
        case OBJECT_MINIGUN:
          if (spr.weapon.num === guns[NOWEAPON].num) {
            if (spr.brain.favWeapon !== guns[NOWEAPON].num) {
              if (spr.bodyAnimation.id !== gs.anims.change.id) {
                if (this.timeOut < GUNRESISTTIME - 30) {
                  // Objects 1-3 are flags, so we need for WeaponIndex subtract by flags+1
                  const weaponIndex = weaponNumToIndex(this.style - (OBJECT_NUM_FLAGS + 1))
                  // {$IFDEF SCRIPT} OnWeaponChange — 스크립트 없음, 생략.
                  spr.applyWeaponByNum(guns[weaponIndex].num, 1)
                  spr.weapon.ammoCount = this.ammoCount
                  spr.weapon.fireIntervalPrev = spr.weapon.fireInterval
                  spr.weapon.fireIntervalCount = spr.weapon.fireInterval
                  // {$IFNDEF SERVER} ClientSpriteSnapshot — 클라 네트, 생략.
                }
              }
            }
          }
          break

        case OBJECT_RAMBO_BOW:
          if (spr.weapon.num === guns[NOWEAPON].num) {
            if (spr.bodyAnimation.id !== gs.anims.change.id) {
              if (this.timeOut < FLAG_TIMEOUT - 100) {
                spr.applyWeaponByNum(guns[BOW].num, 1)
                spr.applyWeaponByNum(guns[BOW2].num, 2)
                // BUG: shouldn't this be Guns[BOW].Ammo? Somebody might've set more than one
                // (원본 주석 그대로 보존 — 1948)
                spr.weapon.ammoCount = 1
                spr.weapon.fireIntervalPrev = spr.weapon.fireInterval
                spr.weapon.fireIntervalCount = spr.weapon.fireInterval
                spr.wearHelmet = 1
                // {$IFNDEF SERVER} ClientSpriteSnapshot + 'You got the Bow!' BigMessage — 생략.
              }
            }
          }
          break

        case OBJECT_MEDICAL_KIT:
          if (spr.health < gs.startHealth) {
            // pickup health pack
            if (!spr.hasPack) {
              // {$IFDEF SERVER} (1975)
              this.team = spr.player!.team
              // {$IFDEF SERVER} (1978-1980)
              if (gs.svHealthcooldown > 0) {
                spr.hasPack = true
              }
              spr.health = gs.startHealth
              this.respawn()
            }
          }
          break

        case OBJECT_GRENADE_KIT:
          if (
            spr.tertiaryWeapon.ammoCount < gs.svMaxgrenades &&
            (spr.tertiaryWeapon.num !== guns[CLUSTERGRENADE].num || spr.tertiaryWeapon.ammoCount === 0)
          ) {
            this.team = spr.player!.team
            spr.tertiaryWeapon = { ...guns[FRAGGRENADE] } // TertiaryWeapon := Guns[FRAGGRENADE] (record 복사)
            spr.tertiaryWeapon.ammoCount = gs.svMaxgrenades
            this.respawn()
          }
          break

        case OBJECT_FLAMER_KIT:
          if (spr.bonusStyle === BONUS_NONE && spr.ceaseFireCounter < 1) {
            if (spr.weapon.num !== guns[BOW].num && spr.weapon.num !== guns[BOW2].num) {
              // {$IFNDEF SERVER}, -1, True{$ENDIF} — 서버 시그니처(기본 인자) 채택 (규약 8a)
              spr.applyWeaponByNum(spr.weapon.num, 2)
              spr.applyWeaponByNum(guns[FLAMER].num, 1)
              spr.bonusTime = FLAMERBONUSTIME
              spr.bonusStyle = BONUS_FLAMEGOD
              // {$IFNDEF SERVER} 'Flame God Mode!' BigMessage — 생략.
              spr.health = gs.startHealth
            }
          }
          break

        case OBJECT_PREDATOR_KIT:
          if (spr.bonusStyle === BONUS_NONE && spr.ceaseFireCounter < 1) {
            spr.alpha = PREDATORALPHA
            spr.bonusTime = PREDATORBONUSTIME
            spr.bonusStyle = BONUS_PREDATOR
            // {$IFNDEF SERVER} 'Predator Mode!' BigMessage — 생략.
            spr.health = gs.startHealth
          }
          break

        case OBJECT_VEST_KIT:
          spr.vest = DEFAULTVEST
          // {$IFNDEF SERVER} 'Bulletproof Vest!' BigMessage — 생략.
          break

        case OBJECT_BERSERK_KIT:
          // 원본 그대로 BonusStyle = 0 리터럴 비교 (2082 — BONUS_NONE과 동치)
          if (spr.bonusStyle === 0 && spr.ceaseFireCounter < 1) {
            spr.bonusStyle = BONUS_BERSERKER
            spr.bonusTime = BERSERKERBONUSTIME
            // {$IFNDEF SERVER} 'Berserker Mode!' BigMessage — 생략.
            spr.health = gs.startHealth
          }
          break

        case OBJECT_CLUSTER_KIT:
          // {$IFDEF SERVER} 게이트 (2096-2097) — 규약 8a 채택
          if (spr.tertiaryWeapon.num === guns[FRAGGRENADE].num || spr.tertiaryWeapon.ammoCount === 0) {
            spr.tertiaryWeapon = { ...guns[CLUSTERGRENADE] } // record 복사
            spr.tertiaryWeapon.ammoCount = CLUSTER_GRENADES
            // {$IFNDEF SERVER} 'Cluster grenades!' BigMessage — 생략.
          }
          break

        case OBJECT_COMBAT_KNIFE:
        case OBJECT_CHAINSAW:
        case OBJECT_LAW:
          if (spr.weapon.num === guns[NOWEAPON].num) {
            if (spr.brain.favWeapon !== guns[NOWEAPON].num) {
              if (spr.bodyAnimation.id !== gs.anims.change.id) {
                if (this.timeOut < GUNRESISTTIME - 30) {
                  // There are in total OBJECT_NUM_NONWEAPON non-weapon objects before the
                  // knife so we need to subtract it+1 for the WeaponIndex (like before)
                  const weaponIndex = weaponNumToIndex(this.style - (OBJECT_NUM_NONWEAPON + 1))
                  spr.applyWeaponByNum(guns[weaponIndex].num, 1)
                  spr.weapon.ammoCount = this.ammoCount
                  spr.weapon.fireIntervalPrev = spr.weapon.fireInterval
                  spr.weapon.fireIntervalCount = spr.weapon.fireInterval
                  // {$IFNDEF SERVER} ClientSpriteSnapshot — 클라 네트, 생략.
                }
              }
            }
          }
          break
      }

      result = j
    }

    return result
  }

  // Things.pas:2147-2310 TThing.CheckStationaryGunCollision — 고정포 마운트/조준/발사/과열.
  // 클라 시그니처의 ClientCheck 파라미터({$IFNDEF SERVER})는 제거 — 서버는 마운트 루프(2266-)를
  // 항상 실행한다 (계획서 T9 "단일 시그니처로 항상 풀 체크").
  checkStationaryGunCollision(): number {
    const gs = this.gs

    let result = -1
    if (this.timeOut > 0) {
      return result
    }

    // Stat overheat less
    if (this.interest > M2GUN_OVERHEAT + 1) {
      this.interest = 0
    }

    if (this.interest > 0) {
      if (gs.mainTickCounter % 8 === 0) {
        this.interest--
      }
    }

    let pos = cloneVec2(this.skeleton.pos[1])

    for (let i = 1; i <= MAX_SPRITES; i++) {
      if (gs.sprite[i].active && !gs.sprite[i].deadMeat && gs.sprite[i].isNotSpectator()) {
        if (gs.sprite[i].stat === this.num) {
          const colPos = cloneVec2(gs.spriteParts.pos[i])
          let norm = vec2Subtract(pos, colPos)
          if (vec2Length(norm) < this.radius) {
            // collision — 조작 중인 스프라이트가 반경 안에 있다
            if (gs.sprite[i].player!.controlMethod === BOT) {
              if (gs.sprite[i].brain.camper > 0) {
                if (gs.sprite[i].holdedThing === 0) {
                  gs.sprite[i].control.right = false
                  gs.sprite[i].control.left = false
                  gs.sprite[i].control.up = false
                  gs.sprite[i].control.down = false
                  if (gs.sprite[i].legsAnimation.id === gs.anims.prone.id) {
                    gs.sprite[i].control.prone = true
                  }
                }
              }
            }

            this.staticType = true

            // 조준 — 마우스 방향으로 포신(Pos[4]) 회전 (2192-2199)
            pos.x = gs.sprite[i].control.mouseAimX
            pos.y = gs.sprite[i].control.mouseAimY
            norm = vec2Subtract(pos, gs.sprite[i].skeleton.pos[15])
            norm = vec2Normalize(norm)
            norm = vec2Scale(norm, 3)
            norm.x = -norm.x
            this.skeleton.oldPos[4] = cloneVec2(this.skeleton.pos[4])
            this.skeleton.pos[4] = vec2Add(this.skeleton.pos[1], norm)

            this.interest = gs.sprite[i].useTime

            if (gs.sprite[i].control.fire) {
              if (gs.sprite[i].legsAnimation.id === gs.anims.stand.id) {
                if (gs.mainTickCounter % guns[M2].fireInterval === 0) {
                  if (gs.sprite[i].useTime > M2GUN_OVERHEAT) {
                    // {$IFNDEF SERVER} 과열음 (2211-2213) — 규약 11 훅으로 채택
                    gs.playSound(SFX_M2OVERHEAT, gs.spriteParts.pos[i])
                    return result // Exit (2214)
                  }

                  let k = 0
                  if (gs.sprite[i].useTime > M2GUN_OVERAIM) {
                    k = trunc(gs.sprite[i].useTime / 11) // UseTime div 11
                    k = -k + random(2 * k)
                  }

                  pos.x = this.skeleton.pos[4].x
                  pos.y = this.skeleton.pos[4].y
                  norm = vec2Subtract(pos, this.skeleton.pos[1])
                  norm = vec2Normalize(norm)
                  norm = vec2Scale(norm, guns[M2].speed)
                  norm.x = -norm.x
                  norm.x = norm.x + k
                  norm.y = norm.y + k
                  pos.x = this.skeleton.pos[4].x + 4
                  pos.y = this.skeleton.pos[4].y - 10

                  createBullet(gs, pos, norm, guns[M2].num, i, 255, guns[M2].hitMultiply, true, false)

                  // {$IFNDEF SERVER} 발사 스파크 2종 + 발사음 (2237-2249) — 규약 12/11 채택
                  pos = vec2Add(pos, norm)
                  norm = vec2Scale(norm, 0.1)
                  createSpark(gs, pos, norm, 35, i, 15) // smoke

                  const colPos2 = cloneVec2(norm)
                  norm.y = -gs.sprite[i].direction * norm.x
                  norm.x = gs.sprite[i].direction * colPos2.y
                  norm = vec2Scale(norm, 0.2)
                  pos.x = this.skeleton.pos[3].x + 18
                  pos.y = this.skeleton.pos[3].y - 20
                  createSpark(gs, pos, norm, 22, i, 255) // hull

                  gs.playSound(SFX_M2FIRE, gs.spriteParts.pos[i])

                  gs.sprite[i].useTime++
                }
              }
            }
            return result // Exit (2253) — 조작 유지 경로는 Result = -1 그대로 (원본 그대로)
          } else {
            gs.sprite[i].stat = 0
            this.staticType = false
            return result // Exit (2258)
          }
        }
      }
    }

    // iterate through sprites — 마운트 시도. {$IFNDEF SERVER}if ClientCheck then{$ENDIF}
    // 게이트는 서버에서 무조건 실행 (규약 13).
    if (!this.staticType) {
      for (let j = 1; j <= MAX_SPRITES; j++) {
        if (gs.sprite[j].active && !gs.sprite[j].deadMeat && gs.sprite[j].isNotSpectator()) {
          const colPos = cloneVec2(gs.spriteParts.pos[j])
          const norm = vec2Subtract(pos, colPos)
          if (vec2Length(norm) < this.radius) {
            // collision
            switch (this.style) {
              case OBJECT_STATIONARY_GUN: {
                if (gs.sprite[j].player!.controlMethod === BOT) {
                  if (gs.sprite[j].brain.camper > 0) {
                    gs.sprite[j].control.right = false
                    gs.sprite[j].control.left = false
                    gs.sprite[j].control.up = false
                    gs.sprite[j].control.down = false
                    gs.sprite[j].legsApplyAnimation(gs.anims.stand, 1)
                  }
                }

                if (gs.sprite[j].legsAnimation.id === gs.anims.stand.id) {
                  // {$IFNDEF SERVER} 마운트음 (2281-2283) — 규약 11 훅으로 채택
                  gs.playSound(SFX_M2USE, gs.spriteParts.pos[j])

                  this.staticType = true
                  gs.sprite[j].stat = this.num
                  gs.sprite[j].brain.onePlaceCount = 0
                  // TODO(M3) NET: ServerThingTaken(Num, j)
                }
                break
              }
            }

            result = j
            return result // Exit (2299)
          } else {
            if (gs.sprite[j].stat === this.num) {
              gs.sprite[j].stat = 0
            }
          }

          this.staticType = false
        }
      } // for j
    }

    return result
  }

  // Things.pas:1035-1305 {$IFNDEF SERVER} Render/PolygonsRender — 클라 렌더 전용, core에는
  // 메서드 자체를 두지 않는다. web/bulletsrender.ts(T13)가 style/skeleton을 읽어 자체 드로우.
}

/* ****************************************************************************
 *                     CreateThing (Things.pas:72-554)                        *
 **************************************************************************** */

export function createThing(gs: GameState, sPos: TVector2, owner: number, sStyle: number, n: number): number {
  let i = 0

  // Remove flag if a new one is created
  if (sStyle < OBJECT_USSOCOM) {
    for (let k = 1; k <= MAX_THINGS; k++) {
      if (gs.thing[k].active && gs.thing[k].style === sStyle) {
        gs.thing[k].kill()
      }
    }
  }

  if (n === 255) {
    const s = 1
    // FIXME (helloer): Check if this should be synced (원본 95 주석)
    // {$IFNDEF SERVER} if sStyle = OBJECT_PARACHUTE then s := MAX_THINGS div 2 — 클라 전용
    // 슬롯 반분할 (96-99), 규약 13: 서버 동작(1번부터 스캔) 채택.

    for (i = s; i <= MAX_THINGS + 1; i++) {
      if (i === MAX_THINGS + 1) {
        return -1
      }
      if (!gs.thing[i].active) break
    }
  } else {
    i = n // i is now the active sprite
  }

  // Assert((i <> 0), 'thing id must not be 0') — n=255 스캔이 i>=1을 보장, n 지정 시 호출자 책임.

  const t = gs.thing[i]

  // activate sprite
  t.active = true
  t.style = sStyle
  t.num = i
  t.holdingSprite = 0
  t.owner = owner
  t.timeOut = 0
  t.skeleton.destroy()
  t.skeleton.timeStep = 1
  t.staticType = false
  t.inBase = false
  // {$IFNDEF SERVER} Tex1/Tex2 := 0 — 렌더 상태, 생략 (127-130)

  t.bgState.backgroundStatus = BACKGROUND_TRANSITION
  t.bgState.backgroundPoly = BACKGROUND_POLY_UNKNOWN

  for (let k = 1; k <= 4; k++) {
    t.collideCount[k] = 0
  }

  // k: 무기 스프라이트 좌/우 텍스처 선택 (138-145) — 이 포트에서는 Tex1/Tex2가 생략되어
  // 소비처가 없지만, 원본 제어 흐름(Sprite[Owner].Direction 읽기)은 보존한다.
  // if Owner <> 255 then k := iif(Sprite[Owner].Direction = 1, 0, 1) else k := 0
  if (owner !== 255) {
    void gs.sprite[owner].direction
  }

  switch (sStyle) {
    // specific style creation
    case OBJECT_ALPHA_FLAG:
    case OBJECT_BRAVO_FLAG:
    case OBJECT_POINTMATCH_FLAG: {
      // Flag
      t.skeleton.vDamping = 0.991
      t.skeleton.gravity = 1.0 * gs.grav
      t.skeleton.clone(gs.flagSkeleton)
      // A and B flags face eachother.
      if (sStyle === OBJECT_ALPHA_FLAG) {
        t.skeleton.pos[3].x = 12
        t.skeleton.pos[4].x = 12
        t.skeleton.oldPos[3].x = 12
        t.skeleton.oldPos[4].x = 12
      }
      t.radius = 19
      if (sStyle !== OBJECT_POINTMATCH_FLAG) {
        t.inBase = true
      }

      // {$IFNDEF SERVER} Texture := GFX_OBJECTS_INFFLAG/FLAG — 렌더, 생략 (165-170)

      t.timeOut = FLAG_TIMEOUT
      t.interest = FLAG_INTEREST_TIME

      t.collideWithBullets = true

      if (gs.svGamemode === GAMESTYLE_INF && sStyle === OBJECT_ALPHA_FLAG) {
        t.collideWithBullets = false
      }
      break
    } // Flag

    case OBJECT_USSOCOM: {
      // Socom
      t.skeleton.vDamping = 0.994
      t.skeleton.gravity = 1.05 * gs.grav
      t.skeleton.clone(gs.rifleSkeleton10)
      t.radius = GUN_RADIUS
      t.timeOut = GUNRESISTTIME
      t.interest = 0
      t.collideWithBullets = gs.svGunsCollide
      break
    }
    case OBJECT_DESERT_EAGLE: {
      // Deagle
      t.skeleton.vDamping = 0.996
      t.skeleton.gravity = 1.09 * gs.grav
      t.skeleton.clone(gs.rifleSkeleton11)
      t.radius = GUN_RADIUS
      t.timeOut = GUNRESISTTIME
      t.interest = 0
      t.collideWithBullets = gs.svGunsCollide
      break
    }
    case OBJECT_HK_MP5: {
      // Mp5
      t.skeleton.vDamping = 0.995
      t.skeleton.gravity = 1.11 * gs.grav
      t.skeleton.clone(gs.rifleSkeleton22)
      t.radius = GUN_RADIUS
      t.timeOut = GUNRESISTTIME
      t.interest = 0
      t.collideWithBullets = gs.svGunsCollide
      break
    }
    case OBJECT_AK74: {
      // Ak74
      t.skeleton.vDamping = 0.994
      t.skeleton.gravity = 1.16 * gs.grav
      t.skeleton.clone(gs.rifleSkeleton37)
      t.radius = GUN_RADIUS
      t.timeOut = GUNRESISTTIME
      t.interest = 0
      t.collideWithBullets = gs.svGunsCollide
      break
    }
    case OBJECT_STEYR_AUG: {
      // SteyrAug
      t.skeleton.vDamping = 0.994
      t.skeleton.gravity = 1.16 * gs.grav
      t.skeleton.clone(gs.rifleSkeleton37)
      t.radius = GUN_RADIUS
      t.timeOut = GUNRESISTTIME
      t.interest = 0
      t.collideWithBullets = gs.svGunsCollide
      break
    }
    case OBJECT_SPAS12: {
      // Spas
      t.skeleton.vDamping = 0.993
      t.skeleton.gravity = 1.15 * gs.grav
      t.skeleton.clone(gs.rifleSkeleton36)
      t.radius = GUN_RADIUS
      t.timeOut = GUNRESISTTIME
      t.interest = 0
      t.collideWithBullets = gs.svGunsCollide
      break
    }
    case OBJECT_RUGER77: {
      // Ruger
      t.skeleton.vDamping = 0.993
      t.skeleton.gravity = 1.13 * gs.grav
      t.skeleton.clone(gs.rifleSkeleton36)
      t.radius = GUN_RADIUS
      t.timeOut = GUNRESISTTIME
      t.interest = 0
      t.collideWithBullets = gs.svGunsCollide
      break
    }
    case OBJECT_M79: {
      // M79
      t.skeleton.vDamping = 0.994
      t.skeleton.gravity = 1.15 * gs.grav
      t.skeleton.clone(gs.rifleSkeleton28)
      // FIXME (helloer): Check why Tex1 is different (원본 280 주석 — Tex1 자체는 생략)
      t.radius = GUN_RADIUS
      t.timeOut = GUNRESISTTIME
      t.interest = 0
      t.collideWithBullets = gs.svGunsCollide
      break
    }
    case OBJECT_BARRET_M82A1: {
      // Barrett
      t.skeleton.vDamping = 0.993
      t.skeleton.gravity = 1.18 * gs.grav
      t.skeleton.clone(gs.rifleSkeleton43)
      t.radius = GUN_RADIUS
      t.timeOut = GUNRESISTTIME
      t.interest = 0
      t.collideWithBullets = gs.svGunsCollide
      break
    }
    case OBJECT_MINIMI: {
      // M249
      t.skeleton.vDamping = 0.993
      t.skeleton.gravity = 1.2 * gs.grav
      t.skeleton.clone(gs.rifleSkeleton39)
      t.radius = GUN_RADIUS
      t.timeOut = GUNRESISTTIME
      t.interest = 0
      t.collideWithBullets = gs.svGunsCollide
      break
    }
    case OBJECT_MINIGUN: {
      // Minigun
      t.skeleton.vDamping = 0.991
      t.skeleton.gravity = 1.4 * gs.grav
      t.skeleton.clone(gs.rifleSkeleton55)
      t.radius = GUN_RADIUS
      t.timeOut = GUNRESISTTIME
      t.interest = 0
      t.collideWithBullets = gs.svGunsCollide
      break
    }
    case OBJECT_RAMBO_BOW: {
      // Bow
      t.skeleton.vDamping = 0.996
      t.skeleton.gravity = 0.65 * gs.grav
      t.skeleton.clone(gs.rifleSkeleton50)
      t.radius = BOW_RADIUS
      t.timeOut = FLAG_TIMEOUT
      t.interest = BOW_INTEREST_TIME
      t.collideWithBullets = true
      break
    }
    case OBJECT_MEDICAL_KIT: {
      // medikit
      recordAssignSkeleton(t.skeleton, gs.boxSkeleton) // Skeleton := BoxSkeleton (record 대입)
      t.skeleton.vDamping = 0.989
      t.skeleton.gravity = 1.05 * gs.grav
      t.radius = KIT_RADIUS
      t.timeOut = gs.svRespawntime * GUNRESISTTIME
      t.interest = DEFAULT_INTEREST_TIME
      t.collideWithBullets = gs.svKitsCollide
      break
    }
    case OBJECT_GRENADE_KIT: {
      // grenadekit
      recordAssignSkeleton(t.skeleton, gs.boxSkeleton)
      t.skeleton.vDamping = 0.989
      t.skeleton.gravity = 1.07 * gs.grav
      t.radius = KIT_RADIUS
      t.timeOut = FLAG_TIMEOUT
      t.interest = DEFAULT_INTEREST_TIME
      t.collideWithBullets = gs.svKitsCollide
      break
    }
    case OBJECT_FLAMER_KIT: {
      // flamerkit
      recordAssignSkeleton(t.skeleton, gs.boxSkeleton)
      t.skeleton.vDamping = 0.989
      t.skeleton.gravity = 1.17 * gs.grav
      t.radius = KIT_RADIUS
      t.timeOut = FLAG_TIMEOUT
      t.interest = DEFAULT_INTEREST_TIME
      t.collideWithBullets = gs.svKitsCollide
      break
    }
    case OBJECT_PREDATOR_KIT: {
      // predatorkit
      recordAssignSkeleton(t.skeleton, gs.boxSkeleton)
      t.skeleton.vDamping = 0.989
      t.skeleton.gravity = 1.17 * gs.grav
      t.radius = KIT_RADIUS
      t.timeOut = FLAG_TIMEOUT
      t.interest = DEFAULT_INTEREST_TIME
      t.collideWithBullets = gs.svKitsCollide
      break
    }
    case OBJECT_VEST_KIT: {
      // vestkit
      recordAssignSkeleton(t.skeleton, gs.boxSkeleton)
      t.skeleton.vDamping = 0.989
      t.skeleton.gravity = 1.17 * gs.grav
      t.radius = KIT_RADIUS
      t.timeOut = FLAG_TIMEOUT
      t.interest = DEFAULT_INTEREST_TIME
      t.collideWithBullets = gs.svKitsCollide
      break
    }
    case OBJECT_BERSERK_KIT: {
      // berserkerkit
      recordAssignSkeleton(t.skeleton, gs.boxSkeleton)
      t.skeleton.vDamping = 0.989
      t.skeleton.gravity = 1.17 * gs.grav
      t.radius = KIT_RADIUS
      t.timeOut = FLAG_TIMEOUT
      t.interest = DEFAULT_INTEREST_TIME
      t.collideWithBullets = gs.svKitsCollide
      break
    }
    case OBJECT_CLUSTER_KIT: {
      // clusterkit
      recordAssignSkeleton(t.skeleton, gs.boxSkeleton)
      t.skeleton.vDamping = 0.989
      t.skeleton.gravity = 1.07 * gs.grav
      t.radius = KIT_RADIUS
      t.timeOut = FLAG_TIMEOUT
      t.interest = DEFAULT_INTEREST_TIME
      t.collideWithBullets = gs.svKitsCollide
      break
    }
    case OBJECT_PARACHUTE: {
      // para
      t.skeleton.vDamping = 0.993
      t.skeleton.gravity = 1.15 * gs.grav
      t.skeleton.clone(gs.paraSkeleton)
      t.timeOut = 3600
      // (원본 그대로 Radius/Interest/CollideWithBullets는 미설정 — 슬롯의 이전 값이 잔류한다)
      break
    }
    case OBJECT_COMBAT_KNIFE: {
      // Knife
      t.skeleton.vDamping = 0.994
      t.skeleton.gravity = 1.15 * gs.grav
      t.skeleton.clone(gs.rifleSkeleton18)

      // 칼은 Pos[1]/[2]를 서로 뒤바꾼다 (451-459) — a := Pos[2] 임시본 경유, 원본 대입 순서 그대로
      const a = cloneVec2(t.skeleton.pos[2])
      t.skeleton.pos[2] = cloneVec2(t.skeleton.pos[1])
      t.skeleton.oldPos[2] = cloneVec2(t.skeleton.pos[1])

      t.skeleton.pos[1] = cloneVec2(a)
      t.skeleton.oldPos[1] = cloneVec2(a)

      t.skeleton.pos[1].x = t.skeleton.pos[1].x + random(100) / 100
      t.skeleton.pos[2].x = t.skeleton.pos[2].x - random(100) / 100

      t.radius = GUN_RADIUS * 1.5
      t.timeOut = GUNRESISTTIME
      t.interest = 0
      t.collideWithBullets = gs.svGunsCollide
      break
    }
    case OBJECT_CHAINSAW: {
      // Chainsaw
      t.skeleton.vDamping = 0.994
      t.skeleton.gravity = 1.15 * gs.grav
      t.skeleton.clone(gs.rifleSkeleton28)
      t.radius = GUN_RADIUS
      t.timeOut = GUNRESISTTIME
      t.interest = 0
      t.collideWithBullets = gs.svGunsCollide
      break
    }
    case OBJECT_LAW: {
      // LAW
      t.skeleton.vDamping = 0.994
      t.skeleton.gravity = 1.15 * gs.grav
      t.skeleton.clone(gs.rifleSkeleton28)
      t.radius = GUN_RADIUS
      t.timeOut = GUNRESISTTIME
      t.interest = 0
      t.collideWithBullets = gs.svGunsCollide
      break
    }
    case OBJECT_STATIONARY_GUN: {
      // stationary gun
      t.skeleton.vDamping = 0.99
      t.skeleton.gravity = 0.2 * gs.grav
      t.skeleton.clone(gs.statSkeleton)
      t.timeOut = 60
      t.radius = STAT_RADIUS
      t.staticType = false
      t.interest = 0
      t.collideWithBullets = false
      break
    }
  } // case

  t.owner = owner // 원본 그대로 이중 대입 (121, 514)
  t.moveSkeleton(sPos.x, sPos.y, false)

  // {$IFDEF SERVER} Throw weapon (517-547) — 규약 8a 채택
  if (
    ((sStyle > OBJECT_POINTMATCH_FLAG && sStyle < OBJECT_MEDICAL_KIT) ||
      sStyle === OBJECT_LAW ||
      sStyle === OBJECT_CHAINSAW) &&
    owner > 0 &&
    owner < MAX_SPRITES + 1
  ) {
    // Add player velocity
    t.skeleton.pos[1] = vec2Add(t.skeleton.pos[1], gs.spriteParts.velocity[owner])
    t.skeleton.pos[2] = vec2Add(t.skeleton.pos[2], gs.spriteParts.velocity[owner])

    // Add throw velocity
    const b = gs.sprite[owner].getCursorAimDirection()

    let weaponThrowSpeedPos1: number
    let weaponThrowSpeedPos2: number
    if (!gs.sprite[owner].deadMeat) {
      weaponThrowSpeedPos1 = 0.01
      weaponThrowSpeedPos2 = 3
    } else {
      weaponThrowSpeedPos1 = 0.02
      weaponThrowSpeedPos2 = 0.64
    }

    let weaponThrowVelocity = vec2Scale(b, weaponThrowSpeedPos1)
    t.skeleton.pos[1] = vec2Add(t.skeleton.pos[1], weaponThrowVelocity)
    weaponThrowVelocity = vec2Scale(b, weaponThrowSpeedPos2)
    t.skeleton.pos[2] = vec2Add(t.skeleton.pos[2], weaponThrowVelocity)
  }

  // send net info — TODO(M3) NET: if sStyle <> OBJECT_PARACHUTE then ServerThingMustSnapshot(i)

  return i
}

// Things.pas:556-560 ThingCollision
export function thingCollision(thingNum: number, cooldownEnd: number): TThingCollision {
  return { thingNum, cooldownEnd }
}

/* ****************************************************************************
 *                      SpawnBoxes (Things.pas:562-618)                       *
 **************************************************************************** */

// 메디킷/수류탄킷 스폰 위치 선택 — RandomizeStart와 달리 Thing[Num].LastSpawn(직전 스폰포인트)을
// 제외하고 뽑고, 뽑은 스폰포인트를 LastSpawn에 기록한다. 요청 팀 스폰이 직전 것뿐이면 그것을
// 재사용, 하나도 없으면 result=false + 전체 활성 스폰 폴백.
// var Start out-param → { result, start } 반환 객체 (calc.ts/randomizeStart 규약).
export function spawnBoxes(gs: GameState, team: number, num: number): { result: boolean; start: TVector2 } {
  const map = gs.map
  let result = true

  const start = vector2(0, 0)

  // Spawns: array[1..255] of Integer := -1
  const spawns: number[] = new Array(255 + 1).fill(-1)

  let spawnsCount = 0
  let previousSpawn = 0

  // Pascal은 고정 1..255를 순회(미사용 슬롯은 Active=False 기본값) — randomizeStart와 동일하게
  // 실제 할당 길이 가드 추가 (관찰 동등).
  for (let i = 1; i <= 255 && i < map.spawnpoints.length; i++) {
    if (map.spawnpoints[i].active && map.spawnpoints[i].team === team) {
      if (gs.thing[num].lastSpawn !== i) {
        spawnsCount++
        spawns[spawnsCount] = i
      } else {
        previousSpawn = i
      }
    }
  }

  if (spawnsCount === 0) {
    if (previousSpawn !== 0) {
      spawnsCount++
      spawns[spawnsCount] = previousSpawn
    } else {
      result = false
      for (let i = 1; i <= 255 && i < map.spawnpoints.length; i++) {
        if (map.spawnpoints[i].active) {
          spawnsCount++
          spawns[spawnsCount] = i
        }
      }
    }
  }

  if (spawnsCount > 0) {
    const i = random(spawnsCount) + 1
    start.x = map.spawnpoints[spawns[i]].x - 4 + random(8)
    start.y = map.spawnpoints[spawns[i]].y - 4 + random(4)
    gs.thing[num].lastSpawn = spawns[i]
  }

  return { result, start }
}

/* ****************************************************************************
 *                    RandomizeStart (Things.pas:620-663)                     *
 **************************************************************************** */

// 스폰 위치 선택 로직: 요청 팀의 활성 스폰포인트 중 랜덤(±4/±4 지터), 해당 팀 스폰이 없으면
// result=false + 전체 활성 스폰포인트로 폴백 — DM(team 0)/CTF(team 1,2)/깃발(team 5,6)/키트류
// (team 7..15)가 모두 이 한 함수로 커버된다. M1에서 sprites.ts에 임시 거처였다가 Things.pas
// 본체 포팅(M2 T5)과 함께 여기로 이동 — sprites.ts는 re-export로 기존 import 경로 호환.
// var Start out-param → { result, start } 반환 객체 (calc.ts 규약).
export function randomizeStart(gs: GameState, team: number): { result: boolean; start: TVector2 } {
  const map = gs.map
  let result = true

  const start = vector2(0, 0)

  // Spawns: array[1..255] of Integer := -1 — Pascal은 고정 크기 배열, 여기선 필요 슬롯만.
  const spawns: number[] = new Array(MAX_SPAWNPOINTS + 1).fill(-1)

  let spawnsCount = 0

  // Pascal은 고정 1..MAX_SPAWNPOINTS를 순회(미사용 슬롯은 Active=False 기본값) —
  // polymap.spawnpoints는 실제 개수+1만 할당하므로 length 가드 추가 (관찰 동등).
  for (let i = 1; i <= MAX_SPAWNPOINTS && i < map.spawnpoints.length; i++) {
    if (map.spawnpoints[i].active && map.spawnpoints[i].team === team) {
      spawnsCount++
      spawns[spawnsCount] = i
    }
  }

  if (spawnsCount === 0) {
    result = false
    for (let i = 1; i <= MAX_SPAWNPOINTS && i < map.spawnpoints.length; i++) {
      if (map.spawnpoints[i].active) {
        spawnsCount++
        spawns[spawnsCount] = i
      }
    }
  }

  if (spawnsCount > 0) {
    const i = random(spawnsCount) + 1
    start.x = map.spawnpoints[spawns[i]].x - 4 + random(8)
    start.y = map.spawnpoints[spawns[i]].y - 4 + random(4)
  }

  return { result, start }
}
