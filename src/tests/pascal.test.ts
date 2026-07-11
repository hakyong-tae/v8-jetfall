import { describe, it, expect } from 'vitest'
import { pascalRound, trunc, sqr } from '../core/pascal'

describe('pascalRound (banker\'s rounding)', () => {
  it('rounds half to even', () => {
    expect(pascalRound(0.5)).toBe(0)
    expect(pascalRound(1.5)).toBe(2)
    expect(pascalRound(2.5)).toBe(2)
    expect(pascalRound(-0.5)).toBe(-0)
    expect(pascalRound(-1.5)).toBe(-2)
    expect(pascalRound(2.4)).toBe(2)
    expect(pascalRound(2.6)).toBe(3)
  })
})
describe('trunc/sqr', () => {
  it('behaves like Pascal', () => {
    expect(trunc(2.9)).toBe(2)
    expect(trunc(-2.9)).toBe(-2)
    expect(sqr(3)).toBe(9)
  })
})
