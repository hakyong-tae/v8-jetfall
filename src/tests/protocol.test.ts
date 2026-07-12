// src/tests/protocol.test.ts
import { describe, it, expect } from 'vitest'
import { MSG, isMsg, encodeInput, decodeInput, type InputMsg,
  encodeSnapshot, decodeSnapshot, type SnapshotSprite, type SnapshotMsg } from '../net/protocol'

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
