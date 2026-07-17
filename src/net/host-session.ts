// src/net/host-session.ts — 호스트권위 이동 시뮬 루프. Transport 인터페이스에만 의존
// (agent8 구체 API 아님) → loopback으로 완전 테스트 가능. 코어(src/core/*) 무수정,
// 이미 로드된 GameState(맵/애니/무기 세팅 완료)를 받아 그 위에서만 동작한다.
// Node 헤드리스(server/host.ts, D단계)와 브라우저-호스트(main.ts, 이번 단계) 양쪽에서 재사용.
import type { GameState } from '../core/state'
import type { Transport } from './types'
import {
  MSG, encodeSnapshot, decodeInput, encodeBullets, type BulletMsg, type InputMsg, type SnapshotSprite,
  type FlagState, type KillMsg, type LoadoutMsg,
} from './protocol'
import { createSprite, createTPlayer, HUMAN, MAX_SPRITES, MAX_BULLETS } from '../core/sprites'
import { randomizeStart } from '../core/things'
import { guns, weaponNumToIndex, PRIMARY_WEAPONS, SECONDARY_WEAPONS } from '../core/weapons'
import { updateFrame } from '../core/game'
import { vector2 } from '../core/vector'
import { GAMESTYLE_CTF, OBJECT_ALPHA_FLAG, OBJECT_BRAVO_FLAG, TEAM_ALPHA, TEAM_BRAVO } from '../core/constants'
import { pickAutoTeamFromTeams } from './dropin'
import { applyPlayerColors } from './player-palette'

export interface HostSessionPlayer { account: string; team: number; nick?: string }

// 렉 수정: 2틱(33ms)이면 relayHot의 SDK throttle 50ms가 매 3번째 스냅샷을 조용히 드롭해
// "불균일 20Hz"가 되던 것(33-66-33ms 간격 = 원격이 덜컥거림). 3틱(50ms) = throttle과 정렬된
// 균일 20Hz — 드롭 0. (스펙 §4.2 "~20-30Hz" 범위 내)
const SNAPSHOT_EVERY_N_TICKS = 3
// ASSIGN 재전송 주기(~1s). spawnPlayers는 시작 시 1회만 ASSIGN을 보내므로, 이후 접속/재접속한
// 클라는 그 1회를 놓쳐 자기 스프라이트 번호를 모른다 — 주기적 재전송으로 늦은 합류/재접속을
// 자연 치유(클라의 ASSIGN 처리는 멱등이라 무해).
const ASSIGN_EVERY_N_TICKS = 60

export class HostSession {
  private slotOf = new Map<string, number>() // account → 스프라이트 num
  private nickOf = new Map<string, string>() // account → 로비 닉네임 (ASSIGN에 실어 클라 스코어보드 표시용)
  private pingOf = new Map<string, number>() // account → 릴레이 RTT ms (자기 것 + MSG.PING 보고)
  private lastInput = new Map<string, InputMsg>() // account → 최신 수신 입력(누적 아님, 최신값만)
  private lastAppliedSeq = new Map<number, number>() // sprite num → 마지막 적용 seq
  private tickCount = 0

  // ── C단계 신규 상태 ──
  private prevActiveBullets = new Set<number>()
  private bulletSeq = 0
  private prevKills = new Map<number, number>()   // sprite num → 직전 틱 kills
  private prevDeadMeat = new Map<number, boolean>() // sprite num → 직전 틱 deadMeat

  constructor(private transport: Transport, public readonly gs: GameState) {
    transport.onMessage((event, _payload, from) => {
      if (event === MSG.INPUT) {
        this.lastInput.set(from, decodeInput(_payload as ArrayBuffer))
      } else if (event === MSG.LOADOUT) {
        this.applyLoadout(from, _payload as LoadoutMsg)
      } else if (event === MSG.PING) {
        const p = (_payload as { ping?: number }).ping
        if (typeof p === 'number' && p >= 0) this.pingOf.set(from, Math.min(9999, Math.round(p)))
      } else if (event === MSG.RESPAWN_SKIP) {
        this.applyRespawnSkip(from)
      }
    })
  }

