# M2: 전투 + 봇 = 싱글 완성 구현 계획

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 무기 14종 + 탄환 + 씽(깃발/키트/무기드롭) + 스파크 + DM/CTF 룰 + AI 봇을 포팅해, 봇 상대 DM/CTF 한 판이 브라우저에서 온전히 돌아가는 싱글 빌드 (스펙 M2 완료 기준).

**Architecture:** M1과 동일 — `soldat-ref/soldat/shared/`의 Pascal을 파일 1:1로 `src/core/`에 번역. M2부터 이 포트는 **권위 로컬 심(서버+클라 겸용)**으로 동작한다: `{$IFDEF SERVER}` 분기가 게임플레이의 진실이고, 클라 전용 분기는 렌더/사운드/네트예측이다 (규약 8~10). 렌더는 기존 PixiJS 레이어(`src/web/`)에 탄환/씽/HUD를 추가만 한다.

**Tech Stack:** M1과 동일 (Vite + TypeScript + PixiJS v8 + Vitest). 신규 의존성 없음.

**선행 조건:** M1 전체 완료 (T10 control.ts, T11 Update/틱 루프, T12 web 렌더러 포함). M2 태스크는 `sprites.ts`의 `TODO(M2)` 스텁과 `control.ts`의 `ControlBot` 호출 자리(Control.pas:296)가 존재함을 전제한다.

