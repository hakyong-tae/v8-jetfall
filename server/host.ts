// server/host.ts — 전용 Node 헤드리스 호스트 엔트리 (스펙 §3.1-①, §6-D).
// 실행: npm run host -- --room r1 --mode dm --players alice,bob [--transport loopback-selftest]
import { loadHostGame } from './host-assets'
import { resolveHostTransport } from './node-transport'
import { HostSession, type HostSessionPlayer } from '../src/net/host-session'
import { TEAM_NONE } from '../src/core/constants'
import { LoopbackHub } from '../src/net/loopback'
import type { Transport } from '../src/net/types'

function parseArgs(argv: string[]): { room: string; ctf: boolean; players: string[]; transport?: string; port: number } {
  const get = (flag: string, def?: string) => {
    const i = argv.indexOf(flag)
    return i >= 0 ? argv[i + 1] : def
  }
  return {
    room: get('--room', 'sr1')!,
    ctf: get('--mode', 'dm') === 'ctf',
    players: (get('--players', '') || '').split(',').filter(Boolean),
    transport: get('--transport'),
    port: Number(get('--port', '8765')),
  }
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2))
  console.log(`[host] booting room=${args.room} mode=${args.ctf ? 'ctf' : 'dm'} transport=${args.transport ?? 'auto'}`)

  const gs = loadHostGame({ ctf: args.ctf })
  console.log('[host] assets loaded (map+anims+weapons)')

  // --transport loopback-selftest: 배포 없이 부트 시퀀스 자체를 스모크테스트하기 위한 스텁
  // (T6 headless verification 전용, 실 운용에선 쓰지 않음).
  let transport: Transport
  let stop = async () => {}
  if (args.transport === 'loopback-selftest') {
    const hub = new LoopbackHub()
    transport = hub.createTransport('host')
    const observer = hub.createTransport('selftest-observer')
    await transport.connect(); await observer.connect()
    await transport.joinRoom(args.room); await observer.joinRoom(args.room)
    observer.onMessage((event) => { if (event === 'snap') console.log('[host] snapshot broadcast observed') })
  } else {
    const resolved = await resolveHostTransport({ roomKey: args.room, wsPort: args.port })
    transport = resolved.transport
    stop = resolved.close
    if (resolved.mode === 'own-ws') {
      console.log(`[host] plan-B active — public URL must be set via tunnel, hint: ${resolved.publicUrlHint}`)
    }
  }

  const host = new HostSession(transport, gs)
  const roster: HostSessionPlayer[] = args.players.length
    ? args.players.map((account) => ({ account, team: TEAM_NONE }))
    : []
  if (roster.length) host.spawnPlayers(roster)
  console.log(`[host] spawned ${roster.length} player(s), starting 60Hz loop`)

  const stopLoop = host.startLoop() // Phase B가 이미 구현한 setInterval 래퍼 — 재사용, 재발명 없음.

  const logInterval = setInterval(() => console.log(`[host] alive, tick~${gs.ticks}`), 5000)

  const shutdown = async () => {
    console.log('[host] SIGINT received — shutting down')
    stopLoop()
    clearInterval(logInterval)
    await stop()
    process.exit(0)
  }
  process.on('SIGINT', shutdown)
  process.on('SIGTERM', shutdown)
}

main().catch((err) => { console.error('[host] fatal:', err); process.exit(1) })
