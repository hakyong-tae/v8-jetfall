// 탄환/씽/스파크 렌더러 — 매 프레임 core 심 상태(gs.bullet[]/gs.thing[]/gs.spark[])를
// PIXI 스프라이트 풀에 동기화한다. 슬롯은 active 플래그로 show/hide (재할당 없이 재사용).
//
// 참조: Bullets.pas Render(스타일→weapons-gfx 텍스처 매핑만 발췌), Things.pas Render(깃발/키트/
// 무기드롭 텍스처). M2 기초: 탄환=속도 방향 회전 스프라이트, 트레일 없음(M4). 씽=단일 텍스처
// 스프라이트(깃발 천 폴리곤 2장은 M4). 스파크=수명 페이드 점(전 스타일 텍스처 커버는 M4).
import { Container, Sprite, Texture } from 'pixi.js'
import type { GameState } from '../core/state'
import type { Manifest } from './assets'
import { loadTexture } from './assets'
import {
  BULLET_STYLE_FRAGNADE,
  BULLET_STYLE_M79,
  BULLET_STYLE_FLAME,
  BULLET_STYLE_ARROW,
  BULLET_STYLE_FLAMEARROW,
  BULLET_STYLE_CLUSTERNADE,
  BULLET_STYLE_CLUSTER,
  BULLET_STYLE_LAW,
  BULLET_STYLE_THROWNKNIFE,
  BULLET_STYLE_KNIFE,
} from '../core/weapons'
import {
  MAX_BULLETS,
  MAX_THINGS,
  MAX_SPARKS,
} from '../core/sprites'
import {
  OBJECT_ALPHA_FLAG,
  OBJECT_BRAVO_FLAG,
  OBJECT_POINTMATCH_FLAG,
  OBJECT_USSOCOM,
  OBJECT_DESERT_EAGLE,
  OBJECT_HK_MP5,
  OBJECT_AK74,
  OBJECT_STEYR_AUG,
  OBJECT_SPAS12,
  OBJECT_RUGER77,
  OBJECT_M79,
  OBJECT_BARRET_M82A1,
  OBJECT_MINIMI,
  OBJECT_MINIGUN,
  OBJECT_RAMBO_BOW,
  OBJECT_MEDICAL_KIT,
  OBJECT_GRENADE_KIT,
  OBJECT_FLAMER_KIT,
  OBJECT_PREDATOR_KIT,
  OBJECT_VEST_KIT,
  OBJECT_BERSERK_KIT,
  OBJECT_CLUSTER_KIT,
  OBJECT_COMBAT_KNIFE,
  OBJECT_CHAINSAW,
  OBJECT_LAW,
  OBJECT_STATIONARY_GUN,
} from '../core/constants'

// 탄환 스타일 → weapons-gfx 텍스처 키 (없으면 generic 'weapons/bullet').
const BULLET_TEX: Record<number, string> = {
  [BULLET_STYLE_FRAGNADE]: 'weapons/frag-grenade',
  [BULLET_STYLE_CLUSTERNADE]: 'weapons/cluster-grenade',
  [BULLET_STYLE_CLUSTER]: 'weapons/cluster',
  [BULLET_STYLE_M79]: 'weapons/m79-bullet',
  [BULLET_STYLE_LAW]: 'weapons/missile',
  [BULLET_STYLE_ARROW]: 'weapons/arrow',
  [BULLET_STYLE_FLAMEARROW]: 'weapons/arrow',
  [BULLET_STYLE_FLAME]: 'weapons/flamer-fire',
  [BULLET_STYLE_THROWNKNIFE]: 'weapons/bullet',
  [BULLET_STYLE_KNIFE]: 'weapons/bullet',
}
const BULLET_TEX_DEFAULT = 'weapons/bullet'

// 씽 스타일 → 텍스처 키 (깃발/키트/무기드롭).
const THING_TEX: Record<number, string> = {
  [OBJECT_ALPHA_FLAG]: 'textures/objects/flag',
  [OBJECT_BRAVO_FLAG]: 'textures/objects/flag',
  [OBJECT_POINTMATCH_FLAG]: 'textures/objects/flag',
  [OBJECT_USSOCOM]: 'weapons/colt1911',
  [OBJECT_DESERT_EAGLE]: 'weapons/deserteagle',
  [OBJECT_HK_MP5]: 'weapons/mp5',
  [OBJECT_AK74]: 'weapons/ak74',
  [OBJECT_STEYR_AUG]: 'weapons/steyraug',
  [OBJECT_SPAS12]: 'weapons/spas12',
  [OBJECT_RUGER77]: 'weapons/ruger77',
  [OBJECT_M79]: 'weapons/m79',
  [OBJECT_BARRET_M82A1]: 'weapons/barretm82',
  [OBJECT_MINIMI]: 'weapons/m249',
  [OBJECT_MINIGUN]: 'weapons/minigun',
  [OBJECT_RAMBO_BOW]: 'weapons/bow',
  [OBJECT_MEDICAL_KIT]: 'textures/objects/medikit',
  [OBJECT_GRENADE_KIT]: 'textures/objects/grenadekit',
  [OBJECT_FLAMER_KIT]: 'textures/objects/flamerkit',
  [OBJECT_PREDATOR_KIT]: 'textures/objects/predatorkit',
  [OBJECT_VEST_KIT]: 'textures/objects/vestkit',
  [OBJECT_BERSERK_KIT]: 'textures/objects/berserkerkit',
  [OBJECT_CLUSTER_KIT]: 'textures/objects/clusterkit',
  [OBJECT_COMBAT_KNIFE]: 'weapons/bow', // combat knife 월드 gfx 없음 — placeholder
  [OBJECT_CHAINSAW]: 'weapons/chainsaw',
  [OBJECT_LAW]: 'weapons/law',
  [OBJECT_STATIONARY_GUN]: 'weapons/m2-stat',
}

