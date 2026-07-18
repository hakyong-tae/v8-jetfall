// HUD — 좌하단 체력바/제트연료바, 우하단 무기 아이콘+탄약/리로드, 상단 킬(DM)/팀스코어(CTF).
// 참조: client/InterfaceGraphics.pas 배치. 픽셀 일치는 M4 — 여기선 근사 배치 + interface-gfx 아이콘.
// 화면 고정 오버레이(월드 카메라 영향 없음)이므로 app.stage에 직접 붙인다.
import { Container, Graphics, Sprite, Text, Texture } from 'pixi.js'
import type { GameState } from '../core/state'
import type { Manifest } from './assets'
import { loadTexture } from './assets'
import {
  EAGLE, MP5, AK74, STEYRAUG, SPAS12, RUGER77, M79, BARRETT, M249, MINIGUN,
  COLT, KNIFE, CHAINSAW, LAW, BOW, BOW2, FLAMER, weaponNumToIndex, guns,
} from '../core/weapons'
import { GAMESTYLE_CTF, GAMESTYLE_INF, GAMESTYLE_HTF, TEAM_ALPHA, TEAM_BRAVO } from '../core/constants'
import { MAX_SPRITES } from '../core/sprites'
import { UNLIMITED_TIME } from '../net/room-settings'
import { t } from './i18n'

// 무기 index → interface/guns 아이콘 키 (interface/guns/0..10 = 내부 무기번호 SOCOM..MINIGUN).
// export: src/web/loadout-menu.ts(M5)가 무기선택(림보) 메뉴 아이콘 재사용.
export const GUN_ICON: Record<number, string> = {
  [COLT]: 'interface/guns/0',
  [EAGLE]: 'interface/guns/1',
  [MP5]: 'interface/guns/2',
  [AK74]: 'interface/guns/3',
  [STEYRAUG]: 'interface/guns/4',
  [SPAS12]: 'interface/guns/5',
  [RUGER77]: 'interface/guns/6',
  [M79]: 'interface/guns/7',
  [BARRETT]: 'interface/guns/8',
  [M249]: 'interface/guns/9',
  [MINIGUN]: 'interface/guns/10',
  [KNIFE]: 'interface/guns/knife',
  [CHAINSAW]: 'interface/guns/chainsaw',
  [LAW]: 'interface/guns/law',
  [BOW]: 'interface/guns/bow',
  [BOW2]: 'interface/guns/bow',
  [FLAMER]: 'interface/guns/flamer',
}

export class Hud {
  readonly container = new Container()
  private readonly bars = new Graphics()
  private readonly weaponIcon = new Sprite()
  private readonly ammoText: Text
  private readonly topText: Text
  private readonly killFeedText: Text
  private readonly scoreboardBg = new Graphics()
  private readonly scoreboardTitle: Text
  private readonly scoreboardText: Text
  private readonly matchInfoBg = new Graphics() // 좌상단 상시 패널 배경
  private readonly matchInfoText: Text // 좌상단: 맵/인원/(온라인)방제목
  private readonly respawnText: Text // 사망 대기 카운트다운 + 부스트 잔여
  private icons = new Map<string, Texture>()
  private screenW = 0
  private screenH = 0

  constructor() {
    this.ammoText = new Text({
      text: '',
      style: { fill: 0xffffff, fontSize: 16, fontFamily: 'monospace' },
    })
    this.topText = new Text({
      text: '',
      style: { fill: 0xffffff, fontSize: 18, fontFamily: 'monospace', align: 'center' },
    })
    this.topText.anchor.set(0.5, 0)
    this.killFeedText = new Text({
      text: '',
      style: { fill: 0xffe08a, fontSize: 14, fontFamily: 'monospace', align: 'right' },
    })
    this.killFeedText.anchor.set(1, 0) // 우측 상단 정렬
    this.scoreboardTitle = new Text({
      text: '',
      style: { fill: 0xf5d442, fontSize: 15, fontFamily: 'monospace', align: 'center', fontWeight: 'bold', letterSpacing: 2 },
    })
    this.scoreboardTitle.anchor.set(0.5, 0)
    this.scoreboardText = new Text({
      text: '',
      style: { fill: 0xffffff, fontSize: 14, fontFamily: 'monospace', align: 'left', lineHeight: 20 },
    })
    this.matchInfoText = new Text({
      text: '',
      style: { fill: 0xe8e6d8, fontSize: 13, fontFamily: 'monospace', align: 'left', lineHeight: 17 },
    })
    this.respawnText = new Text({
      text: '',
      style: { fill: 0xffffff, fontSize: 20, fontFamily: 'monospace', align: 'center', fontWeight: 'bold' },
    })
    this.respawnText.anchor.set(0.5, 0.5)
    this.scoreboardBg.visible = false
    this.scoreboardTitle.visible = false
    this.scoreboardText.visible = false
    this.matchInfoBg.visible = false
    this.matchInfoText.visible = false
    this.respawnText.visible = false
    this.weaponIcon.anchor.set(1, 1)
    this.container.addChild(this.bars)
    this.container.addChild(this.weaponIcon)
    this.container.addChild(this.ammoText)
    this.container.addChild(this.topText)
    this.container.addChild(this.killFeedText)
    this.container.addChild(this.matchInfoBg)
    this.container.addChild(this.matchInfoText)
    this.container.addChild(this.respawnText)
    this.container.addChild(this.scoreboardBg)
    this.container.addChild(this.scoreboardTitle)
    this.container.addChild(this.scoreboardText)
  }

