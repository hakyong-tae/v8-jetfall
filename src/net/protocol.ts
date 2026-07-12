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