**원본 소스 위치:** `/Users/hytae/Downloads/soldat-ref/soldat/` (shared/, server/, client/)
**에셋/설정 원본:** `/Users/hytae/Downloads/soldat-ref/base/` (server/configs/weapons*.ini, server/configs/bots/*.bot, shared/weapons-gfx/, shared/interface-gfx/)

---

## 공통 포팅 규약 (M1 규약 1~7 승계 + M2 추가 — 위반은 버그)

M1 계획서(`2026-07-11-m1-movement-physics.md`)의 규약 1~7 (파일 1:1, 1-based 배열, record 깊은복사, pascal.ts 유틸, f64, IFDEF 주석, Vector.pas 예외)을 그대로 적용. 추가:

8. **`{$IFDEF SERVER}` 3분류** — 이 심이 곧 권위 서버이므로:
   - **(a) 채택**: 게임플레이 로직 (픽업 판정 `CheckSpriteCollision`, 스코어링, 무기드롭 물리, `ServerCreateBullet` 경로, Respawn 규칙). SERVER 분기가 진실.
   - **(b) TODO(M3) 스텁**: 네트 전송류 (`ServerBulletSnapshot`, `ServerThingTaken`, `ServerFlagInfo`, `ClientSendBullet`, `ServerSendStringMessage`). 호출 위치에 `// TODO(M3) NET: <원본 호출>` 주석만.
   - **(c) 웹 레이어로**: 사운드(`PlaySound`)·카메라(셰이크/트래킹)·HUD 통계(`WepStats`). core에서는 규약 11의 훅으로 치환.
   - `Trace(...)` 디버그 로그는 전부 생략 (주석도 불요).
9. **클라 전용 초기화 버그 수정**: `DegradeCount/TimeOutPrev/HitMultiplyPrev` 등이 원본에서 `{$IFNDEF SERVER}`에서만 초기화되지만 공용 코드가 읽는다 (Bullets.pas:165-171 원본 자체에 `// TODO: Check if this should be used also in server` 주석). **무조건 초기화한다** — 안 하면 거리 감쇠(§T4)가 통째로 죽는다.
10. **`srv * damage` 패턴 제거**: 클라 빌드에서 `srv=0`으로 대미지를 0 곱해 무효화하는 관용구 (Bullets.pas:1385-1405, 2368-2370). 서버 수식(=srv 인자 없음)을 채택한다.
11. **코스메틱 훅**: `GameState`에 `playSound: (sfxId: number, pos: TVector2) => void` (기본 no-op) 필드 추가. core의 `PlaySound` 호출부는 `gs.playSound(...)`로 번역. 카메라 셰이크(`CameraX/Y` 변조, Sparks.pas:120-133)는 core에서 **생략**하고 원본 라인 주석만 남긴다 (web에서 M4 폴리시).
12. **sparks는 core에 채택 (의도적 이탈)**: 원본은 `Spark[]` 배열 자체가 `{$IFNDEF SERVER}` (Game.pas:117) — 서버엔 스파크가 없다. 이 포트는 스펙 4.1대로 `core/sparks.ts`에 두되, **스파크가 게임플레이에 역류하는 경로는 전무**함을 확인했으므로(사후 검증 완료) 게임플레이 코드의 `{$IFNDEF SERVER} CreateSpark(...)` 호출도 함께 채택한다.
13. **게임플레이가 갈리는 IFDEF는 SERVER 값**: 확인된 사례 — FLAME 재점화 임계 (Bullets.pas:1769-1772, 서버 `TimeOut<3 && RicochetCount<2` 채택), 체인 CreateBullet의 `MustCreate` (1783, 서버 `False`), 낙하산 슬롯 스캔 시작점 (Things.pas:95-99, 서버=1번부터).
14. **전역은 전부 `GameState`에** (M1 state.ts 규약 승계). M2에서 추가되는 전역은 T2 목록이 명세.

## 파일 구조 (M2 산출물)

```
soldat-web/
├── tools/build-assets.mjs        ← 확장: weapons.json/bots.json + weapons-gfx/interface-gfx 변환
├── public/assets/                ← (생성물) + weapons.json, bots.json, weapons/, interface/
├── src/
│   ├── core/
│   │   ├── weapons.ts            ← Weapons.pas (TGun 이관 + Guns[] + BuildWeapons + ini 오버라이드)
│   │   ├── bullets.ts            ← mechanics/Bullets.pas
│   │   ├── things.ts             ← mechanics/Things.pas
│   │   ├── sparks.ts             ← mechanics/Sparks.pas
│   │   ├── waypoints.ts          ← Waypoints.pas
│   │   ├── ai.ts                 ← AI.pas
│   │   ├── game.ts               ← (M1 스텁 확장) ServerLoop.pas UpdateFrame 틱오더 + Game.pas DM/CTF
│   │   ├── sprites.ts            ← (수정) TODO(M2) 스텁 전부 구현
│   │   └── state.ts              ← (수정) M2 전역 추가
│   ├── web/
│   │   ├── bulletsrender.ts      ← 탄환/씽 렌더 (client/GameRendering 참조)
│   │   ├── hud.ts                ← 체력/제트/탄약/킬 HUD (client/InterfaceGraphics.pas 참조)
│   │   ├── sound.ts              ← WebAudio: gs.playSound 배선 (기초)
│   │   └── gostek.ts             ← (수정) 손에 든 무기 파츠
│   └── tests/                    ← weapons/bullets/things/sparks/ai/game .test.ts 추가
```

---

### Task 0: 에셋 파이프라인 확장 (weapons.json / bots.json / 전투 그래픽)

**Files:** Modify: `tools/build-assets.mjs`

- [ ] **Step 1: ini→JSON 변환 추가** — 파서는 단순 `[Section]` + `Key=Value` (TMemIniFile 대응, `;` 주석 무시):
  - `base/server/configs/weapons.ini` + `weapons_realistic.ini` → `public/assets/weapons.json`. 키 17종+NoCollision은 SharedConfig.pas:258-274의 `ReadWMConf` 목록이 명세 (**ini의 `Damage` = TGun의 `HitMultiply`**, 섹션명은 `IniName` — Barrett은 원본 오타 그대로 `Barret M82A1`). 스키마:

```json
{
  "normal": {
    "info": { "name": "Default WM", "version": "1.7.1" },
    "guns": {
      "Desert Eagles": { "Damage": 1.81, "FireInterval": 24, "Ammo": 7, "ReloadTime": 87,
        "Speed": 19, "BulletStyle": 1, "StartUpTime": 0, "Bink": 0, "MovementAcc": 0.009,
        "BulletSpread": 0.15, "Recoil": 0, "Push": 0.0176, "InheritedVelocity": 0.5,
        "ModifierHead": 1.1, "ModifierChest": 0.95, "ModifierLegs": 0.85 }
    }
  },
  "realistic": { "...같은 구조": {} }
}
```
  (값은 ini에서 읽은 그대로 — 위 Desert Eagles는 weapons.ini:112-129 실측값이라 검증용으로 활용 가능)
  - `base/server/configs/bots/*.bot` → `public/assets/bots.json`: 파일별 `[BOT]` 섹션 → `{ [botName]: {Name,Favourite_Weapon,Secondary_Weapon,Friend,Accuracy,Shoot_Dead,Grenade_Frequency,Camping,OnStartUse,Chat_*,Color1,Color2,Skin_Color,Hair_Color,Hair,Headgear,Chain} }` (SharedConfig.pas:133-220 `LoadBotConfig`가 읽는 키가 명세).
- [ ] **Step 2: 그래픽 추가** — `base/shared/weapons-gfx/`(총기 스프라이트), `base/shared/interface-gfx/`(HUD: 하트/제트/탄약 바)를 기존 `convertDir`로 변환, manifest `sprites`에 `weapons/`, `interface/` prefix로 등록.
- [ ] **Step 3: 실행 확인** — `npm run assets` → weapons.json에 normal 20무기+realistic 20무기, bots.json에 봇 다수(원본 폴더 파일 수와 일치), weapons/interface PNG 생성.
- [ ] **Step 4: Commit** — `git add tools/ && git commit -m "feat(tools): weapons.ini/bots→JSON + combat gfx in asset pipeline"`

### Task 1: core/weapons.ts (Weapons.pas 1518줄 전체)

**Files:** Create: `src/core/weapons.ts`, `src/tests/weapons.test.ts` · Modify: `src/core/sprites.ts`(TGun 이관) · 원본: `shared/Weapons.pas`, `shared/SharedConfig.pas:222-291`

- [ ] **Step 1: 실패 테스트** (수치는 원본 하드코딩 값/수식 손계산):

```ts
// src/tests/weapons.test.ts
import { describe, it, expect, beforeAll } from 'vitest'
import { createWeapons, guns, defaultGuns, EAGLE, M79, FRAGGRENADE, KNIFE,
  calculateBink, weaponNumToIndex, createWMChecksum, loadWeaponsConfig } from '../core/weapons'
import { GRENADE_TIMEOUT, BULLET_TIMEOUT, MELEE_TIMEOUT } from '../core/constants'

describe('weapons', () => {
  beforeAll(() => createWeapons(false))
  it('Desert Eagle 기본값 (CreateNormalWeapons Weapons.pas:496-513)', () => {
    expect(guns[EAGLE].hitMultiply).toBeCloseTo(1.81)
    expect(guns[EAGLE].fireInterval).toBe(24)
    expect(guns[EAGLE].ammo).toBe(7)
    expect(guns[EAGLE].reloadTime).toBe(87)
    expect(guns[EAGLE].speed).toBeCloseTo(19)
  })
  it('BuildWeapons 파생값 (Weapons.pas:1262-1355)', () => {
    // ClipReload 무기: ClipOutTime=Trunc(87*0.8)=69, ClipInTime=Trunc(87*0.3)=26
    expect(guns[EAGLE].clipOutTime).toBe(69)   // CreateWeaponsBase에서 EAGLE.clipReload 확인
    expect(guns[EAGLE].clipInTime).toBe(26)
    expect(guns[M79].ammoCount).toBe(0)        // 1354: M79는 빈 탄창으로 시작
    expect(guns[EAGLE].timeout).toBe(BULLET_TIMEOUT)      // 420
    expect(guns[FRAGGRENADE].timeout).toBe(GRENADE_TIMEOUT) // 180
    expect(guns[KNIFE].timeout).toBe(MELEE_TIMEOUT)       // 1
  })
  it('calculateBink (Weapons.pas:1512-1516): Acc+Bink-Round(Acc*(Acc/((10*Bink)+Acc)))', () => {
    expect(calculateBink(0, 60)).toBe(60)
    expect(calculateBink(60, 60)).toBe(115) // 120 - pascalRound(60*60/660=5.4545)=5
  })
  it('weapons.json(normal) 오버라이드 = 기본값과 체크섬 동일 (출하 ini는 기본값 미러)', () => {
    const before = createWMChecksum()
    loadWeaponsConfig(normalJson) // 테스트 픽스처: public/assets/weapons.json에서 로드
    expect(createWMChecksum()).toBe(before)
  })
})
```

- [ ] **Step 2: 구현** — 번역 범위와 순서:
  - TGun record(14-53) + 상수 전부(56-136: EAGLE=1..THROWNKNIFE=23, `*_NUM`(주의: COLT_NUM=0, NOWEAPON_NUM=255 — **배열 인덱스와 Num은 다른 번호 체계**, 89행 원본 주석), PRIMARY/SECONDARY/MAIN/EXTENDED/ORIGINAL/TOTAL_WEAPONS, BULLET_STYLE_*(114-128), WEAPON_NOCOLLISION_*(131-136)).
  - `guns: TGun[]`(1-based, TOTAL_WEAPONS+1) + `defaultGuns` — Pascal 유닛 전역이지만 무기 테이블은 심 인스턴스 간 공유해도 안전한 불변 데이터이므로 예외적으로 모듈 전역 허용 (state.ts 헤더에 예외 사유 주석).
  - `createWeapons(166-170)/createDefaultWeapons(172-208)/createWeaponsBase(210-490)/createNormalWeapons(492-875)/createRealisticWeapons(877-1260)/buildWeapons(1262-1355)` — **20무기 값 블록 생략 금지, 전부 번역**.
  - `createWMChecksum(1359-1390)` — LongWord 오버플로 해시: 각 연산 뒤 `>>> 0`.
  - 헬퍼(1394-1516): `weaponNumToIndex/weaponNameToNum/weaponNumToName/weaponNameByNum/weaponNumInternalToExternal/weaponNumExternalToInternal/isMainWeaponIndex/isSecondaryWeaponIndex/isExtendedWeaponIndex/calculateBink`.
  - `loadWeaponsConfig(json)` ← SharedConfig.pas:222-291: JSON을 받아 `guns[1..ORIGINAL_WEAPONS]`에 키별 오버라이드(누락 키는 기본값 유지) 후 `buildWeapons()`.
- [ ] **Step 3: sprites.ts 재배선** — `TGun`/`emptyGun`을 weapons.ts로 이관하고 sprites.ts는 re-export(기존 import 호환). sprites.ts 헤더의 TGun 스텁 주석 블록(237-242) 제거.
- [ ] **Step 4: PASS + `npx tsc --noEmit` 후 Commit** — `git commit -m "feat(core): port Weapons.pas (14+9 guns, ini overrides, checksum)"`

### Task 2: state.ts M2 전역 확장

**Files:** Modify: `src/core/state.ts` · 원본: `Game.pas:36-119`, `Server.pas`/`Cvar.pas` 해당 cvar

- [ ] **Step 1: GameState 필드 추가** (각 필드에 원본 위치 주석 — M1 스타일):
  - `bullet: TBullet[]` (Game.pas:115, [1..MAX_BULLETS=254]) / `bulletParts: ParticleSystem` (Game.pas:38, 파라미터는 Anims.pas LoadAnimObjects 끝: Gravity=GRAV*2.25, EDamping=0.99 — 원본 확인) / `thing: TThing[]` (Game.pas:119, [1..MAX_THINGS=90]) / `spark: TSpark[]` (Game.pas:117, [1..MAX_SPARKS=558]) / `sparkParts: ParticleSystem` (GRAV/1.4 — 원본 확인)
  - `botPath: TWaypoints` (Game.pas:101) / `teamScore: number[]` (Game.pas:88, [0..5]) / `teamFlag: number[]` (Game.pas:89, [0..4])
  - `mapChangeCounter: number` (초기 -60), `timeLimitCounter`, `waveRespawnCounter/waveRespawnTime`, `bulletTimeTimer: -1` (ServerLoop 전역)
  - cvar: `svKilllimit` (기본 30 — Cvar.pas 확인), `svTimelimit`, `svFriendlyfire: false`, `svBonusFrequency: 0`, `botsDifficulty: 100` (Cvar.pas:945), `svGuns/svStationaryguns` 계열은 발견 시 추가
  - 훅: `playSound: (sfx: number, pos: TVector2) => void = () => {}` (규약 11)
- [ ] **Step 2: 스켈레톤 템플릿** — Things.pas가 클론하는 프로토타입(FlagSkeleton/RifleSkeleton*/BoxSkeleton/ParaSkeleton/StatSkeleton — Anims.pas LoadAnimObjects 끝부분에서 생성, sprites.ts:1723 TODO 주석 참조)을 `loadThingObjects(gs)`로 이 태스크에서 생성. kit.po 등 .po 파일 필요 — M1 파이프라인이 이미 anims/를 복사하므로 파일 존재 확인.
- [ ] **Step 3: 타입체크 PASS 후 Commit** — `git commit -m "feat(core): M2 game state globals (bullets/things/sparks/scores/cvars)"`

