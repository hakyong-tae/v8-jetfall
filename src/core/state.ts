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
import { TSprite, MAX_SPRITES, MAX_BULLETS, MAX_SPARKS, MAX_THINGS } from './sprites'
import { MAIN_WEAPONS } from './weapons'
import { TSpark } from './sparks'
import { TBullet } from './bullets'
import { TThing } from './things'
import {
  DEFAULT_CEASEFIRE_TIME,
  MAX_OLDPOS,
  GAMESTYLE_TEAMMATCH,
  GAMESTYLE_CTF,
  GAMESTYLE_INF,
  GAMESTYLE_HTF,
} from './constants'

// ── PLACEHOLDER TYPES (M2 Task 2) ───────────────────────────────────────────
// Waypoints.pas isn't ported yet (Task 11 creates waypoints.ts). This minimal stand-in exists only
// so the field below can be typed now. Task 11 DELETES this stub and replaces the import with the
// real type — same field name in GameState, so no call-site changes are needed elsewhere.
// (TBullet은 Task 4에서 bullets.ts의, TThing은 Task 5에서 things.ts의 실제 클래스로 교체 완료 —
// 위 import 참조.)
// TODO(T11): delete — waypoints.ts will export the real TWaypoints (Waypoints.pas:31-34 object:
// `Waypoint: array[1..MAX_WAYPOINTS] of TWaypoint` + `FindClosest` method).
export interface TWaypoints {
  waypoint: unknown[]
}

