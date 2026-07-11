// Pascal 전역변수 컨테이너 — 원본의 유닛 전역들을 한 곳에 모은다.
// 모듈이 포팅될 때마다 필드가 추가된다 (흩어진 모듈 전역 금지: 서버/클라 시뮬 다중 인스턴스 지원 목적).
//
// 접근 규약 (sprites.ts에서 확립): TSprite 등 "Pascal object" 포팅 클래스는 생성 시 GameState
// 참조(gs)를 받아 보관한다 — 거의 모든 메서드가 전역(Map/SpriteParts/anims/cvar)을 읽으므로
// 매 호출 인자로 넘기는 것보다 필드 보관이 원본의 "암묵적 전역 접근"에 더 가깝고 덜 소란스럽다.
// 자유 함수(createSprite/randomizeStart/teamCollides 등)는 gs(또는 필요한 부분만)를 첫 인자로 받는다.
import { ParticleSystem } from './parts'
import { PolyMap } from './polymap'
import type { TAnimation } from './anims'
import { type TVector2, vector2 } from './vector'
import { TSprite, MAX_SPRITES } from './sprites'
import {
  DEFAULT_CEASEFIRE_TIME,
  MAX_OLDPOS,
  GAMESTYLE_TEAMMATCH,
  GAMESTYLE_CTF,
  GAMESTYLE_INF,
  GAMESTYLE_HTF,
} from './constants'

export interface GameState {
  ticks: number

  // ── Client.pas:230 `MainTickCounter` (server: Server.pas) — 메인 루프 틱 카운터.
  // Sprites.pas HandleSpecialPolyTypes(REGENERATES)가 `MainTickCounter mod 12`로 참조.
  mainTickCounter: number

  // ── Game.pas:38 `SpriteParts: ParticleSystem` — 모든 스프라이트의 본체(무게중심) 파티클.
  // 파라미터(TimeStep=1, Gravity=GRAV, EDamping=0.99)는 Anims.pas LoadAnimObjects 끝부분에서
  // 세팅된다 → sprites.ts loadSpriteObjects().
  spriteParts: ParticleSystem

  // ── Game.pas:39 `GostekSkeleton: ParticleSystem` — gostek.po에서 로드하는 인체 스켈레톤
  // 프로토타입. CreateSprite가 이를 record-copy해서 각 스프라이트의 Skeleton을 만든다.
  gostekSkeleton: ParticleSystem

  // ── Game.pas:114 `Sprite: array[1..MAX_SPRITES] of TSprite` — 1-based, [0]은 더미.
  sprite: TSprite[]

  // ── Game.pas:95 `Map: TPolyMap` — 현재 맵 충돌 지오메트리.
  map: PolyMap

  // ── Game.pas:44-57 애니메이션 전역들(Stand/Run/.../Own 44종) — anims.ts loadAnimObjects()가
  // 돌려주는 camelCase 레지스트리로 대체 (gs.anims.stand === Pascal의 Stand).
  anims: Record<string, TAnimation>

  // ── Game.pas:67 `OldSpritePos: array[1..MAX_SPRITES, 0..MAX_OLDPOS] of TVector2` (Ping Impr).
  // TSprite.ResetSpriteOldPos가 기록.
  oldSpritePos: TVector2[][]

  // ── Game.pas:73-74 survival 라운드 전역.
  survivalEndRound: boolean
  weaponsCleaned: boolean

  // ── Game.pas:76 `CeaseFireTime: Integer = DEFAULT_CEASEFIRE_TIME`.
  ceaseFireTime: number

  // ── Game.pas:85 `StartHealth: Integer = 150` — Sprites.pas가 STARTHEALTH로 참조(Pascal은
  // 대소문자 무관). 리얼리스틱 모드에서 65로 바뀌는 값이라 상수가 아니라 상태.
  startHealth: number

  // ── Sprites.pas:229 `SpriteMapColCount: Integer` (유닛 전역; TSprite.Update(Task 11)가 사용).
  spriteMapColCount: number

  // ── Sprites.pas:231 `wasReloading: Boolean = False` ({$IFNDEF SERVER} 유닛 전역;
  // BodyApplyAnimation이 사용).
  wasReloading: boolean

  // ── Game.pas:78 `MapChangeCounter: Integer` — 맵 전환 카운트다운 (전환 중 > 0; 평시엔
  // Server.pas가 -60으로 리셋). Control.pas:301-302가 조작 잠금에 사용. 전역 zero-init = 0.
  mapChangeCounter: number

  // ── Control.pas:25-34 {$IFNDEF SERVER} 유닛 전역 — 로컬 플레이어(MySprite)의 "직전 틱 키
  // 상태"로, 동시 키 입력 해석(좌+우 방향 결정, nade/change/throw/reload 충돌 해소)에 쓰인다.
  // 이 포트는 권위 로컬 심이라 인간 스프라이트가 곧 로컬 플레이어 — controlSprite가 HUMAN
  // 스프라이트에 대해 이 블록을 채택한다 (control.ts 헤더 참조). 원본 스코프는 유닛 전역이지만
  // 모듈 전역 금지 규약(파일 헤더)에 따라 GameState로 승격.
  // ⚠ 인간 스프라이트가 동시에 2명 이상이면 원본(단일 로컬 플레이어)에는 없던 상태 공유가 생긴다.
  // (FreeCamPressed는 미채택 — 클라 관전 카메라 블록(Control.pas:213-255) 전용.)
  wasRunningLeft: boolean
  wasJumping: boolean
  wasThrowingGrenade: boolean
  wasChangingWeapon: boolean
  wasThrowingWeapon: boolean
  wasReloadingWeapon: boolean

