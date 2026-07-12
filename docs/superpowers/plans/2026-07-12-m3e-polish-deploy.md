# M3 Phase E: 폴리시 + 폴백 + 배포 (최종 단계) 구현 계획

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development로 태스크별 구현. `- [ ]` 체크박스.

**Goal:** A~D(전송+로비+이동+전투+전용서버, 269테스트 그린)의 `HostSession`/`ClientSession`/`Transport`/`LobbyClient`를 재사용해 스펙 §6-E(호스트 마이그레이션·재접속·peer-session seam·오프라인폴백·플레이테스트·배포문서)를 마무리한다. 완료 기준: (1) 브라우저-호스트 매치에서 호스트 탭이 사라져도 남은 참가자 중 하나가 자동 승격해 매치가 안 끊긴다(loopback 3자 테스트) (2) 클라 연결 끊김이 재접속을 시도, 실패하면 기존 오프라인 봇전으로 폴백한다 (3) 호스트권위 ↔ 피어/피해자권한 전략 교체용 `Session` seam이 타입/유닛 레벨로 존재(피어 구현은 YAGNI) (4) `npm test`가 **클린 클론에서** 그린(현재 갭을 아래에서 직접 재현·확인함) (5) `docs/DEPLOY-VERSE8.md`·`docs/m3-net-checklist.md`가 존재. 코어(`src/core/*`) 무수정.

**Architecture 요지:** 새 프로토콜 메시지 추가 없이 기존 `RoomState` 라이브 전파만 재사용(설계 결정 1). 마이그레이션/재접속 판단은 순수 함수로 분리해 loopback으로 완전 테스트(A~D와 동일 철학). `main.ts`는 최소 변경(기존 널러블 `hostSession`/`clientSession` 쌍 유지, 재대입만 추가) — `Session` 인터페이스는 그 패턴을 갈아엎지 않는 **독립 seam**(§자체리뷰).

---

## 선행 사실 (직접 확인)

1. 스펙 §3.1(3배포모드)·§6-E·§9(피어권위=최종폴백, YAGNI) 확인.
2. **재사용 대상 재확인**: `host-session.ts`(`slotOf`/`prevKills`/`prevDeadMeat`/`prevActiveBullets`는 private), `client-session.ts`(ASSIGN 처리가 **자기 계정만** `myNum`에 기록, 남은 버림), `lobby-client.ts`(`roomState`는 `onRoomState`로 매치 중에도 라이브 갱신되지만 `roomKey`는 필드로 저장 안 함), `transport.ts`/`loopback.ts`(재연결 전후로 Transport 객체 동일성 유지 → `onMessage` 핸들러 클로저 생존 확인), `types.ts`(D단계가 `dedicatedHostUrl?`을 옵셔널 하위호환으로 추가한 전례), `main.ts`(`startNetMatch` 274~342행 — `isHost` 상수 + 널러블 쌍 + 60Hz 루프).
3. **CI 갭 직접 재현**: `rm -rf dist-server && npx vitest run src/tests/host-boot.test.ts` → **실패**(`existsSync(bundlePath)` false). `package.json`에 `pretest` 없음 → 클린 클론에서 `npm test` 반드시 실패. `npm run build:host`로 재빌드 후 통과 확인, 레포 상태 원복함. **D단계가 남긴 실결함, E가 고정 필요.**
4. **`node-transport.ts`/`host.ts` 재확인**: `mode:'agent8'` 분기는 여전히 `transport: null`(패키지 미설치, 로컬 검증 불가). `host.ts`의 `parseArgs`엔 D 설계문서가 언급한 `--public-url`이 **실제로는 파싱 안 됨**(코드 확인, 문서만 있었음). `ws-host-transport.ts`의 `updateRoomState()`는 no-op — Plan-B 전용호스트가 `dedicatedHostUrl`을 agent8 룸상태에 쓸 경로가 전혀 없다(D 열린질문2/3). E는 완전자동화 없이 정직하게 CLI 플래그 + 수동우회로 닫는다(설계 결정 5).
5. `server.js`는 이번 단계에서 수정하지 않는다(배포 리스크 최소화).
6. `m1`/`m2` checklist 포맷: ✅자동검증 / 👀수동확인 / 알려진편차 3단 — `m3-net-checklist.md`도 동일 골격.
7. **탄환 cosmetic 엣지**(브리핑 지적): `diffAndBroadcastBullets()`는 `updateFrame()` **이후** `.active` 집합만 봐서, 생성과 같은 틱에 즉발충돌사망하면 `MSG.BULLET`이 안 나간다. 데미지/스코어는 스냅샷이 진실이라 판정엔 무관 — 순수 시각 문제. 고치려면 코어 훅이 필요(무수정 원칙 위반) → **defer, 주석+문서화만**.
8. `npx vitest run` 재확인: 269/269 그린(`dist-server` 복구 후).

---

## 설계 결정

**1 — 마이그레이션에 새 프로토콜 메시지를 추가하지 않는다.** `RoomState.hostEpoch?: number` 필드만 추가(D의 `dedicatedHostUrl` 패턴). `LobbyClient`가 이미 라이브로 갱신하는 `roomState`만으로 승격 전파+스플릿브레인 가드(내가 호스트인데 다른 계정이 더 큰 epoch로 호스트를 자처하면 강등) 둘 다 해결된다. 새 `MSG` 타입 0개.

