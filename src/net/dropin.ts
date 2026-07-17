// src/net/dropin.ts — M9 난입(drop-in) 순수 헬퍼. UI/전송 무관 — lobby-ui(렌더)와
// 테스트가 공유한다(스펙 §만들 것 1·2).
import type { RoomPlayer } from './types'
import { TEAM_ALPHA, TEAM_BRAVO } from '../core/constants'

// 방 정원 — server.js CAP=8과 동일 규약(HostSession spawnPlayers 주석 참조).
export const ROOM_CAP = 8

// 정원 게이트 — 진행중 여부와 무관하게 자리만 있으면 Join 가능(M9 핵심 규칙).
export function canJoinRoom(count: number): boolean {
  return count < ROOM_CAP
}

// CTF 난입자 자동 팀배정 — room 화면(팀 선택 UI)을 안 거치므로 인원 적은 팀에 배정.
// 스펙테이터/무팀은 집계 제외, 동수면 TEAM_ALPHA.
export function pickAutoTeam(players: Record<string, RoomPlayer>): number {
  let alpha = 0
  let bravo = 0
  for (const p of Object.values(players)) {
    if (p.team === TEAM_ALPHA) alpha++
    else if (p.team === TEAM_BRAVO) bravo++
  }
  return bravo < alpha ? TEAM_BRAVO : TEAM_ALPHA
}
