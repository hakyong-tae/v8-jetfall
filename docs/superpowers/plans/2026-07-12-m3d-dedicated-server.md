# M3 Phase D: 전용 Node 헤드리스 호스트 구현 계획

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement task-by-task. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Phase A/B/C(전송+로비+이동+전투, 264 테스트 그린)가 만든 `HostSession`/`ClientSession`/`Transport`를 그대로 재사용해, **상시 구동되는 Node 헤드리스 프로세스**(`server/host.ts`)가 권위 시뮬을 돌리게 한다(스펙 §3.1-①, §6-D, §8-리스크1). 배포 모드 ②(브라우저-호스트, 마이그레이션 O)와 별개로 이건 마이그레이션 없는 **영구 호스트**다. 완료 기준: `npm run host`가 헤드리스로 기동해 60Hz 틱을 돌리고 스냅샷을 브로드캐스트하며(loopback/스텁 트랜스포트로 검증, 실 배포는 사용자 `npx @agent8/deploy` 이후 E단계 몫), agent8-in-node 가부가 런타임에 자동 판별되어 안 되면 자체 ws 서버로 폴백한다.

**Architecture:** `HostSession`은 이미 `Transport` 인터페이스에만 의존한다(무수정 재사용) — D단계가 새로 만드는 건 (1) Node에서 그 `Transport`를 어떻게 구하는가(agent8-in-node 시도 → 실패 시 자체 ws 서버, §설계 결정 1), (2) Node에서 에셋을 fetch 대신 `node:fs`로 어떻게 로드하는가(§설계 결정 2), (3) 상시 프로세스의 부트/롭스터/시그널 처리(`server/host.ts`), (4) 브라우저 클라가 "이 룸엔 전용호스트가 있다"를 어떻게 알고 배선을 바꾸는가(§설계 결정 3)다. 코어(`src/core/*`)와 Phase A/B/C 산출물(`src/net/host-session.ts`/`client-session.ts`/`protocol.ts`/`transport.ts`/`loopback.ts`)은 **무수정**.

**Tech Stack:** TypeScript, Vitest, Node 23.11.0(글로벌 `WebSocket` 클라 구현 있음 — 확인됨, 아래 스파이크 근거). 번들러는 **esbuild**(vite의 전이의존성으로 이미 `node_modules/.bin/esbuild`에 설치돼 있음 — 확인됨, 신규 의존성 최소화를 위해 `tsx` 대신 채택하고 `devDependencies`에 명시만 추가) — 이유: 이 레포의 상대 import는 확장자가 없어(`from '../core/state'`) Node 네이티브 `--experimental-strip-types`(Node 23 지원 확인됨)만으로는 `ERR_MODULE_NOT_FOUND`가 난다(타입만 벗기고 경로 해석은 안 해줌) — esbuild 번들이 확장자 문제를 해결해준다.

---

## 선행 사실 (읽은 것 요약)

1. **스펙** §3.1(3배포모드 표)·§6-D(산출물/완료기준)·§8-리스크1(agent8-in-node 미확인, 플랜B=자체ws+터널) 확인.
2. **Phase B/C 산출물 재확인**(무수정 재사용 대상): `src/net/host-session.ts`(`HostSession` — 생성자가 `Transport`+`GameState`만 받음, `spawnPlayers([{account,team}])`→`MSG.ASSIGN`, `tick()`이 입력적용→`updateFrame`→탄환/킬 diff 브로드캐스트→2틱마다 스냅샷, `startLoop(intervalMs)`가 **이미 `setInterval`로 구현돼 있음** — D단계가 재발명할 필요 없음, 그대로 호출), `src/net/client-session.ts`(`ClientSession`), `src/net/transport.ts`(`makeAgent8Transport(provider)` + `realProvider()` — **`realProvider()`는 `import.meta.env.VITE_AGENT8_VERSE`를 읽는데 이건 Vite 전용 치환 문법, esbuild로 Node용 번들을 만들면 `import.meta.env`가 `undefined`라 `!!undefined.VITE_AGENT8_VERSE`가 던진다** — D단계는 `realProvider()`를 그대로 못 쓰고 Node 전용 provider 팩토리를 새로 만든다(§설계 결정 1의 근거)), `src/net/loopback.ts`(`LoopbackHub` — 헤드리스 스모크테스트용으로 재사용), `src/net/lobby-client.ts`(`LobbyClient.net` getter — 이미 Phase B가 추가해둠, `roomState` 필드가 public이라 D단계가 `dedicatedHostUrl` 필드를 그냥 읽을 수 있음), `server.js`(agent8 서버함수 — **CAP=8**, `joinRoom`/`updateRoomState`/`relay` 규약. **타이머 금지**는 이 파일에만 해당 — `server/host.ts`는 agent8 서버함수가 아니라 독립 Node 프로세스이므로 무관, 타이머 사용 가능).
3. **`src/tests/helpers.ts`**: `setupTestGame({emptyMap?})`가 `node:fs`로 `public/assets/anims`·`public/assets/maps`를 읽어 `GameState`를 만드는 정확한 패턴(`assetsDir = path.resolve(...,'../../public/assets')`, `readAssetLines`가 `anims/<basename>`을 읽음). `src/tests/net-c-integration.test.ts`는 여기에 `weapons.json`을 `readFileSync`+`JSON.parse`로 추가 로드하는 패턴(`createWeapons(false)`→`loadWeaponsConfig(weaponsJson.normal)`)까지 보여준다 — **D단계 에셋 로더는 이 두 패턴을 그대로 합친 것**(§설계 결정 2). `helpers.ts`는 `src/tests/`에 있어 테스트 전용 모듈이므로 프로덕션 `server/`에서 직접 import하지 않고(테스트/런타임 경계 유지), 같은 fs 로직을 `server/host-assets.ts`로 별도 작성한다(중복 ~25줄, Phase B/C도 코어 무수정 원칙상 유사한 국소 중복을 감수한 전례 있음).
4. **환경 확인(직접 실행, 결과 아래 인용)**:
   - `node_modules/@agent8` **미설치**(배포시에만 설치되는 선택적 의존성 — 스펙 §2 재확인) → agent8-in-node는 **로컬에서 직접 실행 검증 불가**, 실 스파이크는 사용자가 `npx @agent8/deploy`(또는 최소 `npm install @agent8/gameserver`)한 뒤에만 실행 가능. 이 계획은 그 시점에 자동으로 참/거짓을 가리는 **런타임 폴백 로직**으로 스파이크를 구조화한다(수동 1회성 실험이 아니라 상시 안전장치).
   - `node -v` → `v23.11.0`. `typeof WebSocket` (글로벌, 스크립트 최상단) → `"function"` — Node 23은 클라이언트 `WebSocket`을 내장 제공(undici 기반). **긍정적 신호**(agent8 SDK가 `new WebSocket(url)` 표준 Web API만 쓰면 Node에서도 될 가능성) **but 보장 아님**(SDK가 `window`/`navigator`/`localStorage` 등 다른 브라우저 전역에 의존할 수도 있음 — 미설치라 정적 확인 불가).
   - `node --experimental-strip-types <file>.ts` → **동작 확인됨**(간단한 타입 스트립 성공, 경로 해석은 별개 이슈 — 위 Tech Stack 참조).
   - `node_modules/.bin/esbuild` **존재**(vite 전이의존성, v0.28.1). `node_modules/ws` **미설치**. `npm ping` → 레지스트리 도달 가능(오프라인 아님, Plan B 채택 시 `npm install ws` 가능).
   - `npx vitest run` → **264/264 통과**(26 test files) — 회귀 없음 확인, 이 계획의 각 태스크는 이 카운트를 유지해야 한다(신규 테스트 추가분만큼 증가는 정상).
