// 1:1 포팅 (part 1): soldat-ref/soldat/shared/mechanics/Sprites.pas (4923 lines)
// TSprite 구조체 + CreateSprite + 스켈레톤 생성 + 맵 충돌 계열 + 스폰/리스폰 — M1(이동) 범위.
//
// 스코프 (Task 9)
// ---------------
// * 번역: TSprite 필드 전체, TControl, CreateSprite(240-379), TeamCollides(381-437),
//   LegsApplyAnimation/BodyApplyAnimation(2395-2434), MoveSkeleton(2435-2461),
//   CheckRadiusMapCollision(2462-2572), CheckMapCollision(2573-2847),
//   CheckMapVerticesCollision(2848-2907), CheckSkeletonMapCollision(2908-3020),
//   HandleSpecialPolyTypes(3022-3125), TBackgroundState(3127-3200), FreeControls(3378),
//   CheckOutOfBounds(3399), CheckSkeletonOutOfBounds(3424), Respawn(3455-3775),
//   ResetSpriteOldPos(3776), GetMoveacc(4813), GetCursorAimDirection/GetHandsAimDirection
//   (4852-4875), 팀/솔로 판정 헬퍼(4876-4915), CanRespawn(4916-4922).
// * Things.pas:620-663 RandomizeStart는 M1에서 여기 임시 거처였다가 M2 Task 5에서 things.ts로
//   이동 (파일 하단에서 re-export — 기존 import 경로 호환).
// * Anims.pas LoadAnimObjects 끝부분(SpriteParts/GostekSkeleton 셋업) → loadSpriteObjects().
// * TSprite.Update → M1 Task 11. Kill/Die/DropWeapon/ApplyWeaponByNum/HealthHit/Parachute/
//   ChangeTeam → M2 Task 6에서 구현 완료. Fire/ThrowFlag/ThrowGrenade + Update 전투 블록 +
//   Respawn/CreateSprite 무기 지급 → M2 Task 7에서 구현 완료.
//
// 빌드 기준: constants.ts와 동일하게 CLIENT 빌드. {$IFDEF SERVER} 전용 필드/라인은
// `// TODO(M3) SERVER` 주석으로 포함하거나 표기, 클라 전용 사운드 채널 필드는 생략(주석).
// 단, 이 포트는 "권위 로컬 심"이므로 서버가 게임플레이를 굴리는 데 필수인 라인
// (Respawn의 RandomizeStart, ResetSpriteOldPos 등)은 SERVER 출처 주석과 함께 채택한다.
//
// 전역 접근 규약: TSprite는 생성 시 GameState(gs)를 보관한다. 이 파일의 거의 모든 프로시저가
// Map/SpriteParts/anims/cvar 전역을 읽기 때문에, 매 호출 인자 전달보다 원본의 암묵적 전역
// 접근에 가장 가까운 형태다 (state.ts 헤더 참조). 자유 함수는 gs를 첫 인자로 받는다.
//
// record 대입 = 깊은 복사 규약:
// * `Skeleton := GostekSkeleton` → skeleton.destroy() + skeleton.clone(gostek) + 스칼라
//   (timeStep/gravity/vDamping/eDamping) 복사. Pascal object 값 대입은 스칼라까지 전부 덮는다
//   (parts.ts clone()은 파티클/제약만 복사하므로 스칼라를 명시적으로 따라 복사).
// * `LegsAnimation := Anim` → cloneAnimation() (frames까지 통째 복사 — Pascal TAnimation은
//   value object).
// * TVector2 대입은 cloneVec2 (별칭 방지).

import {
  type TVector2,
  vector2,
  cloneVec2,
  vec2Add,
  vec2Subtract,
  vec2Scale,
  vec2Length,
  vec2Normalize,
} from './vector'
import { trunc, random, randomFloat, pascalRound } from './pascal'
import { pointLineDistance, distanceVec2 } from './calc'
import { ParticleSystem, NUM_PARTICLES } from './parts'
import {
  type TGun,
  emptyGun,
  guns,
  weaponNumToIndex,
  weaponNameToNum,
  calculateBink,
  isSecondaryWeaponIndex,
  NOWEAPON_NUM,
  PRIMARY_WEAPONS,
  SECONDARY_WEAPONS,
  FRAGGRENADE,
  COLT,
  EAGLE,
  MP5,
  AK74,
  STEYRAUG,
  SPAS12,
  RUGER77,
  M79,
  BARRETT,
  M249,
  MINIGUN,
  KNIFE,
  CHAINSAW,
  LAW,
  BOW,
  BOW2,
  FLAMER,
  NOWEAPON,
  BULLET_STYLE_FRAGNADE,
  BULLET_STYLE_M79,
  BULLET_STYLE_FLAME,
  BULLET_STYLE_FLAMEARROW,
  BULLET_STYLE_CLUSTER,
  BULLET_STYLE_SHOTGUN,
  BULLET_STYLE_KNIFE,
} from './weapons'
import { TAnimation, MAX_FRAMES_INDEX, MAX_POS_INDEX } from './anims'
import {
  PolyMap,
  pointInPoly,
  MIN_SECTORZ,
  POLY_TYPE_DOESNT,
  POLY_TYPE_ONLY_BULLETS,
  POLY_TYPE_ONLY_FLAGGERS,
  POLY_TYPE_NOT_FLAGGERS,
  POLY_TYPE_NON_FLAGGER_COLLIDES,
  POLY_TYPE_RED_BULLETS,
  POLY_TYPE_RED_PLAYER,
  POLY_TYPE_BLUE_BULLETS,
  POLY_TYPE_BLUE_PLAYER,
  POLY_TYPE_YELLOW_BULLETS,
  POLY_TYPE_YELLOW_PLAYER,
  POLY_TYPE_GREEN_BULLETS,
  POLY_TYPE_GREEN_PLAYER,
  POLY_TYPE_BOUNCY,
  POLY_TYPE_ICE,
  POLY_TYPE_DEADLY,
  POLY_TYPE_BLOODY_DEADLY,
  POLY_TYPE_HURTS,
  POLY_TYPE_REGENERATES,
  POLY_TYPE_LAVA,
  POLY_TYPE_EXPLODES,
  POLY_TYPE_HURTS_FLAGGERS,
  POLY_TYPE_BACKGROUND,
  POLY_TYPE_BACKGROUND_TRANSITION,
  BACKGROUND_NORMAL,
  BACKGROUND_TRANSITION,
  BACKGROUND_POLY_UNKNOWN,
  BACKGROUND_POLY_NONE,
} from './polymap'
import {
  TEAM_NONE,
  TEAM_ALPHA,
  TEAM_BRAVO,
  TEAM_CHARLIE,
  TEAM_DELTA,
  TEAM_SPECTATOR,
  DEFAULTAIMDIST,
  DEFAULT_IDLETIME,
  BONUS_NONE,
  BONUS_PREDATOR,
  PREDATORALPHA,
  WAYPOINTTIMEOUT,
  MAX_PUSHTICK,
  MAX_OLDPOS,
  CLIENTSTOPMOVE_RETRYS,
  PARA_SPEED,
  PARA_DISTANCE,
  DEFAULT_GOALTICKS,
  MULTIKILLINTERVAL,
  BRUTALDEATHHEALTH,
  HEADCHOPDEATHHEALTH,
  HELMETFALLHEALTH,
  BONUS_BERSERKER,
  BONUS_FLAMEGOD,
  SURVIVAL_RESPAWNTIME,
  GAMESTYLE_DEATHMATCH,
  GAMESTYLE_POINTMATCH,
  GAMESTYLE_TEAMMATCH,
  GAMESTYLE_CTF,
  GAMESTYLE_RAMBO,
  GAMESTYLE_INF,
  GAMESTYLE_HTF,
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
  OBJECT_COMBAT_KNIFE,
  OBJECT_CHAINSAW,
  OBJECT_LAW,
  OBJECT_RAMBO_BOW,
  OBJECT_PARACHUTE,
  SFX_DEATH,
  SFX_HEADCHOP,
  SFX_BRYZG,
  SFX_KILLBERSERK,
  SFX_BURN,
  SFX_AK74_FIRE,
  SFX_M249_FIRE,
  SFX_RUGER77_FIRE,
  SFX_MP5_FIRE,
  SFX_SPAS12_FIRE,
  SFX_M79_FIRE,
  SFX_DESERTEAGLE_FIRE,
  SFX_STEYRAUG_FIRE,
  SFX_BARRETM82_FIRE,
  SFX_MINIGUN_FIRE,
  SFX_COLT1911_FIRE,
  SFX_BOW_FIRE,
  SFX_FLAMER,
  SFX_LAW,
  SFX_GRENADE_PULLOUT,
  SFX_GRENADE_THROW,
  MAX_INACCURACY,
  SECOND,
} from './constants'
import { controlSprite } from './control'
import { randomizeStart, createThing } from './things'
import { createSpark } from './sparks'
import { createBullet, serverCreateBullet } from './bullets'
import type { GameState } from './state'

/* ****************************************************************************
 *                        Constants (Sprites.pas:18-61)                       *
 **************************************************************************** */

// Net.pas:104 MAX_PLAYERS = 32 (Net.pas 미포팅 — Sprites.pas가 MAX_SPRITES = MAX_PLAYERS로
// 참조하므로 여기서 정의).
export const MAX_PLAYERS = 32
// Net.pas:107-108 ControlMethod
export const HUMAN = 1
export const BOT = 2

export const MAX_SPRITES = MAX_PLAYERS
export const MAX_BULLETS = 254
export const MAX_SPARKS = 558
export const MAX_THINGS = 90

export const SURFACECOEFX = 0.97
export const SURFACECOEFY = 0.97
export const CROUCHMOVESURFACECOEFX = 0.85
export const CROUCHMOVESURFACECOEFY = 0.97
export const STANDSURFACECOEFX = 0.0
export const STANDSURFACECOEFY = 0.0
export const GRENADE_SURFACECOEF = 0.88
export const SPARK_SURFACECOEF = 0.7

export const PART_RADIUS = 7
export const FLAG_PART_RADIUS = 10
export const SPRITE_RADIUS = 16
export const M79GRENADE_EXPLOSION_RADIUS = 64
export const FRAGGRENADE_EXPLOSION_RADIUS = 85
export const AFTER_EXPLOSION_RADIUS = 50
export const CLUSTERGRENADE_EXPLOSION_RADIUS = 35
export const BASE_RADIUS = 75
export const TOUCHDOWN_RADIUS = 28
export const SPRITE_COL_RADIUS = 3

export const FLAG_HOLDING_FORCEUP = -14
export const FLAG_STAND_FORCEUP = -16

export const BULLETALPHA = 110
export const MAXPATHCOUNT = 50

export const SLIDELIMIT = 0.2
export const MAX_VELOCITY = 11
export const BULLETTIME_MINDISTANCE = 320
export const FLAGTHROW_POWER = 4.225

export const NORMAL_DEATH = 1
export const BRUTAL_DEATH = 2
export const HEADCHOP_DEATH = 3

export const POS_STAND = 1
export const POS_CROUCH = 2
export const POS_PRONE = 4

// Anims.pas:52 `const SCALE = 3` — LoadAnimObjects가 gostek.po 로드에 쓰는 유닛 로컬 상수
// (anims.ts와 동일하게 로컬 정의 — Constants.SCALE과 별개, anims.ts 헤더 노트 참조).
const ANIMS_SCALE = 3

// 총기 식별: M1의 GUN_EQ/GUN_NEQ 자리표시자는 M2 Task 7에서 전부 실제
// `weapon.num === guns[X].num` 비교로 교체·삭제되었다 (guns[]는 weapons.ts, T1).

/* ****************************************************************************
 *                      TControl (Sprites.pas:69-73)                          *
 **************************************************************************** */

export interface TControl {
  left: boolean
  right: boolean
  up: boolean
  down: boolean
  fire: boolean
  jetpack: boolean
  throwNade: boolean
  changeWeapon: boolean
  throwWeapon: boolean
  reload: boolean
  prone: boolean
  flagThrow: boolean
  mouseAimX: number // SmallInt
  mouseAimY: number // SmallInt
  mouseDist: number // SmallInt
}

function defaultControl(): TControl {
  return {
    left: false, right: false, up: false, down: false,
    fire: false, jetpack: false, throwNade: false, changeWeapon: false,
    throwWeapon: false, reload: false, prone: false, flagThrow: false,
    mouseAimX: 0, mouseAimY: 0, mouseDist: 0,
  }
}

/* ****************************************************************************
 *                      TBotData (Sprites.pas:75-95)                          *
 **************************************************************************** */

export interface TBotData {
  favWeapon: number
  friend: string
  accuracy: number
  grenadeFreq: number
  deadKill: number
  waypointTimeoutCounter: number
  waypointTimeout: number
  chatFreq: number
  chatKill: string
  chatDead: string
  chatLowHealth: string
  chatSeeEnemy: string
  chatWinning: string
  pissedOff: number
  pathNum: number
  targetNum: number
  goThing: boolean
  currentWaypoint: number
  nextWaypoint: number
  oldWaypoint: number
  waypointTime: number
  lastWaypoint: number
  use: number
  onePlaceCount: number
  camper: number
  campTimer: number
  fallSave: number
}

function defaultBotData(): TBotData {
  return {
    favWeapon: 0, friend: '', accuracy: 0, grenadeFreq: 0, deadKill: 0,
    waypointTimeoutCounter: 0, waypointTimeout: 0, chatFreq: 0,
    chatKill: '', chatDead: '', chatLowHealth: '', chatSeeEnemy: '', chatWinning: '',
    pissedOff: 0, pathNum: 0, targetNum: 0, goThing: false,
    currentWaypoint: 0, nextWaypoint: 0, oldWaypoint: 0, waypointTime: 0, lastWaypoint: 0,
    use: 0, onePlaceCount: 0, camper: 0, campTimer: 0, fallSave: 0,
  }
}

/* ****************************************************************************
 *   TGun re-export (Weapons.pas:14-53 — 실제 정의는 weapons.ts, M2 Task 1)     *
 **************************************************************************** */

// M1 때 여기 있던 TGun 스텁(값은 전부 0)은 weapons.ts로 이관되었다. 기존 `from './sprites'`
// import 경로 호환을 위해 재수출만 한다.
export type { TGun }
export { emptyGun }

/* ****************************************************************************
 *        TPlayer — 최소 인터페이스 (Net.pas:252 TPlayer class 부분집합)      *
 **************************************************************************** */

// Net.pas의 TPlayer는 네트워크/스팀/서버 관리 필드가 대부분이라 M1에서는 Sprites.pas와
// Control.pas가 실제로 읽는 필드만 취한다:
//   Sprites.pas: Name, Team, ControlMethod, SecWep, HeadCap, SpriteNum, Camera, Kills, Deaths,
//                DemoPlayer (+ StandingPolyType는 SERVER 전용 → 생략)
//   Control.pas: ControlMethod
// 나머지(색상/핑/스팀 등)는 렌더링·네트워크 태스크에서 확장.
export interface TPlayer {
  name: string
  team: number
  controlMethod: number // HUMAN(1) | BOT(2)
  secWep: number
  headCap: number
  spriteNum: number // 0 if no sprite exists yet
  camera: number
  kills: number
  deaths: number
  // Net.pas TPlayer.Flags — CTF 캡처 스코어 (Things.pas:832/884가 증가, SortPlayers(T10)가
  // 정렬 키로 사용). M2 T9에서 추가.
  flags: number
  demoPlayer: boolean
}

export function createTPlayer(): TPlayer {
  // Pascal class 필드 zero-init과 동일한 기본값 (controlMethod만 HUMAN — 실제 생성 경로가
  // 항상 세팅하는 값이므로 편의 기본값으로 채택, 주석으로 명시).
  return {
    name: '',
    team: TEAM_NONE,
    controlMethod: HUMAN,
    secWep: 0,
    headCap: 0,
    spriteNum: 0,
    camera: 0,
    kills: 0,
    deaths: 0,
    flags: 0,
    demoPlayer: false,
  }
}

/* ****************************************************************************
 *                 TAnimation record-copy helper (value semantics)            *
 **************************************************************************** */

// Pascal의 `LegsAnimation := Anim`은 TAnimation object 값 복사 (frames 포함 전체).
// (control.ts도 직접 record 대입 라인들 — `LegsAnimation := GetUp/Roll/...` — 에서 사용.)
export function cloneAnimation(src: TAnimation): TAnimation {
  const a = new TAnimation()
  a.id = src.id
  a.numFrames = src.numFrames
  a.speed = src.speed
  a.count = src.count
  a.currFrame = src.currFrame
  a.loop = src.loop
  for (let f = 1; f <= MAX_FRAMES_INDEX; f++) {
    for (let p = 1; p <= MAX_POS_INDEX; p++) {
      const s = src.frames[f].pos[p]
      const d = a.frames[f].pos[p]
      d.x = s.x
      d.y = s.y
      d.z = s.z
    }
  }
  return a
}

/* ****************************************************************************
 *              TBackgroundState (Sprites.pas:97-105, 3127-3200)              *
 **************************************************************************** */

export class TBackgroundState {
  backgroundStatus = BACKGROUND_NORMAL // Byte zero-init = 0 (CreateSprite/Respawn이 재설정)
  backgroundPoly = 0 // SmallInt zero-init
  backgroundTestResult = false

  // Sprites.pas:3127-3150 TBackgroundState.BackgroundTest
  backgroundTest(map: PolyMap, poly: number): boolean {
    let result = false
    const polyType = map.polyType[poly]

    if (polyType === POLY_TYPE_BACKGROUND && this.backgroundStatus === BACKGROUND_TRANSITION) {
      this.backgroundTestResult = true
      this.backgroundPoly = poly
      this.backgroundStatus = BACKGROUND_TRANSITION
      result = true
    } else if (polyType === POLY_TYPE_BACKGROUND_TRANSITION) {
      this.backgroundTestResult = true
      if (this.backgroundStatus === BACKGROUND_NORMAL) {
        this.backgroundStatus = BACKGROUND_TRANSITION
      }
      result = true
    }
    return result
  }

  // Sprites.pas:3152-3168 TBackgroundState.BackgroundTestBigPolyCenter
  backgroundTestBigPolyCenter(map: PolyMap, pos: TVector2): void {
    if (this.backgroundStatus === BACKGROUND_TRANSITION) {
      if (this.backgroundPoly === BACKGROUND_POLY_UNKNOWN) {
        this.backgroundPoly = this.backgroundFindCurrentPoly(map, pos)
        if (this.backgroundPoly !== BACKGROUND_POLY_NONE) {
          this.backgroundTestResult = true
        }
      } else if (
        this.backgroundPoly !== BACKGROUND_POLY_NONE &&
        // 원본 그대로: BackgroundFindCurrentPoly가 돌려준 값은 BackPolys 배열 인덱스(i)인데
        // 여기서는 Map.Polys[BackgroundPoly]로 조회한다(반면 BackgroundTest는 진짜 폴리곤
        // 인덱스를 저장). 인덱스 공간이 뒤섞인 원본의 수상한 코드를 "고치지 않고" 보존.
        pointInPoly(pos, map.polys[this.backgroundPoly])
      ) {
        this.backgroundTestResult = true
      }
    }
  }

  // Sprites.pas:3170-3183 TBackgroundState.BackgroundFindCurrentPoly
  backgroundFindCurrentPoly(map: PolyMap, pos: TVector2): number {
    for (let i = 1; i <= map.backPolyCount; i++) {
      // Pascal: Map.BackPolys[i]^ (폴리곤 포인터 deref) — 이 포트의 backPolys는 polys 인덱스.
      if (pointInPoly(pos, map.polys[map.backPolys[i]])) {
        return i
      }
    }
    return BACKGROUND_POLY_NONE
  }

  // Sprites.pas:3185-3188
  backgroundTestPrepare(): void {
    this.backgroundTestResult = false
  }

  // Sprites.pas:3190-3200
  backgroundTestReset(): void {
    if (!this.backgroundTestResult) {
      this.backgroundStatus = BACKGROUND_NORMAL
      this.backgroundPoly = BACKGROUND_POLY_NONE
    }
  }
}

/* ****************************************************************************
 *                       TSprite (Sprites.pas:107-227)                        *
 **************************************************************************** */

export class TSprite {
  active = false
  deadMeat = false
  dummy = false
  style = 0 // Byte
  num = 0 // Byte
  visible = 0 // Byte
  onGround = false
  onGroundForLaw = false
  onGroundLastFrame = false
  onGroundPermanent = false
  direction = 0 // SmallInt
  oldDirection = 0 // SmallInt
  health = 0 // Single
  holdedThing = 0 // Byte
  flagGrabCooldown = 0
  aimDistCoef = 0 // Single
  fired = 0 // Byte
  alpha = 0 // Byte
  jetsCountReal = 0 // Single
  jetsCount = 0 // SmallInt
  jetsCountPrev = 0 // SmallInt
  wearHelmet = 0 // Byte
  hasCigar = 0 // Byte
  canMercy = false
  respawnCounter = 0 // SmallInt
  ceaseFireCounter = 0 // SmallInt
  selWeapon = 0 // Byte
  bonusStyle = 0
  bonusTime = 0
  multiKillTime = 0
  multiKills = 0
  vest = 0 // Single
  idleTime = 0
  idleRandom = 0 // ShortInt
  burstCount = 0 // Byte
  position = 0 // Byte
  onFire = 0 // Byte
  colliderDistance = 0 // Byte
  deadCollideCount = 0
  deadTime = 0
  para = 0 // Byte
  stat = 0 // Byte
  useTime = 0 // SmallInt
  halfDead = false
  lastWeaponHM = 0 // Single
  lastWeaponSpeed = 0 // Single
  lastWeaponStyle = 0 // Byte
  lastWeaponFire = 0 // Word
  lastWeaponReload = 0 // Word
  skeleton: ParticleSystem
  legsAnimation: TAnimation
  bodyAnimation: TAnimation
  control: TControl
  weapon: TGun
  secondaryWeapon: TGun
  tertiaryWeapon: TGun
  grenadeCanThrow = false
  brain: TBotData
  // Pascal: Player: TPlayer (class ref, 초기값 nil). 메서드들은 Active 스프라이트에서만 호출되며
  // 그때는 항상 non-nil — 원본도 nil 역참조에 대해 안전장치가 없다. 이 포트는 null 초기화 +
  // 메서드 내부 non-null 단언(this.player!)으로 동일한 계약을 표현한다.
  player: TPlayer | null = null
  isPlayerObjectOwner = false
  typing = false
  autoReloadWhenCanFire = false
  canAutoReloadSpas = false
  bgState: TBackgroundState
  // {$IFDEF SERVER} 전용 필드 — 규약 8a: 이 심이 권위 서버이므로 게임플레이 필드는 채택.
  // HasPack: 메디킷 재픽업 쿨다운 (Things.pas:1975/1979가 세팅, sv_healthcooldown 주기 해제는
  // ServerLoop.pas:424-428 — T10 틱오더).
  hasPack = false
  targetX = 0 // TODO(M3) SERVER
  targetY = 0 // TODO(M3) SERVER
  // {$ELSE} 클라 전용 사운드 채널 핸들(GattlingSoundChannel2/ReloadSoundChannel/
  // JetsSoundChannel/GattlingSoundChannel: LongInt)은 생략 — 오디오는 이 포트의 web 레이어 소관.
  oldDeadMeat = false // {$IFNDEF SERVER}
  muted = false // {$IFNDEF SERVER}
  dontDrop = false
  nextPush: TVector2[] // array [0..MAX_PUSHTICK] of TVector2
  bulletCount = 0 // Word
  // TODO(M3) SERVER: BulletCheck: array[0..BULLETCHECKARRAYSIZE] of Word;
  // BulletCheckIndex, BulletCheckAmount: Integer — 서버 안티치트 계열, M3에서.

