// src/net/client-session.ts — 클라: 입력 송신 + (자기/원격 공통) 로컬 시뮬레이션 + 스냅샷 보정.
// Transport 인터페이스에만 의존, PIXI 무관. 원격 스프라이트도 GostekPool이 렌더하려면 로컬
// gs에서 .active=true여야 하므로(host-session.ts 헤더의 "설계 결정 1" 참조), 원격도 매 틱
// updateFrame과 함께 굴리되 그 control은 최신 스냅샷의 릴레이 필드로 채운다("마지막 입력 재생").
// 자기 스프라이트는 매 틱 로컬 입력이 control을 덮어쓰므로 릴레이 값은 자동 무시된다.
import type { GameState } from '../core/state'
import type { Transport } from './types'
import {
  MSG, encodeInput, decodeSnapshot, decodeBullet,
  type InputMsg, type SnapshotMsg, type BulletMsg, type KillMsg, type FlagState,
} from './protocol'
import { createSprite, createTPlayer, HUMAN, MAX_THINGS } from '../core/sprites'
import { weaponNumToIndex } from '../core/weapons'
import { createBullet } from '../core/bullets'
import { createThing } from '../core/things'
import { updateFrame } from '../core/game'
import { vector2 } from '../core/vector'

const POS_CORRECTION_THRESHOLD = 8 // px — 스펙 §4.4 예시 임계
const POS_CORRECTION_ALPHA = 0.25 // 스냅샷마다 잔여오차의 25%씩 당김(지수 스무딩, 안 튐)
const INPUT_SEND_EVERY_N_TICKS = 2 // 60Hz 중 2틱마다 송신 ⇒ 30Hz

// 로컬 입력 소스가 매 틱 돌려주는 값(웹에서는 InputState.applyTo 결과, 테스트에서는 손으로 준비).
export type LocalInput = Omit<InputMsg, 'seq'>

export class ClientSession {
  myNum: number | null = null
  killFeed: KillMsg[] = [] // C단계 — HUD가 읽는 킬피드 큐(트랜지언트, 스코어 진실 아님)
  lastSnapshotAt = 0 // M3-E: 0=아직 미수신(마이그레이션 판단 보류, §설계결정3)
  knownSlots = new Map<string, number>() // M3-E: account→num 전원 기록(승격 seed, §설계결정2)

  private seq = 0
  private tickCount = 0
  private known = new Set<number>() // 이미 로컬 createSprite()한 num들
  private myAccount: string
  private prevDeadMeat = new Map<number, boolean>() // C단계 — 리스폰 즉시스냅 감지(설계 결정 5)
  private knownFlagSlot = new Map<number, number>() // C단계 — style → 현재 채택된 thingNum(설계 결정 4)

