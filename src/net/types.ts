// src/net/types.ts — 넷 계층 공유 계약. 코어/agent8 구체 API에 의존하지 않는다.
// (RoomSettings는 type-only import — 런타임 의존 없음.)
import type { RoomSettings } from './room-settings'

// 룸 참가자 (agent8 룸상태 p_{account} 값)
export interface RoomPlayer {
  nick: string
  team: number       // constants.ts TEAM_NONE/ALPHA/BRAVO/SPECTATOR
  ready: boolean
  kills: number
  deaths: number
  joinedAt: number
}

// 룸 전체 상태 (agent8 룸상태 — flat key 규약: p_{account} + 스칼라)
export interface RoomState {
  mode: number       // GAMESTYLE_DEATHMATCH | GAMESTYLE_CTF
  hostAccount: string
  started: boolean
  roundEndsAt: number
  dedicatedHostUrl?: string // D단계: 플랜B(자체ws) 전용호스트의 공개 ws URL. agent8-in-node 모드면 미설정.
  hostEpoch?: number // M3-E: 호스트 승격 세대(스플릿브레인 강등 판단용, 마이그레이션 시 +1). 옵셔널 하위호환.
  settings?: RoomSettings // M8: 방 상세설정(맵/무기/리스폰/킬·시간제한). 옵셔널 하위호환 — 소비 측은 mergeRoomSettings 경유.
  [playerKey: string]: unknown  // 'p_{account}' → RoomPlayer
}

// 로비 룸 목록 항목 (soldat_rooms 컬렉션)
export interface RoomListing {
  key: string
  count: number
  mode: number
  started: boolean
}

// 브로드캐스트 메시지 핸들러
export type MessageHandler = (event: string, payload: unknown, fromAccount: string) => void

// 전송 계층 인터페이스 — transport.ts(실 agent8)와 loopback.ts(목)가 모두 구현.
// 세션 코드는 이 인터페이스에만 의존한다.
export interface Transport {
  readonly account: string
  readonly status: 'offline' | 'connecting' | 'online'
  connect(): Promise<Transport['status']>
  listRooms(): Promise<RoomListing[]>
  joinRoom(roomKey: string, mode?: number): Promise<void> // 없으면 생성. mode는 목록 표기용(서버 컬렉션)
  // 방 목록(soldat_rooms 컬렉션) upsert 하트비트 — 실 릴레이에서 컬렉션 쓰기가 조용히 실패해
  // 다른 브라우저에 방이 안 보이는 사고의 자가치유. 옵셔널(loopback/ws 등 목록 없는 전송은 미구현).
  touchRoom?(roomKey: string, mode: number, started: boolean): Promise<void>
  leaveRoom(): Promise<void>
  getRoomState(): Promise<RoomState>
  updateRoomState(patch: Record<string, unknown>): Promise<void>  // 얕은병합, null=삭제
  // broadcastToRoom 릴레이. hot=true는 고빈도 latest-wins(스냅샷/입력) — agent8 호출 캡을
  // 넘지 않게 별도 throttle 함수로 나가고 초과분은 드롭돼도 무방. 미지정=신뢰성 이벤트(탄환/킬 등).
  send(event: string, payload: unknown, hot?: boolean): void
  onMessage(handler: MessageHandler): void
  onRoomState(handler: (s: RoomState) => void): void
  // 릴레이 왕복시간(ms) 측정 — 스코어보드 핑 표시용. 옵셔널(loopback 등은 미구현 → 0 취급).
  ping?(): Promise<number>
}
