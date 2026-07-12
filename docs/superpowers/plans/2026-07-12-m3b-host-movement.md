# M3 Phase B: 호스트권위 이동 동기화 구현 계획

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement task-by-task. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Phase A(전송+로비)가 만든 `Transport`/`loopback`/`LobbyClient` 위에, 호스트권위 **이동** 동기화를 얹는다 — `protocol.ts`에 INPUT/SNAPSHOT 바이너리 (역)직렬화를 추가하고, `host-session.ts`(권위 시뮬 루프)와 `client-session.ts`(입력 송신 + 로컬시뮬 + 스냅샷 보정)를 신설한 뒤, `main.ts`에 로비 시작 → 네트 인게임 경로를 배선한다. 전투(탄환/데미지/킬/스코어)는 범위 밖(Phase C). 완료 기준: **loopback 위 1호스트+2클라 헤드리스 시나리오**에서 한쪽 이동이 다른 쪽 로컬 뷰에 수렴적으로 반영된다.

**Architecture:** 하나의 권위 세션(§3.1) 중 이동 부분만: `host-session`이 `updateFrame(gs)`를 60Hz(또는 스텝) 구동하며 입력을 주입하고 ~30Hz로 스냅샷을 브로드캐스트한다. `client-session`은 `Transport`에만 의존(agent8 구체 API 아님)하며, 자신의 로컬 `GameState`를 갖고 그 위에서 **자기 스프라이트는 로컬 입력으로**, **원격 스프라이트는 스냅샷에 실린 컨트롤 릴레이로** 매 틱 같은 `updateFrame`을 계속 굴린 뒤(§"설계 결정" 참조), 스냅샷 도착 시 위치/애니를 권위값 쪽으로 부드럽게 당긴다. `GostekPool`은 수정 없이 그대로 재사용 — 렌더는 `.active` 스프라이트를 다 그리므로 원격도 로컬 `gs.sprite[]`에 실존해야 한다(핵심 제약, 아래 참조). 코어(`src/core/*`)는 **무수정**.

**Tech Stack:** TypeScript, Vitest, 기존 `LoopbackHub`/`Transport`/`MSG`. 코어 함수(`createSprite`/`createTPlayer`/`randomizeStart`/`updateFrame`/`guns`)를 그대로 호출(수정 아님). DataView 기반 수동 바이너리 팩(외부 직렬화 라이브러리 없음).

**선행 사실 (읽은 것 요약):**
- 스펙 §3.2 컴포넌트 표, §4 데이터흐름(4.1 입력/4.2 스냅샷/4.4 로컬예측), §6 마일스톤 B행. §4.4: "원격 병사는 예측 없이 스냅샷 보간만" — 이 계획은 **의도적으로 이 문구를 벗어난다**(아래 "설계 결정 1" 참조), 이유와 대안을 명시한다.
- Phase A 산출물(모두 읽음, 무수정 재사용): `types.ts`(Transport/RoomState/RoomPlayer/MessageHandler), `protocol.ts`(MSG.INPUT/SNAPSHOT 문자열만 예약된 상태, 아직 (역)직렬화 없음 — 이번 태스크가 채운다), `loopback.ts`(LoopbackHub — `send()`는 발신자 제외 전원에게 브로드캐스트, `onMessage`/`onRoomState`는 **핸들러 1개만 유지**(재호출 시 덮어씀) — host-session/client-session은 각자 자기 Transport 인스턴스에서 한 번만 `onMessage`를 건다), `transport.ts`, `lobby-client.ts`(LobbyClient — `private transport` 필드라 그대로는 외부에서 못 꺼냄, T6에서 getter 추가).
- 코어: `createSprite(gs, sPos, sVelocity, sStyle, n, player, transferOwnership)` — **`n !== 255`면 그 슬롯번호를 그대로 사용**(빈 슬롯 탐색 안 함) → 호스트가 배정한 스프라이트 번호를 클라가 로컬에서 정확히 같은 슬롯에 재현할 수 있다(설계의 핵심 트릭). `addBotPlayer` 패턴(= `randomizeStart` → `createSprite(..., 255, ...)` → `respawn()`)을 인간 플레이어용으로 그대로 재사용. `TSprite.control: TControl`(left/right/up/down/fire/jetpack/throwNade/changeWeapon/throwWeapon/reload/prone/flagThrow/mouseAimX/mouseAimY/mouseDist — `mouseDist`는 코어가 내부에서만 쓰고 입력으로 안 옴, 프로토콜에서 생략해도 무방, `control.test.ts`/`sprites.ts:3441` 확인). `TSprite.direction`(±1), `.health`, `.jetsCount`, `.legsAnimation`/`.bodyAnimation`(`.id`/`.currFrame`, `anims.ts`: id 최대 43·currFrame 최대 `MAX_FRAMES_INDEX=40` → 둘 다 Uint8 안전), `.player!.team`, `.deadMeat`. `gs.spriteParts.pos[num]`/`.velocity[num]` — 위치/속도는 스프라이트 필드가 아니라 `gs.spriteParts`(파티클시스템)에 있다. `updateFrame(gs)`/`updateFrameN` — 순수 함수, `gs.sprite[]` 전체를 순회해 `.active`인 것만 갱신. `MAX_SPRITES=32`(sprites.ts). `randomizeStart(gs, team)`는 스폰포인트 0개 맵(`emptyMap:true`)에서도 안전(원점 (0,0) 반환, `ai.test.ts`가 이미 이 패턴 검증).
- `src/tests/helpers.ts`의 `setupTestGame({emptyMap?})` — 실제 애니메이션/스프라이트 오브젝트를 로드한 `GameState`를 만든다(맵만 옵션). 이번 계획의 헤드리스 테스트가 호스트/클라이언트별로 **각자의 GameState**를 이걸로 3개(호스트 1 + 클라 2) 만든다.
- `src/web/gostek.ts`의 `GostekPool.update(gs, me)` — `gs.sprite[1..MAX_SPRITES]`를 순회해 `.active`면 렌더, 없으면 렌더러 생성 지연. **원격 스프라이트도 렌더되려면 클라 로컬 `gs`에서 `.active=true`여야 한다** — 이게 "설계 결정 1"의 근거.
- `src/web/main.ts`의 `startBotMatch()` — 에셋 로드(`loadManifest/prefetchAnimFiles/loadMapFile/loadWaypoints`) → `GameState` 구성 → 무기 로드 → 플레이어 1명 스폰(`randomizeStart`+`createSprite`+수동 AK74 지급+`respawn`) → 봇 N기 스폰(`addBotPlayer`) → PIXI 씬 구성 → 60Hz 고정스텝 루프(`input.applyTo(spr.control,...)` 후 `updateFrame(gs)`) → `gostek.update(gs, me)` 렌더. `boot()`는 `mountLobby(...)`로 로비 경유, A단계 `onStartMatch`은 임시로 봇전 폴백 — 이번 태스크가 실제 네트 경로로 교체.

---

## 설계 결정 (스펙 §4.4 대비 편차 — 미리 밝힘)

**결정 1 — 원격 스프라이트도 "컨트롤 릴레이 + 공유 시뮬"로 굴린다 (순수 보간이 아님).**
스펙 §4.4는 "원격 병사는 예측 없이 보간만"이라 쓰지만, 실제 제약 두 가지가 이를 막는다:
1. **`GostekPool` 재사용 요건**(브리핑 요구사항) — 렌더는 `.active` 플래그로 게이트되는데, `.active`는 코어의 `updateFrame`이 물리/애니를 굴릴지 결정하는 바로 그 플래그다. 원격 스프라이트를 렌더하려면 `.active=true`여야 하고, 그러면 같은 `gs`에 `updateFrame`을 돌리는 한 원격도 물리 갱신을 피할 수 없다.
2. **코어 무수정 원칙** — `TSprite.update()`(스켈레톤 위치를 애니메이션 프레임에서 계산하는 유일한 코드)를 호출하지 않고 스켈레톤만 따로 재계산하려면 그 ~40줄 로직을 `client-session.ts`에 복제해야 한다(코어 수정은 아니지만 로직 이중화 + 드리프트 위험).

따라서 이 계획은 **스냅샷에 각 스프라이트의 최신 컨트롤(비트마스크+마우스에임)을 함께 실어**, 클라의 로컬 `gs`에서 원격 스프라이트도 "마지막으로 알려진 입력을 계속 재생"하며 `updateFrame`을 같이 돈다(진짜 서버-클라 간 물리 결정론은 기대하지 않음 — 부동소수 연산 순서차 등으로 미세 발산 가능). 스냅샷 도착 시 **위치는 오차 임계(8px) 초과분의 일부만 당기는 지수 스무딩**, **속도/체력/사망/애니id·프레임은 즉시 스냅**으로 보정한다 — 이게 스펙이 말하는 "1차는 스무딩(간단)"의 이 구현판이다. 자기 자신의 스프라이트도 동일한 보정 경로를 타므로(로컬입력이 매틱 덮어써서 사실상 무해) 코드 경로가 하나로 통일된다.
결과적으로 대역폭이 스펙 추정치(~200B/8인)보다 커진다 — 실측 § "대역폭" 참조. 정밀 rollback&replay와 순수 보간은 스펙대로 E단계 몫으로 남긴다(§9).