  constructor(private readonly gs: GameState, num: number) {
    this.num = num
    this.skeleton = new ParticleSystem()
    this.legsAnimation = new TAnimation()
    this.bodyAnimation = new TAnimation()
    this.control = defaultControl()
    this.weapon = emptyGun()
    this.secondaryWeapon = emptyGun()
    this.tertiaryWeapon = emptyGun()
    this.brain = defaultBotData()
    this.bgState = new TBackgroundState()
    this.nextPush = Array.from({ length: MAX_PUSHTICK + 1 }, () => vector2(0, 0))
  }

  /* ──────────────────── update (Sprites.pas:438-1422) ─────────────────── */

  // Sprites.pas:438-1422 TSprite.Update — 스프라이트 틱 갱신 (스켈레톤 물리/애니메이션 전진/
  // OnGround 판정/무기 타이머/사망체 시뮬레이션). 이동부 전체 번역; 클라 전용 사운드/스파크
  // 라인은 주석 스텁, 무기 식별은 실제 guns[] 비교 (M2 Task 7).
  update(): void {
    const gs = this.gs
    const num = this.num
    const anims = gs.anims
    const map = gs.map

    // var i: Integer; MouseAim, P, M: TVector2; RNorm, LegVector: TVector2;
    // BodyY, ArmS: Single; LegDistance: Single = 0.0
    // ({$IFNDEF SERVER} k/RND/M3/M4/WeaponReloadSound — 클라 전용 출혈/사운드 변수, 미채택)
    let bodyY = 0
    let armS: number

    // {$IFDEF SERVER} Trace — 로깅 생략

    this.jetsCountPrev = this.jetsCount
    this.weapon.reloadTimePrev = this.weapon.reloadTimeCount
    this.weapon.fireIntervalPrev = this.weapon.fireIntervalCount

    bodyY = 0

    gs.spriteParts.velocity[num] = vec2Add(gs.spriteParts.velocity[num], this.nextPush[0])
    // {$IFNDEF SERVER} NextPush 시프트 루프 — constants.ts가 클라 값(MAX_PUSHTICK=125)을
    // 채택했으므로 시프트도 함께 채택. 서버 변형(MAX_PUSHTICK=0)은 단일 슬롯 "적용 후 클리어"라
    // 푸시가 항상 슬롯 0에 쓰이는 한 관찰 동등 (상호배타 IFDEF 쌍의 일관 채택).
    for (let i = 0; i <= MAX_PUSHTICK - 1; i++) {
      this.nextPush[i] = cloneVec2(this.nextPush[i + 1])
    }
    this.nextPush[MAX_PUSHTICK].x = 0
    this.nextPush[MAX_PUSHTICK].y = 0

    // reload spas after shooting delay is over
    if (
      this.autoReloadWhenCanFire &&
      (this.weapon.num !== guns[SPAS12].num || this.weapon.fireIntervalCount === 0)
    ) {
      this.autoReloadWhenCanFire = false

      if (
        this.weapon.num === guns[SPAS12].num &&
        this.bodyAnimation.id !== anims.roll.id &&
        this.bodyAnimation.id !== anims.rollBack.id &&
        this.bodyAnimation.id !== anims.change.id &&
        this.weapon.ammoCount !== this.weapon.ammo
      ) {
        this.bodyApplyAnimation(anims.reload, 1)
      }
    }

    // {$IFDEF SERVER} 변형 채택 — 클라: (ClientStopMovingCounter > 0)
    if (
      (this.player!.controlMethod === HUMAN &&
        gs.noClientUpdateTime[num] < CLIENTSTOPMOVE_RETRYS) ||
      this.player!.controlMethod === BOT
    ) {
      controlSprite(gs, this)
    }

    if (this.isSpectator()) {
      this.deadMeat = true
      // {$IFNDEF SERVER} if Num = MySprite then RespawnCounter := 19999;
      //   GameMenuShow(LimboMenu, False) — 클라 UI, 미채택
    }

    this.skeleton.oldPos[21] = cloneVec2(this.skeleton.pos[21])
    this.skeleton.oldPos[23] = cloneVec2(this.skeleton.pos[23])
    this.skeleton.oldPos[25] = cloneVec2(this.skeleton.pos[25])
    this.skeleton.pos[21] = cloneVec2(this.skeleton.pos[9])
    this.skeleton.pos[23] = cloneVec2(this.skeleton.pos[12])
    this.skeleton.pos[25] = cloneVec2(this.skeleton.pos[5])
    if (!this.deadMeat) {
      // 원본 그대로: Vec2Add는 함수(Vector.pas:119)인데 여기서 문장으로 호출돼 반환값이
      // 버려진다 — 이 세 줄은 사실상 no-op (Pos[21/23/25] 불변). "고치지 않고" 보존.
      void vec2Add(this.skeleton.pos[21], gs.spriteParts.velocity[num])
      void vec2Add(this.skeleton.pos[23], gs.spriteParts.velocity[num])
      void vec2Add(this.skeleton.pos[25], gs.spriteParts.velocity[num])
    }

    switch (this.position) {
      case POS_STAND:
        bodyY = 8
        break
      case POS_CROUCH:
        bodyY = 9
        break
      case POS_PRONE: {
        if (this.bodyAnimation.id === anims.prone.id) {
          if (this.bodyAnimation.currFrame > 9) bodyY = -2
          else bodyY = 14 - this.bodyAnimation.currFrame
        } else {
          bodyY = 9
        }

        if (this.bodyAnimation.id === anims.proneMove.id) bodyY = 0
        break
      }
    }

    if (this.bodyAnimation.id === anims.getUp.id) {
      if (this.bodyAnimation.currFrame > 18) bodyY = 8
      else bodyY = 4
    }

    if (this.flagGrabCooldown > 0) this.flagGrabCooldown--

    // Reset the background poly test before collision checks on the corpse
    if (this.deadMeat) this.bgState.backgroundTestPrepare()

    if (this.control.mouseAimX >= gs.spriteParts.pos[num].x) this.direction = 1
    else this.direction = -1

    for (let i = 1; i <= 20; i++) {
      if (this.skeleton.active[i] && !this.deadMeat) {
        this.skeleton.oldPos[i] = cloneVec2(this.skeleton.pos[i])

        if (!this.halfDead) {
          // legs
          if (
            i === 1 || i === 4 || i === 2 || i === 3 || i === 5 || i === 6 ||
            i === 17 || i === 18
          ) {
            this.skeleton.pos[i].x =
              gs.spriteParts.pos[num].x +
              this.direction * this.legsAnimation.frames[this.legsAnimation.currFrame].pos[i].x
            this.skeleton.pos[i].y =
              gs.spriteParts.pos[num].y +
              this.legsAnimation.frames[this.legsAnimation.currFrame].pos[i].y
          }
        }

        // body
        if (
          i === 7 || i === 8 || i === 9 || i === 10 || i === 11 || i === 12 ||
          i === 13 || i === 14 || i === 15 || i === 16 || i === 19 || i === 20
        ) {
          this.skeleton.pos[i].x =
            gs.spriteParts.pos[num].x +
            this.direction * this.bodyAnimation.frames[this.bodyAnimation.currFrame].pos[i].x
          if (!this.halfDead) {
            this.skeleton.pos[i].y =
              this.skeleton.pos[6].y -
              (gs.spriteParts.pos[num].y - bodyY) +
              gs.spriteParts.pos[num].y +
              this.bodyAnimation.frames[this.bodyAnimation.currFrame].pos[i].y
          } else {
            this.skeleton.pos[i].y =
              9 +
              gs.spriteParts.pos[num].y +
              this.bodyAnimation.frames[this.bodyAnimation.currFrame].pos[i].y
          }
        }
      }
    }

    if (!this.deadMeat) {
      // Rotate parts
      // head
      {
        const i = 12
        const p = vector2(this.skeleton.pos[i].x, this.skeleton.pos[i].y)
        const mouseAim = vector2(this.control.mouseAimX, this.control.mouseAimY)
        let rNorm = vec2Subtract(p, mouseAim)
        rNorm = vec2Normalize(rNorm)
        rNorm = vec2Scale(rNorm, 0.1)
        this.skeleton.pos[i].x = this.skeleton.pos[9].x - this.direction * rNorm.y
        this.skeleton.pos[i].y = this.skeleton.pos[9].y + this.direction * rNorm.x

        rNorm = vec2Scale(rNorm, 50)
        this.skeleton.pos[23].x = this.skeleton.pos[9].x - this.direction * rNorm.y
        this.skeleton.pos[23].y = this.skeleton.pos[9].y + this.direction * rNorm.x
      }

      if (this.bodyAnimation.id === anims.throw.id) armS = -5
      else armS = -7

      // arm
      {
        const i = 15
        if (
          this.bodyAnimation.id !== anims.reload.id &&
          this.bodyAnimation.id !== anims.reloadBow.id &&
          this.bodyAnimation.id !== anims.clipIn.id &&
          this.bodyAnimation.id !== anims.clipOut.id &&
          this.bodyAnimation.id !== anims.slideBack.id &&
          this.bodyAnimation.id !== anims.change.id &&
          this.bodyAnimation.id !== anims.throwWeapon.id &&
          this.bodyAnimation.id !== anims.weaponNone.id &&
          this.bodyAnimation.id !== anims.punch.id &&
          this.bodyAnimation.id !== anims.roll.id &&
          this.bodyAnimation.id !== anims.rollBack.id &&
          this.bodyAnimation.id !== anims.cigar.id &&
          this.bodyAnimation.id !== anims.match.id &&
          this.bodyAnimation.id !== anims.smoke.id &&
          this.bodyAnimation.id !== anims.wipe.id &&
          this.bodyAnimation.id !== anims.takeOff.id &&
          this.bodyAnimation.id !== anims.groin.id &&
          this.bodyAnimation.id !== anims.piss.id &&
          this.bodyAnimation.id !== anims.mercy.id &&
          this.bodyAnimation.id !== anims.mercy2.id &&
          this.bodyAnimation.id !== anims.victory.id &&
          this.bodyAnimation.id !== anims.own.id &&
          this.bodyAnimation.id !== anims.melee.id
        ) {
          let p = vector2(this.skeleton.pos[i].x, this.skeleton.pos[i].y)
          const mouseAim = vector2(this.control.mouseAimX, this.control.mouseAimY)
          let rNorm = vec2Subtract(p, mouseAim)
          rNorm = vec2Normalize(rNorm)
          rNorm = vec2Scale(rNorm, armS)
          const m = vector2(this.skeleton.pos[16].x, this.skeleton.pos[16].y)
          p = vec2Add(m, rNorm)
          this.skeleton.pos[i].x = p.x
          this.skeleton.pos[i].y = p.y
        }
      }

      if (this.bodyAnimation.id === anims.throw.id) armS = -6
      else armS = -8

      // arm
      {
        const i = 19
        if (
          this.bodyAnimation.id !== anims.reload.id &&
          this.bodyAnimation.id !== anims.reloadBow.id &&
          this.bodyAnimation.id !== anims.clipIn.id &&
          this.bodyAnimation.id !== anims.clipOut.id &&
          this.bodyAnimation.id !== anims.slideBack.id &&
          this.bodyAnimation.id !== anims.change.id &&
          this.bodyAnimation.id !== anims.throwWeapon.id &&
          this.bodyAnimation.id !== anims.weaponNone.id &&
          this.bodyAnimation.id !== anims.punch.id &&
          this.bodyAnimation.id !== anims.roll.id &&
          this.bodyAnimation.id !== anims.rollBack.id &&
          this.bodyAnimation.id !== anims.cigar.id &&
          this.bodyAnimation.id !== anims.match.id &&
          this.bodyAnimation.id !== anims.smoke.id &&
          this.bodyAnimation.id !== anims.wipe.id &&
          this.bodyAnimation.id !== anims.takeOff.id &&
          this.bodyAnimation.id !== anims.groin.id &&
          this.bodyAnimation.id !== anims.piss.id &&
          this.bodyAnimation.id !== anims.mercy.id &&
          this.bodyAnimation.id !== anims.mercy2.id &&
          this.bodyAnimation.id !== anims.victory.id &&
          this.bodyAnimation.id !== anims.own.id &&
          this.bodyAnimation.id !== anims.melee.id
        ) {
          let p = vector2(this.skeleton.pos[i].x, this.skeleton.pos[i].y)
          const mouseAim = vector2(this.control.mouseAimX, this.control.mouseAimY)
          let rNorm = vec2Subtract(p, mouseAim)
          rNorm = vec2Normalize(rNorm)
          rNorm = vec2Scale(rNorm, armS)
          const m = vector2(this.skeleton.pos[16].x, this.skeleton.pos[16].y - 4)
          p = vec2Add(m, rNorm)
          this.skeleton.pos[i].x = p.x
          this.skeleton.pos[i].y = p.y
        }
      }
    }

    for (let i = 1; i <= 20; i++) {
      // dead part
      // Pascal 연산자 우선순위 그대로: `DeadMeat or HalfDead and IsNotSpectator()` 는
      // and가 먼저 → DeadMeat or (HalfDead and IsNotSpectator())
      if (this.deadMeat || (this.halfDead && this.isNotSpectator())) {
        if (
          i !== 17 && i !== 18 && i !== 19 && i !== 20 && i !== 8 && i !== 7 && i < 21
        ) {
          this.onGround = this.checkSkeletonMapCollision(
            i,
            this.skeleton.pos[i].x,
            this.skeleton.pos[i].y,
          )
        }

        // {$IFNDEF SERVER} 출혈(끊긴 constraint에서 CreateSpark 5/4) + 시체 화염
        //   (CreateSpark 36/37, PlaySound SFX_ONFIRE/SFX_FIRECRACK) 블록
        //   (Sprites.pas:717-784) — TODO(M2/render)
      }
    }

    // If no background poly contact in CheckSkeletonMapCollision() then reset any background
    // poly status
    if (this.deadMeat) this.bgState.backgroundTestReset()

    // {$IFDEF SERVER} Trace('TSprite.Update 2') — 로깅 생략

    if (!this.deadMeat) {
      switch (this.style) {
        case 1: {
          this.bodyAnimation.doAnimation()
          this.legsAnimation.doAnimation()

          this.checkOutOfBounds()

          this.onGround = false

          // {$IFNDEF SERVER} if OldDeadMeat then Respawn; OldDeadMeat := DeadMeat —
          //   클라 스냅샷 기반 리스폰 경로. 서버 변형은 dead 분기의 RespawnCounter 경로만
          //   사용하므로 미채택 (상호배타 리스폰 경로의 이중 채택 금지).

          // Reset the background poly test before collision checks
          this.bgState.backgroundTestPrepare()

          // head
          this.checkMapCollision(
            gs.spriteParts.pos[num].x - 3.5,
            gs.spriteParts.pos[num].y - 12,
            1,
          )

          this.checkMapCollision(
            gs.spriteParts.pos[num].x + 3.5,
            gs.spriteParts.pos[num].y - 12,
            1,
          )

          bodyY = 0
          armS = 0

          // Walking either left or right (though only one can be active at once)
          if (this.control.left !== this.control.right) {
            // If walking in facing direction
            if (this.control.left !== (this.direction === 1)) armS = 0.25
            // Walking backwards
            else bodyY = 0.25
          }

          // If a leg is inside a polygon, caused by the modification of ArmS and BodyY,
          // this is there to not lose contact to ground on slope polygons
          if (bodyY === 0) {
            const legVector = vector2(
              gs.spriteParts.pos[num].x + 2,
              gs.spriteParts.pos[num].y + 1.9,
            )
            // Map.RayCast(LegVector, LegVector, LegDistance, 10) — var LegDistance는
            // 이후 미사용 → 반환 객체의 distance 무시
            if (map.rayCast(legVector, legVector, 10).hit) bodyY = 0.25
          }
          if (armS === 0) {
            const legVector = vector2(
              gs.spriteParts.pos[num].x - 2,
              gs.spriteParts.pos[num].y + 1.9,
            )
            if (map.rayCast(legVector, legVector, 10).hit) armS = 0.25
          }

          // Legs collison check. If collided then don't check the other side as a possible
          // double CheckMapCollision collision would result in too much of a ground
          // repelling force. (Pascal `or`는 단락 평가 — || 로 동일하게 두 번째 호출 생략)
          this.onGround = this.checkMapCollision(
            gs.spriteParts.pos[num].x + 2,
            gs.spriteParts.pos[num].y + 2 - bodyY,
            0,
          )

          this.onGround =
            this.onGround ||
            this.checkMapCollision(
              gs.spriteParts.pos[num].x - 2,
              gs.spriteParts.pos[num].y + 2 - armS,
              0,
            )

          // radius collison check
          this.onGroundForLaw = this.checkRadiusMapCollision(
            gs.spriteParts.pos[num].x,
            gs.spriteParts.pos[num].y - 1,
            this.onGround,
          )

          this.onGround =
            this.checkMapVerticesCollision(
              gs.spriteParts.pos[num].x,
              gs.spriteParts.pos[num].y,
              3,
              this.onGround || this.onGroundForLaw,
            ) || this.onGround

          // Change the permanent state if the player has had the same OnGround state for
          // two frames in a row
          if (!(this.onGround !== this.onGroundLastFrame)) {
            this.onGroundPermanent = this.onGround
          }

          this.onGroundLastFrame = this.onGround

          // If no background poly contact then reset any background poly status
          this.bgState.backgroundTestReset()

          // WEAPON HANDLING
          // {$IFNDEF SERVER} (Num = MySprite) or (FireInterval <= FIREINTERVAL_NET) or
          //   not PointVisible(...) 게이트 — 서버 변형은 게이트 없이 항상 수행
          if (
            this.weapon.fireIntervalCount > 0 &&
            (this.weapon.ammoCount > 0 || this.weapon.num === guns[SPAS12].num)
          ) {
            this.weapon.fireIntervalPrev = this.weapon.fireIntervalCount
            this.weapon.fireIntervalCount--
          }

          // If fire button is released, then the reload can begin
          if (!this.control.fire) this.canAutoReloadSpas = true

          // reload
          if (
            this.weapon.ammoCount === 0 &&
            (this.weapon.num === guns[CHAINSAW].num ||
              (this.bodyAnimation.id !== anims.roll.id &&
                this.bodyAnimation.id !== anims.rollBack.id &&
                this.bodyAnimation.id !== anims.melee.id &&
                this.bodyAnimation.id !== anims.change.id &&
                this.bodyAnimation.id !== anims.throw.id &&
                this.bodyAnimation.id !== anims.throwWeapon.id))
          ) {
            // {$IFNDEF SERVER} SetSoundPaused(ReloadSoundChannel, False) — TODO(M2/render)

            if (this.bodyAnimation.id !== anims.getUp.id) {
              // spas is unique - it does the fire interval delay AND THEN reloads. all other
              // weapons do the opposite.
              if (this.weapon.num === guns[SPAS12].num) {
                if (this.weapon.fireIntervalCount === 0 && this.canAutoReloadSpas) {
                  this.bodyApplyAnimation(anims.reload, 1)
                }
              } else if (
                this.weapon.num === guns[BOW].num ||
                this.weapon.num === guns[BOW2].num
              ) {
                this.bodyApplyAnimation(anims.reloadBow, 1)
              } else if (
                this.bodyAnimation.id !== anims.clipIn.id &&
                this.bodyAnimation.id !== anims.slideBack.id
              ) {
                // Don't show reload animation for chainsaw if one of these animations are
                // already ongoing
                if (
                  this.weapon.num !== guns[CHAINSAW].num ||
                  (this.bodyAnimation.id !== anims.roll.id &&
                    this.bodyAnimation.id !== anims.rollBack.id &&
                    this.bodyAnimation.id !== anims.melee.id &&
                    this.bodyAnimation.id !== anims.change.id &&
                    this.bodyAnimation.id !== anims.throw.id &&
                    this.bodyAnimation.id !== anims.throwWeapon.id)
                ) {
                  this.bodyApplyAnimation(anims.clipOut, 1)
                }
              }

              this.burstCount = 0
            }

            // {$IFNDEF SERVER} 무기별 장전 사운드 선택(PlaySound) + ClipOutTime 도달 시
            //   탄창 배출 CreateSpark 블록 (Sprites.pas:944-1004) — TODO(M2/render)

            if (this.weapon.num !== guns[SPAS12].num) {
              // Spas doesn't use the reload time.
              // If it ever does, be sure to put this back outside.
              this.weapon.reloadTimePrev = this.weapon.reloadTimeCount
              if (this.weapon.reloadTimeCount > 0) this.weapon.reloadTimeCount--

              // spas waits for fire interval to hit 0.
              // doing this next line for the spas would cause it to never reload when empty.
              this.weapon.fireIntervalPrev = this.weapon.fireInterval
              this.weapon.fireIntervalCount = this.weapon.fireInterval

              if (this.weapon.reloadTimeCount < 1) {
                this.weapon.reloadTimePrev = this.weapon.reloadTime
                this.weapon.fireIntervalPrev = this.weapon.fireInterval
                this.weapon.reloadTimeCount = this.weapon.reloadTime
                this.weapon.fireIntervalCount = this.weapon.fireInterval
                this.weapon.startUpTimeCount = this.weapon.startUpTime
                this.weapon.ammoCount = this.weapon.ammo
              }
            }
          }

          // weapon jam fix?
          // TODO: check if server or client do stuff wrong here... (원본 주석 보존)
          if (this.weapon.ammoCount === 0) {
            // {$IFDEF SERVER} — 권위 로컬 심 채택
            if (this.weapon.reloadTimeCount < 1) {
              this.weapon.reloadTimeCount = this.weapon.reloadTime
              this.weapon.fireIntervalCount = this.weapon.fireInterval
              this.weapon.startUpTimeCount = this.weapon.startUpTime
              this.weapon.ammoCount = this.weapon.ammo
            }
            if (this.weapon.reloadTimeCount > this.weapon.reloadTime) {
              this.weapon.reloadTimeCount = this.weapon.reloadTime
            }

            if (this.weapon.num !== guns[SPAS12].num) {
              if (this.weapon.reloadTimeCount < 1) {
                // {$IFDEF SERVER}
                this.bodyApplyAnimation(anims.change, 36)
                // {$ENDIF}
                this.weapon.reloadTimePrev = this.weapon.reloadTime
                this.weapon.fireIntervalPrev = this.weapon.fireInterval
                this.weapon.reloadTimeCount = this.weapon.reloadTime
                this.weapon.fireIntervalCount = this.weapon.fireInterval
                this.weapon.startUpTimeCount = this.weapon.startUpTime
                this.weapon.ammoCount = this.weapon.ammo
              }

              // {$IFNDEF SERVER} ReloadTimeCount 클램프 + "didn't we just do this right
              //   above? :S" 중복 리필/Change(36) 블록 (Sprites.pas:1062-1081) — 서버 변형
              //   미채택 (직전 {$IFDEF SERVER} 블록과 상호배타)
            }
          }

          // {$IFNDEF SERVER} 체인소 연기/사운드(1086-1109), LAW·체인소 탄약 소진 연기
          //   (1112-1124), 화염 화살 스파크(1127-1133) — TODO(M2/render)

          // JETS
          // {$IFDEF SERVER} 변형 채택 — 클라: (ClientStopMovingCounter > 0)
          if (
            (this.player!.controlMethod === HUMAN &&
              gs.noClientUpdateTime[num] < CLIENTSTOPMOVE_RETRYS) ||
            this.player!.controlMethod === BOT
          ) {
            if (this.jetsCount < map.startJet && !this.control.jetpack) {
              if (this.onGround || gs.mainTickCounter % 2 === 0) {
                this.jetsCount++
              }
            }
          }

          if (this.ceaseFireCounter > -1) {
            this.ceaseFireCounter = this.ceaseFireCounter - 1
            this.alpha = pascalRound(Math.abs(100 + 70 * Math.sin(gs.sinusCounter)))
          } else {
            this.alpha = 255
          }

          if (this.bonusStyle === BONUS_PREDATOR) this.alpha = PREDATORALPHA

          // {$IFNDEF SERVER} BERSERKER/FLAMEGOD 스파크(1160-1190), 부상 출혈
          //   (Health < HURT_HEALTH, 1193-1205) — TODO(M2/render)

          // BONUS time
          if (this.bonusTime > -1) {
            this.bonusTime = this.bonusTime - 1
            if (this.bonusTime < 1) {
              switch (this.bonusStyle) {
                case BONUS_PREDATOR:
                  this.alpha = 255
                  break
              }
              this.bonusStyle = BONUS_NONE
            }
          } else {
            this.bonusStyle = BONUS_NONE
          }

          // MULITKILL TIMER
          if (this.multiKillTime > -1) {
            this.multiKillTime = this.multiKillTime - 1
          } else {
            this.multiKills = 0
          }

          // gain health from bow
          if (
            gs.mainTickCounter % 3 === 0 &&
            (this.weapon.num === guns[BOW].num || this.weapon.num === guns[BOW2].num) &&
            this.health < gs.startHealth /* STARTHEALTH */
          ) {
            this.health = this.health + 1
          }

          // {$IFNDEF SERVER} 시가 연기(HasCigar = 10, 1242-1269), 겨울 입김
          //   (Map.Weather = 3, 1272-1283) — TODO(M2/render)

          // parachuter
          this.para = 0
          if (this.holdedThing > 0 && this.holdedThing < MAX_THINGS + 1) {
            if (gs.thing[this.holdedThing].style === OBJECT_PARACHUTE) this.para = 1
          }

          if (this.para === 1) {
            gs.spriteParts.forces[num].y = PARA_SPEED
            // {$IFDEF SERVER} if CeaseFireCounter < 1 — 채택 (클라는 survival 확장 게이트)
            if (this.ceaseFireCounter < 1) {
              if (this.onGround || this.control.jetpack) {
                if (this.holdedThing > 0 && this.holdedThing < MAX_THINGS + 1) {
                  // 낙하산 분리 (Sprites.pas:1302-1308)
                  gs.thing[this.holdedThing].holdingSprite = 0
                  gs.thing[this.holdedThing].skeleton.constraintCount--
                  gs.thing[this.holdedThing].timeOut = 3 * 60
                  this.holdedThing = 0
                }
              }
            }
          }

          // {$IFDEF SERVER} Trace('TSprite.Update 3e') — 로깅 생략

          this.skeleton.doVerletTimeStepFor(22, 29)
          this.skeleton.doVerletTimeStepFor(24, 30)

          // {$IFNDEF SERVER} Ping Impr — OldSpritePos 시프트(1320-1323). 서버 변형은
          //   game.ts updateFrame 루프(ServerLoop.pas:282-290)에서 수행 → 미채택.
          break
        } // 1
      } // case
    }

    if (this.deadMeat) {
      if (this.isNotSpectator()) {
        // physically integrate skeleton particles
        this.skeleton.doVerletTimeStep()

        gs.spriteParts.pos[num] = cloneVec2(this.skeleton.pos[12])

        // Ping Impr (양 빌드 공통 — 죽은 스프라이트는 UpdateFrame 루프의 시프트 대상이 아님)
        for (let i = MAX_OLDPOS; i >= 1; i--) {
          gs.oldSpritePos[num][i] = cloneVec2(gs.oldSpritePos[num][i - 1])
        }

        gs.oldSpritePos[num][0] = cloneVec2(gs.spriteParts.pos[num])

        this.checkSkeletonOutOfBounds()

        // Respawn Countdown
        // {$IFDEF SERVER} — 권위 로컬 심의 리스폰 경로
        if (this.respawnCounter < 1) {
          this.respawn()
          // ServerSpriteSnapshotMajorSingle(Num, NETW) — 네트워크 스냅샷, TODO(M3)
        }

        this.respawnCounter = this.respawnCounter - 1

        // {$IFNDEF SERVER} if RespawnCounter < -360 then Respawn — 클라 폴백, 미채택

        // {$IFDEF SERVER} survival 라운드 종료 처리 — 채택
        if (gs.svSurvivalmode) {
          if (this.respawnCounter === 1) {
            if (!gs.survivalEndRound) {
              this.respawnCounter += 2
            } else {
              if (this.respawnCounter < 3) {
                for (let i = 1; i <= MAX_SPRITES; i++) {
                  if (gs.sprite[i].active && !gs.sprite[i].deadMeat) {
                    const p = vector2(0, 0) // P := Default(TVector2)
                    gs.sprite[i].healthHit(4000, i, 1, -1, p)
                    gs.sprite[i].player!.deaths--
                  }
                }
              }

              // HTF가 아닌 모드에서 팀 깃발이 미귀환이면 재스폰 (Sprites.pas:1380-1387)
              if (gs.svGamemode !== GAMESTYLE_HTF) {
                if (gs.teamFlag[1] > 0 && gs.teamFlag[2] > 0) {
                  if (!gs.thing[gs.teamFlag[1]].inBase) {
                    gs.thing[gs.teamFlag[1]].respawn()
                  }
                  if (!gs.thing[gs.teamFlag[2]].inBase) {
                    gs.thing[gs.teamFlag[2]].respawn()
                  }
                }
              }
            }
          }
        }

        // parachuter
        this.para = 0
        if (this.holdedThing > 0 && this.holdedThing < MAX_THINGS + 1) {
          if (gs.thing[this.holdedThing].style === OBJECT_PARACHUTE) this.para = 1
        }

        if (this.para === 1) {
          this.skeleton.forces[12].y = 25 * PARA_SPEED
          if (this.onGround) {
            if (this.holdedThing > 0 && this.holdedThing < MAX_THINGS + 1) {
              // 낙하산 분리 (Sprites.pas:1401-1407)
              gs.thing[this.holdedThing].holdingSprite = 0
              gs.thing[this.holdedThing].skeleton.constraintCount--
              gs.thing[this.holdedThing].timeOut = 3 * 60
              this.holdedThing = 0
            }
          }
        }

        this.deadTime++
      } // DeadMeat
    }

    // Safety
    if (gs.spriteParts.velocity[num].x > MAX_VELOCITY) {
      gs.spriteParts.velocity[num].x = MAX_VELOCITY
    }
    if (gs.spriteParts.velocity[num].x < -MAX_VELOCITY) {
      gs.spriteParts.velocity[num].x = -MAX_VELOCITY
    }
    if (gs.spriteParts.velocity[num].y > MAX_VELOCITY) {
      gs.spriteParts.velocity[num].y = MAX_VELOCITY
    }
    if (gs.spriteParts.velocity[num].y < -MAX_VELOCITY) {
      gs.spriteParts.velocity[num].y = -MAX_VELOCITY
    }
  }

