# M3: 네트워크 멀티플레이 (Verse8/agent8) 설계서

날짜: 2026-07-12 · 상태: 사용자 승인됨 (설계 확정) · 선행: M1(이동)·M2(전투+봇) 완료, main 머지

## 1. 목표

M2의 서버권위 전투 시뮬을 **호스트권위 온라인 멀티플레이**로 확장한다. Verse8 agent8 릴레이를 전송으로 쓰고, 로비→룸→인게임 플로우와 4~8인 매치를 지원한다.

**확정 결정 (사용자):**
- **매치 인원**: 4~8명
- **권위 모델**: **호스트권위** (원작 Soldat 넷코드와 동일, 우리 코어가 이미 서버변종) — 안 되면 피어 폴백으로 전환 가능하게 넷 계층 분리
- **배포 모드 3종** (같은 세션 코드 공유): ① 전용 Node 헤드리스 호스트(최선) ② 브라우저 클라-호스트(폴백) ③ 피어/피해자권한(최종 폴백)
- **로비 필수**: 닉네임·룸목록/빠른입장·모드(DM/CTF)·팀선택(Alpha/Bravo/Spectator, 원작 Select Team 재현)

## 2. 핵심 제약 (검증된 사실)

- **agent8 = 릴레이 + 룸상태 저장 서버**, 연속 게임루프 불가 (server.js는 클래스 정의만, 타이머 금지). → 권위 시뮬은 반드시 **클라이언트(브라우저 탭 또는 Node 프로세스)** 에서 실행.
- agent8 클라 API (nox-arena/kart-rush 검증): `GameServer.getInstance()`+`connect()`→`account`, `remoteFunction(name,args,{throttle,needResponse})`, `onRoomMessage(roomId,event,cb)`, `$global.joinRoom/getCollectionItems`, `$room.broadcastToRoom/updateRoomState/getRoomState`, `$sender.account`.
- **미배포(로컬)면 connect 실패** → 오프라인 폴백 필수. `configured = !!import.meta.env.VITE_AGENT8_VERSE`.
- 일반 remoteFunction ~10/s 제한, 위치류는 `{throttle:100, needResponse:false}` 브로드캐스트.
- 룸상태는 flat key(`p_{account}`)로 얕은병합 안전.
- 우리 코어는 순수 TS(DOM 의존 0) — 헤드리스 봇전으로 검증됨. → 같은 `host-session`이 브라우저/Node 양쪽에서 실행 가능.

## 3. 아키텍처

### 3.1 하나의 권위 세션, 3배포 모드

```
권위 세션: 코어 updateFrame(gs) 60Hz + 입력주입 + 스냅샷 브로드캐스트 + 데미지/사망/스코어 판정
  ① 전용서버:   server/host.ts (Node, 상시, 마이그레이션 X)  ★
  ② 브라우저호스트: 첫 입장 브라우저 (마이그레이션 O)
  ③ 피어폴백:   session 전략만 교체 (transport/protocol 재사용)
        ↕ agent8 릴레이
클라이언트: 입력송신 + 로컬예측(내 병사) + 원격병사 보간 + reconcile + 탄환 로컬시뮬
```

### 3.2 컴포넌트 (`src/net/`)

| 파일 | 책임 | 공유 범위 |
|---|---|---|
| `transport.ts` | **provider 주입식** agent8 래퍼 (connect/join/leave/broadcast/onRoomMessage/roomState). withTimeout. offline 폴백. | 전 모드 |
| `loopback.ts` | 인프로세스 목 릴레이 provider — SDK/배포 없이 N세션을 한 프로세스에서 연결. **테스트·단일브라우저 2세션 검증용** | 테스트 |
| `protocol.ts` | 메시지 타입 + 스냅샷/입력 (역)직렬화 (바이너리 팩: Float32/Int16 타이트) | 전 모드 |
| `host-session.ts` | 권위 시뮬 루프: 입력큐 적용 → updateFrame → 스냅샷/이벤트 송신. **Node/브라우저 공통** | ①②모드 |
| `client-session.ts` | 입력 송신 + 로컬예측 + 원격보간 + reconcile + 탄환/사망 이벤트 적용 | 전 클라 |
| `peer-session.ts` | (E단계 seam) 피어/피해자권한 폴백 전략 | ③모드 |
| `server.js` (루트) | agent8 서버함수: joinRoom/룸상태/브로드캐스트 릴레이 + 리더보드 | 배포 |
| `server/host.ts` | Node 헤드리스 호스트 엔트리 (코어+transport, headless — PIXI 없음) | ①모드 |

