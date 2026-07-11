// 1:1 포팅: soldat-ref/soldat/shared/MapFile.pas (462 lines)
// PMS 바이너리 맵 파일 파서. 별도 포맷 스펙 문서가 없으므로 LoadMapFile의 읽기 순서와
// 레코드 정의 자체가 스펙이다 — 이 파일은 그 순서를 정확히 그대로 옮긴 것이다.
//
// 파일 IO 미번역: 원본 시그니처는 LoadMapFile(MapInfo: TMapInfo; var Map: TMapFile): Boolean
// 이고 ReadAllBytes가 PHYSFS로 직접 파일을 읽지만, 이 포트는 파일 IO를 하지 않고
// 호출자가 이미 읽은 ArrayBuffer를 받는다(태스크 지시대로). 그 결과 TMapFile.MapInfo /
// Filename 필드(둘 다 함수 인자 TMapInfo에서 단순 복사되는 값이고 바이너리 포맷의
// 일부가 아님)는 이 인터페이스에서 생략했다 — 필요하면 호출자가 별도로 붙일 것.
//
// 버전 검사 없음: 원본 LoadMapFile은 Map.Version을 읽어 저장하기만 할 뿐 실제로
// 비교/검증하지 않는다(Version이 기대값과 다르다고 Exit하는 코드가 원본에 없다 —
// MapFile.pas:288 참조). 따라서 이 포트도 버전을 검증하지 않는다.
// 실패(원본의 Result:=False; Exit)는 오직 각 섹션의 개수(n)가 음수이거나 해당 MAX_*
// 한도를 넘을 때만 발생하며, 그 경우 이 포트는 Error를 throw한다.
//
// MAX_* 상수는 Constants.pas가 아니라 PolyMap.pas / Waypoints.pas에 있다. PolyMap.pas가 이제
// 포팅되었으므로(polymap.ts) MAX_POLYS/MAX_SECTOR/MAX_PROPS/MAX_SPAWNPOINTS/MAX_COLLIDERS는
// 거기서 import한다(단일 출처 — 이 파일에 중복 정의하지 않는다). Waypoints.pas는 아직
// 포팅되지 않았으므로 MAX_WAYPOINTS/MAX_CONNECTIONS만 로컬로 남는다.

import type { TVector3 } from './vector'
import { MAX_POLYS, MAX_SECTOR, MAX_PROPS, MAX_SPAWNPOINTS, MAX_COLLIDERS } from './polymap'

const MAX_WAYPOINTS = 5000 // Waypoints.pas:14
const MAX_CONNECTIONS = 20 // Waypoints.pas:15

// ReadString 로컬 버퍼 크기: `s: array[0..128] of AnsiChar` (MapFile.pas:216) — 129칸.
// MaxSize(38/24/50 등) 와는 별개의, 길이 프리픽스가 담을 수 있는 최대값 한도다.
const STRING_LOCAL_BUF_LEN = 129

// [r,g,b,a] — MapFile.pas:10 `array[0..3] of Byte`
export type TMapColor = [number, number, number, number]

export interface TMapVertex {
  x: number
  y: number
  z: number
  rhw: number
  color: TMapColor
  u: number
  v: number
}

// Vertices/Normals는 Pascal `array[1..3]`을 그대로 미러링한 1-based 배열이다
// (index 0은 채워지지 않는 더미 값 — 이 프로젝트의 1-based 배열 관례, parts.ts 참고).
export interface TMapPolygon {
  vertices: [TMapVertex, TMapVertex, TMapVertex, TMapVertex]
  normals: [TVector3, TVector3, TVector3, TVector3]
  polyType: number
  textureIndex: number
}

export interface TMapSector {
  polys: number[] // Word[], 0-based (MapFile.pas:340 `array of Word`)
}

export interface TMapProp {
  active: boolean
  style: number
  width: number
  height: number
  x: number
  y: number
  rotation: number
  scaleX: number
  scaleY: number
  alpha: number
  color: TMapColor
  level: number
}

export interface TMapScenery {
  filename: string
  date: number
}

export interface TMapCollider {
  active: boolean
  x: number
  y: number
  radius: number
}

export interface TMapSpawnpoint {
  active: boolean
  x: number
  y: number
  team: number
}

// Waypoints.pas:19 `{$scopedenums on} TWaypointAction = (None, StopAndCamp, Wait1Second, ...)`
export enum TWaypointAction {
  None = 0,
  StopAndCamp = 1,
  Wait1Second = 2,
  Wait5Seconds = 3,
  Wait10Seconds = 4,
  Wait15Seconds = 5,
  Wait20Seconds = 6,
}