### Task 3: core/sparks.ts (Sparks.pas 574줄)

**Files:** Create: `src/core/sparks.ts`, `src/tests/sparks.test.ts` · 원본: `shared/mechanics/Sparks.pas`

- [ ] **Step 1: 실패 테스트**:

```ts
// src/tests/sparks.test.ts — 핵심: 수명 카운트다운 + Euler 물리 + 충돌 바운스
it('createSpark→N틱 후 Kill (Life 카운트다운, Sparks.pas:157-160)', () => {
  const i = createSpark(gs, vector2(0, 0), vector2(1, 0), 1, 0, 5)
  for (let t = 0; t < 5; t++) gs.spark[i].update(gs)
  expect(gs.spark[i].active).toBe(false)
})
it('NONEULER_STYLE(스타일 12)은 이동하지 않음 (Sparks.pas:103-112)', () => { /* pos 불변 확인 */ })
```

- [ ] **Step 2: 구현** — TSpark(8-20), `createSpark`(35-98: **카메라 컬링 게이트 42-57은 생략+주석** — 렌더 최적화이므로; 풀 예산 로직 59-73은 채택, `r_maxsparks`는 상수 MAX_SPARKS로 고정), `update`(101-161: NONEULER_STYLE/COLLIDABLE_STYLE 집합 그대로, 카메라 셰이크 120-133은 규약 11로 생략+주석, 2차 스파크 스폰 136-155 채택), `checkMapCollision`(420-551: SPARK_SURFACECOEF=0.7 바운스 + 스타일별 임계 Kill + `gs.playSound`), `kill`(553-559), `checkOutOfBounds`(561-끝).
- [ ] **Step 3: PASS 후 Commit** — `git commit -m "feat(core): port Sparks.pas gameplay particles"`

### Task 4: core/bullets.ts — 1부: 구조·생성·맵충돌·감쇠

**Files:** Create: `src/core/bullets.ts`, `src/tests/bullets.test.ts` · 원본: `shared/mechanics/Bullets.pas`

- [ ] **Step 1: 실패 테스트** (감쇠는 손계산 — 원본 637-665):

```ts
// src/tests/bullets.test.ts
it('거리 감쇠: 500px 초과 시 ×0.5, 900px 초과 시 ×0.25 (Bullets.pas:637-665)', () => {
  // 빈 맵(폴리곤 0개), 중력 0, 속도 (20,0), 초기 hitMultiply 2.0, EAGLE 탄(=BARRETT/M79/KNIFE/LAW 제외 대상)
  // BULLET_TIMEOUT=420이 6의 배수이므로 timeOut%6===0 ⇔ 틱%6===0
  // 틱30: dist=600>500 → hitMultiply=1.0 · 틱48: dist=960>900 → 0.5
  const i = serverCreateBullet(gs, vector2(0,0), vector2(20,0), guns[EAGLE].num, 1, 255, 2.0)
  run(gs, 30); expect(gs.bullet[i].hitMultiply).toBeCloseTo(1.0)
  run(gs, 18); expect(gs.bullet[i].hitMultiply).toBeCloseTo(0.5)
})
it('FRAGNADE 타임아웃 시 ExplosionHit 경로 (610-635)', () => { /* timeOut 소진 → active false + explosionHit 스파이 */ })
it('createBullet: 슬롯 할당(N=255→빈 슬롯 스캔)과 timeout=guns[idx].timeout', () => {})
```

