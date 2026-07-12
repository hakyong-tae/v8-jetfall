// 병사(gostek) 렌더러 — GostekGraphics.pas의 DEFAULT 파트 테이블(GostekGraphics.inc) 중
// 기본 몸체(Visible=1) 세트 + 제트발 스왑만 추출. 무기/team2/cygaro/헬멧/머리카락/체인/수류탄
// 표시 로직은 TODO(M2) (GostekGraphics.pas RenderGostek:253-385 참조).
//
// 파트 드로우 수식 (GostekGraphics.pas:404-453 RenderGostek + 145-179 DrawGostekSprite):
//   p1→p2 스켈레톤 파티클 사이 각도 r = ArcTan2(y2-y1, x2-x1)
//   위치 = (x1, y1+1), 피벗 = (cx*texW, cy*texH), 스케일 (sx, sy)
//   방향 반전(direction ≠ 1): flip 파트는 텍스처를 '<image>2'로 교체 + cy → 1-cy,
//   비flip 파트는 sy = -1 (DrawGostekSprite 행렬 = T(x,y)·R(r)·S(sx,sy)·T(-cx,-cy)
//   — PIXI Sprite의 position/rotation/scale/anchor 순서와 정확히 일치).
//   flex > 0 이면 sx = min(1.5, |p1p2| / flex) (GostekGraphics.pas:449-450).
import { Container, Sprite, Texture } from 'pixi.js'
import type { GameState } from '../core/state'
import type { Manifest } from './assets'
import { loadTexture } from './assets'
import { weaponNumToIndex, guns, AK74, EAGLE, FLAMER } from '../core/weapons'

// 색상 슬롯 (GostekGraphics.pas:23-29). TPlayer에 색상 필드가 아직 없어(M1 미포팅)
// 기본 팔레트를 하드코딩 — TODO(M2): Player.ShirtColor/PantsColor/SkinColor 연결.
export const GOSTEK_COLORS: Record<string, number> = {
  none: 0xffffff,
  main: 0x4a7a3a, // shirt
  pants: 0x3f4a56,
  skin: 0xe0b28a,
}

export interface GostekPart {
  id: string // GostekGraphics.inc ID 문자열
  image: string // manifest.sprites 키 (flip 변형은 key+'2')
  p1: number // skeleton particle from
  p2: number // skeleton particle to
  cx: number
  cy: number
  flip: boolean
  flex: number
  color: keyof typeof GOSTEK_COLORS
  // 'base' = 항상 표시, 'foot' = 제트 미사용시, 'jetfoot' = 제트 사용시 (RenderGostek:246-251)
  role: 'base' | 'foot' | 'jetfoot'
}

