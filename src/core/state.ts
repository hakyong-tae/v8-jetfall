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
import { DEFAULT_CEASEFIRE_TIME, MAX_OLDPOS } from './constants'

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

  // ── Client.pas:230 `Grav: Single = 0.06` (= cvar sv_gravity 기본값 0.06, Cvar.pas:985).
  grav: number

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