(빈 맵 헬퍼: `setupTestGame({ emptyMap: true })` — polymap 섹터그리드만 초기화한 폴리곤 0개 맵. 테스트 헬퍼는 `src/tests/helpers.ts`에 추가.)

- [ ] **Step 2: 구현** — 뼈대 (sprites.ts와 동일한 gs-보관 클래스 패턴):

```ts
// src/core/bullets.ts ← mechanics/Bullets.pas
export const HIT_TYPE_WALL = 1 /* ... HIT_TYPE_RICOCHET = 10 (Bullets.pas:59-68) */

export class TBullet {
  active = false
  style = 0; num = 0; owner = 0; ownerWeapon = 0
  timeOutReal = 0; timeOut = 0; timeOutPrev = 0
  hitMultiply = 0; hitMultiplyPrev = 0
  velocityPrev = vector2(0, 0)
  whizzed = false; ownerPingTick = 0; hitBody = 0
  hitSpot = vector2(0, 0); tracking = 0; imageStyle = 0
  initial = vector2(0, 0)                 // 스폰 위치 — 거리 감쇠 기준점 (공용!)
  startUpTime = 0; ricochetCount = 0; degradeCount = 0  // ← 규약 9: 무조건 초기화
  seed = 0
  thingCollisions: TThingCollision[] = [] // 동적 배열 그대로
  spriteCollisions = new Set<number>()    // Set of 1..32
  dontCheat = false                       // {$IFDEF SERVER} 채택
  constructor(private readonly gs: GameState, num: number) { this.num = num }
  update(): void {}                       // 529-737
  kill(): void {}                         // 1060-1071
  checkMapCollision(x: number, y: number): TVector2 {}      // 1073-1359
  checkSpriteCollision(lastHitDist: number): TVector2 {}    // 1361-1900 (T8)
  checkThingCollision(lastHitDist: number): TVector2 {}     // 1902-2004 (T8)
  checkColliderCollision(lastHitDist: number): TVector2 {}  // 2006-2118 (T8)
  hit(t: number, spriteHit = 0, where = 0): void {}         // 2120-2362 (T8)
  explosionHit(typ: number, spriteHit: number, where: number): void {} // 2364-2683 (T8)
  checkOutOfBounds(): void {}             // 2685-2700
  // filterSpritesByDistance/targetableSprite/getComparableSpriteDistance/
  // getSpriteCollisionPoint/getWeaponIndex: 2702-2806 (T8)
}
```

  이 태스크 범위: HIT_TYPE_*(59-68), `createBullet`(94-357: 클라 발사억제 117-128은 규약 8b 주석 처리, **규약 9 — degradeCount/timeOutPrev/hitMultiplyPrev 무조건 초기화**, FLAME 스폰 전진 221-226, WepStats/네트 236-349 스텁), `serverCreateBullet`(359-379 — **M2의 표준 스폰 진입점**), `update`(529-737: 충돌 4단계 호출 순서/dist 스레딩 그대로 — sprite/thing/collider 충돌은 이 태스크에선 스텁 반환, T8에서 구현. FLAME 상승력 724-725 채택), `kill`(1060-1071), `checkMapCollision`(1073-1359: 리코셰 이중 블록 1133-1211/1250-1328 — **중복 그대로 복사, 통합 금지**, FRAGNADE 바운스 0.88 계수, THROWNKNIFE→createThing은 `// TODO(T5)` 스텁), `checkOutOfBounds`(2685-2700), `getWeaponIndex`(2791-2806).
- [ ] **Step 3: PASS 후 Commit** — `git commit -m "feat(core): TBullet structure, spawn, map collision, distance falloff"`

### Task 5: core/things.ts — 1부: 구조·물리

**Files:** Create: `src/core/things.ts`, `src/tests/things.test.ts` · 원본: `shared/mechanics/Things.pas`

- [ ] **Step 1: 실패 테스트**:

```ts
// src/tests/things.test.ts
it('createThing(깃발): 공중 스폰 → N틱 후 지면 안착·StaticType 동결 (Update 665-747)', () => {
  // ctf_Ash 로드, 스폰포인트 위 200px에 OBJECT_ALPHA_FLAG 생성 → 300틱 update
  // → skeleton.pos[1].y 유한값 & 이동 델타 < MINMOVEDELTA로 staticType=true
})
it('같은 스타일 깃발 재생성 시 기존 것 Kill (86-90)', () => {})
```

- [ ] **Step 2: 구현** — 뼈대:

```ts
// src/core/things.ts ← mechanics/Things.pas
export interface TThingCollision { thingNum: number; cooldownEnd: number } // 8-11

export class TThing {
  active = false
  style = 0; num = 0; owner = 0; holdingSprite = 0; ammoCount = 0
  radius = 0; timeOut = 0; staticType = false; interest = 0
  collideWithBullets = false; inBase = false; lastSpawn = 0; team = 0
  skeleton: ParticleSystem              // 스타일별 프로토타입 clone (T2 loadThingObjects)
  collideCount = [0, 0, 0, 0, 0]        // [1..4], [0] 미사용
  polys: TMapPolygon[]                  // [1..2] 깃발 천 렌더용 폴리곤
  bgState = new TBackgroundState()
  // Tex1/Tex2/Texture/Color: {$IFNDEF SERVER} 렌더 상태 — 생략 (web 소관)
  constructor(private readonly gs: GameState, num: number) { this.num = num }
  update(): void {}                     // 665-1033
  checkMapCollision(i: number, x: number, y: number): boolean {} // 1307-1448
  kill(): void {}                       // 1450-1463
  checkOutOfBounds(): void {}           // 1465-1516
  respawn(): void {}                    // 1518-1572
  moveSkeleton(x1: number, y1: number, fromZero: boolean): void {} // 1574-1600
  checkSpriteCollision(): number {}     // 1602-2145 (T9)
  checkStationaryGunCollision(): number {} // 2147-2310 (T9)
}
```

  이 태스크 범위: `createThing`(72-554: 스타일별 case 147-511의 VDamping/Gravity/Radius/TimeOut/Interest 값 전부, 무기드롭 투척 임펄스 517-547 **채택**(규약 8a), 낙하산 슬롯 95-99는 서버 동작(규약 13), `ServerThingMustSnapshot` 스텁), `thingCollision`(556-560), `spawnBoxes`(562-618), `update`(665-1033: 깃발 4점 프로브+FLAG_STAND_FORCEUP 686-727, Verlet 733, StaticType 동결 742-747, 깃발 캐리 750-767 — `sprite[holdingSprite].skeleton.pos[8]`에 부착+`holdedThing` 역링크, InBase 판정 775-798, **터치다운 스코어링 812-938과 CheckSpriteCollision 호출 949-952는 이 태스크에선 TODO(T9) 스텁**, 타임아웃 리스폰 1008-1019), `checkMapCollision`(1307-1448: 깃발 바운스 FIXME 1364-1389 — 고치지 말고 보존), `kill`(1450-1463), `checkOutOfBounds`(1465-1516), `respawn`(1518-1572), `moveSkeleton`(1574-1600). `randomizeStart`(620-663)는 M1에서 sprites.ts에 포팅됨 — things.ts로 **이동**하고 sprites.ts는 re-export.
