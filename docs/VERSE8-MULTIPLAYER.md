# Verse8(agent8) 멀티플레이 구현 가이드

> V8 JETFALL(soldat-web)에서 실전 검증된 내용의 총정리.
> 다른 게임에서 재사용할 범용 가이드는 `verse8-starter/docs/VERSE8-MULTIPLAYER.md`에 복사본이 있다.
> 이 문서의 모든 항목은 **라이브 배포에서 실제로 터졌고, 고쳐서 검증된 것들**이다.

## 0. 전체 아키텍처 (호스트 권위 + 릴레이)

Verse8 gameserver(agent8)는 **게임 로직 서버가 아니라 릴레이+상태저장소**다.
서버(server.js)는 isolated-vm에서 돌고 타이머/네트워크/fs가 없다 → 60Hz 시뮬은 서버에서 못 돌린다.

구조:
```
클라이언트(방장) = 호스트: 60Hz 권위 시뮬 실행
  ├─ 입력: 각 클라 → relayHot(INPUT) → 호스트
  ├─ 상태: 호스트 → relayHot(SNAPSHOT, 2틱=30Hz) → 전 클라
  ├─ 이벤트(탄환/킬/배정): relay(JSON) — 신뢰성 채널
  └─ 방 목록/설정: $global 컬렉션 + $room roomState
서버(server.js) = 클래스 1개, relay/relayHot·방목록 CRUD만
```

- 클라는 로컬 공유심(같은 코어)을 돌리며 스냅샷으로 보정 — 지연 체감 최소화.
- 호스트 이탈 → **joinedAt 최소(가장 오래된) 클라가 승격** (hostEpoch로 스플릿브레인 방지).
- 진행중 방 난입: 목록의 started 방 Join → 호스트 syncRoster가 스폰 + 즉시 ASSIGN.
- 죽은 방 가드: 클라가 8초간 스냅샷 못 받으면 오프라인 봇전으로 폴백.

## 1. ⚠️ 접속은 반드시 SDK 스토어를 통해서 (최대 함정)

`@agent8/gameserver`의 zustand 스토어(`useGameServerStore`)는 **import되는 순간**
window focus/visibilitychange 리스너를 전역 등록하고, 스토어의 `connected`가 false면
**포커스될 때마다 `server.connect()`를 강제 재호출**한다. SDK의 connect()는 열린 소켓을
무조건 찢고 재생성하므로, GameServer를 직접 connect하면(스토어 플래그 영원히 false)
**창 전환마다 연결이 찢기는 무한 재접속 폭풍**이 발생한다.

```ts
// ✅ 정답 — 스토어 경유 (exports 맵이 없어 딥임포트 가능)
const { useGameServerStore } = await import('@agent8/gameserver/dist/src/store/useGameServerStore')
const st = useGameServerStore.getState()
if (!st.connected) void st.connect()          // 완료는 promise가 아니라 connected 플래그로
while (!useGameServerStore.getState().connected) await sleep(200) // 예산 내 폴링
useGameServerStore.subscribe(({ connected }) => { /* 끊김='connecting' 미러링만, 재connect 금지 */ })
const server = GameServer.getInstance()        // 스토어와 같은 싱글턴 — remoteFunction 등 그대로 사용

// ❌ 금지 — server.connect() 직접 호출, 실패 시 connect() 재호출(붙는 중 소켓을 찢음)
```

성공 콘솔 시그니처: `Attempting initial connection...` → `connect false` 1회 → `Connected` → 조용.

## 2. 호출 캡: relay / relayHot 분리

remoteFunction 호출 캡은 **함수 이름별**이다. 고빈도(스냅샷/입력)를 일반 relay로 보내면
"Too many calls to the function. Use throttle option."이 터진다.

```js
// server.js — 같은 브로드캐스트지만 이름을 나눠 캡 분산
relay(event, payload)    { $room.broadcastToRoom('relay', { event, payload, from: $sender.account }) }
relayHot(event, payload) { $room.broadcastToRoom('relay', { event, payload, from: $sender.account }) }
```
```ts
// 클라 — 고빈도만 throttle 옵션
server.remoteFunction('relayHot', [event, payload], { throttle: 50 }) // 스냅샷/입력 (latest-wins, 드롭 무방)
server.remoteFunction('relay', [event, payload])                      // 탄환/킬/ASSIGN (신뢰성)
```