export interface TWaypoint {
  active: boolean
  id: number
  x: number
  y: number
  left: boolean
  right: boolean
  up: boolean
  down: boolean
  jetpack: boolean
  pathNum: number
  action: TWaypointAction
  connectionsNum: number
  // Waypoints.pas:28 `array[1..MAX_CONNECTIONS] of Integer` — 1-based, index 0 unused.
  connections: number[]
}

export interface TMapFile {
  version: number
  mapName: string
  textures: string[]
  bgColorTop: TMapColor
  bgColorBtm: TMapColor
  startJet: number
  grenadePacks: number
  medikits: number
  weather: number
  steps: number
  randomId: number
  polygons: TMapPolygon[]
  sectorsDivision: number
  sectorsNum: number
  sectors: TMapSector[]
  props: TMapProp[]
  scenery: TMapScenery[]
  colliders: TMapCollider[]
  spawnpoints: TMapSpawnpoint[]
  waypoints: TWaypoint[]
  hash: number
}

/* ****************************************************************************
 *                              Helper functions                              *
 **************************************************************************** */

// MapFile.pas:110-143 CRCTable
const CRC_TABLE: readonly number[] = [
  0x00000000, 0x04c11db7, 0x09823b6e, 0x0d4326d9, 0x130476dc, 0x17c56b6b, 0x1a864db2, 0x1e475005,
  0x2608edb8, 0x22c9f00f, 0x2f8ad6d6, 0x2b4bcb61, 0x350c9b64, 0x31cd86d3, 0x3c8ea00a, 0x384fbdbd,
  0x4c11db70, 0x48d0c6c7, 0x4593e01e, 0x4152fda9, 0x5f15adac, 0x5bd4b01b, 0x569796c2, 0x52568b75,
  0x6a1936c8, 0x6ed82b7f, 0x639b0da6, 0x675a1011, 0x791d4014, 0x7ddc5da3, 0x709f7b7a, 0x745e66cd,
  0x9823b6e0, 0x9ce2ab57, 0x91a18d8e, 0x95609039, 0x8b27c03c, 0x8fe6dd8b, 0x82a5fb52, 0x8664e6e5,
  0xbe2b5b58, 0xbaea46ef, 0xb7a96036, 0xb3687d81, 0xad2f2d84, 0xa9ee3033, 0xa4ad16ea, 0xa06c0b5d,
  0xd4326d90, 0xd0f37027, 0xddb056fe, 0xd9714b49, 0xc7361b4c, 0xc3f706fb, 0xceb42022, 0xca753d95,
  0xf23a8028, 0xf6fb9d9f, 0xfbb8bb46, 0xff79a6f1, 0xe13ef6f4, 0xe5ffeb43, 0xe8bccd9a, 0xec7dd02d,
  0x34867077, 0x30476dc0, 0x3d044b19, 0x39c556ae, 0x278206ab, 0x23431b1c, 0x2e003dc5, 0x2ac12072,
  0x128e9dcf, 0x164f8078, 0x1b0ca6a1, 0x1fcdbb16, 0x018aeb13, 0x054bf6a4, 0x0808d07d, 0x0cc9cdca,
  0x7897ab07, 0x7c56b6b0, 0x71159069, 0x75d48dde, 0x6b93dddb, 0x6f52c06c, 0x6211e6b5, 0x66d0fb02,
  0x5e9f46bf, 0x5a5e5b08, 0x571d7dd1, 0x53dc6066, 0x4d9b3063, 0x495a2dd4, 0x44190b0d, 0x40d816ba,
  0xaca5c697, 0xa864db20, 0xa527fdf9, 0xa1e6e04e, 0xbfa1b04b, 0xbb60adfc, 0xb6238b25, 0xb2e29692,
  0x8aad2b2f, 0x8e6c3698, 0x832f1041, 0x87ee0df6, 0x99a95df3, 0x9d684044, 0x902b669d, 0x94ea7b2a,
  0xe0b41de7, 0xe4750050, 0xe9362689, 0xedf73b3e, 0xf3b06b3b, 0xf771768c, 0xfa325055, 0xfef34de2,
  0xc6bcf05f, 0xc27dede8, 0xcf3ecb31, 0xcbffd686, 0xd5b88683, 0xd1799b34, 0xdc3abded, 0xd8fba05a,
  0x690ce0ee, 0x6dcdfd59, 0x608edb80, 0x644fc637, 0x7a089632, 0x7ec98b85, 0x738aad5c, 0x774bb0eb,
  0x4f040d56, 0x4bc510e1, 0x46863638, 0x42472b8f, 0x5c007b8a, 0x58c1663d, 0x558240e4, 0x51435d53,
  0x251d3b9e, 0x21dc2629, 0x2c9f00f0, 0x285e1d47, 0x36194d42, 0x32d850f5, 0x3f9b762c, 0x3b5a6b9b,
  0x0315d626, 0x07d4cb91, 0x0a97ed48, 0x0e56f0ff, 0x1011a0fa, 0x14d0bd4d, 0x19939b94, 0x1d528623,
  0xf12f560e, 0xf5ee4bb9, 0xf8ad6d60, 0xfc6c70d7, 0xe22b20d2, 0xe6ea3d65, 0xeba91bbc, 0xef68060b,
  0xd727bbb6, 0xd3e6a601, 0xdea580d8, 0xda649d6f, 0xc423cd6a, 0xc0e2d0dd, 0xcda1f604, 0xc960ebb3,
  0xbd3e8d7e, 0xb9ff90c9, 0xb4bcb610, 0xb07daba7, 0xae3afba2, 0xaafbe615, 0xa7b8c0cc, 0xa379dd7b,
  0x9b3660c6, 0x9ff77d71, 0x92b45ba8, 0x9675461f, 0x8832161a, 0x8cf30bad, 0x81b02d74, 0x857130c3,
  0x5d8a9099, 0x594b8d2e, 0x5408abf7, 0x50c9b640, 0x4e8ee645, 0x4a4ffbf2, 0x470cdd2b, 0x43cdc09c,
  0x7b827d21, 0x7f436096, 0x7200464f, 0x76c15bf8, 0x68860bfd, 0x6c47164a, 0x61043093, 0x65c52d24,
  0x119b4be9, 0x155a565e, 0x18197087, 0x1cd86d30, 0x029f3d35, 0x065e2082, 0x0b1d065b, 0x0fdc1bec,
  0x3793a651, 0x3352bbe6, 0x3e119d3f, 0x3ad08088, 0x2497d08d, 0x2056cd3a, 0x2d15ebe3, 0x29d4f654,
  0xc5a92679, 0xc1683bce, 0xcc2b1d17, 0xc8ea00a0, 0xd6ad50a5, 0xd26c4d12, 0xdf2f6bcb, 0xdbee767c,
  0xe3a1cbc1, 0xe760d676, 0xea23f0af, 0xeee2ed18, 0xf0a5bd1d, 0xf464a0aa, 0xf9278673, 0xfde69bc4,
  0x89b8fd09, 0x8d79e0be, 0x803ac667, 0x84fbdbd0, 0x9abc8bd5, 0x9e7d9662, 0x933eb0bb, 0x97ffad0c,
  0xafb010b1, 0xab710d06, 0xa6322bdf, 0xa2f33668, 0xbcb4666d, 0xb8757bda, 0xb5365d03, 0xb1f740b4,
]

