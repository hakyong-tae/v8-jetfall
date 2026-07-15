// server/host-assets.ts — Node fs 에셋 로더(설계 결정 2). tests/helpers.ts + web/main.ts의
// loadGameAssets를 fs 버전으로 합친 것 — 의도적 중복(런타임/테스트 경계 분리).
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import { createGameState, loadThingObjects, type GameState } from '../src/core/state'
import { loadAnimObjects } from '../src/core/anims'
import { loadSpriteObjects } from '../src/core/sprites'
import { loadMapFile } from '../src/core/mapfile'
import { loadWaypoints } from '../src/core/waypoints'
import { createWeapons, loadWeaponsConfig, type WeaponsIniConfig } from '../src/core/weapons'
import { wireGameHooks } from '../src/core/game'
import { GAMESTYLE_CTF, GAMESTYLE_DEATHMATCH } from '../src/core/constants'

const assetsDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../public/assets')

function readAssetLines(name: string): string[] {
  return readFileSync(path.join(assetsDir, 'anims', path.basename(name)), 'utf-8').split(/\r\n|\r|\n/)
}

export function loadHostGame(opts: { ctf: boolean; mapName?: string }): GameState {
  const gs = createGameState()
  wireGameHooks(gs)
  gs.anims = loadAnimObjects(readAssetLines)
  loadSpriteObjects(gs, readAssetLines)
  loadThingObjects(gs, readAssetLines)

  const mapBuf = readFileSync(path.join(assetsDir, 'maps', opts.mapName ?? 'ctf_Ash.pms'))
  const mapFile = loadMapFile(new Uint8Array(mapBuf).buffer as ArrayBuffer)
  gs.map.loadData(mapFile)
  loadWaypoints(gs.botPath, mapFile.waypoints)

  createWeapons(false)
  const weaponsJson = JSON.parse(readFileSync(path.join(assetsDir, 'weapons.json'), 'utf-8')) as { normal: WeaponsIniConfig }
  loadWeaponsConfig(weaponsJson.normal)

  gs.svGamemode = opts.ctf ? GAMESTYLE_CTF : GAMESTYLE_DEATHMATCH
  gs.svKilllimit = opts.ctf ? 10 : 9999
  // M7 Task2: 리스폰 3초 무적(180틱) — 전용 Node 호스트도 웹 로더와 동일하게 맞춘다.
  gs.ceaseFireTime = 180
  return gs
}