  // 리워드 광고 보상: 사망 대기 스킵. 호스트가 권위 검증 — 실제로 죽어서 대기 중일 때만
  // respawnCounter를 1로 당긴다(다음 틱에 코어 respawn() 경로가 정상 처리). 치트 불가:
  // 살아있거나 카운터가 이미 짧으면 무시.
  applyRespawnSkip(account: string): void {
    const num = this.slotOf.get(account)
    if (num === undefined) return
    const spr = this.gs.sprite[num]
    if (!spr?.active || !spr.deadMeat) return
    if (spr.respawnCounter > 1) spr.respawnCounter = 1
  }

  // 스코어보드 표시용: sprite num → 릴레이 RTT(ms). 자기 것은 measureOwnPing이, 클라 것은
  // MSG.PING 보고가 채운다. ASSIGN 재방송(1s)에 실려 전 클라에 배포된다.
  pingOfNum(num: number): number | undefined {
    for (const [account, n] of this.slotOf) if (n === num) return this.pingOf.get(account)
    return undefined
  }
  private pingTimer: ReturnType<typeof setInterval> | null = null
  startPingSampling(): void {
    if (this.pingTimer || !this.transport.ping) return
    const sample = (): void => {
      void this.transport.ping!().then((ms) => this.pingOf.set(this.transport.account, Math.min(9999, Math.round(ms)))).catch(() => {})
    }
    sample()
    this.pingTimer = setInterval(sample, 3000)
  }
  stopPingSampling(): void { if (this.pingTimer) { clearInterval(this.pingTimer); this.pingTimer = null } }

  // M5: 클라가 무기선택(림보) 메뉴에서 고른 값 반영 — 죽어있으면 다음 respawn()이 코어 규칙대로
  // 자동 반영(selWeapon/secWep만 갱신), 살아있으면 즉시 applyWeaponByNum으로 장착(원작 규칙,
  // main.ts의 로컬 봇전/호스트 경로와 동일 로직 — 실제로 바뀐 슬롯만 재장착해 안 바뀐 슬롯의
  // 탄약이 리셋되지 않게 diff 게이트).
  private applyLoadout(account: string, msg: LoadoutMsg): void {
    const num = this.slotOf.get(account)
    if (num === undefined) return
    const spr = this.gs.sprite[num]
    if (!spr?.active || !spr.player) return

    // 호스트가 권위 — 클라 값을 그대로 신뢰하지 않고 실존/활성 무기인지 검증한다(리뷰 finding
    // #2: 미검증 selWeapon이 저장되면 respawn()/applyWeaponByNum이 guns[-1]=undefined를
    // 역참조해 스프레드({...undefined}={})로 깨진 무기 오브젝트를 전체에 브로드캐스트하게 됨).
    const primaryIdx = msg.selWeapon > 0 ? weaponNumToIndex(msg.selWeapon) : 0
    const validPrimary =
      msg.selWeapon === 0 ||
      (primaryIdx >= 1 && primaryIdx <= PRIMARY_WEAPONS && this.gs.weaponActive[primaryIdx] === 1)
    const validSec =
      Number.isInteger(msg.secWep) &&
      msg.secWep >= 0 &&
      msg.secWep < SECONDARY_WEAPONS &&
      this.gs.weaponActive[PRIMARY_WEAPONS + msg.secWep + 1] === 1

    if (!validPrimary && !validSec) return // 완전 무효 페이로드 — 통째로 무시

    const primaryChanged = validPrimary && spr.selWeapon !== msg.selWeapon
    const secChanged = validSec && spr.player.secWep !== msg.secWep
    if (validPrimary) spr.selWeapon = msg.selWeapon
    if (validSec) spr.player.secWep = msg.secWep
    if (!spr.deadMeat) {
      if (primaryChanged && msg.selWeapon > 0) spr.applyWeaponByNum(msg.selWeapon, 1)
      if (secChanged) {
        spr.applyWeaponByNum(guns[PRIMARY_WEAPONS + msg.secWep + 1].num, 2)
      }
    }
  }