5. **`package.json`**: `type:module`, `pixi.js`만 런타임 의존성, devDeps에 `jimp`/`typescript`/`vite`/`vitest`뿐 — `esbuild`/`ws`는 D단계가 처음 명시적으로 추가.

---

## 설계 결정

### 설계 결정 1 — agent8-in-node를 "1회성 수동 스파이크"가 아니라 "상시 런타임 폴백"으로 구조화

**문제**: `@agent8/gameserver`가 Node 헤드리스에서 되는지 로컬에서 검증할 수 없다(미설치, 배포시에만 설치되는 선택적 의존성). 사용자가 배포 준비를 하고 `@agent8/gameserver`를 설치하기 전까지 참/거짓을 알 방법이 없다.

**해결**: 스파이크를 "한 번 실행해서 결과를 코드에 하드코딩"하는 대신, **`server/node-transport.ts`가 매 부팅마다 실측**하게 만든다:
1. `process.env.VITE_AGENT8_VERSE`가 설정돼 있으면 `@agent8/gameserver`를 동적 `import()`(패키지 없으면 즉시 reject → catch)하고, 있으면 `GameServer.getInstance().connect()`를 **타임아웃(4s)** 걸고 시도한다.
2. 성공(`connect()`가 resolve, `account`가 채워짐)하면 **행복경로**: `makeAgent8Transport`류 래퍼(D단계가 Node용으로 재구성, 아래 코드)를 그대로 쓴다 — 브라우저 클라와 **완전히 같은 agent8 릴레이**를 통해 스냅샷/입력이 오간다. 추가 인프라(ws 서버·터널) 불필요.
3. 실패(패키지 없음/타임아웃/`connect()` reject)하면 **플랜B로 자동 폴백**: `server/ws-host-transport.ts`(자체 `ws` 서버)를 기동하고, 콘솔에 `[host] agent8-in-node unavailable (reason) — falling back to own-ws on :<port>` 로그를 남긴다.
4. 결과는 로그로 남되 **프로세스는 항상 뜬다** — 이게 "결정 게이트"의 실질: 사람이 미리 고르는 게 아니라 그 순간의 실측이 고른다. 두 분기 모두 완전히 코드로 존재하므로(아래 T1/T3), `@agent8/gameserver`가 나중에 설치되는 순간 재실행만으로 행복경로가 자동 활성화된다 — 코드 변경 불필요.

이 로직 자체(패키지 없음→즉시 폴백, 타임아웃→폴백, 성공→행복경로)는 **가짜 provider를 주입해 지금 당장 유닛테스트 가능**(T1) — `transport.ts`가 이미 쓰는 provider-injection 패턴을 그대로 재사용한다.

### 설계 결정 2 — Node 에셋 로더는 `helpers.ts`를 참고해 새로 작성(재사용 아님)

`server/host-assets.ts`는 `tests/helpers.ts`의 `setupTestGame`과 `web/main.ts`의 `loadGameAssets`를 **fs 버전으로 합친 것**이다: 맵/애니메이션(`readAssetLines`+`loadAnimObjects`+`loadSpriteObjects`+`loadThingObjects`+`loadMapFile`+`loadWaypoints`)은 `helpers.ts` 그대로, 무기(`createWeapons`+`loadWeaponsConfig`)는 `net-c-integration.test.ts`가 쓰는 fs 패턴 그대로, 게임모드(`svGamemode`/`svKilllimit`)는 `main.ts`의 `loadGameAssets` 로직 그대로. `src/tests/`를 `server/`가 import하면 테스트 코드가 런타임 의존성이 되는 문제(테스트 파일이 실수로 깨지면 배포 프로세스가 깨짐, `vitest` devDependency 경계 붕괴)가 생기므로 **의도적으로 중복**(~25줄) — Phase B/C 계획서도 코어 무수정 원칙상 유사 로직 중복을 여러 번 선택한 전례(예: 스프라이트 control 반영 코드가 host/client 양쪽에 각각 있음)와 일관된다.

### 설계 결정 3 — 브라우저 클라이언트: `dedicatedHostUrl` 룸상태 필드로 전용호스트 배선 전환

