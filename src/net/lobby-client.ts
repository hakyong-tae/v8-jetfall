// src/net/lobby-client.ts — Transport 위 로비 상태머신. UI 무관.
import type { Transport, RoomState, RoomPlayer, RoomListing } from './types'
import { MSG } from './protocol'
import { TEAM_NONE } from '../core/constants'

export class LobbyClient {
  roomState: RoomState = {} as RoomState
  private startHandler: () => void = () => {}
  private changeHandler: () => void = () => {}
  private nowFn: () => number
  constructor(private transport: Transport, public nick: string, nowFn: () => number = () => Date.now()) {
    this.nowFn = nowFn
    transport.onRoomState((s) => { this.roomState = s; this.changeHandler() })
    transport.onMessage((event) => { if (event === MSG.START) this.startHandler() })
  }
  get account() { return this.transport.account }
  get net(): Transport { return this.transport } // B단계 웹배선: 인게임 세션이 transport 직접 접근
  get isHost() { return this.roomState.hostAccount === this.account }
  get players(): Record<string, RoomPlayer> {
    const out: Record<string, RoomPlayer> = {}
    for (const [k, v] of Object.entries(this.roomState)) if (k.startsWith('p_')) out[k.slice(2)] = v as RoomPlayer
    return out
  }
  async connect() { return this.transport.connect() }
  async listRooms(): Promise<RoomListing[]> { return this.transport.listRooms() }

  private me(): RoomPlayer {
    return { nick: this.nick, team: TEAM_NONE, ready: false, kills: 0, deaths: 0, joinedAt: this.nowFn() }
  }
  async createRoom(key: string, mode: number) {
    await this.transport.joinRoom(key)
    await this.transport.updateRoomState({
      mode, hostAccount: this.account, started: false, roundEndsAt: 0,
      ['p_' + this.account]: this.me(),
    })
    this.roomState = await this.transport.getRoomState()
  }
  async joinRoom(key: string) {
    await this.transport.joinRoom(key)
    await this.transport.updateRoomState({ ['p_' + this.account]: this.me() })
    this.roomState = await this.transport.getRoomState()
  }
  async selectTeam(team: number) {
    const p = this.players[this.account] ?? this.me()
    await this.transport.updateRoomState({ ['p_' + this.account]: { ...p, team } })
  }
  async setReady(ready: boolean) {
    const p = this.players[this.account] ?? this.me()
    await this.transport.updateRoomState({ ['p_' + this.account]: { ...p, ready } })
  }
  async start() {
    if (!this.isHost) throw new Error('only host can start')
    await this.transport.updateRoomState({ started: true, roundEndsAt: this.nowFn() + 5 * 60 * 1000 })
    this.transport.send(MSG.START, {})
    this.startHandler() // 호스트 자신도 시작
  }
  async leave() { await this.transport.leaveRoom() }
  onStart(cb: () => void) { this.startHandler = cb }
  onChange(cb: () => void) { this.changeHandler = cb }
}