**결정 2 — "account-index" 필드를 스프라이트 번호로 접는다.**
브리핑은 SNAPSHOT에 "account-index" 필드를 요청했지만, 호스트가 플레이어 계정마다 스프라이트 번호(slot)를 배정하고(`createSprite(..., n=slot, ...)`), 클라는 자신의 계정에 배정된 번호만 `MSG.ASSIGN`(신규 메시지 종류, 1회성·저빈도라 JSON 그대로 보냄)으로 통지받으면 충분하다 — SNAPSHOT 자체는 `num`만으로 자기서술적이라 별도 계정 인덱스가 필요 없다. 바이트 절약 + 필드 하나 감소.

**결정 3 — 원격 스프라이트 로컬 생성은 최초 스냅샷에서 지연 생성.**
`MSG.ASSIGN`은 "이 번호가 내 것"만 알려준다. 실제 스프라이트 로컬 생성(스폰 위치 필요)은 그 번호가 처음 스냅샷에 나타날 때 `createSprite(gs, snapshotPos, ..., n=num, ...)` + `respawn()`으로 한다 — 자기 자신도 동일 경로(첫 스냅샷에서 생성)를 타므로 코드 중복이 없다. `ASSIGN`이 스냅샷보다 먼저 와도(레이스), 그 사이 틱은 `gs.sprite[myNum]`이 아직 비활성 더미라 로컬 입력을 그 `.control`에 써도 무해(코어가 비활성 스프라이트는 건너뜀) — 자연 치유.

---

## 파일 구조 (Phase B 산출물)

```
src/net/
  protocol.ts        ← (수정) INPUT/SNAPSHOT 바이너리 (역)직렬화 + MSG.ASSIGN 추가
  host-session.ts    ← (신규) 권위 시뮬 루프 — Transport + GameState만 의존, Node/브라우저 공통
  client-session.ts  ← (신규) 입력송신 + 공유시뮬 + 스냅샷 보정
  lobby-client.ts    ← (수정) transport 접근용 getter 1개 추가
src/web/
  main.ts            ← (수정) loadGameAssets 추출 + startNetMatch() 신설 + boot() 배선 교체
src/tests/
  protocol.test.ts       ← (수정) INPUT/SNAPSHOT 라운드트립 + 대역폭 테스트 추가
  host-session.test.ts   ← (신규) 호스트 단독 유닛 테스트(가짜 INPUT 바이트로 스프라이트 이동)
  client-session.test.ts ← (신규) 클라 단독 유닛 테스트(수제 SNAPSHOT으로 고스트 생성+보정 수렴)
  net-b-integration.test.ts ← (신규) **1호스트+2클라 loopback** — B의 핵심 검증
```

---

### Task 1: protocol.ts — INPUT 바이너리 (역)직렬화

**Files:** Modify `src/net/protocol.ts`, `src/tests/protocol.test.ts`

- [ ] **Step 1: 실패 테스트 추가**

```ts
// src/tests/protocol.test.ts — 기존 MSG/isMsg 테스트 아래에 추가
import { encodeInput, decodeInput, type InputMsg } from '../net/protocol'

describe('INPUT binary round-trip', () => {
  const sample: InputMsg = {
    seq: 123456,
    left: true, right: false, up: true, down: false,
    fire: false, jetpack: true, throwNade: false, changeWeapon: true,
    throwWeapon: false, reload: true, prone: false, flagThrow: true,
    mouseAimX: -1234, mouseAimY: 5678,
  }
  it('encodes to a compact fixed-size buffer and decodes to the same fields', () => {
    const buf = encodeInput(sample)
    expect(buf.byteLength).toBe(10) // 4(seq) + 2(bits) + 2(mouseX) + 2(mouseY)
    expect(decodeInput(buf)).toEqual(sample)
  })
  it('all-false/zero input round-trips', () => {
    const zero: InputMsg = { seq: 0, left: false, right: false, up: false, down: false,
      fire: false, jetpack: false, throwNade: false, changeWeapon: false,
      throwWeapon: false, reload: false, prone: false, flagThrow: false,
      mouseAimX: 0, mouseAimY: 0 }
    expect(decodeInput(encodeInput(zero))).toEqual(zero)
  })
  it('seq wraps safely at Uint32 boundary', () => {
    const s: InputMsg = { ...sample, seq: 0xffffffff }
    expect(decodeInput(encodeInput(s)).seq).toBe(0xffffffff)
  })
})
```

- [ ] **Step 2: FAIL 확인** — `npx vitest run src/tests/protocol.test.ts`
- [ ] **Step 3: 구현** — `src/net/protocol.ts`에 추가(기존 `MSG`/`isMsg` 아래):

```ts
// ── B단계: INPUT/SNAPSHOT 바이너리 (역)직렬화 ────────────────────────────────
// 비트마스크: TControl(sprites.ts)의 불리언 12개. mouseDist는 코어 내부 전용(입력으로 안 옴,
// sprites.ts:3441/control.ts:1102 참조)이라 프로토콜에서 생략.
export interface InputMsg {
  seq: number
  left: boolean; right: boolean; up: boolean; down: boolean
  fire: boolean; jetpack: boolean; throwNade: boolean; changeWeapon: boolean
  throwWeapon: boolean; reload: boolean; prone: boolean; flagThrow: boolean
  mouseAimX: number // SmallInt — Int16
  mouseAimY: number
}

type ControlFlags = Omit<InputMsg, 'seq' | 'mouseAimX' | 'mouseAimY'>

const BIT = {
  left: 1 << 0, right: 1 << 1, up: 1 << 2, down: 1 << 3,
  fire: 1 << 4, jetpack: 1 << 5, throwNade: 1 << 6, changeWeapon: 1 << 7,
  throwWeapon: 1 << 8, reload: 1 << 9, prone: 1 << 10, flagThrow: 1 << 11,
} as const

function packBits(c: ControlFlags): number {
  let bits = 0
  if (c.left) bits |= BIT.left
  if (c.right) bits |= BIT.right
  if (c.up) bits |= BIT.up
  if (c.down) bits |= BIT.down
  if (c.fire) bits |= BIT.fire
  if (c.jetpack) bits |= BIT.jetpack
  if (c.throwNade) bits |= BIT.throwNade
  if (c.changeWeapon) bits |= BIT.changeWeapon
  if (c.throwWeapon) bits |= BIT.throwWeapon
  if (c.reload) bits |= BIT.reload
  if (c.prone) bits |= BIT.prone
  if (c.flagThrow) bits |= BIT.flagThrow
  return bits
}

function unpackBits(bits: number): ControlFlags {
  return {
    left: !!(bits & BIT.left), right: !!(bits & BIT.right),
    up: !!(bits & BIT.up), down: !!(bits & BIT.down),
    fire: !!(bits & BIT.fire), jetpack: !!(bits & BIT.jetpack),
    throwNade: !!(bits & BIT.throwNade), changeWeapon: !!(bits & BIT.changeWeapon),
    throwWeapon: !!(bits & BIT.throwWeapon), reload: !!(bits & BIT.reload),
    prone: !!(bits & BIT.prone), flagThrow: !!(bits & BIT.flagThrow),
  }
}

const INPUT_BYTES = 10 // seq:4 + bits:2 + mouseX:2 + mouseY:2

export function encodeInput(m: InputMsg): ArrayBuffer {
  const buf = new ArrayBuffer(INPUT_BYTES)
  const dv = new DataView(buf)
  dv.setUint32(0, m.seq >>> 0, true)
  dv.setUint16(4, packBits(m), true)
  dv.setInt16(6, m.mouseAimX, true)
  dv.setInt16(8, m.mouseAimY, true)
  return buf
}

export function decodeInput(buf: ArrayBuffer): InputMsg {
  const dv = new DataView(buf)
  const seq = dv.getUint32(0, true)
  const bits = unpackBits(dv.getUint16(4, true))
  const mouseAimX = dv.getInt16(6, true)
  const mouseAimY = dv.getInt16(8, true)
  return { seq, ...bits, mouseAimX, mouseAimY }
}
```

- [ ] **Step 4: PASS + Commit** — `npx vitest run src/tests/protocol.test.ts` → 그린. `git add src/net/protocol.ts src/tests/protocol.test.ts && git commit -m "feat(net): binary INPUT encode/decode"`

---

### Task 2: protocol.ts — SNAPSHOT 바이너리 (역)직렬화 + MSG.ASSIGN