  /* ──────────────── combat 1부 (Sprites.pas:1424-2393, 3200-3376) — M2 Task 6 ─────────────── */

  // Sprites.pas:1424-1490 TSprite.Kill — 스프라이트 슬롯 해제 (사망 연출이 아니라 퇴장/재생성용
  // 비활성화). 운반 중 씽 해제 + 고정포 해제 + "팀 전멸 시 TeamScore 리셋" 포함.
  kill(): void {
    const gs = this.gs
    const num = this.num

    this.active = false
    this.muted = false // {$IFNDEF SERVER}
    // {$IFNDEF SERVER} StopSound(Reload/Jets/Gattling×2 채널) — 클라 오디오, 생략 (규약 8c)

    if (num > 0) {
      gs.sprite[num].skeleton.destroy() // 원본 그대로 배열 경유 (Sprite[Num].Skeleton.Destroy)
      gs.spriteParts.active[num] = false
    }

    if (this.holdedThing > 0 && this.holdedThing < MAX_THINGS + 1) {
      if (gs.thing[this.holdedThing].style < OBJECT_USSOCOM) {
        gs.thing[this.holdedThing].holdingSprite = 0
        this.holdedThing = 0
      }
    }

    if (this.stat > 0) {
      gs.thing[this.stat].staticType = false
      this.stat = 0
    }

    if (this.isNotSolo()) {
      let left = false
      for (let i = 1; i <= MAX_PLAYERS; i++) {
        if (gs.sprite[i].active && this.isInSameTeam(gs.sprite[i]) && i !== num) {
          left = true
        }
      }

      if (!left) {
        // 원본 그대로: 점수 배열에 팀 상수 TEAM_NONE(=0)을 대입한다 — 의미상 "0점 리셋"이지만
        // 타입이 어긋난 수상한 코드. "고치지 않고" 보존.
        gs.teamScore[this.player!.team] = TEAM_NONE
      }
    }

    // {$IFDEF SERVER} — 무응답 카운터 리셋만 채택, 채팅 플러드/핑 경고 카운터는 TODO(M3) NET
    if (num > 0) {
      gs.noClientUpdateTime[num] = 0
      // MessagesASecNum[num]/FloodWarnings[num]/PingWarnings[num] := 0 — TODO(M3) NET
    }

    // sort the players frag list
    gs.sortPlayers?.() // ServerHelper.pas SortPlayers — 표시 순서 정렬 훅 (T10 배선)
  }

  // Sprites.pas:1491-1545 SelectDefaultWeapons(MySprite) — 전신 {$IFNDEF SERVER}: 림보 메뉴에서
  // 허용 무기가 1종뿐일 때 자동 선택하는 클라 UI 편의 루틴 (LimboMenu/ClientSpriteSnapshot).
  // 규약 8(c): web 레이어 소관 — core 미포팅. (Task 지시서의 "selectDefaultWeapons" 항목 실측
  // 결과 — TSprite 메서드가 아니라 클라 전용 자유 프로시저다.)

  // Sprites.pas:1552-2318 TSprite.Die(How, Who, Where, What, Impact) — 사망 처리: 스코어링,
  // 랙돌 본 절단, 사망 시 무기 드롭, 운반물 해제(리스크 지도 #6), 서바이벌 라운드 판정.
  // 게임모드 스코어링 case(1644-1766) 중 DM(1648-1654)/CTF(1700-1711)는 완전 번역,
  // PM/TM/RM/INF/HTF는 구조 + TODO(M2후속) 스텁 (계획서 Task 6).
  die(how: number, who: number, where: number, what: number, impact: TVector2): void {
    const gs = this.gs
    const num = this.num
    const player = this.player!

    if (who < 1 || who > MAX_SPRITES) return
    if (what > MAX_BULLETS) return

    if (!this.deadMeat) {
      // bullet time
      if (gs.svBullettime) {
        if (gs.goalTicks === DEFAULT_GOALTICKS) {
          let k = 0
          for (let i = 1; i <= MAX_SPRITES; i++) {
            if (
              gs.sprite[i].active &&
              i !== who &&
              !gs.sprite[i].player!.demoPlayer &&
              gs.sprite[i].isNotSpectator()
            ) {
              if (
                distanceVec2(gs.spriteParts.pos[i], gs.spriteParts.pos[who]) >
                BULLETTIME_MINDISTANCE
              ) {
                k = 1
              }
            }
          }

          if (k < 1) {
            // Game.pas:263-277 ToggleBulletTime(True) 인라인 — BulletTimeTimer := 30;
            // GOALTICKS := DEFAULT_GOALTICKS div 3. Number27Timing(프레임 페이싱)은 web 루프 소관.
            gs.bulletTimeTimer = 30
            gs.goalTicks = trunc(DEFAULT_GOALTICKS / 3)
          }
        }
      }

      // {$IFDEF SERVER} 리스폰 카운터 — 권위 로컬 심 채택 (1594-1599)
      if (
        gs.svGamemode === GAMESTYLE_INF ||
        gs.svGamemode === GAMESTYLE_TEAMMATCH ||
        gs.svGamemode === GAMESTYLE_CTF ||
        gs.svGamemode === GAMESTYLE_HTF
      ) {
        this.respawnCounter = gs.waveRespawnCounter + gs.svRespawntimeMinwave
      } else {
        this.respawnCounter = gs.svRespawntime
      }
      player.deaths++

      // {$IFDEF SERVER} ARROW/FLAMEARROW DontCheat 킥 (1603-1611) — KickPlayer 계열, TODO(M3) NET
      // {$IFDEF SERVER} sv_punishtk Anti-Team-Killer (1613-1641) — TODO(M2후속): TKWarnings
      //   필드 미포팅 (cvar 기본 False라 기본 게임플레이 무영향)

      if (who !== num) {
        if (gs.svGamemode === GAMESTYLE_DEATHMATCH) {
          gs.sprite[who].player!.kills++

          // mulitkill count — {$IFDEF SERVER} 채택 (규약 8a)
          gs.sprite[who].multiKillTime = MULTIKILLINTERVAL
          gs.sprite[who].multiKills++
        }
        if (gs.svGamemode === GAMESTYLE_POINTMATCH) {
          // TODO(M2후속) PM 스코어링 (1656-1685): 킬 1점, PM 깃발 소지 시 ×2,
          //   멀티킬 2/3/4/5/6+ → ×2/×4/×8/×16/×32, 멀티킬 카운트 갱신
        }
        if (gs.svGamemode === GAMESTYLE_TEAMMATCH) {
          // TODO(M2후속) TM 스코어링 (1687-1699): 적팀 킬이면 Kills+1 + TeamScore[킬러팀]+1 + 멀티킬
        }
        if (gs.svGamemode === GAMESTYLE_CTF) {
          if (this.isNotInSameTeam(gs.sprite[who])) {
            gs.sprite[who].player!.kills++

            // mulitkill count — {$IFDEF SERVER} 채택 (규약 8a)
            gs.sprite[who].multiKillTime = MULTIKILLINTERVAL
            gs.sprite[who].multiKills++
          }
        }
        if (gs.svGamemode === GAMESTYLE_INF) {
          // TODO(M2후속) INF 스코어링 (1713-1725): CTF와 동형 (적팀 킬 Kills+1 + 멀티킬)
        }
        if (gs.svGamemode === GAMESTYLE_HTF) {
          // TODO(M2후속) HTF 스코어링 (1727-1739): CTF와 동형
        }
        if (gs.svGamemode === GAMESTYLE_RAMBO) {
          // TODO(M2후속) RM 스코어링 (1741-1765): 활 관련 킬만 인정, 람보 존재 시 비람보 킬 감점
        }
      }

      if (this.idleRandom === 7) {
        if (this.weapon.num === guns[NOWEAPON].num) {
          how = BRUTAL_DEATH
        }
      }

      this.bodyAnimation.currFrame = 0

      // 킬 로그 문자열 S 구성(1771-1806) + 클라 WepStats(1808-1817) + 서버 콘솔 echokills
      // (1820-1827) + {$IFDEF SCRIPT} OnPlayerKill + 킬 로그 파일/봇 채팅(1836-1860) —
      // 전부 콘솔/HUD 통계/네트 계열이라 생략 (규약 8b/8c).

      // {$IFDEF SERVER} 사망 시 무기 드롭 (1862-1882) — 게임플레이, 채택 (규약 8a)
      {
        const k = this.weapon.hitMultiply

        this.lastWeaponHM = this.weapon.hitMultiply
        this.lastWeaponStyle = this.weapon.bulletStyle
        this.lastWeaponSpeed = this.weapon.speed
        this.lastWeaponFire = this.weapon.fireInterval
        this.lastWeaponReload = this.weapon.reloadTime

        const i = this.dropWeapon()
        this.weapon.hitMultiply = k

        // 원본 그대로: DropWeapon 끝에서 Weapon이 이미 NOWEAPON으로 교체된 뒤라 이 조건은
        // i>0인 경우 항상 거짓(Weapon.Num=NOWEAPON) — 사실상 죽은 코드. "고치지 않고" 보존.
        if (
          i > 0 &&
          this.weapon.num !== guns[FLAMER].num &&
          this.weapon.num !== guns[NOWEAPON].num
        ) {
          gs.thing[i].skeleton.forces[2] = cloneVec2(impact)
        }

        this.freeControls()
      }

      // {$IFNDEF SERVER} ScreenCounter/CapScreen (1885-1895) — 클라 스크린샷 연출, 생략
    }

    // {$IFDEF SERVER} ShotDistance/ShotRicochet/ShotLife (1898-1910) — 서버 무기 통계 전역
    //   (콘솔 출력 전용), 생략 (규약 8c)
    // {$IFNDEF SERVER} RUGER 헤드샷 HEADCHOP_DEATH 승격 (1915-1918) — 클라 전용 연출 분기.
    //   규약 13: 서버 값(승격 없음) 채택.

    switch (how) {
      case NORMAL_DEATH: {
        // {$IFNDEF SERVER} 사망음 — 규약 11 훅
        if (!this.deadMeat) {
          gs.playSound(SFX_DEATH + random(3), gs.spriteParts.pos[num])
        }
        break
      }

      case HEADCHOP_DEATH: {
        // {$IFNDEF SERVER}if DeadMeat then{$ENDIF} 게이트 — 서버는 무조건 절단 (규약 13)
        if (where === 12) this.skeleton.constraints[20].active = false
        if (where === 3) this.skeleton.constraints[2].active = false
        if (where === 4) this.skeleton.constraints[4].active = false

        // {$IFNDEF SERVER} BARRETT/RUGER 헤드샷 시체폭발 스파크·SFX_BOOMHEADSHOT(1934-1968)
        //   — Randomize/RandomRange 기반 클라 연출, 생략 (web M4)

        // siup leb! — {$IFNDEF SERVER}, 규약 11 훅
        if (!this.deadMeat) {
          gs.playSound(SFX_HEADCHOP, this.skeleton.pos[12])
        }
        break
      }

      case BRUTAL_DEATH: {
        // {$IFNDEF SERVER}if DeadMeat then{$ENDIF} 게이트 — 서버는 무조건 절단 (규약 13)
        this.skeleton.constraints[2].active = false
        this.skeleton.constraints[4].active = false
        this.skeleton.constraints[20].active = false
        this.skeleton.constraints[21].active = false
        this.skeleton.constraints[23].active = false

        // play bryzg sound! — {$IFNDEF SERVER}, 규약 11 훅
        gs.playSound(SFX_BRYZG, this.skeleton.pos[12])
        break
      }
    }

    // {$IFNDEF SERVER}if DeadMeat then{$ENDIF} 게이트 — 서버는 무조건 (규약 13)
    if (gs.sprite[who].bonusStyle === BONUS_BERSERKER) {
      this.skeleton.constraints[2].active = false
      this.skeleton.constraints[4].active = false
      this.skeleton.constraints[20].active = false
      this.skeleton.constraints[21].active = false
      this.skeleton.constraints[23].active = false

      gs.playSound(SFX_KILLBERSERK, this.skeleton.pos[12]) // {$IFNDEF SERVER} — 규약 11 훅
    }

    // {$IFNDEF SERVER} FLAMER 킬 화상음 — 규약 11 훅
    if (!this.deadMeat && what > 0) {
      if (gs.bullet[what].ownerWeapon === guns[FLAMER].num) {
        gs.playSound(SFX_BURN, this.skeleton.pos[12])
      }
    }

    if (!this.deadMeat && this.hasCigar === 10) {
      // {$IFNDEF SERVER} 시가 튕김 스파크 — 규약 12로 채택
      createSpark(gs, this.skeleton.pos[12], cloneVec2(impact), 34, num, 245)
      this.hasCigar = 0
    }

    // Survival Mode (2013-2159) — 라운드 종료 판정 (게임플레이, 채택; 콘솔 출력만 생략)
    if (gs.svSurvivalmode) {
      if (!this.deadMeat) {
        if (gs.svGamemode === GAMESTYLE_DEATHMATCH || gs.svGamemode === GAMESTYLE_RAMBO) {
          gs.aliveNum = 0

          for (let i = 1; i <= MAX_SPRITES; i++) {
            if (gs.sprite[i].active && !gs.sprite[i].deadMeat && gs.sprite[i].isNotSpectator()) {
              gs.aliveNum++
            }
          }

          gs.aliveNum--

          if (gs.aliveNum < 2) {
            for (let i = 1; i <= MAX_SPRITES; i++) {
              if (gs.sprite[i].active) {
                gs.sprite[i].respawnCounter = SURVIVAL_RESPAWNTIME
              }
            }

            gs.survivalEndRound = true

            // {$IFNDEF SERVER} 생존자 SFX_ROAR (2049-2059) — 클라 연출, 생략
          }

          // MainConsole 'Players left: N' (2062-2072) — 콘솔 출력 생략
        }

        if (
          gs.svGamemode === GAMESTYLE_CTF ||
          gs.svGamemode === GAMESTYLE_INF ||
          gs.svGamemode === GAMESTYLE_HTF ||
          gs.svGamemode === GAMESTYLE_TEAMMATCH
        ) {
          gs.teamAliveNum[1] = 0
          gs.teamAliveNum[2] = 0
          gs.teamAliveNum[3] = 0
          gs.teamAliveNum[4] = 0

          for (let i = 1; i <= MAX_SPRITES; i++) {
            if (
              gs.sprite[i].active &&
              !gs.sprite[i].deadMeat &&
              gs.sprite[i].player!.team === TEAM_ALPHA
            ) {
              gs.teamAliveNum[TEAM_ALPHA]++
            }
            if (
              gs.sprite[i].active &&
              !gs.sprite[i].deadMeat &&
              gs.sprite[i].player!.team === TEAM_BRAVO
            ) {
              gs.teamAliveNum[TEAM_BRAVO]++
            }
            if (
              gs.sprite[i].active &&
              !gs.sprite[i].deadMeat &&
              gs.sprite[i].player!.team === TEAM_CHARLIE
            ) {
              gs.teamAliveNum[TEAM_CHARLIE]++
            }
            if (
              gs.sprite[i].active &&
              !gs.sprite[i].deadMeat &&
              gs.sprite[i].player!.team === TEAM_DELTA
            ) {
              gs.teamAliveNum[TEAM_DELTA]++
            }
          }

          gs.teamAliveNum[player.team]--

          gs.aliveNum =
            gs.teamAliveNum[1] + gs.teamAliveNum[2] + gs.teamAliveNum[3] + gs.teamAliveNum[4]

          if (
            (gs.teamAliveNum[1] > 0 &&
              gs.teamAliveNum[2] < 1 &&
              gs.teamAliveNum[3] < 1 &&
              gs.teamAliveNum[4] < 1) ||
            (gs.teamAliveNum[2] > 0 &&
              gs.teamAliveNum[1] < 1 &&
              gs.teamAliveNum[3] < 1 &&
              gs.teamAliveNum[4] < 1) ||
            (gs.teamAliveNum[3] > 0 &&
              gs.teamAliveNum[1] < 1 &&
              gs.teamAliveNum[2] < 1 &&
              gs.teamAliveNum[4] < 1) ||
            (gs.teamAliveNum[4] > 0 &&
              gs.teamAliveNum[1] < 1 &&
              gs.teamAliveNum[2] < 1 &&
              gs.teamAliveNum[3] < 1) ||
            (gs.teamAliveNum[1] < 1 &&
              gs.teamAliveNum[2] < 1 &&
              gs.teamAliveNum[3] < 1 &&
              gs.teamAliveNum[4] < 1)
          ) {
            for (let i = 1; i <= MAX_SPRITES; i++) {
              if (gs.sprite[i].active) {
                gs.sprite[i].respawnCounter = SURVIVAL_RESPAWNTIME
              }
            }

            if (!gs.survivalEndRound) {
              if (gs.svGamemode === GAMESTYLE_CTF) {
                if (gs.teamAliveNum[1] > 0) gs.teamScore[1] += 1
                if (gs.teamAliveNum[2] > 0) gs.teamScore[2] += 1
              }
            }
            if (!gs.survivalEndRound) {
              if (gs.svGamemode === GAMESTYLE_INF) {
                if (gs.teamAliveNum[1] > 0) gs.teamScore[1] += gs.svInfRedaward

                // penalty
                if (gs.playersTeamNum[1] > gs.playersTeamNum[2]) {
                  gs.teamScore[1] -= 5 * (gs.playersTeamNum[1] - gs.playersTeamNum[2])
                }
                if (gs.teamScore[1] < 0) gs.teamScore[1] = 0
              }
            }

            gs.survivalEndRound = true

            for (let i = 1; i <= MAX_SPRITES; i++) {
              if (gs.sprite[i].active && !gs.sprite[i].deadMeat) {
                gs.sprite[i].idleRandom = 5
                gs.sprite[i].idleTime = 1
              }
            }
          }

          // {$IFNDEF SERVER} 'Players left on your team' 콘솔 (2149-2157) — 생략
        }
      }
    }

    // {$IFDEF SERVER} Fire on from bullet (2161-2184) — 게임플레이, 채택 (규약 8a)
    if (what > 0) {
      if (gs.bullet[what].style === BULLET_STYLE_FRAGNADE) {
        if (random(12) === 0) this.onFire = 4
      }

      if (gs.bullet[what].style === BULLET_STYLE_M79) {
        if (random(8) === 0) this.onFire = 2
      }

      if (gs.bullet[what].style === BULLET_STYLE_FLAME) {
        this.onFire = 1
      }

      if (gs.bullet[what].style === BULLET_STYLE_FLAMEARROW) {
        if (random(4) === 0) this.onFire = 1
      }

      if (gs.bullet[what].style === BULLET_STYLE_CLUSTER) {
        if (random(3) === 0) this.onFire = 3
      }
    }

    // ⚠ 리스크 지도 #6 — 깃발 drop-on-death의 실체가 이 루프다 (Die 2186-2225):
    // 운반 중(HoldingSprite=Num)인 깃발류(Style < OBJECT_USSOCOM)를 사망 시 해제한다.
    // (Things.pas에는 이 해제가 없다 — Die/Kill이 유일한 경로. Kill:1452-1456도 참조.)
    for (let i = 1; i <= MAX_THINGS; i++) {
      if (gs.thing[i].holdingSprite === num) {
        if (gs.thing[i].style < OBJECT_USSOCOM) {
          gs.thing[i].holdingSprite = 0
          this.holdedThing = 0
          // {$IFNDEF SERVER} '%s dropped the %s Flag' 콘솔/BigMessage/SFX_INFILT_POINT
          //   (2193-2211) — 클라 메시지, 생략. {$IFDEF SCRIPT} OnFlagDrop — 생략.
        }
      }

      if (gs.thing[i].owner === num) {
        gs.thing[i].owner = 255
      }

      // 원본 그대로: Stat(고정포 씽 인덱스)과 Num(스프라이트 번호)의 비교가 씽 루프 안에 있고
      // 첫 매치에서 Stat이 0이 되므로 사실상 i=1에서만 평가되는 수상한 코드 — 보존 (2221-2225).
      if (this.stat === num) {
        this.stat = 0
        gs.thing[i].staticType = true
      }
    }

    // send net info, so the death is smooth
    // {$IFDEF SERVER} if not DeadMeat then ServerSpriteDeath(Num, Who, What, Where) — TODO(M3) NET
    // {$IFNDEF SERVER} StopSound(ReloadSoundChannel) — 클라 오디오, 생략

    // BREAD — 원본 그대로: 서버 분기는 `if not sv_advancemode.Value`(클라의 `if sv_advancemode`와
    // 반전). 수상하지만 서버가 진실 (규약 8a) — 보존. 클라 쪽 추가 게이트
    // ((Num<>Who) and (IsNotInSameTeam or IsSolo))는 {$IFNDEF SERVER}라 미채택.
    if (!gs.svAdvancemode) {
      if (!this.deadMeat && num !== who) {
        let i = gs.svAdvancemodeAmount

        if (gs.sprite[who].player!.kills % i === 0) {
          let j = 0
          // 원본은 루프 변수로 i를 재사용(파스칼 for가 i를 덮어씀) — 여기선 w로 분리 (동작 동일:
          // 아래에서 i를 다시 sv_advancemode_amount로 재설정한다).
          for (let w = 1; w <= PRIMARY_WEAPONS; w++) {
            if (gs.weaponSel[who][w] === 0 && gs.weaponActive[w] === 1) {
              j = 1
            }
          }

          if (j === 1) {
            do {
              j = random(PRIMARY_WEAPONS) + 1
            } while (!(gs.weaponSel[who][j] === 0 && gs.weaponActive[j] === 1))
            gs.weaponSel[who][j] = 1
          }
        }

        i = gs.svAdvancemodeAmount

        if (player.deaths % i === 0) {
          let j = 0
          for (let w = 1; w <= PRIMARY_WEAPONS; w++) {
            if (gs.weaponSel[num][w] === 1) {
              j = 1
            }
          }

          if (j === 1) {
            do {
              j = random(PRIMARY_WEAPONS) + 1
            } while (gs.weaponSel[num][j] !== 1)
            gs.weaponSel[num][j] = 0
          }
        }

        // {$IFNDEF SERVER} LimboMenu 버튼 갱신 (2306-2311) — 클라 UI, 생략
      }
    }

    this.deadMeat = true
    // {$IFDEF SERVER} — 채택 (리스크 지도 #6의 나머지 반쪽: 서버는 사망 확정 시 HoldedThing도
    // 무조건 해제한다, 2300-2302)
    this.holdedThing = 0
    this.alpha = 255
    this.vest = 0
    this.bonusStyle = BONUS_NONE
    this.bonusTime = 0
    if (this.deadTime > 0 && this.onFire === 0) {
      this.deadTime = trunc(this.deadTime / 2) // DeadTime div 2
    } else {
      this.deadTime = 0
    }

    gs.spriteParts.velocity[num].x = 0
    gs.spriteParts.velocity[num].y = 0
    gs.sprite[who].brain.pissedOff = 0

    // sort the players frag list
    gs.sortPlayers?.() // ServerHelper.pas SortPlayers — T10 배선 훅
  }

