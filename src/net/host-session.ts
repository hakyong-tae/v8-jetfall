// src/net/host-session.ts — 호스트권위 이동 시뮬 루프. Transport 인터페이스에만 의존
// (agent8 구체 API 아님) → loopback으로 완전 테스트 가능. 코어(src/core/*) 무수정,
// 이미 로드된 GameState(맵/애니/무기 세팅 완료)를 받아 그 위에서만 동작한다.
// Node 헤드리스(server/host.ts, D단계)와 브라우저-호스트(main.ts, 이번 단계) 양쪽에서 재사용.
import type { GameState } from '../core/state'
import type { Transport } from './types'
import { MSG, encodeSnapshot, decodeInput, type InputMsg, type SnapshotSprite } from './protocol'
import { createSprite, createTPlayer, HUMAN } from '../core/sprites'
import { randomizeStart } from '../core/things'
import { guns, AK74 } from '../core/weapons'
import { updateFrame } from '../core/game'
import { vector2 } from '../core/vector'

export interface HostSessionPlayer { account: string; team: number }

// 60Hz 틱 중 2틱마다 브로드캐스트 ⇒ 30Hz (스펙 §4.2 "~20-30Hz" 범위 내).
const SNAPSHOT_EVERY_N_TICKS = 2

export class HostSession {
  private slotOf = new Map<string, number>() // account → 스프라이트 num
  private lastInput = new Map<string, InputMsg>() // account → 최신 수신 입력(누적 아님, 최신값만)
  private lastAppliedSeq = new Map<number, number>() // sprite num → 마지막 적용 seq
  private tickCount = 0

  constructor(private transport: Transport, public readonly gs: GameState) {
    transport.onMessage((event, _payload, from) => {
      if (event !== MSG.INPUT) return
      this.lastInput.set(from, decodeInput(_payload as ArrayBuffer))
    })
  }

  // 매치 시작 시 1회 — 룸의 전 플레이어에게 스프라이트 배정(슬롯 번호는 createSprite가 빈 슬롯
  // 중 하나를 고르므로 호출 순서가 배정 순서). addBotPlayer 패턴(randomizeStart→createSprite→
  // 무기지급→respawn) 재사용, controlMethod만 BOT 대신 HUMAN.
  spawnPlayers(players: HostSessionPlayer[]): void {
    for (const p of players) {
      const tPlayer = createTPlayer()
      tPlayer.team = p.team
      tPlayer.controlMethod = HUMAN
      const r = randomizeStart(this.gs, p.team)
      const num = createSprite(this.gs, r.start, vector2(0, 0), 1, 255, tPlayer, true)
      if (num < 0) continue // 서버 만원(MAX_SPRITES) — 호출자가 CAP=8로 사전 제한(server.js와 동일 규약)
      this.gs.sprite[num].selWeapon = guns[AK74].num
      this.gs.sprite[num].player!.secWep = 0
      this.gs.sprite[num].respawn()
      this.slotOf.set(p.account, num)
      this.transport.send(MSG.ASSIGN, { account: p.account, num })
    }
    this.gs.sortPlayers?.()
  }

  spriteNumOf(account: string): number | undefined {
    return this.slotOf.get(account)
  }

  // 한 틱 전진: 최신 입력 적용 → updateFrame → (2틱마다) 스냅샷 브로드캐스트.
  // 순수 스텝 함수 — 헤드리스 테스트는 이걸 직접 반복 호출(결정론적), 실 구동(Node
  // setInterval/브라우저 rAF)은 startLoop()가 감싼다.
  //
  // 주의(브라우저-호스트 모드): 호스트 자신의 계정은 스스로에게 네트워크 메시지를 보내지 않으므로
  // lastInput에 절대 나타나지 않는다 — 즉 호스트 자신의 스프라이트 control은 이 메서드가 절대
  // 건드리지 않는다. main.ts의 렌더 루프가 tick() 호출 "직전"에 로컬 입력을 그 스프라이트의
  // control에 직접 써넣으면 된다(별도 분기 불필요, §웹 배선 참조).
  tick(): void {
    for (const [account, input] of this.lastInput) {
      const num = this.slotOf.get(account)
      if (num === undefined) continue
      const c = this.gs.sprite[num].control
      c.left = input.left; c.right = input.right; c.up = input.up; c.down = input.down
      c.fire = input.fire; c.jetpack = input.jetpack; c.throwNade = input.throwNade
      c.changeWeapon = input.changeWeapon; c.throwWeapon = input.throwWeapon
      c.reload = input.reload; c.prone = input.prone; c.flagThrow = input.flagThrow
      c.mouseAimX = input.mouseAimX; c.mouseAimY = input.mouseAimY
      this.lastAppliedSeq.set(num, input.seq)
    }
    updateFrame(this.gs)
    this.tickCount++
    if (this.tickCount % SNAPSHOT_EVERY_N_TICKS === 0) this.broadcastSnapshot()
  }

  private broadcastSnapshot(): void {
    const sprites: SnapshotSprite[] = []
    for (const num of this.slotOf.values()) {
      const spr = this.gs.sprite[num]
      if (!spr.active) continue
      sprites.push({
        num,
        team: spr.player!.team,
        direction: spr.direction,
        deadMeat: spr.deadMeat,
        health: spr.health,
        jetsCount: spr.jetsCount,
        legsAnimId: spr.legsAnimation.id,
        legsFrame: spr.legsAnimation.currFrame,
        bodyAnimId: spr.bodyAnimation.id,
        bodyFrame: spr.bodyAnimation.currFrame,
        lastInputSeq: this.lastAppliedSeq.get(num) ?? 0,
        posX: this.gs.spriteParts.pos[num].x,
        posY: this.gs.spriteParts.pos[num].y,
        velX: this.gs.spriteParts.velocity[num].x,
        velY: this.gs.spriteParts.velocity[num].y,
        control: {
          left: spr.control.left, right: spr.control.right, up: spr.control.up, down: spr.control.down,
          fire: spr.control.fire, jetpack: spr.control.jetpack, throwNade: spr.control.throwNade,
          changeWeapon: spr.control.changeWeapon, throwWeapon: spr.control.throwWeapon,
          reload: spr.control.reload, prone: spr.control.prone, flagThrow: spr.control.flagThrow,
          mouseAimX: spr.control.mouseAimX, mouseAimY: spr.control.mouseAimY,
        },
      })
    }
    this.transport.send(MSG.SNAPSHOT, encodeSnapshot({ tick: this.gs.ticks, sprites }))
  }

  // 실 구동용 — 테스트는 tick()을 직접 반복 호출하므로 미사용. 반환값은 정지 함수.
  startLoop(intervalMs = 1000 / 60): () => void {
    const h = setInterval(() => this.tick(), intervalMs)
    return () => clearInterval(h)
  }
}
