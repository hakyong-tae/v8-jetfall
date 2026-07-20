// src/tests/keybindings.test.ts — 키 리바인딩 저장/복원/라벨
import { describe, it, expect, beforeEach } from 'vitest'
import { getBindings, setBinding, resetBindings, keyLabel, boundCodes, BINDABLE } from '../web/keybindings'

// localStorage 목(노드 환경)
beforeEach(() => {
  const store: Record<string, string> = {}
  ;(globalThis as { localStorage?: unknown }).localStorage = {
    getItem: (k: string) => (k in store ? store[k] : null),
    setItem: (k: string, v: string) => { store[k] = v },
    removeItem: (k: string) => { delete store[k] },
  }
  resetBindings() // 캐시 초기화(기본값)
})

describe('keybindings', () => {
  it('defaults match soldat controls.cfg (A/D/W/S/X, R/E/F/Space)', () => {
    const b = getBindings()
    expect(b.left).toBe('KeyA'); expect(b.right).toBe('KeyD'); expect(b.jump).toBe('KeyW')
    expect(b.crouch).toBe('KeyS'); expect(b.prone).toBe('KeyX'); expect(b.reload).toBe('KeyR')
    expect(b.grenade).toBe('KeyE'); expect(b.dropWeapon).toBe('KeyF'); expect(b.flagThrow).toBe('Space')
  })
  it('setBinding persists and is reflected immediately (cache + storage)', () => {
    setBinding('jump', 'ArrowUp')
    expect(getBindings().jump).toBe('ArrowUp')
    expect(JSON.parse(localStorage.getItem('jetfall.keys.v1')!).jump).toBe('ArrowUp')
  })
  it('resetBindings restores defaults', () => {
    setBinding('left', 'ArrowLeft')
    resetBindings()
    expect(getBindings().left).toBe('KeyA')
  })
  it('boundCodes includes every bound key + Tab (preventDefault set)', () => {
    setBinding('jump', 'ArrowUp')
    const codes = boundCodes()
    expect(codes.has('ArrowUp')).toBe(true)
    expect(codes.has('Tab')).toBe(true)
    expect(codes.has('KeyD')).toBe(true) // right (unchanged default)
  })
  it('keyLabel maps codes to readable labels', () => {
    expect(keyLabel('KeyA')).toBe('A')
    expect(keyLabel('Digit1')).toBe('1')
    expect(keyLabel('Space')).toBe('Space')
    expect(keyLabel('ArrowUp')).toBe('↑')
    expect(keyLabel('')).toBe('—')
  })
  it('BINDABLE list covers all 9 movement/combat actions with i18n label keys', () => {
    expect(BINDABLE).toHaveLength(9)
    for (const b of BINDABLE) expect(b.labelKey.startsWith('ctrl.')).toBe(true)
  })
})