**Files:** Modify `src/net/protocol.ts`, `src/tests/protocol.test.ts`

- [ ] **Step 1: 실패 테스트 추가**

```ts
// src/tests/protocol.test.ts — 계속 추가 (파일 상단에 이미 있는 `import { MSG, isMsg } from '../net/protocol'`에
// encodeSnapshot/decodeSnapshot/타입만 이어 붙인다 — MSG/isMsg 재import 금지, 기존 라인에 합친다)
import { encodeSnapshot, decodeSnapshot, type SnapshotSprite, type SnapshotMsg } from '../net/protocol'

function sampleSprite(num: number): SnapshotSprite {
  return {
    num, team: 1, direction: -1, deadMeat: false,
    health: 137, jetsCount: 42,
    legsAnimId: 3, legsFrame: 7, bodyAnimId: 9, bodyFrame: 12,
    lastInputSeq: 555,
    posX: 1234.5, posY: -678.25, velX: 2.5, velY: -0.125,
    control: { left: true, right: false, up: false, down: true, fire: false, jetpack: true,
      throwNade: false, changeWeapon: false, throwWeapon: false, reload: false, prone: false,
      flagThrow: false, mouseAimX: 900, mouseAimY: -400 },
  }
}

describe('SNAPSHOT binary round-trip', () => {
  it('MSG.ASSIGN is registered', () => {
    expect(MSG.ASSIGN).toBe('assign')
    expect(isMsg(MSG.ASSIGN)).toBe(true)
  })
  it('round-trips an empty snapshot', () => {
    const msg: SnapshotMsg = { tick: 999, sprites: [] }
    expect(decodeSnapshot(encodeSnapshot(msg))).toEqual(msg)
  })
  it('round-trips N sprites (order preserved, floats within Float32 epsilon)', () => {
    const msg: SnapshotMsg = { tick: 42, sprites: [sampleSprite(1), sampleSprite(7), sampleSprite(32)] }
    const decoded = decodeSnapshot(encodeSnapshot(msg))
    expect(decoded.tick).toBe(42)
    expect(decoded.sprites.map((s) => s.num)).toEqual([1, 7, 32])
    expect(decoded.sprites[0].posX).toBeCloseTo(1234.5, 3)
    expect(decoded.sprites[0].control).toEqual(msg.sprites[0].control)
    expect(decoded.sprites[0].deadMeat).toBe(false)
  })
  it('8-sprite snapshot stays under 320 bytes (bandwidth bound)', () => {
    const msg: SnapshotMsg = { tick: 1, sprites: Array.from({ length: 8 }, (_, i) => sampleSprite(i + 1)) }
    const bytes = encodeSnapshot(msg).byteLength
    expect(bytes).toBeLessThanOrEqual(320)
    // 참고용 실측치: 헤더 5B + 8 × 35B/스프라이트 = 285B. 25~30Hz 브로드캐스트 시 ≈ 8.5KB/s
    // (스펙 §4.2의 ~5KB/s 추정치보다 큼 — "설계 결정 1"의 컨트롤 릴레이 필드 6B/스프라이트가 원인,
    // 문서화된 트레이드오프. 초과 시 관심영역/델타압축은 M4+ 몫, §9).
  })
})
```

- [ ] **Step 2: FAIL 확인**
- [ ] **Step 3: 구현** — `protocol.ts`의 `MSG` 객체에 한 줄 추가 + 아래 블록 추가:

```ts
// MSG 객체 수정 (기존 5개 유지, 1개 추가)
export const MSG = {
  INPUT: 'input',
  SNAPSHOT: 'snap',
  BULLET: 'bul',
  KILL: 'kill',
  START: 'start',
  ASSIGN: 'assign', // B단계 신규 — 호스트→해당 계정: {account, num} 배정된 스프라이트 번호 통지 (저빈도, JSON 그대로)
} as const
```

```ts
// protocol.ts 끝에 추가
export interface SnapshotSprite {
  num: number        // Uint8 (1..MAX_SPRITES=32)
  team: number       // Uint8 (TEAM_NONE..TEAM_SPECTATOR)
  direction: number  // Int8 (-1 | 1)
  deadMeat: boolean
  health: number     // Uint8, 0..255로 클램프(스폰 기본 150 — 콜러 책임)
  jetsCount: number  // Int16
  legsAnimId: number // Uint8 (anims.ts 최대 id 43)
  legsFrame: number  // Uint8 (MAX_FRAMES_INDEX=40)
  bodyAnimId: number // Uint8
  bodyFrame: number  // Uint8
  lastInputSeq: number // Uint16 — 호스트가 이 스프라이트에 마지막으로 적용한 입력 seq (0=아직없음/봇)
  posX: number; posY: number // Float32
  velX: number; velY: number // Float32
  control: ControlFlags & { mouseAimX: number; mouseAimY: number } // 컨트롤 릴레이 (설계 결정 1)
}

export interface SnapshotMsg { tick: number; sprites: SnapshotSprite[] }

// 헤더(5B: tick Uint32 + count Uint8) + 스프라이트당 35B:
// num1+team1+direction1+deadMeat1+health1+jetsCount2+legsAnimId1+legsFrame1+bodyAnimId1+
// bodyFrame1+lastInputSeq2+posX4+posY4+velX4+velY4+controlBits2+mouseAimX2+mouseAimY2 = 35
const SNAP_HEADER_BYTES = 5
const SNAP_SPRITE_BYTES = 35

export function encodeSnapshot(msg: SnapshotMsg): ArrayBuffer {
  const buf = new ArrayBuffer(SNAP_HEADER_BYTES + msg.sprites.length * SNAP_SPRITE_BYTES)
  const dv = new DataView(buf)
  dv.setUint32(0, msg.tick >>> 0, true)
  dv.setUint8(4, msg.sprites.length)
  let o = SNAP_HEADER_BYTES
  for (const s of msg.sprites) {
    dv.setUint8(o, s.num); o += 1
    dv.setUint8(o, s.team); o += 1
    dv.setInt8(o, s.direction); o += 1
    dv.setUint8(o, s.deadMeat ? 1 : 0); o += 1
    dv.setUint8(o, Math.max(0, Math.min(255, Math.round(s.health)))); o += 1
    dv.setInt16(o, s.jetsCount, true); o += 2
    dv.setUint8(o, s.legsAnimId); o += 1
    dv.setUint8(o, s.legsFrame); o += 1
    dv.setUint8(o, s.bodyAnimId); o += 1
    dv.setUint8(o, s.bodyFrame); o += 1
    dv.setUint16(o, s.lastInputSeq, true); o += 2
    dv.setFloat32(o, s.posX, true); o += 4
    dv.setFloat32(o, s.posY, true); o += 4
    dv.setFloat32(o, s.velX, true); o += 4
    dv.setFloat32(o, s.velY, true); o += 4
    dv.setUint16(o, packBits(s.control), true); o += 2
    dv.setInt16(o, s.control.mouseAimX, true); o += 2
    dv.setInt16(o, s.control.mouseAimY, true); o += 2
  }
  return buf
}

export function decodeSnapshot(buf: ArrayBuffer): SnapshotMsg {
  const dv = new DataView(buf)
  const tick = dv.getUint32(0, true)
  const count = dv.getUint8(4)
  const sprites: SnapshotSprite[] = []
  let o = SNAP_HEADER_BYTES
  for (let k = 0; k < count; k++) {
    const num = dv.getUint8(o); o += 1
    const team = dv.getUint8(o); o += 1
    const direction = dv.getInt8(o); o += 1
    const deadMeat = dv.getUint8(o) !== 0; o += 1
    const health = dv.getUint8(o); o += 1
    const jetsCount = dv.getInt16(o, true); o += 2
    const legsAnimId = dv.getUint8(o); o += 1
    const legsFrame = dv.getUint8(o); o += 1
    const bodyAnimId = dv.getUint8(o); o += 1
    const bodyFrame = dv.getUint8(o); o += 1
    const lastInputSeq = dv.getUint16(o, true); o += 2
    const posX = dv.getFloat32(o, true); o += 4
    const posY = dv.getFloat32(o, true); o += 4
    const velX = dv.getFloat32(o, true); o += 4
    const velY = dv.getFloat32(o, true); o += 4
    const bits = unpackBits(dv.getUint16(o, true)); o += 2
    const mouseAimX = dv.getInt16(o, true); o += 2
    const mouseAimY = dv.getInt16(o, true); o += 2
    sprites.push({ num, team, direction, deadMeat, health, jetsCount, legsAnimId, legsFrame,
      bodyAnimId, bodyFrame, lastInputSeq, posX, posY, velX, velY,
      control: { ...bits, mouseAimX, mouseAimY } })
  }
  return { tick, sprites }
}
```

