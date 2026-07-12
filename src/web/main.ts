// 웹 부트스트랩 — 에셋 로드 → GameState 구성 → PIXI 씬 구성 → 60Hz 고정스텝 루프.
// 씬 드로우 순서는 원본 GameRendering.pas RenderFrame(925-995) 그대로:
//   배경 → 뒷폴리곤 → props0 → 병사 → props1 → 앞폴리곤 → props2
import { Application, Container, Text } from 'pixi.js'
import { createGameState, loadThingObjects } from '../core/state'
import { loadAnimObjects } from '../core/anims'
import {
  loadSpriteObjects,
  createSprite,
  createTPlayer,
  randomizeStart,
  addBotPlayer,
  type BotConfigEntry,
} from '../core/sprites'
import { createWeapons, loadWeaponsConfig, guns, AK74, type WeaponsIniConfig } from '../core/weapons'
import { loadMapFile } from '../core/mapfile'
import { loadWaypoints } from '../core/waypoints'
import { updateFrame, wireGameHooks } from '../core/game'
import {
  TEAM_NONE,
  TEAM_ALPHA,
  TEAM_BRAVO,
  GAMESTYLE_DEATHMATCH,
  GAMESTYLE_CTF,
} from '../core/constants'
import { vector2 } from '../core/vector'
import { loadManifest, prefetchAnimFiles, fetchBinary, loadTexture } from './assets'
import {
  buildPolyBuffers,
  createPolyMesh,
  createBackgroundMesh,
  buildPropLayers,
  mapTextureKey,
} from './maprender'
import { GostekPool, loadGostekTextures } from './gostek'
import { BulletsRenderer } from './bulletsrender'
import { Hud } from './hud'
import { SoundSystem, wireSound } from './sound'
import { InputState } from './input'
import { Camera } from './camera'

const MAP_NAME = 'ctf_ash' // manifest.maps 키
const TICK_MS = 1000 / 60 // 16.6667ms 고정스텝
const MAX_CATCHUP_TICKS = 5
const NUM_BOTS = 4 // DM 봇 수 (CTF는 팀당 절반)

