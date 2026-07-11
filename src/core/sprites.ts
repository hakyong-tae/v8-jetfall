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
// * Things.pas:620-663 RandomizeStart도 여기 포함 (스폰 위치 선택 — Respawn이 의존, Things.pas
//   본체는 미포팅. things.ts가 생기면 그쪽으로 이동/재수출 예정).
// * Anims.pas LoadAnimObjects 끝부분(SpriteParts/GostekSkeleton 셋업) → loadSpriteObjects().
// * TSprite.Update → Task 11. Fire/Die/Kill/HealthHit/DropWeapon/ThrowFlag/ThrowGrenade/
//   ApplyWeaponByNum/Parachute/ChangeTeam → TODO(M2) 스텁 (시그니처만).
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
import { trunc, random, pascalRound } from './pascal'
import { pointLineDistance, distanceVec2 } from './calc'
import { ParticleSystem, NUM_PARTICLES } from './parts'
import { type TGun, emptyGun } from './weapons'
import { TAnimation, MAX_FRAMES_INDEX, MAX_POS_INDEX } from './anims'
import {
  PolyMap,
  pointInPoly,
  MIN_SECTORZ,
  MAX_SPAWNPOINTS,
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
} from './constants'
import { controlSprite } from './control'
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

// TODO(M2 후속): 총기 식별 자리표시자 — control.ts 헤더 규약과 동일. weapons.ts(Weapons.pas
// Guns[])는 Task 1에서 포팅되었지만, 이 파일의 `this.weapon`이 실제 guns[] 항목을 참조하도록
// 배선하는 것은 Task 6/7(applyWeaponByNum 등) 몫이라 아직 여기서는 자리표시자를 쓴다.
// `Weapon.Num = Guns[X].Num` 꼴 비교는 GUN_EQ(false), `<>` 꼴은 GUN_NEQ(true)로 대체하고
// 원본 조건을 인접 주석으로 보존한다 ("특수총이 아닌 일반 총 소지" 기본값).
const GUN_EQ = false as boolean // Weapon.Num  =  Guns[X].Num
const GUN_NEQ = true as boolean // Weapon.Num <> Guns[X].Num

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
  // TODO(M3) SERVER: {$IFDEF SERVER} 전용 필드 — 봇/서버 로직이 붙을 때 사용.
  hasPack = false // TODO(M3) SERVER
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
  // 라인은 주석 스텁, 무기 식별은 GUN_EQ/GUN_NEQ 규약 (파일 상단).
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
      (GUN_NEQ /* Sprite[Num].Weapon.Num <> Guns[SPAS12].Num */ ||
        this.weapon.fireIntervalCount === 0)
    ) {
      this.autoReloadWhenCanFire = false

      if (
        GUN_EQ /* Sprite[Num].Weapon.Num = Guns[SPAS12].Num */ &&
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
            (this.weapon.ammoCount > 0 || GUN_EQ /* Weapon.Num = Guns[SPAS12].Num */)
          ) {
            this.weapon.fireIntervalPrev = this.weapon.fireIntervalCount
            this.weapon.fireIntervalCount--
          }

          // If fire button is released, then the reload can begin
          if (!this.control.fire) this.canAutoReloadSpas = true

          // reload
          if (
            this.weapon.ammoCount === 0 &&
            (GUN_EQ /* Weapon.Num = Guns[CHAINSAW].Num */ ||
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
              if (GUN_EQ /* Weapon.Num = Guns[SPAS12].Num */) {
                if (this.weapon.fireIntervalCount === 0 && this.canAutoReloadSpas) {
                  this.bodyApplyAnimation(anims.reload, 1)
                }
              } else if (
                GUN_EQ /* Weapon.Num = Guns[BOW].Num */ ||
                GUN_EQ /* Weapon.Num = Guns[BOW2].Num */
              ) {
                this.bodyApplyAnimation(anims.reloadBow, 1)
              } else if (
                this.bodyAnimation.id !== anims.clipIn.id &&
                this.bodyAnimation.id !== anims.slideBack.id
              ) {
                // Don't show reload animation for chainsaw if one of these animations are
                // already ongoing
                if (
                  GUN_NEQ /* Weapon.Num <> Guns[CHAINSAW].Num */ ||
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

            if (GUN_NEQ /* Weapon.Num <> Guns[SPAS12].Num */) {
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

            if (GUN_NEQ /* Weapon.Num <> Guns[SPAS12].Num */) {
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
            (GUN_EQ /* Weapon.Num = Guns[BOW].Num */ ||
              GUN_EQ) /* Weapon.Num = Guns[BOW2].Num */ &&
            this.health < gs.startHealth /* STARTHEALTH */
          ) {
            this.health = this.health + 1
          }

          // {$IFNDEF SERVER} 시가 연기(HasCigar = 10, 1242-1269), 겨울 입김
          //   (Map.Weather = 3, 1272-1283) — TODO(M2/render)

          // parachuter
          this.para = 0
          if (this.holdedThing > 0 && this.holdedThing < MAX_THINGS + 1) {
            // TODO(M2) Things: if Thing[HoldedThing].Style = OBJECT_PARACHUTE then Para := 1
          }

          if (this.para === 1) {
            gs.spriteParts.forces[num].y = PARA_SPEED
            // {$IFDEF SERVER} if CeaseFireCounter < 1 — 채택 (클라는 survival 확장 게이트)
            if (this.ceaseFireCounter < 1) {
              if (this.onGround || this.control.jetpack) {
                if (this.holdedThing > 0 && this.holdedThing < MAX_THINGS + 1) {
                  // TODO(M2) Things: 낙하산 분리 — Thing[HoldedThing].HoldingSprite := 0;
                  //   Dec(Thing[HoldedThing].Skeleton.ConstraintCount);
                  //   Thing[HoldedThing].TimeOut := 3 * 60; HoldedThing := 0
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
                    gs.sprite[i].healthHit(4000, i, 1, -1, p) // TODO(M2) stub
                    gs.sprite[i].player!.deaths--
                  }
                }
              }

              // TODO(M2) Things: HTF가 아닌 모드에서 TeamFlag[1/2]가 미귀환이면
              //   Thing[TeamFlag[...]].Respawn (Sprites.pas:1380-1387)
            }
          }
        }

        // parachuter
        this.para = 0
        if (this.holdedThing > 0 && this.holdedThing < MAX_THINGS + 1) {
          // TODO(M2) Things: if Thing[HoldedThing].Style = OBJECT_PARACHUTE then Para := 1
        }

        if (this.para === 1) {
          this.skeleton.forces[12].y = 25 * PARA_SPEED
          if (this.onGround) {
            if (this.holdedThing > 0 && this.holdedThing < MAX_THINGS + 1) {
              // TODO(M2) Things: 낙하산 분리 (Sprites.pas:1403-1406)
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

  /* ─────────────────────────── stubs (다른 태스크) ─────────────────────────── */

  // TODO(M2): Sprites.pas TSprite.Kill
  kill(): void {}

  // TODO(M2): Sprites.pas TSprite.Die(How, Who, Where, What, Impact)
  die(_how: number, _who: number, _where: number, _what: number, _impact: TVector2): void {}

  // TODO(M2): Sprites.pas TSprite.DropWeapon
  dropWeapon(): number {
    return 0
  }

  // TODO(M2): Sprites.pas TSprite.ApplyWeaponByNum(WNum, Gun, Ammo, RestorePrimaryState)
  applyWeaponByNum(_wNum: number, _gun: number, _ammo = -1, _restorePrimaryState = false): void {}

  // TODO(M2): Sprites.pas TSprite.HealthHit(Amount, Who, Where, What, Impact) — 대미지/사망 판정.
  // M1에서는 이동 코드의 분기 구조 보존을 위한 no-op.
  healthHit(_amount: number, _who: number, _where: number, _what: number, _impact: TVector2): void {}

  // TODO(M2): Sprites.pas TSprite.Parachute(a)
  parachute(_a: TVector2): void {}

  // TODO(M2): Sprites.pas TSprite.ChangeTeam(Team)
  changeTeam(_team: number): void {}

  // TODO(M2): Sprites.pas TSprite.Fire
  fire(): void {}

  // TODO(M2): Sprites.pas TSprite.ThrowFlag
  throwFlag(): void {}

  // TODO(M2): Sprites.pas TSprite.ThrowGrenade
  throwGrenade(): void {}

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
                  // TODO(M2): HealthHit 구현 전까지 no-op 스텁 호출 (분기 구조 보존)
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
        // {$IFDEF SERVER} — 권위 로컬 심이므로 채택. TODO(M2): HealthHit 구현 전까지 no-op.
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
            this.healthHit(10, num, 12, -1, gs.spriteParts.velocity[num]) // TODO(M2) stub
          }
        }

        // lava
        if (random(3) === 0) {
          if (polyType === POLY_TYPE_LAVA) {
            const a = cloneVec2(pos)
            a.y = a.y - 3.0
            // {$IFNDEF SERVER} CreateSpark(A, (0,-1.3), 36, Num, 40) — TODO(M2/render)

            if (random(3) === 0) {
              // TODO(M2): B := -Velocity; CreateBullet(A, B, Guns[FLAMER].Num, Num, 255,
              //   Guns[FLAMER].HitMultiply, False, True) — Bullets.pas 포팅 시.
              void a
            }
          }
        }
        break
      }
      case POLY_TYPE_REGENERATES: {
        if (this.health < gs.startHealth) {
          if (gs.mainTickCounter % 12 === 0) {
            // {$IFDEF SERVER} — 회복도 HealthHit(-2) 경유. TODO(M2) stub.
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
          // {$IFNDEF SERVER} CreateSpark(A, (0,-1.3), 36, Num, 40) — TODO(M2/render)
          // {$IFDEF SERVER} — 권위 로컬 심:
          // TODO(M2): ServerCreateBullet(A, (0,0), Guns[M79].Num, Num, 255,
          //   Guns[M79].HitMultiply, True)
          this.healthHit(4000, num, 12, -1, gs.spriteParts.velocity[num]) // TODO(M2) stub
          this.health = -600
          void a
        }
        break
      }
      case POLY_TYPE_HURTS_FLAGGERS: {
        // TODO(M2) Things: if not DeadMeat and (HoldedThing > 0) and
        //   (Thing[HoldedThing].Style < OBJECT_USSOCOM) then
        //     if Random(10) = 0 then Health := Health - 10 (server) / PlaySound(SFX_ARG) (client)
        // {$IFDEF SERVER} if Health < 1 then HealthHit(10, Num, 12, -1, Velocity)
        // — Thing 배열이 아직 없어 조건 평가 불가, Things.pas(M2) 포팅 시 채움.
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
        // TODO(M2) Things: 떨어진 무기 Thing들(OBJECT_USSOCOM..MINIGUN,
        // OBJECT_COMBAT_KNIFE..LAW) 전부 Thing[J].Kill (Sprites.pas:3470-3481)
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
    // TODO(M2): TertiaryWeapon := Guns[FRAGGRENADE];
    this.tertiaryWeapon = emptyGun()
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
      // TODO(M2) Things: if Thing[HoldedThing].Style <> OBJECT_PARACHUTE then
      //   Thing[HoldedThing].Respawn else Thing[HoldedThing].Kill
    }

    this.holdedThing = 0

    // {$IFNDEF SERVER} TODO(M2): if SelWeapon > 0 then
    //   if WeaponSel[Num][SelWeapon] = 0 then SelWeapon := 0 (Game.pas WeaponSel)

    // TODO(M2): Weapon := Guns[NOWEAPON];
    this.weapon = emptyGun()

    if (this.selWeapon > 0) {
      // TODO(M2): {$IFNDEF SERVER} if (WeaponActive[SelWeapon] = 1) and
      //   (WeaponSel[Num][SelWeapon] = 1) then ApplyWeaponByNum(SelWeapon, 1);
      //   if Num = MySprite then ClientSpriteSnapshot (Sprites.pas:3580-3591)
    }

    // TODO(M2): SecWep := Player.SecWep + 1; SecondaryWeapon := Guns[PRIMARY_WEAPONS + SecWep]
    //   (WeaponActive/WeaponSel 게이트, Sprites.pas:3594-3602) — 지금은 빈 총.
    this.secondaryWeapon = emptyGun()

    // TODO(M2): {$IFDEF SERVER}if sv_advancemode{$ENDIF} SelWeapon 비활성 시
    //   Weapon := SecondaryWeapon; SecondaryWeapon := Guns[NOWEAPON] (Sprites.pas:3604-3611)

    // TODO(M3) SERVER + TODO(M2): 봇 무기 랜덤화/PathNum/Brain.Use 블록 전체
    // (Sprites.pas:3613-3712 — Player.ControlMethod = BOT 분기)

    // TODO(M2): if WeaponsInGame = 0 then Weapon := Guns[NOWEAPON];

    this.parachute(gs.spriteParts.pos[num]) // TODO(M2) stub

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
      this.die(NORMAL_DEATH, num, 1, -1, this.skeleton.pos[12]) // TODO(M2) stub
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
  // TODO(M2): Sprite[i].TertiaryWeapon := Guns[FRAGGRENADE];
  spr.tertiaryWeapon = emptyGun()
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

  // TODO(M2): Sprite[i].Weapon := Guns[NOWEAPON];
  spr.weapon = emptyGun()

  // TODO(M2): SecWep := Player.SecWep + 1; if in [1..SECONDARY_WEAPONS] and
  //   WeaponActive[PRIMARY_WEAPONS + SecWep] = 1 then SecondaryWeapon := Guns[...]
  //   else SecondaryWeapon := Guns[NOWEAPON] (Sprites.pas:339-344)
  spr.secondaryWeapon = emptyGun()

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

  // TODO(M2): SortPlayers — 프래그 리스트 정렬 (Game.pas), 스코어보드 태스크에서.

  return result
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
 *              RandomizeStart (Things.pas:620-663 — 임시 거처)               *
 **************************************************************************** */

// Things.pas가 M2에서 포팅되면 things.ts로 이동한다. 스폰 선택 로직: 요청 팀의 활성
// 스폰포인트 중 랜덤(±4/±4 지터), 해당 팀 스폰이 없으면(예: DM 맵에서 팀 요청, 또는 그 반대)
// result=false + 전체 활성 스폰포인트로 폴백 — DM(team 0)/CTF(team 1,2) 등 모든 모드가 이
// 한 함수로 커버된다.
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

  // TODO(M2): BoxSkeleton(kit.po, 2.15) / BulletParts(GRAV*2.25) / SparkParts(GRAV/1.4) /
  // FlagSkeleton(flag.po, 4.0) / ParaSkeleton(para.po, 5.0) / StatSkeleton(stat.po, 4.0) /
  // RifleSkeleton10..55(karabin.po, 1.0..5.5) — Things/Bullets/Sparks 포팅 시 (Anims.pas:348-380).
}