- [ ] **Step 4: PASS + Commit** — `npx vitest run src/tests/protocol.test.ts` 그린. `git add src/net/protocol.ts src/tests/protocol.test.ts && git commit -m "feat(net): binary SNAPSHOT encode/decode + MSG.ASSIGN"`

---

### Task 3: net/host-session.ts — 권위 시뮬 루프

**Files:** Create `src/net/host-session.ts`, `src/tests/host-session.test.ts`

호스트 전용. `Transport` + 이미 로드된(에셋/맵) `GameState`를 받아, 플레이어 스폰 + 입력 적용 + `updateFrame` + 스냅샷 브로드캐스트를 담당한다. Node/브라우저 공통(PIXI 의존 0).

- [ ] **Step 1: 실패 테스트**

```ts
// src/tests/host-session.test.ts
import { describe, it, expect } from 'vitest'
import { LoopbackHub } from '../net/loopback'
import { HostSession } from '../net/host-session'
import { encodeInput, decodeSnapshot, MSG } from '../net/protocol'
import { setupTestGame } from './helpers'
import { TEAM_NONE } from '../core/constants'

function neutralInput(seq: number, overrides: Partial<Parameters<typeof encodeInput>[0]> = {}) {
  return encodeInput({ seq, left: false, right: false, up: false, down: false, fire: false,
    jetpack: false, throwNade: false, changeWeapon: false, throwWeapon: false, reload: false,
    prone: false, flagThrow: false, mouseAimX: 0, mouseAimY: 0, ...overrides })
}

describe('HostSession', () => {
  it('spawnPlayers assigns sprite slots and notifies via MSG.ASSIGN', async () => {
    const hub = new LoopbackHub()
    const hostT = hub.createTransport('host')
    const aliceT = hub.createTransport('alice')
    await hostT.connect(); await aliceT.connect()
    await hostT.joinRoom('r'); await aliceT.joinRoom('r')

    const gs = setupTestGame({ emptyMap: true })
    const host = new HostSession(hostT, gs)

    const assigns: { account: string; num: number }[] = []
    aliceT.onMessage((event, payload) => { if (event === MSG.ASSIGN) assigns.push(payload as any) })

    host.spawnPlayers([{ account: 'alice', team: TEAM_NONE }])
    await Promise.resolve()

    expect(assigns).toHaveLength(1)
    expect(assigns[0].account).toBe('alice')
    const num = host.spriteNumOf('alice')!
    expect(num).toBe(assigns[0].num)
    expect(gs.sprite[num].active).toBe(true)
    expect(gs.sprite[num].deadMeat).toBe(false) // respawn() 완료 상태
  })

  it('applies received INPUT to the right sprite before ticking, and tracks lastAppliedSeq', () => {
    const hub = new LoopbackHub()
    const hostT = hub.createTransport('host')
    const aliceT = hub.createTransport('alice')
    hostT.connect(); aliceT.connect()
    hostT.joinRoom('r'); aliceT.joinRoom('r')

    const gs = setupTestGame({ emptyMap: true })
    const host = new HostSession(hostT, gs)
    host.spawnPlayers([{ account: 'alice', team: TEAM_NONE }])
    const num = host.spriteNumOf('alice')!
    const startX = gs.spriteParts.pos[num].x

    aliceT.send(MSG.INPUT, neutralInput(1, { right: true, mouseAimX: 500 }))
    for (let i = 0; i < 60; i++) host.tick() // 1초

    expect(gs.spriteParts.pos[num].x).toBeGreaterThan(startX)
    expect(Number.isNaN(gs.spriteParts.pos[num].x)).toBe(false)
  })

  it('broadcasts a decodable SNAPSHOT roughly every 2 ticks (~30Hz of 60Hz)', () => {
    const hub = new LoopbackHub()
    const hostT = hub.createTransport('host')
    const bobT = hub.createTransport('bob')
    hostT.connect(); bobT.connect()
    hostT.joinRoom('r'); bobT.joinRoom('r')

    const gs = setupTestGame({ emptyMap: true })
    const host = new HostSession(hostT, gs)
    host.spawnPlayers([{ account: 'bob', team: TEAM_NONE }])

    const snaps: ReturnType<typeof decodeSnapshot>[] = []
    bobT.onMessage((event, payload) => { if (event === MSG.SNAPSHOT) snaps.push(decodeSnapshot(payload as ArrayBuffer)) })

    for (let i = 0; i < 10; i++) host.tick()
    expect(snaps.length).toBe(5) // 10틱 / 2
    expect(snaps[0].sprites.some((s) => s.num === host.spriteNumOf('bob'))).toBe(true)
  })
})
```

- [ ] **Step 2: FAIL 확인** — `npx vitest run src/tests/host-session.test.ts`
- [ ] **Step 3: 구현**

```ts
// src/net/host-session.ts — 호스트권위 이동 시뮬 루프. Transport 인터페이스에만 의존
// (agent8 구체 API 아님) → loopback으로 완전 테스트 가능. 코어(src/core/*) 무수정,
// 이미 로드된 GameState(맵/애니/무기 세팅 완료)를 받아 그 위에서만 동작한다.
// Node 헤드리스(server/host.ts, D단계)와 브라우저-호스트(main.ts, 이번 단계) 양쪽에서 재사용.
import type { GameState } from '../core/state'
import type { Transport } from './types'
import { MSG, encodeSnapshot, decodeInput, type InputMsg, type SnapshotSprite } from './protocol'
import { createSprite, createTPlayer, HUMAN } from '../core/sprites'
import { randomizeStart } from '../core/things'
import { guns, AK74 } from '../core/weapons'
import { updateFrame } from '../core/game'
import { vector2 } from '../core/vector'

export interface HostSessionPlayer { account: string; team: number }

// 60Hz 틱 중 2틱마다 브로드캐스트 ⇒ 30Hz (스펙 §4.2 "~20-30Hz" 범위 내).
const SNAPSHOT_EVERY_N_TICKS = 2

export class HostSession {
  private slotOf = new Map<string, number>() // account → 스프라이트 num
  private lastInput = new Map<string, InputMsg>() // account → 최신 수신 입력(누적 아님, 최신값만)
  private lastAppliedSeq = new Map<number, number>() // sprite num → 마지막 적용 seq
  private tickCount = 0

  constructor(private transport: Transport, public readonly gs: GameState) {
    transport.onMessage((event, _payload, from) => {
      if (event !== MSG.INPUT) return
      this.lastInput.set(from, decodeInput(_payload as ArrayBuffer))
    })
  }

  // 매치 시작 시 1회 — 룸의 전 플레이어에게 스프라이트 배정(슬롯 번호는 createSprite가 빈 슬롯
  // 중 하나를 고르므로 호출 순서가 배정 순서). addBotPlayer 패턴(randomizeStart→createSprite→
  // 무기지급→respawn) 재사용, controlMethod만 BOT 대신 HUMAN.
  spawnPlayers(players: HostSessionPlayer[]): void {
    for (const p of players) {
      const tPlayer = createTPlayer()
      tPlayer.team = p.team
      tPlayer.controlMethod = HUMAN
      const r = randomizeStart(this.gs, p.team)
      const num = createSprite(this.gs, r.start, vector2(0, 0), 1, 255, tPlayer, true)
      if (num < 0) continue // 서버 만원(MAX_SPRITES) — 호출자가 CAP=8로 사전 제한(server.js와 동일 규약)
      this.gs.sprite[num].selWeapon = guns[AK74].num
      this.gs.sprite[num].player!.secWep = 0
      this.gs.sprite[num].respawn()
      this.slotOf.set(p.account, num)
      this.transport.send(MSG.ASSIGN, { account: p.account, num })
    }
    this.gs.sortPlayers?.()
  }

  spriteNumOf(account: string): number | undefined {
    return this.slotOf.get(account)
  }

  // 한 틱 전진: 최신 입력 적용 → updateFrame → (2틱마다) 스냅샷 브로드캐스트.
  // 순수 스텝 함수 — 헤드리스 테스트는 이걸 직접 반복 호출(결정론적), 실 구동(Node
  // setInterval/브라우저 rAF)은 startLoop()가 감싼다.
  //
  // 주의(브라우저-호스트 모드): 호스트 자신의 계정은 스스로에게 네트워크 메시지를 보내지 않으므로
  // lastInput에 절대 나타나지 않는다 — 즉 호스트 자신의 스프라이트 control은 이 메서드가 절대
  // 건드리지 않는다. main.ts의 렌더 루프가 tick() 호출 "직전"에 로컬 입력을 그 스프라이트의
  // control에 직접 써넣으면 된다(별도 분기 불필요, §웹 배선 참조).
  tick(): void {
    for (const [account, input] of this.lastInput) {
      const num = this.slotOf.get(account)
      if (num === undefined) continue
      const c = this.gs.sprite[num].control
      c.left = input.left; c.right = input.right; c.up = input.up; c.down = input.down
      c.fire = input.fire; c.jetpack = input.jetpack; c.throwNade = input.throwNade
      c.changeWeapon = input.changeWeapon; c.throwWeapon = input.throwWeapon
      c.reload = input.reload; c.prone = input.prone; c.flagThrow = input.flagThrow
      c.mouseAimX = input.mouseAimX; c.mouseAimY = input.mouseAimY
      this.lastAppliedSeq.set(num, input.seq)
    }
    updateFrame(this.gs)
    this.tickCount++
    if (this.tickCount % SNAPSHOT_EVERY_N_TICKS === 0) this.broadcastSnapshot()
  }

  private broadcastSnapshot(): void {
    const sprites: SnapshotSprite[] = []
    for (const num of this.slotOf.values()) {
      const spr = this.gs.sprite[num]
      if (!spr.active) continue
      sprites.push({
        num,
        team: spr.player!.team,
        direction: spr.direction,
        deadMeat: spr.deadMeat,
        health: spr.health,
        jetsCount: spr.jetsCount,
        legsAnimId: spr.legsAnimation.id,
        legsFrame: spr.legsAnimation.currFrame,
        bodyAnimId: spr.bodyAnimation.id,
        bodyFrame: spr.bodyAnimation.currFrame,
        lastInputSeq: this.lastAppliedSeq.get(num) ?? 0,
        posX: this.gs.spriteParts.pos[num].x,
        posY: this.gs.spriteParts.pos[num].y,
        velX: this.gs.spriteParts.velocity[num].x,
        velY: this.gs.spriteParts.velocity[num].y,
        control: {
          left: spr.control.left, right: spr.control.right, up: spr.control.up, down: spr.control.down,
          fire: spr.control.fire, jetpack: spr.control.jetpack, throwNade: spr.control.throwNade,
          changeWeapon: spr.control.changeWeapon, throwWeapon: spr.control.throwWeapon,
          reload: spr.control.reload, prone: spr.control.prone, flagThrow: spr.control.flagThrow,
          mouseAimX: spr.control.mouseAimX, mouseAimY: spr.control.mouseAimY,
        },
      })
    }
    this.transport.send(MSG.SNAPSHOT, encodeSnapshot({ tick: this.gs.ticks, sprites }))
  }

  // 실 구동용 — 테스트는 tick()을 직접 반복 호출하므로 미사용. 반환값은 정지 함수.
  startLoop(intervalMs = 1000 / 60): () => void {
    const h = setInterval(() => this.tick(), intervalMs)
    return () => clearInterval(h)
  }
}
```

