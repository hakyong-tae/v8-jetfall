# M4-A: 게임 프론트엔드 (타이틀·메뉴·설정·크레딧) 구현 계획

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development. Steps use checkbox 문법.

**Goal:** 개발용 뼈대 로비를 게임다운 화면 플로우(타이틀→메뉴→설정/크레딧/로비→룸→인게임+ESC메뉴)로 교체하고 브랜딩("V8 Jetfall" 임시확정)을 단일 소스로 박는다.

**Architecture:** UI 전면 재작성이지만 로직 계층(lobby-client/net/*)은 무수정. 화면은 `Screen` 상태머신 + 공유 테마 CSS. 설정은 localStorage 영속 + SoundSystem 게인 배선. 스펙: `docs/superpowers/specs/2026-07-12-m4a-frontend-lobby-design.md`.

**Tech:** TypeScript, DOM(프레임워크 無), localStorage, Vitest. 외부 리소스 0 (로컬 에셋만).

**절대 금지:** `src/core/*` 수정, `src/net/*` 수정(병렬 세션이 작업 중 — lobby-client의 *사용*은 OK, 수정 금지).

---

### Task 1: src/web/brand.ts + src/web/settings.ts (+테스트)

**Files:** Create `src/web/brand.ts`, `src/web/settings.ts`, `src/tests/settings.test.ts`

- [ ] brand.ts:
```ts
// 게임 브랜딩 단일 소스 — 이름 교체는 이 파일만 수정하면 전체(타이틀/썸네일/문서)에 반영된다.
// 후보(아침 결정): V8 Jetfall ⭐임시확정 / V8 Steelstorm / Versefall / V8 Frontline / V8 Warzone
export const GAME_TITLE = 'V8 JETFALL'
export const GAME_TAGLINE = '2D JETPACK COMBAT'
export const GAME_VERSION = '0.4.0-m3'
export const CREDITS_LINES = [
  'Based on OpenSoldat',
  'by Transhuman Design & the OpenSoldat contributors',
  'Original game code: MIT License',
  'Game assets (graphics/sounds/maps): CC BY 4.0 — opensoldat/base',
  'Font "Play": SIL Open Font License',
  'Web port: rebuilt for Verse8',
]
```
- [ ] settings.ts — 스키마+영속+적용 훅:
```ts
export interface GameSettings { sfxVolume: number /*0..100*/; muted: boolean }
export const DEFAULT_SETTINGS: GameSettings = { sfxVolume: 80, muted: false }
const KEY = 'jetfall.settings.v1'
export function loadSettings(storage: Pick<Storage,'getItem'> = localStorage): GameSettings { /* JSON.parse+스키마가드+클램프, 실패시 DEFAULT */ }
export function saveSettings(s: GameSettings, storage: Pick<Storage,'setItem'> = localStorage): void
```
- [ ] settings.test.ts — 목 storage로 라운드트립/깨진 JSON 폴백/클램프(120→100) 3케이스 TDD.
- [ ] Commit: `feat(web): brand single-source + persistent settings`

### Task 2: src/web/sound.ts 마스터 게인 (+테스트 가능하면)

**Files:** Modify `src/web/sound.ts`

- [ ] `setMasterVolume(v0to100)`/`setMuted(b)` 추가 — 내부 마스터 GainNode 하나를 체인에 삽입(기존 재생 경로가 경유). 생성 시 loadSettings 반영은 호출측(main.ts) 책임으로.
- [ ] Commit: `feat(web): sound master volume/mute`

### Task 3: src/web/lobby/ui-theme.ts + lobby-ui.ts 화면 상태머신 재작성

**Files:** Create `src/web/lobby/ui-theme.ts`, rewrite `src/web/lobby/lobby-ui.ts`

- [ ] ui-theme.ts — 공유 CSS 문자열(다크올리브 bg #14140e→#1e1e14 그라디언트, 옐로 #f5d442 하이라이트, 버튼/리스트/슬라이더/타이틀로고 클래스, interface/cursor.png 커서, 스텐실풍 타이틀: 900weight+letter-spacing+이중 text-shadow). `injectTheme(root)` 1회 주입.
- [ ] lobby-ui.ts — 화면 enum `title|menu|settings|credits|lobby|room` 상태머신. 각 화면 render 함수:
  - **title**: GAME_TITLE 대형 로고 + GAME_TAGLINE + "PRESS ANY KEY" 점멸 → 아무 키/클릭에 menu로.
  - **menu**: PLAY ONLINE / OFFLINE BOTS / SETTINGS / CREDITS 세로 메뉴(hover 옐로+▸). ONLINE: 기존 connect 흐름(성공→lobby 화면, offline→토스트 "서버 미배포 — 오프라인 봇전을 이용하세요"). OFFLINE BOTS: DM/CTF 선택 소메뉴 → `onOfflineBots(mode)`.
  - **settings**: SFX 볼륨 슬라이더(input range, 변경 즉시 saveSettings+`onSettingsChange(s)` 콜백)+뮤트 체크+조작키 표(A/D/W/S/X/우클릭 제트/좌클릭 발사/R/Q/Space/F 정적 테이블)+BACK.
  - **credits**: CREDITS_LINES 세로 나열+BACK.
  - **lobby**: 룸 목록 테이블(이름/모드/인원, listRooms 주기 갱신 3s)+QUICK JOIN+CREATE DM/CTF+닉네임 입력+BACK.
  - **room**: 기존 기능 유지(참가자·팀버튼 Alpha빨강/Bravo파랑/Spectator·Ready·호스트 START)를 테마 입혀 재구성.
- [ ] `mountLobby(root, opts)` 계약 확장: `opts.onOfflineBots(mode: 'dm'|'ctf')`, `opts.onSettingsChange(s: GameSettings)` 추가. onStartMatch는 기존 그대로.
- [ ] Commit: `feat(web): game-styled frontend (title/menu/settings/credits/lobby/room)`

### Task 4: main.ts 배선 — 설정 적용·오프라인 모드선택·ESC 메뉴·Leave

**Files:** Modify `src/web/main.ts`

- [ ] boot: `loadSettings()` → sound 시스템 생성 후 `setMasterVolume/setMuted` 적용. `mountLobby` 새 opts 배선(onOfflineBots(mode)→startBotMatch가 mode 인자 받게 소폭 확장 — URL 파라미터 대신 인자 우선, `?mode=ctf` 호환 유지).
- [ ] ESC 오버레이(인게임 공용): ESC keydown → 반투명 오버레이(RESUME/SETTINGS/LEAVE TO MENU). 오프라인 봇전이면 시뮬 일시정지(ticker 루프 가드), 네트 매치면 시뮬 계속(공정성) + 오버레이만. SETTINGS는 동일 설정 패널 재사용(onSettingsChange 공유). LEAVE: app.destroy+transport.leaveRoom(있으면)+body 클리어+`boot()` 재호출.
- [ ] `?nolobby=1`/`?wshost=` 경로 회귀 무결.
- [ ] Commit: `feat(web): settings wiring + in-game ESC menu + leave-to-menu`

### Task 5: 검증
- [ ] `npx tsc --noEmit` clean, `npm test` 285+신규 그린, `npx vite build` OK.
- [ ] 브라우저(스텝퍼/스크린샷): 타이틀→메뉴→설정(볼륨 60 저장→새로고침 유지 확인)→크레딧→오프라인 DM 진입→ESC 메뉴→LEAVE→메뉴 복귀. `?wshost` 데모 회귀. 콘솔 에러 0.
- [ ] Commit(잔여) + 최종 보고.

## Self-Review
스펙 §2~5·§7 전부 태스크 매핑 확인(§6 썸네일은 컨트롤러 직접 수행으로 분리). net/* 무수정 경계 명시. mountLobby 계약 변화는 main.ts와 동시 커밋으로 원자성 유지.