- [ ] **Step 3: PASS 후 Commit** — `git commit -m "feat(core): TThing structure, physics, flag carry (pickup/scoring stubbed)"`

### Task 6: sprites.ts 전투 1부 — healthHit/die/kill/dropWeapon/applyWeaponByNum/parachute/changeTeam

**Files:** Modify: `src/core/sprites.ts` · Create: 테스트는 `src/tests/sprites.test.ts`에 추가 · 원본: `shared/mechanics/Sprites.pas`

- [ ] **Step 1: 실패 테스트**:

```ts
it('healthHit: 대미지 → health 감소, 0 이하 → die (HealthHit 3250-3376)', () => {
  // startHealth=150에서 healthHit(50,...) → health 100
  // healthHit(4000,...) → deadMeat=true (Vest/리얼리스틱 분기 기대값은 원본 수식으로 계산 —
  //  기대값이 다르면 테스트를 원본 동작에 맞게 수정한다. 원본이 진실.)
})
it('die: DM에서 who≠num이면 sprite[who].player.kills +1 (Die 1552-2318, DM 분기 1648)', () => {})
it('die: 자살(who===num)은 kills 증가 없음, deaths는 항상 +1 (1601)', () => {})
it('applyWeaponByNum: guns[] 복사(깊은복사)와 슬롯 규칙 (3200-3248)', () => {})
it('dropWeapon: Thing 생성 + Thing.ammoCount 이월 + 반환값=Thing 인덱스 (2320-2393)', () => {})
```

- [ ] **Step 2: 구현** — `kill`(1424-1550), `die`(1552-2318: **거대 — 게임모드별 스코어링 case 1644-1766 중 DM 1648-1654/CTF 1700-1711은 완전 번역, PM/TM/RM/INF/HTF 분기는 구조+`// TODO(M2후속)` 스텁**, 멀티킬 서버 블록 채택, `sv_punishtk` 1613-1641은 스텁, `sortPlayers` 호출은 `gs.sortPlayers?.()` 훅으로 — T10에서 배선, SCRIPT 훅 생략), `dropWeapon`(2320-2393: 전신이 `{$IFDEF SERVER}` — 규약 8a 채택, 반환=Thing 인덱스), `applyWeaponByNum`(3200-3248), `healthHit`(3250-3376: Vest 흡수/리얼리스틱 수식 그대로), `parachute`(3785-3821), `changeTeam`(3823-3972: 네트 인자 생략). M1 때 Update 안에 남긴 no-op healthHit 호출부(sprites.ts:770, 1032, 1052, 1075, 1090)가 이제 실동작 — DEADLY 폴리 즉사 등 기존 이동 테스트가 깨지지 않는지 확인.
- [ ] **Step 3: PASS 후 Commit** — `git commit -m "feat(core): sprite combat — damage, death, scoring hooks, weapon apply/drop"`

### Task 7: sprites.ts 전투 2부 — fire/throwGrenade/throwFlag + Update 전투 블록 + Respawn 무기

**Files:** Modify: `src/core/sprites.ts` · 원본: `Sprites.pas`

- [ ] **Step 1: 실패 테스트**:

```ts
it('fire: control.fire 세팅 후 update → 탄환 생성, ammoCount 감소, fireIntervalCount 리셋 (Fire 3974-4597)', () => {})
it('fire: SPAS12(BulletStyle=SHOTGUN)는 1회 발사에 산탄 다수 생성', () => {})
it('throwGrenade: tertiaryWeapon.ammoCount>0 → FRAGNADE 탄 생성+감소 (4698-4811)', () => {})
it('respawn: selWeapon 지급 + secWep 규칙 + M79 빈탄창 (Respawn 3580-3612)', () => {})
```

- [ ] **Step 2: 구현** —
  - `fire`(3974-4597): 발사각/스프레드(bink·movementAcc·`calculateBink`), 연사(FireMode), StartUpTime(미니건/LAW), `createBullet` 호출들, 리코일. 사운드는 `gs.playSound`.
  - `throwFlag`(4599-4696: `thing[i].holdingSprite===num` 스캔 → 투척 전 레이캐스트 벽 체크 → holdingSprite=0/holdedThing=0/flagGrabCooldown=15).
  - `throwGrenade`(4698-4811).
  - **Update 전투 블록 완성** (438-1423 중 M1이 스텁으로 남긴 부분): 무기 fireIntervalCount/reloadTimeCount/startUpTimeCount 진행, fire 호출 배선, 사망 처리(DeadMeat 물리), BonusTime 카운트다운, M1 주석 스텁들(sprites.ts:1064 FLAMER 역방향 탄, 1088 M79 폭발탄, 1097/1171/1252 Things 연동, 1258-1280 무기 지급) 전부 실코드로.
  - **Respawn 무기 지급**(3455-3775 중 M1 스텁 부분: 3580-3612 — `weapon=guns[NOWEAPON]`→`applyWeaponByNum(selWeapon,1)`, secWep 규칙, 봇 favWeapon 랜덤 3614+, tertiaryWeapon=guns[FRAGGRENADE] 1510/1222 주석 자리).
- [ ] **Step 3: PASS 후 Commit** — `git commit -m "feat(core): sprite fire/throw + combat update loop + respawn loadout"`

### Task 8: core/bullets.ts — 2부: 스프라이트/씽/콜라이더 충돌 + Hit/ExplosionHit

**Files:** Modify: `src/core/bullets.ts` · 원본: `Bullets.pas`

- [ ] **Step 1: 실패 테스트**:

```ts
it('탄환→스프라이트 명중: healthHit 호출, 대미지 = speed*hitMultiply*hitboxModifier (1628-1630, srv 인자 없음=규약 10)', () => {
  // 정지 타깃 정면에 EAGLE 탄 발사 → health가 원본 수식만큼 감소. Where는 명중 파트(BodyPartsPriority [12,11,10,6,5,4,3])
})
it('ExplosionHit: 반경 내 스프라이트 push + (1/(s+1))*guns[FRAGGRENADE].hitMultiply 대미지, Where=1 하드코딩 보존 (2364-2529)', () => {})
it('수류탄 체인: AFTER_EXPLOSION_RADIUS 내 다른 FRAGNADE 연쇄 기폭 (2556-2577)', () => {})
```