- [ ] **Step 4: PASS + tsc + Commit** — `npx vitest run src/tests/host-session.test.ts` 그린. `npx tsc --noEmit` 클린. `git add src/net/host-session.ts src/tests/host-session.test.ts && git commit -m "feat(net): host-authoritative movement session"`

---

### Task 4: net/client-session.ts — 입력송신 + 공유시뮬 + 스냅샷 보정

**Files:** Create `src/net/client-session.ts`, `src/tests/client-session.test.ts`

- [ ] **Step 1: 실패 테스트** (호스트 없이, 손으로 만든 SNAPSHOT 페이로드로 클라 단독 검증)

```ts
// src/tests/client-session.test.ts
import { describe, it, expect } from 'vitest'
import { LoopbackHub } from '../net/loopback'
import { ClientSession } from '../net/client-session'
import { encodeSnapshot, MSG, type SnapshotSprite } from '../net/protocol'
import { setupTestGame } from './helpers'

function neutralControl(overrides: Partial<SnapshotSprite['control']> = {}) {
  return { left: false, right: false, up: false, down: false, fire: false, jetpack: false,
    throwNade: false, changeWeapon: false, throwWeapon: false, reload: false, prone: false,
    flagThrow: false, mouseAimX: 0, mouseAimY: 0, ...overrides }
}

describe('ClientSession', () => {
  it('creates a local ghost sprite on first snapshot sighting, at the exact host-assigned slot', () => {
    const hub = new LoopbackHub()
    const t = hub.createTransport('bob')
    t.connect(); t.joinRoom('r')
    const gs = setupTestGame({ emptyMap: true })
    const client = new ClientSession(t, gs, 'bob', () => neutralControl())

    expect(gs.sprite[5].active).toBe(false)
    t.onMessage(() => {}) // no-op — ClientSession already registered its own handler in ctor
    // 다른 트랜스포트에서 스냅샷을 보내 bob에게 전달
    const senderHub = hub // 같은 허브, 다른 계정으로 보냄
    const senderT = senderHub.createTransport('host')
    senderT.connect(); senderT.joinRoom('r')
    senderT.send(MSG.SNAPSHOT, encodeSnapshot({ tick: 1, sprites: [{
      num: 5, team: 0, direction: 1, deadMeat: false, health: 150, jetsCount: 0,
      legsAnimId: 1, legsFrame: 1, bodyAnimId: 1, bodyFrame: 1, lastInputSeq: 0,
      posX: 100, posY: 200, velX: 0, velY: 0, control: neutralControl(),
    }] }))
    expect(gs.sprite[5].active).toBe(true)
    expect(gs.spriteParts.pos[5].x).toBeCloseTo(100, 0)
  })

  it("own sprite moves from local input; ASSIGN routes control writes to the right slot", () => {
    const hub = new LoopbackHub()
    const t = hub.createTransport('alice')
    t.connect(); t.joinRoom('r')
    const gs = setupTestGame({ emptyMap: true })
    let input = neutralControl({ right: true, mouseAimX: 500 })
    const client = new ClientSession(t, gs, 'alice', () => input)

    const hostT = hub.createTransport('host')
    hostT.connect(); hostT.joinRoom('r')
    hostT.send(MSG.ASSIGN, { account: 'alice', num: 3 })
    hostT.send(MSG.SNAPSHOT, encodeSnapshot({ tick: 1, sprites: [{
      num: 3, team: 0, direction: 1, deadMeat: false, health: 150, jetsCount: 0,
      legsAnimId: 1, legsFrame: 1, bodyAnimId: 1, bodyFrame: 1, lastInputSeq: 0,
      posX: 0, posY: 0, velX: 0, velY: 0, control: neutralControl(),
    }] }))

    expect(client.myNum).toBe(3)
    const startX = gs.spriteParts.pos[3].x
    for (let i = 0; i < 60; i++) client.tick()
    expect(gs.spriteParts.pos[3].x).toBeGreaterThan(startX)
  })

  it('position correction pulls a diverged sprite toward the snapshot over successive corrections', () => {
    const hub = new LoopbackHub()
    const t = hub.createTransport('bob')
    t.connect(); t.joinRoom('r')
    const gs = setupTestGame({ emptyMap: true })
    const client = new ClientSession(t, gs, 'bob', () => neutralControl())
    const hostT = hub.createTransport('host')
    hostT.connect(); hostT.joinRoom('r')

    const snap = (posX: number) => encodeSnapshot({ tick: 1, sprites: [{
      num: 4, team: 0, direction: 1, deadMeat: false, health: 150, jetsCount: 0,
      legsAnimId: 1, legsFrame: 1, bodyAnimId: 1, bodyFrame: 1, lastInputSeq: 0,
      posX, posY: 0, velX: 0, velY: 0, control: neutralControl(),
    }] })

    hostT.send(MSG.SNAPSHOT, snap(0)) // 최초 생성 — pos=0
    const errors: number[] = []
    for (let i = 0; i < 5; i++) {
      hostT.send(MSG.SNAPSHOT, snap(100)) // 호스트는 계속 x=100이라 보고(자기는 안 움직임 가정)
      errors.push(Math.abs(gs.spriteParts.pos[4].x - 100))
    }
    // 오차가 단조 감소하며 수렴 (지수 스무딩 — 튐 없음)
    for (let i = 1; i < errors.length; i++) expect(errors[i]).toBeLessThanOrEqual(errors[i - 1])
    expect(errors[errors.length - 1]).toBeLessThan(errors[0])
  })
})
```

- [ ] **Step 2: FAIL 확인** — `npx vitest run src/tests/client-session.test.ts`
- [ ] **Step 3: 구현**

