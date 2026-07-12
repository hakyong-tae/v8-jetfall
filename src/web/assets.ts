// 웹 에셋 로더 — manifest.json 기반 fetch 헬퍼 + PIXI 텍스처 로딩.
// core/는 IO-free(리더 주입)이므로 브라우저 fetch는 전부 여기에 모인다 (tests/helpers.ts의 fs 버전과 대칭).
import { Assets, Texture } from 'pixi.js'

export interface Manifest {
  sprites: Record<string, string>
  maps: Record<string, string>
  anims: Record<string, string>
  objects: Record<string, string>
  sfx: Record<string, string>
}

const ASSET_ROOT = '/assets'

export async function loadManifest(): Promise<Manifest> {
  const res = await fetch(`${ASSET_ROOT}/manifest.json`)
  if (!res.ok) throw new Error(`manifest fetch failed: ${res.status}`)
  return (await res.json()) as Manifest
}

// .pms 등 바이너리 (경로는 manifest 값 그대로, ASSET_ROOT 기준 상대)
export async function fetchBinary(relPath: string): Promise<ArrayBuffer> {
  const res = await fetch(`${ASSET_ROOT}/${relPath}`)
  if (!res.ok) throw new Error(`binary fetch failed (${relPath}): ${res.status}`)
  return res.arrayBuffer()
}

// .poa/.po 텍스트 — 원본은 latin1 계열이므로 TextDecoder('latin1') 고정 (UTF-8 디코딩 깨짐 방지)
export async function fetchLines(relPath: string): Promise<string[]> {
  const buf = await fetchBinary(relPath)
  return new TextDecoder('latin1').decode(buf).split(/\r\n|\r|\n/)
}

// Pascal 쪽 경로('anims/stoi.poa', 'objects/gostek.po')의 basename만 취해
// manifest.anims/objects 값으로 해석 — tests/helpers.ts readAssetLines와 동일 규약.
// loadAnimObjects/loadSpriteObjects는 동기 read 콜백을 요구하므로, 필요한 파일 전체를
// 미리 fetch해 Map으로 만든 뒤 동기 리더를 돌려준다.
export async function prefetchAnimFiles(manifest: Manifest): Promise<(name: string) => string[]> {
  const rels = new Map<string, string>() // basename(lower) → relPath
  for (const rel of [...Object.values(manifest.anims), ...Object.values(manifest.objects)]) {
    const base = rel.split('/').pop()!.toLowerCase()
    rels.set(base, rel)
  }
  const cache = new Map<string, string[]>()
  await Promise.all(
    [...rels.entries()].map(async ([base, rel]) => {
      cache.set(base, await fetchLines(rel))
    }),
  )
  return (name: string) => {
    const base = name.split('/').pop()!.toLowerCase()
    const lines = cache.get(base)
    if (!lines) throw new Error(`anim file not prefetched: ${name}`)
    return lines
  }
}

// 'riverbed.bmp' / 'Kamibeach.PNG' 같은 원본 파일명 → manifest.sprites 키.
// 규약(빌드 스크립트): 키 = '<folder>/<basename lowercase, 확장자 제거>' (.bmp→.png 스왑 후 png 저장).
export function spriteKey(folder: string, filename: string): string {
  const base = filename.split('/').pop()!.replace(/\.[^.]+$/, '')
  return `${folder}/${base}`.toLowerCase()
}

export function resolveSprite(manifest: Manifest, key: string): string | undefined {
  return manifest.sprites[key]
}

// PIXI.Assets로 텍스처 로드. 키 미해석/로드 실패 시 null (호출부가 스킵/폴백 판단).
export async function loadTexture(manifest: Manifest, key: string): Promise<Texture | null> {
  const rel = resolveSprite(manifest, key)
  if (!rel) return null
  try {
    return await Assets.load<Texture>(`${ASSET_ROOT}/${rel}`)
  } catch {
    return null
  }
}
