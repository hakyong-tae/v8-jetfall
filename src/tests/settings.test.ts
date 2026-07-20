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
    // highlightMyGun 기본 ON — 저장값에 없으면 load가 true로 채운다(신규/구버전 사용자 ON).
    expect(loadSettings(st)).toEqual({ sfxVolume: 60, muted: true, highlightMyGun: true })
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
    expect(loadSettings(st)).toEqual({ sfxVolume: 100, muted: true, highlightMyGun: true })
    const st2 = mockStorage({ [SETTINGS_KEY]: JSON.stringify({ sfxVolume: -5, muted: false }) })
    expect(loadSettings(st2)).toEqual({ sfxVolume: 0, muted: false, highlightMyGun: true })
  })

  it('i18n backward-compat: old JSON without lang loads fine (lang undefined)', () => {
    const st = mockStorage({ [SETTINGS_KEY]: JSON.stringify({ sfxVolume: 70, muted: false }) })
    const s = loadSettings(st)
    expect(s).toEqual({ sfxVolume: 70, muted: false, highlightMyGun: true })
    expect(s.lang).toBeUndefined()
  })

  it('keeps a valid lang and drops an invalid one', () => {
    const ok = mockStorage({ [SETTINGS_KEY]: JSON.stringify({ sfxVolume: 70, muted: false, lang: 'ko' }) })
    expect(loadSettings(ok).lang).toBe('ko')
    const bad = mockStorage({ [SETTINGS_KEY]: JSON.stringify({ sfxVolume: 70, muted: false, lang: 'xx' }) })
    expect(loadSettings(bad).lang).toBeUndefined()
    // round-trips through save
    saveSettings({ sfxVolume: 30, muted: true, lang: 'zh' }, ok)
    expect(loadSettings(ok).lang).toBe('zh')
  })

  it('highlightMyGun defaults ON, but an explicit false is respected', () => {
    // 저장값 없음 → 기본 ON
    expect(loadSettings(mockStorage()).highlightMyGun).toBe(true)
    // 명시적 false → OFF 유지(껐던 사용자 존중)
    const off = mockStorage({ [SETTINGS_KEY]: JSON.stringify({ sfxVolume: 70, muted: false, highlightMyGun: false }) })
    expect(loadSettings(off).highlightMyGun).toBe(false)
  })
})