  constructor(
    private transport: Transport,
    public readonly gs: GameState,
    myAccount: string,
    private getLocalInput: () => LocalInput,
    private nowFn: () => number = () => Date.now(), // M3-E: 테스트 가짜시계
  ) {
    this.myAccount = myAccount
    transport.onMessage((event, payload) => {
      if (event === MSG.ASSIGN) {
        const a = payload as { account: string; num: number }
        this.knownSlots.set(a.account, a.num) // M3-E: 기존엔 자기 것만 봤음
        if (a.account === this.myAccount) this.myNum = a.num
      } else if (event === MSG.SNAPSHOT) {
        this.lastSnapshotAt = this.nowFn() // M3-E
        this.applySnapshot(decodeSnapshot(payload as ArrayBuffer))
      } else if (event === MSG.BULLET) {
        this.spawnRemoteBullet(decodeBullet(payload as ArrayBuffer))
      } else if (event === MSG.KILL) {
        this.killFeed.push(payload as KillMsg)
        if (this.killFeed.length > 20) this.killFeed.shift()
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
      c.fire = false // ← 설계 결정 2: 로컬 공유심에선 항상 억제. 호스트로는 아래에서 실값 전송.
      c.jetpack = input.jetpack; c.throwNade = input.throwNade
      c.changeWeapon = input.changeWeapon; c.throwWeapon = input.throwWeapon
      c.reload = input.reload; c.prone = input.prone; c.flagThrow = input.flagThrow
      c.mouseAimX = input.mouseAimX; c.mouseAimY = input.mouseAimY
      this.tickCount++
      if (this.tickCount % INPUT_SEND_EVERY_N_TICKS === 0) {
        this.transport.send(MSG.INPUT, encodeInput({ seq: this.seq++, ...input })) // 원본 input.fire 그대로 전송
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

  // ── 설계 결정 1/2 대응: BULLET 이벤트가 로컬 탄환 생성의 유일한 경로 ──────
  private spawnRemoteBullet(m: BulletMsg): void {
    createBullet(
      this.gs, vector2(m.posX, m.posY), vector2(m.velX, m.velY),
      m.weaponNum, m.owner, 255, m.hitMultiply, true, false, m.seed,
    )
  }

  // ── 설계 결정 4: 깃발 팬텀 정리 + 권위 슬롯 채택 ─────────────────────────
  private ensureFlagSynced(f: FlagState): void {
    if (f.thingNum === 0) return // 호스트가 아직 스폰 안 함(자동생성 대기 중)
    if (this.knownFlagSlot.get(f.style) !== f.thingNum) {
      for (let i = 1; i <= MAX_THINGS; i++) {
        if (this.gs.thing[i].active && this.gs.thing[i].style === f.style && i !== f.thingNum) {
          this.gs.thing[i].kill() // 로컬 공유심이 자체 자동생성한 팬텀(또는 이전 슬롯) 제거
        }
      }
      if (!this.gs.thing[f.thingNum].active) {
        createThing(this.gs, vector2(f.posX, f.posY), 255, f.style, f.thingNum)
      }
      this.knownFlagSlot.set(f.style, f.thingNum)
    }
    const t = this.gs.thing[f.thingNum]
    t.holdingSprite = f.holdingSprite
    t.skeleton.pos[1].x = f.posX
    t.skeleton.pos[1].y = f.posY
  }

  private applySnapshot(msg: SnapshotMsg): void {
    this.gs.teamScore[1] = msg.teamScore1 // 설계 결정 3: 스코어 진실은 항상 스냅샷이 덮어씀
    this.gs.teamScore[2] = msg.teamScore2

    for (const s of msg.sprites) {
      this.ensureLocalSprite(s.num, s.team, { x: s.posX, y: s.posY })
      const spr = this.gs.sprite[s.num]

      // 이산값(자주 안 바뀜) — 즉시 스냅.
      spr.player!.team = s.team
      spr.health = s.health
      spr.jetsCount = s.jetsCount
      spr.legsAnimation.id = s.legsAnimId
      spr.legsAnimation.currFrame = s.legsFrame
      spr.bodyAnimation.id = s.bodyAnimId
      spr.bodyAnimation.currFrame = s.bodyFrame
      spr.player!.kills = s.kills   // C단계: 호스트 진실값으로 덮어쓰기
      spr.player!.deaths = s.deaths

      // 컨트롤 릴레이 — 원격 스프라이트의 다음 몇 틱을 "재생"하는 소스. 자기 자신 항목도
      // 함께 오지만 tick()이 매번 로컬입력으로 즉시 덮어쓰므로 무해.
      if (s.num !== this.myNum) {
        const c = spr.control
        c.left = s.control.left; c.right = s.control.right; c.up = s.control.up; c.down = s.control.down
        c.fire = false // ← 설계 결정 2: 원격 스프라이트도 항상 억제(다른 필드는 그대로 릴레이)
        c.jetpack = s.control.jetpack; c.throwNade = s.control.throwNade
        c.changeWeapon = s.control.changeWeapon; c.throwWeapon = s.control.throwWeapon
        c.reload = s.control.reload; c.prone = s.control.prone; c.flagThrow = s.control.flagThrow
        c.mouseAimX = s.control.mouseAimX; c.mouseAimY = s.control.mouseAimY

        // 무기 로드아웃 동기화(코스메틱) — 지연생성된 원격 병사는 respawn()이 selWeapon=0으로
        // 빈총을 쥐어주므로, 호스트가 실은 weaponNum으로 gostek이 그릴 spr.weapon을 맞춘다.
        // 변경시에만 적용(매 스냅샷 재적용하면 guns[] 깊은복사로 탄약/장전 진행이 리셋됨).
        // guns[]에 없는 num(-1 인덱스)은 스킵 — 무기 미적재 환경에서 spr.weapon 파손 방지.
        if (spr.weapon.num !== s.weaponNum && weaponNumToIndex(s.weaponNum) !== -1) {
          spr.applyWeaponByNum(s.weaponNum, 1)
        }
      }

      // ── 설계 결정 5: 리스폰(deadMeat true→false) 즉시 스냅 ──
      const wasDeadMeat = this.prevDeadMeat.get(s.num) ?? s.deadMeat
      const justRespawned = wasDeadMeat && !s.deadMeat
      spr.deadMeat = s.deadMeat
      this.prevDeadMeat.set(s.num, s.deadMeat)

      // 연속값(위치) — 임계 초과분의 일부만 당김(튐 방지). 속도는 호스트가 유일 권위 소스라 즉시 스냅.
      const pos = this.gs.spriteParts.pos[s.num]
      if (justRespawned) {
        pos.x = s.posX
        pos.y = s.posY
      } else {
        const ex = s.posX - pos.x
        const ey = s.posY - pos.y
        if (Math.hypot(ex, ey) > POS_CORRECTION_THRESHOLD) {
          pos.x += ex * POS_CORRECTION_ALPHA
          pos.y += ey * POS_CORRECTION_ALPHA
        }
      }
      const vel = this.gs.spriteParts.velocity[s.num]
      vel.x = s.velX
      vel.y = s.velY
    }

    for (const f of msg.flags ?? []) this.ensureFlagSynced(f) // C단계
  }
}
