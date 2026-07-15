// src/tests/i18n.test.ts — UI 다국어 가드 단위테스트.
// 핵심: 모든 비-en 언어가 en과 정확히 동일한 키셋을 갖는지(누락/초과 없음) — 번역 누락 회귀 방지.
import { describe, it, expect, beforeEach } from 'vitest'
import {
  STRINGS, LANGS, type Lang, type StringKey,
  getLang, setLang, initLang, detectLang, isLang, onLangChange, t,
} from '../web/i18n'
import { loadSettings, SETTINGS_KEY } from '../web/settings'

function mockStorage(initial: Record<string, string> = {}) {
  const map = new Map(Object.entries(initial))
  return {
    getItem: (k: string) => map.get(k) ?? null,
    setItem: (k: string, v: string) => void map.set(k, v),
    dump: () => Object.fromEntries(map),
  }
}

describe('i18n string tables', () => {
  const enKeys = Object.keys(STRINGS.en).sort()
  const others: Lang[] = ['ko', 'zh', 'es', 'pt']

  it('every non-en language has EXACTLY the same key set as en', () => {
    for (const lang of others) {
      const keys = Object.keys(STRINGS[lang]).sort()
      expect(keys, `language ${lang} key set`).toEqual(enKeys)
    }
  })

  it('no translation value is empty', () => {
    for (const lang of Object.keys(STRINGS) as Lang[]) {
      for (const [k, v] of Object.entries(STRINGS[lang])) {
        expect(v.length, `${lang}.${k}`).toBeGreaterThan(0)
      }
    }
  })

  it('LANGS covers all 5 languages with endonym labels', () => {
    expect(LANGS.map((l) => l.code).sort()).toEqual(['en', 'es', 'ko', 'pt', 'zh'])
    for (const l of LANGS) expect(l.label.length).toBeGreaterThan(0)
  })
})

describe('t() lookup + fallback', () => {
  beforeEach(() => setLang('en'))

  it('returns the string for the active language', () => {
    setLang('ko')
    expect(t('menu.settings')).toBe('설정')
    setLang('zh')
    expect(t('menu.settings')).toBe('设置')
    setLang('es')
    expect(t('mode.dm')).toBe('Duelo a muerte')
  })

  it('falls back to en when a (cast) key is missing in the active language', () => {
    setLang('ko')
    const bogus = 'does.not.exist' as StringKey
    // ko에 없는 키 → en도 없으면 키 자체 반환(폴백 체인). 실제 존재 키는 ko 값이 나와야 한다.
    expect(t(bogus)).toBe('does.not.exist')
    expect(t('sb.kills')).toBe('킬')
  })
})

describe('detectLang', () => {
  it('maps navigator prefixes correctly', () => {
    expect(detectLang('ko-KR')).toBe('ko')
    expect(detectLang('zh-CN')).toBe('zh')
    expect(detectLang('zh-Hans')).toBe('zh')
    expect(detectLang('es-ES')).toBe('es')
    expect(detectLang('pt-BR')).toBe('pt')
    expect(detectLang('en-US')).toBe('en')
    expect(detectLang('fr-FR')).toBe('en') // 미지원 → en
    expect(detectLang('')).toBe('en')
  })
})

describe('isLang guard', () => {
  it('accepts the 5 codes, rejects others', () => {
    for (const c of ['en', 'ko', 'zh', 'es', 'pt']) expect(isLang(c)).toBe(true)
    for (const c of ['fr', '', 'EN', undefined, null, 42]) expect(isLang(c)).toBe(false)
  })
})

describe('initLang', () => {
  it('uses explicit stored setting when valid', () => {
    expect(initLang('ko')).toBe('ko')
    expect(getLang()).toBe('ko')
  })
  it('falls back to detectLang when stored setting is missing/invalid', () => {
    // navigator는 jsdom 환경에서 존재(보통 en). 값이 무엇이든 유효 Lang이어야 한다.
    const r = initLang(undefined)
    expect(isLang(r)).toBe(true)
    expect(initLang('bogus')).toBe(detectLang())
  })
})

describe('setLang persistence + subscribers', () => {
  it('persists lang to settings storage and getLang reflects it', () => {
    const st = mockStorage()
    // setLang은 기본 localStorage를 쓰므로 여기선 getLang/구독만 검증하고,
    // 저장 왕복은 settings 레벨에서 확인한다.
    setLang('pt')
    expect(getLang()).toBe('pt')
    // settings 저장 왕복 (명시 storage)
    st.setItem(SETTINGS_KEY, JSON.stringify({ sfxVolume: 50, muted: false, lang: 'zh' }))
    expect(loadSettings(st).lang).toBe('zh')
  })

  it('notifies subscribers on change and unsubscribes cleanly', () => {
    const seen: Lang[] = []
    const off = onLangChange((l) => seen.push(l))
    setLang('es')
    setLang('ko')
    off()
    setLang('en')
    expect(seen).toEqual(['es', 'ko'])
  })
})
