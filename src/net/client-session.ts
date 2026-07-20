// src/net/client-session.ts — 클라: 입력 송신 + (자기/원격 공통) 로컬 시뮬레이션 + 스냅샷 보정.
// Transport 인터페이스에만 의존, PIXI 무관. 원격 스프라이트도 GostekPool이 렌더하려면 로컬
// gs에서 .active=true여야 하므로(host-session.ts 헤더의 "설계 결정 1" 참조), 원격도 매 틱
// updateFrame과 함께 굴리되 그 control은 최신 스냅샷의 릴레이 필드로 채운다("마지막 입력 재생").
// 자기 스프라이트는 매 틱 로컬 입력이 control을 덮어쓰므로 릴레이 값은 자동 무시된다.
import type { GameState } from '../core/state'
import type { Transport } from './types'
import {
  MSG, encodeInput, decodeSnapshot, decodeBullets,
  type InputMsg, type SnapshotMsg, type BulletMsg, type KillMsg, type FlagState,
} from './protocol'
import { createSprite, createTPlayer, HUMAN, MAX_THINGS } from '../core/sprites'
import { weaponNumToIndex, NOWEAPON_NUM } from '../core/weapons'
import { createBullet } from '../core/bullets'
import { createThing } from '../core/things'
import { applyPlayerColors } from './player-palette'
import { BOOST_CHARGES } from './respawn-boost'
import { updateFrame } from '../core/game'
import { vector2 } from '../core/vector'