  // Sprites.pas:2320-2393 TSprite.DropWeapon — 손 무기를 필드 Thing으로 변환. 본문 전체가
  // {$IFDEF SERVER} (규약 8a 채택). 반환값 = 생성된 Thing 인덱스 (미생성 시 -1).
  dropWeapon(): number {
    const gs = this.gs
    const num = this.num
    let result = -1

    gs.weaponsCleaned = false

    // drop weapon
    if (this.weapon.num === guns[COLT].num) {
      result = createThing(gs, this.skeleton.pos[16], num, OBJECT_USSOCOM, 255)
    } else if (this.weapon.num === guns[EAGLE].num) {
      result = createThing(gs, this.skeleton.pos[16], num, OBJECT_DESERT_EAGLE, 255)
    } else if (this.weapon.num === guns[MP5].num) {
      result = createThing(gs, this.skeleton.pos[16], num, OBJECT_HK_MP5, 255)
    } else if (this.weapon.num === guns[AK74].num) {
      result = createThing(gs, this.skeleton.pos[16], num, OBJECT_AK74, 255)
    } else if (this.weapon.num === guns[STEYRAUG].num) {
      result = createThing(gs, this.skeleton.pos[16], num, OBJECT_STEYR_AUG, 255)
    } else if (this.weapon.num === guns[SPAS12].num) {
      result = createThing(gs, this.skeleton.pos[16], num, OBJECT_SPAS12, 255)
    } else if (this.weapon.num === guns[RUGER77].num) {
      result = createThing(gs, this.skeleton.pos[16], num, OBJECT_RUGER77, 255)
    } else if (this.weapon.num === guns[M79].num) {
      result = createThing(gs, this.skeleton.pos[16], num, OBJECT_M79, 255)
    } else if (this.weapon.num === guns[BARRETT].num) {
      result = createThing(gs, this.skeleton.pos[16], num, OBJECT_BARRET_M82A1, 255)
    } else if (this.weapon.num === guns[M249].num) {
      result = createThing(gs, this.skeleton.pos[16], num, OBJECT_MINIMI, 255)
    } else if (this.weapon.num === guns[MINIGUN].num) {
      result = createThing(gs, this.skeleton.pos[16], num, OBJECT_MINIGUN, 255)
    } else if (this.weapon.num === guns[KNIFE].num) {
      result = createThing(gs, this.skeleton.pos[16], num, OBJECT_COMBAT_KNIFE, 255)
    } else if (this.weapon.num === guns[CHAINSAW].num) {
      result = createThing(gs, this.skeleton.pos[16], num, OBJECT_CHAINSAW, 255)
    } else if (this.weapon.num === guns[LAW].num) {
      result = createThing(gs, this.skeleton.pos[16], num, OBJECT_LAW, 255)
    }

    if (gs.svGamemode === GAMESTYLE_RAMBO) {
      if (this.weapon.num === guns[BOW].num || this.weapon.num === guns[BOW2].num) {
        result = createThing(gs, this.skeleton.pos[16], num, OBJECT_RAMBO_BOW, 255)
        // {$IFNDEF SERVER} GameThingTarget := Result — 클라 봇 유도 전역, 생략
      }
    }

    if (result > 0) {
      gs.thing[result].ammoCount = this.weapon.ammoCount
    }

    // {$IFDEF SCRIPT} OnWeaponChange/ForceWeaponCalled (2378-2390) — 스크립팅 없음, 생략
    this.applyWeaponByNum(guns[NOWEAPON].num, 1)

    return result
  }

  // Sprites.pas:3200-3248 TSprite.ApplyWeaponByNum(WNum, Gun, Ammo, RestorePrimaryState) —
  // guns[] 항목을 슬롯(1=Weapon, 2=SecondaryWeapon)에 record 깊은복사 (규약 3).
  applyWeaponByNum(wNum: number, gun: number, ammo = -1, restorePrimaryState = false): void {
    // {$IFDEF SERVER} Player.KnifeWarnings 감소 — 나이프 스팸 경고(서버 안티치트), TODO(M3) NET

    if (restorePrimaryState && gun === 2) {
      this.secondaryWeapon = { ...this.weapon } // SecondaryWeapon := Weapon (record 복사)
    } else {
      const weaponIndex = weaponNumToIndex(wNum) // 리스크 지도 #7: 인덱스≠Num, 반드시 변환 경유
      if (gun === 1) {
        this.weapon = { ...guns[weaponIndex] }
      } else {
        this.secondaryWeapon = { ...guns[weaponIndex] }
      }
    }

    if (ammo > -1) {
      // 원본 그대로: Gun=2여도 Weapon.AmmoCount에 적용된다 (3224-3225) — 보존.
      this.weapon.ammoCount = ammo
    }

    // {$IFNDEF SERVER} Weapon.StartUpTimeCount := Weapon.StartUpTime — 클라 전용 리셋.
    //   규약 13: 서버 값(리셋 없음 — Fire 경로가 관리) 채택.
    // {$IFDEF SERVER} if Weapon.Num = Guns[KNIFE].Num then KnifeCan[Num] := True — TODO(M3) SERVER

    if (wNum !== guns[NOWEAPON].num) {
      this.lastWeaponHM = this.weapon.hitMultiply
      this.lastWeaponStyle = this.weapon.bulletStyle
      this.lastWeaponSpeed = this.weapon.speed
      this.lastWeaponFire = this.weapon.fireInterval
      this.lastWeaponReload = this.weapon.reloadTime
    }
  }

  // Sprites.pas:3250-3376 TSprite.HealthHit(Amount, Who, Where, What, Impact) — 대미지 적용과
  // 사망 문턱 판정 (NORMAL/HEADCHOP/BRUTAL 3단).
  healthHit(amount: number, who: number, where: number, what: number, impact: TVector2): void {
    const gs = this.gs
    const num = this.num

    // Friendly Fire
    if (
      !gs.svFriendlyfire &&
      this.isNotSolo() &&
      this.isInSameTeam(gs.sprite[who]) &&
      num !== who
    ) {
      return
    }

    // {$IFDEF SERVER} 관전자(인간)의 공격 무시 — 채택 (규약 8a)
    if (gs.sprite[who].isSpectator() && gs.sprite[who].player!.controlMethod === HUMAN) {
      return
    }

    if (this.bonusStyle === BONUS_FLAMEGOD) return

    // no health hit if someone is rambo
    if (gs.svGamemode === GAMESTYLE_RAMBO) {
      if (num !== who) {
        for (let j = 1; j <= MAX_PLAYERS; j++) {
          if (gs.sprite[j].active && who !== j && num !== j) {
            if (
              gs.sprite[j].weapon.num === guns[BOW].num ||
              gs.sprite[j].weapon.num === guns[BOW2].num
            ) {
              return
            }
          }
        }
      }
    }

    let hm = amount

    if (this.vest > 0) {
      hm = pascalRound(0.33 * amount)
      this.vest = this.vest - hm
      hm = pascalRound(0.25 * amount)
    }

    // {$IFNDEF SERVER} and (Who <> Num) 추가 게이트 — 규약 13: 서버 값(자해도 4배) 채택.
    if (gs.sprite[who].bonusStyle === BONUS_BERSERKER) {
      hm = 4 * amount
    }

    // {$IFDEF SCRIPT} OnPlayerDamage — 스크립팅 없음, 생략

    this.health = this.health - hm

    // {$IFNDEF SERVER} WepStats Hits 집계 (3311-3335) — 클라 HUD 통계, 생략 (규약 8c)

    // helmet fall off
    if (
      this.health < HELMETFALLHEALTH &&
      this.wearHelmet === 1 &&
      where === 12 &&
      this.weapon.num !== guns[BOW].num &&
      this.weapon.num !== guns[BOW2].num &&
      this.player!.headCap > 0
    ) {
      this.wearHelmet = 0
      // {$IFNDEF SERVER} 헬멧 스파크 — 규약 12로 채택 + 사운드는 규약 11 훅
      createSpark(gs, this.skeleton.pos[12], gs.spriteParts.velocity[num], 6, num, 198)
      gs.playSound(SFX_HEADCHOP, this.skeleton.pos[where])
    }

    // safety precautions
    if (this.health < BRUTALDEATHHEALTH - 1) this.health = BRUTALDEATHHEALTH
    if (this.health > gs.startHealth) this.health = gs.startHealth // STARTHEALTH (Game.pas:85 변수)

    // death!
    const t = cloneVec2(impact) // T := Impact (record 복사)
    if (this.health < 1 && this.health > HEADCHOPDEATHHEALTH) {
      this.die(NORMAL_DEATH, who, where, what, t)
    } else if (this.health < HEADCHOPDEATHHEALTH + 1 && this.health > BRUTALDEATHHEALTH) {
      this.die(HEADCHOP_DEATH, who, where, what, t)
    } else if (this.health < BRUTALDEATHHEALTH + 1) {
      this.die(BRUTAL_DEATH, who, where, what, t)
    }

    this.brain.targetNum = who

    // {$IFDEF SERVER} bots_chat 저체력 채팅 (HURT_HEALTH, 3369-3376) — TODO(M3) NET
  }

  // Sprites.pas:3785-3821 TSprite.Parachute(a) — 발밑 레이캐스트 후 여유가 충분하면 낙하산
  // Thing을 생성해 붙인다. (Respawn:3714가 호출)
  parachute(a: TVector2): void {
    const gs = this.gs
    const num = this.num
    a = cloneVec2(a) // Pascal 값 전달 — 아래에서 a.y를 수정하므로 호출자 벡터 별칭 차단 (규약 3)

    if (this.holdedThing > 0) return
    if (this.isSpectator()) return

    for (let i = 1; i <= MAX_THINGS; i++) {
      if (gs.thing[i].holdingSprite === num) {
        gs.thing[i].holdingSprite = 0
        gs.thing[i].kill()
      }
    }

    const b = cloneVec2(a)
    b.y = b.y + PARA_DISTANCE
    const ray = gs.map.rayCast(
      a,
      b,
      PARA_DISTANCE + 50,
      true, // Player
      false, // Flag
      false, // Bullet
      false, // CheckCollider
      this.player!.team,
    )
    if (!ray.hit) {
      if (ray.distance > PARA_DISTANCE - 10) {
        a.y = a.y + 70
        const n = createThing(gs, a, num, OBJECT_PARACHUTE, 255)
        gs.thing[n].holdingSprite = num
        // {$IFNDEF SERVER} Thing[n].Color := Player.ShirtColor — 렌더 색상, 생략
        this.holdedThing = n
      }
    }
  }

  // Sprites.pas:3823-3972 TSprite.ChangeTeam(Team) — {$IFDEF SERVER}의 AdminChange/JoinType
  // 네트 인자는 생략 (계획서 Task 6: "네트 인자 생략"). AdminChange=False(일반 변경) 경로 채택.
  changeTeam(team: number): void {
    const gs = this.gs

    if (team > TEAM_SPECTATOR) return

    if (this.active) {
      const player = this.player!

      // {$IFDEF SERVER} 팀 인원 집계 (3841-3846) — 채택
      const teamsCount: number[] = new Array(TEAM_SPECTATOR + 1).fill(0)
      for (let i = 1; i <= MAX_SPRITES; i++) {
        if (gs.sprite[i].active && gs.sprite[i].isNotSpectator()) {
          teamsCount[gs.sprite[i].player!.team]++
        }
      }

      // Check for uneven teams — {$IFDEF SERVER}, AdminChange=False (3848-3862)
      if (gs.svBalanceteams) {
        if (this.isSpectator() && team === findLowestTeam(gs, teamsCount)) {
          // 원본의 빈 then 절 — 관전자가 최소 인원 팀으로 가는 것은 항상 허용
        } else if (teamsCount[team] >= teamsCount[player.team] && team < TEAM_SPECTATOR) {
          // WriteConsole '<team> team is full' — 콘솔 출력 생략
          return
        }
      }

      if (teamsCount[TEAM_SPECTATOR] >= gs.svMaxspectators && team === TEAM_SPECTATOR) {
        // WriteConsole 'Spectators are full' — 콘솔 출력 생략
        return
      }

      if (
        gs.svGamemode !== GAMESTYLE_TEAMMATCH &&
        (team === TEAM_CHARLIE || team === TEAM_DELTA)
      ) {
        return
      }

      // {$IFDEF SCRIPT} OnBeforeJoinTeam — 스크립팅 없음, 생략

      this.dropWeapon()

      player.team = team
      // Player.ApplyShirtColorFromTeam — 셔츠 색(렌더 전용, TPlayer 색상 필드 미포팅) — web 소관
      const a = vector2(0, 0)
      const b = vector2(0, 0)
      this.num = createSprite(gs, a, b, 1, this.num, player, this.isPlayerObjectOwner)
      const num = this.num

      if (gs.sprite[num].holdedThing > 0) {
        if (gs.thing[gs.sprite[num].holdedThing].style < OBJECT_USSOCOM) {
          gs.thing[gs.sprite[num].holdedThing].respawn()
          gs.sprite[num].holdedThing = 0
        }
      }

      for (let i = 1; i <= MAX_THINGS; i++) {
        if (gs.thing[i].holdingSprite === num) {
          gs.thing[i].respawn()
        }
      }
      gs.sprite[num].respawn()

      // {$IFDEF SERVER} BulletTime[Num]/GrenadeTime[Num] := MainTickCounter-10;
      //   KnifeCan[Num] := True — TODO(M3) SERVER 전역.
      //   ServerSendNewPlayerInfo(Num, JoinType) — TODO(M3) NET.
      gs.sortPlayers?.()

      // MainConsole '<name> has joined <team>' (3919-3945) — 콘솔 출력 생략

      // prevent players from joining alive midround in survival mode
      if (gs.svSurvivalmode && player.team !== TEAM_SPECTATOR) {
        // TODO: Fix this shouldn't change wepstats (원본 주석 보존)
        gs.sprite[num].healthHit(4000, num, 1, 1, a)
        gs.sprite[num].player!.deaths--
      }

      // {$IFNDEF SERVER} MySprite 카메라/LimboMenu (3956-3966) — 클라 UI, 생략
      // {$IFDEF SERVER} MapChangeCounter 진행 중이면 ServerMapChange(Num) — TODO(M3) NET
      // {$IFDEF SCRIPT} OnJoinTeam — 생략
    }
  }

  /* ────────── fire / throwFlag / throwGrenade (Sprites.pas:3974-4812) — M2 Task 7 ────────── */

