// src/net/client-session.ts — 클라: 입력 송신 + (자기/원격 공통) 로컬 시뮬레이션 + 스냅샷 보정.
// Transport 인터페이스에만 의존, PIXI 무관. 원격 스프라이트도 GostekPool이 렌더하려면 로컬
// gs에서 .active=true여야 하므로(host-session.ts 헤더의 "설계 결정 1" 참조), 원격도 매 틱
// updateFrame과 함께 굴리되 그 control은 최신 스냅샷의 릴레이 필드로 채운다("마지막 입력 재생").
// 자기 스프라이트는 매 틱 로컬 입력이 control을 덮어쓰므로 릴레이 값은 자동 무시된다.
import type { GameState } from '../core/state'
import type { Transport } from './types'
import {
  MSG, encodeInput, decodeSnapshot,
  type InputMsg, type SnapshotMsg,
} from './protocol'
import { createSprite, createTPlayer, HUMAN } from '../core/sprites'
import { updateFrame } from '../core/game'
import { vector2 } from '../core/vector'

const POS_CORRECTION_THRESHOLD = 8 // px — 스펙 §4.4 예시 임계
const POS_CORRECTION_ALPHA = 0.25 // 스냅샷마다 잔여오차의 25%씩 당김(지수 스무딩, 안 튐)
const INPUT_SEND_EVERY_N_TICKS = 2 // 60Hz 중 2틱마다 송신 ⇒ 30Hz

// 로컬 입력 소스가 매 틱 돌려주는 값(웹에서는 InputState.applyTo 결과, 테스트에서는 손으로 준비).
export type LocalInput = Omit<InputMsg, 'seq'>

export class ClientSession {
  myNum: number | null = null
  private seq = 0
  private tickCount = 0
  private known = new Set<number>() // 이미 로컬 createSprite()한 num들
  private myAccount: string

  constructor(
    private transport: Transport,
    public readonly gs: GameState,
    myAccount: string,
    private getLocalInput: () => LocalInput,
  ) {
    this.myAccount = myAccount
    transport.onMessage((event, payload) => {
      if (event === MSG.ASSIGN) {
        const a = payload as { account: string; num: number }
        if (a.account === this.myAccount) this.myNum = a.num
      } else if (event === MSG.SNAPSHOT) {
        this.applySnapshot(decodeSnapshot(payload as ArrayBuffer))
      }
    })
  }

  // 매 60Hz 프레임: 내 입력을 내 스프라이트 control에 적용 → (스로틀) 호스트로 송신 →
  // 로컬 gs 전체를 한 틱 전진(자기=신선한 로컬입력, 원격=최근 릴레이 유지).
  tick(): void {
    if (this.myNum !== null && this.gs.sprite[this.myNum].active) {
      const input = this.getLocalInput()
      const c = this.gs.sprite[this.myNum].control
      c.left = input.left; c.right = input.right; c.up = input.up; c.down = input.down
      c.fire = input.fire; c.jetpack = input.jetpack; c.throwNade = input.throwNade
      c.changeWeapon = input.changeWeapon; c.throwWeapon = input.throwWeapon
      c.reload = input.reload; c.prone = input.prone; c.flagThrow = input.flagThrow
      c.mouseAimX = input.mouseAimX; c.mouseAimY = input.mouseAimY
      this.tickCount++
      if (this.tickCount % INPUT_SEND_EVERY_N_TICKS === 0) {
        this.transport.send(MSG.INPUT, encodeInput({ seq: this.seq++, ...input }))
      }
    }
    updateFrame(this.gs)
  }

  private ensureLocalSprite(num: number, team: number, pos: { x: number; y: number }): void {
    if (this.known.has(num)) return
    this.known.add(num)
    const tPlayer = createTPlayer()
    tPlayer.team = team
    tPlayer.controlMethod = HUMAN
    // n=num 지정 — createSprite는 n!==255면 그 슬롯을 그대로 쓴다(sprites.ts:3912-3925) →
    // 호스트가 배정한 것과 정확히 같은 슬롯에 재현.
    createSprite(this.gs, vector2(pos.x, pos.y), vector2(0, 0), 1, num, tPlayer, true)
    this.gs.sprite[num].respawn()
  }

  private applySnapshot(msg: SnapshotMsg): void {
    for (const s of msg.sprites) {
      this.ensureLocalSprite(s.num, s.team, { x: s.posX, y: s.posY })
      const spr = this.gs.sprite[s.num]

      // 이산값(자주 안 바뀜) — 즉시 스냅.
      spr.player!.team = s.team
      spr.deadMeat = s.deadMeat
      spr.health = s.health
      spr.jetsCount = s.jetsCount
      spr.legsAnimation.id = s.legsAnimId
      spr.legsAnimation.currFrame = s.legsFrame
      spr.bodyAnimation.id = s.bodyAnimId
      spr.bodyAnimation.currFrame = s.bodyFrame

      // 컨트롤 릴레이 — 원격 스프라이트의 다음 몇 틱을 "재생"하는 소스. 자기 자신 항목도
      // 함께 오지만 tick()이 매번 로컬입력으로 즉시 덮어쓰므로 무해.
      if (s.num !== this.myNum) {
        const c = spr.control
        c.left = s.control.left; c.right = s.control.right; c.up = s.control.up; c.down = s.control.down
        c.fire = s.control.fire; c.jetpack = s.control.jetpack; c.throwNade = s.control.throwNade
        c.changeWeapon = s.control.changeWeapon; c.throwWeapon = s.control.throwWeapon
        c.reload = s.control.reload; c.prone = s.control.prone; c.flagThrow = s.control.flagThrow
        c.mouseAimX = s.control.mouseAimX; c.mouseAimY = s.control.mouseAimY
      }

      // 연속값(위치) — 임계 초과분의 일부만 당김(튐 방지). 속도는 호스트가 유일 권위 소스라 즉시 스냅.
      const pos = this.gs.spriteParts.pos[s.num]
      const ex = s.posX - pos.x
      const ey = s.posY - pos.y
      if (Math.hypot(ex, ey) > POS_CORRECTION_THRESHOLD) {
        pos.x += ex * POS_CORRECTION_ALPHA
        pos.y += ey * POS_CORRECTION_ALPHA
      }
      const vel = this.gs.spriteParts.velocity[s.num]
      vel.x = s.velX
      vel.y = s.velY
    }
  }
}
