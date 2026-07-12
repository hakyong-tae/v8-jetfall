// src/tests/protocol.test.ts
import { describe, it, expect } from 'vitest'
import { MSG, isMsg, encodeInput, decodeInput, type InputMsg } from '../net/protocol'

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
