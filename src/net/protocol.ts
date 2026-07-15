// src/net/protocol.ts — 넷 메시지 종류. B단계에서 INPUT/SNAPSHOT 바이너리 (역)직렬화 추가.
export const MSG = {
  INPUT: 'input',   // 클라→호스트: control 비트마스크 + mouseAim (B단계)
  SNAPSHOT: 'snap', // 호스트→전체: 병사 상태 배열 (B단계)
  BULLET: 'bul',    // 호스트→전체: 탄환 생성 이벤트 (C단계)
  KILL: 'kill',     // 호스트→전체: killer/victim/weapon (C단계)
  START: 'start',   // 호스트→전체: 매치 시작 (A단계에서 종류만 예약)
  ASSIGN: 'assign', // B단계 신규 — 호스트→해당 계정: {account, num} 배정된 스프라이트 번호 통지 (저빈도, JSON 그대로)
  LOADOUT: 'loadout', // M5 신규 — 클라→호스트: {selWeapon, secWep} 무기선택(림보) 반영 요청 (저빈도, JSON 그대로 — ASSIGN/KILL과 동일 규약)
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
  kills: number   // Uint8, 0..255 클램프 — 호스트 진실값(설계 결정 3)
  deaths: number  // Uint8, 0..255 클램프
  weaponNum: number // Uint8 — 손에 든 무기 TGun.num (NOWEAPON_NUM=255까지). 코스메틱 동기화용
  control: ControlFlags & { mouseAimX: number; mouseAimY: number } // 컨트롤 릴레이 (설계 결정 1)
}

// ── C단계: CTF 깃발 상태 (선택적 블록) ──────────────────────────────────────
export interface FlagState {
  style: number         // Uint8 — OBJECT_ALPHA_FLAG=1 | OBJECT_BRAVO_FLAG=2
  thingNum: number       // Uint8 — gs.teamFlag[style] (0 = 아직 스폰 안 됨, client 로직이 스킵)
  holdingSprite: number  // Uint8 — 0 = 캐리어 없음
  posX: number; posY: number // Float32
}

export interface SnapshotMsg {
  tick: number
  teamScore1: number  // Uint8 — gs.teamScore[1] (Alpha). DM에선 항상 0, 무해.
  teamScore2: number  // Uint8 — gs.teamScore[2] (Bravo)
  sprites: SnapshotSprite[]
  flags?: FlagState[] // 없거나 길이 0/2. encode 시 undefined는 빈 배열과 동일 취급.
}

// 헤더(8B: tick Uint32 + count Uint8 + teamScore1 Uint8 + teamScore2 Uint8 + flagCount Uint8) +
// 스프라이트당 38B (Phase C 37B + weaponNum1) + 깃발당 11B.
const SNAP_HEADER_BYTES = 8
const SNAP_SPRITE_BYTES = 38
const SNAP_FLAG_BYTES = 11 // style1 + thingNum1 + holdingSprite1 + posX4 + posY4

export function encodeSnapshot(msg: SnapshotMsg): ArrayBuffer {
  const flags = msg.flags ?? []
  const buf = new ArrayBuffer(
    SNAP_HEADER_BYTES + msg.sprites.length * SNAP_SPRITE_BYTES + flags.length * SNAP_FLAG_BYTES,
  )
  const dv = new DataView(buf)
  dv.setUint32(0, msg.tick >>> 0, true)
  dv.setUint8(4, msg.sprites.length)
  dv.setUint8(5, Math.max(0, Math.min(255, msg.teamScore1)))
  dv.setUint8(6, Math.max(0, Math.min(255, msg.teamScore2)))
  dv.setUint8(7, flags.length)
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
    dv.setUint8(o, Math.max(0, Math.min(255, s.kills))); o += 1
    dv.setUint8(o, Math.max(0, Math.min(255, s.deaths))); o += 1
    dv.setUint8(o, Math.max(0, Math.min(255, s.weaponNum))); o += 1
  }
  for (const f of flags) {
    dv.setUint8(o, f.style); o += 1
    dv.setUint8(o, f.thingNum); o += 1
    dv.setUint8(o, f.holdingSprite); o += 1
    dv.setFloat32(o, f.posX, true); o += 4
    dv.setFloat32(o, f.posY, true); o += 4
  }
  return buf
}