  // 매치 시작 시 1회 — 룸의 전 플레이어에게 스프라이트 배정(슬롯 번호는 createSprite가 빈 슬롯
  // 중 하나를 고르므로 호출 순서가 배정 순서). addBotPlayer 패턴(randomizeStart→createSprite→
  // 무기지급→respawn) 재사용, controlMethod만 BOT 대신 HUMAN.
  spawnPlayers(players: HostSessionPlayer[]): void {
    for (const p of players) this.spawnOne(p)
    this.gs.sortPlayers?.()
  }

  // 플레이어 1명 스폰 + ASSIGN 통지 — spawnPlayers(시작)와 syncRoster(M9 난입)가 공유.
  private spawnOne(p: HostSessionPlayer): boolean {
    // 리뷰 finding #1: CTF에서 팀이 아직 미정(NONE 등)이면 호스트가 스폰 시점에 권위로 배정.
    // 클라의 joinRoom(p_ 팀 NONE 기록)→selectTeam 2단계 쓰기 사이에 syncRoster가 먼저 돌면
    // 무소속으로 스폰돼 영구히 남던 레이스를 호스트 측에서 봉합. 팀 진실은 스냅샷으로 전파.
    let team = p.team
    if (this.gs.svGamemode === GAMESTYLE_CTF && team !== TEAM_ALPHA && team !== TEAM_BRAVO) {
      const teams: number[] = []
      for (const [, num] of this.slotOf) {
        const spr = this.gs.sprite[num]
        if (spr?.active && spr.player) teams.push(spr.player.team)
      }
      team = pickAutoTeamFromTeams(teams)
    }
    const tPlayer = createTPlayer()
    tPlayer.team = team
    tPlayer.controlMethod = HUMAN
    // 이름이 비면 코어 respawn()이 조기 반환(sprites.ts:3506 `{$IFNDEF SERVER}` 가드)해
    //   사망 후 영구히 리스폰 못 함. 표시용으로는 로비 닉네임을 우선(스코어보드가
    //   'anonymous-…' 계정 문자열 대신 닉을 보여주게), 닉이 비면 계정명 폴백.
    tPlayer.name = p.nick || p.account
    const r = randomizeStart(this.gs, p.team)
    const num = createSprite(this.gs, r.start, vector2(0, 0), 1, 255, tPlayer, true)
    if (num < 0) return false // 서버 만원(MAX_SPRITES) — 호출자가 CAP=8로 사전 제한(server.js와 동일 규약)
    // 플레이어 구분 색상 — num 기반 결정적 팔레트(클라 ensureLocalSprite와 같은 함수 = 무동기화 일치).
    applyPlayerColors(this.gs.sprite[num].player!, num)
    // M5: 맨손 스폰 — createSprite()가 이미 selWeapon=0/secWep=0으로 초기화(원작 규약, Sprites.pas
    // 3574 상당). 무기는 클라의 로드아웃(림보) 메뉴가 LOADOUT 메시지로 골라 지급한다(applyLoadout).
    this.gs.sprite[num].respawn()
    this.slotOf.set(p.account, num)
    // C단계: 킬/사망 diff 기준선을 스폰 시점에 시딩 — 첫 틱 이전(스크립트 데미지 등)에
    //   발생한 변화도 첫 tick()의 diff가 올바르게 잡도록 한다(lazy-init 사각지대 제거).
    this.prevKills.set(num, this.gs.sprite[num].player!.kills)
    this.prevDeadMeat.set(num, this.gs.sprite[num].deadMeat)
    this.nickOf.set(p.account, p.nick || '')
    this.transport.send(MSG.ASSIGN, { account: p.account, num, nick: p.nick || '' })
    return true
  }

