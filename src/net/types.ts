// src/net/types.ts — 넷 계층 공유 계약. 코어/agent8 구체 API에 의존하지 않는다.

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
  joinRoom(roomKey: string): Promise<void>       // 없으면 생성
  leaveRoom(): Promise<void>
  getRoomState(): Promise<RoomState>
  updateRoomState(patch: Record<string, unknown>): Promise<void>  // 얕은병합, null=삭제
  send(event: string, payload: unknown): void    // broadcastToRoom 릴레이
  onMessage(handler: MessageHandler): void
  onRoomState(handler: (s: RoomState) => void): void
}
