# M4-A: 게임 프론트엔드 (타이틀·메뉴·설정·크레딧·룸) + 브랜딩 설계서

날짜: 2026-07-12 밤 · 상태: 사용자 방향 지시("로비화면·설정 필요, Verse8 연관 이름, 1:1 썸네일") 기반 자율 확정

## 1. 목표

개발용 뼈대뿐인 현재 프론트(맨 HTML 버튼)를 **게임다운 화면 플로우**로 교체한다:
타이틀 → 메인메뉴 → (온라인 로비/룸 | 오프라인 봇전) → 인게임 + ESC 메뉴, 설정(영속), 크레딧(CC BY 의무표기).
동시에 게임 **브랜딩**(이름/태그라인)과 **1:1 정방형 썸네일**(Verse8 등록용)을 만든다.

## 2. 브랜딩 (사용자 최종 pick 대기 — 임시 확정으로 진행)

- **임시 확정: "V8 Jetfall"** — 기존 V8 Kart Rush/V8 Fist 네이밍 패턴 + 제트팩 정체성.
- 후보 리스트(아침 결정용): V8 Jetfall ⭐ / V8 Steelstorm / Versefall / V8 Frontline / V8 Warzone.
- `src/web/brand.ts` 단일 소스: `GAME_TITLE`, `GAME_TAGLINE`("2D jetpack shooter" 류), `GAME_VERSION`. **이름 교체 = 이 파일 한 곳.**
- "Soldat" 문자열은 사용자 노출 UI에서 제거(레포명/문서는 유지). 크레딧에 "Based on OpenSoldat by Transhuman Design & contributors (MIT / CC BY 4.0)" 필수.

## 3. 화면 플로우

```
Title(로고+아무키) → MainMenu ─ PLAY ONLINE ─→ Lobby(룸목록/빠른입장/방만들기) → Room(팀선택/Ready/Start) → 인게임
                        ├ OFFLINE BOTS ─→ 모드선택(DM/CTF) → 인게임(기존 startBotMatch)
                        ├ SETTINGS ─→ 설정 화면 (어디서든 접근, ESC 메뉴에서도)
                        └ CREDITS ─→ 크레딧 스크롤
인게임 ESC → 일시 오버레이 메뉴(Resume / Settings / Leave to Menu)  ※시뮬은 계속(멀티 공정성), 오프라인 봇전만 일시정지
```

- 기존 `lobby-client.ts`(로직)와 net 계층은 **무수정** — UI만 교체. `mountLobby` 진입 계약은 유지하되 내부가 화면 상태머신으로 확장.
- `?nolobby=1`/`?wshost=` 개발 경로 유지.
- Leave to Menu: 인게임 → 정리(app.destroy, transport leave) → 메인메뉴 복귀.

## 4. 설정 (src/web/settings.ts)

- 항목(YAGNI — 이번엔 3개만): **SFX 볼륨**(0~100 슬라이더 → SoundSystem 마스터 게인), **뮤트 토글**, **조작키 표**(읽기전용 표시; 리바인딩은 후속).
- 영속: `localStorage` 키 `jetfall.settings.v1` (JSON). 부팅 시 로드→적용, 변경 즉시 저장.
- SoundSystem에 `setMasterVolume(v)`/`setMuted(b)` 공개 메서드 추가(웹 레이어 — 코어 무관).

## 5. 비주얼 스타일 (원작 메뉴 감성)

- 팔레트: 다크 올리브/카키 배경(#1a1a12 계열, 맵 배경톤), **옐로 하이라이트**(#f5d442 — 원작 메뉴 옐로), 텍스트 오프화이트.
- 배경: CSS 그라디언트 + `scenery/`·`textures/` 실에셋 저투명 데코(외부 리소스 0 — 전부 로컬 manifest 에셋).
- 커서: `interface/cursor.png` (CSS cursor url). 메뉴 항목 hover 시 옐로+오프셋 (원작 메뉴 느낌).
- 폰트: 시스템 스택(외부 CDN 금지 — Verse8/오프라인 안전). 타이틀은 CSS로 스텐실풍 처리(letter-spacing/weight/그림자).
- 스타일 모듈: `src/web/lobby/ui-theme.ts` (CSS 문자열 1곳 — 화면들 공유).
- ⚠️ 원작 `interface/title-l·r`(SOLDAT 로고)은 상표라 **사용 금지** — 타이틀은 텍스트 로고.

## 6. 1:1 썸네일 (Verse8 등록용)

- `promo/thumbnail-1024.png` (1024×1024). 구성: 실게임 히어로 샷(무기 든 병사 클로즈업+지형) 배경 + 타이틀 텍스트 오버레이 + 비네트.
- 제작 파이프라인(재현 가능하게 스크립트화): 게임 페이지에 dev 전용 `?thumb=1` 컴포저 (스테이징 씬 렌더 → 1024² 오프스크린 canvas 합성 → 로컬 세이브 서버로 POST). 스크립트 `tools/save-server.mjs`(수신) — 커밋은 결과 PNG + 도구.
- 변형 2~3장 생성(구도 다르게) → 아침에 pick.

## 7. 구현 경계

- 파일: `src/web/brand.ts`(신규), `src/web/settings.ts`(신규), `src/web/lobby/ui-theme.ts`(신규), `src/web/lobby/lobby-ui.ts`(화면 상태머신으로 재작성), `src/web/main.ts`(ESC 메뉴 훅+Leave 정리+settings 적용 배선), `src/web/sound.ts`(마스터게인 메서드), `tools/save-server.mjs`+`promo/`.
- **금지**: `src/core/*` 무수정. `src/net/*` 무수정(병렬 세션이 weaponNum 작업 중 — 충돌 방지).
- 테스트: settings 로드/세이브/적용 단위테스트(localStorage 목), 화면 상태머신 전이 테스트(DOM 최소 — jsdom 없이 가능한 로직 분리), 기존 285 그린 유지.

## 8. 검증

- 브라우저: 타이틀→메뉴→설정(볼륨 저장 후 새로고침 유지)→크레딧→오프라인 봇전 진입→ESC 메뉴→Leave→메뉴 복귀. 온라인 버튼은 미배포 offline 안내. `?wshost` 데모 회귀 무결.
- 썸네일: 1024×1024 PNG 3변형 promo/에 존재, 타이틀 텍스트 선명.