**2 — 승격은 "새 스프라이트 생성"이 아니라 "이미 미러링된 gs 승계".** `ClientSession`은 이미 스냅샷을 받는 전원의 스프라이트를 로컬 `gs`에 살려서 매 틱 `updateFrame()`을 돌린다(GostekPool 렌더 요구사항으로 원래 그렇게 설계됨). 승격 후보의 `gs`는 이미 "호스트 사망 직전까지의 실시간 상태"를 갖고 있다 — `HostSession.fromPromotedClient(transport, gs, knownSlots)`(신규 정적 팩토리)는 `spawnPlayers()`처럼 새로 스폰하지 않고 기존 슬롯을 그대로 채택한다(순간이동/리스폰 없음). 전제조건: `ClientSession`이 ASSIGN을 **전원분** 기록해야 함(현재는 자기 것만) — 확장 필요.

**3 — 호스트 사망 감지 = 스냅샷 수신 타임아웃.** `HOST_TIMEOUT_MS=3000`(30Hz≈33ms 기준 ~90회 미수신 — 백그라운드 탭 rAF 스로틀 오탐 방지 여유). `ClientSession.lastSnapshotAt`(신규) 갱신, 0(한번도 못받음)이면 판단 보류.

**4 — 선출은 결정적 순수함수.** `electHost`: 죽은 호스트 제외, `joinedAt` 오름차순(동률=계정문자열)으로 1등 선출 — 전원이 독립 계산해도 같은 답. "나 혼자 남음"도 별도 분기 없이 자연 처리(내 계정도 `players`에 있으므로 자동 선출됨).

**5 — 전용호스트 Plan-B `dedicatedHostUrl` 자동기록은 부분자동화 + 정직한 수동우회.** `--public-url` 플래그를 실제로 파싱하고, agent8 행복경로 성공시엔 로깅만(원래 불필요), Plan-B는 Node에 agent8 연결 자체가 없어 자동기록이 근본적으로 불가능함을 인정 — 배포문서에 브라우저 콘솔 1줄 수동 명령으로 우회(`window.__soldatNet` 디버그 훅 추가).

---

## 파일 구조

```
src/net/
  types.ts, lobby-client.ts, client-session.ts   ← (수정) 소품 확장 (Task 1)
  host-session.ts                                 ← (수정) fromPromotedClient() (Task 2)
  host-migration.ts                               ← (신규) electHost/decideMigration (Task 2)
  reconnect.ts                                    ← (신규) attemptReconnect (Task 5)
  session.ts                                      ← (신규) Session seam (Task 4)
server/
  node-transport.ts, host.ts                      ← (수정) --public-url (Task 7)
src/web/main.ts                                   ← (수정) 마이그레이션/재접속 배선 (Task 6)
src/tests/
  host-migration.test.ts, host-migration-integration.test.ts,
  reconnect.test.ts, session-seam.test.ts         ← (신규)
  host-boot.test.ts                               ← (수정) 자가빌드 폴백 (Task 8)
package.json                                      ← (수정) pretest (Task 8)
docs/DEPLOY-VERSE8.md, docs/m3-net-checklist.md   ← (신규, Task 9)
```

---

### Task 1: 넷 소품 확장 — `types.ts`/`lobby-client.ts`/`client-session.ts`

- [ ] **`types.ts`**: `RoomState`에 `hostEpoch?: number` 추가(옵셔널, 하위호환).

- [ ] **`lobby-client.ts`**: `roomKey: string | null = null` 필드 추가, `createRoom`/`joinRoom` 첫 줄에 `this.roomKey = key` 세팅(재접속 rejoin용).

- [ ] **`client-session.ts`**: 아래처럼 필드/생성자/핸들러 확장(기존 동작 100% 보존, 추가만).

```ts
export class ClientSession {
  myNum: number | null = null
  killFeed: KillMsg[] = []
  lastSnapshotAt = 0 // M3-E: 0=아직 미수신(마이그레이션 판단 보류, §설계결정3)
  knownSlots = new Map<string, number>() // M3-E: account→num 전원 기록(승격 seed, §설계결정2)
  // ...기존 private 필드 그대로...

  constructor(
    private transport: Transport, public readonly gs: GameState, myAccount: string,
    private getLocalInput: () => LocalInput,
    private nowFn: () => number = () => Date.now(), // M3-E: 테스트 가짜시계
  ) {
    this.myAccount = myAccount
    transport.onMessage((event, payload) => {
      if (event === MSG.ASSIGN) {
        const a = payload as { account: string; num: number }
        this.knownSlots.set(a.account, a.num) // M3-E: 기존엔 자기 것만 봤음
        if (a.account === this.myAccount) this.myNum = a.num
      } else if (event === MSG.SNAPSHOT) {
        this.lastSnapshotAt = this.nowFn() // M3-E
        this.applySnapshot(decodeSnapshot(payload as ArrayBuffer))
      } else if (event === MSG.BULLET) { this.spawnRemoteBullet(decodeBullet(payload as ArrayBuffer)) }
      else if (event === MSG.KILL) { this.killFeed.push(payload as KillMsg); if (this.killFeed.length > 20) this.killFeed.shift() }
    })
  }
  // ...나머지 무수정...
}
```