// GostekGraphics.inc의 Visible=1(기본 몸체) 15개 + 제트발 변형 2개.
// (inc 라인 순서 = 드로우 순서 — 그대로 유지해야 팔다리 겹침이 원본과 같다.)
// Def(ID, Image, p1, p2, cx, cy, Visible, Flip, Team, Flex, Color, Alpha)
export const GOSTEK_PARTS: GostekPart[] = [
  { id: 'Left_Thigh',     image: 'gostek/udo',       p1: 6,  p2: 3,  cx: 0.2,  cy: 0.5,  flip: true,  flex: 5, color: 'pants', role: 'base' },    // inc:18
  { id: 'Left_Foot',      image: 'gostek/stopa',     p1: 2,  p2: 18, cx: 0.35, cy: 0.35, flip: true,  flex: 0, color: 'none',  role: 'foot' },    // inc:20
  { id: 'Left_Jetfoot',   image: 'gostek/lecistopa', p1: 2,  p2: 18, cx: 0.35, cy: 0.35, flip: true,  flex: 0, color: 'none',  role: 'jetfoot' }, // inc:21
  { id: 'Left_Lowerleg',  image: 'gostek/noga',      p1: 3,  p2: 2,  cx: 0.15, cy: 0.55, flip: true,  flex: 0, color: 'pants', role: 'base' },    // inc:22
  { id: 'Left_Arm',       image: 'gostek/ramie',     p1: 11, p2: 14, cx: 0,    cy: 0.5,  flip: true,  flex: 0, color: 'main',  role: 'base' },    // inc:24
  { id: 'Left_Forearm',   image: 'gostek/reka',      p1: 14, p2: 15, cx: 0,    cy: 0.5,  flip: false, flex: 5, color: 'main',  role: 'base' },    // inc:26
  { id: 'Left_Hand',      image: 'gostek/dlon',      p1: 15, p2: 19, cx: 0,    cy: 0.4,  flip: true,  flex: 0, color: 'skin',  role: 'base' },    // inc:28
  { id: 'Right_Thigh',    image: 'gostek/udo',       p1: 5,  p2: 4,  cx: 0.2,  cy: 0.65, flip: true,  flex: 5, color: 'pants', role: 'base' },    // inc:31
  { id: 'Right_Foot',     image: 'gostek/stopa',     p1: 1,  p2: 17, cx: 0.35, cy: 0.35, flip: true,  flex: 0, color: 'none',  role: 'foot' },    // inc:33
  { id: 'Right_Jetfoot',  image: 'gostek/lecistopa', p1: 1,  p2: 17, cx: 0.35, cy: 0.35, flip: true,  flex: 0, color: 'none',  role: 'jetfoot' }, // inc:34
  { id: 'Right_Lowerleg', image: 'gostek/noga',      p1: 4,  p2: 1,  cx: 0.15, cy: 0.55, flip: true,  flex: 0, color: 'pants', role: 'base' },    // inc:35
  { id: 'Chest',          image: 'gostek/klata',     p1: 10, p2: 11, cx: 0.1,  cy: 0.3,  flip: true,  flex: 0, color: 'main',  role: 'base' },    // inc:37
  { id: 'Hip',            image: 'gostek/biodro',    p1: 5,  p2: 6,  cx: 0.25, cy: 0.6,  flip: true,  flex: 0, color: 'main',  role: 'base' },    // inc:40
  { id: 'Head',           image: 'gostek/morda',     p1: 9,  p2: 12, cx: 0,    cy: 0.5,  flip: true,  flex: 0, color: 'skin',  role: 'base' },    // inc:42
  { id: 'Right_Arm',      image: 'gostek/ramie',     p1: 10, p2: 13, cx: 0,    cy: 0.6,  flip: true,  flex: 0, color: 'main',  role: 'base' },    // inc:127
  { id: 'Right_Forearm',  image: 'gostek/reka',      p1: 13, p2: 16, cx: 0,    cy: 0.6,  flip: false, flex: 5, color: 'main',  role: 'base' },    // inc:129
  { id: 'Right_Hand',     image: 'gostek/dlon',      p1: 16, p2: 20, cx: 0,    cy: 0.5,  flip: true,  flex: 0, color: 'skin',  role: 'base' },    // inc:131
]
// TODO(M2): SECONDARY_*(등짐 무기), team2 텍스처 오프셋, 수류탄/체인/시가/헬멧/
// 머리카락/부상(ranny) 파트 — GostekGraphics.inc 나머지 엔트리.