전용호스트(agent8-in-node 모드)면 클라 배선은 **전혀 안 바뀐다** — `server/host.ts`가 그냥 룸에 들어온 또 하나의 참가자처럼 agent8 릴레이로 스냅샷/입력을 주고받으므로, 브라우저 쪽 `main.ts`의 `startNetMatch`는 `isHost=false`(사람은 항상 클라, 전용호스트가 영구 호스트)로만 호출하면 끝 — Phase C까지의 `ClientSession` 코드가 무수정으로 그대로 동작한다.

플랜B(자체 ws)일 때만 배선이 바뀐다: `server/ws-host-transport.ts`가 기동 직후 agent8 룸상태에 `updateRoomState({dedicatedHostUrl: 'wss://<터널호스트>/'})`를 1회 기록한다(agent8은 여전히 로비/룸상태용으로 씀 — 스펙 §8-1의 플랜B 문구 그대로). `main.ts`의 `startNetMatch`는 `a.lobby.roomState.dedicatedHostUrl`이 있으면 `ClientSession`에 `a.lobby.net`(agent8 트랜스포트) 대신 `makeWsClientTransport(url, account)`(신규, 브라우저 네이티브 `WebSocket`)를 넘긴다 — **로비 참가/팀선택/Ready는 계속 agent8**, **인게임 스냅샷/입력만 별도 ws 소켓**. `RoomState`(`src/net/types.ts`)에 `dedicatedHostUrl?: string` 필드 한 줄 추가(옵셔널이라 Phase A/B/C 룸상태 하위호환 무손상).

**터널 노출**: `[[project_freeciv_web_verse8]]` 메모의 패턴(Cloudflare Tunnel로 로컬 Node 프로세스를 공개 URL로 노출)을 그대로 원용 — `cloudflared tunnel --url http://localhost:<port>`로 로컬 ws 서버를 `https://*.trycloudflare.com`에 매핑하고 `wss://` 스킴으로 접속한다. 이 계획은 터널 기동 자체를 자동화하지 않는다(사용자 실행 단계, E단계 배포문서 몫) — `server/host.ts`가 `--public-url` CLI 인자로 터널 URL을 받아 룸상태에 그 값을 쓰도록만 만든다.

---

## 파일 구조 (Phase D 산출물)

```
server/
  host-assets.ts        ← (신규) Node fs 에셋 로더 (맵/애니/무기) — 설계 결정 2
  node-transport.ts      ← (신규) agent8-in-node 시도 → 실패시 ws-host-transport 폴백 팩토리 — 설계 결정 1
  ws-host-transport.ts   ← (신규) 플랜B: 자체 ws 서버 (Transport 구현, Node측)
  host.ts                ← (신규) 엔트리 — 롭스터/부트/60Hz루프/SIGINT
src/net/
  types.ts               ← (수정) RoomState.dedicatedHostUrl?: string 필드 추가
  ws-client-transport.ts ← (신규) 플랜B: 브라우저 네이티브 WebSocket (Transport 구현, 클라측)
src/web/
  main.ts                ← (수정) startNetMatch — dedicatedHostUrl 있으면 ws-client-transport로 교체, isHost 항상 false
src/tests/
  node-transport.test.ts     ← (신규) 폴백 분기 로직 유닛테스트(가짜 agent8 시도 함수 주입)
  ws-transport-pair.test.ts  ← (신규) ws-host-transport↔ws-client-transport 라운드트립(localhost 실 소켓)
  host-boot.test.ts          ← (신규) `node dist-server/host.mjs` 자식프로세스 스폰 스모크테스트
package.json             ← (수정) devDependencies: esbuild(명시) / dependencies: ws. scripts: build:host, host
```

---

### Task 1: node-transport.ts — agent8-in-node 시도 → ws 폴백 (결정 게이트, 유닛테스트 가능한 부분)

**Files:** Create `server/node-transport.ts`, `src/tests/node-transport.test.ts`

- [ ] **Step 1: 실패 테스트**

```ts
// src/tests/node-transport.test.ts
import { describe, it, expect, vi } from 'vitest'
import { resolveHostTransport, type Agent8Attempt } from '../../server/node-transport'

describe('resolveHostTransport (D-phase decision gate)', () => {
  it('uses the agent8-in-node transport when the injected attempt resolves online', async () => {
    const fakeAttempt: Agent8Attempt = async () => ({ status: 'online', account: 'host' } as any)
    const result = await resolveHostTransport({ attemptAgent8: fakeAttempt, wsPort: 0 })
    expect(result.mode).toBe('agent8')
  })

  it('falls back to own-ws when the injected attempt rejects (package missing / connect failed)', async () => {
    const fakeAttempt: Agent8Attempt = async () => { throw new Error('Cannot find package @agent8/gameserver') }
    const result = await resolveHostTransport({ attemptAgent8: fakeAttempt, wsPort: 0 })
    expect(result.mode).toBe('own-ws')
    await result.close()
  })

  it('falls back to own-ws when the attempt times out', async () => {
    const hangingAttempt: Agent8Attempt = () => new Promise(() => {}) // never resolves
    const result = await resolveHostTransport({ attemptAgent8: hangingAttempt, wsPort: 0, timeoutMs: 50 })
    expect(result.mode).toBe('own-ws')
    await result.close()
  })
})
```

- [ ] **Step 2: FAIL 확인** — `npx vitest run src/tests/node-transport.test.ts`
- [ ] **Step 3: 구현**

