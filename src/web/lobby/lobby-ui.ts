// src/web/lobby/lobby-ui.ts — 타이틀→로비→룸 최소 DOM UI.
import { LobbyClient } from '../../net/lobby-client'
import { LoopbackHub } from '../../net/loopback'
import { makeAgent8Transport, realProvider } from '../../net/transport'
import type { Transport } from '../../net/types'
import { GAMESTYLE_DEATHMATCH, GAMESTYLE_CTF, TEAM_ALPHA, TEAM_BRAVO, TEAM_SPECTATOR, TEAM_NONE } from '../../core/constants'

export interface StartMatchArg { lobby: LobbyClient; mode: number; myTeam: number }

// loopback=true면 배포 없이 단일 브라우저에서 목 릴레이 사용 (개발/데모).
export async function makeTransport(loopback: boolean): Promise<Transport> {
  if (loopback) return new LoopbackHub().createTransport('me-' + Math.floor(performance.now()))
  return makeAgent8Transport(await realProvider())
}

export function mountLobby(
  root: HTMLElement,
  opts: { onStartMatch: (a: StartMatchArg) => void; onOfflineBots: () => void },
): void {
  // 화면 3종(title/lobby/room)을 root.innerHTML 스왑 + 이벤트 위임으로 구현.
  // 상태: LobbyClient(연결 성공시) 또는 offline → onOfflineBots 버튼.
  // 팀버튼은 mode===GAMESTYLE_CTF일 때 Alpha/Bravo/Spectator, DM이면 팀선택 숨김(TEAM_NONE 고정).
  // 호스트에게만 Start 노출; 시작 시 onStartMatch({lobby, mode, myTeam}).
  renderTitle(root, opts)
}

function renderTitle(root: HTMLElement, opts: Parameters<typeof mountLobby>[1]) {
  root.innerHTML = `
    <div class="scr" style="position:absolute;inset:0;display:flex;flex-direction:column;gap:12px;align-items:center;justify-content:center;color:#eee;font-family:monospace;background:#1a1a12">
      <h1>SOLDAT WEB</h1>
      <input id="nick" placeholder="nickname" value="Soldier" style="padding:6px;font-size:16px" maxlength="14"/>
      <div style="display:flex;gap:8px">
        <button id="quick">Quick Join (online)</button>
        <button id="create-dm">Create DM</button>
        <button id="create-ctf">Create CTF</button>
      </div>
      <button id="offline">Offline Bot Match</button>
      <p id="netmsg" style="opacity:.6;font-size:12px"></p>
    </div>`
  const nick = () => (root.querySelector('#nick') as HTMLInputElement).value || 'Soldier'
  root.querySelector('#offline')!.addEventListener('click', () => opts.onOfflineBots())
  const online = async (action: (lc: LobbyClient) => Promise<void>) => {
    ;(root.querySelector('#netmsg') as HTMLElement).textContent = 'connecting...'
    const transport = await makeTransport(false)
    const lc = new LobbyClient(transport, nick())
    const st = await lc.connect()
    if (st !== 'online') { (root.querySelector('#netmsg') as HTMLElement).textContent = 'offline (배포 필요) — Offline Bot Match를 쓰세요'; return }
    await action(lc)
    renderRoom(root, lc, opts)
  }
  root.querySelector('#quick')!.addEventListener('click', () => online((lc) => lc.joinRoom('')))
  root.querySelector('#create-dm')!.addEventListener('click', () => online((lc) => lc.createRoom('dm-' + Date.now(), GAMESTYLE_DEATHMATCH)))
  root.querySelector('#create-ctf')!.addEventListener('click', () => online((lc) => lc.createRoom('ctf-' + Date.now(), GAMESTYLE_CTF)))
}

function renderRoom(root: HTMLElement, lc: LobbyClient, opts: Parameters<typeof mountLobby>[1]) {
  const draw = () => {
    const isCtf = lc.roomState.mode === GAMESTYLE_CTF
    const players = lc.players
    const teamBtns = isCtf
      ? `<button data-team="${TEAM_ALPHA}">Alpha</button><button data-team="${TEAM_BRAVO}">Bravo</button><button data-team="${TEAM_SPECTATOR}">Spectator</button>`
      : ''
    root.innerHTML = `
      <div class="scr" style="position:absolute;inset:0;padding:20px;color:#eee;font-family:monospace;background:#1a1a12">
        <h2>Room — ${isCtf ? 'CTF' : 'Deathmatch'}</h2>
        <ul>${Object.entries(players).map(([acc, p]) =>
          `<li>${p.nick}${acc === lc.account ? ' (you)' : ''} — team ${p.team} ${p.ready ? '✓' : ''}</li>`).join('')}</ul>
        <div style="display:flex;gap:8px;margin:8px 0">${teamBtns}
          <button id="ready">Ready</button>
          ${lc.isHost ? '<button id="start">START</button>' : '<span>(waiting for host)</span>'}
        </div>
      </div>`
    root.querySelectorAll('[data-team]').forEach((b) =>
      b.addEventListener('click', () => lc.selectTeam(Number((b as HTMLElement).dataset.team))))
    root.querySelector('#ready')?.addEventListener('click', () => lc.setReady(true))
    root.querySelector('#start')?.addEventListener('click', async () => {
      await lc.start()
    })
  }
  lc.onChange(draw)
  lc.onStart(() => {
    const myTeam = lc.players[lc.account]?.team ?? TEAM_NONE
    opts.onStartMatch({ lobby: lc, mode: lc.roomState.mode, myTeam })
  })
  draw()
}