  // Sprites.pas:3974-4597 TSprite.Fire — 발사: 조준 벡터 + bink/moveacc/스프레드 부정확도 →
  // createBullet, 무기별 특수 처리(이글 2연발/샷건 산탄/미니건·샷건 반동/화염·톱 근접 스폰/
  // LAW 자세 게이트/Mercy 자살탄), 탄피·총구연기 스파크(규약 12), 발사음(규약 11 훅), 자기 bink.
  // 클라 전용 코스메틱 중 카메라 셰이크(4548-4570, 규약 11)와 리코일 커서 변조(4573-4596,
  // CalculateRecoil — T4/T8 판정과 동일하게 웹 M4 소관)는 생략 + 주석.
  fire(): void {
    const gs = this.gs
    const num = this.num
    const anims = gs.anims

    let bn = 0
    let inaccuracy = 0

    // Create a normalized directional vector
    let aimDirection: TVector2
    if (
      this.weapon.bulletStyle === BULLET_STYLE_KNIFE ||
      this.bodyAnimation.id === anims.mercy.id ||
      this.bodyAnimation.id === anims.mercy2.id
    ) {
      aimDirection = this.getHandsAimDirection()
    } else {
      aimDirection = this.getCursorAimDirection()
    }

    let b = cloneVec2(aimDirection)

    let a = vector2(this.skeleton.pos[15].x - b.x * 4, this.skeleton.pos[15].y - b.y * 4 - 2)

    // TODO(skoskav): Make bink and self-bink sprite-specific so bots can also use it (원본 주석)
    // {$IFNDEF SERVER} if Num = MySprite — 모든 인간 스프라이트가 로컬 (state.ts
    // hitSprayCounter 필드 주석 참조).
    if (this.player!.controlMethod === HUMAN) {
      // Bink & self-bink
      if (gs.hitSprayCounter > 0) {
        inaccuracy = inaccuracy + gs.hitSprayCounter * 0.01
      }
    }

    // Moveacc
    inaccuracy = inaccuracy + this.getMoveacc()

    // Bullet spread
    if (
      this.weapon.num !== guns[EAGLE].num &&
      this.weapon.num !== guns[SPAS12].num &&
      this.weapon.bulletStyle !== BULLET_STYLE_SHOTGUN
    ) {
      if (this.weapon.bulletSpread > 0) {
        if (
          this.legsAnimation.id === anims.proneMove.id ||
          (this.legsAnimation.id === anims.prone.id && this.legsAnimation.currFrame > 23)
        ) {
          inaccuracy = inaccuracy + this.weapon.bulletSpread / 1.625
        } else if (
          this.legsAnimation.id === anims.crouchRun.id ||
          this.legsAnimation.id === anims.crouchRunBack.id ||
          (this.legsAnimation.id === anims.crouch.id && this.legsAnimation.currFrame > 13)
        ) {
          inaccuracy = inaccuracy + this.weapon.bulletSpread / 1.3
        } else {
          inaccuracy = inaccuracy + this.weapon.bulletSpread
        }
      }
    }

    // FIXME(skoskav): Inaccuracy decreased due to altered way of acquiring the directional
    // vector. This should be solved more elegantly. (원본 주석 보존)
    inaccuracy = inaccuracy * 0.25

    if (inaccuracy > MAX_INACCURACY) inaccuracy = MAX_INACCURACY

    // Calculate the maximum bullet deviation between 0 and MAX_INACCURACY.
    // The scaling is modeled after Sin(x) where x = 0 -> Pi/2 to gracefully reach
    // the maximum. Then multiply by a float between -1.0 and 1.0.
    const maxDeviation = MAX_INACCURACY * Math.sin((inaccuracy / MAX_INACCURACY) * (Math.PI / 2))
    const d = vector2(
      (randomFloat() * 2 - 1) * maxDeviation,
      (randomFloat() * 2 - 1) * maxDeviation,
    )

    // Add inaccuracies to directional vector and re-normalize
    b = vec2Normalize(vec2Add(b, d))

    // Multiply with the weapon speed
    b = vec2Scale(b, this.weapon.speed)

    // Add some of the player's velocity to the bullet
    const m = vec2Scale(gs.spriteParts.velocity[num], this.weapon.inheritedVelocity)
    b = vec2Add(b, m)

    // Check for immediate collision (could just be head in polygon), if so then
    // offset the bullet origin downward slightly
    if (gs.map.collisionTest(a).hit) {
      a.y = a.y + 2.5
    }

    if (
      (this.weapon.num !== guns[EAGLE].num &&
        this.weapon.num !== guns[SPAS12].num &&
        this.weapon.num !== guns[FLAMER].num &&
        this.weapon.num !== guns[NOWEAPON].num &&
        this.weapon.num !== guns[KNIFE].num &&
        this.weapon.num !== guns[CHAINSAW].num &&
        this.weapon.num !== guns[LAW].num) ||
      this.bodyAnimation.id === anims.mercy.id ||
      this.bodyAnimation.id === anims.mercy2.id
    ) {
      bn = createBullet(gs, a, b, this.weapon.num, num, 255, this.weapon.hitMultiply, true, false)
    }

    if (this.weapon.num === guns[EAGLE].num) {
      // Eagles
      this.bulletCount = (this.bulletCount + 1) & 0xffff // Inc(BulletCount) — Word 랩
      // RandSeed := BulletCount — 전역 RNG 시드(네트 동기용 결정적 산탄 패턴). 이 포트는
      // 시드 없는 random을 채택한다 (스펙 4.2: 분포 일치면 충분 — 리스크 지도 #8).

      d.x = b.x + (randomFloat() * 2 - 1) * this.weapon.bulletSpread
      d.y = b.y + (randomFloat() * 2 - 1) * this.weapon.bulletSpread

      bn = createBullet(
        gs, a, d, this.weapon.num, num, 255, this.weapon.hitMultiply, true, false,
        this.bulletCount,
      )

      d.x = b.x + (randomFloat() * 2 - 1) * this.weapon.bulletSpread
      d.y = b.y + (randomFloat() * 2 - 1) * this.weapon.bulletSpread

      const bNorm = vec2Normalize(b)
      a.x = a.x - Math.sign(b.x) * Math.abs(bNorm.y) * 3.0
      a.y = a.y + Math.sign(b.y) * Math.abs(bNorm.x) * 3.0

      createBullet(gs, a, d, this.weapon.num, num, 255, this.weapon.hitMultiply, false, false)
    }

    if (this.weapon.bulletStyle === BULLET_STYLE_SHOTGUN) {
      // Shotgun
      this.bulletCount = (this.bulletCount + 1) & 0xffff
      // RandSeed := BulletCount — 상동 (시드 생략)

      d.x = b.x + (randomFloat() * 2 - 1) * this.weapon.bulletSpread
      d.y = b.y + (randomFloat() * 2 - 1) * this.weapon.bulletSpread

      bn = createBullet(
        gs, a, d, this.weapon.num, num, 255, this.weapon.hitMultiply, true, false,
        this.bulletCount,
      )

      for (let i = 0; i <= 4; i++) {
        // Remaining 5 pellets
        d.x = b.x + (randomFloat() * 2 - 1) * this.weapon.bulletSpread
        d.y = b.y + (randomFloat() * 2 - 1) * this.weapon.bulletSpread
        createBullet(gs, a, d, this.weapon.num, num, 255, this.weapon.hitMultiply, false, false)
      }

      d.x = b.x * 0.0412
      d.y = b.y * 0.041
      gs.spriteParts.velocity[num] = vec2Subtract(gs.spriteParts.velocity[num], d)
    }

    if (this.weapon.num === guns[MINIGUN].num) {
      // Minigun
      if (this.control.jetpack && this.jetsCount > 0) {
        d.x = b.x * 0.0012
        d.y = b.y * 0.0009
      } else {
        d.x = b.x * 0.0082
        d.y = b.y * 0.0078
      }

      if (this.holdedThing > 0) {
        d.x = d.x * 0.5
        d.y = d.y * 0.7
      }
      d.x = d.x * 0.6

      gs.spriteParts.velocity[num] = vec2Subtract(gs.spriteParts.velocity[num], d)
    }

    if (this.weapon.num === guns[FLAMER].num) {
      // Flamer
      a.x = a.x + b.x * 2
      a.y = a.y + b.y * 2
      bn = createBullet(gs, a, b, this.weapon.num, num, 255, this.weapon.hitMultiply, true, false)
      // {$IFNDEF SERVER} PlaySound(SFX_FLAMER, ..., GattlingSoundChannel) — 규약 11 훅
      gs.playSound(SFX_FLAMER, gs.spriteParts.pos[num])
    }

    if (this.weapon.num === guns[CHAINSAW].num) {
      // Chainsaw
      a.x = a.x + b.x * 2
      a.y = a.y + b.y * 2
      bn = createBullet(gs, a, b, this.weapon.num, num, 255, this.weapon.hitMultiply, true, false)
    }

    if (this.weapon.num === guns[LAW].num) {
      // LAW — 웅크림/엎드림+접지 자세에서만 발사, 아니면 전체 중단 (4211-4225)
      if (
        (this.onGround || this.onGroundPermanent || this.onGroundForLaw) &&
        ((this.legsAnimation.id === anims.crouch.id && this.legsAnimation.currFrame > 13) ||
          this.legsAnimation.id === anims.crouchRun.id ||
          this.legsAnimation.id === anims.crouchRunBack.id ||
          (this.legsAnimation.id === anims.prone.id && this.legsAnimation.currFrame > 23))
      ) {
        bn = createBullet(gs, a, b, this.weapon.num, num, 255, this.weapon.hitMultiply, true, false)
      } else {
        return // Exit
      }
    }

    // Mercy animation — 자살탄: 스폰 즉시 Hit 처리 후 자기 몸에 명중 판정 (4203-4223)
    if (this.bodyAnimation.id === anims.mercy.id || this.bodyAnimation.id === anims.mercy2.id) {
      if (bn > 0 && bn < MAX_BULLETS + 1) {
        if (gs.bullet[bn].active) {
          a = cloneVec2(gs.bulletParts.velocity[bn])
          gs.bulletParts.velocity[bn] = vec2Scale(
            vec2Normalize(gs.bulletParts.velocity[bn]),
            70,
          )
          gs.bullet[bn].hit(2)
          gs.bullet[bn].hit(9)
          // couple more - not sure why (원본 주석 보존)
          gs.bullet[bn].hit(2)
          gs.bullet[bn].hit(9)
          gs.bullet[bn].hit(2)
          gs.bullet[bn].hit(9)
          gs.bullet[bn].hitBody = gs.bullet[bn].owner
          gs.bulletParts.velocity[bn] = a
        }
      }
    }

    // Shouldn't we dec on server too? (원본 주석 보존)
    // {$IFNDEF SERVER} — 원본 서버는 클라의 ClientSendBullet 수신 시 차감
    // (NetworkServerBullet.pas:46). 이 로컬 심에선 Fire가 유일한 발사 경로라 채택.
    if (this.weapon.ammoCount > 0) {
      this.weapon.ammoCount--
    }

    if (this.weapon.num === guns[SPAS12].num) {
      this.canAutoReloadSpas = false
    }

    this.weapon.fireIntervalPrev = this.weapon.fireInterval
    this.weapon.fireIntervalCount = this.weapon.fireInterval

    this.fired = this.weapon.fireStyle

    // {$IFNDEF SERVER} Spent bullet shell vectors — 탄피 스파크는 규약 12 채택
    const c = vector2(
      gs.spriteParts.velocity[num].x + this.direction * aimDirection.y * (randomFloat() * 0.5 + 0.8),
      gs.spriteParts.velocity[num].y - this.direction * aimDirection.x * (randomFloat() * 0.5 + 0.8),
    )
    a.x = this.skeleton.pos[15].x + 2 - this.direction * 0.015 * b.x
    a.y = this.skeleton.pos[15].y - 2 - this.direction * 0.015 * b.y

    // Col := Map.CollisionTest(a, b) — b는 var 인자: 명중 시 perp 벡터로 덮인다 (미스면 유지)
    const colTest = gs.map.collisionTest(a)
    const col = colTest.hit
    if (col) b = cloneVec2(colTest.perpVec)

    // if r_maxsparks.Value < (MAX_SPARKS - 10) then if Random(2) = 0 then Col := True —
    // r_maxsparks는 상수 MAX_SPARKS 고정(sparks.ts 헤더)이라 조건 상시 거짓 → 생략.

    // play fire sound (+ 리코일 애니메이션, 탄피 스파크) — 무기별 (4256-4520)
    if (this.weapon.num === guns[AK74].num) {
      if (this.bonusStyle !== BONUS_PREDATOR) gs.playSound(SFX_AK74_FIRE, gs.spriteParts.pos[num])
      if (
        this.bodyAnimation.id !== anims.throw.id &&
        this.position === POS_STAND &&
        this.bodyAnimation.id !== anims.getUp.id &&
        this.bodyAnimation.id !== anims.melee.id
      ) {
        this.bodyApplyAnimation(anims.smallRecoil, 1)
      }
      if (this.position === POS_CROUCH) {
        if (this.bodyAnimation.id === anims.handsUpAim.id) {
          this.bodyApplyAnimation(anims.handsUpRecoil, 1)
        } else {
          this.bodyApplyAnimation(anims.aimRecoil, 1)
        }
      }
      if (!col) createSpark(gs, a, c, 68, num, 255) // shell
    }
    if (this.weapon.num === guns[M249].num) {
      if (this.bonusStyle !== BONUS_PREDATOR) gs.playSound(SFX_M249_FIRE, gs.spriteParts.pos[num])
      if (
        this.bodyAnimation.id !== anims.throw.id &&
        this.position === POS_STAND &&
        this.bodyAnimation.id !== anims.getUp.id &&
        this.bodyAnimation.id !== anims.melee.id
      ) {
        this.bodyApplyAnimation(anims.smallRecoil, 1)
      }
      if (this.position === POS_CROUCH) {
        if (this.bodyAnimation.id === anims.handsUpAim.id) {
          this.bodyApplyAnimation(anims.handsUpRecoil, 1)
        } else {
          this.bodyApplyAnimation(anims.aimRecoil, 1)
        }
      }
      if (!col) createSpark(gs, a, c, 72, num, 255) // shell
    }
    if (this.weapon.num === guns[RUGER77].num) {
      if (this.bonusStyle !== BONUS_PREDATOR) gs.playSound(SFX_RUGER77_FIRE, gs.spriteParts.pos[num])
      if (
        this.bodyAnimation.id !== anims.throw.id &&
        this.position === POS_STAND &&
        this.bodyAnimation.id !== anims.getUp.id &&
        this.bodyAnimation.id !== anims.melee.id
      ) {
        this.bodyApplyAnimation(anims.recoil, 1)
      }
      if (this.position === POS_CROUCH) {
        if (this.bodyAnimation.id === anims.handsUpAim.id) {
          this.bodyApplyAnimation(anims.handsUpRecoil, 1)
        } else {
          this.bodyApplyAnimation(anims.aimRecoil, 1)
        }
      }
      if (!col) createSpark(gs, a, c, 70, num, 255) // shell
    }
    if (this.weapon.num === guns[MP5].num) {
      if (this.bonusStyle !== BONUS_PREDATOR) gs.playSound(SFX_MP5_FIRE, gs.spriteParts.pos[num])
      a.x = this.skeleton.pos[15].x + 2 - 0.2 * b.x
      a.y = this.skeleton.pos[15].y - 2 - 0.2 * b.y
      if (
        this.bodyAnimation.id !== anims.throw.id &&
        this.position === POS_STAND &&
        this.bodyAnimation.id !== anims.getUp.id &&
        this.bodyAnimation.id !== anims.melee.id
      ) {
        this.bodyApplyAnimation(anims.smallRecoil, 1)
      }
      if (this.position === POS_CROUCH) {
        if (this.bodyAnimation.id === anims.handsUpAim.id) {
          this.bodyApplyAnimation(anims.handsUpRecoil, 1)
        } else {
          this.bodyApplyAnimation(anims.aimRecoil, 1)
        }
      }
      if (!col) createSpark(gs, a, c, 67, num, 255) // shell
    }
    if (this.weapon.num === guns[SPAS12].num) {
      if (this.bonusStyle !== BONUS_PREDATOR) gs.playSound(SFX_SPAS12_FIRE, gs.spriteParts.pos[num])
      if (
        this.bodyAnimation.id !== anims.throw.id &&
        this.position !== POS_PRONE &&
        this.bodyAnimation.id !== anims.getUp.id &&
        this.bodyAnimation.id !== anims.melee.id
      ) {
        this.bodyApplyAnimation(anims.shotgun, 1)
      }

      // make sure firing interrupts reloading when prone
      if (this.position === POS_PRONE && this.bodyAnimation.id === anims.reload.id) {
        this.bodyAnimation.currFrame = this.bodyAnimation.numFrames
      }
    }
    if (this.weapon.num === guns[M79].num) {
      if (this.bonusStyle !== BONUS_PREDATOR) gs.playSound(SFX_M79_FIRE, gs.spriteParts.pos[num])
      if (
        this.bodyAnimation.id !== anims.throw.id &&
        this.position !== POS_PRONE &&
        this.bodyAnimation.id !== anims.getUp.id &&
        this.bodyAnimation.id !== anims.melee.id
      ) {
        this.bodyApplyAnimation(anims.smallRecoil, 1)
      }
    }
    if (this.weapon.num === guns[EAGLE].num) {
      if (this.bonusStyle !== BONUS_PREDATOR) {
        gs.playSound(SFX_DESERTEAGLE_FIRE, gs.spriteParts.pos[num])
      }
      a.x = this.skeleton.pos[15].x + 3 - 0.17 * b.x
      a.y = this.skeleton.pos[15].y - 2 - 0.15 * b.y
      if (
        this.bodyAnimation.id !== anims.throw.id &&
        this.position === POS_STAND &&
        this.bodyAnimation.id !== anims.getUp.id &&
        this.bodyAnimation.id !== anims.melee.id
      ) {
        this.bodyApplyAnimation(anims.smallRecoil, 1)
      }
      if (this.position === POS_CROUCH) {
        if (this.bodyAnimation.id === anims.handsUpAim.id) {
          this.bodyApplyAnimation(anims.handsUpRecoil, 1)
        } else {
          this.bodyApplyAnimation(anims.aimRecoil, 1)
        }
      }
      if (!col) createSpark(gs, a, c, 66, num, 255) // shell
      if (!col) {
        a.x = this.skeleton.pos[15].x - 3 - 0.25 * b.x
        a.y = this.skeleton.pos[15].y - 3 - 0.3 * b.y
        c.x =
          gs.spriteParts.velocity[num].x +
          this.direction * aimDirection.y * (randomFloat() * 0.5 + 0.8)
        c.y =
          gs.spriteParts.velocity[num].y -
          this.direction * aimDirection.x * (randomFloat() * 0.5 + 0.8)
        createSpark(gs, a, c, 66, num, 255) // shell
      }
    }
    if (this.weapon.num === guns[STEYRAUG].num) {
      if (this.bonusStyle !== BONUS_PREDATOR) gs.playSound(SFX_STEYRAUG_FIRE, gs.spriteParts.pos[num])
      if (!col) createSpark(gs, a, c, 69, num, 255) // shell
      if (
        this.bodyAnimation.id !== anims.throw.id &&
        this.position === POS_STAND &&
        this.bodyAnimation.id !== anims.getUp.id &&
        this.bodyAnimation.id !== anims.melee.id
      ) {
        this.bodyApplyAnimation(anims.smallRecoil, 1)
      }
      if (this.position === POS_CROUCH) {
        if (this.bodyAnimation.id === anims.handsUpAim.id) {
          this.bodyApplyAnimation(anims.handsUpRecoil, 1)
        } else {
          this.bodyApplyAnimation(anims.aimRecoil, 1)
        }
      }
    }
    if (this.weapon.num === guns[BARRETT].num) {
      if (this.bonusStyle !== BONUS_PREDATOR) {
        gs.playSound(SFX_BARRETM82_FIRE, gs.spriteParts.pos[num])
      }
      if (
        this.bodyAnimation.id !== anims.throw.id &&
        this.bodyAnimation.id !== anims.getUp.id &&
        this.bodyAnimation.id !== anims.melee.id
      ) {
        this.bodyApplyAnimation(anims.barret, 1)
      }
      if (!col) createSpark(gs, a, c, 71, num, 255) // shell
    }
    if (this.weapon.num === guns[MINIGUN].num) {
      if (this.bonusStyle !== BONUS_PREDATOR) gs.playSound(SFX_MINIGUN_FIRE, gs.spriteParts.pos[num])
      if (
        this.bodyAnimation.id !== anims.throw.id &&
        this.position === POS_STAND &&
        this.bodyAnimation.id !== anims.getUp.id &&
        this.bodyAnimation.id !== anims.melee.id
      ) {
        this.bodyApplyAnimation(anims.smallRecoil, 2)
      }
      if (!col) createSpark(gs, a, c, 73, num, 255) // shell
    }
    if (this.weapon.num === guns[COLT].num) {
      if (this.bonusStyle !== BONUS_PREDATOR) gs.playSound(SFX_COLT1911_FIRE, gs.spriteParts.pos[num])
      a.x = this.skeleton.pos[15].x + 2 - 0.2 * b.x
      a.y = this.skeleton.pos[15].y - 2 - 0.2 * b.y
      if (!col) createSpark(gs, a, c, 65, num, 255) // shell
      if (
        this.bodyAnimation.id !== anims.throw.id &&
        this.position === POS_STAND &&
        this.bodyAnimation.id !== anims.getUp.id &&
        this.bodyAnimation.id !== anims.melee.id
      ) {
        this.bodyApplyAnimation(anims.smallRecoil, 1)
      }
      if (this.position === POS_CROUCH) {
        if (this.bodyAnimation.id === anims.handsUpAim.id) {
          this.bodyApplyAnimation(anims.handsUpRecoil, 1)
        } else {
          this.bodyApplyAnimation(anims.aimRecoil, 1)
        }
      }
    }
    if (this.weapon.num === guns[BOW].num || this.weapon.num === guns[BOW2].num) {
      if (this.bonusStyle !== BONUS_PREDATOR) gs.playSound(SFX_BOW_FIRE, gs.spriteParts.pos[num])
      if (
        this.bodyAnimation.id !== anims.throw.id &&
        this.position === POS_STAND &&
        this.bodyAnimation.id !== anims.getUp.id &&
        this.bodyAnimation.id !== anims.melee.id
      ) {
        this.bodyApplyAnimation(anims.smallRecoil, 1)
      }
      if (this.position === POS_CROUCH) {
        if (this.bodyAnimation.id === anims.handsUpAim.id) {
          this.bodyApplyAnimation(anims.handsUpRecoil, 1)
        } else {
          this.bodyApplyAnimation(anims.aimRecoil, 1)
        }
      }
    }
    // {$IFNDEF SERVER} (4522-4534)
    if (this.weapon.num === guns[LAW].num) {
      if (this.bonusStyle !== BONUS_PREDATOR) gs.playSound(SFX_LAW, gs.spriteParts.pos[num])
    }

    // smoke from muzzle — 규약 12 채택
    let muzzleSmokeVector = vec2Scale(b, 0.5)
    a = vec2Add(a, muzzleSmokeVector)
    muzzleSmokeVector = vec2Scale(muzzleSmokeVector, 0.2)
    createSpark(gs, a, muzzleSmokeVector, 35, num, 10)

    if (this.burstCount < 255) this.burstCount++

    // TODO(skoskav): Make bink and self-bink sprite-specific so bots can also use it (원본 주석)
    // {$IFNDEF SERVER} if Num = MySprite — 자기 bink 누적 (fire 상단 게이트와 동일 논리)
    if (this.player!.controlMethod === HUMAN) {
      // Increase self-bink for next shot
      if (this.weapon.bink < 0) {
        if (
          this.legsAnimation.id === anims.crouch.id ||
          this.legsAnimation.id === anims.crouchRun.id ||
          this.legsAnimation.id === anims.crouchRunBack.id ||
          this.legsAnimation.id === anims.prone.id ||
          this.legsAnimation.id === anims.proneMove.id
        ) {
          gs.hitSprayCounter = calculateBink(gs.hitSprayCounter, pascalRound(-this.weapon.bink / 2))
        } else {
          gs.hitSprayCounter = calculateBink(gs.hitSprayCounter, -this.weapon.bink)
        }
      }
    }

    // {$IFNDEF SERVER} Screen shake (4548-4570) — CameraX/Y 변조는 규약 11대로 core에서 생략
    //   (web에서 M4 폴리시).
    // {$IFNDEF SERVER} Recoil! (4573-4596) — CalculateRecoil 커서 변조는 클라 시각 피드백,
    //   T4/T8 판정과 동일하게 생략 + 주석 (웹 M4).
  }