```ts
// src/net/client-session.ts — 클라: 입력 송신 + (자기/원격 공통) 로컬 시뮬레이션 + 스냅샷 보정.
// Transport 인터페이스에만 의존, PIXI 무관. 원격 스프라이트도 GostekPool이 렌더하려면 로컬
// gs에서 .active=true여야 하므로(host-session.ts 헤더의 "설계 결정 1" 참조), 원격도 매 틱
// updateFrame과 함께 굴리되 그 control은 최신 스냅샷의 릴레이 필드로 채운다("마지막 입력 재생").
// 자기 스프라이트는 매 틱 로컬 입력이 control을 덮어쓰므로 릴레이 값은 자동 무시된다.
import type { GameState } from '../core/state'
import type { Transport } from './types'
import {
  MSG, encodeInput, decodeSnapshot,
  type InputMsg, type SnapshotMsg, type SnapshotSprite,
} from './protocol'
import { createSprite, createTPlayer, HUMAN } from '../core/sprites'
import { updateFrame } from '../core/game'
import { vector2 } from '../core/vector'

const POS_CORRECTION_THRESHOLD = 8 // px — 스펙 §4.4 예시 임계
const POS_CORRECTION_ALPHA = 0.25 // 스냅샷마다 잔여오차의 25%씩 당김(지수 스무딩, 안 튐)
const INPUT_SEND_EVERY_N_TICKS = 2 // 60Hz 중 2틱마다 송신 ⇒ 30Hz

// 로컬 입력 소스가 매 틱 돌려주는 값(웹에서는 InputState.applyTo 결과, 테스트에서는 손으로 준비).
export type LocalInput = Omit<InputMsg, 'seq'>

export class ClientSession {
  myNum: number | null = null
  private seq = 0
  private tickCount = 0
  private known = new Set<number>() // 이미 로컬 createSprite()한 num들
  private myAccount: string

  constructor(
    private transport: Transport,
    public readonly gs: GameState,
    myAccount: string,
    private getLocalInput: () => LocalInput,
  ) {
    this.myAccount = myAccount
    transport.onMessage((event, payload) => {
      if (event === MSG.ASSIGN) {
        const a = payload as { account: string; num: number }
        if (a.account === this.myAccount) this.myNum = a.num
      } else if (event === MSG.SNAPSHOT) {
        this.applySnapshot(decodeSnapshot(payload as ArrayBuffer))
      }
    })
  }

  // 매 60Hz 프레임: 내 입력을 내 스프라이트 control에 적용 → (스로틀) 호스트로 송신 →
  // 로컬 gs 전체를 한 틱 전진(자기=신선한 로컬입력, 원격=최근 릴레이 유지).
  tick(): void {
    if (this.myNum !== null && this.gs.sprite[this.myNum].active) {
      const input = this.getLocalInput()
      const c = this.gs.sprite[this.myNum].control
      c.left = input.left; c.right = input.right; c.up = input.up; c.down = input.down
      c.fire = input.fire; c.jetpack = input.jetpack; c.throwNade = input.throwNade
      c.changeWeapon = input.changeWeapon; c.throwWeapon = input.throwWeapon
      c.reload = input.reload; c.prone = input.prone; c.flagThrow = input.flagThrow
      c.mouseAimX = input.mouseAimX; c.mouseAimY = input.mouseAimY
      this.tickCount++
      if (this.tickCount % INPUT_SEND_EVERY_N_TICKS === 0) {
        this.transport.send(MSG.INPUT, encodeInput({ seq: this.seq++, ...input }))
      }
    }
    updateFrame(this.gs)
  }

  private ensureLocalSprite(num: number, team: number, pos: { x: number; y: number }): void {
    if (this.known.has(num)) return
    this.known.add(num)
    const tPlayer = createTPlayer()
    tPlayer.team = team
    tPlayer.controlMethod = HUMAN
    // n=num 지정 — createSprite는 n!==255면 그 슬롯을 그대로 쓴다(sprites.ts:3912-3925) →
    // 호스트가 배정한 것과 정확히 같은 슬롯에 재현.
    createSprite(this.gs, vector2(pos.x, pos.y), vector2(0, 0), 1, num, tPlayer, true)
    this.gs.sprite[num].respawn()
  }

  private applySnapshot(msg: SnapshotMsg): void {
    for (const s of msg.sprites) {
      this.ensureLocalSprite(s.num, s.team, { x: s.posX, y: s.posY })
      const spr = this.gs.sprite[s.num]

      // 이산값(자주 안 바뀜) — 즉시 스냅.
      spr.player!.team = s.team
      spr.deadMeat = s.deadMeat
      spr.health = s.health
      spr.jetsCount = s.jetsCount
      spr.legsAnimation.id = s.legsAnimId
      spr.legsAnimation.currFrame = s.legsFrame
      spr.bodyAnimation.id = s.bodyAnimId
      spr.bodyAnimation.currFrame = s.bodyFrame

      // 컨트롤 릴레이 — 원격 스프라이트의 다음 몇 틱을 "재생"하는 소스. 자기 자신 항목도
      // 함께 오지만 tick()이 매번 로컬입력으로 즉시 덮어쓰므로 무해.
      if (s.num !== this.myNum) {
        const c = spr.control
        c.left = s.control.left; c.right = s.control.right; c.up = s.control.up; c.down = s.control.down
        c.fire = s.control.fire; c.jetpack = s.control.jetpack; c.throwNade = s.control.throwNade
        c.changeWeapon = s.control.changeWeapon; c.throwWeapon = s.control.throwWeapon
        c.reload = s.control.reload; c.prone = s.control.prone; c.flagThrow = s.control.flagThrow
        c.mouseAimX = s.control.mouseAimX; c.mouseAimY = s.control.mouseAimY
      }

      // 연속값(위치) — 임계 초과분의 일부만 당김(튐 방지). 속도는 호스트가 유일 권위 소스라 즉시 스냅.
      const pos = this.gs.spriteParts.pos[s.num]
      const ex = s.posX - pos.x
      const ey = s.posY - pos.y
      if (Math.hypot(ex, ey) > POS_CORRECTION_THRESHOLD) {
        pos.x += ex * POS_CORRECTION_ALPHA
        pos.y += ey * POS_CORRECTION_ALPHA
      }
      const vel = this.gs.spriteParts.velocity[s.num]
      vel.x = s.velX
      vel.y = s.velY
    }
  }
}
```

- [ ] **Step 4: PASS + tsc + Commit** — `npx vitest run src/tests/client-session.test.ts` 그린. `npx tsc --noEmit` 클린. `git add src/net/client-session.ts src/tests/client-session.test.ts && git commit -m "feat(net): client session (input send + shared sim + snapshot correction)"`

---

### Task 5: net-b-integration.test.ts — 1호스트+2클라 loopback (B의 핵심 검증)

**Files:** Create `src/tests/net-b-integration.test.ts`

스펙 §7 "이게 M3의 주 검증 수단" — 브리핑이 요구한 정확한 시나리오: 클라 A의 입력을 조작 → 호스트를 스텝 → 클라 B의 로컬 뷰에서 A가 이동했음을 확인.

- [ ] **Step 1: 테스트 작성 (그대로 최종 구현)**

