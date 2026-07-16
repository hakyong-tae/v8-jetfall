// src/net/lobby-client.ts — Transport 위 로비 상태머신. UI 무관.
import type { Transport, RoomState, RoomPlayer, RoomListing } from './types'
import { MSG } from './protocol'
import { TEAM_NONE } from '../core/constants'
import { defaultRoomSettings, mergeRoomSettings, type RoomSettings } from './room-settings'

export class LobbyClient {
  roomState: RoomState = {} as RoomState
  roomKey: string | null = null // M3-E: 재접속 rejoin용 — createRoom/joinRoom에서 세팅
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
    this.roomKey = key // M3-E
    await this.transport.joinRoom(key)
    await this.transport.updateRoomState({
      mode, hostAccount: this.account, started: false, roundEndsAt: 0,
      settings: defaultRoomSettings(mode), // M8: 방 상세설정 기본값
      ['p_' + this.account]: this.me(),
    })
    this.roomState = await this.transport.getRoomState()
  }
  async joinRoom(key: string) {
    this.roomKey = key // M3-E
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
  // M8: 현재 방 설정(검증/기본값 병합 완료본). settings 없는 옛 방도 기본값으로 안전.
  get settings(): RoomSettings {
    return mergeRoomSettings(this.roomState.settings)
  }
  // M8: 방장 전용 설정 갱신 — 현재 설정에 patch를 얕은 병합해 roomState.settings로 통째 기록.
  // (호스트 강제는 UI 측 — 비방장 패널은 읽기전용이라 호출 경로가 없다. 클라 단순성 우선.)
  async updateSettings(patch: Partial<RoomSettings>) {
    const merged = { ...this.settings, ...patch }
    await this.transport.updateRoomState({ settings: merged })
  }
  // M8: eligibleMapKeys — mapKey==='random'일 때 호스트가 확정 키로 해석할 후보 풀
  // (manifest는 UI 계층 소유라 호출자가 넘긴다). 해석된 settings를 started:true와 한 번의
  // updateRoomState로 기록 → 클라는 시작 시점에 settings를 읽으므로 전원이 같은 맵을 로드한다
  // (M5 이후 각자 랜덤 맵을 뽑던 디싱크 수정의 핵심).
  async start(eligibleMapKeys?: string[]) {
    if (!this.isHost) throw new Error('only host can start')
    const settings = this.settings
    if (settings.mapKey === 'random' && eligibleMapKeys && eligibleMapKeys.length > 0) {
      settings.mapKey = eligibleMapKeys[Math.floor(Math.random() * eligibleMapKeys.length)]
    }
    await this.transport.updateRoomState({
      settings, started: true, roundEndsAt: this.nowFn() + 5 * 60 * 1000,
    })
    // 호스트 자신의 roomState에도 즉시 반영 — 실 agent8은 onRoomState 에코가 늦을 수 있는데,
    // main.ts가 시작 직후 roomState.settings를 읽으므로 낙관 반영 없이는 호스트만 'random'을
    // 다시 뽑아 디싱크가 재발한다.
    this.roomState = { ...this.roomState, settings, started: true }
    this.transport.send(MSG.START, {})
    this.startHandler() // 호스트 자신도 시작
  }
  async leave() { await this.transport.leaveRoom() }
  onStart(cb: () => void) { this.startHandler = cb }
  onChange(cb: () => void) { this.changeHandler = cb }
}