  // Sprites.pas:4599-4696 TSprite.ThrowFlag — 운반 중 깃발 투척: 커서 방향 × FLAGTHROW_POWER,
  // 다음 프레임 충돌 예측(레이캐스트 3점 + 충돌 4점)이 전부 비어 있어야 던진다.
  throwFlag(): void {
    const gs = this.gs
    const num = this.num
    const anims = gs.anims

    if (this.bodyAnimation.id !== anims.roll.id && this.bodyAnimation.id !== anims.rollBack.id) {
      if (this.control.flagThrow) {
        if (this.holdedThing > 0) {
          for (let i = 1; i <= MAX_THINGS; i++) {
            if (gs.thing[i].holdingSprite === num) {
              if (gs.thing[i].style < 4) {
                // Create start velocity vector
                let cursorDirection = this.getCursorAimDirection()
                cursorDirection = vec2Scale(cursorDirection, FLAGTHROW_POWER)

                // FIXME: Offset it away from the player so it isn't instantly re-grabbed,
                // it makes it look like lag though (원본 주석 보존)
                const bOffset = vec2Scale(cursorDirection, 5)

                // Add velocity
                const b = vec2Add(cursorDirection, gs.spriteParts.velocity[num])

                // Don't throw if the flag would collide in the upcoming frame
                const newPosDiff = vec2Add(bOffset, b)
                let lookPoint1 = vec2Add(gs.thing[i].skeleton.pos[1], newPosDiff)

                const futurePoint1 = vec2Add(lookPoint1, vector2(-10, -8))
                const futurePoint2 = vec2Add(lookPoint1, vector2(10, -8))
                const futurePoint3 = vec2Add(lookPoint1, vector2(-10, 8))
                const futurePoint4 = vec2Add(lookPoint1, vector2(10, 8))

                lookPoint1 = vec2Add(gs.thing[i].skeleton.pos[2], newPosDiff)
                const lookPoint2 = vec2Add(gs.thing[i].skeleton.pos[3], newPosDiff)
                const lookPoint3 = vec2Add(gs.thing[i].skeleton.pos[4], newPosDiff)

                if (
                  !gs.map.rayCast(this.skeleton.pos[15], lookPoint1, 200, false, true, false).hit &&
                  !gs.map.rayCast(this.skeleton.pos[15], lookPoint2, 200, false, true, false).hit &&
                  !gs.map.rayCast(this.skeleton.pos[15], lookPoint3, 200, false, true, false).hit &&
                  !gs.map.collisionTest(futurePoint1, true).hit &&
                  !gs.map.collisionTest(futurePoint2, true).hit &&
                  !gs.map.collisionTest(futurePoint3, true).hit &&
                  !gs.map.collisionTest(futurePoint4, true).hit
                ) {
                  for (let j = 1; j <= 4; j++) {
                    // Apply offset from flagger
                    gs.thing[i].skeleton.pos[j] = vec2Add(gs.thing[i].skeleton.pos[j], bOffset)

                    // Apply velocities
                    gs.thing[i].skeleton.pos[j] = vec2Add(gs.thing[i].skeleton.pos[j], b)
                    gs.thing[i].skeleton.oldPos[j] = vec2Subtract(gs.thing[i].skeleton.pos[j], b)
                  }

                  // Add some spin for visual effect
                  let bPerp = vector2(-b.y, b.x)
                  bPerp = vec2Normalize(bPerp)
                  bPerp = vec2Scale(bPerp, this.direction)
                  gs.thing[i].skeleton.pos[1] = vec2Subtract(gs.thing[i].skeleton.pos[1], bPerp)
                  gs.thing[i].skeleton.pos[2] = vec2Add(gs.thing[i].skeleton.pos[2], bPerp)

                  // Release the flag
                  gs.thing[i].holdingSprite = 0
                  this.holdedThing = 0
                  this.flagGrabCooldown = Math.trunc(SECOND / 4) // SECOND div 4

                  // {$IFDEF SCRIPT} OnFlagDrop — 스크립팅 없음, 생략.

                  gs.thing[i].bgState.backgroundStatus = BACKGROUND_TRANSITION
                  gs.thing[i].bgState.backgroundPoly = BACKGROUND_POLY_UNKNOWN

                  gs.thing[i].staticType = false
                  // TODO(M3) NET: ServerThingMustSnapshot(i)
                }
              }
            }
          }
        }
      }
    }
  }

  // Sprites.pas:4698-4812 TSprite.ThrowGrenade — 수류탄 투척: Throw 애니메이션 진행에 따라
  // 홀드 시간(CurrFrame)이 곧 투척 강도. 아크 보정 + FRAGGRENADE 속도/관성.
  throwGrenade(): void {
    const gs = this.gs
    const num = this.num
    const anims = gs.anims

    // Start throw animation
    if (!this.control.throwNade) {
      this.grenadeCanThrow = true
    }

    if (
      this.grenadeCanThrow &&
      this.control.throwNade &&
      this.bodyAnimation.id !== anims.roll.id &&
      this.bodyAnimation.id !== anims.rollBack.id
    ) {
      this.bodyApplyAnimation(anims.throw, 1)
      // {$IFNDEF SERVER} SetSoundPaused(ReloadSoundChannel, True) — 클라 오디오, 생략 (규약 8c)
    }

    // {$IFNDEF SERVER} Pull pin — 핀 뽑기 스파크(규약 12) + 사운드(규약 11 훅) (4720-4743)
    if (
      this.bodyAnimation.id === anims.throw.id &&
      this.bodyAnimation.currFrame === 15 &&
      this.tertiaryWeapon.ammoCount > 0 &&
      this.ceaseFireCounter < 0
    ) {
      let b = this.getHandsAimDirection()
      b = vec2Scale(b, this.bodyAnimation.currFrame / guns[FRAGGRENADE].speed)
      if (this.bodyAnimation.currFrame < 24) {
        b = vec2Scale(b, 0.65)
      }
      b = vec2Add(b, gs.spriteParts.velocity[num])
      const a = vector2(
        this.skeleton.pos[15].x + b.x * 3,
        this.skeleton.pos[15].y - 2 + b.y * 3,
      )
      if (!gs.map.collisionTest(a).hit) {
        b = this.getHandsAimDirection()
        b.x = b.x * 0.5
        b.y = b.y + 0.4
        createSpark(gs, a, b, 30, num, 255) // Pin
        gs.playSound(SFX_GRENADE_PULLOUT, a)
      }
    }

    if (
      this.bodyAnimation.id === anims.throw.id &&
      (!this.control.throwNade || this.bodyAnimation.currFrame === 36)
    ) {
      // Grenade throw
      if (
        this.bodyAnimation.currFrame > 14 &&
        this.bodyAnimation.currFrame < 37 &&
        this.tertiaryWeapon.ammoCount > 0 &&
        this.ceaseFireCounter < 0
      ) {
        let b = this.getCursorAimDirection()

        // Add a few degrees of arc to the throw. The arc approaches zero as you aim up or down
        const grenadeArcSize = (Math.sign(b.x) / 8) * (1 - Math.abs(b.y))
        const grenadeArcX = Math.sin((b.y * Math.PI) / 2) * grenadeArcSize
        const grenadeArcY = Math.sin((b.x * Math.PI) / 2) * grenadeArcSize
        b.x = b.x + grenadeArcX
        b.y = b.y - grenadeArcY
        b = vec2Normalize(b)

        b = vec2Scale(b, this.bodyAnimation.currFrame / guns[FRAGGRENADE].speed)
        if (this.bodyAnimation.currFrame < 24) {
          b = vec2Scale(b, 0.65)
        }

        const playerVelocity = vec2Scale(
          gs.spriteParts.velocity[num],
          guns[FRAGGRENADE].inheritedVelocity,
        )

        b = vec2Add(b, playerVelocity)
        const a = vector2(
          this.skeleton.pos[15].x + b.x * 3,
          this.skeleton.pos[15].y - 2 + b.y * 3,
        )
        const e = vector2(gs.spriteParts.pos[num].x, gs.spriteParts.pos[num].y - 12)
        if (
          !gs.map.collisionTest(a).hit &&
          !gs.map.rayCast(e, a, 50, false, false, true, false, this.player!.team).hit
        ) {
          createBullet(
            gs, a, b, this.tertiaryWeapon.num, num, 255,
            guns[FRAGGRENADE].hitMultiply, true, false,
          )
          // if {$IFNDEF SERVER}((ControlMethod = HUMAN) and (Num = MySprite)) or{$ENDIF}
          //    (ControlMethod = BOT) — 모든 인간이 로컬이므로 HUMAN도 항상 참 (헤더 예외 논리)
          if (this.player!.controlMethod === HUMAN || this.player!.controlMethod === BOT) {
            this.tertiaryWeapon.ammoCount--
          }

          // {$IFNDEF SERVER} if Num = MySprite — bink (fire()와 동일 게이트 논리)
          if (this.player!.controlMethod === HUMAN && guns[FRAGGRENADE].bink < 0) {
            gs.hitSprayCounter = calculateBink(gs.hitSprayCounter, -guns[FRAGGRENADE].bink)
          }

          gs.playSound(SFX_GRENADE_THROW, a)
        }
      }

      if (this.control.throwNade) {
        this.grenadeCanThrow = false
      }

      if (this.weapon.ammoCount === 0) {
        if (this.weapon.reloadTimeCount > this.weapon.clipOutTime) {
          this.bodyApplyAnimation(anims.clipOut, 1)
        }
        if (this.weapon.reloadTimeCount < this.weapon.clipOutTime) {
          this.bodyApplyAnimation(anims.clipIn, 1)
        }
        if (this.weapon.reloadTimeCount < this.weapon.clipInTime && this.weapon.reloadTimeCount > 0) {
          this.bodyApplyAnimation(anims.slideBack, 1)
        }
        // {$IFNDEF SERVER} SetSoundPaused(ReloadSoundChannel, False) — 클라 오디오, 생략
      }
    }
  }

  /* ──────────────────── animation apply (Sprites.pas:2395-2434) ─────────────────── */

  // Sprites.pas:2395-2410 TSprite.LegsApplyAnimation
  legsApplyAnimation(anim: TAnimation, curr: number): void {
    const anims = this.gs.anims

    if (this.legsAnimation.id === anims.prone.id || this.legsAnimation.id === anims.proneMove.id) {
      return
    }

    if (anim.id !== this.legsAnimation.id) {
      this.legsAnimation = cloneAnimation(anim)
      this.legsAnimation.currFrame = curr
    }
  }

  // Sprites.pas:2412-2433 TSprite.BodyApplyAnimation
  bodyApplyAnimation(anim: TAnimation, curr: number): void {
    const gs = this.gs

    // {$IFNDEF SERVER}
    if (anim.id === gs.anims.stand.id) {
      if (gs.wasReloading) {
        this.bodyApplyAnimation(gs.anims.reload, 1)
        gs.wasReloading = false
        return
      }
    }

    if (anim.id !== this.bodyAnimation.id) {
      this.bodyAnimation = cloneAnimation(anim)
      this.bodyAnimation.currFrame = curr
    }
  }

  // Sprites.pas:2435-2461 TSprite.MoveSkeleton
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

  /* ──────────────────── map collision (Sprites.pas:2462-3020) ─────────────────── */

  // Sprites.pas:2462-2572 TSprite.CheckRadiusMapCollision
  checkRadiusMapCollision(x: number, y: number, hasCollided: boolean): boolean {
    const gs = this.gs
    const map = gs.map
    const num = this.num

    const sPos = vector2(x, y - 3)

    // make step
    let detAcc = trunc(vec2Length(gs.spriteParts.velocity[num]))
    if (detAcc === 0) detAcc = 1
    const step = vec2Scale(gs.spriteParts.velocity[num], 1 / detAcc)

    // make steps for accurate collision detection
    for (let z = 0; z <= detAcc - 1; z++) {
      sPos.x = sPos.x + step.x
      sPos.y = sPos.y + step.y

      // iterate through maps sector polygons
      const rx = pascalRound(sPos.x / map.sectorsDivision)
      const ry = pascalRound(sPos.y / map.sectorsDivision)
      if (rx > -map.sectorsNum && rx < map.sectorsNum && ry > -map.sectorsNum && ry < map.sectorsNum) {
        const sectorPolys = map.sectorPolys(rx, ry)
        for (let j = 1; j < sectorPolys.length; j++) {
          const w = sectorPolys[j]
          const polyType = map.polyType[w]

          let teamcol = teamCollides(map, w, this.player!.team, false)

          if (
            (this.holdedThing === 0 && polyType === POLY_TYPE_ONLY_FLAGGERS) ||
            (this.holdedThing !== 0 && polyType === POLY_TYPE_NOT_FLAGGERS)
          ) {
            teamcol = false
          }
          if (teamcol && polyType !== POLY_TYPE_DOESNT && polyType !== POLY_TYPE_ONLY_BULLETS) {
            for (let k = 1; k <= 3; k++) {
              const norm = vec2Scale(map.perp[w][k], -SPRITE_COL_RADIUS)
              const pos = vec2Add(sPos, norm)

              if (map.pointInPolyEdges(pos.x, pos.y, w)) {
                if (this.bgState.backgroundTest(map, w)) continue

                if (!hasCollided) {
                  this.handleSpecialPolyTypes(polyType, pos)
                }

                const cp = map.closestPerpendicular(w, sPos)
                let perp = cloneVec2(cp.perp)
                const b = cp.n

                let p1 = vector2(0, 0) // P1 := Default(TVector2)
                let p2 = vector2(0, 0)
                if (b === 1) {
                  p1 = vector2(map.polys[w].vertices[1].x, map.polys[w].vertices[1].y)
                  p2 = vector2(map.polys[w].vertices[2].x, map.polys[w].vertices[2].y)
                } else if (b === 2) {
                  p1 = vector2(map.polys[w].vertices[2].x, map.polys[w].vertices[2].y)
                  p2 = vector2(map.polys[w].vertices[3].x, map.polys[w].vertices[3].y)
                } else if (b === 3) {
                  p1 = vector2(map.polys[w].vertices[3].x, map.polys[w].vertices[3].y)
                  p2 = vector2(map.polys[w].vertices[1].x, map.polys[w].vertices[1].y)
                }

                const p3 = pos // P3 := Pos
                const d = pointLineDistance(p1, p2, p3)
                perp = vec2Scale(perp, d)

                gs.spriteParts.pos[num] = cloneVec2(gs.spriteParts.oldPos[num])
                // 원본 그대로: Velocity := Forces - Perp (Velocity가 아니라 Forces 기준 —
                // Sprites.pas:2559의 수상한 대입을 보존).
                gs.spriteParts.velocity[num] = vec2Subtract(gs.spriteParts.forces[num], perp)

                return true
              } // PointInPolyEdges
            }
          }
        } // for j
      }
    } // z (n)

    return false
  }

  // Sprites.pas:2573-2847 TSprite.CheckMapCollision
  checkMapCollision(x: number, y: number, area: number): boolean {
    const gs = this.gs
    const map = gs.map
    const num = this.num
    const anims = gs.anims

    const sPos = vector2(x, y)
    const pos = vector2(
      sPos.x + gs.spriteParts.velocity[num].x,
      sPos.y + gs.spriteParts.velocity[num].y,
    )

    // iterate through maps sector polygons
    const rx = pascalRound(pos.x / map.sectorsDivision)
    const ry = pascalRound(pos.y / map.sectorsDivision)
    if (rx > -map.sectorsNum && rx < map.sectorsNum && ry > -map.sectorsNum && ry < map.sectorsNum) {
      this.bgState.backgroundTestBigPolyCenter(map, pos)

      const sectorPolys = map.sectorPolys(rx, ry)
      for (let j = 1; j < sectorPolys.length; j++) {
        const w = sectorPolys[j]
        const polyType = map.polyType[w]

        const teamcol = teamCollides(map, w, this.player!.team, false)

        if (
          (polyType !== POLY_TYPE_DOESNT &&
            polyType !== POLY_TYPE_ONLY_BULLETS &&
            teamcol &&
            polyType !== POLY_TYPE_ONLY_FLAGGERS &&
            polyType !== POLY_TYPE_NOT_FLAGGERS) ||
          (this.holdedThing !== 0 && polyType === POLY_TYPE_ONLY_FLAGGERS) ||
          (this.holdedThing === 0 && polyType === POLY_TYPE_NOT_FLAGGERS)
        ) {
          if (pointInPoly(pos, map.polys[w])) {
            if (this.bgState.backgroundTest(map, w)) continue

            // TODO(M3) SERVER: Sprite[Num].Player.StandingPolyType := PolyType;

            this.handleSpecialPolyTypes(polyType, pos)

            // {$IFNDEF SERVER} PlaySound(SFX_FALL) — 착지음 (2.2 < |vel.y| < 3.4, not BOUNCY).
            // TODO(M2/render): 오디오 레이어에서.

            if (Math.abs(gs.spriteParts.velocity[num].y) > 3.5) {
              // {$IFNDEF SERVER} PlaySound(SFX_FALL_HARD) — TODO(M2/render)

              // Hit ground — realistic mode 낙하 대미지
              if (gs.svRealisticmode) {
                if (gs.spriteParts.velocity[num].y > 3.5 && polyType !== POLY_TYPE_BOUNCY) {
                  this.healthHit(gs.spriteParts.velocity[num].y * 5, num, 12, -1, sPos)
                  // {$IFNDEF SERVER} PlaySound(SFX_FALL) — TODO(M2/render)
                }
              }
            }

            // {$IFNDEF SERVER} Sprites.pas:2648-2718 — Run/Crouch/Prone 발소리 + 스파크
            // (CreateSpark, PlaySound(SFX_STEP*/SFX_CROUCH_MOVE*/SFX_PRONE_MOVE/물소리),
            //  r_maxsparks 게이트, Random() 호출 포함). 전부 시청각 효과 → TODO(M2/render).

            const cp = map.closestPerpendicular(w, pos)
            let perp = cloneVec2(cp.perp)
            let d = cp.d
            const step = cloneVec2(perp) // Step := Perp (정규화 전 값)

            perp = vec2Normalize(perp)
            perp = vec2Scale(perp, d)

            d = vec2Length(gs.spriteParts.velocity[num])
            if (vec2Length(perp) > d) {
              perp = vec2Normalize(perp)
              perp = vec2Scale(perp, d)
            }

            if (
              area === 0 ||
              (area === 1 &&
                (gs.spriteParts.velocity[num].y < 0 ||
                  gs.spriteParts.velocity[num].x > SLIDELIMIT ||
                  gs.spriteParts.velocity[num].x < -SLIDELIMIT))
            ) {
              gs.spriteParts.oldPos[num] = cloneVec2(gs.spriteParts.pos[num])
              gs.spriteParts.pos[num] = vec2Subtract(gs.spriteParts.pos[num], perp)
              if (polyType === POLY_TYPE_BOUNCY) {
                // bouncy polygon
                perp = vec2Normalize(perp)
                perp = vec2Scale(perp, map.bounciness[w] * d)
                // {$IFNDEF SERVER} if Vec2Length(Perp) > 1 then PlaySound(SFX_BOUNCE)
                // — TODO(M2/render)
              }
              gs.spriteParts.velocity[num] = vec2Subtract(gs.spriteParts.velocity[num], perp)
            }

            if (area === 0) {
              if (
                this.legsAnimation.id === anims.stand.id ||
                this.legsAnimation.id === anims.crouch.id ||
                this.legsAnimation.id === anims.prone.id ||
                this.legsAnimation.id === anims.proneMove.id ||
                this.legsAnimation.id === anims.getUp.id ||
                this.legsAnimation.id === anims.fall.id ||
                this.legsAnimation.id === anims.mercy.id ||
                this.legsAnimation.id === anims.mercy2.id ||
                this.legsAnimation.id === anims.own.id
              ) {
                if (
                  gs.spriteParts.velocity[num].x < SLIDELIMIT &&
                  gs.spriteParts.velocity[num].x > -SLIDELIMIT &&
                  step.y > SLIDELIMIT
                ) {
                  gs.spriteParts.pos[num] = cloneVec2(gs.spriteParts.oldPos[num])
                  gs.spriteParts.forces[num].y = gs.spriteParts.forces[num].y - gs.grav
                } else {
                  // {$IFNDEF SERVER} 미끄러짐 스파크 (r_maxsparks, Random(15)) — TODO(M2/render)
                }

                if (step.y > SLIDELIMIT && polyType !== POLY_TYPE_ICE && polyType !== POLY_TYPE_BOUNCY) {
                  if (
                    this.legsAnimation.id === anims.stand.id ||
                    this.legsAnimation.id === anims.fall.id ||
                    this.legsAnimation.id === anims.crouch.id
                  ) {
                    gs.spriteParts.velocity[num].x = gs.spriteParts.velocity[num].x * STANDSURFACECOEFX
                    gs.spriteParts.velocity[num].y = gs.spriteParts.velocity[num].y * STANDSURFACECOEFY
                    gs.spriteParts.forces[num].x = gs.spriteParts.forces[num].x - gs.spriteParts.velocity[num].x
                  } else if (this.legsAnimation.id === anims.prone.id) {
                    if (this.legsAnimation.currFrame > 24) {
                      if (!(this.control.down && (this.control.left || this.control.right))) {
                        gs.spriteParts.velocity[num].x = gs.spriteParts.velocity[num].x * STANDSURFACECOEFX
                        gs.spriteParts.velocity[num].y = gs.spriteParts.velocity[num].y * STANDSURFACECOEFY
                        gs.spriteParts.forces[num].x = gs.spriteParts.forces[num].x - gs.spriteParts.velocity[num].x
                      }
                    } else {
                      gs.spriteParts.velocity[num].x = gs.spriteParts.velocity[num].x * SURFACECOEFX
                      gs.spriteParts.velocity[num].y = gs.spriteParts.velocity[num].y * SURFACECOEFY
                    }
                  } else if (this.legsAnimation.id === anims.getUp.id) {
                    gs.spriteParts.velocity[num].x = gs.spriteParts.velocity[num].x * SURFACECOEFX
                    gs.spriteParts.velocity[num].y = gs.spriteParts.velocity[num].y * SURFACECOEFY
                  } else if (this.legsAnimation.id === anims.proneMove.id) {
                    gs.spriteParts.velocity[num].x = gs.spriteParts.velocity[num].x * STANDSURFACECOEFX
                    gs.spriteParts.velocity[num].y = gs.spriteParts.velocity[num].y * STANDSURFACECOEFY
                  }
                }
              } else {
                if (
                  this.legsAnimation.id === anims.crouchRun.id ||
                  this.legsAnimation.id === anims.crouchRunBack.id
                ) {
                  gs.spriteParts.velocity[num].x = gs.spriteParts.velocity[num].x * CROUCHMOVESURFACECOEFX
                  gs.spriteParts.velocity[num].y = gs.spriteParts.velocity[num].y * CROUCHMOVESURFACECOEFY
                } else {
                  gs.spriteParts.velocity[num].x = gs.spriteParts.velocity[num].x * SURFACECOEFX
                  gs.spriteParts.velocity[num].y = gs.spriteParts.velocity[num].y * SURFACECOEFY
                }
              }
            }
            return true
          }
        }
      }
    }
    return false
  }

