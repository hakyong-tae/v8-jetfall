// server.js — Soldat Verse8 서버. 배포: npx -y @agent8/deploy
// 규약: 클래스 정의만, export/타이머 금지. 전역 $global/$room/$sender.
const CAP = 8

class Server {
  now() { return Date.now() }

  async listRooms() {
    const rooms = await $global.getCollectionItems('soldat_rooms', { limit: 100 }).catch(() => [])
    return rooms.map((r) => ({ key: r.key, count: r.count || 0, mode: r.mode || 0, started: !!r.started }))
  }

  async joinRoom(key) {
    let target = key
    if (!target) {
      const rooms = await $global.getCollectionItems('soldat_rooms', { limit: 100 }).catch(() => [])
      for (const r of rooms) if ((r.count || 0) < CAP && !r.started) { target = r.key; break }
      if (!target) { let n = 1; const have = new Set(rooms.map((r) => r.key)); while (have.has('sr' + n)) n++; target = 'sr' + n }
    }
    await $global.joinRoom(target)
    await $global.updateCollectionItem('soldat_rooms', target, { key: target, count: await this._count(), mode: (await $room.getRoomState()).mode || 0, started: false })
    return { roomId: target }
  }
  async _count() {
    const s = await $room.getRoomState(); return Object.keys(s).filter((k) => k.startsWith('p_')).length
  }
  async leaveRoom() {
    try { await $room.updateRoomState({ ['p_' + $sender.account]: null }) } catch (e) {}
    return await $global.leaveRoom()
  }
  async getRoomState() { return await $room.getRoomState() }
  async updateRoomState(patch) { await $room.updateRoomState(patch); $room.broadcastToRoom('state', await $room.getRoomState()) }

  // 실시간 릴레이 — 클라 send(event,payload) → 룸 전체에 from 포함 재전송
  relay(event, payload) { $room.broadcastToRoom('relay', { event, payload, from: $sender.account }) }
  // 고빈도 latest-wins(스냅샷/입력)용 — 클라가 throttle 옵션으로 호출. 같은 'relay' 채널로
  // 브로드캐스트해 수신 핸들러는 동일. 함수 이름을 나눠 relay 호출 캡을 분산한다.
  relayHot(event, payload) { $room.broadcastToRoom('relay', { event, payload, from: $sender.account }) }
}
