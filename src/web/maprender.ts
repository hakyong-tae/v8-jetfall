// 맵 렌더러 — MapGraphics.pas(LoadMapGraphics:173-760) + GameRendering.pas(RenderFrame:925-995)의
// 웹 포팅. 드로우 순서(원본 GameRendering.pas:940-993):
//   배경 그라데이션 → 뒷폴리곤(BACKPOLY) → props level 0 → (병사/총알) → props level 1
//   → 앞폴리곤 → props level 2
//
// 폴리곤: 단일 Geometry(positions/uvs/per-vertex colors) + 커스텀 셰이더 Mesh.
//   UV는 TMapVertex.u/v를 그대로 사용 (MapGraphics.pas:707-708 — 파일값 그대로 vb에 복사),
//   텍스처는 REPEAT 랩 (MapGraphics.pas:281 GfxTextureWrap(GFX_REPEAT)) — UV가 1을 넘는 타일링.
//   버텍스 색상 = TMapVertex.color RGBA (MapGraphics.pas:710).
// 배경: 상/하단 색 그라데이션 쿼드, y ∈ [-d, +d], d = MAX_SECTOR * max(sectorsDivision,
//   ceil(0.5*GameHeight/MAX_SECTOR)) (MapGraphics.pas:650-652). x는 화면 전체(원본은
//   ortho(0,1) 뷰포트 고정 — 여기선 ±BG_HALF_WIDTH 대형 쿼드 + 카메라 y만 추종).
// 씬 프롭: TMapProp → PIXI.Sprite. isPropActive 필터, level 0/1/2 컨테이너 분리
//   (MapGraphics.pas:415-421). 쿼드 수식은 GfxSpriteVertices(Prop.x, Prop.y, W, H,
//   ScaleX, ScaleY, cx=0, cy=1, r=-Rotation) (MapGraphics.pas:557-558) — 피벗(0,1)은
//   스케일 공간 1px 오프셋이라 무시하고 좌상단 앵커로 근사.
import { Container, Geometry, Mesh, Shader, Sprite, Texture } from 'pixi.js'
import type { TMapFile } from '../core/mapfile'
import { isPropActive } from '../core/mapfile'
import { MAX_SECTOR } from '../core/polymap'
import type { Manifest } from './assets'
import { loadTexture, spriteKey } from './assets'

// PolyMap.pas:46-47 (렌더 전용이라 core/constants.ts에 없음 — 여기 로컬 정의)
export const POLY_TYPE_BACKGROUND = 24
export const POLY_TYPE_BACKGROUND_TRANSITION = 25

const GAME_HEIGHT = 480 // Client.pas 기준 논리 화면 높이 (배경 d 계산용)
const BG_HALF_WIDTH = 20000 // 배경 쿼드 x 반폭 — 어떤 뷰포트에서도 화면을 덮는 대형 값

export function isBackPoly(polyType: number): boolean {
  return polyType === POLY_TYPE_BACKGROUND || polyType === POLY_TYPE_BACKGROUND_TRANSITION
}

export interface PolyBuffers {
  positions: Float32Array // triCount*3 정점 × (x,y)
  uvs: Float32Array // triCount*3 × (u,v)
  colors: Float32Array // triCount*3 × (r,g,b,a) — premultiplied alpha
  triCount: number
}

