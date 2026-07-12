# M3 Phase A: 전송 계층 + 로비 구현 계획

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement task-by-task. Steps use checkbox (`- [ ]`) syntax.

**Goal:** agent8 릴레이 위에 provider 주입식 전송 계층 + 인프로세스 loopback 목 + 메시지 프로토콜 골격 + 로비/룸/팀선택 UI를 만들어, (배포 없이) 두 세션이 같은 방에 모여 팀을 고르는 데까지 도달한다.

**Architecture:** `src/net/`에 전송(transport)·목(loopback)·프로토콜(protocol)을 두고, agent8 구체 API가 아니라 `Transport` 인터페이스에만 의존하게 한다. 로비 UI는 `src/web/lobby/`에 상태머신(타이틀→로비→룸)으로 둔다. 코어(`src/core/*`)는 무수정. 배포용 `server.js`는 룸/릴레이 함수만.

**Tech Stack:** TypeScript, Vitest, @agent8/gameserver(lazy·배포시에만), Vite. 코어는 순수 TS.

선행 사실: 스펙 `docs/superpowers/specs/2026-07-12-m3-network-multiplayer-design.md` §2~5. agent8 API는 `GameServer.getInstance()`+`connect()`→`account`, `remoteFunction(name,args,{throttle,needResponse})`, `onRoomMessage(roomId,event,cb)`. 미배포면 offline. 팀상수: TEAM_NONE=0/ALPHA=1/BRAVO=2/SPECTATOR=5, GAMESTYLE_DEATHMATCH=0/CTF=3 (constants.ts). 브랜치 `m3-network` 체크아웃됨. Node: `export PATH="$HOME/.nvm/versions/node/v23.11.0/bin:$PATH"`.

---

## 파일 구조 (Phase A 산출물)

```
src/net/
  types.ts        ← Transport 인터페이스 + 메시지/룸상태 타입 (전 파일 공유 계약)
  protocol.ts     ← 메시지 종류 enum + 입력/스냅샷 (역)직렬화 (A는 lobby 메시지만; B/C가 확장)
  loopback.ts     ← 인프로세스 목 릴레이 provider (여러 세션이 한 프로세스에서 연결)
  transport.ts    ← provider 주입식 래퍼 (connect/join/leave/send/onMessage/roomState/offline폴백)
  lobby-client.ts ← 로비 로직(순수, UI無): 룸목록/입장/생성/팀선택/레디/시작 상태
src/web/lobby/
  lobby-ui.ts     ← 타이틀→로비→룸 DOM UI (lobby-client 구독)
server.js         ← (루트) agent8 서버함수: joinRoom/룸상태/브로드캐스트 릴레이
src/tests/
  protocol.test.ts, loopback.test.ts, transport.test.ts, lobby-client.test.ts
```

---

### Task 1: net/types.ts — 공유 계약

**Files:** Create `src/net/types.ts`

- [ ] **Step 1: 작성** (테스트 불필요 — 타입 선언만)

```ts
// src/net/types.ts — 넷 계층 공유 계약. 코어/agent8 구체 API에 의존하지 않는다.

// 룸 참가자 (agent8 룸상태 p_{account} 값)
export interface RoomPlayer {
  nick: string
  team: number       // constants.ts TEAM_NONE/ALPHA/BRAVO/SPECTATOR
  ready: boolean
  kills: number
  deaths: number
  joinedAt: number
}

// 룸 전체 상태 (agent8 룸상태 — flat key 규약: p_{account} + 스칼라)
export interface RoomState {
  mode: number       // GAMESTYLE_DEATHMATCH | GAMESTYLE_CTF
  hostAccount: string
  started: boolean
  roundEndsAt: number
  [playerKey: string]: unknown  // 'p_{account}' → RoomPlayer
}

// 로비 룸 목록 항목 (soldat_rooms 컬렉션)
export interface RoomListing {
  key: string
  count: number
  mode: number
  started: boolean
}

// 브로드캐스트 메시지 핸들러
export type MessageHandler = (event: string, payload: unknown, fromAccount: string) => void

// 전송 계층 인터페이스 — transport.ts(실 agent8)와 loopback.ts(목)가 모두 구현.
// 세션 코드는 이 인터페이스에만 의존한다.
export interface Transport {
  readonly account: string
  readonly status: 'offline' | 'connecting' | 'online'
  connect(): Promise<Transport['status']>
  listRooms(): Promise<RoomListing[]>
  joinRoom(roomKey: string): Promise<void>       // 없으면 생성
  leaveRoom(): Promise<void>
  getRoomState(): Promise<RoomState>
  updateRoomState(patch: Record<string, unknown>): Promise<void>  // 얕은병합, null=삭제
  send(event: string, payload: unknown): void    // broadcastToRoom 릴레이
  onMessage(handler: MessageHandler): void
  onRoomState(handler: (s: RoomState) => void): void
}
```

