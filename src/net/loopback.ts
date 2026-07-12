// src/net/loopback.ts — 인프로세스 목 릴레이. 배포/SDK 없이 N세션 연결.
import type { Transport, RoomState, RoomListing, MessageHandler } from './types'

interface Room {
  state: RoomState
  members: Set<LoopbackTransport>
}

export class LoopbackHub {
  private rooms = new Map<string, Room>()

  createTransport(account: string): Transport {
    return new LoopbackTransport(account, this)
  }

  /** @internal */ _room(key: string): Room {
    let r = this.rooms.get(key)
    if (!r) { r = { state: {} as RoomState, members: new Set() }; this.rooms.set(key, r) }
    return r
  }
  /** @internal */ _listings(): RoomListing[] {
    return [...this.rooms.entries()].map(([key, r]) => ({
      key, count: r.members.size,
      mode: (r.state.mode as number) ?? 0,
      started: (r.state.started as boolean) ?? false,
    }))
  }
}

class LoopbackTransport implements Transport {
  status: Transport['status'] = 'offline'
  private roomKey: string | null = null
  private msgHandler: MessageHandler = () => {}
  private stateHandler: (s: RoomState) => void = () => {}
  constructor(readonly account: string, private hub: LoopbackHub) {}

  async connect() { this.status = 'online'; return this.status }
  async listRooms() { return (this.hub as any)._listings() as RoomListing[] }

  async joinRoom(key: string) {
    const r = (this.hub as any)._room(key) as Room
    r.members.add(this); this.roomKey = key
    this.stateHandler({ ...r.state })
  }
  async leaveRoom() {
    if (!this.roomKey) return
    const r = (this.hub as any)._room(this.roomKey) as Room
    r.members.delete(this); this.roomKey = null
  }
  async getRoomState() {
    if (!this.roomKey) return {} as RoomState
    return { ...(this.hub as any)._room(this.roomKey).state }
  }
  async updateRoomState(patch: Record<string, unknown>) {
    if (!this.roomKey) return
    const r = (this.hub as any)._room(this.roomKey) as Room
    for (const [k, v] of Object.entries(patch)) {
      if (v === null) delete (r.state as any)[k]
      else (r.state as any)[k] = v
    }
    for (const m of r.members) (m as LoopbackTransport).stateHandler({ ...r.state })
  }
  send(event: string, payload: unknown) {
    if (!this.roomKey) return
    const r = (this.hub as any)._room(this.roomKey) as Room
    for (const m of r.members) {
      if (m === this) continue // 발신자 제외 (agent8 broadcastToRoom 관례와 정합 — 로컬 예측이 자기건 이미 처리)
      queueMicrotask(() => (m as LoopbackTransport).msgHandler(event, payload, this.account))
    }
  }
  onMessage(h: MessageHandler) { this.msgHandler = h }
  onRoomState(h: (s: RoomState) => void) { this.stateHandler = h }
}