  // ── M9: 매치 중 로스터 동기화(난입/이탈) — roomState의 p_ 목록과 slotOf를 맞춘다.
  // 난입: spawnPlayers와 동일 경로(spawnOne)로 스폰 + 즉시 ASSIGN(60틱 재방송이 레이스 보강).
  //   늦합류 클라의 상태 캐치업은 별도 전송 불요 — 스냅샷이 매 2틱 전체 상태라 수신 즉시 따라잡음.
  // 이탈: 코어 규약대로 sprite.kill()(Sprites.pas TSprite.Kill 상당 — 퇴장/재생성용 비활성화,
  //   운반 깃발 해제 포함)로 비활성화하고 호스트 측 추적 맵에서 제거. 이후 스냅샷에서 빠지므로
  //   클라는 applySnapshot의 부재 감지(client-session.ts M9)로 로컬 스프라이트를 정리한다.
  syncRoster(players: HostSessionPlayer[]): void {
    const present = new Set(players.map((p) => p.account))
    for (const [account, num] of [...this.slotOf]) {
      if (present.has(account)) continue
      if (this.gs.sprite[num]?.active) this.gs.sprite[num].kill()
      this.slotOf.delete(account)
      this.lastInput.delete(account)
      this.lastAppliedSeq.delete(num)
      this.prevKills.delete(num)
      this.prevDeadMeat.delete(num)
    }
    let joined = false
    for (const p of players) {
      if (this.slotOf.has(p.account)) continue
      if (this.spawnOne(p)) joined = true
    }
    if (joined) this.gs.sortPlayers?.()
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

    updateFrame(this.gs) // ← 탄환 생성·데미지·사망·리스폰·(CTF)깃발자동생성/캡처가 전부 이 안에서 일어남

    this.diffAndBroadcastBullets()  // 설계 결정 1
    this.diffAndBroadcastKills()    // 설계 결정 3

    this.tickCount++
    if (this.tickCount % SNAPSHOT_EVERY_N_TICKS === 0) this.broadcastSnapshot()
    if (this.tickCount % ASSIGN_EVERY_N_TICKS === 0) this.rebroadcastAssignments()
  }

  // 늦게 합류/재접속한 클라를 위해 전 플레이어의 슬롯 배정을 주기적으로 재전송(멱등).
  private rebroadcastAssignments(): void {
    for (const [account, num] of this.slotOf) {
      this.transport.send(MSG.ASSIGN, {
        account, num,
        nick: this.nickOf.get(account) || '',
        ping: this.pingOf.get(account) ?? -1, // -1 = 아직 측정 안 됨('-' 표시)
      })
    }
  }

  // ── 설계 결정 1: 탄환 활성슬롯 diff ──────────────────────────────────────
  private diffAndBroadcastBullets(): void {
    const activeNow = new Set<number>()
    for (let i = 1; i <= MAX_BULLETS; i++) {
      if (this.gs.bullet[i].active) activeNow.add(i)
    }
    const humanSprites = new Set(this.slotOf.values())
    // 렉 수정: 탄환당 relay 1회 → 틱당 신규 탄환 전체를 1회로 배치. 샷건 펠릿(동시 다발)·미니건
    // 연사가 함수 호출 캡("Too many calls")과 릴레이 부하를 때려 전투 중 히치를 만들던 원인.
    const batch: BulletMsg[] = []
    for (const slot of activeNow) {
      if (this.prevActiveBullets.has(slot)) continue // 기존 탄환 — 이번 틱 신규 아님
      const b = this.gs.bullet[slot]
      if (!humanSprites.has(b.owner)) continue // 봇 등 미추적 소유자는 스코프 밖(열린 질문 참조)
      const vel = this.gs.bulletParts.velocity[slot]
      batch.push({
        seq: this.bulletSeq++, owner: b.owner, weaponNum: b.ownerWeapon, style: b.style,
        hitMultiply: b.hitMultiply, seed: b.seed,
        posX: b.initial.x, posY: b.initial.y, velX: vel.x, velY: vel.y,
      })
    }
    if (batch.length > 0) this.transport.send(MSG.BULLET, encodeBullets(batch))
    this.prevActiveBullets = activeNow
  }

