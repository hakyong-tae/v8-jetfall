// tools/build-assets.mjs — soldat-ref/base → public/assets 변환 + manifest.json
//
// 원본 에셋(soldat-ref/base, CC BY-4.0)을 public/assets(gitignored 빌드 산출물)로
// 변환/복사하고 manifest.json을 생성한다. 게임 코드는 반드시 manifest를 통해서만
// 에셋을 참조해야 한다 (모딩 요구사항: 폴더/manifest 교체 = 리스킨).
import { Jimp } from 'jimp'
import { cp, mkdir, readdir, writeFile } from 'node:fs/promises'
import { join, basename, extname, dirname } from 'node:path'

const BASE = '/Users/hytae/Downloads/soldat-ref/base'
const OUT = new URL('../public/assets/', import.meta.url).pathname

// 0(그린), 255, 0 컬러키 배경을 알파 투명으로 변환
const GREEN_R = 0
const GREEN_G = 255
const GREEN_B = 0

async function convertDir(srcDir, outDir, manifest, keyPrefix) {
  await mkdir(outDir, { recursive: true })
  const entries = await readdir(srcDir, { recursive: true })
  for (const f of entries) {
    const src = join(srcDir, f)
    const ext = extname(f).toLowerCase()
    const key = f.split('\\').join('/') // 안전하게 forward slash 통일 (윈도우 대비)

    if (ext === '.png') {
      const outPath = join(outDir, f)
      await mkdir(dirname(outPath), { recursive: true })
      await cp(src, outPath)
      manifest[`${keyPrefix}/${key.replace(/\.png$/i, '')}`] = `${keyPrefix}/${key}`
    } else if (ext === '.bmp') {
      const img = await Jimp.read(src)
      // 그린 컬러키(0,255,0) → 투명
      img.scan(0, 0, img.bitmap.width, img.bitmap.height, function (x, y, idx) {
        const d = this.bitmap.data
        if (d[idx] === GREEN_R && d[idx + 1] === GREEN_G && d[idx + 2] === GREEN_B) {
          d[idx + 3] = 0
        }
      })
      const outKey = key.replace(/\.bmp$/i, '.png')
      const outPath = join(outDir, outKey)
      await mkdir(dirname(outPath), { recursive: true })
      await img.write(outPath)
      manifest[`${keyPrefix}/${key.replace(/\.bmp$/i, '')}`] = `${keyPrefix}/${outKey}`
    }
    // 그 외 확장자(.gif, .txt 등)는 스킵
  }
}

const manifest = { sprites: {}, maps: [], anims: [] }

await convertDir(join(BASE, 'shared/gostek-gfx'), join(OUT, 'gostek'), manifest.sprites, 'gostek')
await convertDir(join(BASE, 'shared/textures'), join(OUT, 'textures'), manifest.sprites, 'textures')
await convertDir(join(BASE, 'shared/scenery-gfx'), join(OUT, 'scenery'), manifest.sprites, 'scenery')

// 맵 (.pms)
await mkdir(join(OUT, 'maps'), { recursive: true })
for (const f of await readdir(join(BASE, 'shared/maps'))) {
  if (f.toLowerCase().endsWith('.pms')) {
    await cp(join(BASE, 'shared/maps', f), join(OUT, 'maps', f))
    manifest.maps.push(basename(f, extname(f)))
  }
}

// 애니메이션 (.poa) — shared/anims/
await mkdir(join(OUT, 'anims'), { recursive: true })
for (const f of await readdir(join(BASE, 'shared/anims'))) {
  if (f.toLowerCase().endsWith('.poa')) {
    await cp(join(BASE, 'shared/anims', f), join(OUT, 'anims', f))
    manifest.anims.push(f)
  }
}

// 스켈레톤/오브젝트 정의 (.po) — shared/objects/ (gostek.po, flag.po 등)
// 원본 저장소에서는 anims/가 아니라 objects/ 폴더에 위치한다.
for (const f of await readdir(join(BASE, 'shared/objects'))) {
  if (f.toLowerCase().endsWith('.po')) {
    await cp(join(BASE, 'shared/objects', f), join(OUT, 'anims', f))
    manifest.anims.push(f)
  }
}

await writeFile(join(OUT, 'manifest.json'), JSON.stringify(manifest, null, 2))
console.log(
  'assets built:',
  Object.keys(manifest.sprites).length, 'sprites,',
  manifest.maps.length, 'maps,',
  manifest.anims.length, 'anims'
)