```ts
// src/tests/net-b-integration.test.ts
import { describe, it, expect } from 'vitest'
import { LoopbackHub } from '../net/loopback'
import { HostSession } from '../net/host-session'
import { ClientSession, type LocalInput } from '../net/client-session'
import { encodeSnapshot } from '../net/protocol'
import { setupTestGame } from './helpers'
import { TEAM_NONE } from '../core/constants'

function neutral(overrides: Partial<LocalInput> = {}): LocalInput {
  return { left: false, right: false, up: false, down: false, fire: false, jetpack: false,
    throwNade: false, changeWeapon: false, throwWeapon: false, reload: false, prone: false,
    flagThrow: false, mouseAimX: 0, mouseAimY: 0, ...overrides }
}

describe('M3-B integration: host-authoritative movement over one LoopbackHub', () => {
  it("client A's rightward movement converges into client B's local view, no NaN, no combat", async () => {
    const hub = new LoopbackHub()
    const hostT = hub.createTransport('host')
    const aT = hub.createTransport('alice')
    const bT = hub.createTransport('bob')
    await Promise.all([hostT.connect(), aT.connect(), bT.connect()])
    await Promise.all([hostT.joinRoom('m3b'), aT.joinRoom('m3b'), bT.joinRoom('m3b')])

    const hostGs = setupTestGame({ emptyMap: true })
    const host = new HostSession(hostT, hostGs)
    host.spawnPlayers([
      { account: 'alice', team: TEAM_NONE },
      { account: 'bob', team: TEAM_NONE },
    ])
    const aliceNum = host.spriteNumOf('alice')!
    const bobNum = host.spriteNumOf('bob')!
    const startX = hostGs.spriteParts.pos[aliceNum].x

    let aliceInput: LocalInput = neutral({ right: true, mouseAimX: startX + 500 })
    const aGs = setupTestGame({ emptyMap: true })
    const aClient = new ClientSession(aT, aGs, 'alice', () => aliceInput)

    const bobInput: LocalInput = neutral({ mouseAimX: 0 })
    const bGs = setupTestGame({ emptyMap: true })
    const bClient = new ClientSession(bT, bGs, 'bob', () => bobInput)

    // 180틱(3초 @60Hz) — 매 틱 클라 먼저(직전 스냅샷 소비) → 호스트
    for (let i = 0; i < 180; i++) {
      aClient.tick()
      bClient.tick()
      host.tick()
    }

    const hostAliceX = hostGs.spriteParts.pos[aliceNum].x
    expect(hostAliceX).toBeGreaterThan(startX) // 호스트에서 실제 이동

    // bob(원격 관찰자)의 로컬 뷰에도 alice의 스프라이트가 존재하고, 호스트 위치에 수렴.
    expect(bGs.sprite[aliceNum].active).toBe(true)
    const bobsViewOfAliceX = bGs.spriteParts.pos[aliceNum].x
    expect(Number.isNaN(bobsViewOfAliceX)).toBe(false)
    expect(bobsViewOfAliceX).toBeGreaterThan(startX) // bob의 화면에서도 alice가 오른쪽으로 감
    expect(Math.abs(bobsViewOfAliceX - hostAliceX)).toBeLessThan(40) // 오차 임계 내 수렴

    // alice 자신의 클라에서도 자기 스프라이트가 호스트와 정합적으로 수렴 (로컬예측+보정).
    const aliceOwnX = aGs.spriteParts.pos[aliceNum].x
    expect(Math.abs(aliceOwnX - hostAliceX)).toBeLessThan(40)

    // 부수 확인: bob 쪽에서 자기 자신(bob)도 정상 렌더 대상(활성)이고 NaN 없음.
    expect(bGs.sprite[bobNum].active).toBe(true)
    expect(Number.isNaN(bGs.spriteParts.pos[bobNum].x)).toBe(false)
  })

  it('measured snapshot bandwidth for 8 sprites at 30Hz stays in a sane order of magnitude', () => {
    const control = { left: false, right: true, up: false, down: false, fire: false, jetpack: false,
      throwNade: false, changeWeapon: false, throwWeapon: false, reload: false, prone: false,
      flagThrow: false, mouseAimX: 500, mouseAimY: 0 }
    const bytes = encodeSnapshot({
      tick: 1,
      sprites: Array.from({ length: 8 }, (_, i) => ({
        num: i + 1, team: 0, direction: 1, deadMeat: false, health: 150, jetsCount: 30,
        legsAnimId: 2, legsFrame: 5, bodyAnimId: 1, bodyFrame: 1, lastInputSeq: 100,
        posX: 500.5, posY: 300.25, velX: 3, velY: 0, control,
      })),
    }).byteLength
    expect(bytes).toBeLessThanOrEqual(320)
    const bytesPerSecAt30Hz = bytes * 30
    expect(bytesPerSecAt30Hz).toBeLessThan(15_000) // ≈8.5KB/s 실측, 15KB/s 미만이면 회귀 없음
  })
})
```

- [ ] **Step 2: 실행해서 통과 확인** — `npx vitest run src/tests/net-b-integration.test.ts` (Task 3/4 구현이 맞으면 바로 그린이어야 함 — 여기선 "실패 먼저" TDD가 아니라 통합 검증이므로, 실패 시 host-session/client-session 구현으로 돌아가 디버깅).
  - 흔한 실패 모드와 원인: (a) `bobsViewOfAliceX`가 `NaN` → `ensureLocalSprite`에서 `randomizeStart` 없이 스냅샷 pos로 바로 생성했는지 확인(맞게 구현됐다면 발생 안 함); (b) 수렴 안 함(오차 계속 벌어짐) → `POS_CORRECTION_ALPHA` 적용 부호/순서 확인, 또는 `updateFrame`이 원격 스프라이트의 `control.mouseAimX`를 0으로 유지해 `direction`이 계속 반대로 튀는지 확인(테스트의 `bobInput.mouseAimX=0`은 밥 "자신"의 입력이지 밥이 보는 앨리스 고스트의 컨트롤이 아님 — 앨리스 고스트의 컨트롤은 스냅샷 relay로 옴, 헷갈리지 말 것).
- [ ] **Step 3: Commit** — `git add src/tests/net-b-integration.test.ts && git commit -m "test(net): M3-B host+2-client loopback integration (movement sync, bandwidth)"`

---

### Task 6: 웹 배선 — main.ts에 네트 인게임 경로 연결

**Files:** Modify `src/web/main.ts`, `src/net/lobby-client.ts`

- [ ] **Step 1: lobby-client.ts — transport 접근용 getter 추가** (사설 필드명과 충돌 피하려 `net`으로 명명)

```ts
// src/net/lobby-client.ts — LobbyClient 클래스 안, players getter 근처에 추가
get net(): Transport { return this.transport }
```

- [ ] **Step 2: main.ts 리팩터 — 에셋 로드 공용 함수 추출**

`startBotMatch()`의 앞부분(에셋+`GameState`+무기+맵 로드, `me`/봇 스폰 이전까지)을 `loadGameAssets(ctf: boolean)`로 추출해 `startBotMatch`와 `startNetMatch` 둘 다 재사용한다. PIXI 씬 구성(`app.init`/텍스처/레이어 조립, 현재 함수의 중간 블록)도 `buildScene(gs, mapFile, manifest)`로 추출해 공유한다 — 이 부분은 기계적 이동이라 기존 라인을 그대로 옮기면 된다(라인 49-144 부근, `startBotMatch` 참조).

```ts
// main.ts — 상단 근처에 추가 (기존 import에 HostSession/ClientSession/StartMatchArg 추가)
import { HostSession, type HostSessionPlayer } from '../net/host-session'
import { ClientSession, type LocalInput } from '../net/client-session'
import type { StartMatchArg } from './lobby/lobby-ui'

// startBotMatch()의 앞부분(에셋 로드~맵 로드, 스폰 이전)을 그대로 옮긴 것.
async function loadGameAssets(ctf: boolean) {
  const manifest = await loadManifest()
  const read = await prefetchAnimFiles(manifest)
  const gs = createGameState()
  wireGameHooks(gs)
  gs.anims = loadAnimObjects(read)
  loadSpriteObjects(gs, read)
  loadThingObjects(gs, read)
  createWeapons(false)
  const weaponsJson = (await (await fetch('/assets/weapons.json')).json()) as { normal: WeaponsIniConfig }
  loadWeaponsConfig(weaponsJson.normal)
  const mapFile = loadMapFile(await fetchBinary(manifest.maps[MAP_NAME]))
  gs.map.loadData(mapFile)
  loadWaypoints(gs.botPath, mapFile.waypoints)
  gs.svGamemode = ctf ? GAMESTYLE_CTF : GAMESTYLE_DEATHMATCH
  gs.svKilllimit = ctf ? 10 : 9999
  return { gs, manifest, mapFile }
}
```

- [ ] **Step 3: `startNetMatch` 신설** — 씬 구성은 `startBotMatch`와 동일한 블록 재사용(텍스처/레이어/HUD/사운드/입력/카메라), 아래는 그 골격에서 **달라지는 부분만** 명시:

```ts
// main.ts — startBotMatch 아래에 추가
async function startNetMatch(a: StartMatchArg): Promise<void> {
  const ctf = a.mode === GAMESTYLE_CTF
  const { gs, manifest, mapFile } = await loadGameAssets(ctf)

  // ── (startBotMatch와 동일) PIXI 씬 구성 블록을 여기 인라인 — app/world/gostek/entities/hud/
  //    camera/input/sound 전부 그대로. 차이는 "me 스폰"과 "루프 본문"뿐이므로, 실제 구현시
  //    startBotMatch의 해당 블록(현재 105-168행)을 복붙 후 아래로 이어붙인다.
  // ... (app.init, texture load, world 조립, hud/sound/input/camera 준비 — startBotMatch와 동일)

  const account = a.lobby.account
  const isHost = a.lobby.isHost
  const transport = a.lobby.net

  let myNum = -1
  let hostSession: HostSession | null = null
  let clientSession: ClientSession | null = null

  if (isHost) {
    hostSession = new HostSession(transport, gs)
    const players: HostSessionPlayer[] = Object.entries(a.lobby.players)
      .map(([acc, p]) => ({ account: acc, team: p.team }))
    hostSession.spawnPlayers(players)
    myNum = hostSession.spriteNumOf(account)!
  } else {
    // getLocalInput은 아래 루프에서 매 틱 갱신되는 클로저 변수를 읽는다(§Step 4).
    clientSession = new ClientSession(transport, gs, account, () => currentLocalInput)
  }

  // ── 입력 → LocalInput 변환 (InputState는 스크린→월드 변환까지 해주므로 그 결과만 옮겨 담는다)
  let currentLocalInput: LocalInput = {
    left: false, right: false, up: false, down: false, fire: false, jetpack: false,
    throwNade: false, changeWeapon: false, throwWeapon: false, reload: false, prone: false,
    flagThrow: false, mouseAimX: 0, mouseAimY: 0,
  }

  // ── 60Hz 고정스텝 루프 (rAF 누산기 — startBotMatch와 동일 패턴)
  let acc = 0
  app.ticker.add((ticker) => {
    acc += ticker.deltaMS
    let ticks = 0
    while (acc >= TICK_MS && ticks < MAX_CATCHUP_TICKS) {
      input.applyTo(
        { ...currentLocalInput } as unknown as Parameters<typeof input.applyTo>[0], // 실제로는 아래 한 줄로 대체
        camera.x, camera.y, app.screen.width, app.screen.height,
      )
      // 위 한 줄은 설명용 — 실제 구현은 InputState.applyTo가 TControl을 직접 받으므로,
      // 임시 TControl 스크래치 객체를 만들어 채운 뒤 currentLocalInput으로 복사한다:
      //   input.applyTo(scratchControl, camera.x, camera.y, app.screen.width, app.screen.height)
      //   currentLocalInput = { ...scratchControl }  // seq 제외 필드가 이름 그대로 일치
      if (isHost && myNum >= 0) {
        const c = gs.sprite[myNum].control
        Object.assign(c, currentLocalInput) // 호스트 자신 스프라이트는 세션을 거치지 않고 직접 반영
        hostSession!.tick()
      } else {
        clientSession!.tick()
        if (clientSession!.myNum !== null) myNum = clientSession!.myNum
      }
      acc -= TICK_MS
      ticks++
    }
    if (ticks === MAX_CATCHUP_TICKS) acc = 0

    gostek.update(gs, myNum) // GostekPool은 무수정 재사용 — .active 스프라이트 전부 렌더
    entities.update(gs)
    hud.update(gs, myNum, app.screen.width, app.screen.height)
    if (myNum >= 0) {
      const px = gs.spriteParts.pos[myNum].x
      const py = gs.spriteParts.pos[myNum].y
      camera.update(px, py, input.mouseX, input.mouseY, app.screen.width, app.screen.height)
      world.position.set(app.screen.width / 2 - camera.x, app.screen.height / 2 - camera.y)
      bgLayer.position.set(app.screen.width / 2, app.screen.height / 2 - camera.y)
    }
  })
}
```