```ts
// server/node-transport.ts — D단계 결정 게이트. transport.ts의 realProvider()는 Vite의
// import.meta.env를 읽어 esbuild Node 번들에선 못 쓴다(선행 사실 2) — Node 전용으로 새로 작성.
import type { Transport } from '../src/net/types'
import { startWsHostTransport } from './ws-host-transport'

// 주입 가능한 "agent8 연결 시도" 함수 — 실제 구현은 아래 realAgent8Attempt, 테스트는 가짜 주입.
export type Agent8Attempt = () => Promise<{ status: string; account?: string; raw?: unknown }>

export async function realAgent8Attempt(): Promise<{ status: string; account?: string; raw?: unknown }> {
  if (!process.env.VITE_AGENT8_VERSE) throw new Error('VITE_AGENT8_VERSE not set')
  // 변수 지정자 — esbuild가 정적 분석으로 번들에 끼워넣지 않도록(미설치 시 빌드 자체는 성공해야 함).
  const mod = '@agent8/gameserver'
  const { GameServer } = (await import(/* @vite-ignore */ mod)) as { GameServer: { getInstance: () => any } }
  const server = GameServer.getInstance()
  await server.connect()
  return { status: 'online', account: server.account, raw: server }
}

export interface ResolveOptions {
  attemptAgent8?: Agent8Attempt
  timeoutMs?: number
  wsPort?: number
  roomKey?: string
}

export interface ResolvedHostTransport {
  mode: 'agent8' | 'own-ws'
  transport: Transport
  publicUrlHint?: string // own-ws일 때만 — 실 URL은 터널 기동 후 CLI --public-url로 별도 주입(host.ts)
  close(): Promise<void>
}

// 설계 결정 1의 구현체: 실측 → 성공하면 agent8 트랜스포트, 실패/타임아웃이면 자체 ws로 폴백.
export async function resolveHostTransport(opts: ResolveOptions = {}): Promise<ResolvedHostTransport> {
  const attempt = opts.attemptAgent8 ?? realAgent8Attempt
  const timeoutMs = opts.timeoutMs ?? 4000
  try {
    const withTimeout = Promise.race([
      attempt(),
      new Promise<never>((_, rej) => setTimeout(() => rej(new Error('agent8-in-node timeout')), timeoutMs)),
    ])
    const r = await withTimeout
    if (r.status !== 'online') throw new Error(`agent8 status=${r.status}`)
    console.log('[host] agent8-in-node OK — using agent8 relay (happy path)')
    // 실제 배포에서는 여기서 raw(GameServer 인스턴스)를 src/net/transport.ts의 makeAgent8Transport와
    // 동등한 어댑터로 감싼다(브라우저와 동일 프로토콜) — 어댑터 자체는 transport.ts 재사용 가능
    // (import.meta.env 회피만 하면 되므로, provider.getInstance를 이미 연결된 인스턴스를 돌려주는
    // 클로저로 바꿔치기하면 됨). 상세 배선은 T3(host.ts)에서.
    return { mode: 'agent8', transport: null as unknown as Transport, close: async () => {} }
  } catch (err) {
    console.log(`[host] agent8-in-node unavailable (${(err as Error).message}) — falling back to own-ws`)
    const ws = await startWsHostTransport({ port: opts.wsPort ?? 8765 })
    return { mode: 'own-ws', transport: ws.transport, publicUrlHint: `ws://localhost:${ws.port}/`, close: ws.close }
  }
}
```

- [ ] **Step 4: PASS + tsc + Commit** — `npx vitest run src/tests/node-transport.test.ts` 그린(own-ws 케이스는 T2에서 `ws-host-transport.ts`가 생긴 뒤에야 진짜로 통과 — 순서상 Step3 구현은 T2 완료 후 다시 돌려 확정). `git add server/node-transport.ts src/tests/node-transport.test.ts && git commit -m "feat(server): agent8-in-node runtime decision gate with ws fallback (M3-D)"`

> **열린 구현 디테일(§보고서 참조)**: `mode:'agent8'` 분기의 `transport`는 위 스텁에선 `null`이다 — agent8-in-node가 실제로 되는지 로컬에서 검증 불가(선행 사실 4)하므로, 진짜 어댑터 배선(`makeAgent8Transport`를 이미-연결된 `GameServer` 인스턴스로 감싸기)은 `@agent8/gameserver`가 설치된 환경(사용자의 배포 준비 이후)에서 실제로 이 분기를 타보며 완성해야 한다 — 코드 구조(어디에 무엇을 꽂을지)는 이 태스크가 확정하고, "raw 인스턴스 → Transport 어댑터"의 최종 3~5줄은 그 시점 구현자가 채운다.

---

### Task 2: ws-host-transport.ts / ws-client-transport.ts — 플랜B (자체 ws)

**Files:** Create `server/ws-host-transport.ts`, `src/net/ws-client-transport.ts`, `src/tests/ws-transport-pair.test.ts`

플랜B는 룸 개념을 단순화한다 — **프로세스 하나 = 매치 하나**(전용호스트는 매치당 상시 기동이므로 멀티룸 멀티플렉싱은 스코프 밖, `roomKey`는 로그용). `joinRoom`/`leaveRoom`/`getRoomState`/`updateRoomState`는 이 매치 동안 자리표시자(agent8이 로비 역할을 계속하므로 여기선 룸상태 영속 불필요) — `send`/`onMessage`만 실제로 쓰인다.

- [ ] **Step 1: 실패 테스트**

```ts
// src/tests/ws-transport-pair.test.ts
import { describe, it, expect, afterEach } from 'vitest'
import { startWsHostTransport } from '../../server/ws-host-transport'
import { makeWsClientTransport } from '../net/ws-client-transport'

