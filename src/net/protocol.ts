// src/net/protocol.ts — 넷 메시지 종류. B단계에서 INPUT/SNAPSHOT 바이너리 (역)직렬화 추가.
export const MSG = {
  INPUT: 'input',   // 클라→호스트: control 비트마스크 + mouseAim (B단계)
  SNAPSHOT: 'snap', // 호스트→전체: 병사 상태 배열 (B단계)
  BULLET: 'bul',    // 호스트→전체: 탄환 생성 이벤트 (C단계)
  KILL: 'kill',     // 호스트→전체: killer/victim/weapon (C단계)
  START: 'start',   // 호스트→전체: 매치 시작 (A단계에서 종류만 예약)
} as const

export type MsgKind = (typeof MSG)[keyof typeof MSG]

const KNOWN = new Set<string>(Object.values(MSG))
export function isMsg(k: string): k is MsgKind {
  return KNOWN.has(k)
}