- [ ] **Step 2: 타입체크** — `export PATH="$HOME/.nvm/versions/node/v23.11.0/bin:$PATH" && npx tsc --noEmit` → clean
- [ ] **Step 3: Commit** — `git add src/net/types.ts && git commit -m "feat(net): shared Transport contract types"`

### Task 2: net/loopback.ts — 인프로세스 목 릴레이

**Files:** Create `src/net/loopback.ts`, `src/tests/loopback.test.ts`

한 프로세스에서 여러 `Transport`가 공유 허브를 통해 룸상태/브로드캐스트를 주고받는 목. 배포 없이 멀티 시나리오를 테스트하는 핵심 수단.

- [ ] **Step 1: 실패 테스트**

```ts
// src/tests/loopback.test.ts
import { describe, it, expect } from 'vitest'
import { LoopbackHub } from '../net/loopback'

describe('LoopbackHub', () => {
  it('two transports join same room and see each other in room state', async () => {
    const hub = new LoopbackHub()
    const a = hub.createTransport('alice')
    const b = hub.createTransport('bob')
    await a.connect(); await b.connect()
    expect(a.status).toBe('online')
    await a.joinRoom('room1')
    await a.updateRoomState({ mode: 0, hostAccount: 'alice', started: false, roundEndsAt: 0, p_alice: { nick: 'Alice', team: 0, ready: false, kills: 0, deaths: 0, joinedAt: 1 } })
    await b.joinRoom('room1')
    await b.updateRoomState({ p_bob: { nick: 'Bob', team: 0, ready: false, kills: 0, deaths: 0, joinedAt: 2 } })
    const state = await a.getRoomState()
    expect((state.p_alice as any).nick).toBe('Alice')
    expect((state.p_bob as any).nick).toBe('Bob')
  })

  it('broadcast reaches other members but not sender-only, includes fromAccount', async () => {
    const hub = new LoopbackHub()
    const a = hub.createTransport('alice'); const b = hub.createTransport('bob')
    await a.connect(); await b.connect()
    await a.joinRoom('r'); await b.joinRoom('r')
    const got: any[] = []
    b.onMessage((event, payload, from) => got.push({ event, payload, from }))
    a.send('ping', { n: 42 })
    await Promise.resolve() // flush microtasks
    expect(got).toEqual([{ event: 'ping', payload: { n: 42 }, from: 'alice' }])
  })

  it('updateRoomState null deletes a key and notifies onRoomState', async () => {
    const hub = new LoopbackHub()
    const a = hub.createTransport('alice'); await a.connect(); await a.joinRoom('r')
    let last: any = null; a.onRoomState((s) => { last = s })
    await a.updateRoomState({ p_alice: { nick: 'A', team: 1, ready: false, kills: 0, deaths: 0, joinedAt: 1 } })
    expect(last.p_alice.team).toBe(1)
    await a.updateRoomState({ p_alice: null })
    expect(last.p_alice).toBeUndefined()
  })

  it('listRooms reflects joined rooms with counts', async () => {
    const hub = new LoopbackHub()
    const a = hub.createTransport('alice'); await a.connect(); await a.joinRoom('room1')
    await a.updateRoomState({ mode: 3, started: false })
    const rooms = await a.listRooms()
    expect(rooms.find((r) => r.key === 'room1')).toMatchObject({ key: 'room1', count: 1, mode: 3 })
  })
})
```

- [ ] **Step 2: FAIL 확인** — `npx vitest run src/tests/loopback.test.ts`
- [ ] **Step 3: 구현**

