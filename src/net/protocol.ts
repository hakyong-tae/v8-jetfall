// src/net/protocol.ts — 넷 메시지 종류. B단계에서 INPUT/SNAPSHOT 바이너리 (역)직렬화 추가.
export const MSG = {
  INPUT: 'input',   // 클라→호스트: control 비트마스크 + mouseAim (B단계)
  SNAPSHOT: 'snap', // 호스트→전체: 병사 상태 배열 (B단계)
  BULLET: 'bul',    // 호스트→전체: 탄환 생성 이벤트 (C단계)
  KILL: 'kill',     // 호스트→전체: killer/victim/weapon (C단계)
  START: 'start',   // 호스트→전체: 매치 시작 (A단계에서 종류만 예약)
  ASSIGN: 'assign', // B단계 신규 — 호스트→해당 계정: {account, num} 배정된 스프라이트 번호 통지 (저빈도, JSON 그대로)
} as const

export type MsgKind = (typeof MSG)[keyof typeof MSG]

const KNOWN = new Set<string>(Object.values(MSG))
export function isMsg(k: string): k is MsgKind {
  return KNOWN.has(k)
}

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