  // ── Client.pas:230 `Grav: Single = 0.06` (= cvar sv_gravity 기본값 0.06, Cvar.pas:985).
  grav: number

  // ── Net.pas:841 `NoClientUpdateTime: array[1..MAX_PLAYERS] of Integer` — 클라 무응답 틱
  // 카운터 (서버가 ServerLoop.pas:207에서 증가, 클라 패킷 수신 시 0 리셋). Sprites.pas:490/1138이
  // ControlSprite 호출·제트 회복의 게이트로 참조. 네트워크 없는 로컬 심에선 항상 0
  // (< CLIENTSTOPMOVE_RETRYS)이라 게이트가 항상 통과한다. 1-based, [0]은 더미.
  noClientUpdateTime: number[]

  // ── Net.pas:840 `ServerTickCounter: Integer` — AppOnIdle(ServerLoop.pas:45)이 틱마다 증가.
  serverTickCounter: number

  // ── Game.pas:91 `SinusCounter: Single = 0` — 점멸 효과용 사인 카운터. ServerLoop.pas:484가
  // ILUMINATESPEED씩 증가시키고, TSprite.Update(Sprites.pas:1149)가 CeaseFire 알파 점멸에 사용.
  sinusCounter: number

  // ── Game.pas:36 `BulletTimeTimer: Integer` (zero-init 0) — 불릿타임 잔여 틱.
  // ServerLoop UpdateFrame:363-370이 감소/해제 (ToggleBulletTime은 TODO(M2)).
  bulletTimeTimer: number

  // ── Server.pas:264 `WaveRespawnTime, WaveRespawnCounter: Integer` — 웨이브 리스폰 주기/카운터
  // (ServerLoop.pas:487-489). WaveRespawnTime 계산(ServerHelper.pas:236-241, 인원수 비례)은
  // TODO(M2) — 지금은 zero-init 그대로.
  waveRespawnTime: number
  waveRespawnCounter: number

  // ── Cvar.pas 서버 cvar들 (기본값 그대로; 원본 이름 주석).
  svSurvivalmode: boolean // sv_survivalmode = False (Cvar.pas:975)
  svSurvivalmodeClearweapons: boolean // sv_survivalmode_clearweapons = False (Cvar.pas:977)
  svRealisticmode: boolean // sv_realisticmode = False (Cvar.pas:978)
  svAdvancemode: boolean // sv_advancemode = False (Cvar.pas:979)
  svGamemode: number // sv_gamemode = 3 (CTF) (Cvar.pas:966)
  svMaxgrenades: number // sv_maxgrenades = 2 (Cvar.pas:969)
}

export function createGameState(): GameState {
  const gs: GameState = {
    ticks: 0,
    mainTickCounter: 0,
    spriteParts: new ParticleSystem(),
    gostekSkeleton: new ParticleSystem(),
    sprite: [],
    map: new PolyMap(),
    anims: {},
    oldSpritePos: Array.from({ length: MAX_SPRITES + 1 }, () =>
      Array.from({ length: MAX_OLDPOS + 1 }, () => vector2(0, 0)),
    ),
    survivalEndRound: false,
    weaponsCleaned: false,
    ceaseFireTime: DEFAULT_CEASEFIRE_TIME,
    startHealth: 150,
    spriteMapColCount: 0,
    wasReloading: false,
    mapChangeCounter: 0,
    wasRunningLeft: false,
    wasJumping: false,
    wasThrowingGrenade: false,
    wasChangingWeapon: false,
    wasThrowingWeapon: false,
    wasReloadingWeapon: false,
    noClientUpdateTime: new Array(MAX_SPRITES + 1).fill(0),
    serverTickCounter: 0,
    sinusCounter: 0,
    bulletTimeTimer: 0,
    waveRespawnTime: 0,
    waveRespawnCounter: 0,
    grav: 0.06,
    svSurvivalmode: false,
    svSurvivalmodeClearweapons: false,
    svRealisticmode: false,
    svAdvancemode: false,
    svGamemode: 3,
    svMaxgrenades: 2,
  }
  // Pascal의 Sprite 배열은 항상 존재하는 레코드들(Active 플래그로 사용 여부 표시) — 여기서도
  // MAX_SPRITES개를 미리 만들어 둔다. [0]은 1-based 더미.
  gs.sprite = Array.from({ length: MAX_SPRITES + 1 }, (_, i) => new TSprite(gs, i))
  return gs
}

// Game.pas:502-509 IsTeamGame — sv_gamemode가 팀전 계열(TM/CTF/INF/HTF)인지.
export function isTeamGame(gs: GameState): boolean {
  switch (gs.svGamemode) {
    case GAMESTYLE_TEAMMATCH:
    case GAMESTYLE_CTF:
    case GAMESTYLE_INF:
    case GAMESTYLE_HTF:
      return true
    default:
      return false
  }
}