```ts
// src/net/loopback.ts — 인프로세스 목 릴레이. 배포/SDK 없이 N세션 연결.
import type { Transport, RoomState, RoomListing, MessageHandler } from './types'

interface Room {
  state: RoomState
  members: Set<LoopbackTransport>
}

export class LoopbackHub {
  private rooms = new Map<string, Room>()

  createTransport(account: string): Transport {
    return new LoopbackTransport(account, this)
  }

  /** @internal */ _room(key: string): Room {
    let r = this.rooms.get(key)
    if (!r) { r = { state: {} as RoomState, members: new Set() }; this.rooms.set(key, r) }
    return r
  }
  /** @internal */ _listings(): RoomListing[] {
    return [...this.rooms.entries()].map(([key, r]) => ({
      key, count: r.members.size,
      mode: (r.state.mode as number) ?? 0,
      started: (r.state.started as boolean) ?? false,
    }))
  }
}

class LoopbackTransport implements Transport {
  status: Transport['status'] = 'offline'
  private roomKey: string | null = null
  private msgHandler: MessageHandler = () => {}
  private stateHandler: (s: RoomState) => void = () => {}
  constructor(readonly account: string, private hub: LoopbackHub) {}

  async connect() { this.status = 'online'; return this.status }
  async listRooms() { return (this.hub as any)._listings() as RoomListing[] }

  async joinRoom(key: string) {
    const r = (this.hub as any)._room(key) as Room
    r.members.add(this); this.roomKey = key
    this.stateHandler({ ...r.state })
  }
  async leaveRoom() {
    if (!this.roomKey) return
    const r = (this.hub as any)._room(this.roomKey) as Room
    r.members.delete(this); this.roomKey = null
  }
  async getRoomState() {
    if (!this.roomKey) return {} as RoomState
    return { ...(this.hub as any)._room(this.roomKey).state }
  }
  async updateRoomState(patch: Record<string, unknown>) {
    if (!this.roomKey) return
    const r = (this.hub as any)._room(this.roomKey) as Room
    for (const [k, v] of Object.entries(patch)) {
      if (v === null) delete (r.state as any)[k]
      else (r.state as any)[k] = v
    }
    for (const m of r.members) (m as LoopbackTransport).stateHandler({ ...r.state })
  }
  send(event: string, payload: unknown) {
    if (!this.roomKey) return
    const r = (this.hub as any)._room(this.roomKey) as Room
    for (const m of r.members) {
      if (m === this) continue // 발신자 제외 (agent8 broadcastToRoom 관례와 정합 — 로컬 예측이 자기건 이미 처리)
      queueMicrotask(() => (m as LoopbackTransport).msgHandler(event, payload, this.account))
    }
  }
  onMessage(h: MessageHandler) { this.msgHandler = h }
  onRoomState(h: (s: RoomState) => void) { this.stateHandler = h }
}
```

- [ ] **Step 4: PASS 확인 + Commit** — `npx vitest run src/tests/loopback.test.ts` → 4 pass. `git add src/net/loopback.ts src/tests/loopback.test.ts && git commit -m "feat(net): in-process loopback mock relay"`

### Task 3: net/protocol.ts — 메시지 종류 + 로비 페이로드 (A 범위)

**Files:** Create `src/net/protocol.ts`, `src/tests/protocol.test.ts`

A단계는 로비/제어 메시지 종류 enum + 타입가드만. 입력/스냅샷 바이너리 팩은 B/C가 이 파일을 확장(주석으로 자리 표기).

- [ ] **Step 1: 실패 테스트**

```ts
// src/tests/protocol.test.ts
import { describe, it, expect } from 'vitest'
import { MSG, isMsg } from '../net/protocol'

describe('protocol message kinds', () => {
  it('has stable string kinds for lobby/game events', () => {
    expect(MSG.INPUT).toBe('input')
    expect(MSG.SNAPSHOT).toBe('snap')
    expect(MSG.BULLET).toBe('bul')
    expect(MSG.KILL).toBe('kill')
    expect(MSG.START).toBe('start')
  })
  it('isMsg narrows a known kind', () => {
    expect(isMsg('input')).toBe(true)
    expect(isMsg('nope')).toBe(false)
  })
})
```

- [ ] **Step 2: FAIL 확인** — `npx vitest run src/tests/protocol.test.ts`
- [ ] **Step 3: 구현**

```ts
// src/net/protocol.ts — 넷 메시지 종류. B단계에서 INPUT/SNAPSHOT 바이너리 (역)직렬화 추가.
export const MSG = {
  INPUT: 'input',   // 클라→호스트: control 비트마스크 + mouseAim (B단계)
  SNAPSHOT: 'snap', // 호스트→전체: 병사 상태 배열 (B단계)
  BULLET: 'bul',    // 호스트→전체: 탄환 생성 이벤트 (C단계)
  KILL: 'kill',     // 호스트→전체: killer/victim/weapon (C단계)
  START: 'start',   // 호스트→전체: 매치 시작 (A단계에서 종류만 예약)
} as const

export type MsgKind = (typeof MSG)[keyof typeof MSG]

const KNOWN = new Set<string>(Object.values(MSG))
export function isMsg(k: string): k is MsgKind {
  return KNOWN.has(k)
}
```

- [ ] **Step 4: PASS + Commit** — `git add src/net/protocol.ts src/tests/protocol.test.ts && git commit -m "feat(net): message kind registry (lobby scope)"`

### Task 4: net/transport.ts — provider 주입식 agent8 래퍼

**Files:** Create `src/net/transport.ts`, `src/tests/transport.test.ts`

실 agent8 SDK를 provider로 주입받아 `Transport` 인터페이스로 감싼다. 미배포/타임아웃 시 offline. 테스트는 mock provider로 SDK 없이 검증.

- [ ] **Step 1: 실패 테스트**

