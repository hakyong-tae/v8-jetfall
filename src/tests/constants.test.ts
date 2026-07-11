// 1:1 포팅 검증: soldat-ref/soldat/shared/Constants.pas 대비 눈으로 확인한 sanity 값들.
import { describe, it, expect } from 'vitest'
import * as C from '../core/constants'

describe('Constants.pas port sanity checks', () => {
  it('DEFAULT_HEALTH / REALISTIC_HEALTH match Pascal literals', () => {
    expect(C.DEFAULT_HEALTH).toBe(150)
    expect(C.REALISTIC_HEALTH).toBe(65)
  })

  it('time constants chain correctly from SECOND (compile-time expressions)', () => {
    expect(C.SECOND).toBe(60)
    expect(C.MINUTE).toBe(C.SECOND * 60) // 3600
    expect(C.HALF_MINUTE).toBe(C.SECOND * 30) // 1800
    expect(C.HOUR).toBe(C.SIXTY_MINUTES)
    expect(C.DAY).toBe(C.HOUR * 24)
  })

  it('speed constants derive from RUNSPEED as in Pascal', () => {
    expect(C.RUNSPEED).toBeCloseTo(0.118)
    expect(C.RUNSPEEDUP).toBeCloseTo(0.118 / 6)
    expect(C.CROUCHRUNSPEED).toBeCloseTo(0.118 / 0.6)
    expect(C.PRONESPEED).toBeCloseTo(0.118 * 4.0)
  })

  it('polygon type constants (PT_*) are sequential starting at 1', () => {
    expect(C.PT_ONLYBULLETS).toBe(1)
    expect(C.PT_ONLYPLAYERS).toBe(2)
    expect(C.PT_DOESNTCOLLIDE).toBe(3)
    expect(C.PT_FLAGCOLLIDES).toBe(23) // last polygon type constant
  })

  it('team constants match Pascal TEAM_* values', () => {
    expect(C.TEAM_NONE).toBe(0)
    expect(C.TEAM_ALPHA).toBe(1)
    expect(C.TEAM_BRAVO).toBe(2)
    expect(C.TEAM_SPECTATOR).toBe(5)
  })

  it('game object numbering (weapon pickups) matches Pascal OBJECT_* values', () => {
    expect(C.OBJECT_ALPHA_FLAG).toBe(1)
    expect(C.OBJECT_AK74).toBe(7)
    expect(C.OBJECT_M79).toBe(11)
    expect(C.OBJECT_STATIONARY_GUN).toBe(27) // last object constant
  })

  it('SFX_ constants preserve the Pascal gap at value 4 (no SFX with value 4)', () => {
    expect(C.SFX_AK74_FIRE).toBe(1)
    expect(C.SFX_AK74_RELOAD).toBe(3)
    expect(C.SFX_M249_FIRE).toBe(5) // value 4 is intentionally absent in Pascal source
    expect(C.SFX_WIND).toBe(163) // last SFX constant
  })

  it('hex color constants translate $XXXXXXXX to 0xXXXXXXXX exactly', () => {
    expect(C.DEFAULT_MESSAGE_COLOR).toBe(0xeeccffaa)
    expect(C.DEFAULT_JETCOLOR).toBe(0xffffbd24)
    expect(C.COLOR_TRANSPARENCY_UNREGISTERED).toBe(0xff000000)
  })

  it('MULTIKILLMESSAGE preserves Pascal array[2..17] indices with 0/1 padded', () => {
    expect(C.MULTIKILLMESSAGE[0]).toBe('')
    expect(C.MULTIKILLMESSAGE[1]).toBe('')
    expect(C.MULTIKILLMESSAGE[2]).toBe('DOUBLE KILL')
    expect(C.MULTIKILLMESSAGE[17]).toBe('just what you see, pal...')
    expect(C.MULTIKILLMESSAGE.length).toBe(18)
  })

  it('MAX_PUSHTICK uses the CLIENT ({$ELSE}) branch value, not the SERVER value', () => {
    expect(C.MAX_PUSHTICK).toBe(125) // TODO(M3) SERVER variant is 0
  })
})
