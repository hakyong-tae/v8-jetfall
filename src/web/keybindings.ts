// src/web/keybindings.ts — 재설정 가능한 키 바인딩(이동/전투). localStorage 영속 + 캐시.
// applyTo가 쓰는 키보드 액션만 대상. 마우스(발사/제트)·Tab(스코어보드)·1/2(슬롯)·Q(무기창)·ESC는
// 시스템 키로 고정(설정 화면에 정보로만 표시). 코드값은 KeyboardEvent.code(레이아웃 독립).
export type BindableAction =
  | 'left' | 'right' | 'jump' | 'crouch' | 'prone'
  | 'reload' | 'grenade' | 'dropWeapon' | 'flagThrow'

// 표시 순서 + i18n 라벨 키 + 기본 코드. (soldat controls.cfg 기본 바인딩)
export const BINDABLE: { action: BindableAction; labelKey: string; def: string }[] = [
  { action: 'left', labelKey: 'ctrl.left', def: 'KeyA' },
  { action: 'right', labelKey: 'ctrl.right', def: 'KeyD' },
  { action: 'jump', labelKey: 'ctrl.jump', def: 'KeyW' },
  { action: 'crouch', labelKey: 'ctrl.crouch', def: 'KeyS' },
  { action: 'prone', labelKey: 'ctrl.prone', def: 'KeyX' },
  { action: 'reload', labelKey: 'ctrl.reload', def: 'KeyR' },
  { action: 'grenade', labelKey: 'ctrl.grenade', def: 'KeyE' },
  { action: 'dropWeapon', labelKey: 'ctrl.dropWeapon', def: 'KeyF' },
  { action: 'flagThrow', labelKey: 'ctrl.flagThrow', def: 'Space' },
]

export type Bindings = Record<BindableAction, string>
const DEFAULTS: Bindings = BINDABLE.reduce((m, b) => { m[b.action] = b.def; return m }, {} as Bindings)
const KEY = 'jetfall.keys.v1'

let cache: Bindings | null = null
export function getBindings(): Bindings {
  if (cache) return cache
  const out: Bindings = { ...DEFAULTS }
  try {
    const o = JSON.parse(localStorage.getItem(KEY) || '{}') as Record<string, unknown>
    for (const b of BINDABLE) if (typeof o[b.action] === 'string') out[b.action] = o[b.action] as string
  } catch { /* 손상/미지원 → 기본값 */ }
  return (cache = out)
}
export function setBinding(action: BindableAction, code: string): void {
  const next: Bindings = { ...getBindings(), [action]: code }
  cache = next
  try { localStorage.setItem(KEY, JSON.stringify(next)) } catch { /* 세션 한정 */ }
}
export function resetBindings(): void {
  cache = { ...DEFAULTS }
  try { localStorage.setItem(KEY, JSON.stringify(cache)) } catch { /* 세션 한정 */ }
}
// preventDefault 대상(스크롤/포커스 이동 차단) — 바인딩된 모든 키 + Tab.
export function boundCodes(): Set<string> {
  return new Set([...Object.values(getBindings()), 'Tab'])
}

// 코드 → 화면 표시 라벨. 언어 무관 기호/문자(예: KeyA→A, Digit1→1, ArrowUp→↑, Space→Space).
export function keyLabel(code: string): string {
  if (!code) return '—'
  if (code.startsWith('Key')) return code.slice(3)
  if (code.startsWith('Digit')) return code.slice(5)
  if (code.startsWith('Numpad')) return 'Num ' + code.slice(6)
  const map: Record<string, string> = {
    ArrowUp: '↑', ArrowDown: '↓', ArrowLeft: '←', ArrowRight: '→',
    ShiftLeft: 'Shift', ShiftRight: 'R-Shift', ControlLeft: 'Ctrl', ControlRight: 'R-Ctrl',
    AltLeft: 'Alt', AltRight: 'R-Alt', Space: 'Space', Enter: 'Enter', Backspace: 'Bksp',
    Escape: 'Esc', CapsLock: 'Caps', Tab: 'Tab',
  }
  return map[code] ?? code
}
