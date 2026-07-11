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
// TODO(M2): 무기(GOSTEK_PRIMARY/SECONDARY_*), team2 텍스처 오프셋, 수류탄/체인/시가/헬멧/
// 머리카락/부상(ranny) 파트 — GostekGraphics.inc 나머지 116개 엔트리.

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

  constructor(textures: Map<string, Texture>) {
    for (const part of GOSTEK_PARTS) {
      const tex = textures.get(part.image)
      if (!tex) continue // 텍스처 누락 파트는 스킵 (manifest 스모크 테스트가 별도 검증)
      const sprite = new Sprite(tex)
      sprite.tint = GOSTEK_COLORS[part.color]
      sprite.visible = false
      this.container.addChild(sprite)
      this.parts.push({ part, sprite, tex, texFlip: textures.get(part.image + '2') ?? tex })
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
      sprite.scale.set(sx, sy)
      sprite.alpha = soldier.alpha / 255
    }
  }
}
