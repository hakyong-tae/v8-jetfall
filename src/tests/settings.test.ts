// settings.ts — localStorage 영속 설정 단위테스트 (목 storage, 브라우저 불요).
import { describe, it, expect } from 'vitest'
import { loadSettings, saveSettings, DEFAULT_SETTINGS, SETTINGS_KEY } from '../web/settings'

function mockStorage(initial: Record<string, string> = {}) {
  const map = new Map(Object.entries(initial))
  return {
    getItem: (k: string) => map.get(k) ?? null,
    setItem: (k: string, v: string) => void map.set(k, v),
    dump: () => Object.fromEntries(map),
  }
}

describe('settings persistence', () => {
  it('round-trips save → load', () => {
    const st = mockStorage()
    saveSettings({ sfxVolume: 60, muted: true }, st)
    expect(loadSettings(st)).toEqual({ sfxVolume: 60, muted: true })
    expect(st.dump()[SETTINGS_KEY]).toBeTruthy()
  })

  it('falls back to defaults on missing / broken JSON / wrong shape', () => {
    expect(loadSettings(mockStorage())).toEqual(DEFAULT_SETTINGS)
    expect(loadSettings(mockStorage({ [SETTINGS_KEY]: '{oops' }))).toEqual(DEFAULT_SETTINGS)
    expect(loadSettings(mockStorage({ [SETTINGS_KEY]: '"str"' }))).toEqual(DEFAULT_SETTINGS)
    expect(loadSettings(mockStorage({ [SETTINGS_KEY]: JSON.stringify({ sfxVolume: 'loud', muted: 1 }) })))
      .toEqual(DEFAULT_SETTINGS)
  })

  it('clamps out-of-range volume (120→100, -5→0) and keeps valid muted', () => {
    const st = mockStorage({ [SETTINGS_KEY]: JSON.stringify({ sfxVolume: 120, muted: true }) })
    expect(loadSettings(st)).toEqual({ sfxVolume: 100, muted: true })
    const st2 = mockStorage({ [SETTINGS_KEY]: JSON.stringify({ sfxVolume: -5, muted: false }) })
    expect(loadSettings(st2)).toEqual({ sfxVolume: 0, muted: false })
  })
})