```ts
// src/tests/transport.test.ts
import { describe, it, expect, vi } from 'vitest'
import { makeAgent8Transport } from '../net/transport'

function mockServer() {
  const handlers: Record<string, (m: any) => void> = {}
  return {
    account: 'srv-acc',
    connect: vi.fn(async () => {}),
    remoteFunction: vi.fn(async (name: string, args: any[]) => {
      if (name === 'listRooms') return [{ key: 'r1', count: 2, mode: 0, started: false }]
      if (name === 'joinRoom') return { ok: true }
      if (name === 'getRoomState') return { mode: 0, hostAccount: 'srv-acc', started: false, roundEndsAt: 0 }
      return null
    }),
    onRoomMessage: vi.fn((roomId: string, event: string, cb: (m: any) => void) => { handlers[event] = cb }),
    _emit: (event: string, m: any) => handlers[event]?.(m),
  }
}

describe('makeAgent8Transport', () => {
  it('offline when not configured (no VITE_AGENT8_VERSE)', async () => {
    const t = makeAgent8Transport({ getInstance: () => mockServer() as any, configured: false })
    expect(await t.connect()).toBe('offline')
    expect(t.status).toBe('offline')
  })
  it('online on successful connect, exposes account', async () => {
    const t = makeAgent8Transport({ getInstance: () => mockServer() as any, configured: true })
    expect(await t.connect()).toBe('online')
    expect(t.account).toBe('srv-acc')
  })
  it('listRooms delegates to remoteFunction', async () => {
    const t = makeAgent8Transport({ getInstance: () => mockServer() as any, configured: true })
    await t.connect()
    const rooms = await t.listRooms()
    expect(rooms[0]).toMatchObject({ key: 'r1', count: 2 })
  })
  it('offline connect times out to offline (does not hang)', async () => {
    const hang = { account: 'x', connect: () => new Promise(() => {}), remoteFunction: async () => null, onRoomMessage: () => {} }
    const t = makeAgent8Transport({ getInstance: () => hang as any, configured: true, timeoutMs: 50 })
    expect(await t.connect()).toBe('offline')
  })
})
```

- [ ] **Step 2: FAIL 확인** — `npx vitest run src/tests/transport.test.ts`
- [ ] **Step 3: 구현** — nox-arena `makeNet` 패턴 준용, `Transport` 인터페이스로 정형화. `send`는 `remoteFunction('relay',[event,payload],{needResponse:false})`(server.js가 broadcastToRoom으로 릴레이), `onMessage`는 단일 'relay' 이벤트 구독 후 (event,payload,from) 디스패치. joinRoom 시 room 이벤트 구독 설정.

```ts
// src/net/transport.ts — provider 주입식 agent8 래퍼. 미배포/hang 시 offline.
import type { Transport, RoomState, RoomListing, MessageHandler } from './types'

export interface Agent8Provider {
  getInstance: () => {
    account?: string
    connect: () => Promise<void>
    remoteFunction: (name: string, args: unknown[], opts?: object) => Promise<unknown>
    onRoomMessage: (roomId: string, event: string, cb: (m: unknown) => void) => void
  }
  configured?: boolean
  timeoutMs?: number
}

const withTimeout = <T>(p: Promise<T>, ms: number): Promise<T> =>
  Promise.race([p, new Promise<T>((_, rej) => setTimeout(() => rej(new Error('net timeout')), ms))])

export function makeAgent8Transport(provider: Agent8Provider): Transport {
  const timeoutMs = provider.timeoutMs ?? 4000
  const configured = provider.configured ?? true
  let server: ReturnType<Agent8Provider['getInstance']> | null = null
  let roomKey: string | null = null
  let msgHandler: MessageHandler = () => {}
  let stateHandler: (s: RoomState) => void = () => {}

  const t: Transport = {
    account: '',
    status: 'offline',
    async connect() {
      if (!configured) { t.status = 'offline'; return t.status }
      t.status = 'connecting'
      try {
        const s = provider.getInstance()
        await withTimeout(s.connect(), timeoutMs)
        server = s
        ;(t as { account: string }).account = s.account || 'me'
        t.status = 'online'
      } catch { t.status = 'offline' }
      return t.status
    },
    async listRooms() {
      if (t.status !== 'online' || !server) return []
      return ((await withTimeout(server.remoteFunction('listRooms', []), timeoutMs)) as RoomListing[]) ?? []
    },
    async joinRoom(key: string) {
      if (t.status !== 'online' || !server) return
      await withTimeout(server.remoteFunction('joinRoom', [key]), timeoutMs)
      roomKey = key
      server.onRoomMessage(key, 'relay', (m) => {
        const { event, payload, from } = m as { event: string; payload: unknown; from: string }
        msgHandler(event, payload, from)
      })
      server.onRoomMessage(key, 'state', (m) => stateHandler(m as RoomState))
    },
    async leaveRoom() {
      if (t.status !== 'online' || !server) return
      await server.remoteFunction('leaveRoom', []).catch(() => {})
      roomKey = null
    },
    async getRoomState() {
      if (t.status !== 'online' || !server) return {} as RoomState
      return ((await server.remoteFunction('getRoomState', [])) as RoomState) ?? ({} as RoomState)
    },
    async updateRoomState(patch: Record<string, unknown>) {
      if (t.status !== 'online' || !server) return
      await server.remoteFunction('updateRoomState', [patch], { needResponse: false })
    },
    send(event: string, payload: unknown) {
      if (t.status !== 'online' || !server || !roomKey) return
      server.remoteFunction('relay', [event, payload], { needResponse: false })
    },
    onMessage(h: MessageHandler) { msgHandler = h },
    onRoomState(h: (s: RoomState) => void) { stateHandler = h },
  }
  return t
}

// 실 SDK provider (lazy — 테스트/미배포에서 SDK 미로드)
export async function realProvider(): Promise<Agent8Provider> {
  const { GameServer } = await import('@agent8/gameserver')
  return {
    getInstance: () => GameServer.getInstance() as unknown as ReturnType<Agent8Provider['getInstance']>,
    configured: !!import.meta.env.VITE_AGENT8_VERSE,
  }
}
```