  // Sprites.pas:2848-2907 TSprite.CheckMapVerticesCollision
  checkMapVerticesCollision(x: number, y: number, r: number, hasCollided: boolean): boolean {
    const gs = this.gs
    const map = gs.map
    const num = this.num

    const pos = vector2(x, y)

    // iterate through maps sector polygons
    const rx = pascalRound(pos.x / map.sectorsDivision)
    const ry = pascalRound(pos.y / map.sectorsDivision)
    if (rx > -map.sectorsNum && rx < map.sectorsNum && ry > -map.sectorsNum && ry < map.sectorsNum) {
      const sectorPolys = map.sectorPolys(rx, ry)
      for (let j = 1; j < sectorPolys.length; j++) {
        const w = sectorPolys[j]
        const polyType = map.polyType[w]

        const teamcol = teamCollides(map, w, this.player!.team, false)

        if (
          (polyType !== POLY_TYPE_DOESNT &&
            polyType !== POLY_TYPE_ONLY_BULLETS &&
            teamcol &&
            polyType !== POLY_TYPE_ONLY_FLAGGERS &&
            polyType !== POLY_TYPE_NOT_FLAGGERS) ||
          (this.holdedThing !== 0 && polyType === POLY_TYPE_ONLY_FLAGGERS) ||
          (this.holdedThing === 0 && polyType === POLY_TYPE_NOT_FLAGGERS)
        ) {
          for (let i = 1; i <= 3; i++) {
            const vert = vector2(map.polys[w].vertices[i].x, map.polys[w].vertices[i].y)
            const d = distanceVec2(vert, pos)
            if (d < r) {
              // collision
              if (this.bgState.backgroundTest(map, w)) continue

              if (!hasCollided) {
                this.handleSpecialPolyTypes(polyType, pos)
              }

              let dir = vec2Subtract(pos, vert)
              dir = vec2Normalize(dir)
              gs.spriteParts.pos[num] = vec2Add(gs.spriteParts.pos[num], dir)

              return true
            } // D < R
          } // i
        } // if (PolyType...)
      } // j
    }
    return false
  }

  // Sprites.pas:2908-3020 TSprite.CheckSkeletonMapCollision
  checkSkeletonMapCollision(i: number, x: number, y: number): boolean {
    const gs = this.gs
    const map = gs.map
    let result = false

    let pos = vector2(x - 1, y + 4)

    // iterate through map polygons
    let rx = pascalRound(pos.x / map.sectorsDivision)
    let ry = pascalRound(pos.y / map.sectorsDivision)
    if (rx > -map.sectorsNum && rx < map.sectorsNum && ry > -map.sectorsNum && ry < map.sectorsNum) {
      this.bgState.backgroundTestBigPolyCenter(map, pos)

      const sectorPolys = map.sectorPolys(rx, ry)
      for (let j = 1; j < sectorPolys.length; j++) {
        const w = sectorPolys[j]

        const teamcol = teamCollides(map, w, this.player!.team, false)

        if (
          (map.polyType[w] !== POLY_TYPE_DOESNT &&
            map.polyType[w] !== POLY_TYPE_ONLY_BULLETS &&
            teamcol &&
            map.polyType[w] !== POLY_TYPE_ONLY_FLAGGERS &&
            map.polyType[w] !== POLY_TYPE_NOT_FLAGGERS) ||
          (this.holdedThing !== 0 && map.polyType[w] === POLY_TYPE_ONLY_FLAGGERS) ||
          (this.holdedThing === 0 && map.polyType[w] === POLY_TYPE_NOT_FLAGGERS)
        ) {
          if (map.pointInPolyEdges(pos.x, pos.y, w)) {
            if (this.bgState.backgroundTest(map, w)) continue

            const cp = map.closestPerpendicular(w, pos)
            let perp = cloneVec2(cp.perp)
            perp = vec2Normalize(perp)
            perp = vec2Scale(perp, cp.d)

            this.skeleton.pos[i] = cloneVec2(this.skeleton.oldPos[i])
            this.skeleton.pos[i] = vec2Subtract(this.skeleton.pos[i], perp)

            // {$IFNDEF SERVER} a := Pos[i] - OldPos[i]; |a.y|>0.8 → SFX_BODYFALL,
            // |a.y|>2.1 → SFX_BONECRACK (DeadCollideCount 게이트) — TODO(M2/render)

            this.deadCollideCount++

            result = true
          }
        }
      }
    }

    if (result) {
      pos = vector2(x, y + 1)

      // iterate through map polygons
      rx = pascalRound(pos.x / map.sectorsDivision)
      ry = pascalRound(pos.y / map.sectorsDivision)

      if (rx > -map.sectorsNum && rx < map.sectorsNum && ry > -map.sectorsNum && ry < map.sectorsNum) {
        this.bgState.backgroundTestBigPolyCenter(map, pos)

        const sectorPolys = map.sectorPolys(rx, ry)
        for (let j = 1; j < sectorPolys.length; j++) {
          const w = sectorPolys[j]

          if (map.polyType[w] !== POLY_TYPE_DOESNT && map.polyType[w] !== POLY_TYPE_ONLY_BULLETS) {
            if (map.pointInPolyEdges(pos.x, pos.y, w)) {
              if (this.bgState.backgroundTest(map, w)) continue

              const cp = map.closestPerpendicular(w, pos)
              let perp = cloneVec2(cp.perp)
              perp = vec2Normalize(perp)
              perp = vec2Scale(perp, cp.d)

              this.skeleton.pos[i] = cloneVec2(this.skeleton.oldPos[i])
              this.skeleton.pos[i] = vec2Subtract(this.skeleton.pos[i], perp)

              result = true
            }
          }
        }
      }
    }

    return result
  }

  // Sprites.pas:3022-3125 TSprite.HandleSpecialPolyTypes
  handleSpecialPolyTypes(polyType: number, pos: TVector2): void {
    const gs = this.gs
    const num = this.num

    switch (polyType) {
      case POLY_TYPE_DEADLY: {
        // {$IFDEF SERVER} — 권위 로컬 심이므로 채택.
        this.healthHit(50 + this.health, num, 12, -1, gs.spriteParts.velocity[num])
        break
      }
      case POLY_TYPE_BLOODY_DEADLY: {
        // {$IFDEF SERVER} — 상동.
        this.healthHit(450 + this.health, num, 12, -1, gs.spriteParts.velocity[num])
        break
      }
      case POLY_TYPE_HURTS:
      case POLY_TYPE_LAVA: {
        // hurts
        if (!this.deadMeat) {
          if (random(10) === 0) {
            // {$IFDEF SERVER} — 권위 로컬 심이 대미지 적용.
            this.health = this.health - 5
            // {$ELSE} PlaySound(SFX_ARG / SFX_LAVA) — TODO(M2/render)
          }
          // {$IFDEF SERVER}
          if (this.health < 1) {
            this.healthHit(10, num, 12, -1, gs.spriteParts.velocity[num])
          }
        }

        // lava
        if (random(3) === 0) {
          if (polyType === POLY_TYPE_LAVA) {
            const a = cloneVec2(pos)
            a.y = a.y - 3.0
            // {$IFNDEF SERVER} CreateSpark(A, (0,-1.3), 36, Num, 40) — 규약 12 채택
            createSpark(gs, a, vector2(0, -1.3), 36, num, 40)

            if (random(3) === 0) {
              // 용암 불꽃 탄환 (Sprites.pas:3068-3075)
              const b = vector2(
                -gs.spriteParts.velocity[num].x,
                -gs.spriteParts.velocity[num].y,
              )
              createBullet(gs, a, b, guns[FLAMER].num, num, 255, guns[FLAMER].hitMultiply, false, true)
            }
          }
        }
        break
      }
      case POLY_TYPE_REGENERATES: {
        if (this.health < gs.startHealth) {
          if (gs.mainTickCounter % 12 === 0) {
            // {$IFDEF SERVER} — 회복도 HealthHit(-2) 경유.
            this.healthHit(-2, num, 12, -1, gs.spriteParts.velocity[num])
            // {$ELSE} PlaySound(SFX_REGENERATE) — TODO(M2/render)
          }
        }
        break
      }
      case POLY_TYPE_EXPLODES: {
        if (!this.deadMeat) {
          const a = cloneVec2(pos)
          a.y = a.y - 3.0
          const b = vector2(0, 0)
          // {$IFNDEF SERVER} CreateSpark(A, (0,-1.3), 36, Num, 40) — 상호배타 IFDEF 쌍:
          //   서버 분기(폭발탄+즉사)가 게임플레이 진실이므로 스파크 분기는 미채택 (규약 8a).
          // {$IFDEF SERVER} — 권위 로컬 심 (Sprites.pas:3094-3104):
          serverCreateBullet(gs, a, b, guns[M79].num, num, 255, guns[M79].hitMultiply, true)
          this.healthHit(4000, num, 12, -1, gs.spriteParts.velocity[num])
          this.health = -600
        }
        break
      }
      case POLY_TYPE_HURTS_FLAGGERS: {
        // Sprites.pas:3106-3123
        if (
          !this.deadMeat &&
          this.holdedThing > 0 &&
          gs.thing[this.holdedThing].style < OBJECT_USSOCOM
        ) {
          if (random(10) === 0) {
            // {$IFDEF SERVER} — 권위 로컬 심이 대미지 적용. {$ELSE} PlaySound(SFX_ARG) — 렌더.
            this.health = this.health - 10
          }
        }
        // {$IFDEF SERVER}
        if (this.health < 1) {
          this.healthHit(10, num, 12, -1, gs.spriteParts.velocity[num])
        }
        break
      }
    }
  }

  /* ──────────────── controls / bounds / respawn (Sprites.pas:3378-3775) ─────────────── */

  // Sprites.pas:3378-3397 TSprite.FreeControls
  freeControls(): void {
    this.control.left = false
    this.control.right = false
    this.control.up = false
    this.control.down = false
    this.control.fire = false
    this.control.jetpack = false
    this.control.throwNade = false
    this.control.changeWeapon = false
    this.control.throwWeapon = false
    this.control.reload = false
    this.control.prone = false
    this.control.mouseDist = 150 // {$IFNDEF SERVER}
    this.control.flagThrow = false
  }

  // Sprites.pas:3399-3422 TSprite.CheckOutOfBounds
  checkOutOfBounds(): void {
    const gs = this.gs

    if (gs.survivalEndRound) return

    const bound = gs.map.sectorsNum * gs.map.sectorsDivision - 50
    const spritePartsPos = gs.spriteParts.pos[this.num]

    if (Math.abs(spritePartsPos.x) > bound || Math.abs(spritePartsPos.y) > bound) {
      // {$IFNDEF SERVER} RandomizeStart(SpriteParts.Pos[Num], Player.Team) — 미채택.
      // 이 포트는 권위 로컬 심(서버 변형)이라 스폰 선택은 Respawn 내부의 {$IFDEF SERVER}
      // RandomizeStart 한 번만 수행한다 (두 분기는 원본에서 빌드별 상호배타).
      this.respawn()
    }
  }

  // Sprites.pas:3424-3453 TSprite.CheckSkeletonOutOfBounds
  checkSkeletonOutOfBounds(): void {
    const gs = this.gs

    if (gs.survivalEndRound) return

    const bound = gs.map.sectorsNum * gs.map.sectorsDivision - 50

    for (let i = 1; i <= 20; i++) {
      const skeletonPos = this.skeleton.pos[i]

      if (Math.abs(skeletonPos.x) > bound || Math.abs(skeletonPos.y) > bound) {
        // {$IFNDEF SERVER} RandomizeStart(SpriteParts.Pos[Num], Player.Team) — 미채택.
        // 스폰 선택은 Respawn 내부의 {$IFDEF SERVER} RandomizeStart 한 번만 (checkOutOfBounds 참조).
        this.respawn()
        break
      }
    }
  }

  // Sprites.pas:3455-3775 TSprite.Respawn
  respawn(): void {
    const gs = this.gs
    const num = this.num
    const player = this.player!

    if (gs.svSurvivalmodeClearweapons) {
      if (gs.survivalEndRound && !gs.weaponsCleaned) {
        // 떨어진 무기 Thing 전부 제거 (Sprites.pas:3470-3481)
        for (let j = 1; j <= MAX_THINGS; j++) {
          if (
            gs.thing[j].active &&
            ((gs.thing[j].style >= OBJECT_USSOCOM && gs.thing[j].style <= OBJECT_MINIGUN) ||
              (gs.thing[j].style >= OBJECT_COMBAT_KNIFE && gs.thing[j].style <= OBJECT_LAW))
          ) {
            gs.thing[j].kill()
          }
        }
        gs.weaponsCleaned = true
      }
    }

    if (this.isSpectator()) return

    // {$IFNDEF SERVER}
    if (player.name === '' || player.demoPlayer) return
    // if Num = MySprite then PlaySound(SFX_WERMUSIC) — TODO(M2/render)

    // {$IFDEF SERVER} — 권위 로컬 심이 스폰 위치를 정한다.
    gs.spriteParts.pos[num] = randomizeStart(gs, player.team).start

    // {$IFDEF SCRIPT} OnBeforePlayerRespawn — 스크립팅 없음, 생략.

    const deadMeatBeforeRespawn = this.deadMeat
    this.deadMeat = false
    this.halfDead = false
    this.health = gs.startHealth
    this.wearHelmet = 1

    if (player.headCap === 0) this.wearHelmet = 0
    // Skeleton.Constraints := GostekSkeleton.Constraints — 제약 배열 전체 record copy
    // (사망 시 끊긴 본(constraint.active=false)을 원상복구). ConstraintCount는 별개 필드라 불변.
    for (let j = 0; j < this.skeleton.constraints.length; j++) {
      const src = gs.gostekSkeleton.constraints[j]
      const dst = this.skeleton.constraints[j]
      dst.active = src.active
      dst.partA = src.partA
      dst.partB = src.partB
      dst.restLength = src.restLength
    }
    gs.spriteParts.velocity[num].x = 0
    gs.spriteParts.velocity[num].y = 0
    gs.spriteParts.forces[num].x = 0
    gs.spriteParts.forces[num].y = 0
    this.jetsCount = gs.map.startJet
    this.jetsCountPrev = gs.map.startJet
    this.ceaseFireCounter = gs.ceaseFireTime
    if (gs.svAdvancemode) {
      this.ceaseFireCounter = this.ceaseFireCounter * 3
    }
    this.brain.pissedOff = 0
    this.brain.goThing = false
    this.vest = 0
    this.bonusStyle = BONUS_NONE
    this.bonusTime = 0
    this.multiKills = 0
    this.multiKillTime = 0
    this.tertiaryWeapon = { ...guns[FRAGGRENADE] } // TertiaryWeapon := Guns[FRAGGRENADE] (record 복사)
    this.tertiaryWeapon.ammoCount = Math.trunc(gs.svMaxgrenades / 2)
    this.hasCigar = 0
    this.canMercy = true
    this.idleTime = DEFAULT_IDLETIME
    this.idleRandom = -1

    // {$IFNDEF SERVER} if Num = MySprite then CameraFollowSprite/GrenadeEffectTimer/
    // HitSprayCounter — 클라 카메라/이펙트 전역, TODO(M2/render)

    this.bodyAnimation = cloneAnimation(gs.anims.stand)
    this.legsAnimation = cloneAnimation(gs.anims.stand)
    this.position = POS_STAND
    this.onFire = 0
    this.deadCollideCount = 0
    this.brain.currentWaypoint = 0
    this.respawnCounter = 0
    player.camera = num
    this.onGround = false
    this.onGroundLastFrame = false
    this.onGroundPermanent = false

    this.bgState.backgroundStatus = BACKGROUND_TRANSITION
    this.bgState.backgroundPoly = BACKGROUND_POLY_UNKNOWN

    // TODO(M3) SERVER: BulletTime[Num]/GrenadeTime[Num] := MainTickCounter - 10;
    // KnifeCan[Num] := True (Server.pas 전역)

    if (this.holdedThing > 0 && this.holdedThing < MAX_THINGS + 1) {
      // 운반물 처리 (Sprites.pas:3566-3570)
      if (gs.thing[this.holdedThing].style !== OBJECT_PARACHUTE) {
        gs.thing[this.holdedThing].respawn()
      } else {
        gs.thing[this.holdedThing].kill()
      }
    }

    this.holdedThing = 0

    // {$IFNDEF SERVER} if SelWeapon > 0 then if WeaponSel[Num][SelWeapon] = 0 then
    //   SelWeapon := 0 (3574-3578) — 클라 림보메뉴 동기화. 규약 8a: 서버 분기(없음) 채택.

    this.weapon = { ...guns[NOWEAPON] } // Weapon := Guns[NOWEAPON] (record 복사)

    if (this.selWeapon > 0) {
      // {$IFNDEF SERVER} (WeaponActive[SelWeapon]=1) and (WeaponSel=1) 게이트 +
      //   ClientSpriteSnapshot (3583-3592) — 서버 분기는 게이트 없이 무조건 지급.
      this.applyWeaponByNum(this.selWeapon, 1)
    }

    // Sprites.pas:3595-3603
    const secWep = this.player!.secWep + 1

    if (
      secWep >= 1 &&
      secWep <= SECONDARY_WEAPONS &&
      gs.weaponActive[PRIMARY_WEAPONS + secWep] === 1 &&
      gs.weaponSel[num][PRIMARY_WEAPONS + secWep] === 1
    ) {
      this.secondaryWeapon = { ...guns[PRIMARY_WEAPONS + secWep] }
    } else {
      this.secondaryWeapon = { ...guns[NOWEAPON] }
    }

    // {$IFDEF SERVER}if sv_advancemode{$ENDIF} — 서버 변형 채택: advancemode에서만 (3605-3612)
    if (gs.svAdvancemode) {
      if (
        this.selWeapon > 0 &&
        (gs.weaponActive[this.selWeapon] === 0 || gs.weaponSel[num][this.selWeapon] === 0)
      ) {
        this.weapon = this.secondaryWeapon
        this.secondaryWeapon = { ...guns[NOWEAPON] }
      }
    }

    // {$IFDEF SERVER} 봇 무기 랜덤화/PathNum/Brain.Use 블록 (Sprites.pas:3614-3711) —
    // 규약 8a 채택 (봇은 M2 core 소관).
    if (this.player!.controlMethod === BOT) {
      this.brain.currentWaypoint = 0

      if (
        gs.svGamemode === GAMESTYLE_CTF ||
        gs.svGamemode === GAMESTYLE_INF ||
        gs.svGamemode === GAMESTYLE_HTF
      ) {
        this.brain.pathNum = this.player!.team
      }

      // randomize bot weapon
      if (
        this.brain.favWeapon !== guns[NOWEAPON].num &&
        this.brain.favWeapon !== guns[KNIFE].num &&
        this.brain.favWeapon !== guns[CHAINSAW].num &&
        this.brain.favWeapon !== guns[LAW].num &&
        !this.dummy
      ) {
        let anySelectable = false
        for (let j = 1; j <= 10; j++) {
          if (gs.weaponActive[j] === 1 && gs.weaponSel[num][j] === 1) {
            anySelectable = true
            break
          }
        }
        if (anySelectable) {
          do {
            if (random(2) === 0) {
              this.applyWeaponByNum(this.brain.favWeapon, 1)
            } else {
              const k = random(9) + 1
              this.weapon = { ...guns[k] }
            }

            if (
              gs.weaponsInGame < 6 &&
              gs.weaponActive[MINIGUN] === 1 &&
              gs.weaponSel[num][MINIGUN] === 1
            ) {
              this.weapon = { ...guns[MINIGUN] }
            }

            if (gs.svAdvancemode) {
              // 원본 그대로: 루프 변수 j를 루프 밖에서 사용 — 전 슬롯 미선택이면 j는
              // 상한+1(FPC 관행)로 ApplyWeaponByNum(11)이 된다 (수상한 코드, 보존).
              let j = 1
              for (; j <= PRIMARY_WEAPONS; j++) {
                if (gs.weaponSel[num][j] === 1) break
              }
              this.applyWeaponByNum(j, 1)
            }
          } while (!(gs.weaponActive[this.weapon.num] === 1 || gs.svAdvancemode))
        }
      }

      // Sprites.pas:3675-3691 — 서버 무기 전부 비활성 + 전 슬롯 미선택이면 맨손
      let allInactive = true
      for (let j = 1; j <= 10; j++) {
        if (gs.weaponActive[j] !== 0 || gs.weaponSel[num][j] !== 0) {
          allInactive = false
          break
        }
      }
      if (allInactive) {
        this.weapon = { ...guns[NOWEAPON] }
      }

      const favWeaponIndex = weaponNumToIndex(this.brain.favWeapon)
      if (
        this.brain.favWeapon === NOWEAPON_NUM ||
        isSecondaryWeaponIndex(favWeaponIndex) ||
        this.dummy
      ) {
        this.weapon = { ...guns[favWeaponIndex] }
        this.secondaryWeapon = { ...guns[NOWEAPON] }
      }

      if (this.brain.use !== 255) {
        if (this.brain.use === 1) {
          this.idleTime = 0
          this.idleRandom = 1
        }
        if (this.brain.use === 2) {
          this.idleTime = 0
          this.idleRandom = 0
        }
      }

      // Disarm bot if the primary weapon isn't allowed and selectable
      // (원본 그대로: WeaponIndex := Weapon.Num — Num을 인덱스로 씀, 프라이머리는 Num=인덱스)
      const weaponIndex = this.weapon.num
      if (weaponIndex >= 1 && weaponIndex <= PRIMARY_WEAPONS) {
        if (gs.weaponActive[weaponIndex] === 0 || gs.weaponSel[num][weaponIndex] === 0) {
          this.weapon = { ...guns[NOWEAPON] }
        }
      }
    }

    if (gs.weaponsInGame === 0) {
      this.weapon = { ...guns[NOWEAPON] }
    }

    this.parachute(gs.spriteParts.pos[num])

    // {$IFDEF SCRIPT} OnAfterPlayerRespawn — 생략.

    // {$IFDEF SERVER} — 권위 로컬 심.
    this.resetSpriteOldPos()

    // clear push wait list
    for (let j = 0; j <= MAX_PUSHTICK; j++) {
      this.nextPush[j].x = 0
      this.nextPush[j].y = 0
    }

    // {$IFNDEF SERVER} 스폰 사운드(SFX_SPAWN) + 스폰 스파크(CreateSpark 25) — TODO(M2/render)

    this.freeControls()

    this.legsApplyAnimation(gs.anims.stand, 1)
    this.bodyApplyAnimation(gs.anims.stand, 1)

    if (this.canRespawn(deadMeatBeforeRespawn)) {
      if (gs.survivalEndRound) {
        let survivalCheckEndRound = false
        for (let j = 1; j <= MAX_SPRITES; j++) {
          if (gs.sprite[j].active) {
            if (gs.sprite[j].player!.team !== TEAM_SPECTATOR) {
              if (gs.sprite[j].deadMeat) {
                survivalCheckEndRound = true
                break
              }
            }
          }
        }
        gs.survivalEndRound = survivalCheckEndRound
      }
    } else {
      // CheckSkeletonOutOfBounds would trigger infinitely
      // Respawn if this is not done
      for (let j = 1; j <= 20; j++) {
        this.skeleton.pos[j].x = gs.spriteParts.pos[num].x
        this.skeleton.pos[j].y = gs.spriteParts.pos[num].y
        this.skeleton.oldPos[j] = cloneVec2(this.skeleton.pos[j])
      }
      // TODO: Fix this shouldn't change wepstats (원본 주석 보존)
      this.die(NORMAL_DEATH, num, 1, -1, this.skeleton.pos[12])
      player.deaths--
    }
  }

