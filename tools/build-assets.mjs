// tools/build-assets.mjs — soldat-ref/base → public/assets 변환 + manifest.json
//
// 원본 에셋(soldat-ref/base, CC BY-4.0)을 public/assets(gitignored 빌드 산출물)로
// 변환/복사하고 manifest.json을 생성한다. 게임 코드는 반드시 manifest를 통해서만
// 에셋을 참조해야 한다 (모딩 요구사항: 폴더/manifest 교체 = 리스킨).
//
// manifest 스키마 (모든 키는 소문자·확장자 제거, 값은 실제 상대경로):
// {
//   "sprites": { "gostek/stopa": "gostek/stopa.png" },
//   "maps":    { "ctf_ash": "maps/ctf_Ash.pms" },
//   "anims":   { "stoi": "anims/stoi.poa" },
//   "objects": { "gostek": "anims/gostek.po" }
// }
import { Jimp } from 'jimp'
import { cp, mkdir, readdir, rm, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { join, basename, extname, dirname } from 'node:path'

const BASE = '/Users/hytae/Downloads/soldat-ref/base'
const OUT = new URL('../public/assets/', import.meta.url).pathname

if (!existsSync(BASE)) {
  console.error(`[build-assets] source asset dir not found: ${BASE}`)
  console.error('[build-assets] clone the Soldat base assets repo to that path first.')
  process.exit(1)
}

// 재실행 시 결정적 결과를 위해 출력 디렉토리 초기화
await rm(OUT, { recursive: true, force: true })

// (0,255,0) 그린 컬러키 배경을 알파 투명으로 변환
const GREEN_R = 0
const GREEN_G = 255
const GREEN_B = 0

let failed = 0

async function convertDir(srcDir, outDir, manifest, keyPrefix) {
  await mkdir(outDir, { recursive: true })
  const entries = await readdir(srcDir, { recursive: true })
  for (const f of entries) {
    const src = join(srcDir, f)
    const ext = extname(f).toLowerCase()
    const rel = f.split('\\').join('/') // 안전하게 forward slash 통일 (윈도우 대비)

    if (ext === '.png') {
      const outPath = join(outDir, f)
      await mkdir(dirname(outPath), { recursive: true })
      await cp(src, outPath)
      const key = `${keyPrefix}/${rel.replace(/\.png$/i, '')}`.toLowerCase()
      manifest[key] = `${keyPrefix}/${rel}`
    } else if (ext === '.bmp') {
      try {
        const img = await Jimp.read(src)
        // 그린 컬러키(0,255,0) → 투명
        img.scan(0, 0, img.bitmap.width, img.bitmap.height, function (x, y, idx) {
          const d = this.bitmap.data
          if (d[idx] === GREEN_R && d[idx + 1] === GREEN_G && d[idx + 2] === GREEN_B) {
            d[idx + 3] = 0
          }
        })
        const outRel = rel.replace(/\.bmp$/i, '.png')
        const outPath = join(outDir, outRel)
        await mkdir(dirname(outPath), { recursive: true })
        await img.write(outPath)
        const key = `${keyPrefix}/${rel.replace(/\.bmp$/i, '')}`.toLowerCase()
        manifest[key] = `${keyPrefix}/${outRel}`
      } catch (err) {
        failed++
        console.error(`[build-assets] BMP conversion failed, skipping: ${src}`)
        console.error(`  ${err?.message ?? err}`)
      }
    }
    // 그 외 확장자(.gif, .txt 등)는 스킵
  }
}

const manifest = { sprites: {}, maps: {}, anims: {}, objects: {} }

await convertDir(join(BASE, 'shared/gostek-gfx'), join(OUT, 'gostek'), manifest.sprites, 'gostek')
await convertDir(join(BASE, 'shared/textures'), join(OUT, 'textures'), manifest.sprites, 'textures')
await convertDir(join(BASE, 'shared/scenery-gfx'), join(OUT, 'scenery'), manifest.sprites, 'scenery')

// 맵 (.pms) — 파일은 원본 대소문자 유지, 키는 소문자
await mkdir(join(OUT, 'maps'), { recursive: true })
for (const f of await readdir(join(BASE, 'shared/maps'))) {
  if (f.toLowerCase().endsWith('.pms')) {
    await cp(join(BASE, 'shared/maps', f), join(OUT, 'maps', f))
    manifest.maps[basename(f, extname(f)).toLowerCase()] = `maps/${f}`
  }
}

// 애니메이션 (.poa) — shared/anims/
await mkdir(join(OUT, 'anims'), { recursive: true })
for (const f of await readdir(join(BASE, 'shared/anims'))) {
  if (f.toLowerCase().endsWith('.poa')) {
    await cp(join(BASE, 'shared/anims', f), join(OUT, 'anims', f))
    manifest.anims[basename(f, extname(f)).toLowerCase()] = `anims/${f}`
  }
}

// 스켈레톤/오브젝트 정의 (.po) — shared/objects/ (gostek.po, flag.po 등)
// 원본 저장소에서는 anims/가 아니라 objects/ 폴더에 위치한다.
for (const f of await readdir(join(BASE, 'shared/objects'))) {
  if (f.toLowerCase().endsWith('.po')) {
    await cp(join(BASE, 'shared/objects', f), join(OUT, 'anims', f))
    manifest.objects[basename(f, extname(f)).toLowerCase()] = `anims/${f}`
  }
}

await writeFile(join(OUT, 'manifest.json'), JSON.stringify(manifest, null, 2))
console.log(
  'assets built:',
  Object.keys(manifest.sprites).length, 'sprites,',
  Object.keys(manifest.maps).length, 'maps,',
  Object.keys(manifest.anims).length, 'anims,',
  Object.keys(manifest.objects).length, 'objects,',
  failed, 'failed'
)
if (failed > 0) process.exitCode = 1