// MapGraphics.pas:683-716 폴리곤 → 버텍스 버퍼. which로 레벨 분리
// ('back' = BACKPOLY(level 0), 'front' = 나머지(level 1), 'all' = 전체 — 스모크 테스트용).
export function buildPolyBuffers(mapFile: TMapFile, which: 'back' | 'front' | 'all'): PolyBuffers {
  const polys = mapFile.polygons.filter((p) =>
    which === 'all' ? true : which === 'back' ? isBackPoly(p.polyType) : !isBackPoly(p.polyType),
  )
  const triCount = polys.length
  const positions = new Float32Array(triCount * 3 * 2)
  const uvs = new Float32Array(triCount * 3 * 2)
  const colors = new Float32Array(triCount * 3 * 4)

  let vi = 0
  for (const poly of polys) {
    for (let j = 1; j <= 3; j++) {
      const v = poly.vertices[j as 1 | 2 | 3]
      positions[vi * 2] = v.x
      positions[vi * 2 + 1] = v.y
      uvs[vi * 2] = v.u
      uvs[vi * 2 + 1] = v.v
      const a = v.color[3] / 255
      colors[vi * 4] = (v.color[0] / 255) * a
      colors[vi * 4 + 1] = (v.color[1] / 255) * a
      colors[vi * 4 + 2] = (v.color[2] / 255) * a
      colors[vi * 4 + 3] = a
      vi++
    }
  }
  return { positions, uvs, colors, triCount }
}

// 버텍스 컬러 지원 셰이더 (PIXI v8 Mesh 커스텀 GlProgram — WebGL 전용, main.ts에서
// preference:'webgl' 강제). uProjection/uWorldTransform/uTransform은 파이프라인 제공 유니폼.
// export: bulletsrender.ts 깃발 천 메시(FlagCloth)도 동일 per-vertex color 셰이더 사용.
export const VERTEX_SRC = `
  in vec2 aPosition;
  in vec2 aUV;
  in vec4 aColor;

  out vec2 vUV;
  out vec4 vColor;

  uniform mat3 uProjectionMatrix;
  uniform mat3 uWorldTransformMatrix;
  uniform mat3 uTransformMatrix;

  void main() {
    mat3 mvp = uProjectionMatrix * uWorldTransformMatrix * uTransformMatrix;
    gl_Position = vec4((mvp * vec3(aPosition, 1.0)).xy, 0.0, 1.0);
    vUV = aUV;
    vColor = aColor;
  }
`

export const FRAGMENT_SRC = `
  in vec2 vUV;
  in vec4 vColor;
  uniform sampler2D uTexture;

  void main() {
    gl_FragColor = texture(uTexture, vUV) * vColor;
  }
`

export function createPolyMesh(bufs: PolyBuffers, texture: Texture): Mesh<Geometry, Shader> {
  // Soldat 맵 텍스처는 타일링 — REPEAT 랩 (UV > 1)
  texture.source.style.addressMode = 'repeat'
  texture.source.style.update()

  const geometry = new Geometry({
    attributes: { aPosition: bufs.positions, aUV: bufs.uvs, aColor: bufs.colors },
  })
  const shader = Shader.from({
    gl: { vertex: VERTEX_SRC, fragment: FRAGMENT_SRC },
    resources: { uTexture: texture.source, uSampler: texture.source.style },
  })
  return new Mesh({ geometry, shader })
}