// 손에 든 주무기(Primary_*) — GostekGraphics.inc 라인 75-125의 body 엔트리만 발췌.
// 모두 p1=16(오른손), p2=15(왼손) 사이에 flip=1, flex=0, COLOR_NONE(흰색/틴트없음)으로 그린다.
// 무기 index(weapons.ts EAGLE..FLAMER) → { manifest 스프라이트 키, flip 변형 키, cx, cy }.
// clip/fire 서브파트는 이번 패스에서 생략(무기 실루엣만). manifest 무기 flip 키는 대부분
// '<base>-2' 규약이나 chainsaw만 'chainsaw2' (원본 파일명 그대로).
export interface GostekPrimary {
  image: string
  imageFlip: string
  cx: number
  cy: number
}
export const GOSTEK_PRIMARY: Record<number, GostekPrimary> = {
  1:  { image: 'weapons/deserteagle', imageFlip: 'weapons/deserteagle-2', cx: 0.1,  cy: 0.8  }, // EAGLE  (Primary_Deagles)
  2:  { image: 'weapons/mp5',         imageFlip: 'weapons/mp5-2',         cx: 0.15, cy: 0.6  }, // MP5
  3:  { image: 'weapons/ak74',        imageFlip: 'weapons/ak74-2',        cx: 0.15, cy: 0.5  }, // AK74
  4:  { image: 'weapons/steyraug',    imageFlip: 'weapons/steyraug-2',    cx: 0.2,  cy: 0.6  }, // STEYRAUG
  5:  { image: 'weapons/spas12',      imageFlip: 'weapons/spas12-2',      cx: 0.1,  cy: 0.6  }, // SPAS12
  6:  { image: 'weapons/ruger77',     imageFlip: 'weapons/ruger77-2',     cx: 0.1,  cy: 0.7  }, // RUGER77
  7:  { image: 'weapons/m79',         imageFlip: 'weapons/m79-2',         cx: 0.1,  cy: 0.7  }, // M79
  8:  { image: 'weapons/barretm82',   imageFlip: 'weapons/barretm82-2',   cx: 0.15, cy: 0.7  }, // BARRETT
  9:  { image: 'weapons/m249',        imageFlip: 'weapons/m249-2',        cx: 0.15, cy: 0.6  }, // M249 (Minimi)
  10: { image: 'weapons/minigun',     imageFlip: 'weapons/minigun-2',     cx: 0.05, cy: 0.5  }, // MINIGUN
  11: { image: 'weapons/colt1911',    imageFlip: 'weapons/colt1911-2',    cx: 0.2,  cy: 0.55 }, // COLT (Socom)
  13: { image: 'weapons/chainsaw',    imageFlip: 'weapons/chainsaw2',     cx: 0.1,  cy: 0.5  }, // CHAINSAW
  14: { image: 'weapons/law',         imageFlip: 'weapons/law-2',         cx: 0.1,  cy: 0.6  }, // LAW
  16: { image: 'weapons/bow',         imageFlip: 'weapons/bow-2',         cx: -0.4, cy: 0.55 }, // BOW
  17: { image: 'weapons/flamer',      imageFlip: 'weapons/flamer-2',      cx: 0.2,  cy: 0.7  }, // FLAMER
}
const WEAPON_P1 = 16 // 오른손 파티클
const WEAPON_P2 = 15 // 왼손 파티클

// 파트 텍스처의 월드 축소비 — 1.8 에셋은 고해상도(클래식의 ~2배+)로 제작되어 mod.ini
// [SCALE] DefaultScale=4.5 기반으로 엔진이 축소해 그린다. 원본 스크린샷과의 시각 대조로
// 캘리브레이션한 값 (원본 병사 실측: 총/키 비율 0.37, 머리 ~4.4 world px).
export const GOSTEK_TEX_SCALE = 1 / 4.5

interface PartSprite {
  part: GostekPart
  sprite: Sprite
  tex: Texture // direction=1 텍스처
  texFlip: Texture // direction=-1 && flip 시 텍스처 ('<image>2')
}

// 파트 텍스처 일괄 로드 (flip 변형 포함)
export async function loadGostekTextures(manifest: Manifest): Promise<Map<string, Texture>> {
  const keys = new Set<string>()
  for (const p of GOSTEK_PARTS) {
    keys.add(p.image)
    if (p.flip) keys.add(p.image + '2')
  }
  for (const w of Object.values(GOSTEK_PRIMARY)) {
    keys.add(w.image)
    keys.add(w.imageFlip)
  }
  const map = new Map<string, Texture>()
  await Promise.all(
    [...keys].map(async (k) => {
      const t = await loadTexture(manifest, k)
      if (t) map.set(k, t)
    }),
  )
  return map
}

// 스프라이트 1명분의 gostek 렌더러 — 파트별 PIXI.Sprite를 만들고 매 프레임 스켈레톤에 맞춘다.
export class GostekRenderer {
  readonly container = new Container()
  private parts: PartSprite[] = []
  private readonly textures: Map<string, Texture>
  // 손에 든 주무기 스프라이트 — Head 다음, Right_Arm 앞에 추가해 근접손이 총 위에 겹치게(원본
  // 드로우순 GOSTEK_HEAD=41 < GOSTEK_PRIMARY_*=74.. < GOSTEK_RIGHT_ARM=126).
  private readonly weaponSprite = new Sprite()

  constructor(textures: Map<string, Texture>) {
    this.textures = textures
    for (const part of GOSTEK_PARTS) {
      const tex = textures.get(part.image)
      if (!tex) continue // 텍스처 누락 파트는 스킵 (manifest 스모크 테스트가 별도 검증)
      const sprite = new Sprite(tex)
      sprite.tint = GOSTEK_COLORS[part.color]
      sprite.visible = false
      this.container.addChild(sprite)
      this.parts.push({ part, sprite, tex, texFlip: textures.get(part.image + '2') ?? tex })
      if (part.id === 'Head') {
        this.weaponSprite.tint = GOSTEK_COLORS.none // COLOR_NONE — 무기는 틴트 없음(흰색)
        this.weaponSprite.visible = false
        this.container.addChild(this.weaponSprite)
      }
    }
  }

