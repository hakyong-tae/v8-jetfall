# 맵 선택 + 원작식 무기선택(림보) + Tab 스코어보드 — 설계

## 배경

봇전 로비가 맵을 `ctf_ash` 하드코딩으로 고정하고, 스폰 무기도 `AK74` 하드코딩이었다. 원작
Soldat은 스폰 시 무적시간(CeaseFireCounter) 동안 마우스로 무기를 고르는 림보(Limbo) 메뉴가
뜨고, 사망 후 리스폰 대기 중에도 다시 뜬다. 코어(`src/core/`)에는 이미 이 로직이 전부
포팅되어 있다 — `TSprite.applyWeaponByNum`, `gs.weaponSel[num][w]`, `respawn()`의
`selWeapon`/`player.secWep` 지급 규칙(Sprites.pas:3580-3612), `ceaseFireCounter`(90틱
스폰 무적, Constants.pas `DEFAULT_CEASEFIRE_TIME`). 웹 포팅에서 빠진 건 **UI와 배선**뿐이다.

또한 Tab 스코어보드도 요청됨: DM은 킬/데스, CTF는 킬/데스+깃발 캡처. 캡처 카운트도 코어에
`player.flags`(Things.pas 캡처 스코어링 — `player.flags += 1`)로 이미 집계 중이라 순수
렌더 작업이다.

## 스코프

1. **맵 선택**: 봇전(Offline Bots) 로비 화면에 모드별(DM/CTF) 맵 리스트 + Random 버튼 추가.
2. **무기선택 림보 메뉴**: 원작 충실 — 첫 스폰 시 맨손+메뉴 자동 오픈, 사망 시 자동 재오픈,
   CeaseFire 동안 무적, Tab(원작 change-weapon 키 대응)으로 수동 토글. AK 하드코딩 제거.
3. **네트워크 동기화**: 온라인 멀티에서도 무기선택 적용(저빈도 JSON 메시지 1종 추가).
4. **Tab 스코어보드**: DM=킬/데스 테이블, CTF=킬/데스/캡처 + 팀 스코어. 봇 포함 전원 표시.

CTF/DM만 대상 (INF/HTF 미지원 — 기존 스코프와 동일). 온라인 룸의 맵 선택은 이번 스코프
제외(로비 방 생성 시 맵 고정 유지) — 봇전만 맵 선택 가능.

## 1) 맵 선택

- `loadGameAssets(ctf, mapKey)`로 시그니처 확장. `MAP_NAME` 하드코딩 제거.
- manifest의 `maps` 99종을 접두사로 필터: CTF 모드 = `ctf_` 접두 키만, DM 모드 = 접두사
  없는 나머지 전부(`inf_`/`htf_`/`rm_` 등 존재 시 제외 — grep으로 실제 접두사 확인 후 목록
  확정).
- `lobby-ui.ts`의 `offline` 화면에 맵 선택 UI 추가: DM/CTF 토글 버튼(기존 유지) 아래에
  맵 리스트(스크롤 가능) + "Random" 버튼(기본 선택 상태). 선택된 모드가 바뀌면 리스트도
  해당 모드 맵으로 갱신.
- 마지막 선택은 `localStorage`(`jetfall.lastmap.v1`)에 저장해 다음 방문 시 복원.
- `main.ts`의 `onOfflineBots` 콜백 시그니처에 `mapKey?: string` 추가, 없으면(Random) 후보
  중 시드 없는 `Math.random()` 선택.
- (전용 Node 호스트) `server/host.ts`에 `--map` 인자 추가해 동일 파이프라인 재사용 — 온라인
  룸에서 맵 선택 UI를 넣진 않지만, 나중에 넣기 쉽도록 호스트 자체는 맵 인자를 받게 한다.

## 2) 무기선택 림보 메뉴

**트리거 규칙 (원작 대응)**
- 최초 스폰: `respawn()` 호출 직후 `selWeapon = 0`(맨손)으로 만들고 메뉴를 연 채 시작.
  (현재 `startBotMatch`가 `selWeapon = guns[AK74].num`을 강제 지정하는 부분을 제거.)
- 사망 시(`deadMeat` true 전이 감지): 메뉴 자동 오픈. 리스폰 카운터가 도는 동안 계속 선택
  가능, 다음 리스폰에 반영.
- 수동 토글: `Tab` 키(원작 change-weapon 키는 게임 내 다른 용도로 이미 `KeyQ` 사용 중이므로,
  이번 요청대로 스코어보드와 `Tab`을 겹쳐 쓰지 않기 위해 무기메뉴는 계속 **Q 유지, 스코어보드만
  Tab**으로 배정 — 아래 4)절 참조). ESC로 닫기(기존 ESC 메뉴와 스택 충돌 없게 무기메뉴가 열려
  있으면 ESC는 무기메뉴부터 닫음).