describe('ws-host-transport <-> ws-client-transport (Plan B round-trip)', () => {
  let close: () => Promise<void> = async () => {}
  afterEach(() => close())

  it('client connects, host broadcasts binary payload, client receives it with sender account', async () => {
    const host = await startWsHostTransport({ port: 0 }) // port 0 = OS가 빈 포트 배정
    close = host.close
    const received: { event: string; payload: unknown; from: string }[] = []
    host.transport.onMessage((event, payload, from) => received.push({ event, payload, from }))

    const client = makeWsClientTransport(`ws://localhost:${host.port}/`, 'alice')
    await client.connect()
    await client.joinRoom('ignored') // 플랜B는 프로세스=매치 1개라 room key 무시(로그만)

    const clientGot: unknown[] = []
    client.onMessage((event, payload) => clientGot.push({ event, payload }))

    const buf = new Uint8Array([1, 2, 3]).buffer
    client.send('snap', buf)
    await new Promise((r) => setTimeout(r, 50))
    expect(received).toHaveLength(1)
    expect(received[0].from).toBe('alice')
    expect(new Uint8Array(received[0].payload as ArrayBuffer)).toEqual(new Uint8Array([1, 2, 3]))

    host.transport.send('snap', new Uint8Array([9, 9]).buffer)
    await new Promise((r) => setTimeout(r, 50))
    expect(clientGot).toHaveLength(1)
  })
})
```

- [ ] **Step 2: FAIL 확인**
- [ ] **Step 3: 구현**

```ts
// server/ws-host-transport.ts — Node측 자체 ws 서버. Transport 인터페이스 구현(HostSession이
// 그대로 사용). `ws` 패키지 필요(package.json에 T4에서 추가).
import { WebSocketServer, type WebSocket } from 'ws'
import type { Transport, RoomState, RoomListing, MessageHandler } from '../src/net/types'

export interface WsHostHandle { transport: Transport; port: number; close: () => Promise<void> }

export async function startWsHostTransport(opts: { port: number }): Promise<WsHostHandle> {
  const clients = new Map<WebSocket, string>() // socket → account(첫 hello 메시지로 등록)
  let msgHandler: MessageHandler = () => {}

  const wss = new WebSocketServer({ port: opts.port })
  const actualPort: number = await new Promise((resolve) => {
    wss.once('listening', () => resolve((wss.address() as { port: number }).port))
  })

  wss.on('connection', (sock) => {
    sock.on('message', (data, isBinary) => {
      const parsed = JSON.parse(isBinary ? Buffer.from(data as Buffer).toString('utf-8') : String(data))
      if (parsed.type === 'hello') { clients.set(sock, parsed.account); return }
      if (parsed.type === 'msg') {
        const account = clients.get(sock) ?? 'unknown'
        const payload = parsed.b64 ? base64ToArrayBuffer(parsed.b64) : parsed.payload
        msgHandler(parsed.event, payload, account)
      }
    })
    sock.on('close', () => clients.delete(sock))
  })

  const transport: Transport = {
    account: 'host',
    status: 'online',
    async connect() { return 'online' },
    async listRooms() { return [] as RoomListing[] },
    async joinRoom() {},
    async leaveRoom() {},
    async getRoomState() { return {} as RoomState },
    async updateRoomState() {},
    send(event, payload) {
      const frame = isBinary(payload)
        ? JSON.stringify({ type: 'msg', event, b64: bytesToBase64(toBytes(payload)) })
        : JSON.stringify({ type: 'msg', event, payload })
      for (const sock of clients.keys()) sock.send(frame)
    },
    onMessage(h) { msgHandler = h },
    onRoomState() {},
  }

  return {
    transport,
    port: actualPort,
    close: () => new Promise<void>((resolve) => { wss.close(() => resolve()) }),
  }
}

function isBinary(v: unknown): v is ArrayBuffer | ArrayBufferView {
  return v instanceof ArrayBuffer || ArrayBuffer.isView(v)
}
function toBytes(v: ArrayBuffer | ArrayBufferView): Uint8Array {
  return v instanceof ArrayBuffer ? new Uint8Array(v) : new Uint8Array(v.buffer, v.byteOffset, v.byteLength)
}
function bytesToBase64(b: Uint8Array): string { return Buffer.from(b).toString('base64') }
function base64ToArrayBuffer(b64: string): ArrayBuffer {
  const buf = Buffer.from(b64, 'base64')
  return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength)
}
```

```ts
// src/net/ws-client-transport.ts — 브라우저측(네이티브 WebSocket). 전용호스트가 플랜B일 때만
// main.ts가 이걸로 스위칭(설계 결정 3) — agent8 트랜스포트와 동일 인터페이스라 ClientSession 무수정.
import type { Transport, RoomState, RoomListing, MessageHandler } from './types'

export function makeWsClientTransport(url: string, account: string): Transport {
  let sock: WebSocket | null = null
  let msgHandler: MessageHandler = () => {}
  const t: Transport = {
    account,
    status: 'offline',
    async connect() {
      return new Promise((resolve) => {
        sock = new WebSocket(url)
        sock.onopen = () => {
          sock!.send(JSON.stringify({ type: 'hello', account }))
          ;(t as { status: Transport['status'] }).status = 'online'
          resolve('online')
        }
        sock.onerror = () => { (t as { status: Transport['status'] }).status = 'offline'; resolve('offline') }
        sock.onmessage = (ev) => {
          const parsed = JSON.parse(ev.data as string)
          if (parsed.type !== 'msg') return
          const payload = parsed.b64 ? base64ToArrayBuffer(parsed.b64) : parsed.payload
          msgHandler(parsed.event, payload, 'host') // 플랜B는 항상 호스트발 — 전용서버가 유일 발신자
        }
      })
    },
    async listRooms() { return [] as RoomListing[] },
    async joinRoom() {}, // 플랜B: 프로세스=매치1개, room 개념 없음(agent8이 로비 담당)
    async leaveRoom() { sock?.close() },
    async getRoomState() { return {} as RoomState },
    async updateRoomState() {},
    send(event, payload) {
      if (t.status !== 'online' || !sock) return
      const frame = isBinary(payload)
        ? JSON.stringify({ type: 'msg', event, b64: bytesToBase64(toBytes(payload)) })
        : JSON.stringify({ type: 'msg', event, payload })
      sock.send(frame)
    },
    onMessage(h) { msgHandler = h },
    onRoomState() {},
  }
  return t
}