주의: `@agent8/gameserver`가 없으면 `realProvider`는 import 에러 → lazy라 호출 안 하면 안전. tsconfig가 미설치 모듈에 에러내면 `// @ts-expect-error optional dep` 주석 처리. 실제 배포시 npm install.

- [ ] **Step 4: PASS + tsc clean + Commit** — 4 tests pass, `npx tsc --noEmit` (agent8 미설치 시 realProvider 라인만 @ts-expect-error). `git add src/net/transport.ts src/tests/transport.test.ts && git commit -m "feat(net): provider-injected agent8 transport with offline fallback"`

### Task 5: server.js — agent8 서버 함수 (루트)

**Files:** Create `server.js` (프로젝트 루트)

배포용 릴레이/룸 함수. 클래스 정의만, export/타이머 금지 (agent8 규약). nox-arena 패턴 준용.

- [ ] **Step 1: 작성** (배포 전 로컬 실행 불가 — 리뷰로 검증)

```js
// server.js — Soldat Verse8 서버. 배포: npx -y @agent8/deploy
// 규약: 클래스 정의만, export/타이머 금지. 전역 $global/$room/$sender.
const CAP = 8

class Server {
  now() { return Date.now() }

  async listRooms() {
    const rooms = await $global.getCollectionItems('soldat_rooms', { limit: 100 }).catch(() => [])
    return rooms.map((r) => ({ key: r.key, count: r.count || 0, mode: r.mode || 0, started: !!r.started }))
  }

  async joinRoom(key) {
    let target = key
    if (!target) {
      const rooms = await $global.getCollectionItems('soldat_rooms', { limit: 100 }).catch(() => [])
      for (const r of rooms) if ((r.count || 0) < CAP && !r.started) { target = r.key; break }
      if (!target) { let n = 1; const have = new Set(rooms.map((r) => r.key)); while (have.has('sr' + n)) n++; target = 'sr' + n }
    }
    await $global.joinRoom(target)
    await $global.updateCollectionItem('soldat_rooms', target, { key: target, count: await this._count(), mode: (await $room.getRoomState()).mode || 0, started: false })
    return { roomId: target }
  }
  async _count() {
    const s = await $room.getRoomState(); return Object.keys(s).filter((k) => k.startsWith('p_')).length
  }
  async leaveRoom() {
    try { await $room.updateRoomState({ ['p_' + $sender.account]: null }) } catch (e) {}
    return await $global.leaveRoom()
  }
  async getRoomState() { return await $room.getRoomState() }
  async updateRoomState(patch) { await $room.updateRoomState(patch); $room.broadcastToRoom('state', await $room.getRoomState()) }

  // 실시간 릴레이 — 클라 send(event,payload) → 룸 전체에 from 포함 재전송
  relay(event, payload) { $room.broadcastToRoom('relay', { event, payload, from: $sender.account }) }
}
```

- [ ] **Step 2: Commit** — `git add server.js && git commit -m "feat(net): agent8 server relay/room functions"`

### Task 6: net/lobby-client.ts — 로비 로직 (순수, UI無)

**Files:** Create `src/net/lobby-client.ts`, `src/tests/lobby-client.test.ts`

`Transport`만 의존하는 로비 상태머신. 룸목록/입장/생성/팀선택/레디/시작. UI는 다음 태스크.