  // Sprites.pas:3776-3783 TSprite.ResetSpriteOldPos ({$IFDEF SERVER} — 권위 로컬 심이라 포함)
  resetSpriteOldPos(): void {
    const gs = this.gs
    for (let i = MAX_OLDPOS; i >= 1; i--) {
      gs.oldSpritePos[this.num][i] = cloneVec2(gs.spriteParts.pos[this.num])
    }
  }

  /* ──────────────────── movement helpers (Sprites.pas:4813-4922) ─────────────────── */

  // Sprites.pas:4813-4850 TSprite.GetMoveacc
  getMoveacc(): number {
    const anims = this.gs.anims
    let result = 0

    let moveacc: number
    // No moveacc for bots on harder difficulties
    // ({$IFDEF SERVER}and (bots_difficulty.Value < 50){$ENDIF} — 클라 빌드에선 BOT이면 무조건 0)
    if (this.player!.controlMethod === BOT) {
      moveacc = 0
    } else {
      moveacc = this.weapon.movementAcc
    }

    if (moveacc > 0) {
      if (
        (this.control.jetpack && this.jetsCount > 0) ||
        this.legsAnimation.id === anims.jump.id ||
        this.legsAnimation.id === anims.jumpSide.id ||
        this.legsAnimation.id === anims.run.id ||
        this.legsAnimation.id === anims.runBack.id ||
        this.legsAnimation.id === anims.roll.id ||
        this.legsAnimation.id === anims.rollBack.id
      ) {
        result = moveacc * 7
      } else if (
        (!this.onGroundPermanent &&
          this.legsAnimation.id !== anims.prone.id &&
          this.legsAnimation.id !== anims.proneMove.id &&
          this.legsAnimation.id !== anims.crouch.id &&
          this.legsAnimation.id !== anims.crouchRun.id &&
          this.legsAnimation.id !== anims.crouchRunBack.id) ||
        this.legsAnimation.id === anims.getUp.id ||
        (this.legsAnimation.id === anims.prone.id &&
          this.legsAnimation.currFrame < this.legsAnimation.numFrames)
      ) {
        result = moveacc * 3
      }
    }
    return result
  }

  // Sprites.pas:4852-4864 TSprite.GetCursorAimDirection
  getCursorAimDirection(): TVector2 {
    const mouseAim = vector2(this.control.mouseAimX, this.control.mouseAimY)
    let aimDirection = vec2Subtract(mouseAim, this.skeleton.pos[15])
    aimDirection = vec2Normalize(aimDirection)
    return aimDirection
  }

  // Sprites.pas:4866-4874 TSprite.GetHandsAimDirection
  getHandsAimDirection(): TVector2 {
    let aimDirection = vec2Subtract(this.skeleton.pos[15], this.skeleton.pos[16])
    aimDirection = vec2Normalize(aimDirection)
    return aimDirection
  }

  // Sprites.pas:4876-4879
  isSolo(): boolean {
    return this.player!.team === TEAM_NONE
  }

  // Sprites.pas:4881-4884
  isNotSolo(): boolean {
    return this.player!.team !== TEAM_NONE
  }

  // Sprites.pas:4886-4894
  isInTeam(): boolean {
    switch (this.player!.team) {
      case TEAM_ALPHA:
      case TEAM_BRAVO:
      case TEAM_CHARLIE:
      case TEAM_DELTA:
        return true
      default:
        return false
    }
  }

  // Sprites.pas:4896-4899
  isSpectator(): boolean {
    return this.player!.team === TEAM_SPECTATOR
  }

  // Sprites.pas:4901-4904
  isNotSpectator(): boolean {
    return this.player!.team !== TEAM_SPECTATOR
  }

  // Sprites.pas:4906-4909
  isInSameTeam(otherPlayer: TSprite): boolean {
    return this.player!.team === otherPlayer.player!.team
  }

  // Sprites.pas:4911-4914
  isNotInSameTeam(otherPlayer: TSprite): boolean {
    return this.player!.team !== otherPlayer.player!.team
  }

  // Sprites.pas:4916-4921 TSprite.CanRespawn
  canRespawn(deadMeatBeforeRespawn: boolean): boolean {
    return this.gs.svSurvivalmode === false || this.gs.survivalEndRound || !deadMeatBeforeRespawn
  }
}

/* ****************************************************************************
 *                     CreateSprite (Sprites.pas:240-379)                     *
 **************************************************************************** */

export function createSprite(
  gs: GameState,
  sPos: TVector2,
  sVelocity: TVector2,
  sStyle: number,
  n: number,
  player: TPlayer,
  transferOwnership: boolean,
): number {
  // Pascal은 값 전달(레코드 복사) — 함수 안에서 sPos/sVelocity를 덮어쓰므로 복제.
  sPos = cloneVec2(sPos)
  sVelocity = cloneVec2(sVelocity)

  let i: number
  if (n === 255) {
    i = 0
    for (let k = 1; k <= MAX_SPRITES + 1; k++) {
      if (k === MAX_SPRITES + 1) {
        return -1
      }
      if (!gs.sprite[k].active) {
        i = k
        break
      }
    }
  } else {
    i = n // i is now the active sprite
  }

  const result = i
  const spr = gs.sprite[i]

  // replace player object
  if (spr.player !== null) {
    spr.player.spriteNum = 0
    // if IsPlayerObjectOwner then Player.Free — GC 환경에선 no-op (참조 교체로 충분)
  }
  spr.player = player
  spr.player.spriteNum = i
  spr.isPlayerObjectOwner = transferOwnership

  spr.active = true
  spr.style = sStyle
  spr.num = i
  spr.deadMeat = false
  spr.respawnCounter = 0
  spr.ceaseFireCounter = gs.ceaseFireTime

  if (gs.svSurvivalmode) {
    spr.ceaseFireCounter = spr.ceaseFireCounter * 3
  }

  spr.alpha = 255
  spr.brain.pissedOff = 0
  spr.vest = 0
  spr.bonusStyle = BONUS_NONE
  spr.bonusTime = 0
  spr.multiKills = 0
  spr.multiKillTime = 0
  spr.tertiaryWeapon = { ...guns[FRAGGRENADE] } // record 복사 (Sprites.pas:293)
  spr.hasCigar = 0
  spr.idleTime = DEFAULT_IDLETIME
  spr.idleRandom = -1
  spr.position = POS_STAND
  spr.bodyAnimation = cloneAnimation(gs.anims.stand)
  spr.legsAnimation = cloneAnimation(gs.anims.stand)
  spr.onFire = 0
  spr.holdedThing = 0
  spr.selWeapon = 0
  spr.stat = 0

  // {$IFNDEF SERVER}
  spr.oldDeadMeat = false
  spr.halfDead = false

  spr.bgState.backgroundStatus = BACKGROUND_TRANSITION
  spr.bgState.backgroundPoly = BACKGROUND_POLY_UNKNOWN

  sVelocity.x = 0
  sVelocity.y = 0

  if (spr.player.team === TEAM_SPECTATOR) {
    sPos.x = MIN_SECTORZ * gs.map.sectorsDivision * 0.8
    sPos.y = MIN_SECTORZ * gs.map.sectorsDivision * 0.8
  }

  // activate sprite part
  gs.spriteParts.createPart(sPos, sVelocity, 1, i)

  // create skeleton
  spr.skeleton.timeStep = 1
  spr.skeleton.gravity = 1.06 * gs.grav
  // Sprite[i].Skeleton := GostekSkeleton — object 값 대입 = 전체 record copy (직전 두 줄의
  // TimeStep/Gravity도 GostekSkeleton 값으로 덮인다 — 원본의 군더더기 대입까지 그대로).
  // 포트: destroy(초기화) + clone(파티클/제약) + 스칼라 4종 복사.
  spr.skeleton.destroy()
  spr.skeleton.clone(gs.gostekSkeleton)
  spr.skeleton.timeStep = gs.gostekSkeleton.timeStep
  spr.skeleton.gravity = gs.gostekSkeleton.gravity
  spr.skeleton.vDamping = gs.gostekSkeleton.vDamping
  spr.skeleton.eDamping = gs.gostekSkeleton.eDamping
  spr.skeleton.vDamping = 0.9945

  spr.health = gs.startHealth
  spr.aimDistCoef = DEFAULTAIMDIST

  spr.weapon = { ...guns[NOWEAPON] } // record 복사 (Sprites.pas:333)

  // Sprites.pas:335-341 — Respawn과 달리 WeaponSel 게이트 없이 WeaponActive만 본다 (원본 그대로)
  {
    const secWep = spr.player.secWep + 1
    if (
      secWep >= 1 &&
      secWep <= SECONDARY_WEAPONS &&
      gs.weaponActive[PRIMARY_WEAPONS + secWep] === 1
    ) {
      spr.secondaryWeapon = { ...guns[PRIMARY_WEAPONS + secWep] }
    } else {
      spr.secondaryWeapon = { ...guns[NOWEAPON] }
    }
  }

  spr.jetsCount = gs.map.startJet
  // {$IFNDEF SERVER}
  spr.jetsCountPrev = gs.map.startJet

  spr.tertiaryWeapon.ammoCount = Math.trunc(gs.svMaxgrenades / 2)

  spr.wearHelmet = 1
  if (spr.player.headCap === 0) {
    spr.wearHelmet = 0
  }

  spr.brain.targetNum = 1
  spr.brain.waypointTimeoutCounter = WAYPOINTTIMEOUT

  spr.deadCollideCount = 0

  // {$IFNDEF SERVER} ReloadSoundChannel/JetsSoundChannel/GattlingSoundChannel(2) 배정 —
  // 사운드 채널 필드 생략(파일 헤더 노트).
  spr.moveSkeleton(sPos.x, sPos.y, false)

  // clear push wait list
  for (let j = 0; j <= MAX_PUSHTICK; j++) {
    spr.nextPush[j].x = 0
    spr.nextPush[j].y = 0
  }

  spr.bulletCount = random(65535) // Random(High(Word)) // FIXME wat? (원본 주석 보존)
  spr.freeControls()

  // SortPlayers — 표시 순서 정렬 (ServerHelper.pas), 규약 11 계열 훅 (T10 배선).
  gs.sortPlayers?.()

  return result
}

// ServerHelper.pas:92-102 FindLowestTeam — 인원이 가장 적은 팀 번호 (TM이면 1..4, 그 외 1..2).
// ChangeTeam의 sv_balanceteams 가드가 사용. {$IFDEF SERVER} 소속 (규약 8a 채택).
function findLowestTeam(gs: GameState, arr: number[]): number {
  let tmp = 1
  const hi = gs.svGamemode === GAMESTYLE_TEAMMATCH ? 4 : 2
  for (let i = 1; i <= hi; i++) {
    if (arr[tmp] > arr[i]) {
      tmp = i
    }
  }
  return tmp
}

/* ****************************************************************************
 *                     TeamCollides (Sprites.pas:381-437)                     *
 **************************************************************************** */

export function teamCollides(map: PolyMap, poly: number, team: number, bullet: boolean): boolean {
  let result = true
  const pt = map.polyType[poly]

  if (bullet) {
    if (pt === POLY_TYPE_RED_BULLETS || pt === POLY_TYPE_RED_PLAYER) {
      if (team === TEAM_ALPHA && pt === POLY_TYPE_RED_BULLETS) result = true
      else result = false
    } else if (pt === POLY_TYPE_BLUE_BULLETS || pt === POLY_TYPE_BLUE_PLAYER) {
      // 원본 그대로: BRAVO인데 YELLOW_BULLETS를 검사한다 (Sprites.pas:397 — 명백한 원본 버그,
      // 결과적으로 BLUE 계열은 불릿에게 항상 False). "고치지 않고" 보존.
      // (as number: TS가 바깥 분기에서 pt를 12|13으로 좁혀 14와의 비교를 오류로 잡는데,
      //  이 도달불가 비교 자체가 보존 대상이므로 넓혀서 통과시킨다.)
      if (team === TEAM_BRAVO && (pt as number) === POLY_TYPE_YELLOW_BULLETS) result = true
      else result = false
    } else if (pt === POLY_TYPE_YELLOW_BULLETS || pt === POLY_TYPE_YELLOW_PLAYER) {
      if (team === TEAM_CHARLIE && pt === POLY_TYPE_YELLOW_BULLETS) result = true
      else result = false
    } else if (pt === POLY_TYPE_GREEN_BULLETS || pt === POLY_TYPE_GREEN_PLAYER) {
      if (team === TEAM_DELTA && pt === POLY_TYPE_GREEN_BULLETS) result = true
      else result = false
    }
  } else {
    if (
      (pt === POLY_TYPE_RED_BULLETS && team === TEAM_ALPHA) ||
      ((pt === POLY_TYPE_RED_BULLETS || pt === POLY_TYPE_RED_PLAYER) && team !== TEAM_ALPHA)
    ) {
      result = false
    } else if (
      (pt === POLY_TYPE_BLUE_BULLETS && team === TEAM_BRAVO) ||
      ((pt === POLY_TYPE_BLUE_BULLETS || pt === POLY_TYPE_BLUE_PLAYER) && team !== TEAM_BRAVO)
    ) {
      result = false
    } else if (
      (pt === POLY_TYPE_YELLOW_BULLETS && team === TEAM_CHARLIE) ||
      ((pt === POLY_TYPE_YELLOW_BULLETS || pt === POLY_TYPE_YELLOW_PLAYER) && team !== TEAM_CHARLIE)
    ) {
      result = false
    } else if (
      (pt === POLY_TYPE_GREEN_BULLETS && team === TEAM_DELTA) ||
      ((pt === POLY_TYPE_GREEN_BULLETS || pt === POLY_TYPE_GREEN_PLAYER) && team !== TEAM_DELTA)
    ) {
      result = false
    }
  }

  if (pt === POLY_TYPE_NON_FLAGGER_COLLIDES) {
    result = false
  }
  return result
}

/* ****************************************************************************
 *            RandomizeStart re-export (Things.pas:620-663)                   *
 **************************************************************************** */

// M1에서 이 파일에 임시 거처였던 randomizeStart는 Things.pas 본체 포팅(M2 Task 5)과 함께
// things.ts로 이동했다. 기존 `from './sprites'` import 경로 호환을 위해 재수출한다
// (이 파일 내부의 Respawn 경로도 위 import를 그대로 사용).
export { randomizeStart }

/* ****************************************************************************
 *      봇 생성 — SharedConfig.pas:133-220 LoadBotConfig + Server.pas:925 AddBotPlayer  *
 **************************************************************************** */

// Net.pas:104 상당 — 봇 이름 최대 길이 (SharedConfig.pas가 Min(Length, PLAYERNAME_CHARS)로 자름).
const PLAYERNAME_CHARS = 24

// bots.json 항목 스키마 (build-assets.mjs가 .bot [BOT] 섹션 → JSON, T0). LoadBotConfig가 읽는
// 키만 (색상/Chain/Hair 등 순수 렌더 필드는 core 미사용 — T13 web에서 사용).
export interface BotConfigEntry {
  Name: string
  Favourite_Weapon: string
  Secondary_Weapon: number
  Friend: string
  Accuracy: number
  Shoot_Dead: number
  Grenade_Frequency: number
  OnStartUse: number
  Chat_Frequency: number
  Chat_Kill: string
  Chat_Dead: string
  Chat_LowHealth: string
  Chat_SeeEnemy: string
  Chat_Winning: string
  Camping: number
  Headgear?: number
}

// SharedConfig.pas:133-220 LoadBotConfig — bots.json 항목을 sprite.brain/player에 적재.
// 원본은 파일 IO(TMemIniFile)지만 이 포트는 파싱된 JSON 항목을 받는다 (core IO-free).
// 사운드/콘솔/스크립트 디스패치는 생략. 반환 = 성공 여부.
export function loadBotConfig(gs: GameState, spriteC: TSprite, cfg: BotConfigEntry): boolean {
  const brain = spriteC.brain

  brain.favWeapon = weaponNameToNum(cfg.Favourite_Weapon)
  spriteC.player!.secWep = cfg.Secondary_Weapon
  brain.friend = cfg.Friend
  brain.accuracy = cfg.Accuracy
  brain.accuracy = trunc(brain.accuracy * (gs.botsDifficulty / 100))
  brain.deadKill = cfg.Shoot_Dead
  brain.grenadeFreq = cfg.Grenade_Frequency
  brain.use = cfg.OnStartUse

  brain.chatFreq = cfg.Chat_Frequency
  brain.chatFreq = pascalRound(2.5 * brain.chatFreq)
  brain.chatKill = cfg.Chat_Kill
  brain.chatDead = cfg.Chat_Dead
  brain.chatLowHealth = cfg.Chat_LowHealth
  brain.chatSeeEnemy = cfg.Chat_SeeEnemy
  brain.chatWinning = cfg.Chat_Winning

  brain.camper = cfg.Camping

  spriteC.player!.name = cfg.Name.slice(0, Math.min(cfg.Name.length, PLAYERNAME_CHARS))

  // 색상(Color1/2/Skin/Hair/JetColor)은 렌더 전용 (TPlayer 최소 인터페이스에 미포팅) — 생략.
  // Headgear → HeadCap(0=없음): core는 0 여부만 보고 WearHelmet을 세팅한다. 실제 GFX id 매핑
  // (GFX_GOSTEK_KAP/HELM)은 web 렌더(T13) 소관이라 여기선 headgear 값을 그대로 보존.
  const headgear = cfg.Headgear ?? 0
  spriteC.player!.headCap = headgear === 0 ? 0 : headgear
  if (spriteC.player!.headCap === 0) spriteC.wearHelmet = 0
  else spriteC.wearHelmet = 1

  spriteC.player!.controlMethod = BOT
  spriteC.freeControls()

  return true
}

// Server.pas:925-984 AddBotPlayer — 봇 스프라이트를 게임에 추가. 반환 = 스프라이트 인덱스
// (실패=0). ServerSendNewPlayerInfo/콘솔 메시지/스크립트 디스패치는 네트·UI라 생략.
export function addBotPlayer(gs: GameState, cfg: BotConfigEntry, team: number): number {
  const newPlayer = createTPlayer()
  newPlayer.team = team
  // NewPlayer.ApplyShirtColorFromTeam() — 셔츠 색(렌더 전용) 생략.

  const r = randomizeStart(gs, team)
  const p = createSprite(gs, r.start, vector2(0, 0), 1, 255, newPlayer, true)
  if (p < 0) return 0 // 서버 만원 (createSprite 슬롯 없음)

  if (!loadBotConfig(gs, gs.sprite[p], cfg)) {
    gs.sprite[p].kill()
    return 0
  }

  gs.sprite[p].respawn()
  gs.sprite[p].player!.controlMethod = BOT

  gs.sortPlayers?.()

  return p
}

/* ****************************************************************************
 *      loadSpriteObjects — Anims.pas LoadAnimObjects 끝부분 (341-360)        *
 **************************************************************************** */

// Anims.pas LoadAnimObjects의 마지막 블록: SpriteParts/GostekSkeleton 셋업.
// anims.ts loadAnimObjects()(44개 애니메이션 등록)와 짝을 이룬다 — 게임 초기화 시 둘 다 호출.
// `read`는 anims.ts/parts.ts와 동일한 주입식 파일 리더 (core는 IO-free).
export function loadSpriteObjects(gs: GameState, read: (name: string) => string[]): void {
  gs.spriteParts.destroy()
  gs.spriteParts.timeStep = 1
  gs.spriteParts.gravity = gs.grav // GRAV = 0.06
  gs.spriteParts.eDamping = 0.99

  gs.gostekSkeleton.destroy()
  gs.gostekSkeleton.loadPOObject(read('objects/gostek.po'), ANIMS_SCALE) // SCALE = 3
  gs.gostekSkeleton.timeStep = 1
  gs.gostekSkeleton.gravity = 1.06 * gs.grav
  gs.gostekSkeleton.vDamping = 0.997

  // BoxSkeleton/BulletParts/SparkParts/FlagSkeleton/ParaSkeleton/StatSkeleton/RifleSkeleton10..55
  // (Anims.pas:373-400) — state.ts의 loadThingObjects(gs, read)로 이관됨 (M2 Task 2). 호출자는
  // loadSpriteObjects와 loadThingObjects를 둘 다 호출해야 한다 (helpers.ts/main.ts 참조).
}