// 위치/속도 보정 상수 — 자기(로컬)와 원격을 분리한다(렉 완화, 넷코드 분석 2026-07-20).
//  · 로컬(자기): 스냅샷은 ~1 RTT(실측 편도 200-320ms) 뒤처져 있어 그대로 당기면 "내 캐릭터
//    고무줄"이 된다. 로컬 예측을 신뢰하고 큰 디싱크만 느슨히 당김 + 속도는 스냅 대신 소폭 lerp.
//  · 원격: 순수 재생 — 촘촘한 데드존+빠른 pull + 방향 반전 시 즉시 스냅(반전 고무줄 제거).
const REMOTE_POS_THRESHOLD = 3 // px — 원격 데드존(작게: 촘촘히 따라감)
const REMOTE_POS_ALPHA = 0.35 // 원격 잔여오차 pull 비율
const REMOTE_REVERSAL_VEL = 2 // px/tick — 원격 속도 반전/급변 감지 임계(초과 시 하드 스냅)
const LOCAL_POS_THRESHOLD = 28 // px — 자기 스프라이트는 이만큼 벌어졌을 때만 보정(텔레포트/디싱크)
const LOCAL_POS_ALPHA = 0.12 // 자기 위치 느슨한 당김(고무줄 방지)
const LOCAL_VEL_ALPHA = 0.10 // 자기 속도는 스냅 금지 — 넉백 일부만 lerp로 반영
// 렉 수정: 2틱(33ms)이면 relayHot throttle 50ms가 매 3번째 입력을 드롭해 호스트가 스테일
// 입력을 불균일하게 재생(원격 시점에서 내 움직임이 덜컥). 3틱(50ms) = throttle 정렬 균일 20Hz.
const INPUT_SEND_EVERY_N_TICKS = 3

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
  private nickOf = new Map<number, string>() // num → 닉 (ASSIGN에서 수신, 스코어보드 표시용)
  private pings = new Map<number, number>() // num → 릴레이 RTT ms (ASSIGN 배포 + 내 것은 로컬 측정)
  private pingTimer: ReturnType<typeof setInterval> | null = null
  private myAccount: string
  private prevDeadMeat = new Map<number, boolean>() // C단계 — 리스폰 즉시스냅 감지(설계 결정 5)
  private knownFlagSlot = new Map<number, number>() // C단계 — style → 현재 채택된 thingNum(설계 결정 4)
  private prevHostVel = new Map<number, { x: number; y: number }>() // num → 직전 스냅 속도(원격 방향반전 스냅 감지)

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
        const a = payload as { account: string; num: number; nick?: string; ping?: number }
        // 핑 배포 수신 — 내 것은 로컬 측정이 더 신선하므로 덮지 않는다.
        if (typeof a.ping === 'number' && a.ping >= 0 && a.account !== this.myAccount) {
          this.pings.set(a.num, a.ping)
        }
        // 스코어보드 표시용 닉 — 스프라이트가 이미 있으면 즉시, 아직이면 ensureLocalSprite가
        // 생성 시점에 적용(60틱 ASSIGN 재방송이 순서 레이스를 자연 치유).
        if (a.nick) {
          this.nickOf.set(a.num, a.nick)
          const spr = this.gs.sprite[a.num]
          if (spr?.active && spr.player) spr.player.name = a.nick
        }
        // 리뷰 finding #2: 역방향 유일성 — 이탈+난입이 같은 프레임에 겹치면 해제된 슬롯 num이
        // 즉시 재사용되고, 그 num이 빠진 스냅샷이 한 번도 안 나가 pruneDeparted가 못 지운다.
        // 옛 계정→같은 num 매핑이 남으면 호스트 승격 시 syncRoster가 현 플레이어를 kill()하고
        // 새 계정은 영구 미스폰. ASSIGN이 진실이므로 같은 num의 다른 계정 매핑을 제거해 수렴
        // (60틱 재방송이 지속 보정).
        for (const [account, n] of [...this.knownSlots]) {
          if (n === a.num && account !== a.account) this.knownSlots.delete(account)
        }
        this.knownSlots.set(a.account, a.num) // M3-E: 기존엔 자기 것만 봤음
        if (a.account === this.myAccount) this.myNum = a.num
      } else if (event === MSG.SNAPSHOT) {
        this.lastSnapshotAt = this.nowFn() // M3-E
        this.applySnapshot(decodeSnapshot(payload as ArrayBuffer))
      } else if (event === MSG.BULLET) {
        for (const b of decodeBullets(payload as ArrayBuffer)) this.spawnRemoteBullet(b) // 배치 수신
      } else if (event === MSG.KILL) {
        this.killFeed.push(payload as KillMsg)
        if (this.killFeed.length > 20) this.killFeed.shift()
      }
    })
  }

  // 스코어보드 표시용: sprite num → 릴레이 RTT(ms).
  pingOfNum(num: number): number | undefined { return this.pings.get(num) }
  // 3초마다 자기 RTT 측정 → 로컬 표시 갱신 + 호스트로 보고(호스트가 ASSIGN 재방송으로 전원 배포).
  startPingSampling(): void {
    if (this.pingTimer || !this.transport.ping) return
    const sample = (): void => {
      void this.transport.ping!().then((ms) => {
        const v = Math.min(9999, Math.round(ms))
        if (this.myNum !== null) this.pings.set(this.myNum, v)
        this.transport.send(MSG.PING, { ping: v })
      }).catch(() => {})
    }
    sample()
    this.pingTimer = setInterval(sample, 3000)
  }
  stopPingSampling(): void { if (this.pingTimer) { clearInterval(this.pingTimer); this.pingTimer = null } }

  // 리워드 광고 보상: 리스폰 부스트 N회 충전 요청 — 호스트가 계정별 기록 후 사망시마다 적용.
  // 표시용 잔여 카운트는 클라가 로컬 예측(호스트가 진실, 표시는 코스메틱).
  boostRemaining = 0 // HUD 표시용 — 내 리스폰 부스트 잔여(예측)
  private boostWasDead = false // 내 리스폰 전이 감지(로컬 차감)
  requestRespawnBoost(): void {
    this.transport.send(MSG.RESPAWN_BOOST, { charges: BOOST_CHARGES })
    this.boostRemaining = Math.min(BOOST_CHARGES * 2, this.boostRemaining + BOOST_CHARGES)
  }
  // tick()에서 호출 — 내가 리스폰(deadMeat true→false)할 때 표시 카운트 1 차감(예측).
  private tickBoostDisplay(): void {
    if (this.myNum === null || this.boostRemaining <= 0) return
    const dead = !!this.gs.sprite[this.myNum]?.deadMeat
    if (this.boostWasDead && !dead) this.boostRemaining = Math.max(0, this.boostRemaining - 1)
    this.boostWasDead = dead
  }

  // M5: 로컬 로드아웃(림보) 선택을 호스트로 전송 — 저빈도 JSON(ASSIGN/KILL과 동일 규약).
  // 호출부(loadout-menu.ts)가 로컬 gs에도 이미 즉시 반영(예측) — 여기선 서버 권위 갱신용 통지만.
  sendLoadout(selWeapon: number, secWep: number): void {
    this.transport.send(MSG.LOADOUT, { selWeapon, secWep })
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
        this.transport.send(MSG.INPUT, encodeInput({ seq: this.seq++, ...input }), true) // hot: throttle된 relayHot (호출캡 회피, 호스트는 최신 입력만 사용)
      }
    }
    this.tickBoostDisplay() // 리스폰 부스트 표시 카운트(예측) — updateFrame이 deadMeat를 바꾸기 전에 전이 관찰
    updateFrame(this.gs)
  }

  private ensureLocalSprite(num: number, team: number, pos: { x: number; y: number }): void {
    if (this.known.has(num)) return
    this.known.add(num)
    const tPlayer = createTPlayer()
    tPlayer.team = team
    tPlayer.controlMethod = HUMAN
    tPlayer.name = this.nickOf.get(num) ?? '' // ASSIGN이 먼저 왔으면 닉 적용(아니면 재방송이 채움)
    // n=num 지정 — createSprite는 n!==255면 그 슬롯을 그대로 쓴다(sprites.ts:3912-3925) →
    // 호스트가 배정한 것과 정확히 같은 슬롯에 재현.
    createSprite(this.gs, vector2(pos.x, pos.y), vector2(0, 0), 1, num, tPlayer, true)
    // 플레이어 구분 색상 — 호스트 spawnOne과 같은 num 기반 팔레트(동기화 불필요 일치).
    applyPlayerColors(this.gs.sprite[num].player!, num)
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

  // ── M9: 이탈자 정리 — 스냅샷은 호스트 slotOf의 활성 스프라이트 전체를 담으므로(full-state),
  // 로컬이 알던 num이 스냅샷에서 빠졌다 = 호스트가 kill()로 퇴장 처리했다. 코어 규약과 동일하게
  // sprite.kill()로 비활성화하고 knownSlots(승격 seed)에서도 제거 — 안 지우면 호스트 마이그레이션
  // 승격 시 이탈자를 부활시킨다. 자기 자신(myNum)은 방어적으로 보존(배송 레이스 대비).
  private pruneDeparted(msg: SnapshotMsg): void {
    const inSnapshot = new Set(msg.sprites.map((s) => s.num))
    for (const num of [...this.known]) {
      if (inSnapshot.has(num) || num === this.myNum) continue
      if (this.gs.sprite[num]?.active) this.gs.sprite[num].kill()
      this.known.delete(num)
      this.prevDeadMeat.delete(num)
      this.prevHostVel.delete(num)
      for (const [account, n] of [...this.knownSlots]) if (n === num) this.knownSlots.delete(account)
    }
  }

  private applySnapshot(msg: SnapshotMsg): void {
    this.pruneDeparted(msg) // M9: 이탈자 정리 먼저 — kill()의 "팀 전멸 시 스코어 리셋"(코어)이
    // 스냅샷 권위값을 지우지 않도록 순서 고정(리뷰 #5: 이탈 직후 1스냅샷 HUD 깜빡임 방지).
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
      }

      // 무기 로드아웃 동기화(코스메틱) — 로컬 respawn()은 selWeapon=0이라 Hands(NOWEAPON)를
      // 쥐어주므로, 호스트가 실은 weaponNum으로 gostek이 그릴 spr.weapon을 맞춘다.
      //   원격: 항상 채용(변경시에만 — 매 스냅샷 재적용하면 guns[] 깊은복사로 탄약/장전 리셋).
      //   자기: 빈손(NOWEAPON)일 때만 채용 — 스폰/리스폰 초기 로드아웃은 받되(ASSIGN이 첫
      //     스냅샷보다 먼저 오면 원격 경로를 안 타는 레이스 보정), 로컬 무기전환 예측과는 안 싸움.
      // guns[]에 없는 num(-1 인덱스)은 스킵 — 무기 미적재 환경에서 spr.weapon 파손 방지.
      const weaponSyncable = s.num !== this.myNum || spr.weapon.num === NOWEAPON_NUM
      if (weaponSyncable && spr.weapon.num !== s.weaponNum && weaponNumToIndex(s.weaponNum) !== -1) {
        spr.applyWeaponByNum(s.weaponNum, 1)
      }

      // ── 설계 결정 5: 리스폰(deadMeat true→false) 즉시 스냅 ──
      const wasDeadMeat = this.prevDeadMeat.get(s.num) ?? s.deadMeat
      const justRespawned = wasDeadMeat && !s.deadMeat
      spr.deadMeat = s.deadMeat
      this.prevDeadMeat.set(s.num, s.deadMeat)

      // 연속값(위치/속도) 보정 — 자기(로컬)와 원격을 분리(렉 완화). 상수 주석 참조.
      const pos = this.gs.spriteParts.pos[s.num]
      const vel = this.gs.spriteParts.velocity[s.num]
      const isLocal = s.num === this.myNum
      if (justRespawned) {
        // 리스폰은 자기/원격 모두 하드 스냅(호스트 RNG 스폰 지점).
        pos.x = s.posX; pos.y = s.posY
        vel.x = s.velX; vel.y = s.velY
      } else if (isLocal) {
        // 자기: 로컬 예측 신뢰. 큰 디싱크만 느슨히 당기고, 속도는 스냅 대신 소폭 lerp
        // (스냅샷이 ~1 RTT 뒤처져 그대로 당기면 내 캐릭터가 고무줄처럼 뒤로 끌림).
        const ex = s.posX - pos.x, ey = s.posY - pos.y
        if (Math.hypot(ex, ey) > LOCAL_POS_THRESHOLD) {
          pos.x += ex * LOCAL_POS_ALPHA; pos.y += ey * LOCAL_POS_ALPHA
        }
        vel.x += (s.velX - vel.x) * LOCAL_VEL_ALPHA
        vel.y += (s.velY - vel.y) * LOCAL_VEL_ALPHA
      } else {
        // 원격: 순수 재생. 촘촘한 데드존+빠른 pull. 방향 반전/속도 급변 시 즉시 스냅(반전 고무줄 제거).
        const ex = s.posX - pos.x, ey = s.posY - pos.y
        const prev = this.prevHostVel.get(s.num)
        const reversal = !!prev && (
          (Math.sign(s.velX) !== Math.sign(prev.x) && Math.abs(s.velX) > REMOTE_REVERSAL_VEL) ||
          (Math.sign(s.velY) !== Math.sign(prev.y) && Math.abs(s.velY) > REMOTE_REVERSAL_VEL) ||
          Math.abs(s.velX - prev.x) > REMOTE_REVERSAL_VEL * 2 ||
          Math.abs(s.velY - prev.y) > REMOTE_REVERSAL_VEL * 2
        )
        const alpha = reversal ? 1 : REMOTE_POS_ALPHA
        if (Math.hypot(ex, ey) > REMOTE_POS_THRESHOLD) {
          pos.x += ex * alpha; pos.y += ey * alpha
        }
        vel.x = s.velX; vel.y = s.velY // 원격 속도는 하드 스냅(순수 재생)
        this.prevHostVel.set(s.num, { x: s.velX, y: s.velY })
      }
    }

    for (const f of msg.flags ?? []) this.ensureFlagSynced(f) // C단계
  }
}