function isBinary(v: unknown): v is ArrayBuffer | ArrayBufferView {
  return v instanceof ArrayBuffer || ArrayBuffer.isView(v)
}
function toBytes(v: ArrayBuffer | ArrayBufferView): Uint8Array {
  return v instanceof ArrayBuffer ? new Uint8Array(v) : new Uint8Array(v.buffer, v.byteOffset, v.byteLength)
}
function bytesToBase64(bytes: Uint8Array): string {
  let bin = ''
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i])
  return btoa(bin)
}
function base64ToArrayBuffer(b64: string): ArrayBuffer {
  const bin = atob(b64)
  const out = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i)
  return out.buffer
}
```

- [ ] **Step 4: PASS + tsc + Commit** — `npx vitest run src/tests/ws-transport-pair.test.ts` 그린(먼저 `npm install --save-dev ws @types/ws` — T4에서 공식화). `git add server/ws-host-transport.ts src/net/ws-client-transport.ts src/tests/ws-transport-pair.test.ts package.json package-lock.json && git commit -m "feat(net): plan-B own-ws transport pair (host+client), Transport-compatible (M3-D)"`

---

### Task 3: host-assets.ts + host.ts — Node 에셋 로더 + 엔트리 부트

**Files:** Create `server/host-assets.ts`, `server/host.ts`

- [ ] **Step 1: `server/host-assets.ts` 구현** (테스트는 T5의 부트 스모크테스트가 간접 검증 — 순수 fs+코어호출이라 별도 유닛테스트 불필요, `helpers.ts`가 이미 같은 패턴을 커버)

```ts
// server/host-assets.ts — Node fs 에셋 로더(설계 결정 2). tests/helpers.ts + web/main.ts의
// loadGameAssets를 fs 버전으로 합친 것 — 의도적 중복(런타임/테스트 경계 분리).
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import { createGameState, loadThingObjects, type GameState } from '../src/core/state'
import { loadAnimObjects } from '../src/core/anims'
import { loadSpriteObjects } from '../src/core/sprites'
import { loadMapFile } from '../src/core/mapfile'
import { loadWaypoints } from '../src/core/waypoints'
import { createWeapons, loadWeaponsConfig, type WeaponsIniConfig } from '../src/core/weapons'
import { wireGameHooks } from '../src/core/game'
import { GAMESTYLE_CTF, GAMESTYLE_DEATHMATCH } from '../src/core/constants'

const assetsDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../public/assets')

function readAssetLines(name: string): string[] {
  return readFileSync(path.join(assetsDir, 'anims', path.basename(name)), 'utf-8').split(/\r\n|\r|\n/)
}

export function loadHostGame(opts: { ctf: boolean; mapName?: string }): GameState {
  const gs = createGameState()
  wireGameHooks(gs)
  gs.anims = loadAnimObjects(readAssetLines)
  loadSpriteObjects(gs, readAssetLines)
  loadThingObjects(gs, readAssetLines)

  const mapBuf = readFileSync(path.join(assetsDir, 'maps', opts.mapName ?? 'ctf_Ash.pms'))
  const mapFile = loadMapFile(new Uint8Array(mapBuf).buffer as ArrayBuffer)
  gs.map.loadData(mapFile)
  loadWaypoints(gs.botPath, mapFile.waypoints)

  createWeapons(false)
  const weaponsJson = JSON.parse(readFileSync(path.join(assetsDir, 'weapons.json'), 'utf-8')) as { normal: WeaponsIniConfig }
  loadWeaponsConfig(weaponsJson.normal)

  gs.svGamemode = opts.ctf ? GAMESTYLE_CTF : GAMESTYLE_DEATHMATCH
  gs.svKilllimit = opts.ctf ? 10 : 9999
  return gs
}
```

- [ ] **Step 2: `server/host.ts` 구현**

```ts
// server/host.ts — 전용 Node 헤드리스 호스트 엔트리 (스펙 §3.1-①, §6-D).
// 실행: npm run host -- --room r1 --mode dm --players alice,bob [--transport loopback-selftest]
import { loadHostGame } from './host-assets'
import { resolveHostTransport } from './node-transport'
import { HostSession, type HostSessionPlayer } from '../src/net/host-session'
import { TEAM_NONE } from '../src/core/constants'
import { LoopbackHub } from '../src/net/loopback'

function parseArgs(argv: string[]): { room: string; ctf: boolean; players: string[]; transport?: string; port: number } {
  const get = (flag: string, def?: string) => {
    const i = argv.indexOf(flag)
    return i >= 0 ? argv[i + 1] : def
  }
  return {
    room: get('--room', 'sr1')!,
    ctf: get('--mode', 'dm') === 'ctf',
    players: (get('--players', '') || '').split(',').filter(Boolean),
    transport: get('--transport'),
    port: Number(get('--port', '8765')),
  }
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2))
  console.log(`[host] booting room=${args.room} mode=${args.ctf ? 'ctf' : 'dm'} transport=${args.transport ?? 'auto'}`)

  const gs = loadHostGame({ ctf: args.ctf })
  console.log('[host] assets loaded (map+anims+weapons)')

  // --transport loopback-selftest: 배포 없이 부트 시퀀스 자체를 스모크테스트하기 위한 스텁
  // (T5 headless verification 전용, 실 운용에선 쓰지 않음).
  let transport
  let stop = async () => {}
  if (args.transport === 'loopback-selftest') {
    const hub = new LoopbackHub()
    transport = hub.createTransport('host')
    const observer = hub.createTransport('selftest-observer')
    await transport.connect(); await observer.connect()
    await transport.joinRoom(args.room); await observer.joinRoom(args.room)
    observer.onMessage((event) => { if (event === 'snap') console.log('[host] snapshot broadcast observed') })
  } else {
    const resolved = await resolveHostTransport({ roomKey: args.room, wsPort: args.port })
    transport = resolved.transport
    stop = resolved.close
    if (resolved.mode === 'own-ws') {
      console.log(`[host] plan-B active — public URL must be set via tunnel, hint: ${resolved.publicUrlHint}`)
    }
  }

  const host = new HostSession(transport, gs)
  const roster: HostSessionPlayer[] = args.players.length
    ? args.players.map((account) => ({ account, team: TEAM_NONE }))
    : []
  if (roster.length) host.spawnPlayers(roster)
  console.log(`[host] spawned ${roster.length} player(s), starting 60Hz loop`)

  const stopLoop = host.startLoop() // Phase B가 이미 구현한 setInterval 래퍼 — 재사용, 재발명 없음.

  let ticks = 0
  const logInterval = setInterval(() => console.log(`[host] alive, tick~${gs.ticks}`), 5000)

  const shutdown = async () => {
    console.log('[host] SIGINT received — shutting down')
    stopLoop()
    clearInterval(logInterval)
    await stop()
    process.exit(0)
  }
  process.on('SIGINT', shutdown)
  process.on('SIGTERM', shutdown)
}