  // 좌상단 상시 정보 패널 — 맵/인원/(온라인)방제목. 매 프레임 main.ts가 호출.
  setMatchInfo(info: { mapKey: string; playerCount: number; cap?: number; roomLabel?: string } | null): void {
    if (!info) { this.matchInfoBg.visible = false; this.matchInfoText.visible = false; return }
    const lines = [`${t('sb.map')}  ${info.mapKey}`]
    lines.push(`${t('sb.players')}  ${info.cap ? `${info.playerCount}/${info.cap}` : String(info.playerCount)}`)
    if (info.roomLabel) lines.push(`${t('sb.room')}  ${info.roomLabel}`)
    this.matchInfoText.text = lines.join('\n')
    this.matchInfoText.position.set(12, 10)
    const w = this.matchInfoText.width + 20
    const h = this.matchInfoText.height + 14
    this.matchInfoBg.clear()
    this.matchInfoBg.rect(4, 4, w, h).fill({ color: 0x0a0a06, alpha: 0.55 })
    this.matchInfoBg.visible = true
    this.matchInfoText.visible = true
  }

  // 사망 대기 카운트다운 + 리스폰 부스트 잔여. waitTicks<=0 이면 숨김(생존 중).
  setRespawnStatus(waitTicks: number, boostRemaining: number): void {
    if (waitTicks <= 0) { this.respawnText.visible = false; return }
    const secs = Math.ceil(waitTicks / 60)
    let txt = t('hud.respawnIn').replace('{n}', String(secs))
    if (boostRemaining > 0) txt += '\n' + t('hud.boostActive').replace('{n}', String(boostRemaining))
    this.respawnText.text = txt
    this.respawnText.position.set(this.screenW / 2, this.screenH * 0.24) // 상단 HUD 아래·로드아웃 메뉴 위
    this.respawnText.visible = true
  }

  async load(manifest: Manifest): Promise<void> {
    await Promise.all(
      [...new Set(Object.values(GUN_ICON))].map(async (k) => {
        const t = await loadTexture(manifest, k)
        if (t) this.icons.set(k, t)
      }),
    )
  }