// Game.pas:22-27 `TKillSort` — SortPlayers 정렬 슬롯. 원본 record는 Color: LongWord 필드를 갖지만
// 그것은 {$IFNDEF SERVER} SortedTeamScore(스코어보드 색)에서만 쓰이는 클라 전용 값이라 이
// 서버-권위 포트에선 생략한다 (SortedPlayers는 Kills/Deaths/Flags/PlayerNum만 채운다).
export interface TKillSort {
  kills: number
  deaths: number
  flags: number
  playerNum: number
}

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
  // Server.pas가 -60으로 리셋). Control.pas:301-302가 조작 잠금에 사용. Pascal 선언 자체는
  // zero-init이지만, 서버 시작 루틴(Server.pas:1203/718)이 첫 틱 전에 항상 -60으로 세팅하므로
  // (이 심은 "서버가 이미 기동된" 상태를 표현) 초기값은 -60을 채택한다 (M2 Task 2 수정 —
  // game.test.ts가 이미 -60을 정상 상태로 간주해 수동 설정하던 것과 일치).
  mapChangeCounter: number

  // ── Game.pas:83 `TimeLimitCounter: Integer = 3600` — 맵 남은 시간(틱). ServerLoop.pas:496-518이
  // 감소/NextMap 트리거 (TODO(M2 후속) — 맵 로테이션은 game.ts 미포팅 구간).
  timeLimitCounter: number

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

  // ── Game.pas:36 `BulletTimeTimer: Integer` — 불릿타임 잔여 틱. Pascal 선언은 zero-init이지만
  // ServerLoop.pas:363-371(> -1이면 감소 → 0 도달 시 -1로 고정)의 안정 상태(불릿타임 비활성)는
  // -1이므로 초기값은 -1을 채택한다 (0에서 시작해도 첫 틱에 -1로 수렴하므로 동작은 동일 — M2
  // Task 2 수정, "정상 상태"를 만드는 것이 목적). ServerLoop UpdateFrame:363-370이 감소/해제
  // (ToggleBulletTime은 TODO(M2)).
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

  // ── M2 Task 2 추가분 (Cvar.pas 확인값 — 계획서 초안의 svKilllimit=30은 오기, 실측 10 채택).
  svKilllimit: number // sv_killlimit, Value=10 (Cvar.pas:989)
  svTimelimit: number // sv_timelimit, Value=36000 (Cvar.pas:968)
  svFriendlyfire: boolean // sv_friendlyfire, Value=False (Cvar.pas:967)
  svBonusFrequency: number // sv_bonus_frequency, Value=0 (Cvar.pas:868)
  botsDifficulty: number // bots_difficulty, Value=100 (Cvar.pas:945; 300=stupid..10=impossible)
  // sv_stationaryguns (Cvar.pas:875): `TBooleanCvar.Add(..., Value=False, DefaultValue=True, ...)`
  // — Value(실제 초기 동작)과 DefaultValue(리셋용)가 원본 자체에서 어긋난다. "고치지 말고 보존"
  // 규약대로 실제 초기 동작인 Value=False를 채택한다.
  svStationaryguns: boolean

  // ── M2 Task 5 추가분 (Things.pas CreateThing이 읽는 cvar들 — "발견 시 추가" 규약).
  svGunsCollide: boolean // sv_guns_collide, Value=False (Cvar.pas:973)
  svKitsCollide: boolean // sv_kits_collide, Value=False (Cvar.pas:974)
  // sv_respawntime (Cvar.pas:828/851 — 서버/클라 등록 코드 양쪽 모두 Value=360). 메디킷
  // TimeOut(= sv_respawntime * GUNRESISTTIME, Things.pas:349)과 리스폰 카운터가 읽는다.
  svRespawntime: number

  // ── M2 Task 9 추가분 (Things.pas CheckSpriteCollision이 읽는 cvar — "발견 시 추가" 규약).
  // sv_healthcooldown (Cvar.pas:913, Value=2) — 0보다 크면 메디킷 픽업 시 HasPack 마크
  // (Things.pas:1978-1980). 주기 해제(ServerLoop.pas:424-428)는 T10 틱오더.
  svHealthcooldown: number

  // ── Game.pas:115 `Bullet: array[1..MAX_BULLETS] of TBullet` — 탄환 슬롯, 1-based
  // ([0]은 더미). bullets.ts(Task 4)의 실제 TBullet — sprite 배열과 동일하게 MAX_BULLETS+1개를
  // createGameState()에서 `new TBullet(gs, i)`로 사전생성한다 (원본은 값 타입 배열이라 항상
  // 전부 존재).
  bullet: TBullet[]

  // ── Game.pas:38 `BulletParts: ParticleSystem` — 탄환 트레일/파편 파티클. 파라미터
  // (TimeStep=1, Gravity=GRAV*2.25, EDamping=0.99)는 Anims.pas LoadAnimObjects:377-380 →
  // state.ts loadThingObjects()가 세팅.
  bulletParts: ParticleSystem

  // ── Game.pas:119 `Thing: array[1..MAX_THINGS] of TThing` — 깃발/키트/무기드롭 슬롯, 1-based.
  // things.ts(Task 5)의 실제 TThing — sprite/bullet 배열과 동일하게 사전생성 (원본은 값 타입
  // 배열이라 항상 전부 존재).
  thing: TThing[]

  // ── Game.pas:117 `Spark: array[1..MAX_SPARKS] of TSpark` — 원본은 `{$IFNDEF SERVER}`
  // (서버엔 스파크가 없다) 이지만, 공통 포팅 규약 12에 따라 이 포트는 core에 채택한다(스파크가
  // 게임플레이에 역류하는 경로가 없음을 확인했으므로). TSpark는 sparks.ts(Task 3)가 이관한 실제
  // 클래스, 1-based (gs.sprite와 동일 패턴 — createGameState()에서 `new TSpark(i)`로 사전생성).
  spark: TSpark[]

  // ── Sparks.pas:26 `SparksCount: Integer` (유닛 전역) — "현재 활성 스파크 개수". 클라
  // UpdateFrame.pas:76-82가 매 프레임 0으로 리셋 후 활성 스파크 update마다 +1 한다 — 그 배선은
  // game.ts 틱 오더(Task 10) 몫이라 이 태스크(sparks.ts)는 필드만 선언하고 0으로 둔다.
  // CreateSpark(Sparks.pas:61-66)의 풀 예산 게이트가 이 값을 읽는다 — r_maxsparks(별개의 렌더
  // cvar, 상수 MAX_SPARKS로 고정 — sparks.ts 헤더 참조)와 혼동하지 말 것.
  sparksCount: number

  // ── Game.pas:38 `SparkParts: ParticleSystem` (Gravity=GRAV/1.4, EDamping=0.998, TimeStep=1;
  // Anims.pas:382-385 → loadThingObjects()).
  sparkParts: ParticleSystem

  // ── 씽/불릿이 clone하는 스켈레톤 프로토타입 (Anims.pas LoadAnimObjects:373-400). Things.pas가
  // 스타일별로 이 중 하나를 record-copy해 TThing.skeleton을 만든다 (Task 5). loadThingObjects()가
  // 세팅. 원본 순서·Destroy 유무 그대로 보존(BoxSkeleton만 Destroy 호출, 나머지는 없음 — 원본
  // 자체가 그렇다, "고치지 말고 보존").
  boxSkeleton: ParticleSystem // objects/kit.po, scale 2.15 — 키트/무기드롭류
  flagSkeleton: ParticleSystem // objects/flag.po, scale 4.0
  paraSkeleton: ParticleSystem // objects/para.po, scale 5.0
  statSkeleton: ParticleSystem // objects/stat.po, scale 4.0 — 고정포
  rifleSkeleton10: ParticleSystem // objects/karabin.po, scale 1.0
  rifleSkeleton11: ParticleSystem // scale 1.1
  rifleSkeleton18: ParticleSystem // scale 1.8
  rifleSkeleton22: ParticleSystem // scale 2.2
  rifleSkeleton28: ParticleSystem // scale 2.8
  rifleSkeleton36: ParticleSystem // scale 3.6
  rifleSkeleton37: ParticleSystem // scale 3.7
  rifleSkeleton39: ParticleSystem // scale 3.9
  rifleSkeleton43: ParticleSystem // scale 4.3
  rifleSkeleton50: ParticleSystem // scale 5.0
  rifleSkeleton55: ParticleSystem // scale 5.5

  // ── Game.pas:101 `BotPath: TWaypoints` — 봇 내비게이션 웨이포인트 그래프(단일 인스턴스, 스프라이트당
  // 아님). Task 11(waypoints.ts)이 실제 타입/findClosest를 이관하기 전까지 placeholder. 맵
  // 웨이포인트(mapfile.ts의 TWaypoint[])를 botPath로 복사하는 브리지도 Task 11 몫.
  botPath: TWaypoints

  // ── Game.pas:88 `TeamScore: array[0..5] of Integer` — 인덱스는 TEAM_NONE(0)..TEAM_SPECTATOR(5).
  teamScore: number[]
  // ── Game.pas:89 `TeamFlag: array[0..4] of Integer` — 인덱스는 TEAM_NONE(0)..TEAM_DELTA(4).
  teamFlag: number[]

  // ── 공통 포팅 규약 11: 코스메틱 훅. core는 사운드를 직접 재생하지 않고 이 콜백만 호출한다
  // (기본 no-op). `PlaySound(sfx, pos)` 호출부는 core에서 `gs.playSound(sfx, pos)`로 번역되고,
  // web/sound.ts(T13)가 실제 WebAudio 배선을 담당한다.
  playSound: (sfx: number, pos: TVector2) => void

  // ── M2 Task 6 추가분 (Sprites.pas Kill/Die/HealthHit/ChangeTeam이 읽는 전역 — "발견 시 추가").
  // ServerHelper.pas SortPlayers — 프래그 정렬(콘솔/스코어보드용 표시 순서). Kill/Die 끝에서
  // 호출되지만 게임플레이에 역류하지 않아 훅으로 둔다 (T10이 배선; 미배선이면 no-op).
  sortPlayers?: () => void
  // Server.pas:216 / Client.pas `GOALTICKS: Integer = DEFAULT_GOALTICKS` — 메인 루프 목표 틱레이트.
  // ToggleBulletTime(Game.pas:263-277)이 불릿타임 중 1/3로 낮춘다. 프레임 페이싱 소비는 web 루프.
  goalTicks: number
  svBullettime: boolean // sv_bullettime, Value=False (Cvar.pas:970)
  svRespawntimeMinwave: number // sv_respawntime_minwave, Value=120 (Cvar.pas:852)
  svAdvancemodeAmount: number // sv_advancemode_amount, Value=2 (Cvar.pas:980)
  svInfRedaward: number // sv_inf_redaward, Value=30 (Cvar.pas:829)
  svBalanceteams: boolean // sv_balanceteams, Value=False (Cvar.pas:972)
  svMaxspectators: number // sv_maxspectators, Value=10 (Cvar.pas:880)
  // Game.pas:70-71 survival 전역 (Die의 서바이벌 라운드 종료 판정이 기록).
  aliveNum: number
  teamAliveNum: number[] // array[0..5] of Byte
  // Net.pas:851 `PlayersTeamNum: array[1..4] of Integer` — 팀별 접속 인원 (Game.pas:756/777이
  // 집계). INF 서바이벌 감점식이 읽는다. 집계 배선은 T10 (SortPlayers). 1-based, [0] 더미.
  playersTeamNum: number[]

  // ── Game.pas:98-100/103 SortPlayers 집계 전역들 (T10 배선). PlayersNum=접속 총원(데모 제외),
  // BotsNum=봇 수, SpectatorsNum=관전자 수. SortPlayers가 매 호출 재집계한다.
  playersNum: number
  botsNum: number
  spectatorsNum: number
  // Game.pas:103 `SortedPlayers: array[1..MAX_SPRITES] of TKillSort` — 프래그 정렬 결과(표시
  // 순서). SortPlayers가 Flags>Kills>Deaths 순으로 채운다. 1-based, [0] 더미.
  sortedPlayers: TKillSort[]
  // Game.pas:86 `WeaponSel: array[1..MAX_SPRITES, 1..MAIN_WEAPONS] of Byte` — 플레이어별 무기
  // 선택 허용 비트. Die의 advance-mode 블록이 조작, Respawn(T7)이 읽는다. 1-based, [0] 더미행.
  // 초기값 1 채택 (M2 Task 7 수정): 서버 기동 시 `WeaponSel[j][i] := WeaponActive[i]`(=1,
  // Server.pas:1100-1102)이고, 비-advancemode 정상 상태에선 ServerLoop.pas:533-536이 매 틱
  // 전부 1로 유지한다 — mapChangeCounter=-60과 같은 "기동 완료 상태" 초기값 규약.
  weaponSel: number[][]
  // Server.pas:233 `WeaponActive: array[-1..15] of Byte` — 서버 무기 허용 목록. 이 포트는
  // 1..MAIN_WEAPONS만 쓰며(음수/0/15 인덱스는 서버 콘솔 명령 전용) 기본 전부 허용(=1).
  // 단 [0]은 Pascal 전역 zero-init 그대로 0 — Respawn 봇 무기 랜덤 루프(Sprites.pas:3668)가
  // `WeaponActive[Weapon.Num]`을 Num으로 직접 인덱싱하는데 COLT_NUM=0이라 [0]=0이어야
  // "COLT는 프라이머리로 채택 불가" 원본 동작이 보존된다 (M2 Task 7 수정).
  weaponActive: number[]

  // ── Server.pas:266 `WeaponsInGame: Integer` — 활성(WeaponActive=1) 프라이머리+세컨더리 수.
  // Server.pas:755-758/1093-1097이 (재)집계: for j := 1 to MAIN_WEAPONS. 기본 전부 활성이라
  // 정상 상태 초기값 = MAIN_WEAPONS(14) 채택 (mapChangeCounter=-60과 같은 "기동 완료 상태" 규약).
  // Respawn(Sprites.pas:3673/3715)의 미니건 배정·맨손 폴백이 읽는다.
  weaponsInGame: number

  // ── Client.pas:270 `HitSprayCounter: Word` — 로컬 플레이어의 bink 누적치(피격 스프레이 +
  // 발사 자기-bink). Fire(Sprites.pas:4010-4018/4529-4546)가 부정확도 가산·누적에 사용,
  // 클라 UpdateFrame.pas:202-203이 매 틱 1 감소. 원본 {$IFNDEF SERVER} 단일 전역(MySprite
  // 전용)이지만 이 포트는 발사 느낌의 게임플레이 성분이라 채택 — 모든 인간 스프라이트가
  // 로컬이므로 HUMAN 게이트로 번역한다 (control.ts 헤더 예외 2와 동일 논리).
  // ⚠ 인간이 동시에 2명 이상이면 원본에 없던 상태 공유가 생긴다 (gs.was*와 동일한 주의).
  hitSprayCounter: number
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
    mapChangeCounter: -60,
    timeLimitCounter: 3600,
    wasRunningLeft: false,
    wasJumping: false,
    wasThrowingGrenade: false,
    wasChangingWeapon: false,
    wasThrowingWeapon: false,
    wasReloadingWeapon: false,
    noClientUpdateTime: new Array(MAX_SPRITES + 1).fill(0),
    serverTickCounter: 0,
    sinusCounter: 0,
    bulletTimeTimer: -1,
    waveRespawnTime: 0,
    waveRespawnCounter: 0,
    grav: 0.06,
    svSurvivalmode: false,
    svSurvivalmodeClearweapons: false,
    svRealisticmode: false,
    svAdvancemode: false,
    svGamemode: 3,
    svMaxgrenades: 2,
    svKilllimit: 10,
    svTimelimit: 36000,
    svFriendlyfire: false,
    svBonusFrequency: 0,
    botsDifficulty: 100,
    svStationaryguns: false,
    svGunsCollide: false,
    svKitsCollide: false,
    svRespawntime: 360,
    svHealthcooldown: 2,
    bullet: [],
    bulletParts: new ParticleSystem(),
    thing: [],
    spark: [],
    sparksCount: 0,
    sparkParts: new ParticleSystem(),
    boxSkeleton: new ParticleSystem(),
    flagSkeleton: new ParticleSystem(),
    paraSkeleton: new ParticleSystem(),
    statSkeleton: new ParticleSystem(),
    rifleSkeleton10: new ParticleSystem(),
    rifleSkeleton11: new ParticleSystem(),
    rifleSkeleton18: new ParticleSystem(),
    rifleSkeleton22: new ParticleSystem(),
    rifleSkeleton28: new ParticleSystem(),
    rifleSkeleton36: new ParticleSystem(),
    rifleSkeleton37: new ParticleSystem(),
    rifleSkeleton39: new ParticleSystem(),
    rifleSkeleton43: new ParticleSystem(),
    rifleSkeleton50: new ParticleSystem(),
    rifleSkeleton55: new ParticleSystem(),
    botPath: { waypoint: [] },
    teamScore: new Array(6).fill(0),
    teamFlag: new Array(5).fill(0),
    playSound: () => {},
    goalTicks: 60, // DEFAULT_GOALTICKS (constants.ts:22)
    svBullettime: false,
    svRespawntimeMinwave: 120,
    svAdvancemodeAmount: 2,
    svInfRedaward: 30,
    svBalanceteams: false,
    svMaxspectators: 10,
    aliveNum: 0,
    teamAliveNum: new Array(6).fill(0),
    playersTeamNum: new Array(5).fill(0),
    playersNum: 0,
    botsNum: 0,
    spectatorsNum: 0,
    sortedPlayers: Array.from({ length: MAX_SPRITES + 1 }, () => ({
      kills: 0,
      deaths: 0,
      flags: 0,
      playerNum: 0,
    })),
    weaponSel: Array.from({ length: MAX_SPRITES + 1 }, () =>
      new Array(MAIN_WEAPONS + 1).fill(1),
    ),
    weaponActive: new Array(MAIN_WEAPONS + 1).fill(1),
    weaponsInGame: MAIN_WEAPONS,
    hitSprayCounter: 0,
  }
  gs.weaponActive[0] = 0 // Pascal 전역 zero-init — COLT_NUM=0 인덱싱 보존 (필드 주석 참조)
  // Pascal의 Sprite 배열은 항상 존재하는 레코드들(Active 플래그로 사용 여부 표시) — 여기서도
  // MAX_SPRITES개를 미리 만들어 둔다. [0]은 1-based 더미.
  gs.sprite = Array.from({ length: MAX_SPRITES + 1 }, (_, i) => new TSprite(gs, i))
  // Bullet/Thing/Spark도 Pascal에서는 값 타입 배열이라 항상 전부 존재한다 — TBullet(Task 4)/
  // TThing(Task 5)/TSpark(Task 3) 전부 gs.sprite와 동일하게 사전생성한다.
  gs.bullet = Array.from({ length: MAX_BULLETS + 1 }, (_, i) => new TBullet(gs, i))
  gs.thing = Array.from({ length: MAX_THINGS + 1 }, (_, i) => new TThing(gs, i))
  gs.spark = Array.from({ length: MAX_SPARKS + 1 }, (_, i) => new TSpark(i))
  return gs
}