### 2-1. ⚠️ 송신 주기는 throttle 값에 정렬 (렉의 숨은 원인)

throttle보다 빠르게 보내면 SDK가 **초과분을 조용히 드롭**한다. 스냅샷을 33ms(2틱)마다
보내며 throttle 50이면 매 3번째가 드롭돼 **33-66ms 불균일 스트림** = 원격 플레이어가
덜컥거리고 러버밴딩한다. **송신 주기를 throttle의 배수(예: 60Hz 기준 3틱=50ms)로 정렬**하면
드롭 0의 균일 스트림이 된다. 입력(INPUT)도 동일.

### 2-2. ⚠️ 다발 이벤트는 배치로 (호출 캡)

신뢰성 relay도 함수 이름별 호출 캡이 있다. "탄환 1발 = relay 1회"면 샷건 펠릿(한 틱에
다발)·연사 무기가 캡("Too many calls")을 때려 전투 중 히치가 난다. **틱당 신규 이벤트를
고정 크기 레코드 연접(concat) 1회 호출로 배치**하고 수신측이 레코드 크기로 분할할 것.

## 3. ⚠️ 컬렉션 API 시그니처 (조용한 no-op 함정)

문서: docs.verse8.io/en/docs/gameserver/sdk/globalCollection

- `addCollectionItem(collectionId, item)` → 생성, 자동 `__id` 부여
- `updateCollectionItem(collectionId, item)` → **2인자!** `item.__id`로 기존 아이템 갱신
- `getCollectionItems(collectionId, { limit })` / `deleteCollectionItem(collectionId, __id)`

`updateCollectionItem('rooms', key, data)` 같은 3인자 호출은 **에러 없이 아무것도 안 쓴다**
(방 목록이 영원히 빈 배열이던 버그의 원인). 우리 식별자(key)로 upsert하려면:

```js
async _upsertRoom(key, data) {
  const rooms = await $global.getCollectionItems('soldat_rooms', { limit: 100 }).catch(() => [])
  const existing = rooms.find((r) => r.key === key)
  const item = { ...(existing || {}), key, ...data, at: Date.now() }
  if (existing && existing.__id) await $global.updateCollectionItem('soldat_rooms', item)
  else await $global.addCollectionItem('soldat_rooms', item)
}
```

## 4. 방 목록 = 하트비트 + 스테일 필터

- 방장이 **5초마다 touchRoom**(위 upsert + `at` 타임스탬프) — 방 화면에서도, 매치 중에도.
- listRooms는 `at`이 **90초** 이상 오래된 방을 숨기고 best-effort 삭제.
  - 20초로 하면 안 되는 이유: 방장이 탭을 백그라운드로 두면 Chrome intensive throttling이
    setInterval을 **분당 1회**까지 늦춘다 → 산 방이 목록에서 증발.
- 같은 key 중복(동시 업서트 레이스)은 최신 `at`만 노출.

## 5. roomState 쓰기는 needResponse + 재시도

릴레이 WS는 플랩할 수 있다. fire-and-forget `updateRoomState`는 조용히 유실돼
"설정/팀/레디 클릭이 반영 안 됨"이 된다.

```ts
for (let i = 0; i < 3; i++) {
  try { await server.remoteFunction('updateRoomState', [patch], { needResponse: true }); return }
  catch (e) { if (i === 2) throw e; await sleep(300) } // 소진 시 던져 UI가 토스트
}
```

## 6. 바이너리 페이로드는 base64 래핑

relay는 payload를 JSON 직렬화한다 — 원시 ArrayBuffer는 `{}`로 깨진다.
보낼 때 `{ __b64: base64 }`로 감싸고 받을 때 복원. (평문 객체는 그대로.)

## 7. 핑 표시 패턴

