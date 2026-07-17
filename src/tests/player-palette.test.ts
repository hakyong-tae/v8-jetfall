// src/tests/player-palette.test.ts — 멀티 플레이어 색상 팔레트
import { describe, it, expect } from 'vitest'
import { playerColors, applyPlayerColors } from '../net/player-palette'

describe('playerColors', () => {
  it('같은 num이면 항상 같은 색 (호스트/클라 무동기화 일치의 전제)', () => {
    expect(playerColors(3)).toEqual(playerColors(3))
  })
  it('연속 num 8명은 전부 서로 다른 셔츠색', () => {
    const shirts = new Set(Array.from({ length: 8 }, (_, i) => playerColors(i + 1).shirt))
    expect(shirts.size).toBe(8)
  })
  it('applyPlayerColors가 세 필드를 모두 채운다', () => {
    const p = { shirtColor: 0, pantsColor: 0, hairColor: 0 }
    applyPlayerColors(p, 1)
    expect(p.shirtColor).toBeGreaterThan(0)
    expect(p.pantsColor).toBeGreaterThan(0)
    expect(p.hairColor).toBeGreaterThan(0)
  })
  it('음수/큰 num도 안전하게 순환', () => {
    expect(() => playerColors(100)).not.toThrow()
    expect(playerColors(9)).toEqual(playerColors(1)) // 8 순환
  })
})
