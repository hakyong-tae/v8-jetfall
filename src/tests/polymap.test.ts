import { describe, it, expect, beforeAll } from 'vitest'
import { readFileSync } from 'node:fs'
import { vector2 } from '../core/vector'
import { loadMapFile } from '../core/mapfile'
import type { TMapFile, TMapPolygon, TMapVertex } from '../core/mapfile'
import { PolyMap, pointInPoly } from '../core/polymap'

const MAPS = '/Users/hytae/Downloads/soldat-ref/base/shared/maps'
const load = (f: string): TMapFile => loadMapFile(new Uint8Array(readFileSync(`${MAPS}/${f}`)).buffer as ArrayBuffer)

// Test-only helper: build a TMapPolygon-shaped object directly (1-based vertices/normals,
// index 0 is unused padding per this codebase's convention — see mapfile.ts comments).
function makeVertex(x: number, y: number): TMapVertex {
  return { x, y, z: 0, rhw: 0, color: [0, 0, 0, 0], u: 0, v: 0 }
}
function makeTriangle(v1: [number, number], v2: [number, number], v3: [number, number], polyType = 0): TMapPolygon {
  const zv = makeVertex(0, 0)
  const z3 = { x: 0, y: 0, z: 0 }
  return {
    vertices: [zv, makeVertex(...v1), makeVertex(...v2), makeVertex(...v3)],
    normals: [z3, z3, z3, z3],
    polyType,
    textureIndex: 0,
  }
}

// Mirrors PolyMap.pas CollisionTest's EXCLUDED1/EXCLUDED2 poly-type sets, used here only to pick a
// polygon in the test fixture that CollisionTest can actually collide with.
const CT_EXCLUDED1 = new Set([1, 2, 3, 11, 13, 15, 17, 24, 25])
const CT_EXCLUDED2 = new Set([21, 22, 23])

describe('pointInPoly', () => {
  const triangle = makeTriangle([0, 0], [10, 0], [0, 10])

  it('point inside the triangle', () => {
    expect(pointInPoly(vector2(2, 2), triangle)).toBe(true)
  })

  it('point outside the triangle', () => {
    expect(pointInPoly(vector2(9, 9), triangle)).toBe(false)
  })
})

describe('PolyMap.loadData + rayCast/collisionTest on ctf_Ash', () => {
  let mapFile: TMapFile
  let polyMap: PolyMap

  beforeAll(() => {
    mapFile = load('ctf_Ash.pms')
    polyMap = new PolyMap()
    polyMap.loadData(mapFile)
  })

  it('loads polygon/spawnpoint/sector counts from the map file', () => {
    expect(polyMap.polyCount).toBe(mapFile.polygons.length)
    expect(polyMap.sectorsDivision).toBe(mapFile.sectorsDivision)
    expect(polyMap.sectorsNum).toBe(mapFile.sectorsNum)
  })

  it('rayCast straight down through the map from high above hits terrain', () => {
    const spawn = mapFile.spawnpoints.find((s) => s.active)!
    const top = vector2(spawn.x, -100000)
    const bottom = vector2(spawn.x, 100000)
    const result = polyMap.rayCast(top, bottom, 1000000)
    expect(result.hit).toBe(true)
    expect(Number.isFinite(result.distance)).toBe(true)
  })

  it('rayCast a short segment in open air near a spawnpoint does not hit', () => {
    const spawn = mapFile.spawnpoints.find((s) => s.active)!
    const a = vector2(spawn.x, spawn.y)
    const b = vector2(spawn.x, spawn.y - 5)
    // Sanity: the spawnpoint itself must be open air (not embedded in a solid polygon).
    expect(polyMap.collisionTest(a).hit).toBe(false)
    const result = polyMap.rayCast(a, b, 1000000)
    expect(result.hit).toBe(false)
  })

  it('collisionTest at a spawnpoint position (open air) is false', () => {
    const spawn = mapFile.spawnpoints.find((s) => s.active)!
    const result = polyMap.collisionTest(vector2(spawn.x, spawn.y))
    expect(result.hit).toBe(false)
  })

  it('collisionTest at a point inside a (collidable) polygon is true', () => {
    let found: { centroid: ReturnType<typeof vector2> } | null = null
    for (let i = 1; i <= polyMap.polyCount; i++) {
      const poly = polyMap.polys[i]
      const polyType = polyMap.polyType[i]
      if (CT_EXCLUDED1.has(polyType) || CT_EXCLUDED2.has(polyType)) continue
      const v1 = poly.vertices[1]
      const v2 = poly.vertices[2]
      const v3 = poly.vertices[3]
      const centroid = vector2((v1.x + v2.x + v3.x) / 3, (v1.y + v2.y + v3.y) / 3)
      if (pointInPoly(centroid, poly)) {
        found = { centroid }
        break
      }
    }
    expect(found).not.toBeNull()
    const result = polyMap.collisionTest(found!.centroid)
    expect(result.hit).toBe(true)
  })
})