- [ ] **Step 2: 구현** — `checkSpriteCollision`(1361-1900: BodyPartsPriority, 멜레는 손 스켈레톤 기준 시작점, ARROW 박힘, FLAME 체인 스폰은 **서버 임계값**(규약 13), THROWNKNIFE→createThing, 대미지 호출 5종 수식 — PLAIN계 1628-1630 / ARROW 1728-1730 / M79계 1745-1747(hitbox 무적용 주의) / FLAME 1786-1788(속도 무관) / THROWNKNIFE 1871-1873(×0.01)), `checkThingCollision`(1902-2004: `collideWithBullets`/ThingCollisions 쿨다운), `checkColliderCollision`(2006-2118), `hit`(2120-2362: 스파크류는 규약 12로 채택, 사운드는 훅, BODYHIT/RICOCHET 케이스 2301-2360은 클라 전용 장식 — 채택(스파크)하되 주석), `explosionHit`(2364-2683: 생존/랙돌 이중 루프, EXPLOSION_IMPACT_MULTIPLY=3.75/DEADIMPACT=4.5, `Where=1` 하드코딩·`active=false` 위치(2557) **보존**, 씽 임펄스 2532-2551), `filterSpritesByDistance`(2702-2733: Move→splice), `targetableSprite`(2735-2752), `getComparableSpriteDistance`(2754-2764), `getSpriteCollisionPoint`(2766-2789: oldSpritePos 핑보정 — 로컬 심에선 pingTick=0 경로), `canHitSpray/hitSpray/calculateRecoil`(421-526)은 클라 시각 피드백 — 생략+주석(웹 M4).
- [ ] **Step 3: T4에서 스텁이던 update 충돌 4단계 배선 완료 확인** (dist 스레딩 비대칭 — CheckThingCollision은 되돌리기 없음 — 그대로)
- [ ] **Step 4: PASS 후 Commit** — `git commit -m "feat(core): bullet sprite/thing/collider collision, hit + explosion damage"`

### Task 9: core/things.ts — 2부: 픽업·깃발 캡처·고정포

**Files:** Modify: `src/core/things.ts` · 원본: `Things.pas`

- [ ] **Step 1: 실패 테스트**:

```ts
it('무기 픽업: 맨손 스프라이트가 반경 내 → applyWeaponByNum + thing.ammoCount 복원 (1895-1927)', () => {})
it('메디킷: health<150일 때만 픽업, health=150 복구 + respawn (1971-1990)', () => {})
it('CTF 캡처: 적 깃발 소지자가 자기 베이스(자팀 깃발 InBase) 도달 → teamScore+1, player.flags+1, 깃발 리스폰 (812-938, 알파 833/브라보 885)', () => {})
it('깃발 그랩: flagGrabCooldown 준수 (1726-1893, 1744)', () => {})
```

- [ ] **Step 2: 구현** — `checkSpriteCollision`(1602-2145: **전신 `{$IFDEF SERVER}` — 규약 8a 채택.** 최근접 스프라이트 선정 1620-1663, 깃발 그랩 1726-1893(게임모드 분기 중 CTF 완전/INF·HTF·PM 구조+스텁), 무기 1895-1927, 활 1928-1970, 키트 7종 1971-2106(각 효과 그대로: 메디킷 hasPack/grenade킷 tertiaryWeapon/flamer킷 applyWeaponByNum 스택/predator alpha/vest/berserk/cluster), 나이프·톱·LAW 2107-2139. Kill→case→Respawn 이중 순서(1719-1720) **그대로 보존**. `ServerThingTaken` 스텁, 봇챗 생략), 터치다운 블록 812-938을 update에 배선(스코어링+`gs.sortPlayers?.()`+`ServerFlagInfo` 스텁+서바이벌 분기), CheckSpriteCollision 틱 호출 949-952 배선, `checkStationaryGunCollision`(2147-2310: 마운트/조준/발사/과열 — 단일 시그니처로 항상 풀 체크).
- [ ] **Step 3: PASS 후 Commit** — `git commit -m "feat(core): thing pickup, CTF flag capture scoring, stationary gun"`

### Task 10: core/game.ts — 틱 오더 + DM/CTF 룰

**Files:** Modify: `src/core/game.ts`(M1 스텁 확장), `src/tests/game.test.ts` · 원본: `server/ServerLoop.pas:270-685`(권위), `client/UpdateFrame.pas:31-117`(스파크 위치), `shared/Game.pas`

- [ ] **Step 1: 실패 테스트**:

```ts
it('updateFrame 틱 오더: oldPos 시프트→sprite euler→sprite.update→bullet.update→bulletParts euler→sparks→things (ServerLoop 282-311 + 클라 76-82 스파크 삽입)', () => {
  // 호출 순서 기록용 스파이로 순서 자체를 검증
})
it('sortPlayers: DM에서 kills>=svKilllimit → mapChangeCounter 발동 (Game.pas:793-810)', () => {})
it('CTF 팀 승리: teamScore>=svKilllimit → 발동 (872-883)', () => {})
it('changeMap(resetRound): kills/deaths/flags/teamScore 0, 깃발 재스폰, 탄/씽 소거 (512-745)', () => {})
```

- [ ] **Step 2: 구현** —
  - `updateFrame(gs)` 확장 — ServerLoop.pas:270-685 순서 그대로: ① oldSpritePos 링버퍼 시프트(282-290) ② `spriteParts.doEulerTimeStepFor`(292-295) ③ `sprite[j].update()`(297-299) ④ `bullet[j].update()`(302-304) ⑤ `bulletParts.doEulerTimeStep()`(306) ⑥ **스파크 update — 클라 UpdateFrame.pas:76-82 위치 채택(규약 12)** ⑦ `thing[j].update()`(309-311) ⑧ 보너스 스폰(313-359 — `svBonusFrequency=0` 기본이라 사실상 비활성, 구조만) ⑨ mapChangeCounter 카운트다운→changeMap(372-377) ⑩ waveRespawnCounter(487-489) ⑪ timeLimitCounter→nextMap(496-501) ⑫ INF/HTF 틱 스코어(541-583)는 `// TODO(M2후속)` 스텁 ⑬ 깃발 무결성 가드/재스폰(611-654) ⑭ `mainTickCounter++/ticks++` (AppOnIdle:43-47 — UpdateFrame 호출 **전** 증가).
  - Game.pas에서: `isTeamGame`(502-510), `sortPlayers`(747-910: 정렬 Flags>Kills>Deaths 813-847 + 킬리밋 체크 793-810/872-883 — `nextMap` 대신 `mapChangeCounter` 무장; 클라 카메라 분기 생략) → `gs.sortPlayers` 훅에 배선(T6/T9의 호출부 활성화), `changeMap`(512-745: 순수 리셋 부분만 — 탄/씽 소거 567-574, 스프라이트 리스폰+스탯 0 583-600, teamScore/teamFlag 리셋 625-629, 모드별 씽 스폰 639-683(CTF 깃발/고정포; 나머지 모드 스텁), timeLimitCounter 재설정 733; 데모/메뉴/스냅샷은 생략+주석), `pointVisible`(279-312 — 봇 AI가 아닌 클라용이면 생략 가능, AI.pas가 사용 안 함 확인됨), Server.pas의 `nextMap`(1283)은 "같은 맵 재시작"으로 축약(맵 로테이션은 M4).
