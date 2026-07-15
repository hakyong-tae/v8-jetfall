// src/web/loadout-menu.ts — 원작 무기선택(림보) 메뉴 DOM UI (M5).
// 코어(src/core/)는 이미 지급 규칙을 전부 갖고 있다 — respawn()이 selWeapon/player.secWep을
// 읽어 무기를 지급하고(Sprites.pas:3580-3612), applyWeaponByNum이 살아있는 동안 즉시 장착을
// 수행한다(Sprites.pas:3200-3248). 이 모듈은 그 두 진입점에 UI 클릭을 배선만 한다 — 코어 무수정.
//
// 트리거(main.ts가 매 프레임 poll() 호출): 최초 스폰 1회 + deadMeat false→true 전이마다 자동 오픈.
// 수동: Q 토글(스코어보드 Tab과 겹치지 않게 분리 — 원작 change-weapon 키 그대로 유지),
// Escape는 열려있을 때만 닫기(펼쳐진 채 ESC 일시정지 메뉴로 새지 않게 main.ts가 리스너 등록
// 순서로 stopImmediatePropagation 가드).
import type { GameState } from '../core/state'
import type { Manifest } from './assets'
import { guns, weaponNumToIndex, PRIMARY_WEAPONS, SECONDARY_WEAPONS, MAIN_WEAPONS } from '../core/weapons'
import { GUN_ICON } from './hud'

export interface LoadoutMenuOpts {
  // 온라인 비-호스트 클라 전용 — 로컬 예측 적용 직후 호출(호스트/오프라인 경로는 생략, main.ts가 주입 여부 결정).
  onNetworkPick?: (selWeapon: number, secWep: number) => void
}

export class LoadoutMenu {
  private overlay: HTMLElement | null = null
  private prevDeadMeat: boolean | null = null
  private openedInitial = false

  constructor(
    private gs: GameState,
    private meFn: () => number,
    private manifest: Manifest,
    private opts: LoadoutMenuOpts = {},
  ) {}

  isOpen(): boolean {
    return this.overlay !== null
  }

  open(): void {
    if (this.overlay) return
    const me = this.meFn()
    if (me < 0 || !this.gs.sprite[me]?.active) return
    const overlay = document.createElement('div')
    overlay.className = 'jf-loadout-overlay'
    document.body.appendChild(overlay)
    this.overlay = overlay
    this.render()
  }

  close(): void {
    if (!this.overlay) return
    this.overlay.remove()
    this.overlay = null
  }

  toggle(): void {
    if (this.isOpen()) this.close()
    else this.open()
  }

  // main.ts 렌더 루프가 매 프레임 호출 — 최초 스폰/사망 전이를 감지해 자동으로 연다.
  poll(): void {
    const me = this.meFn()
    if (me < 0) return
    const spr = this.gs.sprite[me]
    if (!spr?.active) return
    if (!this.openedInitial) {
      this.openedInitial = true
      this.open()
    } else if (this.prevDeadMeat === false && spr.deadMeat) {
      this.open()
    }
    this.prevDeadMeat = spr.deadMeat
    if (this.overlay) this.render() // 열려있는 동안 선택 하이라이트를 살아있음/무기 변화에 맞춰 갱신
  }