// MapFile.pas:145-154
function crc32(crc: number, data: Uint8Array): number {
  let result = crc >>> 0
  for (let i = 0; i < data.length; i++) {
    const idx = (data[i] ^ (result >>> 24)) & 0xff
    result = (CRC_TABLE[idx] ^ ((result << 8) >>> 0)) >>> 0
  }
  return result
}

interface TFileBuffer {
  data: Uint8Array
  pos: number
}

// MapFile.pas:185-191 BufferRead — 목적지를 0으로 채운 뒤, 남은 바이트가 충분할 때만
// 복사하고, 부족해도(EOF) 항상 Size만큼 커서를 전진시킨다(예외 없음).
function bufferRead(bf: TFileBuffer, size: number): Uint8Array {
  const out = new Uint8Array(size)
  if (bf.pos + size <= bf.data.length) {
    out.set(bf.data.subarray(bf.pos, bf.pos + size))
  }
  bf.pos += size
  return out
}

// MapFile.pas:193-196
function readUint8(bf: TFileBuffer): number {
  return bufferRead(bf, 1)[0]
}

// MapFile.pas:198-201
function readUint16(bf: TFileBuffer): number {
  const b = bufferRead(bf, 2)
  return b[0] | (b[1] << 8)
}

// MapFile.pas:203-206 (LongInt, signed 32-bit little-endian)
function readInt32(bf: TFileBuffer): number {
  const b = bufferRead(bf, 4)
  return (b[0] | (b[1] << 8) | (b[2] << 16) | (b[3] << 24)) | 0
}