- [ ] **Step 1: 실패 테스트** (loopback 2세션)

```ts
// src/tests/lobby-client.test.ts
import { describe, it, expect } from 'vitest'
import { LoopbackHub } from '../net/loopback'
import { LobbyClient } from '../net/lobby-client'
import { GAMESTYLE_CTF, TEAM_ALPHA, TEAM_BRAVO } from '../core/constants'

describe('LobbyClient (2 sessions over loopback)', () => {
  it('host creates CTF room, guest joins, both pick teams, host starts', async () => {
    const hub = new LoopbackHub()
    const host = new LobbyClient(hub.createTransport('alice'), 'Alice')
    const guest = new LobbyClient(hub.createTransport('bob'), 'Bob')
    await host.connect(); await guest.connect()

    await host.createRoom('ctfroom', GAMESTYLE_CTF)
    expect(host.isHost).toBe(true)
    expect(host.roomState.mode).toBe(GAMESTYLE_CTF)

    await guest.joinRoom('ctfroom')
    // 게스트 룸상태에 host가 보임
    expect(Object.keys(guest.players)).toContain('alice')

    await host.selectTeam(TEAM_ALPHA)
    await guest.selectTeam(TEAM_BRAVO)
    // 상태 전파 확인
    expect(host.players['alice'].team).toBe(TEAM_ALPHA)
    // guest가 host의 팀변경을 봄 (룸상태 브로드캐스트)
    expect(guest.players['alice'].team).toBe(TEAM_ALPHA)
    expect(host.players['bob'].team).toBe(TEAM_BRAVO)

    await guest.setReady(true)
    expect(host.players['bob'].ready).toBe(true)

    let started = false
    guest.onStart(() => { started = true })
    await host.start()
    await Promise.resolve()
    expect(host.roomState.started).toBe(true)
    expect(started).toBe(true) // START 이벤트 게스트 수신
  })

  it('non-host cannot start', async () => {
    const hub = new LoopbackHub()
    const host = new LobbyClient(hub.createTransport('a'), 'A')
    const guest = new LobbyClient(hub.createTransport('b'), 'B')
    await host.connect(); await guest.connect()
    await host.createRoom('r', 0); await guest.joinRoom('r')
    await expect(guest.start()).rejects.toThrow(/host/i)
  })
})
```

- [ ] **Step 2: FAIL 확인** — `npx vitest run src/tests/lobby-client.test.ts`
- [ ] **Step 3: 구현**

```ts
// src/net/lobby-client.ts — Transport 위 로비 상태머신. UI 무관.
import type { Transport, RoomState, RoomPlayer, RoomListing } from './types'
import { MSG } from './protocol'
import { TEAM_NONE } from '../core/constants'

export class LobbyClient {
  roomState: RoomState = {} as RoomState
  private startHandler: () => void = () => {}
  private changeHandler: () => void = () => {}
  private nowFn: () => number
  constructor(private transport: Transport, public nick: string, nowFn: () => number = () => Date.now()) {
    this.nowFn = nowFn
    transport.onRoomState((s) => { this.roomState = s; this.changeHandler() })
    transport.onMessage((event) => { if (event === MSG.START) this.startHandler() })
  }
  get account() { return this.transport.account }
  get isHost() { return this.roomState.hostAccount === this.account }
  get players(): Record<string, RoomPlayer> {
    const out: Record<string, RoomPlayer> = {}
    for (const [k, v] of Object.entries(this.roomState)) if (k.startsWith('p_')) out[k.slice(2)] = v as RoomPlayer
    return out
  }
  async connect() { return this.transport.connect() }
  async listRooms(): Promise<RoomListing[]> { return this.transport.listRooms() }

  private me(): RoomPlayer {
    return { nick: this.nick, team: TEAM_NONE, ready: false, kills: 0, deaths: 0, joinedAt: this.nowFn() }
  }
  async createRoom(key: string, mode: number) {
    await this.transport.joinRoom(key)
    await this.transport.updateRoomState({
      mode, hostAccount: this.account, started: false, roundEndsAt: 0,
      ['p_' + this.account]: this.me(),
    })
    this.roomState = await this.transport.getRoomState()
  }
  async joinRoom(key: string) {
    await this.transport.joinRoom(key)
    await this.transport.updateRoomState({ ['p_' + this.account]: this.me() })
    this.roomState = await this.transport.getRoomState()
  }
  async selectTeam(team: number) {
    const p = this.players[this.account] ?? this.me()
    await this.transport.updateRoomState({ ['p_' + this.account]: { ...p, team } })
  }
  async setReady(ready: boolean) {
    const p = this.players[this.account] ?? this.me()
    await this.transport.updateRoomState({ ['p_' + this.account]: { ...p, ready } })
  }
  async start() {
    if (!this.isHost) throw new Error('only host can start')
    await this.transport.updateRoomState({ started: true, roundEndsAt: this.nowFn() + 5 * 60 * 1000 })
    this.transport.send(MSG.START, {})
    this.startHandler() // 호스트 자신도 시작
  }
  async leave() { await this.transport.leaveRoom() }
  onStart(cb: () => void) { this.startHandler = cb }
  onChange(cb: () => void) { this.changeHandler = cb }
}
```