- [ ] **테스트** — `src/tests/host-migration.test.ts` 상단부(§Task 2에서 이어붙임): loopback으로 host+2client 구성 후 `aClient.knownSlots.get('bob')`이 `host.spriteNumOf('bob')`과 일치하는지, `lastSnapshotAt`이 가짜시계 주입으로 `0`→SNAPSHOT 수신 시각으로 바뀌는지 확인.
- [ ] **PASS + tsc + Commit**: `npx vitest run src/tests/host-migration.test.ts && npx tsc --noEmit`; `git commit -m "feat(net): knownSlots/lastSnapshotAt/roomKey/hostEpoch — migration prerequisites (M3-E)"`

---

### Task 2: `host-migration.ts` — 선출/판단 순수함수 + `HostSession.fromPromotedClient`

```ts
// src/net/host-migration.ts — 브라우저-호스트 마이그레이션 판단(스펙 §6-E, §3.1 모드② 전용).
// 순수함수 위주 — PIXI/main.ts 의존 없음. 전용 Node 호스트(모드①)는 대상 아님("마이그레이션 X").
import type { RoomPlayer } from './types'

export const HOST_TIMEOUT_MS = 3000 // 스냅샷 30Hz 기준 ~90회 연속 미수신 — 탭 스로틀 오탐 방지

// null 반환은 오직 "호출자 자신도 아직 players에 없음"(부기 엣지케이스)뿐 — "나 혼자 남음"은
// 별도 분기 없이 자연스럽게 나 자신이 선출된다(§설계결정4).
export function electHost(players: Record<string, RoomPlayer>, excludeAccount: string): string | null {
  const candidates = Object.entries(players).filter(([acc]) => acc !== excludeAccount)
  if (candidates.length === 0) return null
  candidates.sort(([a1, a], [b1, b]) => (a.joinedAt - b.joinedAt) || (a1 < b1 ? -1 : a1 > b1 ? 1 : 0))
  return candidates[0][0]
}

export type MigrationAction = 'none' | 'promote' | 'wait'
export interface MigrationDeps {
  getPlayers: () => Record<string, RoomPlayer>
  myAccount: string; currentHostAccount: string; nowFn?: () => number
}

export function decideMigration(lastSnapshotAt: number, deps: MigrationDeps): MigrationAction {
  if (lastSnapshotAt === 0) return 'none'
  const now = (deps.nowFn ?? Date.now)()
  if (now - lastSnapshotAt < HOST_TIMEOUT_MS) return 'none'
  const elected = electHost(deps.getPlayers(), deps.currentHostAccount)
  if (elected === null) return 'none'
  return elected === deps.myAccount ? 'promote' : 'wait'
}
```

`host-session.ts`에 정적 팩토리 추가(class 내부, `startLoop()` 다음 — private 필드 접근 위해):

```ts
  // M3-E: 이미 돌고 있던 클라의 gs(전원 로컬 미러링된 활성 스프라이트)를 승계 — spawnPlayers()처럼
  // randomizeStart+createSprite로 새로 스폰하지 않는다(순간이동/리스폰 없이 이어짐, §설계결정2).
  static fromPromotedClient(transport: Transport, gs: GameState, knownSlots: Map<string, number>): HostSession {
    const host = new HostSession(transport, gs)
    for (const [account, num] of knownSlots) {
      if (!gs.sprite[num]?.active) continue
      host.slotOf.set(account, num)
      host.prevKills.set(num, gs.sprite[num].player?.kills ?? 0)
      host.prevDeadMeat.set(num, gs.sprite[num].deadMeat)
    }
    for (let i = 1; i <= MAX_BULLETS; i++) if (gs.bullet[i].active) host.prevActiveBullets.add(i) // 기존 탄환 오탐 방지
    return host
  }
```

- [ ] **테스트** — `src/tests/host-migration.test.ts`에 이어붙임: `electHost` 4케이스(선출/동률/부기엣지/단독생존자 자연선출) + `decideMigration` 4케이스(미수신보류/타임아웃전/promote/wait). 완전한 코드는 구현자가 위 순수함수 시그니처 그대로 작성(입력·기대값은 위 설계결정 3/4 문구 그대로 케이스화).
- [ ] **PASS + tsc + Commit**: `git commit -m "feat(net): host election + promotion factory (M3-E migration foundation)"`

---

### Task 3: 마이그레이션 통합테스트 (loopback 3자 — 브리핑 핵심 요구)

**Files:** Create `src/tests/host-migration-integration.test.ts` — "host A + clients B,C; stop A; B promotes; C keeps receiving snapshots from B; no NaN"를 문자 그대로 구현.