main().catch((err) => { console.error('[host] fatal:', err); process.exit(1) })
```

- [ ] **Step 3: tsc 확인** — `npx tsc --noEmit`(서버 파일도 같은 tsconfig에 포함되는지 확인 — 안 되면 `server/tsconfig.json`을 별도로 두거나 루트 `tsconfig.json`의 `include`에 `server/**/*.ts` 추가. **주의**: `include` 확장 시 `vite build`가 `server/`를 브라우저 번들에 끌어들이지 않는지 재확인 — Vite는 `index.html`에서 도달 가능한 모듈만 번들에 넣으므로 `tsconfig.json`의 `include`(타입체크 범위)와 Vite의 번들 그래프(런타임 포함 범위)는 별개다, 안전).
- [ ] **Step 4: Commit** — `git add server/host-assets.ts server/host.ts && git commit -m "feat(server): dedicated Node headless host entry (M3-D)"`

---

### Task 4: npm 스크립트 배선 (esbuild 번들 + `npm run host`)

**Files:** Modify `package.json`

- [ ] **Step 1: `ws`/`@types/ws` 설치 + `esbuild` 명시화**

```bash
npm install --save-dev ws @types/ws
npm install --save-dev esbuild@$(node_modules/.bin/esbuild --version)  # 이미 전이의존이던 버전 그대로 고정 명시
```

- [ ] **Step 2: `package.json` scripts 추가**

```json
{
  "scripts": {
    "dev": "vite",
    "build": "vite build",
    "preview": "vite preview",
    "test": "vitest run",
    "assets": "node tools/build-assets.mjs",
    "build:host": "esbuild server/host.ts --bundle --platform=node --format=esm --packages=external --outfile=dist-server/host.mjs",
    "host": "npm run build:host && node dist-server/host.mjs"
  }
}
```

`--packages=external`: `ws`/`@agent8/gameserver`(미설치라도 됨 — dynamic import는 어차피 external) 등 `node_modules` 패키지를 번들에 안 넣고 `node_modules` 조회에 맡긴다 — 상대경로(`../src/...`)만 esbuild가 인라인 해석해 확장자 문제를 없앤다(Tech Stack 절 참조). `dist-server/`는 `.gitignore`에 추가.

- [ ] **Step 3: `.gitignore`에 `dist-server/` 추가**
- [ ] **Step 4: 동작 확인** — `npm run build:host`가 에러 없이 `dist-server/host.mjs`를 만드는지 확인(T5에서 실행까지 검증). `git add package.json package-lock.json .gitignore && git commit -m "chore: npm run host script (esbuild bundle, ws dep) (M3-D)"`

---

### Task 5: 브라우저 클라 — `dedicatedHostUrl` 배선 전환

**Files:** Modify `src/net/types.ts`, `src/web/main.ts`

- [ ] **Step 1: `types.ts`에 필드 추가**

```ts
// src/net/types.ts — RoomState 인터페이스에 추가(옵셔널, 기존 룸상태 하위호환 무손상)
export interface RoomState {
  mode: number
  hostAccount: string
  started: boolean
  roundEndsAt: number
  dedicatedHostUrl?: string // D단계: 플랜B(자체ws) 전용호스트의 공개 ws URL. agent8-in-node 모드면 미설정.
  [playerKey: string]: unknown
}
```

- [ ] **Step 2: `main.ts`의 `startNetMatch` 수정** — dedicatedHostUrl이 있으면 `ClientSession`에 ws 트랜스포트를 물리고, 사람은 항상 클라(호스트가 될 일 없음 — 마이그레이션 없는 전용호스트 원칙, 스펙 §3.1)

```ts
// src/web/main.ts — startNetMatch 안, transport 결정 부분만 교체 (기존 isHost 분기 로직 유지하되
// dedicatedHostUrl이 있으면 무조건 클라 경로로 강제 + 매치 트랜스포트만 교체)
import { makeWsClientTransport } from '../net/ws-client-transport'
// ...
async function startNetMatch(a: StartMatchArg): Promise<void> {
  const ctf = a.mode === GAMESTYLE_CTF
  const { gs, manifest, mapFile } = await loadGameAssets(ctf)
  const { app, world, bgLayer, gostek, entities, hud, sound, input, camera } = await buildScene(gs, mapFile, manifest)

  const account = a.lobby.account
  const dedicatedUrl = a.lobby.roomState.dedicatedHostUrl
  // 전용호스트(플랜B)가 있으면: 사람은 항상 클라, 매치 트랜스포트만 별도 ws로 스위칭.
  // 전용호스트(agent8-in-node)면: dedicatedUrl 미설정, 기존 배선 그대로(agent8 릴레이 공용).
  const isHost = dedicatedUrl ? false : a.lobby.isHost
  const matchTransport = dedicatedUrl ? makeWsClientTransport(dedicatedUrl, account) : a.lobby.net
  if (dedicatedUrl) await matchTransport.connect()

  // ... 이하 기존 로직 그대로, `transport` 참조를 `matchTransport`로 치환 ...
}
```

- [ ] **Step 3: tsc + 기존 스위트 재확인** — `npx tsc --noEmit`, `npx vitest run`(264 + D단계 신규분 전부 그린, `git diff src/core`는 빈 채로 유지 확인)
- [ ] **Step 4: Commit** — `git add src/net/types.ts src/web/main.ts && git commit -m "feat(web): switch match transport to dedicated own-ws host when present (M3-D)"`

---

### Task 6: 헤드리스 부트 검증 (Phase D의 핵심 완료 기준)

**Files:** Create `src/tests/host-boot.test.ts`

- [ ] **Step 1: 테스트 작성**

```ts
// src/tests/host-boot.test.ts — `npm run host`가 실제로 기동해 틱을 도는지 자식프로세스로 검증.
// 실 배포(agent8/ws 외부노출) 없이도 검증 가능하도록 --transport loopback-selftest 스텁 사용.
import { describe, it, expect } from 'vitest'
import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import path from 'node:path'

