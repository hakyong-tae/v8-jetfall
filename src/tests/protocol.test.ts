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