  // Q 토글 + Escape(열려있을 때만) 핫키. 반환값은 해제 함수 — main.ts가 attachEscMenu보다
  // *먼저* 등록해야 stopImmediatePropagation으로 ESC 일시정지 메뉴를 가로챌 수 있다.
  attachHotkeys(): () => void {
    const onKey = (e: KeyboardEvent): void => {
      if (e.code === 'KeyQ' && !e.repeat) {
        e.preventDefault()
        this.toggle()
      } else if ((e.code === 'Escape' || e.key === 'Escape') && this.isOpen()) {
        e.stopImmediatePropagation()
        e.preventDefault()
        this.close()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }

  private render(): void {
    if (!this.overlay) return
    const me = this.meFn()
    const spr = this.gs.sprite[me]
    if (!spr?.active) { this.close(); return }
    const primaryHtml = this.buildColumn(1, PRIMARY_WEAPONS, true)
    const secondaryHtml = this.buildColumn(PRIMARY_WEAPONS + 1, MAIN_WEAPONS, false)
    this.overlay.innerHTML = `
      <div class="jf-loadout-panel">
        <div class="jf-loadout-col">
          <div class="jf-label">Primary</div>
          <div class="jf-loadout-list">${primaryHtml}</div>
        </div>
        <div class="jf-loadout-col">
          <div class="jf-label">Secondary</div>
          <div class="jf-loadout-list">${secondaryHtml}</div>
        </div>
      </div>
      <div class="jf-muted" style="text-align:center;margin-top:6px">Click to equip — Q toggle, Esc close</div>`
    this.overlay.querySelectorAll<HTMLButtonElement>('[data-w]').forEach((b) => {
      b.addEventListener('click', () => {
        const w = Number(b.dataset.w)
        const isPrimary = b.dataset.primary === '1'
        this.pick(w, isPrimary)
      })
    })
  }

  private buildColumn(start: number, end: number, isPrimary: boolean): string {
    const me = this.meFn()
    const spr = this.gs.sprite[me]
    const secWep = spr.player?.secWep ?? -1
    let html = ''
    for (let w = start; w <= end; w++) {
      if (this.gs.weaponActive[w] !== 1) continue
      const gun = guns[w]
      if (!gun) continue
      const selected = isPrimary
        ? spr.selWeapon > 0 && weaponNumToIndex(spr.selWeapon) === w
        : PRIMARY_WEAPONS + secWep + 1 === w
      const iconKey = GUN_ICON[w]
      const iconRel = iconKey ? this.manifest.sprites[iconKey] : undefined
      const iconHtml = iconRel ? `<img class="jf-loadout-icon" src="/assets/${iconRel}" alt="" />` : ''
      html += `<button type="button" class="jf-btn jf-loadout-item ${selected ? 'jf-on' : ''}" data-w="${w}" data-primary="${isPrimary ? '1' : '0'}">${iconHtml}<span>${gun.name}</span></button>`
    }
    return html
  }

  // 클릭 선택 — 그룹(프라이머리/세컨더리) 내 단일선택으로 gs.weaponSel 갱신(원작 LimboMenu
  // 버튼그룹 동작 대응) + selWeapon/player.secWep 반영. 살아있으면 즉시 applyWeaponByNum
  // 장착(원작 SelectDefaultWeapons·수동선택 공통 동작), 죽어있으면 다음 respawn()이 자동 지급.
  private pick(weaponIndex: number, isPrimary: boolean): void {
    const me = this.meFn()
    const spr = this.gs.sprite[me]
    if (!spr?.active || !spr.player) return
    const groupStart = isPrimary ? 1 : PRIMARY_WEAPONS + 1
    const groupEnd = isPrimary ? PRIMARY_WEAPONS : MAIN_WEAPONS
    for (let w = groupStart; w <= groupEnd; w++) {
      this.gs.weaponSel[me][w] = w === weaponIndex ? 1 : 0
    }
    if (isPrimary) {
      spr.selWeapon = guns[weaponIndex].num
      if (!spr.deadMeat) spr.applyWeaponByNum(guns[weaponIndex].num, 1)
    } else {
      const secWep = weaponIndex - PRIMARY_WEAPONS - 1
      spr.player.secWep = secWep
      if (!spr.deadMeat && secWep >= 0 && secWep < SECONDARY_WEAPONS) {
        spr.applyWeaponByNum(guns[weaponIndex].num, 2)
      }
    }
    this.opts.onNetworkPick?.(spr.selWeapon, spr.player.secWep)
    this.render()
  }
}