```ts
import { describe, it, expect } from 'vitest'
import { LoopbackHub } from '../net/loopback'
import { HostSession } from '../net/host-session'
import { ClientSession, type LocalInput } from '../net/client-session'
import { decideMigration } from '../net/host-migration'
import { setupTestGame } from './helpers'
import { TEAM_NONE } from '../core/constants'
import type { RoomPlayer } from '../net/types'

const NO_INPUT: LocalInput = { left: false, right: false, up: false, down: false, fire: false, jetpack: false, throwNade: false, changeWeapon: false, throwWeapon: false, reload: false, prone: false, flagThrow: false, mouseAimX: 0, mouseAimY: 0 }

describe('M3-E: browser-host migration keeps the match alive', () => {
  it('host A stops; B (earliest joinedAt) is elected and promotes; C keeps receiving from B; no NaN', () => {
    const hub = new LoopbackHub()
    const tA = hub.createTransport('alice'), tB = hub.createTransport('bob'), tC = hub.createTransport('carol')
    for (const t of [tA, tB, tC]) { void t.connect(); void t.joinRoom('mroom') }

    const players: Record<string, RoomPlayer> = {
      alice: { nick: 'alice', team: TEAM_NONE, ready: true, kills: 0, deaths: 0, joinedAt: 100 },
      bob: { nick: 'bob', team: TEAM_NONE, ready: true, kills: 0, deaths: 0, joinedAt: 200 },
      carol: { nick: 'carol', team: TEAM_NONE, ready: true, kills: 0, deaths: 0, joinedAt: 300 },
    }
    const hostGs = setupTestGame({}).gs
    let hostSession = new HostSession(tA, hostGs)
    hostSession.spawnPlayers([{ account: 'alice', team: TEAM_NONE }, { account: 'bob', team: TEAM_NONE }, { account: 'carol', team: TEAM_NONE }])

    const bGs = setupTestGame({}).gs
    let fakeNowB = 1_000_000
    let clientB: ClientSession | null = new ClientSession(tB, bGs, 'bob', () => NO_INPUT, () => fakeNowB)
    const cGs = setupTestGame({}).gs
    const clientC = new ClientSession(tC, cGs, 'carol', () => NO_INPUT)

    for (let i = 0; i < 20; i++) { hostSession.tick(); clientB!.tick(); clientC.tick() } // 정상구동 — 미러링 채우기
    expect(clientB!.knownSlots.size).toBe(3)
    const cTicksBefore = cGs.ticks

    // 호스트 A 사망 시뮬 — 이후 tA를 참조하는 hostSession.tick()을 더는 부르지 않는다.
    fakeNowB += 3500 // HOST_TIMEOUT_MS 초과
    const action = decideMigration(clientB!.lastSnapshotAt, {
      getPlayers: () => players, myAccount: 'bob', currentHostAccount: 'alice', nowFn: () => fakeNowB,
    })
    expect(action).toBe('promote') // bob(200) < carol(300)

    const promoted = HostSession.fromPromotedClient(tB, bGs, clientB!.knownSlots)
    expect(promoted.spriteNumOf('alice')).toBeDefined()
    expect(promoted.spriteNumOf('carol')).toBeDefined()
    clientB = null
    hostSession = promoted // 이제 B가 권위 시뮬 구동

    for (let i = 0; i < 20; i++) { hostSession.tick(); clientC.tick() } // 매치 지속

    expect(cGs.ticks).toBeGreaterThan(cTicksBefore) // C가 계속 스냅샷 수신 중(로컬 gs 계속 전진)
    for (const num of [promoted.spriteNumOf('alice')!, promoted.spriteNumOf('bob')!, promoted.spriteNumOf('carol')!]) {
      expect(Number.isNaN(bGs.spriteParts.pos[num].x)).toBe(false)
      expect(Number.isNaN(cGs.spriteParts.pos[num].x)).toBe(false)
    }
  })
})
```

- [ ] **PASS 확인** — 실패 시: (a) `setupTestGame` 로드 문제인지(다른 net 통합테스트와 동일 헬퍼) (b) `fromPromotedClient`가 3계정 전부 `slotOf`를 채웠는지(`knownSlots`가 비었으면 Task1의 ASSIGN 전원기록 배선 확인).
- [ ] **Commit**: `git commit -m "test(net): loopback host-migration integration — match survives host death, B promotes (M3-E)"`

---

### Task 4: `session.ts` — Session 전략 seam (호스트권위 어댑터 + 피어 스텁)

스펙 §3.1 모드③ + §9(YAGNI)를 동시 만족. **`main.ts`의 기존 배선은 갈아엎지 않는다**(§자체리뷰) — 독립적 타입 계약으로만 존재.

