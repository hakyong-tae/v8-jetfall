// 탄환/씽/스파크 렌더러 — 매 프레임 core 심 상태(gs.bullet[]/gs.thing[]/gs.spark[])를
// PIXI 스프라이트 풀에 동기화한다. 슬롯은 active 플래그로 show/hide (재할당 없이 재사용).
//
// 참조: Bullets.pas TBullet.Render(740-1058) — M4-B에서 원본 트레일(Trails=1 경로) 이식:
//   PLAIN/FRAGNADE/SHOTGUN/M79/ARROW/FLAMEARROW/LAW. 나머지 스타일(FLAME/CLUSTERNADE/
//   CLUSTER/KNIFE/THROWNKNIFE/M2/PUNCH)은 현행 회전 스프라이트 유지(아래 syncBullets 주석).
// Things.pas TThing.PolygonsRender(1206-1304) — M4-B에서 깃발을 skeleton pos[1..4] 기반
//   2삼각형 천 메시(FlagCloth)로 교체. 코어 Verlet이 매 틱 굴리는 천 물리를 그대로 그린다.
// 스파크=수명 페이드 점(전 스타일 텍스처 커버는 후속).
import { Buffer, Container, Geometry, Mesh, Shader, Sprite, Texture } from 'pixi.js'
import type { GameState } from '../core/state'
import type { TVector2 } from '../core/vector'
import type { Manifest } from './assets'
import { loadTexture } from './assets'
import { VERTEX_SRC, FRAGMENT_SRC } from './maprender'
import {
  BULLET_STYLE_PLAIN,
  BULLET_STYLE_FRAGNADE,
  BULLET_STYLE_SHOTGUN,
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
import { getCachedSettings } from './settings'

// "내 총알 주황색" 틴트 색 — gostek.ts의 MY_GUN_TINT와 동일(내 무기+총알 통일된 식별색).
const MY_BULLET_TINT = 0xff8c1a
import {
  BULLET_TIMEOUT,
  GRENADE_TIMEOUT,
  ARROW_RESIST,
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

// 트레일 상수 (Constants.pas:67 BULLETTRAIL / Sprites.pas:47 BULLETALPHA)
const BULLETTRAIL = 13
const BULLETALPHA = 110

// 탄환 스타일 → weapons-gfx 텍스처 키 (없으면 generic 'weapons/bullet').
const BULLET_TEX: Record<number, string> = {
  [BULLET_STYLE_FRAGNADE]: 'weapons/frag-grenade',
  [BULLET_STYLE_SHOTGUN]: 'weapons/spas12-bullet',
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

const isFlagStyle = (style: number): boolean =>
  style === OBJECT_ALPHA_FLAG || style === OBJECT_BRAVO_FLAG || style === OBJECT_POINTMATCH_FLAG

// 깃발 버텍스 컬러 (Things.pas PolygonsRender:1240-1276, 비 INF 모드 분기).
// 알파=빨강($AD1515 계열)/브라보=파랑($0510AD 계열) — 원본 그대로 = 팀 셔츠색 규칙과 일치.
const FLAG_COLORS: Record<number, { base: number; top: number; low: number }> = {
  [OBJECT_ALPHA_FLAG]: { base: 0xad1515, top: 0xb51515, low: 0x951515 }, // :1251-1253
  [OBJECT_BRAVO_FLAG]: { base: 0x0510ad, top: 0x0510b5, low: 0x051095 }, // :1266-1268
  [OBJECT_POINTMATCH_FLAG]: { base: 0xadad15, top: 0xb5b515, low: 0x959515 }, // :1273-1275
}

// 깃발 천 메시 — Things.pas PolygonsRender(1206-1304)의 웹 포팅.
// 쿼드 버텍스/UV/컬러 (Things.pas:1296-1301):
//   v0 = Pos2  uv(L,T) ColorBase   v1 = Pos1' uv(L,B) ColorTop
//   v2 = Pos4  uv(R,B) ColorBase   v3 = Pos3  uv(R,T) ColorLow
//   Pos1' = Pos1 + 0.5*(Pos2 - Pos1) — 손잡이 위치를 깃대 중간까지 올림 (Things.pas:1286-1294)
// GfxDrawQuad의 삼각형 분할 = (v0,v1,v2)+(v2,v3,v0) (Gfx.pas:1323-1330) → 비인덱스 6버텍스.
// 텍스처는 단독 이미지라 UV 0..1 전체 (원본 tc = Textures[Texture].TexCoords).
// 셰이더는 maprender의 per-vertex color 메시 셰이더 재사용 (colors는 premultiplied).
// ※ Things.pas Render:1084의 깃대 스프라이트(GFX_OBJECTS_FLAG_HANDLE='objects-gfx/flag.bmp')는
//   에셋 미보유로 보류. ILUM 글로우(:1086-1092)도 보류.
class FlagCloth {
  readonly mesh: Mesh<Geometry, Shader>
  readonly style: number // 버텍스 컬러가 style로 구워지므로 슬롯 재사용 시 대조용
  private readonly positions = new Float32Array(6 * 2)
  private readonly posBuffer: Buffer

  constructor(texture: Texture, style: number) {
    this.style = style
    const c = FLAG_COLORS[style] ?? { base: 0xffffff, top: 0xffffff, low: 0xffffff }
    // 버텍스 순서 [v0,v1,v2, v2,v3,v0] → 컬러 [base,top,base, base,low,base]
    const order = [c.base, c.top, c.base, c.base, c.low, c.base]
    const colors = new Float32Array(6 * 4)
    for (let i = 0; i < 6; i++) {
      colors[i * 4] = ((order[i] >> 16) & 0xff) / 255
      colors[i * 4 + 1] = ((order[i] >> 8) & 0xff) / 255
      colors[i * 4 + 2] = (order[i] & 0xff) / 255
      colors[i * 4 + 3] = 1
    }
    // UV: v0(0,0) v1(0,1) v2(1,1) v2(1,1) v3(1,0) v0(0,0)
    const uvs = new Float32Array([0, 0, 0, 1, 1, 1, 1, 1, 1, 0, 0, 0])

    const geometry = new Geometry({
      attributes: { aPosition: this.positions, aUV: uvs, aColor: colors },
    })
    this.posBuffer = geometry.attributes['aPosition'].buffer
    const shader = Shader.from({
      gl: { vertex: VERTEX_SRC, fragment: FRAGMENT_SRC },
      resources: { uTexture: texture.source, uSampler: texture.source.style },
    })
    this.mesh = new Mesh({ geometry, shader })
  }

  // skeleton pos[1..4] → 버텍스 (매 프레임). 좌표는 이미 월드 공간.
  update(pos: TVector2[]): void {
    const p1 = pos[1]
    const p2 = pos[2]
    const p3 = pos[3]
    const p4 = pos[4]
    // Pos1' = Pos1 + 0.5*(Pos2-Pos1) (Things.pas:1290-1292)
    const p1x = p1.x + (p2.x - p1.x) * 0.5
    const p1y = p1.y + (p2.y - p1.y) * 0.5
    const v = this.positions
    v[0] = p2.x; v[1] = p2.y // v0
    v[2] = p1x; v[3] = p1y // v1
    v[4] = p4.x; v[5] = p4.y // v2
    v[6] = p4.x; v[7] = p4.y // v2
    v[8] = p3.x; v[9] = p3.y // v3
    v[10] = p2.x; v[11] = p2.y // v0
    this.posBuffer.update()
  }
}

export class BulletsRenderer {
  readonly container = new Container()
  private readonly bulletSprites: Sprite[] = []
  private readonly trailSprites: Sprite[] = [] // Trails=1 보조 스트릭 (탄환 슬롯과 1:1)
  private readonly thingSprites: Sprite[] = []
  private readonly flagCloths: (FlagCloth | undefined)[] = [] // 깃발 씽 슬롯 전용
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

  // localNum: 로컬 플레이어 스프라이트 번호(>0). 그가 쏜 탄환을 주황으로 틴트해 자기 총알 식별.
  update(gs: GameState, localNum = -1): void {
    this.syncBullets(gs, localNum)
    this.syncThings(gs)
    this.syncSparks(gs)
  }

  // head에서 tail 방향으로 로컬 +x를 스트레치하는 트레일/탄체 스프라이트 배치.
  // 원본은 Roto := -Angle2Points(head, tail)을 GfxDrawSprite에 전달하는데(Bullets.pas:784 등,
  // 피벗 rx=ry=0 = 좌상단), GfxDrawSprite가 내부에서 각도를 다시 부호반전한다
  // (GfxSpriteVertices(..., -r, ...), Gfx.pas:1483/1499). 이중 부정으로 화면상 실제 회전은
  // +Angle2Points = atan2(tail-head) — 아래 atan2가 원본과 정확히 일치한다(편차 아님).
  // 스케일은 원본 수식 × BULLET_TEX_SCALE(고해상도 에셋 보정).
  private setStretch(
    s: Sprite,
    texKey: string,
    headX: number,
    headY: number,
    tailX: number,
    tailY: number,
    sx: number,
    sy: number,
    tint: number,
    alpha: number,
  ): void {
    s.texture = this.tex(texKey)
    s.visible = true
    s.anchor.set(0, 0)
    s.position.set(headX, headY)
    s.rotation = Math.atan2(tailY - headY, tailX - headX)
    s.scale.set(sx * BULLET_TEX_SCALE, sy * BULLET_TEX_SCALE)
    s.tint = tint
    s.alpha = alpha
  }

  // Bullets.pas TBullet.Render(740-1058) Trails=1 경로 이식. b.timeOut은 원본 TimeOutReal의
  // 정수 카운트다운(BULLET_TIMEOUT→0) — 보간 없이 그대로 조건에 사용.
  // 이식: PLAIN(764-839)/FRAGNADE(841-872)/SHOTGUN(874-895)/M79(897-929)/ARROW(940-960)/
  //       FLAMEARROW(962-971)/LAW(988-1010).
  // 보류(현행 회전 스프라이트 유지): FLAME(931-938, 프레임 애니 텍스처 미로드),
  //   CLUSTERNADE(973-979)/CLUSTER(981-986)/THROWNKNIFE(1012-1022, knife 텍스처 스핀)/
  //   M2(1024-1055, SMUDGE 이중 트레일)/KNIFE·PUNCH(원본 케이스 없음 — 비표시가 원본이나
  //   가시성 위해 현행 유지). PingAdd 고스트(797-810)는 웹 클라 넷 보정 미구현으로 제외.
  private syncBullets(gs: GameState, localNum: number): void {
    for (let i = 1; i <= MAX_BULLETS; i++) {
      const b = gs.bullet[i]
      const s = this.slot(this.bulletSprites, i)
      const tr = this.slot(this.trailSprites, i)
      if (!b || !b.active) {
        s.visible = false
        tr.visible = false
        continue
      }
      const pos = gs.bulletParts.pos[b.num]
      const vel = gs.bulletParts.velocity[b.num]
      const speed = Math.hypot(vel.x, vel.y)
      s.visible = false
      tr.visible = false

      switch (b.style) {
        case BULLET_STYLE_PLAIN: {
          // Bullets.pas:764-839. 스폰 직후 2틱은 비표시(765).
          if (b.timeOut < BULLET_TIMEOUT - 2) {
            const headX = pos.x + vel.x
            const headY = pos.y + vel.y
            const sx = speed / BULLETTRAIL // :782
            // alfa = clamp(HitMultiply*sx²/4.63*255, 50..230) (:786-791)
            let alfa = ((b.hitMultiply * sx * sx) / 4.63) * 255
            if (alfa > 230) alfa = 230
            if (alfa < 50) alfa = 50
            this.setStretch(s, BULLET_TEX_DEFAULT, headX, headY, pos.x, pos.y, sx, 1, 0xffffff, alfa / 255)
            // Trails=1 보조 스트릭 (:812-838)
            if (b.timeOut < BULLET_TIMEOUT - 7) {
              if (b.hitBody > 0) {
                // 몸 관통탄: 분홍 틴트, |v|/4 (:817-822)
                this.setStretch(tr, BULLET_TEX_DEFAULT, pos.x, pos.y, pos.x - vel.x, pos.y - vel.y,
                  Math.abs(speed / 4), 1, 0xffdddd, (BULLETALPHA >> 1) / 255)
              } else {
                // 일반: 흰색, |v|/3.5 (:830-835)
                this.setStretch(tr, BULLET_TEX_DEFAULT, pos.x, pos.y, pos.x - vel.x, pos.y - vel.y,
                  Math.abs(speed / 3.5), 1, 0xffffff, (BULLETALPHA >> 1) / 255)
              }
            }
          }
          break
        }

        case BULLET_STYLE_FRAGNADE: {
          // Bullets.pas:841-872. 수류탄 본체는 회전 없이 (pos-1, pos-4) 좌상단 고정(:867-871).
          if (b.timeOut < GRENADE_TIMEOUT - 3) {
            // 트레일 오프셋: 진행 방향에 따라 ±1 (:847-854)
            const ox = vel.y > 0 ? -1 : 1
            const oy = vel.x > 0 ? 1 : -1
            const headX = pos.x + ox
            const headY = pos.y - 3 + oy
            this.setStretch(tr, BULLET_TEX_DEFAULT, headX, headY, headX - vel.x, headY - vel.y,
              speed / 3, 1, 0x64ff64, Math.round(BULLETALPHA * 0.75) / 255) // :861-864
          }
          s.texture = this.tex(BULLET_TEX[b.style] ?? BULLET_TEX_DEFAULT)
          s.visible = true
          s.anchor.set(0, 0)
          s.position.set(pos.x - 1, pos.y - 4) // :867-868
          s.rotation = 0
          s.scale.set(BULLET_TEX_SCALE, BULLET_TEX_SCALE)
          s.tint = 0xffffff
          s.alpha = 1
          break
        }

        case BULLET_STYLE_SHOTGUN: {
          // Bullets.pas:874-895
          if (b.timeOut < BULLET_TIMEOUT - 2) {
            const headX = pos.x + vel.x
            const headY = pos.y + vel.y
            this.setStretch(s, 'weapons/spas12-bullet', headX, headY, pos.x, pos.y, 1, 1, 0xffffff, 150 / 255) // :882
            if (b.timeOut < BULLET_TIMEOUT - 3) {
              this.setStretch(tr, BULLET_TEX_DEFAULT, pos.x, pos.y, pos.x - vel.x, pos.y - vel.y,
                Math.abs(speed / 9), 1, 0xffffff, Math.floor(BULLETALPHA / 5) / 255) // :888-893
            }
          }
          break
        }

        case BULLET_STYLE_M79: {
          // Bullets.pas:897-929. 탄체는 TimeOutReal*6도(度)로 자체 스핀(:907-908).
          // GfxDrawSprite가 각도를 내부 부호반전(Gfx.pas:1483)하므로 화면상 스핀은 -6°/tick.
          if (b.timeOut < BULLET_TIMEOUT - 2) {
            s.texture = this.tex('weapons/m79-bullet')
            s.visible = true
            s.anchor.set(0, 0)
            s.position.set(pos.x, pos.y + 1) // :900-901
            s.rotation = (-b.timeOut * 6 * Math.PI) / 180 // degtorad(TimeOutReal*6) → 화면 -방향
            s.scale.set(BULLET_TEX_SCALE, BULLET_TEX_SCALE)
            s.tint = 0xffffff
            s.alpha = 252 / 255
            if (b.timeOut < BULLET_TIMEOUT - 4) {
              const ox = vel.y > 0 ? -1 : 1 // :913-920
              const oy = vel.x > 0 ? 1 : -1
              // Roto = 탄체 계산부의 -vel 방향각 재사용 (:902-906), 트레일 위치는 (pos+ox, pos+oy) (:922-923)
              this.setStretch(tr, BULLET_TEX_DEFAULT, pos.x + ox, pos.y + oy,
                pos.x + ox - vel.x, pos.y + oy - vel.y,
                Math.abs(speed / 4), 1.3, 0xffff55, BULLETALPHA / 255) // :924-927
            }
          }
          break
        }

        case BULLET_STYLE_ARROW:
        case BULLET_STYLE_FLAMEARROW: {
          // ARROW: Bullets.pas:940-960 / FLAMEARROW: :962-971 (트레일 없음)
          if (b.timeOut < BULLET_TIMEOUT - 2) {
            const headX = pos.x + vel.x
            const headY = pos.y + vel.y
            this.setStretch(s, 'weapons/arrow', headX, headY, pos.x, pos.y, 1, 1, 0xffffff, 1)
            // 화살 트레일은 박히기 전(TimeOutReal > ARROW_RESIST)에만 (:950-958)
            if (b.style === BULLET_STYLE_ARROW && b.timeOut > ARROW_RESIST) {
              this.setStretch(tr, BULLET_TEX_DEFAULT, pos.x, pos.y, pos.x - vel.x, pos.y - vel.y,
                Math.abs(speed / 3), 1, 0xffffff, Math.floor(BULLETALPHA / 7) / 255) // :953-957
            }
          }
          break
        }

        case BULLET_STYLE_LAW: {
          // Bullets.pas:988-1010
          if (b.timeOut < BULLET_TIMEOUT - 2) {
            const headX = pos.x + vel.x
            const headY = pos.y + vel.y
            this.setStretch(s, 'weapons/missile', headX, headY, pos.x, pos.y, 1, 1, 0xffffff, 1) // :996
            if (b.timeOut < BULLET_TIMEOUT - 7) {
              this.setStretch(tr, BULLET_TEX_DEFAULT, pos.x, pos.y, pos.x - vel.x, pos.y - vel.y,
                Math.abs(speed / 3), 1, 0xffffff, Math.floor(BULLETALPHA / 5) / 255) // :1002-1007
            }
          }
          break
        }

        default: {
          // 미이식 스타일 — 현행 M2 기초 렌더(속도 방향 회전 스프라이트) 유지.
          const key = BULLET_TEX[b.style] ?? BULLET_TEX_DEFAULT
          s.texture = this.tex(key)
          s.visible = true
          s.anchor.set(0.5, 0.5)
          s.position.set(pos.x, pos.y)
          s.rotation = Math.atan2(vel.y, vel.x)
          s.scale.set(BULLET_TEX_SCALE, BULLET_TEX_SCALE)
          s.tint = 0xffffff
          s.alpha = 1
          break
        }
      }

      // "내 총알 주황색" — 내 스프라이트가 쏜 탄환/트레일을 주황 틴트(로컬 렌더 전용, 남에겐 안 보임).
      // "내 총 하이라이트" 설정과 함께 켜진다(내 무기+총알 일관). 스타일별 틴트를 마지막에 덮어씀.
      if (localNum > 0 && b.owner === localNum && getCachedSettings().highlightMyGun) {
        if (s.visible) s.tint = MY_BULLET_TINT
        if (tr.visible) tr.tint = MY_BULLET_TINT
      }
    }
  }

  private syncThings(gs: GameState): void {
    for (let i = 1; i <= MAX_THINGS; i++) {
      const t = gs.thing[i]
      const s = this.slot(this.thingSprites, i)
      const cloth = this.flagCloths[i]
      const key = t ? THING_TEX[t.style] : undefined
      if (!t || !t.active || !key) {
        s.visible = false
        if (cloth) cloth.mesh.visible = false
        continue
      }

      if (isFlagStyle(t.style)) {
        // 깃발 = 천 메시 (Things.pas PolygonsRender:1206-1304). 스프라이트는 숨김.
        s.visible = false
        let c = cloth
        // 컬러가 생성 시 style로 구워지므로, 슬롯이 다른 팀 깃발로 재사용되면 재생성
        // (라운드 리셋/깃발 무결성 가드가 createThing으로 슬롯을 재배정할 수 있음).
        if (c && c.style !== t.style) {
          this.container.removeChild(c.mesh)
          c.mesh.destroy()
          c = undefined
          this.flagCloths[i] = undefined
        }
        if (!c) {
          c = new FlagCloth(this.tex(key), t.style)
          this.container.addChild(c.mesh)
          this.flagCloths[i] = c
        }
        // 리스폰 임박 블링크: TimeOut<300에서 6틱 주기 점멸 (Things.pas:1220-1223)
        if (t.timeOut < 300 && t.timeOut % 6 < 3) {
          c.mesh.visible = false
          continue
        }
        c.mesh.visible = true
        c.update(t.skeleton.pos)
        continue
      }

      if (cloth) cloth.mesh.visible = false
      // 무기드롭/키트: skeleton.pos[1] 기준 단일 스프라이트 (현행 유지).
      const p1 = t.skeleton.pos[1]
      s.texture = this.tex(key)
      s.visible = true
      s.anchor.set(0.5, 0.5)
      s.position.set(p1.x, p1.y)
      s.rotation = 0
      s.tint = 0xffffff
      s.scale.set(THING_TEX_SCALE, THING_TEX_SCALE)
    }
  }

  // 스파크는 수명 페이드 점 — 흰 사각을 style로 tint. 전 스타일 텍스처 매핑은 후속.
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