// 씽 텍스처 월드 축소비 — weapons/textures 에셋은 gostek과 동일한 고해상도 계열.
const THING_TEX_SCALE = 1 / 4.5
const BULLET_TEX_SCALE = 1 / 2.5

export class BulletsRenderer {
  readonly container = new Container()
  private readonly bulletSprites: Sprite[] = []
  private readonly thingSprites: Sprite[] = []
  private readonly sparkSprites: Sprite[] = []
  private textures = new Map<string, Texture>()

  // 사용된 모든 텍스처 키 일괄 로드 (누락은 Texture.WHITE 폴백).
  async load(manifest: Manifest): Promise<void> {
    const keys = new Set<string>([BULLET_TEX_DEFAULT])
    for (const k of Object.values(BULLET_TEX)) keys.add(k)
    for (const k of Object.values(THING_TEX)) keys.add(k)
    await Promise.all(
      [...keys].map(async (k) => {
        const t = await loadTexture(manifest, k)
        if (t) this.textures.set(k, t)
      }),
    )
  }

  private tex(key: string): Texture {
    return this.textures.get(key) ?? Texture.WHITE
  }

  // 풀에서 index번 스프라이트를 얻거나(없으면 생성) 반환. 서브풀별 컨테이너 자식.
  private slot(pool: Sprite[], index: number): Sprite {
    let s = pool[index]
    if (!s) {
      s = new Sprite()
      s.visible = false
      this.container.addChild(s)
      pool[index] = s
    }
    return s
  }

  update(gs: GameState): void {
    this.syncBullets(gs)
    this.syncThings(gs)
    this.syncSparks(gs)
  }

  private syncBullets(gs: GameState): void {
    for (let i = 1; i <= MAX_BULLETS; i++) {
      const b = gs.bullet[i]
      const s = this.slot(this.bulletSprites, i)
      if (!b || !b.active) {
        s.visible = false
        continue
      }
      const pos = gs.bulletParts.pos[b.num]
      const vel = gs.bulletParts.velocity[b.num]
      const key = BULLET_TEX[b.style] ?? BULLET_TEX_DEFAULT
      s.texture = this.tex(key)
      s.visible = true
      s.anchor.set(0.5, 0.5)
      s.position.set(pos.x, pos.y)
      s.rotation = Math.atan2(vel.y, vel.x)
      s.scale.set(BULLET_TEX_SCALE, BULLET_TEX_SCALE)
    }
  }

  private syncThings(gs: GameState): void {
    for (let i = 1; i <= MAX_THINGS; i++) {
      const t = gs.thing[i]
      const s = this.slot(this.thingSprites, i)
      const key = t ? THING_TEX[t.style] : undefined
      if (!t || !t.active || !key) {
        s.visible = false
        continue
      }
      // 깃발/무기드롭은 skeleton.pos[1]을 기준점으로, pos[1]→pos[2] 방향으로 회전.
      const p1 = t.skeleton.pos[1]
      const p2 = t.skeleton.pos[2]
      s.texture = this.tex(key)
      s.visible = true
      s.anchor.set(0.5, 0.5)
      s.position.set(p1.x, p1.y)
      const isFlag =
        t.style === OBJECT_ALPHA_FLAG ||
        t.style === OBJECT_BRAVO_FLAG ||
        t.style === OBJECT_POINTMATCH_FLAG
      s.rotation = isFlag && p2 ? Math.atan2(p2.y - p1.y, p2.x - p1.x) : 0
      // 브라보 깃발은 빨강, 알파는 파랑 틴트로 구분 (단일 flag 텍스처 공유).
      if (t.style === OBJECT_ALPHA_FLAG) s.tint = 0x5b7fff
      else if (t.style === OBJECT_BRAVO_FLAG) s.tint = 0xff5b5b
      else s.tint = 0xffffff
      s.scale.set(THING_TEX_SCALE, THING_TEX_SCALE)
    }
  }

  // 스파크는 수명 페이드 점 — 흰 사각을 style로 tint. 전 스타일 텍스처 매핑은 M4.
  private syncSparks(gs: GameState): void {
    for (let i = 1; i <= MAX_SPARKS; i++) {
      const sp = gs.spark[i]
      const s = this.slot(this.sparkSprites, i)
      if (!sp || !sp.active) {
        s.visible = false
        continue
      }
      const pos = gs.sparkParts.pos[sp.num]
      s.texture = Texture.WHITE
      s.visible = true
      s.anchor.set(0.5, 0.5)
      s.position.set(pos.x, pos.y)
      s.scale.set(1.5, 1.5)
      // style 대역별 색: 불꽃(>34)=주황, 리코셰/기본=노랑, 연기(>64)=회색
      if (sp.style > 64) s.tint = 0x888888
      else if (sp.style >= 35) s.tint = 0xffa040
      else s.tint = 0xfff0a0
      s.alpha = Math.max(0, Math.min(1, sp.life / 60))
    }
  }
}