- [ ] **Step 4: PASS + Commit** — 2 tests pass. `git add src/net/lobby-client.ts src/tests/lobby-client.test.ts && git commit -m "feat(net): lobby client state machine (rooms/teams/ready/start)"`

### Task 7: web/lobby/lobby-ui.ts — 로비 DOM UI

**Files:** Create `src/web/lobby/lobby-ui.ts`. Modify `src/web/main.ts` (부트를 로비 경유로).

타이틀→로비→룸 화면. `LobbyClient` 구독, 팀선택 버튼(원작 Select Team), Start. 헤드리스 테스트 불가(DOM) → 브라우저 검증.

- [ ] **Step 1: 구현** — `src/web/lobby/lobby-ui.ts`에 `mountLobby(root, { onStartMatch })` — 타이틀(닉네임+빠른입장/방만들기), 로비(룸목록), 룸(참가자·팀버튼 Alpha/Bravo/Spectator[CTF]·Ready·Start[호스트]). `LobbyClient.onChange`로 리렌더. 시작 시 `onStartMatch({ lobby, mode, myTeam })` 콜백으로 인게임 전환. offline이면 "봇전 시작"(기존 main.ts 경로) 버튼 노출.

```ts
// src/web/lobby/lobby-ui.ts — 타이틀→로비→룸 최소 DOM UI.
import { LobbyClient } from '../../net/lobby-client'
import { LoopbackHub } from '../../net/loopback'
import { makeAgent8Transport, realProvider } from '../../net/transport'
import type { Transport } from '../../net/types'
import { GAMESTYLE_DEATHMATCH, GAMESTYLE_CTF, TEAM_ALPHA, TEAM_BRAVO, TEAM_SPECTATOR, TEAM_NONE } from '../../core/constants'

export interface StartMatchArg { lobby: LobbyClient; mode: number; myTeam: number }

// loopback=true면 배포 없이 단일 브라우저에서 목 릴레이 사용 (개발/데모).
export async function makeTransport(loopback: boolean): Promise<Transport> {
  if (loopback) return new LoopbackHub().createTransport('me-' + Math.floor(performance.now()))
  return makeAgent8Transport(await realProvider())
}

export function mountLobby(
  root: HTMLElement,
  opts: { onStartMatch: (a: StartMatchArg) => void; onOfflineBots: () => void },
): void {
  // 화면 3종(title/lobby/room)을 root.innerHTML 스왑 + 이벤트 위임으로 구현.
  // 상태: LobbyClient(연결 성공시) 또는 offline → onOfflineBots 버튼.
  // 팀버튼은 mode===GAMESTYLE_CTF일 때 Alpha/Bravo/Spectator, DM이면 팀선택 숨김(TEAM_NONE 고정).
  // 호스트에게만 Start 노출; 시작 시 onStartMatch({lobby, mode, myTeam}).
  // (구현: 아래 스텁을 실제 DOM으로 채운다 — 각 화면 render 함수 + lobby.onChange 리렌더)
  renderTitle(root, opts)
}

function renderTitle(root: HTMLElement, opts: Parameters<typeof mountLobby>[1]) {
  root.innerHTML = `
    <div class="scr" style="position:absolute;inset:0;display:flex;flex-direction:column;gap:12px;align-items:center;justify-content:center;color:#eee;font-family:monospace;background:#1a1a12">
      <h1>SOLDAT WEB</h1>
      <input id="nick" placeholder="nickname" value="Soldier" style="padding:6px;font-size:16px" maxlength="14"/>
      <div style="display:flex;gap:8px">
        <button id="quick">Quick Join (online)</button>
        <button id="create-dm">Create DM</button>
        <button id="create-ctf">Create CTF</button>
      </div>
      <button id="offline">Offline Bot Match</button>
      <p id="netmsg" style="opacity:.6;font-size:12px"></p>
    </div>`
  const nick = () => (root.querySelector('#nick') as HTMLInputElement).value || 'Soldier'
  root.querySelector('#offline')!.addEventListener('click', () => opts.onOfflineBots())
  const online = async (action: (lc: LobbyClient) => Promise<void>) => {
    ;(root.querySelector('#netmsg') as HTMLElement).textContent = 'connecting...'
    const transport = await makeTransport(false)
    const lc = new LobbyClient(transport, nick())
    const st = await lc.connect()
    if (st !== 'online') { (root.querySelector('#netmsg') as HTMLElement).textContent = 'offline (배포 필요) — Offline Bot Match를 쓰세요'; return }
    await action(lc)
    renderRoom(root, lc, opts)
  }
  root.querySelector('#quick')!.addEventListener('click', () => online((lc) => lc.joinRoom('')))
  root.querySelector('#create-dm')!.addEventListener('click', () => online((lc) => lc.createRoom('dm-' + Date.now(), GAMESTYLE_DEATHMATCH)))
  root.querySelector('#create-ctf')!.addEventListener('click', () => online((lc) => lc.createRoom('ctf-' + Date.now(), GAMESTYLE_CTF)))
}

function renderRoom(root: HTMLElement, lc: LobbyClient, opts: Parameters<typeof mountLobby>[1]) {
  const draw = () => {
    const isCtf = lc.roomState.mode === GAMESTYLE_CTF
    const players = lc.players
    const teamBtns = isCtf
      ? `<button data-team="${TEAM_ALPHA}">Alpha</button><button data-team="${TEAM_BRAVO}">Bravo</button><button data-team="${TEAM_SPECTATOR}">Spectator</button>`
      : ''
    root.innerHTML = `
      <div class="scr" style="position:absolute;inset:0;padding:20px;color:#eee;font-family:monospace;background:#1a1a12">
        <h2>Room — ${isCtf ? 'CTF' : 'Deathmatch'}</h2>
        <ul>${Object.entries(players).map(([acc, p]) =>
          `<li>${p.nick}${acc === lc.account ? ' (you)' : ''} — team ${p.team} ${p.ready ? '✓' : ''}</li>`).join('')}</ul>
        <div style="display:flex;gap:8px;margin:8px 0">${teamBtns}
          <button id="ready">Ready</button>
          ${lc.isHost ? '<button id="start">START</button>' : '<span>(waiting for host)</span>'}
        </div>
      </div>`
    root.querySelectorAll('[data-team]').forEach((b) =>
      b.addEventListener('click', () => lc.selectTeam(Number((b as HTMLElement).dataset.team))))
    root.querySelector('#ready')?.addEventListener('click', () => lc.setReady(true))
    root.querySelector('#start')?.addEventListener('click', async () => {
      await lc.start()
    })
  }
  lc.onChange(draw)
  lc.onStart(() => {
    const myTeam = lc.players[lc.account]?.team ?? TEAM_NONE
    opts.onStartMatch({ lobby: lc, mode: lc.roomState.mode, myTeam })
  })
  draw()
}
```