// MapFile.pas:208-211 (Single, IEEE-754 32-bit little-endian)
function readSingle(bf: TFileBuffer): number {
  const b = bufferRead(bf, 4)
  return new DataView(b.buffer, b.byteOffset, 4).getFloat32(0, true)
}

// MapFile.pas:213-231
// n(length prefix, 1 byte) + 고정폭 MaxSize 바이트 블록을 항상 읽는다(성공/실패 모두
// 커서는 1+MaxSize만큼 전진). n이 로컬 버퍼(129칸) 안에 들고 MaxSize 이하일 때만
// 그 블록의 앞 n바이트를 문자열로 사용하고, 그렇지 않으면 빈 문자열.
function readString(bf: TFileBuffer, maxSize: number): string {
  const n = readUint8(bf)
  const bytes = bufferRead(bf, maxSize)
  if (n < STRING_LOCAL_BUF_LEN && n <= maxSize) {
    let s = ''
    for (let i = 0; i < n; i++) s += String.fromCharCode(bytes[i])
    return s
  }
  return ''
}

// MapFile.pas:233-238
function readVec3(bf: TFileBuffer): TVector3 {
  const x = readSingle(bf)
  const y = readSingle(bf)
  const z = readSingle(bf)
  return { x, y, z }
}

// MapFile.pas:240-246 — 파일 상 바이트 순서는 B,G,R,A 이지만 배열 인덱스는 [r,g,b,a].
function readColor(bf: TFileBuffer): TMapColor {
  const c: TMapColor = [0, 0, 0, 0]
  c[2] = readUint8(bf)
  c[1] = readUint8(bf)
  c[0] = readUint8(bf)
  c[3] = readUint8(bf)
  return c
}

// MapFile.pas:248-257
function readVertex(bf: TFileBuffer): TMapVertex {
  return {
    x: readSingle(bf),
    y: readSingle(bf),
    z: readSingle(bf),
    rhw: readSingle(bf),
    color: readColor(bf),
    u: readSingle(bf),
    v: readSingle(bf),
  }
}

// MapFile.pas:259-265
export function mapColor(color: number): TMapColor {
  return [(color >>> 0) & 0xff, (color >>> 8) & 0xff, (color >>> 16) & 0xff, (color >>> 24) & 0xff]
}

const zeroVertex = (): TMapVertex => ({ x: 0, y: 0, z: 0, rhw: 0, color: [0, 0, 0, 0], u: 0, v: 0 })
const zeroVec3 = (): TVector3 => ({ x: 0, y: 0, z: 0 })

/* ****************************************************************************
 *                                LoadMapFile                                 *
 **************************************************************************** */