  update(gs: GameState, me: number, screenW: number, screenH: number): void {
    this.screenW = screenW
    this.screenH = screenH
    const spr = gs.sprite[me]
    const g = this.bars
    g.clear()

    // ── 좌하단 체력/제트 바
    const barX = 20
    const barW = 200
    const barH = 14
    const healthY = screenH - 46
    const jetY = screenH - 26
    const maxHealth = gs.startHealth || 150
    const health = Math.max(0, Math.min(1, spr.health / maxHealth))
    const maxJet = gs.map.startJet || 1
    const jet = Math.max(0, Math.min(1, spr.jetsCount / maxJet))

    // 체력 (빨강 배경 + 밝은 빨강 채움)
    g.rect(barX, healthY, barW, barH).fill({ color: 0x000000, alpha: 0.4 })
    g.rect(barX, healthY, barW * health, barH).fill({ color: 0xd83a3a, alpha: 0.9 })
    // 제트 (파랑)
    g.rect(barX, jetY, barW, barH).fill({ color: 0x000000, alpha: 0.4 })
    g.rect(barX, jetY, barW * jet, barH).fill({ color: 0x3a86d8, alpha: 0.9 })

    // ── 우하단 무기 아이콘 + 탄약/리로드
    const idx = weaponNumToIndex(spr.weapon.num)
    const iconKey = GUN_ICON[idx]
    const iconTex = iconKey ? this.icons.get(iconKey) : undefined
    if (iconTex) {
      this.weaponIcon.visible = true
      this.weaponIcon.texture = iconTex
      this.weaponIcon.position.set(screenW - 20, screenH - 30)
      // 아이콘 크기 정규화 (고해상도 에셋 → HUD 크기로 축소, 최대 폭 96)
      const s = Math.min(1, 96 / (iconTex.width || 96))
      this.weaponIcon.scale.set(s, s)
    } else {
      this.weaponIcon.visible = false
    }

    // 탄약 텍스트 (리로드 중이면 R)
    const reloading = spr.weapon.reloadTimeCount > 0 && spr.weapon.reloadTimeCount < spr.weapon.reloadTime
    const ammoStr = reloading ? 'R' : `${spr.weapon.ammoCount}/${spr.weapon.ammo}`
    this.ammoText.text = ammoStr
    this.ammoText.position.set(screenW - 120, screenH - 30)

    // 리로드 진행 바 (아이콘 아래)
    if (spr.weapon.reloadTime > 0) {
      const rlY = screenH - 12
      const rlW = 96
      const rlX = screenW - 20 - rlW
      const prog = 1 - Math.max(0, Math.min(1, spr.weapon.reloadTimeCount / spr.weapon.reloadTime))
      if (reloading) {
        g.rect(rlX, rlY, rlW, 5).fill({ color: 0x000000, alpha: 0.4 })
        g.rect(rlX, rlY, rlW * prog, 5).fill({ color: 0xf0c020, alpha: 0.9 })
      }
    }

    // ── 상단 스코어
    const isTeam =
      gs.svGamemode === GAMESTYLE_CTF ||
      gs.svGamemode === GAMESTYLE_INF ||
      gs.svGamemode === GAMESTYLE_HTF
    let top = isTeam
      ? `Alpha ${gs.teamScore[TEAM_ALPHA]}   -   ${gs.teamScore[TEAM_BRAVO]} Bravo`
      : `${t('hud.kills')} ${spr.player?.kills ?? 0} / ${gs.svKilllimit}`
    // M8: 시간제한 카운트다운(mm:ss) — svTimelimit로 유/무한을 판별한다. timeLimitCounter는
    // 무제한 마커(UNLIMITED_TIME)여도 코어가 매 틱 감소시켜(gate는 mapChangeCounter 기준,
    // game.ts:162) 값만으로는 무한 여부를 알 수 없기 때문.
    if (gs.svTimelimit < UNLIMITED_TIME && gs.timeLimitCounter > 0) {
      const secs = Math.ceil(gs.timeLimitCounter / 60)
      top += `\n${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, '0')}`
    }
    this.topText.text = top
    this.topText.position.set(screenW / 2, 10)
  }

  // ── C단계: 네트워크 킬피드 (우상단). clientSession.killFeed(트랜지언트 알림)을 최근 5줄만 렌더.
  //   호스트/오프라인 경로는 호출하지 않으므로(main.ts의 `if (clientSession)` 가드) 회귀 없음.
  setKillFeed(gs: GameState, entries: ReadonlyArray<{ killer: number; victim: number; weaponNum: number }>): void {
    const name = (num: number): string => {
      if (num <= 0) return '☠'
      const p = gs.sprite[num]?.player
      return p && p.name !== '' ? p.name : `#${num}`
    }
    const lines = entries.slice(-5).map((e) => `${name(e.killer)} ⚔ ${name(e.victim)}`)
    this.killFeedText.text = lines.join('\n')
    this.killFeedText.position.set(this.screenW - 12, 40)
  }