export function decodeSnapshot(buf: ArrayBuffer): SnapshotMsg {
  const dv = new DataView(buf)
  const tick = dv.getUint32(0, true)
  const count = dv.getUint8(4)
  const teamScore1 = dv.getUint8(5)
  const teamScore2 = dv.getUint8(6)
  const flagCount = dv.getUint8(7)
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
    const kills = dv.getUint8(o); o += 1
    const deaths = dv.getUint8(o); o += 1
    const weaponNum = dv.getUint8(o); o += 1
    sprites.push({ num, team, direction, deadMeat, health, jetsCount, legsAnimId, legsFrame,
      bodyAnimId, bodyFrame, lastInputSeq, posX, posY, velX, velY, kills, deaths, weaponNum,
      control: { ...bits, mouseAimX, mouseAimY } })
  }
  const flags: FlagState[] = []
  for (let k = 0; k < flagCount; k++) {
    const style = dv.getUint8(o); o += 1
    const thingNum = dv.getUint8(o); o += 1
    const holdingSprite = dv.getUint8(o); o += 1
    const posX = dv.getFloat32(o, true); o += 4
    const posY = dv.getFloat32(o, true); o += 4
    flags.push({ style, thingNum, holdingSprite, posX, posY })
  }
  return { tick, teamScore1, teamScore2, sprites, flags }
}

// ── C단계: 탄환 생성 이벤트 (바이너리, 고빈도) ──────────────────────────────
export interface BulletMsg {
  seq: number       // Uint32
  owner: number     // Uint8 — 발사자 스프라이트 num
  weaponNum: number // Uint8 — TBullet.ownerWeapon
  style: number     // Uint8 — TBullet.style (시각 스타일)
  hitMultiply: number // Float32 — TBullet.hitMultiply (클라에선 코스메틱, 데미지는 호스트가 별도 판정)
  seed: number      // Int32 — TBullet.seed (리코셰 등 재현용)
  posX: number; posY: number // Float32 — TBullet.initial (생성시점 정확한 스폰좌표, 물리 미적용)
  velX: number; velY: number // Float32 — 생성 직후 오일러 1스텝 적용된 근사치(설계 결정 1 참조)
}
const BULLET_BYTES = 31 // seq4+owner1+weaponNum1+style1+hitMultiply4+seed4+posX4+posY4+velX4+velY4

export function encodeBullet(m: BulletMsg): ArrayBuffer {
  const buf = new ArrayBuffer(BULLET_BYTES)
  const dv = new DataView(buf)
  dv.setUint32(0, m.seq >>> 0, true)
  dv.setUint8(4, m.owner)
  dv.setUint8(5, m.weaponNum)
  dv.setUint8(6, m.style)
  dv.setFloat32(7, m.hitMultiply, true)
  dv.setInt32(11, m.seed, true)
  dv.setFloat32(15, m.posX, true)
  dv.setFloat32(19, m.posY, true)
  dv.setFloat32(23, m.velX, true)
  dv.setFloat32(27, m.velY, true)
  return buf
}

export function decodeBullet(buf: ArrayBuffer): BulletMsg {
  const dv = new DataView(buf)
  return {
    seq: dv.getUint32(0, true), owner: dv.getUint8(4), weaponNum: dv.getUint8(5), style: dv.getUint8(6),
    hitMultiply: dv.getFloat32(7, true), seed: dv.getInt32(11, true),
    posX: dv.getFloat32(15, true), posY: dv.getFloat32(19, true),
    velX: dv.getFloat32(23, true), velY: dv.getFloat32(27, true),
  }
}

// ── C단계: 킬 이벤트 (저빈도 — JSON 그대로, ASSIGN과 동일 규약) ─────────────
export interface KillMsg {
  killer: number // 0 = 환경사/자살 (사실 4: who===num이면 코어가 kills를 안 올림)
  victim: number
  weaponNum: number // 킬러가 그 순간 들고 있던 무기 — 근사(설계 결정 3)
}

// ── M5: 무기선택(림보) 반영 요청 (저빈도 — JSON 그대로, ASSIGN/KILL과 동일 규약) ─
export interface LoadoutMsg {
  selWeapon: number // TSprite.selWeapon과 동일 규약 — 0=미선택, 그 외 guns[].num
  secWep: number    // TPlayer.secWep과 동일 규약 — 0..SECONDARY_WEAPONS-1 오프셋
}
