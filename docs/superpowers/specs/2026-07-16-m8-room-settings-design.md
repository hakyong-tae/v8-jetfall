# M8: 멀티 방 상세설정 + 맵 디싱크 수정 — 설계

## 배경

멀티 방은 현재 모드(DM/CTF)만 고를 수 있다. 방장이 맵·무기 제한·리스폰 시간·목표 점수(DM 킬수
/ CTF 캡처수)·세션 시간제한을 설정할 수 있게 한다. 코어는 전부 이미 지원한다:
`gs.svKilllimit`(DM 킬수·CTF 캡처수 공용 — game.ts:294, 352), `gs.svTimelimit`+
`gs.timeLimitCounter`(시간제한 → nextMap, game.ts:161-165, 470), `gs.weaponActive[]`(무기
활성 14슬롯 — 로드아웃 메뉴·respawn 지급이 이미 필터), `gs.svRespawntime`(M7). **코어 무수정.**

### 발견된 버그 (이번에 수정)
M5의 맵 랜덤 선택 이후, 넷 매치에서 `startNetMatch`(main.ts:414)와 ws 경로(:568)가
`loadGameAssets(ctf)`를 mapKey 없이 불러 **호스트/클라가 각자 랜덤 맵을 뽑는다** — 충돌
지오메트리가 달라지는 치명 디싱크. 방 설정에 mapKey를 실어 전원이 같은 맵을 로드하게 한다.

## 설정 항목 (roomState.settings)

| 항목 | 값 | 기본 | 코어 반영 |
|---|---|---|---|
| mapKey | 모드별 맵 리스트 + 'random' | random | loadGameAssets(ctf, mapKey) |
| weaponActive | 14슬롯 0/1 배열 | 전부 1 | gs.weaponActive |
| respawnSeconds | 0/2/4/6/8/10 | 6 | gs.svRespawntime = s*60 |
| killLimit | 5/10/15/20 | 10 | gs.svKilllimit (DM 킬수 / CTF 캡처수) |
| timeLimitMin | 5/10/15/0(무제한) | 10 | gs.svTimelimit = m*60*60, timeLimitCounter도 동일 세팅 |

- `'random'`은 **매치 시작 시 호스트가 확정 키로 해석**해 settings에 다시 써서(started:true와
  함께) 전 클라가 동일 맵을 로드한다.
- 무제한(0)은 timeLimitCounter를 매우 큰 값(예: 99999998)으로 — 코어 game.ts:162 게이트
  (`< 99999999`) 안에서 사실상 무한.
- **주의(기존 잠복버그)**: state.ts 기본 `timeLimitCounter: 3600`(=60초)이라, 설정 없이 두면
  1분 만에 nextMap이 돈다. 매치 시작 시 반드시 `timeLimitCounter = svTimelimit`로 세팅(웹 레이어).

## UI (lobby-ui.ts room 화면)

- 방장: 설정 패널(맵 리스트+랜덤 / 무기 14토글 / 리스폰·킬리밋·시간 프리셋 행) 편집 가능.
  변경 즉시 `updateRoomState({ settings })`(저빈도 JSON) → 전원 room 화면 갱신(기존 onRoomState
  경로 재사용).
- 비방장: 같은 패널 읽기전용 표시.
- 무기 토글 가드: 주무기 최소 1종 + 보조 최소 1종은 켜져 있어야 함(마지막 하나는 끌 수 없음).
- 라벨은 i18n 키로(5개 언어 전부). 무기명 자체는 원문(고유명사).
- Offline Bots 화면(M5/M7의 맵·리스폰 UI)은 그대로 두되, 프리셋 행 렌더링 헬퍼는 재사용 가능하면 재사용.

## 배선

- `lobby-client.ts` `createRoom`(:31)에 기본 settings 포함, `updateSettings(patch)` 추가(방장만).
  `startMatch`(:56)는 mapKey==='random'이면 해석된 키로 settings 갱신 후 started:true.
- `main.ts` `startNetMatch`: `a.lobby.roomState.settings`를 읽어
  `loadGameAssets(ctf, settings.mapKey)` + `applyMatchSettings(gs, settings)`(순수 헬퍼:
  weaponActive/svKilllimit/svTimelimit+timeLimitCounter/svRespawntime 반영). 호스트·클라 동일
  경로라 자동으로 같은 세팅.
- ws 데모 경로(:568)는 로비가 없으므로 현행 유지(전용 호스트 args가 결정) — 스코프 밖 명시.
- `StartMatchArg`에 settings 전달(또는 main.ts가 lobby.roomState에서 직접 읽기 — 구현 선택).
- HUD(선택): 시간제한 있으면 상단에 남은 시간 mm:ss 표시(gs.timeLimitCounter/60).

## 검증

- 단위: applyMatchSettings 반영값(각 필드), random 해석 후 settings에 확정 키 기록,
  무기토글 최소 1종 가드, 무제한 시간 처리.
- LOOPBACK 통합: 방장이 settings 갱신 → 클라 roomState에 반영, 매치 시작 시 호스트/클라가
  **같은 mapKey**로 로드(디싱크 수정 회귀 테스트), weaponActive 제한이 로드아웃 메뉴 후보에서
  빠지는지.
- 브라우저: 방 생성 → 설정 패널 편집(방장) → 두 탭에서 같은 설정 표시 → 시작. HUD 타이머.
- 게이트: tsc clean · 전체 테스트 green · vite build OK · `git diff --stat main..HEAD -- src/core` 비어있음.

## 언어 기본값 (결정 기록)

브라우저 언어 자동감지 유지(navigator.language, 미지원 언어는 영어 폴백) — 변경 없음.
