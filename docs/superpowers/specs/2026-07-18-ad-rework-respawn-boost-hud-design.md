# 광고 재설계 + 리스폰 부스트 + 인게임 정보 HUD

- 날짜: 2026-07-18
- 상태: 설계 승인됨 (구현 계획 대기)
- 관련 파일: `src/web/ads.ts`, `src/web/main.ts`, `src/web/hud.ts`, `src/net/protocol.ts`,
  `src/net/host-session.ts`, `src/net/client-session.ts`, `src/web/i18n.ts`

## 배경 / 문제

플레이 피드백 2건:

1. **봇전 시작 광고가 진입 장벽** — 봇전 시작 버튼을 누르면 즉시 인터스티셜 광고가 떠서,
   "게임 하려는데 광고" → 그냥 앱을 꺼버린다. (`startBotMatch()`의 `showInterstitial('botmatch-start')`)
2. **리워드 광고(리스폰 스킵)의 값어치가 없음** — 광고 15~30초를 보고 리스폰 대기 몇 초를
   당기는 교환이라 수지가 안 맞는다. 여러 번 죽을 때마다 광고가 대기보다 길어 효용이 없다.

추가 UX 요청:

3. 죽었을 때 **리스폰까지 남은 시간**을 보여줄 것.
4. 좌상단에 **현재 맵 / 인원 / (온라인) 방 제목**을 상시 표시.
5. Tab 스코어보드 타이틀에서 **방 이름 제거** (방금 넣은 `roomLabel` — 타이틀이 길어져 안 예쁨).

## 목표

- 봇전 진입 마찰 제거(강제 시작 광고 삭제).
- 리워드 광고를 값어치 있는 **횟수 기반 리스폰 부스트**로 교체.
- 사망 대기 중 리스폰 카운트다운 표시.
- 좌상단 상시 정보 패널(맵/인원/방제목) 신설, 방 정보는 여기로 일원화.

## 비목표 (YAGNI)

- 시간 기반 버프(횟수 기반으로 확정).
- 즉시 리스폰(0초) 버프 — PvP 밸런스 경계선이라 제외, 2배만.
- 코스메틱/색상 리워드 — 별도 건, 이번 스코프 아님.
- 라운드 종료 인터스티셜은 **유지**(변경 없음).

## 상수(기본값)

```
BOOST_CHARGES   = 5     // 광고 1회 → 리스폰 부스트 5회 충전
BOOST_DIVISOR   = 2     // 리스폰 대기 절반(2배 빠름)
BOOST_MIN_WAIT_TICKS = 240  // 리스폰 대기 4초(240틱) 미만이면 부스트 버튼 미노출(헛소모 방지)
```

## 파트 A — 광고 재설계

### A1. 봇전 시작 광고 제거
- `startBotMatch()`에서 `await showInterstitial('botmatch-start')` 한 줄 삭제.
- `showInterstitial` 함수 자체는 라운드 종료(`round-end`)에서 계속 쓰이므로 유지.

### A2. 리워드 = 횟수 기반 리스폰 부스트
- 광고 완주 시 로컬 플레이어에게 **부스트 5회** 충전.
- 부스트가 남아있는 동안 죽으면: 리스폰 카운터를 `svRespawntime / BOOST_DIVISOR`로 클램프 +
  잔여 1회 차감.
- 버튼 노출 조건: 사망 대기(deadMeat) 중 **그리고** 방 리스폰 대기가 `BOOST_MIN_WAIT_TICKS`
  이상(이미 빠른 방에선 부스트 무의미 → 버튼 숨김).
- 버튼 문구: `ad.boostRespawn` = "광고 보고 리스폰 5회 2배" (5개 언어).

### A3. 부스트 적용 권위
- **봇전**: 로컬이 곧 시뮬. 로컬 플레이어 사망 감지 시 로컬에서 직접 카운터 클램프 + 차감.
- **멀티**: 호스트 권위. 클라가 광고 완주 후 `MSG.RESPAWN_BOOST { charges: 5 }` 전송 →
  호스트가 계정별 잔여 횟수 기록 → 그 플레이어가 죽어 대기 중이면(매 틱 검사) respawnCounter를
  `svRespawntime/2`로 클램프하고, 리스폰이 실제로 일어난 프레임에 1회 차감. 스냅샷이 리스폰
  상태를 이미 동기화하므로 새 넷코드 없음.
- 표시용 잔여 횟수는 클라가 로컬 예측(내 사망→차감). 호스트가 진실이지만 표시 카운트는
  코스메틱이라 미세 오차 무해.

### A4. 프로토콜 변경
- `MSG.RESPAWN_SKIP` → `MSG.RESPAWN_BOOST`로 개명(의미가 스킵→부스트로 바뀜).
- 페이로드: `{ charges: number }`.
- `host-session.ts`: `applyRespawnSkip(account)` → `applyRespawnBoost(account, charges)`.
  계정별 `boostRemaining: Map<string, number>` 추가. 매 틱 사망 대기 플레이어 클램프 로직 추가.
