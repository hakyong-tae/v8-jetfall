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

// 무기 index → interface/guns 아이콘 키 (interface/guns/0..10 = 내부 무기번호 SOCOM..MINIGUN).
const GUN_ICON: Record<number, string> = {
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
    this.weaponIcon.anchor.set(1, 1)
    this.container.addChild(this.bars)
    this.container.addChild(this.weaponIcon)
    this.container.addChild(this.ammoText)
    this.container.addChild(this.topText)
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
    if (isTeam) {
      this.topText.text = `Alpha ${gs.teamScore[TEAM_ALPHA]}   -   ${gs.teamScore[TEAM_BRAVO]} Bravo`
    } else {
      this.topText.text = `Kills ${spr.player?.kills ?? 0} / ${gs.svKilllimit}`
    }
    this.topText.position.set(screenW / 2, 10)
  }
}

// 무기 index 유효 무기인지(디버그/방어용, 미사용 시 tree-shake).
export function weaponHasIcon(weaponNum: number): boolean {
  return GUN_ICON[weaponNumToIndex(weaponNum)] !== undefined && guns.length > 0
}