async function boot(): Promise<void> {
  // ── 에셋 + 심 상태 (tests/helpers.ts setupTestGame의 브라우저판)
  const manifest = await loadManifest()
  const read = await prefetchAnimFiles(manifest)

  const gs = createGameState()
  wireGameHooks(gs) // gs.sortPlayers 훅 배선 (T10)
  gs.anims = loadAnimObjects(read)
  loadSpriteObjects(gs, read)
  loadThingObjects(gs, read)

  // ── 무기 데이터 (이게 없으면 총이 전부 0값 → 재장전 루프에 갇혀 웅크린 포즈가 됨)
  createWeapons(false)
  const weaponsJson = (await (await fetch('/assets/weapons.json')).json()) as { normal: WeaponsIniConfig }
  loadWeaponsConfig(weaponsJson.normal)

  const mapFile = loadMapFile(await fetchBinary(manifest.maps[MAP_NAME]))
  gs.map.loadData(mapFile)
  loadWaypoints(gs.botPath, mapFile.waypoints) // PolyMap.pas:236-255 BotPath 브리지

  // ── 게임모드 (URL ?mode=ctf → CTF, 아니면 DM). CTF면 CTF 깃발 무결성 가드가 첫 틱에 깃발 스폰.
  const params = new URLSearchParams(window.location.search)
  const ctf = params.get('mode') === 'ctf'
  gs.svGamemode = ctf ? GAMESTYLE_CTF : GAMESTYLE_DEATHMATCH
  gs.svKilllimit = ctf ? 10 : 9999 // DM은 소크 중 라운드 리셋 방지(디버그 편의), CTF는 기본 캡

  // ── 플레이어 1명 스폰 (CTF=alpha, DM=무팀)
  const playerTeam = ctf ? TEAM_ALPHA : TEAM_NONE
  const player = createTPlayer()
  player.name = 'Web'
  player.team = playerTeam
  const r = randomizeStart(gs, playerTeam)
  const me = createSprite(gs, r.start, vector2(0, 0), 1, 255, player, true)
  if (me < 0) throw new Error('createSprite failed')
  // AK-74 + 보조권총 로드아웃 (respawn이 selWeapon/secWep 규칙대로 지급 — Respawn 3580-3612)
  gs.sprite[me].selWeapon = guns[AK74].num
  gs.sprite[me].player!.secWep = 0
  gs.sprite[me].respawn()

  // ── 봇 스폰 (bots.json). DM=무팀 N기, CTF=팀당 N/2기(플레이어 alpha 보정 위해 bravo 우선).
  const bots = (await (await fetch('/assets/bots.json')).json()) as Record<string, BotConfigEntry>
  const botNames = Object.keys(bots)
  if (ctf) {
    for (let i = 0; i < NUM_BOTS; i++) {
      const team = i % 2 === 0 ? TEAM_BRAVO : TEAM_ALPHA
      addBotPlayer(gs, bots[botNames[i % botNames.length]], team)
    }
  } else {
    for (let i = 0; i < NUM_BOTS; i++) {
      addBotPlayer(gs, bots[botNames[i % botNames.length]], TEAM_NONE)
    }
  }

  // ── PIXI (커스텀 GlProgram 셰이더 사용 — WebGL 강제)
  const app = new Application()
  await app.init({
    preference: 'webgl',
    resizeTo: window,
    antialias: false,
    background: 0x000000,
  })
  document.body.appendChild(app.canvas)

  // ── 씬 구성
  const mapTexture = await loadTexture(manifest, mapTextureKey(mapFile))
  if (!mapTexture) throw new Error(`map texture missing: ${mapTextureKey(mapFile)}`)
  const gostekTextures = await loadGostekTextures(manifest)
  const [props0, props1, props2] = await buildPropLayers(mapFile, manifest)

  const bgLayer = new Container()
  bgLayer.addChild(createBackgroundMesh(mapFile))

  // 탄환/씽/스파크 + HUD 렌더러 (텍스처 프리로드)
  const entities = new BulletsRenderer()
  await entities.load(manifest)
  const hud = new Hud()
  await hud.load(manifest)

  const world = new Container()
  const backBufs = buildPolyBuffers(mapFile, 'back')
  if (backBufs.triCount > 0) world.addChild(createPolyMesh(backBufs, mapTexture)) // ctf_Ash 등 BACKPOLY 0개 맵 대비
  world.addChild(props0)
  const gostek = new GostekPool(gostekTextures)
  world.addChild(gostek.container)
  world.addChild(entities.container) // 탄환/씽/스파크는 병사와 같은 월드 레이어(카메라 추종)
  world.addChild(props1)
  const frontBufs = buildPolyBuffers(mapFile, 'front')
  if (frontBufs.triCount > 0) world.addChild(createPolyMesh(frontBufs, mapTexture))
  world.addChild(props2)

  app.stage.addChild(bgLayer)
  app.stage.addChild(world)
  app.stage.addChild(hud.container) // HUD는 화면 고정(월드 밖)

  // ── 사운드 (WebAudio) — gs.playSound 훅 배선. AudioContext는 첫 사용자 제스처 후 resume.
  const sound = new SoundSystem(manifest)

  // ── 디버그 오버레이
  const debug = new Text({
    text: '',
    style: { fill: 0xffffff, fontSize: 12, fontFamily: 'monospace' },
  })
  debug.position.set(8, 8)
  app.stage.addChild(debug)

  // ── 입력/카메라
  const input = new InputState()
  input.attach(app.canvas)
  const camera = new Camera()

  const spr = gs.sprite[me]

  // 사운드 초기화(카메라 필요) 후 gs.playSound 배선. 실패해도(WebAudio 미지원) 무음 진행.
  await sound.init(camera)
  wireSound(gs, sound)

  // 개발 콘솔 디버그 핸들
  ;(window as unknown as Record<string, unknown>).__soldat = {
    gs,
    me,
    camera,
    input,
    app,
    // rAF 스로틀 환경(헤드리스 프리뷰)용 수동 스텝퍼
    step: (n: number) => {
      for (let i = 0; i < n; i++) {
        input.applyTo(spr.control, camera.x, camera.y, app.screen.width, app.screen.height)
        updateFrame(gs)
      }
      gostek.update(gs)
      entities.update(gs)
      hud.update(gs, me, app.screen.width, app.screen.height)
      app.render()
    },
  }

  // ── 60Hz 고정스텝 루프 (rAF 누산기, 최대 5틱 캐치업)
  let acc = 0
  app.ticker.add((ticker) => {
    acc += ticker.deltaMS
    let ticks = 0
    while (acc >= TICK_MS && ticks < MAX_CATCHUP_TICKS) {
      input.applyTo(spr.control, camera.x, camera.y, app.screen.width, app.screen.height)
      updateFrame(gs)
      acc -= TICK_MS
      ticks++
    }
    if (ticks === MAX_CATCHUP_TICKS) acc = 0 // 스파이럴 방지 — 밀린 시간 폐기

    // ── 렌더 동기화 (맵/프롭은 정적, 병사·탄환·씽·HUD·카메라 갱신)
    gostek.update(gs)
    entities.update(gs)
    hud.update(gs, me, app.screen.width, app.screen.height)

    const px = gs.spriteParts.pos[me].x
    const py = gs.spriteParts.pos[me].y
    camera.update(px, py, input.mouseX, input.mouseY, app.screen.width, app.screen.height)

    world.position.set(app.screen.width / 2 - camera.x, app.screen.height / 2 - camera.y)
    bgLayer.position.set(app.screen.width / 2, app.screen.height / 2 - camera.y)

    debug.text =
      `FPS ${ticker.FPS.toFixed(0)}\n` +
      `pos ${px.toFixed(1)}, ${py.toFixed(1)}\n` +
      `onGround ${spr.onGround}\n` +
      `jets ${spr.jetsCount}`
  })
}

boot().catch((err) => {
  console.error('boot failed:', err)
  const pre = document.createElement('pre')
  pre.style.color = '#f66'
  pre.textContent = `boot failed: ${err instanceof Error ? err.stack : String(err)}`
  document.body.appendChild(pre)
})
