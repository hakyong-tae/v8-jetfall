import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync } from 'node:fs'
import { loadMapFile, mapColor, isPropActive } from '../core/mapfile'

const MAPS = '/Users/hytae/Downloads/soldat-ref/base/shared/maps'
const load = (f: string) => loadMapFile(new Uint8Array(readFileSync(`${MAPS}/${f}`)).buffer as ArrayBuffer)

describe('PMS parser', () => {
  it('parses ctf_Ash with sane structure', () => {
    const map = load('ctf_Ash.pms')
    expect(map.polygons.length).toBeGreaterThan(0)
    expect(map.spawnpoints.filter((s) => s.active).length).toBeGreaterThan(0)
    for (const poly of map.polygons) {
      for (let k = 1; k <= 3; k++) {
        const v = poly.vertices[k]
        expect(Number.isFinite(v.x)).toBe(true)
        expect(Number.isFinite(v.y)).toBe(true)
        expect(Math.abs(v.x)).toBeLessThan(1_000_000)
        expect(Math.abs(v.y)).toBeLessThan(1_000_000)
      }
    }
  })

  it('parses all 99 maps without throwing, all with polygons and spawnpoints array', () => {
    for (const f of readdirSync(MAPS).filter((f) => f.endsWith('.pms'))) {
      const m = load(f)
      expect(m.polygons.length, f).toBeGreaterThan(0)
      expect(Array.isArray(m.spawnpoints), f).toBe(true)
    }
  })

  it('golden snapshot: ctf_Ash exact parsed values', () => {
    const map = load('ctf_Ash.pms')
    expect(map.version).toBe(11)
    expect(map.mapName).toBe('ctf_Ash by chakapoko maker')
    expect(map.textures[0]).toBe('riverbed.bmp')
    expect(map.polygons.length).toBe(209)
    expect(map.sectorsDivision).toBe(58)
    expect(map.sectorsNum).toBe(25)
    expect(map.props.length).toBe(101)
    expect(map.spawnpoints.length).toBe(20)
    expect(map.spawnpoints.filter((s) => s.active).length).toBe(20)
    const v1 = map.polygons[0].vertices[1]
    expect(v1.x).toBeCloseTo(-148.505, 3)
    expect(v1.y).toBeCloseTo(-129.159, 3)
    expect(map.hash).toBe(3046929958)
  })

  it('MapColor decomposes a packed LongInt color into [r,g,b,a]', () => {
    expect(mapColor(0x04030201)).toEqual([1, 2, 3, 4])
  })

  it('isPropActive requires active + level<=2 + valid style index into scenery', () => {
    const map = load('ctf_Ash.pms')
    for (let i = 0; i < map.props.length; i++) {
      const expected =
        map.props[i].active && map.props[i].level <= 2 && map.props[i].style > 0 && map.props[i].style <= map.scenery.length
      expect(isPropActive(map, i)).toBe(expected)
    }
  })
})