- [ ] **Step 2: main.ts 배선** — 현재 `boot()`를 `startBotMatch()`로 이름 바꾸고, 새 부트에서 `mountLobby(document.body, { onStartMatch: (a) => { /* B단계: startNetMatch(a) */ startBotMatch() }, onOfflineBots: () => startBotMatch() })`. A단계는 onStartMatch도 일단 봇전으로(네트 인게임은 B). `?nolobby=1`이면 기존 봇전 직행(개발 편의).
- [ ] **Step 3: 브라우저 검증** — `npm run dev`, `localhost:3024`: 타이틀 보임, Offline Bot Match 클릭 → 기존 봇전 시작. Quick Join(online) 클릭 → 미배포라 "offline" 메시지. `?nolobby=1` → 봇전 직행. 콘솔 에러 0. tsc clean, `npm test` 그린.
- [ ] **Step 4: Commit** — `git add src/web/lobby src/web/main.ts && git commit -m "feat(web): lobby UI (title/room/team select) + offline bot fallback"`

---

## Self-Review 결과

- **스펙 커버리지**: §3.2 transport/loopback/protocol/lobby-client ✔(T1-4,6), server.js ✔(T5), §5 로비플로우·팀선택·룸스키마 ✔(T6-7). B/C/D/E(host/client-session·전투·전용서버·폴백)는 별도 플랜(A 완료 후). host-session/client-session/peer-session/server/host.ts는 A 범위 밖 — 파일구조에 자리만.
- **플레이스홀더**: lobby-ui는 render 함수 실코드 포함(DOM 스왑). "B단계" 주석은 다음 플랜 경계 표시지 미완성 아님.
- **타입 일관성**: Transport 인터페이스(types.ts)를 loopback/transport 양쪽이 구현, LobbyClient가 소비 — 시그니처 일치 확인. RoomPlayer/RoomState/RoomListing/MSG 전 태스크 동일.
- **검증 수단**: loopback으로 T2/T6이 멀티세션을 헤드리스 검증(A의 핵심). T7만 브라우저 수동.
- **다음 플랜**: M3-B(host/client-session + 이동 동기화) — A 완료 후 작성.
