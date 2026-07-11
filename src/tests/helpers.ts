// Node 전용 테스트 헬퍼 — 실제 게임 에셋(맵/애니메이션/스켈레톤)을 로드한 GameState 를 만든다.
// core 모듈은 IO-free 원칙(파일 리더 주입)을 유지하므로 node:fs 사용은 여기(tests)에만 있다.
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import { createGameState, type GameState } from '../core/state'
import { loadAnimObjects } from '../core/anims'
import { loadMapFile } from '../core/mapfile'
import { loadSpriteObjects } from '../core/sprites'

const assetsDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../public/assets')

// Pascal 쪽 경로('anims/stoi.poa', 'objects/gostek.po')를 그대로 받아 이 레포의
// public/assets/anims/<basename> 으로 매핑한다 (skeleton .po 파일들도 anims/ 에 있음).
export function readAssetLines(name: string): string[] {
  const file = path.join(assetsDir, 'anims', path.basename(name))
  return readFileSync(file, 'utf-8').split(/\r\n|\r|\n/)
}

export function loadTestMap(gs: GameState, mapName = 'ctf_Ash.pms'): void {
  const buf = readFileSync(path.join(assetsDir, 'maps', mapName))
  const mapFile = loadMapFile(new Uint8Array(buf).buffer as ArrayBuffer)
  gs.map.loadData(mapFile)
}

// GameState 풀 셋업: 애니메이션 44종 + SpriteParts/GostekSkeleton + ctf_Ash 맵.
export function setupTestGame(): GameState {
  const gs = createGameState()
  gs.anims = loadAnimObjects(readAssetLines)
  loadSpriteObjects(gs, readAssetLines)
  loadTestMap(gs)
  return gs
}
