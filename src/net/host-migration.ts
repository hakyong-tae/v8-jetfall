// src/net/host-migration.ts — 브라우저-호스트 마이그레이션 판단(스펙 §6-E, §3.1 모드② 전용).
// 순수함수 위주 — PIXI/main.ts 의존 없음. 전용 Node 호스트(모드①)는 대상 아님("마이그레이션 X").
import type { RoomPlayer } from './types'

export const HOST_TIMEOUT_MS = 3000 // 스냅샷 30Hz 기준 ~90회 연속 미수신 — 탭 스로틀 오탐 방지

// null 반환은 오직 "호출자 자신도 아직 players에 없음"(부기 엣지케이스)뿐 — "나 혼자 남음"은
// 별도 분기 없이 자연스럽게 나 자신이 선출된다(§설계결정4).
export function electHost(players: Record<string, RoomPlayer>, excludeAccount: string): string | null {
  const candidates = Object.entries(players).filter(([acc]) => acc !== excludeAccount)
  if (candidates.length === 0) return null
  candidates.sort(([a1, a], [b1, b]) => (a.joinedAt - b.joinedAt) || (a1 < b1 ? -1 : a1 > b1 ? 1 : 0))
  return candidates[0][0]
}

export type MigrationAction = 'none' | 'promote' | 'wait'
export interface MigrationDeps {
  getPlayers: () => Record<string, RoomPlayer>
  myAccount: string
  currentHostAccount: string
  nowFn?: () => number
}

export function decideMigration(lastSnapshotAt: number, deps: MigrationDeps): MigrationAction {
  if (lastSnapshotAt === 0) return 'none'
  const now = (deps.nowFn ?? Date.now)()
  if (now - lastSnapshotAt < HOST_TIMEOUT_MS) return 'none'
  const elected = electHost(deps.getPlayers(), deps.currentHostAccount)
  if (elected === null) return 'none'
  return elected === deps.myAccount ? 'promote' : 'wait'
}