- 각 클라: 3초마다 `remoteFunction('now')` 왕복시간 측정(= 릴레이 RTT).
- 클라 → 호스트: 저빈도 JSON `PING {ping}` 보고.
- 호스트: 1초 주기 ASSIGN 재방송에 `{account, num, nick, ping}` 실어 전원 배포.
- 스코어보드는 num→ping 맵을 읽기만.

## 8. 배포 (GitLab develop + V8 AI)

- 리포: `gitlab.verse8.io/<계정>/<레포>` — **develop 브랜치**가 배포 대상.
- 서버 진입점 우선순위: **루트 server.js > server/dist/server.js** — 구조화 프로젝트면
  루트 server.js를 두지 말 것(빌드 산출물을 가로챈다).
- 배포 브랜치 불변식: 플랫폼 `.env`(agent8 바인딩) 유지 / **package-lock.json 금지**(bun 마이그레이션 깨짐) / PROJECT/ 문서 보존.
- `npx @agent8/deploy` 수동 실행은 401이 정상(플랫폼이 배포).
- 빌드 후 **게시(Publish)는 별도 스텝** — V8 AI가 "게시 준비 완료"에서 멈추면 게시를 명시적으로 요구할 것.

V8 AI 표준 프롬프트(변경 push 후 매번):
```
develop 브랜치 최신을 배포해줘: <변경 요약>.
1. git fetch origin develop && git reset --hard origin/develop 로 워크스페이스 동기화
2. bun install 후 클라이언트와 서버(server/src/server.ts) 둘 다 빌드·배포
3. 미리보기 재빌드 후 게시(Publish)까지 실행
4. src/core/ 수정 금지, .env 그대로, package-lock.json 만들지 마. 에러는 그대로 보고해줘.
```

## 9. 디버깅·검증 노하우

- **로컬에서 실백엔드 접속**: 배포 브랜치의 `.env`(VITE_AGENT8_VERSE 등)를 로컬에 복사하면
  vite dev가 `<verse>-preview` 백엔드에 게스트로 붙는다 → 콘솔덤프 왕복 없이 직접 디버깅.
  단, **서버코드(server.js) 변경은 V8 재배포 후에만 반영**(로컬 클라도 배포된 서버함수를 호출).
- **dev 진단 핸들**: `if (import.meta.env.DEV && typeof window !== 'undefined') window.__a8 = { server, store, transport }`
  → 콘솔에서 remoteFunction을 직접 때려 "쓰기 성공+읽기 빈배열" 같은 비대칭을 즉석 증명.
- **2인 E2E는 Puppeteer 2개**: 브라우저 패널/일반 탭은 백그라운드에서 타이머·rAF가 얼어
  호스트 시뮬이 멈춘다(가짜 "죽은 방"). 플래그 필수:
  `--disable-background-timer-throttling --disable-backgrounding-occluded-windows --disable-renderer-backgrounding`
  (headless 'new'는 rAF 정상 구동). 계정 분리는 프로필 분리로 자동
  (같은 브라우저 탭 2개면 localStorage `agent8:temporary_account` 공유 → 한쪽에서 삭제).
- **동기화 증명은 좌표 대조**: 양 클라의 스프라이트 월드좌표 덤프가 수 픽셀 내 일치하면 확정
  (스크린샷보다 강력). 게임 상태를 `window.__soldatNet` 류 dev 핸들로 노출해 두면 편하다.
- **콘솔 노이즈 무시 목록**: contentscript.js/MaxListeners/ObjectMultiplex(지갑 확장),
  GameAuth·React #418/#422(verse8.io 플랫폼) — 우리 번들(index-*.js)만 보면 된다.

## 10. 서버 코드 규약 (server.js / server/src/server.ts)

- 클래스 1개, export 금지(TS 진입점은 export class 허용 — V8 빌드가 처리), **setTimeout/setInterval 금지**.
- 전역 주입: `$global`(joinRoom/컬렉션), `$room`(roomState/broadcastToRoom), `$sender`(account, isGuest 등).
- `$roomTick(deltaMS)` 정의 시 200-1000ms 주기 서버 로직 가능(우린 미사용 — 호스트 권위라 불필요).
- 로컬 tsc용 ambient 선언(`server/src/globals.d.ts`)을 두면 편하다 — V8 빌드는 타입체크 안 함.