// Anims.pas LoadAnimObjects:371-400 — BulletParts/SparkParts 파라미터 + BoxSkeleton과 씽/불릿이
// clone하는 스켈레톤 프로토타입(Flag/Para/Stat/Rifle10..55) 로드. sprites.ts의
// loadSpriteObjects()(SpriteParts/GostekSkeleton 담당)와 짝을 이루는 나머지 절반이다.
// `read`는 loadSpriteObjects/loadAnimObjects와 동일한 주입식 파일 리더 (core는 IO-free).
//
// 원본 순서·Destroy 유무를 그대로 보존한다: BoxSkeleton/BulletParts/SparkParts만 Destroy를
// 호출하고, Flag/Para/Stat/Rifle10..55는 Destroy 없이 바로 LoadPOObject한다 — 원본
// Anims.pas 자체가 이렇다("고치지 말고 보존" 규약).
export function loadThingObjects(gs: GameState, read: (name: string) => string[]): void {
  gs.boxSkeleton.destroy()
  gs.boxSkeleton.loadPOObject(read('objects/kit.po'), 2.15)
  gs.boxSkeleton.timeStep = 1

  gs.bulletParts.destroy()
  gs.bulletParts.timeStep = 1
  gs.bulletParts.gravity = gs.grav * 2.25
  gs.bulletParts.eDamping = 0.99

  gs.sparkParts.destroy()
  gs.sparkParts.timeStep = 1
  gs.sparkParts.gravity = gs.grav / 1.4
  gs.sparkParts.eDamping = 0.998

  gs.flagSkeleton.loadPOObject(read('objects/flag.po'), 4.0)
  gs.paraSkeleton.loadPOObject(read('objects/para.po'), 5.0)
  gs.statSkeleton.loadPOObject(read('objects/stat.po'), 4.0)
  gs.rifleSkeleton10.loadPOObject(read('objects/karabin.po'), 1.0)
  gs.rifleSkeleton11.loadPOObject(read('objects/karabin.po'), 1.1)
  gs.rifleSkeleton18.loadPOObject(read('objects/karabin.po'), 1.8)
  gs.rifleSkeleton22.loadPOObject(read('objects/karabin.po'), 2.2)
  gs.rifleSkeleton28.loadPOObject(read('objects/karabin.po'), 2.8)
  gs.rifleSkeleton36.loadPOObject(read('objects/karabin.po'), 3.6)
  gs.rifleSkeleton37.loadPOObject(read('objects/karabin.po'), 3.7)
  gs.rifleSkeleton39.loadPOObject(read('objects/karabin.po'), 3.9)
  gs.rifleSkeleton43.loadPOObject(read('objects/karabin.po'), 4.3)
  gs.rifleSkeleton50.loadPOObject(read('objects/karabin.po'), 5.0)
  gs.rifleSkeleton55.loadPOObject(read('objects/karabin.po'), 5.5)
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