```ts
// src/net/session.ts
import type { GameState } from '../core/state'
import type { Transport } from './types'

export interface Session {
  readonly kind: 'host-authoritative' | 'peer'
  readonly gs: GameState
  tick(): void
  spriteNumOf(account: string): number | undefined
}

// 호스트권위 전략(M3-B~D 산출물, 무수정) 어댑터 — HostSession/ClientSession을 그대로 위임.
export class HostAuthoritativeSession implements Session {
  readonly kind = 'host-authoritative' as const
  constructor(private readonly inner: { tick(): void; gs: GameState; spriteNumOf?(account: string): number | undefined }) {}
  get gs() { return this.inner.gs }
  tick() { this.inner.tick() }
  spriteNumOf(account: string) { return this.inner.spriteNumOf?.(account) }
}

// 피어/피해자권한 전략 — 스펙 §9 "범위 밖"(YAGNI), seam만 확정. 아이디어(미구현): 각 클라가
// 자기 스프라이트만 권위 있게 시뮬(로컬입력 즉시반영), 피격 판정은 피해자 클라가 직접 확정해
// 데미지/사망 이벤트 브로드캐스트(원작 Soldat 논서버 모드와 동일 발상). 호스트권위가 릴레이
// 부하/레이턴시로 감당 안 될 때 이 전략으로 교체 — 그 시점에 tick()부터 채운다.
export class PeerSession implements Session {
  readonly kind = 'peer' as const
  constructor(private readonly transport: Transport, public readonly gs: GameState, private readonly myAccount: string) {}
  tick(): void { /* TODO(M4+, 스펙 §9): 로컬입력 즉시적용 + updateFrame 부분실행 + 피해자권한 데미지 확정 브로드캐스트. 의도적 no-op. */ }
  spriteNumOf(_account: string): number | undefined { return undefined } // 스텁 — 로컬스폰 로직 없음
}
```

**테스트** — `src/tests/session-seam.test.ts`: (1) `HostAuthoritativeSession`(실제 loopback `HostSession` 래핑)이 `Session` 타입에 대입 가능 + `spriteNumOf`/`tick()`/`gs` 동작 확인. (2) `PeerSession`이 `Session`에 대입 가능 + `tick()`이 던지지 않고 `spriteNumOf`가 `undefined`(문서화된 스텁 동작) 확인. (3) 배열에 두 kind를 섞어 순회하며 `tick()` 호출 → `kind` 값으로 "설정 한 줄 교체" 실증. 세 테스트 모두 `const session: Session = new X(...)` 형태로 대입해 컴파일 성공 자체가 타입 계약 검증이 되도록 작성.

- [ ] **PASS + tsc + Commit**: `git commit -m "feat(net): Session strategy seam — host-authoritative adapter + documented peer stub (M3-E)"`

---

### Task 5: `reconnect.ts` — 재접속 시도 + 포기 신호

```ts
// src/net/reconnect.ts — ClientSession은 재구성하지 않는다: Transport 객체 동일성이 재연결
// 전후로 유지되는 한(agent8/loopback 모두 그렇다) onMessage 핸들러가 살아있어 재접속 후 자동으로
// 스냅샷을 이어 받는다. 필요한 건 connect() 재시도 + 같은 방 rejoin뿐.
import type { Transport } from './types'

export interface ReconnectOptions {
  transport: Transport; roomKey: string
  maxAttempts?: number; backoffMs?: number; sleepFn?: (ms: number) => Promise<void>
}
export type ReconnectResult = 'reconnected' | 'gave-up'
const defaultSleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))

export async function attemptReconnect(opts: ReconnectOptions): Promise<ReconnectResult> {
  const maxAttempts = opts.maxAttempts ?? 3, backoffMs = opts.backoffMs ?? 1000, sleep = opts.sleepFn ?? defaultSleep
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const status = await opts.transport.connect()
    if (status === 'online') { await opts.transport.joinRoom(opts.roomKey); return 'reconnected' }
    if (attempt < maxAttempts) await sleep(backoffMs * attempt)
  }
  return 'gave-up'
}
```

**테스트** — `src/tests/reconnect.test.ts`: 가짜 `Transport`(`connect()`가 시퀀스 값을 순서대로 반환하는 `vi.fn`)로 3케이스: (1) 첫 시도 성공 → `'reconnected'` + `joinRoom(roomKey)` 호출됨 (2) `offline,offline,online` → 재시도 끝에 성공, `sleepFn`이 `[backoffMs, backoffMs*2]`로 호출됨 (3) 전부 `offline` → `'gave-up'`, `joinRoom` 호출 안 됨.

- [ ] **PASS + tsc + Commit**: `git commit -m "feat(net): client reconnect-with-backoff, gives up to offline fallback (M3-E)"`

---

### Task 6: `main.ts` 배선 — 마이그레이션 감시 + 재접속 감시 + 디버그 훅

`startNetMatch`(274~342행)의 `isHost` **상수를 `let`**으로, 60Hz 루프 진입부에 감시 훅 한 줄을 추가한다. 씬 구성/렌더는 무수정.