- 살아있는 상태에서 메뉴를 열고 선택하면 원작처럼 **즉시 장착**(`applyWeaponByNum` 호출),
  아니면 다음 리스폰 때 지급.

**UI**
- DOM 오버레이(로비 `ui-theme.ts` 톤 재사용), 화면 중앙 하단. 좌측 컬럼 = 프라이머리 10종
  (원작 무기명 표기, `hud.ts`의 `GUN_ICON` 텍스처 재사용), 우측 컬럼 = 세컨더리 4종. 클릭 선택
  (원작이 마우스 GUI이므로 이 포트도 클릭 우선; 숫자키 1~0/F1~F4는 접근성 편의로 추가하되
  원작 사양은 아님을 주석에 명시).
- 메뉴가 열려 있는 동안 좌클릭(발사)이 게임 입력으로 새지 않도록 `input.ts`에 "메뉴 열림"
  게이트 추가.
- CeaseFire 동안 캐릭터 반투명 처리(무적 시각 피드백) — `ceaseFireCounter > 0`일 때
  gostek 알파를 낮춤(원작엔 없는 web 전용 가독성 보완이나 반투명 처리 자체는 흔한 FPS 관례로
  최소 침습적 추가; 과하면 생략 가능 — 구현 중 판단).

**네트워크 동기화**
- `src/net/protocol.ts`에 `MSG.LOADOUT` 추가: 클라→호스트, JSON `{selWeapon, secWep}`
  (ASSIGN/KILL과 동일한 저빈도 JSON 규약, 바이너리 코덱 불필요).
- `client-session.ts`가 로컬 선택 시 호스트로 전송. `host-session.ts`가 수신해 해당 슬롯의
  `gs.sprite[n].selWeapon`/`player.secWep`를 갱신 — 죽어있으면 다음 respawn이 자동 반영(코어
  로직 그대로), 살아있으면 즉시 `applyWeaponByNum` 호출(원작 규칙과 동일, 코어 함수 재사용).
  다른 클라 렌더는 기존 SNAPSHOT의 `weaponNum` 필드로 자동 동기화(수정 불필요).
- **코어(`src/core/`) 무수정** 원칙 유지 — 새 로직은 `src/net/`과 `src/web/`에만.

## 3) Tab 스코어보드

- `Tab` 키 다운 동안(또는 토글 — 아래 구현 중 확정) 표시되는 오버레이 테이블.
  - **DM**: 이름 / Kills / Deaths, Kills 내림차순 정렬.
  - **CTF**: 이름 / 팀 / Kills / Deaths / Caps(`player.flags`), 상단에 팀 스코어
    (`gs.teamScore[TEAM_ALPHA]` vs `gs.teamScore[TEAM_BRAVO]` — 기존 HUD 상단 텍스트와 동일
    소스) 병기.
- `gs.sprite[1..MAX_SPRITES]`를 스캔해 `active && player` 필터, 봇 포함 전원 나열(현재 HUD
  킬피드가 쓰는 것과 동일한 순회 패턴 재사용).
- `hud.ts`에 `Scoreboard` 서브컴포넌트로 추가(기존 `Hud` 클래스 안에 렌더 메서드 하나 + 표시
  플래그) — 새 파일 분리 없이 HUD 소속 유지(스코프가 작아 별도 클래스 오버엔지니어링 방지).

## 검증

- 단위테스트: 림보 선택 → respawn 지급 규칙(맨손 스폰, 사망 후 재선택, 즉시 장착 vs 다음
  리스폰 반영), LOOPBACK 멀티에서 LOADOUT 메시지 반영, 스코어보드 데이터 집계(킬/데스/캡처
  카운트 정확성 — 기존 game.ts 스코어링 테스트에 필드만 추가 검증).
- 브라우저 눈검증: 봇전 진입 시 맵 선택 UI, 랜덤 선택, 맨손 스폰 후 무기 클릭 즉시 장착,
  사망 후 메뉴 재오픈, Tab 눌러 스코어보드(DM/CTF 둘 다), `?wshost` 로컬 데모로 LOADOUT
  실동기화 확인.
- 게이트: `tsc --noEmit` clean, 클린 상태 `npm test` 전부 green, `vite build` OK, 코어
  무수정(`git diff --stat main..HEAD -- src/core` 비어있음).
