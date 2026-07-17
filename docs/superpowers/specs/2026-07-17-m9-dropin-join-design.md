# M9: 진행중 방 난입(drop-in join) + 라운드 무한 순환 — 설계

## 배경 (사용자 요청)
원작처럼 **시작된 방이라도 들어가서 같이 즐길 수 있어야** 한다. 라운드가 끝나면 방이 죽는 게
아니라 그 방 옵션대로 새 게임이 시작되고, 방장이 나가면 남은 사람이 호스트를 승계해 계속된다.

## 이미 있는 것 (재사용 — 수정 금지 아님, 근거)
- **라운드 순환**: 코어가 킬리밋/시간제한 도달 시 changeMap(같은 맵 재시작)으로 무한 순환
  (game.ts). M8 applyMatchSettings가 svTimelimit 재무장까지 처리 — 방이 "터지는" 개념 자체가 없음.
- **호스트 승계**: M3-E 호스트 마이그레이션(hostEpoch, electHost=joinedAt 최선참, 무텔레포트
  승계, 스플릿브레인 강등). "가장 핑 좋은 사람" 대신 **최선참 기준**(핑 측정 인프라 없음 — 편차
  기록, 동작상 동일 목적).
- **완전 스냅샷**: SNAPSHOT이 매 2틱 전체 상태(스프라이트 38B+깃발)라 늦게 합류한 클라도
  수신 즉시 따라잡음 — 델타 아님이 난입에 유리.
- **ASSIGN 재방송**: 60틱마다 전원 슬롯 재통지 — 늦합류자 슬롯 인지 경로 이미 존재.

## 만들 것
1. **로비: 진행중 방도 Join 가능** — lobby-ui drawRooms의 `started ? '진행중' : Join` 분기를
   Join 버튼 상시 표시로(정원 초과 시에만 비활성). i18n로 "Join(진행중)" 라벨 구분.
2. **난입 클라 흐름**: started 방에 joinRoom → room 화면 대신 **곧장 매치 진입**
   (roomState.started && settings 존재 시 onStartMatch 즉시 발화). 클라는 settings.mapKey로
   같은 맵 로드 + applyMatchSettings → ClientSession으로 스냅샷 수신 시작.
3. **호스트: 늦합류자 스폰** — host-session이 매치 중 roomState의 새 p_{account}를 감지
   (onRoomState 구독 유지)해 createSprite+ASSIGN(+즉시 스냅샷). 팀은 p_.team(난입자는 room
   화면을 안 거치므로 CTF면 인원 적은 팀 자동배정 — 클라가 joinRoom 시 p_에 기록).
4. **이탈 정리**: p_ 제거된 계정의 스프라이트 비활성화(호스트). leaveRoom 시 p_ null은 기존.
5. **방 목록 count/started 갱신**: touchRoom 하트비트가 매치 중에도 유지되도록 넷 매치 루프에서
   방장 주기 호출(로비 화면 밖에서도). started=true 반영 → 목록에 "진행중 · Join 가능" 표기.

## 스코프 밖 (기록)
- 핑 기반 호스트 선출(측정 인프라 없음 — joinedAt 최선참 유지).
- 관전자(Spectator) 난입 후 팀 변경 UI(다음 사망 시 팀 반영 등) — 후속.

## 검증
- LOOPBACK 통합: 매치 started 후 3번째 클라 난입 → 호스트가 스폰+ASSIGN, 난입자 스냅샷으로
  기존 2인 위치 수신, 난입자 이동이 호스트에 반영. 이탈 시 스프라이트 비활성.
- 유닛: 늦합류 감지(diff p_ keys), 팀 자동배정(적은 팀), started 방 Join 게이트(정원).
- 브라우저(loopback): 방 목록에서 진행중 방 Join 동선 확인.
- 게이트: tsc/전체 테스트/build, src/core 무수정.