```ts
// src/web/main.ts — startNetMatch() 안, 기존 로직에 아래 굵은 부분만 추가
import { decideMigration } from '../net/host-migration'
import { attemptReconnect } from '../net/reconnect'
// (session.ts는 이번 단계에서 main.ts가 직접 소비하지 않음 — §Task4 "독립 seam" 선택, §자체리뷰)

async function startNetMatch(a: StartMatchArg): Promise<void> {
  // ...기존 씬/트랜스포트 구성 무수정...
  let myNum = -1
  let isHost = dedicatedUrl ? false : a.lobby.isHost // let(승격/강등 재대입)
  let myEpoch = 0 // 내가 승격했다면 세대(스플릿브레인 강등 판단용)
  let hostSession: HostSession | null = null
  let clientSession: ClientSession | null = null
  // ...기존 초기 스폰/세션생성 분기 무수정...

  let reconnecting = false
  function checkMigrationAndReconnect(): void {
    if (isDedicated) return // 전용호스트: 마이그레이션 없음(스펙§3.1), 재접속 스코프 밖
    if (isHost) {
      const rs = a.lobby.roomState
      if (rs.hostAccount && rs.hostAccount !== account && (rs.hostEpoch ?? 0) > myEpoch) {
        console.log(`[net] demoted — ${rs.hostAccount} claimed epoch ${rs.hostEpoch}`) // 스플릿브레인 가드
        hostSession = null; isHost = false
        clientSession = new ClientSession(transport, gs, account, () => currentLocalInput)
      }
      return
    }
    if (transport.status === 'offline' && !reconnecting) {
      reconnecting = true
      attemptReconnect({ transport, roomKey: a.lobby.roomKey ?? '' }).then((result) => {
        reconnecting = false
        if (result === 'gave-up') degradeToOfflineBots('reconnect failed')
      })
      return
    }
    if (!clientSession) return
    const action = decideMigration(clientSession.lastSnapshotAt, {
      getPlayers: () => a.lobby.players, myAccount: account, currentHostAccount: a.lobby.roomState.hostAccount, nowFn: () => Date.now(),
    })
    if (action !== 'promote') return
    console.log('[net] promoting to host')
    const promoted = HostSession.fromPromotedClient(transport, gs, clientSession.knownSlots)
    myNum = promoted.spriteNumOf(account) ?? clientSession.myNum ?? -1
    myEpoch = (a.lobby.roomState.hostEpoch ?? 0) + 1
    hostSession = promoted; clientSession = null; isHost = true
    void transport.updateRoomState({ hostAccount: account, hostEpoch: myEpoch })
  }

  function degradeToOfflineBots(reason: string): void {
    console.warn(`[net] falling back to offline bots: ${reason}`)
    app.ticker.stop(); app.destroy(true); document.body.innerHTML = ''
    startBotMatch().catch(fail)
  }

  ;(window as unknown as Record<string, unknown>).__soldatNet = { lobby: a.lobby, gs } // §설계결정5 수동우회용

  let acc = 0
  app.ticker.add((ticker) => {
    checkMigrationAndReconnect() // ← 신규 한 줄, 루프 나머지는 기존 그대로
    // ...기존 acc/tick/렌더 로직 무수정...
  })
}
```

> 원가: `checkMigrationAndReconnect`는 매 프레임 호출되지만 값 비교 + `Date.now()`뿐이라 스로틀 불필요. 승격 순간 한 프레임 미만의 렌더 과도기가 있을 수 있으나 `gs` 승계라 다음 프레임에 정상화(육안 확인은 §Task9 수동체크리스트).

- [ ] **tsc + 스위트 재확인 + 수동 확인**: `npx tsc --noEmit && npx vitest run`(269+신규 그린) 후 `npm run dev`로 `?nolobby=1` 봇전 회귀 없음 확인.
- [ ] **Commit**: `git commit -m "feat(web): wire host-migration watchdog + reconnect + debug hook into net match loop (M3-E)"`

---

### Task 7: 전용호스트 `--public-url` 배선 (설계 결정 5)

- [ ] **`host.ts`**: `parseArgs` 반환에 `publicUrl?: string` 추가, `get('--public-url')`로 파싱, `resolveHostTransport({..., publicUrl: args.publicUrl})`로 전달.
- [ ] **`node-transport.ts`**: `ResolveOptions`에 `publicUrl?: string` 추가. `mode:'agent8'`(행복경로) 분기: `publicUrl`이 있어도 무시하고 로그만("agent8-in-node에선 불필요 — 릴레이가 라우팅함", 오조합 방지). `mode:'own-ws'`(Plan-B) 분기: `publicUrlHint = opts.publicUrl ?? 'ws://localhost:<port>/'`로 세팅하고, `publicUrl`이 있으면 "Node 프로세스엔 agent8 연결이 없어 `dedicatedHostUrl` 자동기록 불가 — `docs/DEPLOY-VERSE8.md` §3의 수동 콘솔 명령 참조" 로그를 명시적으로 남긴다(정직성 — 자동화된 척하지 않음).
- [ ] **tsc + Commit**: `git commit -m "feat(server): --public-url flag wiring + honest own-ws limitation logging (M3-E)"`

---

### Task 8: CI 갭 고정 — `npm test` 클린 클론에서 그린

이중 안전장치: (1) `pretest` npm 훅 (2) `host-boot.test.ts` 자체의 `beforeAll` 자가빌드 폴백(어떤 진입점으로 vitest가 불려도 이 테스트만은 항상 그린).

- [ ] **`package.json`**: `"pretest": "npm run build:host"` 추가(`test` 스크립트 위).
- [ ] **`host-boot.test.ts`**: 파일 최상단에 아래 `beforeAll` 블록 추가(기존 `describe`/`it` 본문은 무수정).