// 배경 그라데이션 (MapGraphics.pas:648-676 + GameRendering.pas:933-942).
// 상단/하단 캡 쿼드를 추가해 ±d 밖도 원본 GfxClear(top/btm) 동작과 동일하게 덮는다.
export function createBackgroundMesh(mapFile: TMapFile): Mesh<Geometry, Shader> {
  const d = MAX_SECTOR * Math.max(mapFile.sectorsDivision, Math.ceil((0.5 * GAME_HEIGHT) / MAX_SECTOR))
  const top = mapFile.bgColorTop
  const btm = mapFile.bgColorBtm
  const BIG = 100000

  const w = BG_HALF_WIDTH
  // 3개 쿼드(top cap, gradient, bottom cap) × 6정점
  const quads: Array<{ y0: number; y1: number; c0: number[]; c1: number[] }> = [
    { y0: -BIG, y1: -d, c0: [...top], c1: [...top] },
    { y0: -d, y1: d, c0: [...top], c1: [...btm] },
    { y0: d, y1: BIG, c0: [...btm], c1: [...btm] },
  ]

  const positions = new Float32Array(quads.length * 6 * 2)
  const uvs = new Float32Array(quads.length * 6 * 2) // 전부 0 (white 텍스처)
  const colors = new Float32Array(quads.length * 6 * 4)

  let vi = 0
  const push = (x: number, y: number, c: number[]) => {
    positions[vi * 2] = x
    positions[vi * 2 + 1] = y
    colors[vi * 4] = c[0] / 255
    colors[vi * 4 + 1] = c[1] / 255
    colors[vi * 4 + 2] = c[2] / 255
    colors[vi * 4 + 3] = 1 // mg.BgColorTop/Btm.a := 255 (MapGraphics.pas:668-669)
    vi++
  }
  for (const q of quads) {
    push(-w, q.y0, q.c0)
    push(w, q.y0, q.c0)
    push(w, q.y1, q.c1)
    push(w, q.y1, q.c1)
    push(-w, q.y1, q.c1)
    push(-w, q.y0, q.c0)
  }

  const geometry = new Geometry({
    attributes: { aPosition: positions, aUV: uvs, aColor: colors },
  })
  const shader = Shader.from({
    gl: { vertex: VERTEX_SRC, fragment: FRAGMENT_SRC },
    resources: { uTexture: Texture.WHITE.source, uSampler: Texture.WHITE.source.style },
  })
  return new Mesh({ geometry, shader })
}

// 씬 프롭 → level 0/1/2 컨테이너 (behind-all / middle(병사 위·앞폴리곤 아래) / front).
// 원본 프롭 드로우 순서 = 레벨 내 props 배열 순서 (MapGraphics.pas:514-565) — 그대로 유지.
export async function buildPropLayers(
  mapFile: TMapFile,
  manifest: Manifest,
): Promise<[Container, Container, Container]> {
  const layers: [Container, Container, Container] = [new Container(), new Container(), new Container()]

  // 사용되는 scenery style만 텍스처 로드 (MapGraphics.pas:322-358 필터링과 동일 취지)
  const usedStyles = new Set<number>()
  for (let i = 0; i < mapFile.props.length; i++) {
    if (isPropActive(mapFile, i)) usedStyles.add(mapFile.props[i].style)
  }
  const textures = new Map<number, Texture>()
  await Promise.all(
    [...usedStyles].map(async (style) => {
      const filename = mapFile.scenery[style - 1].filename
      const tex = await loadTexture(manifest, spriteKey('scenery', filename))
      if (tex) textures.set(style, tex)
    }),
  )

  for (let i = 0; i < mapFile.props.length; i++) {
    if (!isPropActive(mapFile, i)) continue
    const prop = mapFile.props[i]
    const tex = textures.get(prop.style)
    if (!tex) continue // 텍스처 누락 프롭 스킵

    const sprite = new Sprite(tex)
    sprite.anchor.set(0, 0)
    sprite.position.set(prop.x, prop.y)
    sprite.rotation = -prop.rotation // GfxSpriteVertices(..., -Prop.Rotation) (MapGraphics.pas:558)
    // 쿼드 크기 = Prop.Width/Height × Scale (텍스처 원본 크기와 무관 — MapGraphics.pas:557)
    sprite.scale.set(
      (prop.scaleX * prop.width) / tex.width,
      (prop.scaleY * prop.height) / tex.height,
    )
    sprite.tint = (prop.color[0] << 16) | (prop.color[1] << 8) | prop.color[2]
    sprite.alpha = prop.alpha / 255 // Color = RGBA(rgb, Prop.Alpha) (MapGraphics.pas:555)
    layers[prop.level].addChild(sprite)
  }

  return layers
}

// 맵 텍스처의 manifest 키 ('riverbed.bmp' → 'textures/riverbed')
export function mapTextureKey(mapFile: TMapFile): string {
  return spriteKey('textures', mapFile.textures[0])
}
