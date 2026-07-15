# M7: 리스폰 대기시간 설정 + 3초 무적 + 무기창 개방창 제한 + 1/2 무기전환 — 설계

전부 웹 레이어(src/web, src/net, server). **코어(src/core) 무수정.** 코어에 이미 필요한
필드/로직이 있어 값 세팅과 UI 배선만 한다.

## 1) 리스폰 대기시간 (매치 설정)
- 코어: 사망 시 `respawnCounter = gs.svRespawntime` (sprites.ts:1426). 기본 360틱(6s).
- Offline Bots 화면에 "Respawn Time" 선택 추가: 0 / 2 / 4 / 6(기본) / 8 / 10초. localStorage
  (`jetfall.respawn.v1`) 저장·복원.
- `onOfflineBots(mode, mapKey, respawnSeconds)` → `startBotMatch(mode, mapKey, respawnSeconds)`
  → `loadGameAssets(ctf, mapKey, respawnSeconds)`에서 `gs.svRespawntime = round(respawnSeconds*60)`.
- 새 i18n 키 `offline.respawnTime` (5개 언어 전부).

## 2) 리스폰 3초 무적 + 반짝임
- 코어: 리스폰 시 `ceaseFireCounter = gs.ceaseFireTime` (sprites.ts:3538), 무적 중 알파 점멸은
  TSprite.Update가 이미 렌더(반짝임 자동). 데미지/발사는 `ceaseFireCounter < 0`에서만(자동 무적).
- `gs.ceaseFireTime = 180`(3s)로 세팅 — loadGameAssets(봇전/넷전/ws 공용 진입) + 전용 Node
  호스트(server) 양쪽. 고정값(설정 아님).

## 3) 무기선택창 = "개방창(open window)" 동안만
- 개방창 정의: **`deadMeat`(사망 후 리스폰 대기)** 또는 **`ceaseFireCounter > 0`(리스폰 후 무적중)**.
  첫 스폰도 무적중이라 자연히 열림.
- 창이 닫히는 순간(살아있음 && ceaseFireCounter ≤ 0): 메뉴 **자동 닫힘**. 이후 다음 사망 전까지
  Q로 재오픈 불가, pick 불가(잠금). 다음 사망(deadMeat 전이)에 다시 개방·잠금해제.
- 구현(loadout-menu.ts, 웹): `poll()`에서 개방창 판정. 창 진입 시 open, 창 이탈 시 close+lock.
  `toggle()`/`open()`은 개방창일 때만 실제 오픈. `pick()`은 개방창 아니면 무시. (기존 "죽어있으면
  다음 respawn 지급 / 살아있으면 즉시 장착" 로직은 유지 — 무적중 살아있을 때 고르면 즉시 장착됨.)
- 힌트 문구 갱신: "Click to equip" 톤 유지, Q는 창 토글(개방창 한정)로 안내.

## 4) 무기 전환: 1=주무기 / 2=보조무기 (Q 스왑 제거)
- 현재: `Q`=`control.changeWeapon`=주↔보조 토글 스왑(원작). → **이 매핑 제거.** Q는 무기창 전용.
- 신규: `Digit1`→주무기 슬롯, `Digit2`→보조무기 슬롯 직접선택. 코어 스왑은 토글뿐이므로
  "요청 슬롯 ≠ 현재 든 슬롯"일 때만 `changeWeapon`을 **한 틱(엣지 트리거)** 발동 → 정확히 1회 스왑.
  이미 그 슬롯이면 무동작.
- 현재 슬롯 판정(코어 무수정, gs 읽기만): 주무기 num = `spr.selWeapon`, 보조 num =
  `guns[PRIMARY_WEAPONS + player.secWep + 1].num`. `spr.weapon.num`과 비교.
- 배선: input.ts는 Digit1/Digit2 keydown 엣지를 잡아 `consumeSlotSwitch(): 1|2|null` 노출(1회
  소비). main.ts 프레임 루프가 `input.applyTo(...)` 뒤 요청을 읽어, 현재 슬롯과 다르면
  `control.changeWeapon = true`(그 틱 한정) 세팅. 로컬 병사만 대상.
- 무기창 열려있는 동안엔 1/2 스왑 억제(창 조작과 충돌 방지 — menuOpen 게이트).

## 검증
- 단위테스트: (a) svRespawntime 세팅→사망 후 respawnCounter가 그 값, (b) ceaseFireTime=180→
  리스폰 후 ceaseFireCounter=180, (c) 개방창 로직(사망중/무적중 open, 무적종료 후 close+lock,
  잠금중 pick 무시), (d) 슬롯스위치 엣지: 현재≠요청일 때만 changeWeapon 1회, 같으면 무동작.
  i18n 키셋 완전성 테스트가 새 키 자동 강제.
- 브라우저 눈검증: Offline에서 리스폰시간 선택→사망 후 그 시간만큼 대기, 리스폰 시 반짝임(무적),
  무적 동안 무기창 열려 선택 가능→무적 끝나면 창 닫히고 Q 눌러도 안 열림, 1키=주무기/2키=보조무기
  전환, Q는 창 토글만. 콘솔 에러 없음.
- 게이트: tsc clean, 전체 테스트 green, vite build OK, `git diff --stat main..HEAD -- src/core`
  비어있음.
