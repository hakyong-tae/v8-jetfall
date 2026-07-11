// tools/build-assets.mjs — soldat-ref/base → public/assets 변환 + manifest.json
//
// 원본 에셋(soldat-ref/base, CC BY-4.0)을 public/assets(gitignored 빌드 산출물)로
// 변환/복사하고 manifest.json을 생성한다. 게임 코드는 반드시 manifest를 통해서만
// 에셋을 참조해야 한다 (모딩 요구사항: 폴더/manifest 교체 = 리스킨).
//
// manifest 스키마 (모든 키는 소문자·확장자 제거, 값은 실제 상대경로):
// {
//   "sprites": { "gostek/stopa": "gostek/stopa.png", "weapons/ak74": "weapons/ak74.png",
//                "interface/health": "interface/health.png" },
//   "maps":    { "ctf_ash": "maps/ctf_Ash.pms" },
//   "anims":   { "stoi": "anims/stoi.poa" },
//   "objects": { "gostek": "anims/gostek.po" }
// }
//
// weapons.json / bots.json은 별도 파일로 생성 (ini→JSON, 값은 원본 그대로 — SharedConfig.pas
// ReadWMConf/LoadBotConfig가 읽는 키가 명세):
// {
//   "normal":     { "info": { "name": "...", "version": "..." }, "guns": { "Desert Eagles": { "Damage": 1.81, ... } } },
//   "realistic":  { "info": {...}, "guns": {...} }
// }
// bots.json: { "Admiral": { "Name": "Admiral", "Favourite_Weapon": "FN Minimi", ... } }
import { Jimp } from 'jimp'
import { cp, mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { join, basename, extname, dirname } from 'node:path'

const BASE = '/Users/hytae/Downloads/soldat-ref/base'
const OUT = new URL('../public/assets/', import.meta.url).pathname

// --- ini 파서 (TMemIniFile 대응: [Section] + Key=Value, ';' 주석 무시) ---

function parseIni(text) {
  const sections = {}
  let current = null
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim()
    if (!line || line.startsWith(';')) continue
    const sectionMatch = line.match(/^\[(.+)\]$/)
    if (sectionMatch) {
      current = sectionMatch[1]
      sections[current] = {}
      continue
    }
    const eq = line.indexOf('=')
    if (eq === -1 || !current) continue
    const key = line.slice(0, eq).trim()
    const value = line.slice(eq + 1)
    sections[current][key] = value
  }
  return sections
}

// TStringList.Values[] 조회는 대소문자 무시 (bot 파일의 'Chat_Lowhealth' 등)
function iniValue(section, key) {
  if (!section) return undefined
  const found = Object.keys(section).find((k) => k.toLowerCase() === key.toLowerCase())
  return found === undefined ? undefined : section[found]
}

// 빈 문자열은 그대로 유지 (Number('')===0 함정 방지), 숫자로 읽히면 숫자로 변환
function coerce(raw) {
  if (raw === undefined) return undefined
  if (raw.trim() === '') return ''
  const n = Number(raw)
  return Number.isFinite(n) ? n : raw
}

// SharedConfig.pas:258-274 ReadWMConf가 읽는 무기 키 17종 (섹션명=Gun.IniName)
const WEAPON_KEYS = [
  'Damage', 'FireInterval', 'Ammo', 'ReloadTime', 'Speed', 'BulletStyle',
  'StartUpTime', 'Bink', 'MovementAcc', 'BulletSpread', 'Recoil', 'Push',
  'InheritedVelocity', 'ModifierHead', 'ModifierChest', 'ModifierLegs', 'NoCollision',
]

async function buildWeaponsMod(iniPath) {
  const sections = parseIni(await readFile(iniPath, 'utf8'))
  const info = sections['Info'] ?? {}
  const out = {
    info: { name: iniValue(info, 'Name') ?? '', version: iniValue(info, 'Version') ?? '' },
    guns: {},
  }
  for (const [sectionName, kv] of Object.entries(sections)) {
    if (sectionName === 'Info') continue
    const gun = {}
    for (const key of WEAPON_KEYS) {
      const raw = iniValue(kv, key)
      if (raw !== undefined) gun[key] = coerce(raw)
    }
    out.guns[sectionName] = gun
  }
  return out
}

// SharedConfig.pas:133-220 LoadBotConfig가 [BOT] 섹션에서 읽는 키 전부
const BOT_KEYS = [
  'Name', 'Favourite_Weapon', 'Secondary_Weapon', 'Friend', 'Accuracy', 'Shoot_Dead',
  'Grenade_Frequency', 'OnStartUse', 'Chat_Frequency', 'Chat_Kill', 'Chat_Dead',
  'Chat_LowHealth', 'Chat_SeeEnemy', 'Chat_Winning', 'Camping', 'Color1', 'Color2',
  'Skin_Color', 'Hair_Color', 'Hair', 'Headgear', 'Chain', 'Dummy',
]

async function buildBotEntry(botPath) {
  const sections = parseIni(await readFile(botPath, 'utf8'))
  const bot = sections['BOT']
  if (!bot) return null
  const out = {}
  for (const key of BOT_KEYS) {
    const raw = iniValue(bot, key)
    if (raw !== undefined) out[key] = coerce(raw)
  }
  return out
}

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

// 무기 그래픽 / HUD 그래픽 (기존 convertDir 재사용, sprites에 weapons/interface prefix로 등록)
await convertDir(join(BASE, 'shared/weapons-gfx'), join(OUT, 'weapons'), manifest.sprites, 'weapons')
await convertDir(join(BASE, 'shared/interface-gfx'), join(OUT, 'interface'), manifest.sprites, 'interface')

// 무기 모드 (.ini → weapons.json)
const weapons = {
  normal: await buildWeaponsMod(join(BASE, 'server/configs/weapons.ini')),
  realistic: await buildWeaponsMod(join(BASE, 'server/configs/weapons_realistic.ini')),
}
await writeFile(join(OUT, 'weapons.json'), JSON.stringify(weapons, null, 2))

// 봇 설정 (.bot → bots.json)
const bots = {}
const botsDir = join(BASE, 'server/configs/bots')
for (const f of await readdir(botsDir)) {
  if (!f.toLowerCase().endsWith('.bot')) continue
  const entry = await buildBotEntry(join(botsDir, f))
  if (entry) bots[basename(f, extname(f))] = entry
}
await writeFile(join(OUT, 'bots.json'), JSON.stringify(bots, null, 2))

await writeFile(join(OUT, 'manifest.json'), JSON.stringify(manifest, null, 2))
console.log(
  'assets built:',
  Object.keys(manifest.sprites).length, 'sprites,',
  Object.keys(manifest.maps).length, 'maps,',
  Object.keys(manifest.anims).length, 'anims,',
  Object.keys(manifest.objects).length, 'objects,',
  Object.keys(weapons.normal.guns).length, 'normal guns,',
  Object.keys(weapons.realistic.guns).length, 'realistic guns,',
  Object.keys(bots).length, 'bots,',
  failed, 'failed'
)
if (failed > 0) process.exitCode = 1