```ts
import { beforeAll } from 'vitest'
import { spawnSync } from 'node:child_process'
const repoRoot = path.resolve(__dirname, '../..')

beforeAll(() => {
  if (existsSync(bundlePath)) return
  console.log('[host-boot.test] dist-server/host.mjs missing — self-building (M3-E CI safety net)')
  const r = spawnSync('npm', ['run', 'build:host'], { cwd: repoRoot, stdio: 'inherit' })
  if (r.status !== 0) throw new Error('self-build of dist-server/host.mjs failed — see output above')
}, 30000)
```

- [ ] **직접 재현·확인**:
```bash
rm -rf dist-server && npx vitest run src/tests/host-boot.test.ts   # beforeAll 자가빌드 → 통과 기대
rm -rf dist-server && npm test                                     # pretest가 먼저 빌드 → 전체 통과 기대
```
- [ ] **Commit**: `git commit -m "fix(ci): npm test green from a clean clone — pretest + self-build fallback (M3-E)"`

---

### Task 9: Verse8 배포 문서 + 플레이테스트 체크리스트

- [ ] **`docs/DEPLOY-VERSE8.md`** — 아래 골자를 그대로 파일화(사람이 그대로 따라 할 수 있게):
  - **0. 지금 되는 것**: `npm run assets && npm run dev` — 미배포면 자동 오프라인 봇전.
  - **1. agent8 활성화**: `npm install @agent8/gameserver` → `npx -y @agent8/deploy`(계정 로그인 흐름 따라가면 `.env`에 `VITE_AGENT8_ACCOUNT`/`VITE_AGENT8_VERSE` 자동 생성, 수동편집 불필요) → `npm run dev` 재기동.
  - **2. 브라우저-호스트(기본, 설정 0)**: 첫 입장 탭이 호스트. M3-E부터 그 탭이 사라지면 `joinedAt` 최솟값 계정이 자동 승격(콘솔에 `[net] promoting to host`). 룸에 탭이 0개면 매치 종료(재생성 필요).
  - **3. 전용 Node 호스트(선택)**: `npm run build:host && npm run host -- --room r1 --mode dm --players alice,bob`. agent8-in-node 성공 시 추가설정 불필요. 실패 시 자동 Plan-B(자체 ws :8765) — 외부공개는 `cloudflared tunnel --url http://localhost:8765` 후 `npm run host -- --room r1 --public-url wss://xxxx.trycloudflare.com/`. **알려진 제약**: Plan-B는 Node에 agent8 연결이 없어 `dedicatedHostUrl` 자동기록 불가 — 방장이 브라우저 콘솔에서 1회 `await window.__soldatNet.lobby.net.updateRoomState({ dedicatedHostUrl: 'wss://xxxx.trycloudflare.com/' })` 실행. 전용호스트는 마이그레이션 없음(죽으면 매치 종료, pm2/systemd 감시는 스코프 밖). 룸 로스터 자동구독 미구현(`--players` 수동 지정).
  - **4. gitlab.verse8.io 업로드**: 이 레포는 `game/` 서브폴더 규약 불필요(루트에 이미 `index.html`/`vite.config.js`/`package.json`, 표준 `vite build` — Man's Panic 자체개발게임 패턴과 동일, `verse8-starter`의 `game/` 요구는 그 스타터 전용). 절차: (a) verse8.io에서 프로젝트 생성 → GitLab 토큰 발급(1회만 표시) (b) `git clone -b develop https://oauth2:<token>@gitlab.verse8.io/<user>/<repo>.git` (c) V8 템플릿 제거, 이 레포 파일로 교체(`.env`/`.gitignore`/`@agent8/gameserver` 의존성 유지) (d) `npm install && npm run build` 검증 후 push (e) V8 AI 첫 프롬프트에 "develop 최신 커밋(해시 명시)과 동기화부터, 로직/구조 변경 금지, 그대로 빌드·배포만" 명시. **주의**: GitLab 단방향 동기화 — 외부 push가 V8 워크스페이스에 자동반영 안 됨, V8 AI에게 직접 `git fetch origin && git reset --hard origin/develop` 시켜야 함.
  - **5. 확인**: `docs/m3-net-checklist.md` 링크.

- [ ] **`docs/m3-net-checklist.md`** — m1/m2 체크리스트와 동일 3단 구성으로 작성:
  - **✅ 자동검증 완료**(loopback): 로비/이동/전투/전용서버 부팅(M3-A~D 계승) + **호스트 마이그레이션**(loopback 3자, NaN 0) + **재접속**(가짜 transport 3분기) + **오프라인폴백 판단**(순수함수) + **Session seam**(타입+행위) + **`npm test` 클린그린**(pretest+자가빌드).
  - **👀 수동확인 필요**(실배포 후, 2인 이상): 실 agent8 룸생성/입장/매치, 호스트 탭 실제로 닫아 자동승격 체감(위치/체력/스코어 순간이동 없이 이어지는지), 네트워크 오프라인 토글로 재접속 체감, 8인 스냅샷 실측대역폭(스펙§8-리스크2), Cloudflare 터널로 외부인 접속, CTF 8인 풀매치→로비복귀, 킬피드/스코어보드 지연 체감.
  - **알려진 편차/M4+ 이월**: 로컬예측=스무딩(정밀rollback 아님), **탄환 동틱 생성+소멸 미브로드캐스트**(선행사실7, 데미지엔 무관), 봇+사람 혼합매치 미지원, 전용호스트 자동로스터구독 미구현, peer-session 미구현(seam만), own-ws 재접속/마이그레이션 스코프 밖.

- [ ] **Commit**: `git commit -m "docs: Verse8 deploy guide + M3 network playtest checklist (M3-E)"`

---

### Task 10: 최종 회귀 확인 (커밋 없음, 검증만)

```bash
npx tsc --noEmit
rm -rf dist-server && npm test          # pretest 빌드 → 전체 그린(269 + E단계 신규분)
git diff --stat src/core                # 빈 출력 — 코어 무수정 확인
npm run build && npm run build:host     # 브라우저/Node 양쪽 빌드 확인
```
문제 발견 시 해당 태스크로 돌아가 수정 후 새 커밋(이 태스크 자체는 검증 전용).

---

## 검증 요약 (스펙 §6-E 대조)

| 요구 | 커버 |
|---|---|
| 호스트 마이그레이션 | T2(electHost/decideMigration/fromPromotedClient) + T3(loopback 3자 통합, 브리핑 시나리오 그대로) + T6(main.ts 배선) |
| 재접속 | T5(attemptReconnect) + T6(감시 훅 + degradeToOfflineBots) |
| peer-session seam | T4(Session + HostAuthoritativeSession + PeerSession 스텁 + 타입/행위 테스트) |
| 오프라인 폴백(전 경로) | T5 + T6(재접속포기·스플릿브레인강등 실배선) + 기존 A단계 초기게이트(무수정) |
| Verse8 배포 문서 | T9(DEPLOY-VERSE8.md) |
| 플레이테스트 체크리스트 | T9(m3-net-checklist.md) |
| CI 클린그린 | T8(pretest + 자가빌드 이중안전장치) — 선행사실3에서 갭을 직접 재현해 확인 후 고침 |
| agent8-in-node happy-path 완비 | T7(`--public-url` 실파싱 + 양쪽 분기 정직한 로깅) — 실측 자체는 여전히 패키지 설치 후 몫(D 열린질문1 계승) |
| 탄환 cosmetic 엣지 | 선행사실7에서 defer 결정, 문서화만(T9) |
| tsc 클린·코어 무수정·회귀 없음 | 각 태스크 Step + T10 |

## Self-Review 및 열린 질문

- **Session을 main.ts가 지금 소비하지 않는 이유**: `HostSession`/`ClientSession`은 스폰·HUD연동이 근본적으로 비대칭이라 하나의 균일 인터페이스로 강제하면 옵셔널투성이 어댑터가 필요해진다. 마이그레이션에 실제 필요한 건 "널러블 변수 재대입"뿐이라 기존 패턴으로 충분했다(T6). `Session`(T4)은 "피어모드로 정말 전환할 계획이 잡히면 그때 main.ts가 갈아탈 target 규약"으로 존재 — 브리핑의 "config flip 되도록 seam만 확정" 요구를 문자 그대로 만족시키되 억지 리팩터의 리스크는 피했다. 이견이 있으면(main.ts도 지금부터 Session 경유를 강제해야 한다면) T6 재작업 필요 — 열어둔다.
- **열린 질문 1**: 스플릿브레인 가드(T6)는 "좀비 호스트가 되살아나 두 HostSession이 동시에 브로드캐스트"하는 경합 시나리오의 통합테스트가 없다(T3는 "깨끗한 죽음"만 검증). 필요하면 후속으로 전용 통합테스트 추가.
- **열린 질문 2(D단계 계승)**: `resolveHostTransport`의 `mode:'agent8'` 분기는 여전히 `transport: null` — `@agent8/gameserver` 미설치라 오늘도 실측 불가. T7은 `publicUrl` 로깅만 추가했을 뿐, "raw 인스턴스→Transport 어댑터" 3~5줄은 패키지 설치 시점에 채워야 한다.
- **열린 질문 3(D단계 계승)**: 전용 Node 호스트의 룸상태 자동 로스터 구독은 미해결(agent8-in-node 검증 전엔 확정 불가) — 배포문서에 `--players` 수동지정으로 명시.
- **열린 질문 4**: `HOST_TIMEOUT_MS=3000`/`maxAttempts=3, backoffMs=1000`은 보수적 추정치로 하드코딩 — 실배포 릴레이 레이턴시 실측(스펙§8-리스크2) 후 튜닝 필요할 수 있음.
- **열린 질문 5**: own-ws(Plan-B) 경로의 재접속은 스코프 밖으로 명시(체크리스트에 기재) — 그 경로 자체가 "룸=프로세스 1개, 마이그레이션 없음" 전제와는 일치하나, 필요성 확인되면 M4+ 후보.
- **다음 단계**: 이 계획 완료(리뷰 통과) 후 M3 전체 마무리 — 이후는 사용자의 실배포(`npx @agent8/deploy`) + `docs/m3-net-checklist.md` 수동 항목 실행 결과에 달려 있다.