**설계 원칙**: `host-session`/`client-session`은 `transport` 인터페이스에만 의존(agent8 구체 API 아님) → loopback으로 완전 테스트 가능. 코어(`src/core/*`)는 **무수정** (이미 서버권위 변종).

## 4. 데이터 흐름

### 4.1 입력 (클라 → 호스트)
- 클라가 매 틱 `control` 비트마스크 + mouseAimX/Y를 인코딩 → `remoteFunction('input', ..., {throttle:~33, needResponse:false})`.
- 호스트는 입력을 플레이어별 최신값 버퍼에 저장, updateFrame **전** 해당 `sprite.control`에 주입.
- 시퀀스 번호 포함 → 클라 reconcile용.

### 4.2 스냅샷 (호스트 → 전체)
- ~20-30Hz. 활성 병사만: `{account, num, posX, posY, velX, velY, direction, legsAnim/frame, bodyAnim/frame, health, jetsCount, weaponNum, team, deadMeat, ...}` + teamScore + 깃발 상태(운반자/위치) + 마지막 처리 입력 seq(플레이어별).
- 바이너리 팩(병사당 ~24바이트) → 8인 스냅샷 ~200바이트, 25Hz = ~5KB/s. 릴레이 감당 범위.
- 클라: 원격 병사는 스냅샷 2개 사이 보간(~100ms 버퍼). 내 병사는 reconcile(§4.4).

### 4.3 탄환/이펙트 (이벤트 기반)
- **탄환 생성**: 호스트(권위)가 발사 확정 시 `bulletCreate` 이벤트 브로드캐스트 `{owner, posX, posY, velX, velY, weaponNum, style, seq}`. 각 클라 `createBullet`으로 로컬 스폰 후 자체 탄도 시뮬(맵+생성값이면 궤적 재현). **스냅샷에 탄환 안 실음**.
- **데미지/사망**: 호스트 코어의 `healthHit`/`die`가 판정 → 사망은 스냅샷 deadMeat + `kill` 이벤트(killer/victim/weapon)로 전파(킬피드·스코어).
- 스파크/사운드는 클라 로컬(탄환·충돌에서 파생) — 네트워크 불필요.

### 4.4 로컬 예측 & 보정 (client-session)
- 내 병사: 로컬에서 매 틱 입력 즉시 적용 + `updateFrame` 부분 실행(내 sprite만) → 지연 0 이동.
- 호스트 스냅샷 수신 시: 스냅샷의 "마지막 처리 입력 seq" 이후 입력들을 재적용(rollback&replay) 하거나, 위치 오차가 임계(예: >8px) 넘으면 부드럽게 스무딩. **1차는 스무딩(간단), 정밀 rollback은 E단계 여지.**
- 원격 병사: 예측 없이 스냅샷 보간만.

## 5. 로비

### 5.1 화면 플로우 (`src/web/lobby/`)
```
타이틀 → 로비 → 룸 → 인게임 → (라운드끝) → 룸/로비
```
- **로비**: 닉네임 입력, 룸 목록(`soldat_rooms` 컬렉션, 인원/모드 표시), 빠른입장(빈자리 방 자동), 방 만들기(DM/CTF 선택).
- **룸**: 참가자 목록, 모드별 팀선택 — DM=팀없음(TEAM_NONE), CTF=Alpha/Bravo/Spectator(원작 Select Team). Ready 토글. 호스트가 Start.
- **인게임**: M2 렌더러 재사용 + 원격 병사 렌더(GostekPool은 이미 다병사 지원) + 킬피드/스코어보드 HUD.
- **라운드끝**: 스코어보드 → 룸 복귀.