// MapFile.pas:271-451
export function loadMapFile(buffer: ArrayBuffer): TMapFile {
  const bf: TFileBuffer = { data: new Uint8Array(buffer), pos: 0 }

  // header/options

  const textures: string[] = new Array(1)

  const version = readInt32(bf)
  const mapName = readString(bf, 38)
  textures[0] = readString(bf, 24)
  const bgColorTop = readColor(bf)
  const bgColorBtm = readColor(bf)
  const startJet = readInt32(bf)
  const grenadePacks = readUint8(bf)
  const medikits = readUint8(bf)
  const weather = readUint8(bf)
  const steps = readUint8(bf)
  const randomId = readInt32(bf)

  // polygons

  let n = readInt32(bf)
  if (n > MAX_POLYS || n < 0) throw new Error(`loadMapFile: invalid polygon count ${n}`)

  const polygons: TMapPolygon[] = new Array(n)
  for (let i = 0; i < n; i++) {
    const v1 = readVertex(bf)
    const v2 = readVertex(bf)
    const v3 = readVertex(bf)
    const nrm1 = readVec3(bf)
    const nrm2 = readVec3(bf)
    const nrm3 = readVec3(bf)
    const polyType = readUint8(bf)
    polygons[i] = {
      vertices: [zeroVertex(), v1, v2, v3],
      normals: [zeroVec3(), nrm1, nrm2, nrm3],
      polyType,
      textureIndex: 0, // MapFile.pas:318 — 파일에서 읽지 않고 항상 0으로 고정
    }
  }

  // sectors

  const sectorsDivision = readInt32(bf)
  const sectorsNum = readInt32(bf)
  if (sectorsNum > MAX_SECTOR || sectorsNum < 0) throw new Error(`loadMapFile: invalid sectorsNum ${sectorsNum}`)

  n = (2 * sectorsNum + 1) * (2 * sectorsNum + 1)
  const sectors: TMapSector[] = new Array(n)
  for (let i = 0; i < n; i++) {
    const m = readUint16(bf)
    if (m > MAX_POLYS) throw new Error(`loadMapFile: invalid sector poly count ${m}`)
    const polys: number[] = new Array(m)
    for (let j = 0; j < m; j++) polys[j] = readUint16(bf)
    sectors[i] = { polys }
  }

  // props

  n = readInt32(bf)
  if (n > MAX_PROPS || n < 0) throw new Error(`loadMapFile: invalid prop count ${n}`)

  const props: TMapProp[] = new Array(n)
  for (let i = 0; i < n; i++) {
    const active = readUint8(bf) !== 0
    bf.pos += 1
    const style = readUint16(bf)
    const width = readInt32(bf)
    const height = readInt32(bf)
    const x = readSingle(bf)
    const y = readSingle(bf)
    const rotation = readSingle(bf)
    const scaleX = readSingle(bf)
    const scaleY = readSingle(bf)
    const alpha = readUint8(bf)
    bf.pos += 3
    const color = readColor(bf)
    const level = readUint8(bf)
    bf.pos += 3
    props[i] = { active, style, width, height, x, y, rotation, scaleX, scaleY, alpha, color, level }
  }

  // scenery

  n = readInt32(bf)
  if (n > MAX_PROPS || n < 0) throw new Error(`loadMapFile: invalid scenery count ${n}`)

  const scenery: TMapScenery[] = new Array(n)
  for (let i = 0; i < n; i++) {
    const filename = readString(bf, 50)
    const date = readInt32(bf)
    scenery[i] = { filename, date }
  }

  // colliders

  n = readInt32(bf)
  if (n > MAX_COLLIDERS || n < 0) throw new Error(`loadMapFile: invalid collider count ${n}`)

  const colliders: TMapCollider[] = new Array(n)
  for (let i = 0; i < n; i++) {
    const active = readUint8(bf) !== 0
    bf.pos += 3
    const x = readSingle(bf)
    const y = readSingle(bf)
    const radius = readSingle(bf)
    colliders[i] = { active, x, y, radius }
  }

  // spawnpoints

  n = readInt32(bf)
  if (n > MAX_SPAWNPOINTS || n < 0) throw new Error(`loadMapFile: invalid spawnpoint count ${n}`)

  const spawnpoints: TMapSpawnpoint[] = new Array(n)
  for (let i = 0; i < n; i++) {
    const active = readUint8(bf) !== 0
    bf.pos += 3
    const x = readInt32(bf)
    const y = readInt32(bf)
    const team = readInt32(bf)
    spawnpoints[i] = { active, x, y, team }
  }

  // waypoints

  n = readInt32(bf)
  if (n > MAX_WAYPOINTS || n < 0) throw new Error(`loadMapFile: invalid waypoint count ${n}`)

  const waypoints: TWaypoint[] = new Array(n)
  for (let i = 0; i < n; i++) {
    const active = readUint8(bf) !== 0
    bf.pos += 3
    const id = readInt32(bf)
    const x = readInt32(bf)
    const y = readInt32(bf)
    const left = readUint8(bf) !== 0
    const right = readUint8(bf) !== 0
    const up = readUint8(bf) !== 0
    const down = readUint8(bf) !== 0
    const jetpack = readUint8(bf) !== 0
    const pathNum = readUint8(bf)
    const action = readUint8(bf) as TWaypointAction
    bf.pos += 5
    const connectionsNum = readInt32(bf)

    const connections: number[] = new Array(MAX_CONNECTIONS + 1).fill(0)
    for (let j = 1; j <= MAX_CONNECTIONS; j++) connections[j] = readInt32(bf)

    waypoints[i] = {
      active,
      id,
      x,
      y,
      left,
      right,
      up,
      down,
      jetpack,
      pathNum,
      action,
      connectionsNum,
      connections,
    }
  }

  const hash = crc32(5381, bf.data)

  return {
    version,
    mapName,
    textures,
    bgColorTop,
    bgColorBtm,
    startJet,
    grenadePacks,
    medikits,
    weather,
    steps,
    randomId,
    polygons,
    sectorsDivision,
    sectorsNum,
    sectors,
    props,
    scenery,
    colliders,
    spawnpoints,
    waypoints,
    hash,
  }
}

// MapFile.pas:453-460
export function isPropActive(map: TMapFile, index: number): boolean {
  const prop = map.props[index]
  return prop.active && prop.level <= 2 && prop.style > 0 && prop.style <= map.scenery.length
}