> **구현 메모**: 위 `startNetMatch`는 골격이다 — 실제 작성 시 씬 구성 블록(`app`/`world`/`gostek`/`entities`/`hud`/`sound`/`camera`/`input` 생성)을 `startBotMatch`에서 그대로 옮기고, "입력 스크래치 객체 → currentLocalInput 복사" 부분을 실제 `TControl` 셰이프로 깔끔히 정리한다(주석으로 남긴 설명용 우회 코드가 아니라 실제 스크래치 `TControl` 객체 하나를 `main.ts` 상단에 만들어 매 틱 재사용). 이 정리는 기계적이라 리뷰에서 지적되면 바로 고칠 수 있다.

- [ ] **Step 4: boot() 배선 교체**

```ts
// main.ts — 기존 boot() 교체
function boot(): void {
  const params = new URLSearchParams(window.location.search)
  if (params.get('nolobby') === '1') {
    startBotMatch().catch(fail)
    return
  }
  mountLobby(document.body, {
    onStartMatch: (a) => {
      document.body.innerHTML = ''
      if (a.lobby.net.status === 'online') startNetMatch(a).catch(fail)
      else startBotMatch().catch(fail) // 미배포/오프라인 폴백 (기존 A단계 그대로)
    },
    onOfflineBots: () => { document.body.innerHTML = ''; startBotMatch().catch(fail) },
  })
}
```

- [ ] **Step 5: 브라우저 검증** — `npm run dev`, `localhost:3024`.
  - `?nolobby=1` → 기존 봇전 직행 (회귀 없음 확인).
  - 로비에서 "Quick Join(online)" → 미배포 환경이므로 여전히 offline 메시지 + Offline Bot Match 폴백 (실 배포 없이는 온라인 net 경로를 브라우저에서 눈으로 볼 수 없음 — 이건 D/E 단계에서 실제 배포 후 확인. 이번 단계 브라우저 검증은 **회귀 없음**이 전부).
  - 콘솔 에러 0. `npx tsc --noEmit` 클린. `npm test` 전체 그린(기존 233 + 이번 추가분).
- [ ] **Step 6: Commit** — `git add src/web/main.ts src/net/lobby-client.ts && git commit -m "feat(web): wire lobby start to host/client net session (fallback to offline bots)"`

---

## 검증 요약 (스펙 §6-B 완료 기준 대조)

| 스펙 §6-B 요구 | 이 계획의 커버 |
|---|---|
| host-session·client-session·입력릴레이·스냅샷·예측/보간·다병사 렌더 배선 | T3(host-session), T4(client-session), T1-2(프로토콜), T6(웹 배선, GostekPool 무수정 재사용) |
| loopback 2세션: 한쪽 이동이 다른쪽 화면에 부드럽게 반영 | T5 핵심 테스트 — 실제로는 1호스트+2클라(브리핑 요구치 상회) |
| 스냅샷 대역폭 측정 | T2(8스프라이트 320B 이하 단위테스트) + T5(30Hz 환산 15KB/s 미만) — 실측 ≈285B/8인, ≈8.5KB/s |
| tsc 클린, 기존 233 테스트 그린, 코어 무수정 | 각 태스크 Step 4/검증에 명시. 마지막에 `git diff --stat src/core` 실행해 빈 출력 확인 필수 |

## Self-Review 결과 및 열린 질문

- **스펙 대비 편차 2건**(위 "설계 결정" 참조)을 투명하게 문서화: (1) 원격 스프라이트를 순수 보간이 아니라 컨트롤 릴레이+공유시뮬로 굴림(대역폭↑, 그러나 GostekPool 무수정 재사용·코어 무수정이라는 더 강한 제약을 동시에 만족시키는 유일한 실용적 경로), (2) "account-index" 필드를 스프라이트 슬롯 번호로 접고 별도 `MSG.ASSIGN`으로 대체(바이트 절약, 필드 단순화).
- **플레이스홀더 없음 원칙**: T1/T2/T3/T4/T5는 완결된 실행 가능 코드. T6(웹 배선)만 "씬 구성 블록은 startBotMatch에서 그대로 옮긴다"는 기계적 이동을 명시적으로 남겼다 — main.ts 전체(250줄)를 다시 베끼는 대신 무엇이 같고 무엇이 다른지 정확히 짚었으므로 구현자가 빈칸을 채우는 게 아니라 "복붙+한 곳 정리"만 하면 된다.
- **타입 일관성**: `InputMsg`/`SnapshotSprite.control`/`LocalInput`이 필드명을 전부 동일하게 유지(seq 유무만 다름)해 `Object.assign`/스프레드로 변환 없이 오갈 수 있게 설계했다.
- **동시성/레이스**: `MSG.ASSIGN`이 첫 스냅샷보다 늦게 도착해도(또는 반대 순서여도) 안전함을 "설계 결정 3"에서 논증(비활성 스프라이트에 control을 써도 코어가 무시).
- **열린 질문 1 (다음 단계로 이관)**: 실제 agent8 배포 환경에서 `Transport.send`의 `payload`가 `ArrayBuffer`를 그대로 JSON 직렬화 없이 실어 나르는지 미검증 — Phase A의 `transport.ts`가 `remoteFunction(name, args)`로 감싸는데, agent8 SDK가 args를 JSON.stringify한다면 `ArrayBuffer`는 `{}`로 깨진다. D단계(전용 서버 스파이크) 또는 그 전에 실 SDK로 `encodeInput(...)` 결과를 한 번 왕복시켜 확인 필요 — 안 되면 `Array.from(new Uint8Array(buf))`(숫자 배열) 또는 base64 문자열로 감싸는 얇은 어댑터를 `transport.ts`에 추가(프로토콜 자체는 무수정). loopback은 참조를 그대로 넘기므로 이 계획의 모든 테스트는 이 이슈에 영향받지 않는다.
- **열린 질문 2**: 플레이어 이탈(leave)/재접속 시 호스트가 스프라이트를 어떻게 정리할지(현재 `slotOf`에 남아 유령 스프라이트가 계속 시뮬됨) — 스펙이 이를 E단계(호스트 마이그레이션·재접속) 몫으로 명시하므로 이 계획은 손대지 않음, 다만 `HostSession`에 `removePlayer(account)` 자리를 남겨두는 것도 고려할 만하다(구현 안 함, 다음 계획 메모).
- **열린 질문 3**: 아군(팀) 충돌/무기 표시 등 렌더 디테일(팔/머리 마우스에임 회전, 무기 스프라이트)은 원격 스프라이트에서 다소 어색할 수 있음(마지막 컨트롤 릴레이가 25-40ms 지연) — 전투가 들어오는 C단계에서 무기 스프라이트 동기화와 함께 다듬기로 하고 B는 "이동이 믿을 만하게 보인다"까지만 목표로 함.
- **다음 계획**: M3-C(탄환 이벤트·호스트 데미지판정·kill/사망/리스폰·스코어·킬피드, CTF 깃발) — B 완료(리뷰 통과) 후 작성.