- [ ] **Step 3: PASS 후 Commit** — `git commit -m "feat(core): authoritative tick order + DM/CTF scoring, win check, round reset"`

### Task 11: core/waypoints.ts + core/ai.ts + 봇 생성

**Files:** Create: `src/core/waypoints.ts`, `src/core/ai.ts`, `src/tests/ai.test.ts` · Modify: `src/core/sprites.ts`(addBotPlayer류), `src/core/control.ts`(ControlBot 배선) · 원본: `shared/Waypoints.pas`(61줄), `shared/AI.pas`(1099줄), `shared/SharedConfig.pas:133-220`, `server/Server.pas:925-...`

- [ ] **Step 1: 실패 테스트**:

```ts
// src/tests/ai.test.ts
it('findClosest: 반경 내 "첫 번째" 웨이포인트 반환 — 최근접 아님 (Waypoints.pas:42-60 first-match 시맨틱 보존)', () => {
  // wp[1]=(100,0), wp[2]=(10,0)에서 findClosest(0,0,r=200,0) === 1 (2가 더 가까워도 1)
})
it('checkDistance 거리 브래킷 (AI.pas:41-69, 경계값은 AI.pas:17-27 상수)', () => {
  // |dx|=100 → DIST_ROCK_THROW 대역 등 3케이스
})
it('controlBot: 빈 맵에서 우측 적 발견 → control.fire=true + mouseAim이 타깃 방향 (SimpleDecision 71-456)', () => {})
it('controlBot: 적 없으면 웨이포인트 이동 컨트롤 적용 (652-862)', () => {})
```

- [ ] **Step 2: waypoints.ts** — 파일 전체(61줄): MAX_WAYPOINTS/MAX_CONNECTIONS/TWaypointAction/TWaypoint/TWaypoints.findClosest. **mapfile.ts가 이미 TWaypoint 파싱 완료**(M1) — 중복 정의를 waypoints.ts로 일원화하고 mapfile.ts가 import하도록 정리. polymap `loadData`가 `gs.botPath`에 웨이포인트를 복사하는 브리지(PolyMap.pas:158-191, 251-255 — 좌표 2백만 초과 비활성화 가드 포함) 추가.
- [ ] **Step 3: ai.ts** — `checkDistance`(41-69), `simpleDecision`(71-456: 거리 브래킷별 이동/사격/엎드림, 조준 리드 수식 400-454 — `mouseAimY = round(t.y - (0.5|1.75)*dist/weapon.speed - accuracy + random(accuracy))`, weapon.speed=0 가드는 **넣지 않고 원본 그대로**+주석), `goToThing`(458-516), `controlBot`(518-1097: LOS 스캔 → 타깃팅 → RunAway → 웨이포인트/전투 분기 → 씽 관심 → 수류탄 회피 → 워치독 → FallSave. `NextWaypoint=0→1` FIXME 669-670 보존. 봇챗 `ServerSendStringMessage`는 스텁, `bots_difficulty` 게이트는 `gs.botsDifficulty`). IFDEF 없음 — 전체 무조건 번역.
- [ ] **Step 4: 봇 생성** — `loadBotConfig(json, sprite)` ← SharedConfig.pas:133-220 (bots.json 항목 → brain/player 필드, `accuracy = trunc(acc * botsDifficulty/100)`, `controlMethod = BOT`), `addBotPlayer(gs, name, team)` ← Server.pas:925-1000 참조(스프라이트 슬롯 할당→loadBotConfig→createSprite→respawn). control.ts의 `ControlBot(SpriteC)` 호출 자리(Control.pas:296)에 배선.
- [ ] **Step 5: PASS 후 Commit** — `git commit -m "feat(core): port AI.pas bot brain + waypoint navigation + bot spawn"`

### Task 12: 통합 — 헤드리스 봇전 DM/CTF

**Files:** Create: `src/tests/integration.test.ts` · Modify: 발견되는 버그 수정만

- [ ] **Step 1: 통합 테스트 작성** (M2 완료 기준의 기계 검증):

```ts
// src/tests/integration.test.ts — ctf_Ash 실맵 + weapons.json + bots.json 픽스처
it('DM: 봇 4 (팀 없음), svGamemode=DM, 3600틱(1분) 헤드리스 — 무예외·무NaN·탄환 생성됨', () => {
  // 매 600틱마다 모든 sprite/bullet/thing 좌표 Number.isFinite 검증
  // 종료 시 gs.bullet 생성 누적 > 0 (봇이 실제로 사격), deaths 총합 >= 0 기록
})
it('DM 승리: svKilllimit=1, 강제 킬 1회 주입 → sortPlayers → mapChangeCounter 발동 → changeMap 후 스탯 리셋', () => {})
it('CTF: 알파1+브라보1 봇, svGamemode=CTF, 7200틱 — 깃발 2개 활성 유지(무결성 가드), 무예외·무NaN', () => {})
it('CTF 캡처 시나리오(연출): 봇을 적 깃발 위치로 순간이동→그랩 확인→자기 베이스로 순간이동→teamScore+1', () => {})
it('bot-vs-player: HUMAN 스프라이트(무입력) + 봇1 — 600틱 내 봇이 플레이어를 향해 발사(bullet.owner=봇)', () => {})
```

- [ ] **Step 2: 그린 될 때까지 수정** — 실패는 항상 번역 버그. systematic-debugging으로 원본 diff. **임의 튜닝 금지.**
- [ ] **Step 3: 전체 스위트 PASS (`npm test`) + Commit** — `git commit -m "test(core): headless bot DM/CTF integration — M2 core complete"`

### Task 13: web/ — 탄환·씽·무기 렌더 + HUD + 사운드 기초

**Files:** Create: `src/web/bulletsrender.ts`, `src/web/hud.ts`, `src/web/sound.ts` · Modify: `src/web/main.ts`, `src/web/gostek.ts` · 참조: `client/GameRendering.pas`(레이어), `Bullets.pas:740-1058 Render`(스타일→스프라이트 매핑만 발췌), `Things.pas:1036-1305 Render`, `client/GostekGraphics.pas`(무기 파츠 테이블), `client/InterfaceGraphics.pas`(HUD 배치)