  // ── 설계 결정 3: 킬 이벤트(킬피드 전용) diff ──────────────────────────────
  private diffAndBroadcastKills(): void {
    const killers: number[] = []
    for (let i = 1; i <= MAX_SPRITES; i++) {
      const spr = this.gs.sprite[i]
      if (!spr.active || !spr.player) continue
      const prev = this.prevKills.get(i) ?? spr.player.kills
      if (spr.player.kills > prev) killers.push(i)
      this.prevKills.set(i, spr.player.kills)
    }
    for (const num of this.slotOf.values()) {
      const spr = this.gs.sprite[num]
      if (!spr.active) continue
      const wasDead = this.prevDeadMeat.get(num) ?? false
      if (!wasDead && spr.deadMeat) {
        const killerNum = killers.find((k) => k !== num) ?? 0
        const weaponNum = killerNum > 0 ? this.gs.sprite[killerNum].weapon.num : 0
        const msg: KillMsg = { killer: killerNum, victim: num, weaponNum }
        this.transport.send(MSG.KILL, msg)
      }
      this.prevDeadMeat.set(num, spr.deadMeat)
    }
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
        kills: spr.player!.kills, deaths: spr.player!.deaths, // ← C단계 추가
        weaponNum: spr.weapon.num, // 원격 병사 손 무기 렌더용(코스메틱) — 데미지는 BULLET이 권위
        control: {
          left: spr.control.left, right: spr.control.right, up: spr.control.up, down: spr.control.down,
          fire: spr.control.fire, jetpack: spr.control.jetpack, throwNade: spr.control.throwNade,
          changeWeapon: spr.control.changeWeapon, throwWeapon: spr.control.throwWeapon,
          reload: spr.control.reload, prone: spr.control.prone, flagThrow: spr.control.flagThrow,
          mouseAimX: spr.control.mouseAimX, mouseAimY: spr.control.mouseAimY,
        },
      })
    }

    // ── 설계 결정 4: CTF 깃발 상태(스타일별 gs.teamFlag 조회 — 호스트가 이미 매 틱 추적 중) ──
    let flags: FlagState[] | undefined
    if (this.gs.svGamemode === GAMESTYLE_CTF) {
      flags = [OBJECT_ALPHA_FLAG, OBJECT_BRAVO_FLAG].map((style) => {
        const slot = this.gs.teamFlag[style]
        if (!slot || !this.gs.thing[slot]?.active) {
          return { style, thingNum: 0, holdingSprite: 0, posX: 0, posY: 0 }
        }
        const t = this.gs.thing[slot]
        return { style, thingNum: slot, holdingSprite: t.holdingSprite, posX: t.skeleton.pos[1].x, posY: t.skeleton.pos[1].y }
      })
    }

    this.transport.send(MSG.SNAPSHOT, encodeSnapshot({
      tick: this.gs.ticks,
      teamScore1: this.gs.teamScore[1] ?? 0,
      teamScore2: this.gs.teamScore[2] ?? 0,
      sprites, flags,
    }), true) // hot: 고빈도 latest-wins → throttle된 relayHot로 (agent8 호출캡 회피)
  }

  // 실 구동용 — 테스트는 tick()을 직접 반복 호출하므로 미사용. 반환값은 정지 함수.
  startLoop(intervalMs = 1000 / 60): () => void {
    const h = setInterval(() => this.tick(), intervalMs)
    return () => clearInterval(h)
  }

  // M3-E: 이미 돌고 있던 클라의 gs(전원 로컬 미러링된 활성 스프라이트)를 승계 — spawnPlayers()처럼
  // randomizeStart+createSprite로 새로 스폰하지 않는다(순간이동/리스폰 없이 이어짐, §설계결정2).
  static fromPromotedClient(transport: Transport, gs: GameState, knownSlots: Map<string, number>): HostSession {
    const host = new HostSession(transport, gs)
    for (const [account, num] of knownSlots) {
      if (!gs.sprite[num]?.active) continue
      host.slotOf.set(account, num)
      host.prevKills.set(num, gs.sprite[num].player?.kills ?? 0)
      host.prevDeadMeat.set(num, gs.sprite[num].deadMeat)
    }
    for (let i = 1; i <= MAX_BULLETS; i++) if (gs.bullet[i].active) host.prevActiveBullets.add(i) // 기존 탄환 오탐 방지
    return host
  }
}
