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
import { t } from './i18n'

export interface LoadoutMenuOpts {
  // 온라인 비-호스트 클라 전용 — 로컬 예측 적용 직후 호출(호스트/오프라인 경로는 생략, main.ts가 주입 여부 결정).
  onNetworkPick?: (selWeapon: number, secWep: number) => void
}

export class LoadoutMenu {
  private overlay: HTMLElement | null = null
  // M7 Task3: 개방창(open window) 추적. 개방창 = deadMeat(사망 대기) 또는 ceaseFireCounter>0(무적).
  // 창에 진입하는 엣지에서 자동 오픈, 창을 벗어나는 엣지에서 자동 닫힘. 창 밖에선 open/toggle/pick
  // 모두 무동작(=잠금). 다음 사망/무적으로 창이 다시 열리면 자동 해제.
  private prevInWindow = false

  constructor(
    private gs: GameState,
    private meFn: () => number,
    private manifest: Manifest,
    private opts: LoadoutMenuOpts = {},
  ) {}

  isOpen(): boolean {
    return this.overlay !== null
  }

  // M7 Task3: 개방창 판정 — 사망 대기(deadMeat) 또는 리스폰 무적(ceaseFireCounter>0). 첫 스폰도
  // 무적중이라 자연히 개방창이다. 코어 필드 읽기만(무수정).
  private inOpenWindow(spr: { deadMeat: boolean; ceaseFireCounter: number }): boolean {
    return spr.deadMeat === true || spr.ceaseFireCounter > 0
  }

  open(): void {
    if (this.overlay) return
    const me = this.meFn()
    const spr = this.gs.sprite[me]
    if (me < 0 || !spr?.active) return
    if (!this.inOpenWindow(spr)) return // M7: 개방창 밖에선 열지 않는다(잠금)
    const overlay = document.createElement('div')
    overlay.className = 'jf-loadout-overlay'
    document.body.appendChild(overlay)
    this.overlay = overlay
    this.buildStructure()
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

  // main.ts 렌더 루프가 매 프레임 호출 — 개방창 진입/이탈 엣지를 감지해 자동 오픈/닫힘.
  poll(): void {
    const me = this.meFn()
    if (me < 0) return
    const spr = this.gs.sprite[me]
    if (!spr?.active) return
    const inWindow = this.inOpenWindow(spr)
    if (inWindow && !this.prevInWindow) {
      // 개방창 진입 엣지(첫 스폰 무적, 매 사망 deadMeat, 리스폰 무적) — 자동 오픈.
      this.open()
    } else if (!inWindow && this.prevInWindow) {
      // 개방창 이탈 엣지(살아있음 && ceaseFireCounter≤0) — 자동 닫힘 + 잠금(open/pick 무동작).
      this.close()
    }
    this.prevInWindow = inWindow
    // 열려있는 동안 선택 하이라이트만 갱신. innerHTML 재생성(=버튼 DOM 교체)은 절대 하지 않는다 —
    // 매 프레임 교체하면 실제 마우스 클릭의 mousedown/mouseup 사이에 프레임 경계가 끼며 버튼이
    // 새 요소로 갈려 click 이벤트가 발생하지 못한다(무기 선택 먹통 버그).
    if (this.overlay) this.refreshHighlight()
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

  // 구조를 *한 번만* 만든다(버튼 DOM은 매치 내내 고정 — weaponActive는 라운드 중 안 바뀜).
  // 클릭은 오버레이 한 곳에 이벤트 위임으로 처리해, 버튼 요소를 절대 교체하지 않는다.
  private buildStructure(): void {
    if (!this.overlay) return
    const me = this.meFn()
    const spr = this.gs.sprite[me]
    if (!spr?.active) { this.close(); return }
    const primaryHtml = this.buildColumn(1, PRIMARY_WEAPONS, true)
    const secondaryHtml = this.buildColumn(PRIMARY_WEAPONS + 1, MAIN_WEAPONS, false)
    this.overlay.innerHTML = `
      <div class="jf-loadout-panel">
        <div class="jf-loadout-col">
          <div class="jf-label">${t('loadout.primary')}</div>
          <div class="jf-loadout-list">${primaryHtml}</div>
        </div>
        <div class="jf-loadout-col">
          <div class="jf-label">${t('loadout.secondary')}</div>
          <div class="jf-loadout-list">${secondaryHtml}</div>
        </div>
      </div>
      <div class="jf-muted" style="text-align:center;margin-top:6px">${t('loadout.hint')}</div>`
    this.overlay.addEventListener('click', (e) => {
      const btn = (e.target as HTMLElement | null)?.closest<HTMLButtonElement>('[data-w]')
      if (!btn) return
      this.pick(Number(btn.dataset.w), btn.dataset.primary === '1')
    })
    this.refreshHighlight()
  }

  // 매 프레임 호출 가능 — 기존 버튼 요소를 유지한 채 선택 하이라이트(jf-on) 클래스만 갱신.
  private refreshHighlight(): void {
    if (!this.overlay) return
    const me = this.meFn()
    const spr = this.gs.sprite[me]
    if (!spr?.active) { this.close(); return }
    const selPrimary = spr.selWeapon > 0 ? weaponNumToIndex(spr.selWeapon) : -1
    const selSecondary = PRIMARY_WEAPONS + (spr.player?.secWep ?? -1) + 1
    this.overlay.querySelectorAll<HTMLButtonElement>('[data-w]').forEach((b) => {
      const w = Number(b.dataset.w)
      const on = b.dataset.primary === '1' ? w === selPrimary : w === selSecondary
      b.classList.toggle('jf-on', on)
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
    if (!this.inOpenWindow(spr)) return // M7: 개방창(사망/무적) 밖에선 무기 변경 불가(잠금)
    const groupStart = isPrimary ? 1 : PRIMARY_WEAPONS + 1
    const groupEnd = isPrimary ? PRIMARY_WEAPONS : MAIN_WEAPONS
    for (let w = groupStart; w <= groupEnd; w++) {
      this.gs.weaponSel[me][w] = w === weaponIndex ? 1 : 0
    }
    // 안 바뀐 슬롯을 재적용하면 applyWeaponByNum이 guns[]를 깊은복사로 새로 지급해 탄약/장전
    // 상태가 리셋된다(host-session.ts applyLoadout과 동일 이유로 diff 게이트, 리뷰 finding #3
    // — 이미 든 무기를 재클릭/중복클릭해도 탄약이 리필되지 않게 한다).
    if (isPrimary) {
      const num = guns[weaponIndex].num
      const changed = spr.selWeapon !== num
      spr.selWeapon = num
      if (!spr.deadMeat && changed) spr.applyWeaponByNum(num, 1)
    } else {
      const secWep = weaponIndex - PRIMARY_WEAPONS - 1
      const changed = spr.player.secWep !== secWep
      spr.player.secWep = secWep
      if (!spr.deadMeat && changed && secWep >= 0 && secWep < SECONDARY_WEAPONS) {
        spr.applyWeaponByNum(guns[weaponIndex].num, 2)
      }
    }
    this.opts.onNetworkPick?.(spr.selWeapon, spr.player.secWep)
    this.refreshHighlight()
  }
}