- [ ] **Step 1: bulletsrender.ts** — 프레임마다 `gs.bullet[]`/`gs.spark[]`/`gs.thing[]`을 PIXI 스프라이트 풀에 동기화. 탄환: 스타일→weapons-gfx 텍스처(원본 Render의 case 매핑, 트레일은 단순 회전 스프라이트로 시작). 씽: 깃발(2점 스켈레톤 사이 폴리곤 2장 — PolygonsRender 1206-1305 단순화 가능, 우선 텍스처 스프라이트), 키트/무기드롭은 해당 텍스처. 스파크: 스타일→interface/sparks-gfx 텍스처 몇 종(전 스타일 커버는 M4).
- [ ] **Step 2: gostek.ts 확장** — 손에 든 무기: GostekGraphics.pas의 무기 파츠(스켈레톤 15↔16 부착, weapon.textureNum→weapons-gfx) + 리로드 시 클립 표시 생략 가능(M4).
- [ ] **Step 3: hud.ts** — 좌하단 체력바/제트연료바, 우하단 무기 아이콘+ammoCount/리로드 진행, 상단 킬 수(DM)/팀 스코어(CTF). interface-gfx 텍스처 사용, 배치는 InterfaceGraphics.pas 근사면 충분(픽셀 일치는 M4).
- [ ] **Step 4: sound.ts** — manifest의 sfx 로드(파이프라인이 sfx 미포함 시 T0에 `base/shared/sfx/` 복사 추가), `gs.playSound = (id, pos) => ...` 배선. 최소 세트: 발사음(무기별), 폭발, 리코셰, 픽업, 캡처. 거리 감쇠는 선형 근사.
- [ ] **Step 5: main.ts** — 시작 시 weapons.json 로드→`createWeapons(false)`+`loadWeaponsConfig`, bots.json 로드, `addBotPlayer` 3~4기(DM) 배선, 게임모드 URL 파라미터(`?mode=ctf`)로 CTF 전환.
- [ ] **Step 6: 브라우저 검증** — `npm run dev` → localhost:3024: 봇들이 움직이고 쏘고 죽고 리스폰, HUD 갱신, CTF에서 깃발 운반·캡처 시 스코어 증가, 콘솔 에러 0. 프리뷰 도구 스크린샷.
- [ ] **Step 7: Commit** — `git commit -m "feat(web): bullets/things/weapon render + HUD + sound — M2 playable"`

### Task 14: 원본 대조 검증

**Files:** Create: `docs/m2-parity-checklist.md`

- [ ] **Step 1: 원본 실행** — `cd ~/Downloads/soldat-ref/opensoldat/build/bin && ./opensoldatserver & ./opensoldat -join 127.0.0.1 23073` (봇 추가: 서버 콘솔 `addbot <이름>`)
- [ ] **Step 2: 나란히 대조 체크리스트** — 항목: 무기별 발사감(연사속도/탄속/탄퍼짐/리코일), 리로드 시간, 대미지(맞은 횟수로 근사 — Eagle 몸통 몇 발에 사망 등), 수류탄 궤적·폭발 반경·넉백, M79/LAW 직격, 나이프 투척, 깃발 물리(던지기/바운스), 킷 효과, 봇 행동(웨이포인트 순찰/교전 거리/조준 정확도 체감), 캡처 룰. 각 ✅/❌ + 차이 시 원인 파일 기록.
- [ ] **Step 3: 불일치 수정** — 항상 번역 버그(상수/순서/1-off). 원본 diff로 수정. **임의 튜닝 금지.**
- [ ] **Step 4: Commit** — `git commit -m "docs: M2 parity checklist vs original build"`

---

## 리스크·주의 지도 (구현자 필독 — 조사 단계에서 확인된 함정)

1. **Bullets.pas는 IFDEF 밀도 최고 (126개)** — 분류표는 규약 8~10, 13에 압축했다. 애매하면 "스파크/사운드/카메라/HUD/네트"인지부터 판별하라. 게임플레이가 갈리는 곳은 FLAME 재점화(1769-1772)와 MustCreate(1783) **둘뿐**임이 확인됨.
2. **`ExplosionHit`의 `Where=1` 하드코딩(2485, 2526)과 `active=false` 중간 세팅(2557)** — 원본의 수상한 코드. 고치지 말고 보존 + 주석 (M1의 BackgroundTest 선례).
3. **things 픽업의 Kill→효과→Respawn(재Kill) 순서**(Things.pas:1719 전후) — 순서 재배열 금지.
4. **CheckThingCollision만 dist 되돌리기 없음** (Bullets.pas Update 608) — 비대칭 그대로.
5. **findClosest는 최근접이 아니라 첫-매치** — "개선" 금지 (봇 동선이 달라진다).
6. **깃발 drop-on-death 부재**: Things.pas에는 사망 시 holdingSprite 해제 코드가 없다 — Sprites.pas Die/Kill 경로(T6)에서 찾아 배선하고, 못 찾으면 원본 동작(랙돌이 계속 운반)이 맞는지 원본 빌드로 확인 후 기록.
7. **무기 배열 인덱스 ≠ Num** (COLT: 인덱스 11/Num 0, NOWEAPON_NUM 255) — 변환은 반드시 `weaponNumToIndex` 경유.
8. **AI의 `random()` 다수 사용** — 시드 없음(스펙 4.2대로 분포만 일치하면 됨). 단 통합 테스트는 랜덤에 강건하게(정확 킬 수 대신 불변식 검증).
9. **realistic ini ≠ 하드코딩 realistic 기본값** (Ak-74 Ammo 40 vs 35 등) — ini(JSON)가 권위. normal은 일치 확인됨(T1 체크섬 테스트).
10. **circular import (bullets↔things↔sprites)** — Pascal은 uses 순환을 implementation부에서 허용. TS에선 `import type` + 런타임 참조는 전부 `gs` 경유로 절단 (M1 state.ts 규약의 연장).

## Self-Review 결과

- 스펙 M2 완료 기준("봇 상대 DM/CTF 한 판이 온전히 돌아감") ← T12(기계 검증) + T13(브라우저) + T14(느낌 대조). 커버.
- 지시된 산출물 전부 태스크에 존재: weapons.ts+ini 파이프라인(T0/T1), bullets(T4/T8), things(T5/T9), sparks(T3), game 틱오더·DM/CTF(T10 — ServerLoop+UpdateFrame 양쪽 대조 완료, 서버 권위+클라 스파크 삽입), sprites 스텁 완성(T6/T7), ai+waypoints(T11), web 렌더+HUD(T13), 통합(T12).
- M2 경계 준수: 네트 코드 없음(전부 TODO(M3) 스텁), 렌더는 기존 PixiJS 레이어에 엔티티 추가만, 메뉴 없음(모드 전환은 URL 파라미터).
- 다른 5개 게임모드(PM/TM/RM/INF/HTF)는 스펙대로 분기 구조+스텁만 (T6 Die, T9 그랩, T10 틱스코어).
- 알려진 리스크는 위 리스크 지도 10항목으로 태스크에 인라인 배치 완료.
- M3(멀티)·M4(런칭)는 별도 계획서.
