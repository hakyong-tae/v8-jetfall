// src/net/room-settings.ts — M8: 멀티 방 상세설정 모델 (roomState.settings).
// 스펙: docs/superpowers/specs/2026-07-16-m8-room-settings-design.md
// 코어 무수정 원칙 — 여기의 applyMatchSettings가 기존 코어 필드(svKilllimit/svTimelimit/
// timeLimitCounter/weaponActive/svRespawntime)에 값만 흘려 넣는다.
import type { GameState } from '../core/state'
import { PRIMARY_WEAPONS, MAIN_WEAPONS } from '../core/weapons'

// 무제한 시간 마커. 코어 game.ts:161-165는 timeLimitCounter를 매 틱 감소시키고 ===1에서
// nextMap을 부른다 — 99999999틱(60Hz ≈ 19일)이면 사실상 무한. nextMap의 라운드 리셋이
// timeLimitCounter = svTimelimit로 재무장하므로(game.ts:470) svTimelimit도 같은 값으로 둬야
// 리셋 후에도 무제한이 유지된다.
export const UNLIMITED_TIME = 99999999

export interface RoomSettings {
  mapKey: string          // manifest.maps 키 또는 'random' (매치 시작 시 호스트가 확정 키로 해석)
  weaponActive: number[]  // 14슬롯 0/1 — index 0..9 주무기, 10..13 보조 (gs.weaponActive[1..14]에 대응)
  respawnSeconds: number  // 0/2/4/6/8/10
  killLimit: number       // DM 킬수 / CTF 캡처수 (gs.svKilllimit 공용)
  timeLimitMin: number    // 분. 0 = 무제한
}

export function defaultRoomSettings(_mode?: number): RoomSettings {
  return {
    mapKey: 'random',
    weaponActive: new Array<number>(MAIN_WEAPONS).fill(1),
    respawnSeconds: 6,
    killLimit: 10,
    timeLimitMin: 10,
  }
}

// roomState.settings는 신뢰할 수 없는 JSON(구버전 방·부분 패치) — 필드별 검증 후 기본값 폴백.
// settings 없는 옛 방에서도 절대 throw 하지 않는다.
export function mergeRoomSettings(raw?: unknown): RoomSettings {
  const d = defaultRoomSettings()
  if (raw == null || typeof raw !== 'object') return d
  const r = raw as Partial<RoomSettings>
  const num = (v: unknown, fallback: number, min: number): number =>
    typeof v === 'number' && Number.isFinite(v) && v >= min ? v : fallback
  return {
    mapKey: typeof r.mapKey === 'string' && r.mapKey !== '' ? r.mapKey : d.mapKey,
    weaponActive:
      Array.isArray(r.weaponActive) && r.weaponActive.length === MAIN_WEAPONS
        ? r.weaponActive.map((v) => (v === 0 ? 0 : 1))
        : d.weaponActive,
    respawnSeconds: num(r.respawnSeconds, d.respawnSeconds, 0),
    killLimit: num(r.killLimit, d.killLimit, 1),
    timeLimitMin: num(r.timeLimitMin, d.timeLimitMin, 0),
  }
}

// 무기 토글 가드 — 그룹(주무기 0..9 / 보조 10..13)마다 최소 1종은 켜져 있어야 한다.
// index는 settings.weaponActive의 0-based 인덱스. 이미 꺼진 슬롯(켜기)은 항상 허용.
export function canDisableWeapon(weaponActive: number[], index: number): boolean {
  if (weaponActive[index] !== 1) return true // 켜는 방향은 가드 대상 아님
  const isPrimary = index < PRIMARY_WEAPONS
  const start = isPrimary ? 0 : PRIMARY_WEAPONS
  const end = isPrimary ? PRIMARY_WEAPONS : MAIN_WEAPONS
  let enabled = 0
  for (let i = start; i < end; i++) if (weaponActive[i] === 1) enabled++
  return enabled > 1
}

// 매치 시작 시 설정 → 코어 필드 반영 (호스트/클라 동일 경로에서 호출 → 자동으로 같은 세팅).
// raw는 roomState.settings 그대로 받아도 된다(내부에서 merge/검증 — 부분/누락 안전).
// 주의(기존 잠복버그): state.ts 기본 timeLimitCounter=3600(=60초)이라, 여기서 반드시
// timeLimitCounter = svTimelimit로 재무장해야 1분 만에 nextMap이 도는 걸 막는다.
export function applyMatchSettings(gs: GameState, raw?: unknown): void {
  const s = mergeRoomSettings(raw)
  // 방어적 복사 + 0/1 클램프. gs.weaponActive[0]은 Pascal zero-init 규약(0) — 건드리지 않는다.
  for (let w = 1; w <= MAIN_WEAPONS; w++) gs.weaponActive[w] = s.weaponActive[w - 1] === 0 ? 0 : 1
  gs.svKilllimit = s.killLimit
  if (s.timeLimitMin <= 0) {
    gs.svTimelimit = UNLIMITED_TIME
    gs.timeLimitCounter = UNLIMITED_TIME
  } else {
    gs.svTimelimit = s.timeLimitMin * 60 * 60 // 분 → 틱 (60틱/s)
    gs.timeLimitCounter = gs.svTimelimit
  }
  gs.svRespawntime = Math.round(s.respawnSeconds * 60) // 초 → 틱
}