  // ── M5: Tab 스코어보드. show=true인 동안(키 홀드) 매 프레임 호출 — 테이블 재구성은 저비용
  // (MAX_SPRITES=32 스캔)이라 매 프레임 다시 그려도 무해. DM=이름/킬/데스, CTF=+팀/캡처+팀스코어
  // (기존 상단 topText와 동일 gs.teamScore 소스).
  showScoreboard(gs: GameState, show: boolean, opts?: ScoreboardOpts): void {
    this.scoreboardBg.visible = show
    this.scoreboardTitle.visible = show
    this.scoreboardText.visible = show
    if (!show) return

    const isCtf = gs.svGamemode === GAMESTYLE_CTF
    const rows = buildScoreboardRows(gs, opts?.pingOf)
    const online = !!opts?.pingOf // 온라인 매치에서만 핑 열 노출(봇전은 무의미)
    const padR = (s: string, n: number): string => (s.length >= n ? s.slice(0, n - 1) + ' ' : s.padEnd(n))
    const padL = (s: string, n: number): string => (s.length >= n ? s.slice(0, n) : s.padStart(n))
    const fmtPing = (p?: number): string => (p === undefined || p < 0 ? '-' : String(p))
    const fmtKd = (k: number, d: number): string => (d === 0 ? (k > 0 ? k.toFixed(1) : '0.0') : (k / d).toFixed(1))

    // 타이틀: 모드 + 목표 (CTF는 팀 스코어). 방 이름은 좌상단 패널이 전담(타이틀 간결화).
    this.scoreboardTitle.text = isCtf
      ? `CTF   Alpha ${gs.teamScore[TEAM_ALPHA]} : ${gs.teamScore[TEAM_BRAVO]} Bravo   (${t('sb.goal')} ${gs.svKilllimit})`
      : `DEATHMATCH   ${t('sb.goal')} ${gs.svKilllimit} ${t('sb.kills')}`

    // 헤더 + 구분선 + 행 (모노스페이스 컬럼 — 핑은 우측 정렬 끝 열)
    const NAME_W = 15
    const header =
      padR('#', 3) + padR(t('sb.name'), NAME_W) + (isCtf ? padR(t('sb.team'), 7) : '') +
      padL(t('sb.kills'), 5) + padL(t('sb.deaths'), 5) + padL('K/D', 6) +
      (isCtf ? padL(t('sb.caps'), 6) : '') + (online ? padL(t('sb.ping'), 7) : '')
    const lines: string[] = [header, '─'.repeat(header.length)]
    let selfLine = -1
    rows.forEach((r, i) => {
      if (r.num === opts?.myNum) selfLine = lines.length
      lines.push(
        padR(String(i + 1), 3) + padR(r.name, NAME_W) + (isCtf ? padR(teamLabel(r.team), 7) : '') +
        padL(String(r.kills), 5) + padL(String(r.deaths), 5) + padL(fmtKd(r.kills, r.deaths), 6) +
        (isCtf ? padL(String(r.caps), 6) : '') + (online ? padL(fmtPing(r.ping), 7) : ''),
      )
    })

    this.scoreboardText.text = lines.join('\n')
    const LINE_H = 20
    const boxW = Math.max(isCtf ? 520 : 440, this.scoreboardText.width + 36)
    const boxH = 46 + lines.length * LINE_H + 12
    const boxX = this.screenW / 2 - boxW / 2
    const boxY = 56
    this.scoreboardTitle.position.set(this.screenW / 2, boxY + 12)
    this.scoreboardText.position.set(boxX + 18, boxY + 40)
    this.scoreboardBg.clear()
    this.scoreboardBg.rect(boxX, boxY, boxW, boxH).fill({ color: 0x0a0a06, alpha: 0.82 })
    this.scoreboardBg.rect(boxX, boxY, boxW, 2).fill({ color: 0xf5d442, alpha: 0.9 }) // 상단 포인트 라인
    if (selfLine >= 0) { // 내 행 하이라이트
      this.scoreboardBg
        .rect(boxX + 8, boxY + 40 + selfLine * LINE_H - 2, boxW - 16, LINE_H)
        .fill({ color: 0xf5d442, alpha: 0.14 })
    }
  }
}

// 무기 index 유효 무기인지(디버그/방어용, 미사용 시 tree-shake).
export function weaponHasIcon(weaponNum: number): boolean {
  return GUN_ICON[weaponNumToIndex(weaponNum)] !== undefined && guns.length > 0
}

// ── M5: 스코어보드 데이터 집계 (렌더 무관 순수 함수 — 단위테스트 대상) ───────────
export interface ScoreboardOpts {
  pingOf?: (num: number) => number | undefined // 온라인 매치: sprite num → 릴레이 RTT ms
  myNum?: number // 내 스프라이트 번호 — 행 하이라이트
}

export interface ScoreboardRow {
  num: number
  name: string
  team: number
  kills: number
  deaths: number
  caps: number // player.flags (Things.pas 캡처 스코어링, CTF 전용 — DM에선 항상 0)
  ping?: number // 릴레이 RTT ms (온라인 매치 전용, -1/undefined = 미측정)
}

// active && player 필터로 봇 포함 전원 나열, Kills 내림차순(원작 Game.pas SortPlayers와 동일 기준 —
// 동률 시 flags>deaths 세부정렬은 스코프 밖, Kills desc만 요구사항).
export function buildScoreboardRows(gs: GameState, pingOf?: (num: number) => number | undefined): ScoreboardRow[] {
  const rows: ScoreboardRow[] = []
  for (let i = 1; i <= MAX_SPRITES; i++) {
    const spr = gs.sprite[i]
    if (!spr?.active || !spr.player) continue
    rows.push({
      num: i,
      name: spr.player.name !== '' ? spr.player.name : `#${i}`,
      team: spr.player.team,
      kills: spr.player.kills,
      deaths: spr.player.deaths,
      caps: spr.player.flags,
      ping: pingOf?.(i),
    })
  }
  rows.sort((a, b) => b.kills - a.kills)
  return rows
}

function teamLabel(team: number): string {
  return team === TEAM_ALPHA ? 'Alpha' : team === TEAM_BRAVO ? 'Bravo' : '-'
}