  // RenderGostek(GostekGraphics.pas:181-455)의 기본 몸체 경로
  update(gs: GameState, spriteIndex: number): void {
    const soldier = gs.sprite[spriteIndex]
    if (!soldier.active) {
      this.container.visible = false
      return
    }
    this.container.visible = true

    // 제트발 스왑 (RenderGostek:246-251)
    const jetsOn = soldier.control.jetpack && soldier.jetsCount > 0

    for (const { part, sprite, tex, texFlip } of this.parts) {
      if (part.role === 'foot') sprite.visible = !jetsOn
      else if (part.role === 'jetfoot') sprite.visible = jetsOn
      else sprite.visible = true
      if (!sprite.visible) continue

      const x1 = soldier.skeleton.pos[part.p1].x
      const y1 = soldier.skeleton.pos[part.p1].y
      const x2 = soldier.skeleton.pos[part.p2].x
      const y2 = soldier.skeleton.pos[part.p2].y

      let cy = part.cy
      let sx = 1
      let sy = 1

      if (soldier.direction !== 1) {
        if (part.flip) {
          cy = 1 - part.cy
          sprite.texture = texFlip
        } else {
          sy = -1
          sprite.texture = tex
        }
      } else {
        sprite.texture = tex
      }

      if (part.flex > 0) {
        sx = Math.min(1.5, Math.sqrt((x2 - x1) ** 2 + (y2 - y1) ** 2) / part.flex)
      }

      sprite.anchor.set(part.cx, cy)
      sprite.position.set(x1, y1 + 1)
      sprite.rotation = Math.atan2(y2 - y1, x2 - x1)
      sprite.scale.set(sx * GOSTEK_TEX_SCALE, sy * GOSTEK_TEX_SCALE)
      sprite.alpha = soldier.alpha / 255
    }

    this.updateWeapon(gs, spriteIndex)
  }

  // 손에 든 주무기 (RenderGostek:329-385 무기 선택 + 404-452 body 드로우, Primary_* 엔트리).
  // p1=16(오른손)→p2=15(왼손) 선을 따라, flip 파트와 동일 수식으로 그린다(color NONE=흰색).
  private updateWeapon(gs: GameState, spriteIndex: number): void {
    const soldier = gs.sprite[spriteIndex]
    const ws = this.weaponSprite

    // 무기 index 결정 — 무기/로드아웃 시스템이 아직 미초기화(createWeapons 미호출 → guns[].num=0)인
    // 마일스톤에서는 실루엣이 병사로 읽히도록 기본 소총(AK74)으로 폴백. 무기가 배선되면 자동 정상화.
    const weaponsReady = guns[AK74]?.num !== 0
    let idx = weaponsReady ? weaponNumToIndex(soldier.weapon.num) : AK74
    if (idx < EAGLE || idx > FLAMER || !GOSTEK_PRIMARY[idx]) idx = AK74
    const prim = GOSTEK_PRIMARY[idx]

    const tex = this.textures.get(soldier.direction !== 1 ? prim.imageFlip : prim.image)
    if (!tex || soldier.deadMeat) {
      ws.visible = false
      return
    }
    ws.visible = true
    ws.texture = tex

    const x1 = soldier.skeleton.pos[WEAPON_P1].x
    const y1 = soldier.skeleton.pos[WEAPON_P1].y
    const x2 = soldier.skeleton.pos[WEAPON_P2].x
    const y2 = soldier.skeleton.pos[WEAPON_P2].y

    // flip=1 파트: direction≠1 이면 cy→1-cy + 텍스처 교체(위에서 함), sx/sy는 1 유지.
    const cy = soldier.direction !== 1 ? 1 - prim.cy : prim.cy
    ws.anchor.set(prim.cx, cy)
    ws.position.set(x1, y1 + 1)
    ws.rotation = Math.atan2(y2 - y1, x2 - x1)
    ws.scale.set(GOSTEK_TEX_SCALE, GOSTEK_TEX_SCALE)
    ws.alpha = soldier.alpha / 255
  }
}