- `client-session.ts`: `requestRespawnSkip()` → `requestRespawnBoost()`. 로컬 예측 표시 카운트 관리.

## 파트 B — 리스폰 카운트다운

- 사망 대기(`spr.deadMeat`) 중 화면에 **"리스폰까지 N초"** 표시.
  - N = `ceil(spr.respawnCounter / 60)`.
- 부스트 활성(잔여 > 0)이면 아래 줄에 **"리스폰 2배 · N회 남음"** 표시.
- HUD 신규 텍스트 요소(사망 시 visible). 위치: 화면 중앙 하단(부스트 버튼 위쪽) — 버튼과 겹치지
  않게 배치.
- 봇전/멀티 공통. `respawnCounter`는 코어가 매 틱 감소시키므로 그대로 읽어 표시.
- i18n: `hud.respawnIn` = "리스폰까지 {n}초", `hud.boostActive` = "리스폰 2배 · {n}회 남음".
  (플레이스홀더 `{n}` 치환은 기존 t() 사용부에서 문자열 결합으로 처리 — 포맷 함수 불필요.)

## 파트 C — 좌상단 정보 패널 + Tab 정리

### C1. 좌상단 상시 패널 (신규 HUD 요소)
- 매치 중 상시 표시. 좌상단(기존 디버그 오버레이와 겹치지 않게 — 디버그는 dev 전용이므로
  프로덕션엔 없음; 좌상단 y offset 조정).
- 내용:
  - **맵 이름**: `loadGameAssets`가 반환하는 resolvedKey (예: `arena2`).
  - **인원**: 봇전 = 활성 전투원 수 `N명`. 온라인 = `현재/8명` (룸 인원 / ROOM_CAP).
  - **온라인만: 방 제목** = 룸 키(roomKey).
- 데이터 전달: 매치 루프가 `hud.setMatchInfo({ mapKey, playerCount, cap?, roomLabel? })`를
  주기적으로 호출(또는 값 변할 때). 인원은 매 프레임 활성 스프라이트 카운트로 갱신.
- 스타일: 모노스페이스, 반투명 배경, 좌상단 8px 여백.

### C2. Tab 스코어보드에서 방 이름 제거
- `hud.showScoreboard`의 `ScoreboardOpts.roomLabel` 및 타이틀의 `room` 접미사 제거.
- `main.ts`의 `showScoreboard(... { roomLabel })` 인자 제거.
- `sb.room` i18n 키는 좌상단 패널에서 재사용(온라인 방 라벨 접두)하거나, 좌상단이 자체 라벨을
  쓰면 제거. → **재사용**: 좌상단 온라인 방 표기에 `t('sb.room')` 접두.

## 파일별 변경 요약

| 파일 | 변경 |
|---|---|
| `src/web/ads.ts` | 변경 없음(showInterstitial/showRewarded 재사용). |
| `src/net/protocol.ts` | `RESPAWN_SKIP`→`RESPAWN_BOOST`, 페이로드 `{charges}`. |
| `src/net/host-session.ts` | `applyRespawnBoost` + `boostRemaining` 맵 + 틱 클램프. |
| `src/net/client-session.ts` | `requestRespawnBoost` + 로컬 표시 카운트. |
| `src/web/hud.ts` | 좌상단 패널 요소 + 리스폰 카운트다운 요소 + `setMatchInfo()`; 스코어보드 `roomLabel` 제거. |
| `src/web/main.ts` | 시작 광고 삭제; 부스트 버튼(기존 skip 버튼 개명·조건 변경); 카운트다운·좌상단 매 프레임 갱신; 부스트 소모 로직(봇전 로컬/멀티 호스트); showScoreboard roomLabel 제거. |
| `src/web/i18n.ts` | `ad.boostRespawn`, `hud.respawnIn`, `hud.boostActive` ×5개어; `ad.skipRespawn` 제거. |

## 테스트

- **단위(vitest)**:
  - `host-session`: 부스트 충전 후 사망 대기 플레이어의 respawnCounter가 `svRespawntime/2`로
    클램프되고, 리스폰 시 1회 차감 / 잔여 0이면 클램프 안 함 / 살아있으면 무동작.
  - `client-session`: `MSG.RESPAWN_BOOST` 수신 시 호스트 맵 갱신; 요청 시 로컬 표시 카운트 세팅.
  - HUD 순수 로직이 있으면(카운트다운 초 계산 등) 소규모 테스트.
- **라이브(Puppeteer, 배포 백엔드)**:
  - 봇전 시작 시 광고 없이 즉시 진입.
  - 사망 시 좌상단 패널(맵/인원) + 리스폰 카운트다운 표시 스크린샷.
  - 부스트 활성 후 사망 → respawnCounter가 절반으로 줄어드는지 상태 덤프로 확인.
  - 멀티 2클라: 방 제목/인원 좌상단 표시, Tab 타이틀에 방 이름 없음 확인.

## 열린 값 (기본값으로 진행, 필요시 조절)

- BOOST_CHARGES=5, BOOST_DIVISOR=2, BOOST_MIN_WAIT_TICKS=240(4초).
