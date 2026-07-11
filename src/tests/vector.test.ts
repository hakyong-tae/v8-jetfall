import { describe, it, expect } from 'vitest'
import { vector2, vec2Length, vec2Add, vec2Subtract, vec2Scale, vec2Normalize, vec2Dot } from '../core/vector'

describe('vector2', () => {
  it('basic ops', () => {
    expect(vec2Length(vector2(3, 4))).toBe(5)
    expect(vec2Add(vector2(1, 2), vector2(3, 4))).toEqual({ x: 4, y: 6 })
    expect(vec2Subtract(vector2(3, 4), vector2(1, 2))).toEqual({ x: 2, y: 2 })
    expect(vec2Scale(vector2(1, 2), 3)).toEqual({ x: 3, y: 6 })
    expect(vec2Dot(vector2(1, 2), vector2(3, 4))).toBe(11)
  })
  it('normalize: len<0.001 → zero vector', () => {
    expect(vec2Normalize(vector2(0.0005, 0))).toEqual({ x: 0, y: 0 })
    const n = vec2Normalize(vector2(3, 4))
    expect(n.x).toBeCloseTo(0.6); expect(n.y).toBeCloseTo(0.8)
  })
})
