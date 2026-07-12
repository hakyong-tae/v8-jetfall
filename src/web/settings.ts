// src/web/settings.ts — 게임 설정 스키마 + localStorage 영속 (스펙 §4).
// 항목은 YAGNI로 3개만: SFX 볼륨(0~100), 뮤트, 조작키 표(읽기전용 — UI측 정적 데이터).
// 부팅 시 loadSettings→적용, 변경 즉시 saveSettings. 적용(사운드 게인 배선)은 main.ts 책임.

export interface GameSettings {
  sfxVolume: number // 0..100
  muted: boolean
}

export const DEFAULT_SETTINGS: GameSettings = { sfxVolume: 80, muted: false }

export const SETTINGS_KEY = 'jetfall.settings.v1'

function clamp(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v))
}

// JSON 파싱 + 스키마 가드 + 클램프. 어떤 형태로 깨져 있어도 DEFAULT로 안전 폴백.
export function loadSettings(storage: Pick<Storage, 'getItem'> = localStorage): GameSettings {
  try {
    const raw = storage.getItem(SETTINGS_KEY)
    if (!raw) return { ...DEFAULT_SETTINGS }
    const parsed: unknown = JSON.parse(raw)
    if (typeof parsed !== 'object' || parsed === null) return { ...DEFAULT_SETTINGS }
    const o = parsed as Record<string, unknown>
    if (typeof o.sfxVolume !== 'number' || !Number.isFinite(o.sfxVolume) || typeof o.muted !== 'boolean')
      return { ...DEFAULT_SETTINGS }
    return { sfxVolume: clamp(Math.round(o.sfxVolume), 0, 100), muted: o.muted }
  } catch {
    return { ...DEFAULT_SETTINGS }
  }
}

export function saveSettings(s: GameSettings, storage: Pick<Storage, 'setItem'> = localStorage): void {
  try {
    storage.setItem(SETTINGS_KEY, JSON.stringify(s))
  } catch {
    // 스토리지 불가(사파리 프라이빗 등) — 설정은 세션 한정으로 동작
  }
}