### 5.2 룸 상태 스키마 (agent8 룸상태, flat key)
- `mode`(dm/ctf), `hostAccount`, `roundEndsAt`, `started`(bool)
- `p_{account}`: `{nick, team, ready, kills, deaths, joinedAt}`
- 룸 컬렉션 `soldat_rooms`: `{key, count, mode, started}` (로비 목록용)

## 6. 마일스톤 (서브에이전트 구현 → 충실도/품질 리뷰)

| 단계 | 산출물 | 완료 기준(검증) |
|---|---|---|
| **A. 전송+로비** | transport.ts(provider주입)·loopback.ts·protocol.ts 골격·server.js(룸/릴레이)·로비 UI(타이틀/로비/룸/팀선택) | loopback으로 2세션이 같은 방 입장+팀선택 (헤드리스 테스트). 브라우저 로비 UI 동작 |
| **B. 호스트권위 이동** | host-session·client-session(이동)·입력릴레이·스냅샷·예측/보간·다병사 렌더 배선 | loopback 2세션: 한쪽 이동이 다른쪽 화면에 부드럽게 반영. 스냅샷 대역폭 측정 |
| **C. 전투 네트워킹** | bulletCreate 이벤트·호스트 데미지판정·kill/사망/리스폰 동기화·스코어·킬피드 | loopback 2세션: 서로 쏴서 데미지·사망·리스폰·스코어 증가. CTF 깃발 캡처 동기화 |
| **D. 전용 서버** | server/host.ts(Node 헤드리스)·agent8-in-node 스파이크(플랜B: 자체 ws+터널) | Node 호스트가 loopback/실릴레이로 권위 시뮬 구동, 클라 접속 |
| **E. 폴리시+폴백** | 호스트 마이그레이션(브라우저)·재접속·peer-session seam·오프라인폴백·플레이테스트·Verse8 배포 문서 | 호스트 이탈 시 게임 지속. 배포 가이드. (실 크로스브라우저는 사용자 `npx @agent8/deploy` 후) |

## 7. 테스트 전략

- **loopback 트랜스포트**로 배포 없이 N세션을 한 프로세스에서 연결 → 헤드리스 vitest에서 "2 클라 + 1 호스트" 통합 시나리오 (입장·이동동기화·전투동기화·스코어) 검증. **이게 M3의 주 검증 수단.**
- 단일 브라우저에서 loopback으로 2세션(분할화면 or 2탭 시뮬)로 시각 확인.
- protocol (역)직렬화 라운드트립 단위테스트.
- 실 agent8 배포·크로스브라우저는 **사용자의 Verse8 계정 + `npx @agent8/deploy`** 최종 단계 (E). 미배포 시 오프라인(싱글/봇전) 폴백 유지.
- 기존 221 테스트 그린 유지, 코어 무수정.

## 8. 리스크·주의

1. **agent8-in-node 미확인**: `@agent8/gameserver` 클라가 Node 헤드리스에서 도는지(브라우저 WebSocket 의존?) — D단계 첫 스파이크로 확인. 안 되면 전용서버는 자체 ws + Cloudflare 터널([[project_freeciv_web_verse8]] 패턴) 플랜B.
2. **스냅샷 대역폭**: 8인 25Hz ~5KB/s 예상이나 릴레이 실측 필요(B단계). 초과 시 관심영역/델타압축.
3. **탄환 데미지 권위 vs 클라 시뮬 불일치**: 클라 탄도는 시각용, 데미지는 호스트 판정만 신뢰(피격 판정은 호스트에서). 클라 탄환은 맞아도 호스트가 확정할 때까지 데미지 없음(레이턴시만큼 지연 — Soldat도 동일).
4. **결정론 불요**: 호스트권위라 클라 예측은 근사+보정으로 충분(록스텝 아님). RNG 시드 동기화 불필요.
5. **미배포 로컬 개발**: loopback이 주 개발/검증 수단이므로 transport는 반드시 provider 주입식 + offline 폴백.
6. 코어(`src/core/*`) 무수정 원칙 — 네트워킹은 전부 `src/net/` + `src/web/lobby/`.

## 9. 범위 밖 (M4+)
호스트 정밀 rollback&replay(1차는 스무딩), 관심영역 컬링(8인 이하 불요), 안티치트 심화, 관전자 카메라, 매치메이킹 랭킹, 음성/채팅.