const bundlePath = path.resolve(__dirname, '../../dist-server/host.mjs')

describe('dedicated Node host boots headless (M3-D completion criterion)', () => {
  it('ticks and logs snapshot broadcasts for a few seconds, then exits cleanly on SIGINT', async () => {
    expect(existsSync(bundlePath)).toBe(true) // `npm run build:host`를 이 테스트 전에 실행해둘 것(CI 순서)

    const child = spawn('node', [bundlePath, '--room', 'boottest', '--transport', 'loopback-selftest', '--players', 'alice'], {
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    let out = ''
    child.stdout.on('data', (d) => { out += String(d) })
    child.stderr.on('data', (d) => { out += String(d) })

    await new Promise((r) => setTimeout(r, 3000)) // 3초 구동 — 60Hz*3s=180틱, 스냅샷 30Hz 다수 관측 기대
    expect(out).toContain('[host] assets loaded')
    expect(out).toContain('spawned 1 player')
    expect(out).toContain('snapshot broadcast observed')
    expect(out).not.toMatch(/fatal|Error/i)

    const exitPromise = new Promise<number | null>((resolve) => child.on('exit', resolve))
    child.kill('SIGINT')
    const code = await exitPromise
    expect(code).toBe(0)
  }, 15000)
})
```

- [ ] **Step 2: 실행 순서** — `npm run build:host && npx vitest run src/tests/host-boot.test.ts` (빌드 산출물이 먼저 있어야 함 — CI라면 `build:host`를 pretest 단계에 추가하거나, 이 테스트 파일 상단에서 빌드를 조건부로 트리거해도 됨. 로컬 1회 확인은 수동 실행으로 충분, 상시 CI 훅은 이 계획 스코프 밖).
- [ ] **Step 3: 수동 확인(사람이 직접)** — `npm run host -- --room manual --players alice,bob` 실행 후 5~10초 관찰, `Ctrl+C`로 정지 → 로그에 `[host] alive, tick~N`이 증가하며 찍히는지, `SIGINT received — shutting down` 후 프로세스가 실제로 종료하는지 눈으로 확인.
- [ ] **Step 4: 전체 회귀 + 빌드 확인**

```bash
npx tsc --noEmit
npx vitest run   # 264(B/C 기준) + T1~T6 신규분 전부 그린 기대
git diff --stat src/core   # 빈 출력 기대 — 코어 무수정 확인
npm run build   # vite 브라우저 빌드가 server/ 신규 파일 때문에 안 깨지는지 확인
```

- [ ] **Step 5: Commit** — `git add src/tests/host-boot.test.ts && git commit -m "test(server): headless boot verification for dedicated host (M3-D completion criterion)"`

---

## 열린 질문 (E단계 또는 사용자 결정 필요)

1. **agent8-in-node 실측은 여전히 미완**(선행 사실 4) — `@agent8/gameserver`가 로컬에 없어 `resolveHostTransport`의 `mode:'agent8'` 분기가 실제로 도는지 오늘 확인 불가. 사용자가 `npm install @agent8/gameserver`(또는 `npx @agent8/deploy` 준비 과정)를 하는 시점에 T1의 "열린 구현 디테일" 각주에서 지적한 3~5줄(raw 인스턴스 → Transport 어댑터)을 마저 채우고 실제로 `resolveHostTransport()`를 인자 없이 호출해 재검증해야 한다.
2. **플랜B의 Cloudflare 터널 자동화 여부** — 이 계획은 `cloudflared` 기동을 수동 단계로 남겨뒀다(설계 결정 3). 상시 운영을 원하면 `server/host.ts`가 `cloudflared` 서브프로세스를 직접 스폰해 URL을 파싱하는 자동화가 추가로 필요(스코프에 안 넣음 — E단계 배포문서 후보).
3. **전용호스트의 롭스터 획득 방식** — 이번 계획은 CLI `--players alice,bob`로 수동 지정(헤드리스 부트 검증 목적엔 충분). 실 운영에선 `server/host.ts`가 agent8 룸상태(`p_{account}`)를 구독해 `started:true` 전환 시 자동으로 `spawnPlayers`를 호출해야 한다 — agent8-in-node 분기가 검증되기 전엔 이 배선도 확정할 수 없어 열어둠(1과 연결).
4. **`realAgent8Attempt`의 `raw` 필드 형태** — `GameServer.getInstance()`가 반환하는 실제 인스턴스가 `transport.ts`의 `Agent8Provider.getInstance()` 반환형(`{account, connect, remoteFunction, onRoomMessage}`)과 필드 단위로 정말 같은지도 실물 없이는 확답 불가 — 다르면 어댑터 시그니처를 실측 후 조정.
5. **`npm run host` 프로덕션 하드닝** — 크래시 시 자동재시작(pm2/systemd), 로그 영속화, 헬스체크 엔드포인트는 이번 계획 스코프 밖(스펙 §9 "범위 밖" 정신과 일관 — 폴리시/배포 문서화는 E단계).
