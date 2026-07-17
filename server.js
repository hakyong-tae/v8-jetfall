// server.js — Soldat Verse8 서버. 배포: npx -y @agent8/deploy
// 규약: 클래스 정의만, export/타이머 금지. 전역 $global/$room/$sender.
const CAP = 8
// 이 안에 touchRoom 하트비트(클라 5초)가 없으면 죽은 방 간주(목록 숨김+삭제). 90초: 백그라운드
// 탭은 Chrome intensive throttling으로 타이머가 분당 1회까지 늦어져 20초면 산 방이 사라짐.
const STALE_MS = 90000

class Server {
  now() { return Date.now() }

  // 컬렉션 아이템은 자동 __id로 식별(docs/gameserver/sdk/globalCollection):
  //   addCollectionItem(collectionId, item) → 생성 / updateCollectionItem(collectionId, item) → item.__id로 갱신(2인자!)
  // 이전의 updateCollectionItem(컬렉션, key, data) 3인자 호출은 조용히 no-op — 방 목록이 늘 빈 배열이던 근본원인.
  async _upsertRoom(key, data) {
    const rooms = await $global.getCollectionItems('soldat_rooms', { limit: 100 }).catch(() => [])
    const existing = rooms.find((r) => r.key === key)
    const item = { ...(existing || {}), key, ...data, at: Date.now() }
    if (existing && existing.__id) await $global.updateCollectionItem('soldat_rooms', item)
    else await $global.addCollectionItem('soldat_rooms', item)
  }

  async listRooms() {
    const rooms = await $global.getCollectionItems('soldat_rooms', { limit: 100 }).catch(() => [])
    const cutoff = Date.now() - STALE_MS
    const fresh = []
    for (const r of rooms) {
      if ((r.at || 0) >= cutoff) fresh.push(r)
      else if (r.__id) $global.deleteCollectionItem('soldat_rooms', r.__id).catch(() => {}) // 유령 방 청소
    }
    const byKey = new Map() // 동시 업서트 레이스로 key 중복 시 최신만
    for (const r of fresh) { const p = byKey.get(r.key); if (!p || (r.at || 0) > (p.at || 0)) byKey.set(r.key, r) }
    return [...byKey.values()].map((r) => ({ key: r.key, count: r.count || 0, mode: r.mode || 0, started: !!r.started }))
  }

  async joinRoom(key, mode) {
    const rooms = await $global.getCollectionItems('soldat_rooms', { limit: 100 }).catch(() => [])
    const cutoff = Date.now() - STALE_MS
    const live = rooms.filter((r) => (r.at || 0) >= cutoff)
    let target = key
    if (!target) {
      for (const r of live) if ((r.count || 0) < CAP && !r.started) { target = r.key; break }
      if (!target) { let n = 1; const have = new Set(rooms.map((r) => r.key)); while (have.has('sr' + n)) n++; target = 'sr' + n }
    }
    await $global.joinRoom(target)
    // mode는 클라 인자 우선(등록 시점 roomState는 비어 mode 0 오표기 버그). started는 기존 값
    // 보존(M9 난입이 목록을 '시작 전'으로 되돌리지 않게). 쓰기 실패는 touchRoom이 자가치유.
    const existing = rooms.find((r) => r.key === target)
    await this._upsertRoom(target, { count: await this._count(), mode: mode ?? existing?.mode ?? (await $room.getRoomState()).mode ?? 0, started: !!existing?.started }).catch(() => {})
    return { roomId: target }
  }
  // 방 목록 upsert 하트비트(방장 주기 호출) — 컬렉션 쓰기 실패 자가치유 + 인원/모드/진행 최신화.
  async touchRoom(key, mode, started) {
    await this._upsertRoom(key, { count: await this._count(), mode: mode ?? 0, started: !!started })
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
