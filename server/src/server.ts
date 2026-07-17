const CAP = 8;
// 이 시간 안에 touchRoom 하트비트(클라 5초 주기)가 없으면 죽은 방으로 간주하고 목록에서
// 숨김+삭제(호스트 크래시/탭닫힘으로 leaveRoom이 안 불린 유령 등록 청소). 90초인 이유:
// 호스트가 브라우저 탭을 백그라운드로 두면 Chrome intensive throttling이 타이머를 분당
// 1회까지 늦춘다 — 20초면 대기중인 호스트의 방이 목록에서 사라져 버린다(라이브 관찰).
const STALE_MS = 90000;

interface RoomListingItem {
  key: string;
  count: number;
  mode: number;
  started: boolean;
}

export class Server {
  now(): number {
    return Date.now();
  }

  // 컬렉션 아이템은 자동 __id로 식별된다(docs/gameserver/sdk/globalCollection):
  //   addCollectionItem(collectionId, item) → 생성(__id 부여)
  //   updateCollectionItem(collectionId, item) → item.__id로 기존 아이템 갱신 (2인자!)
  // 이전 코드는 updateCollectionItem(collectionId, key, data) 3인자로 잘못 호출해 "성공처럼
  // 조용히 아무것도 안 쓰는" 버그 — 방 목록이 영원히 빈 배열이던 근본원인. 우리 방 식별자는
  // key 필드이므로, key로 찾아 있으면 update(__id 유지), 없으면 add 하는 업서트로 감싼다.
  async _upsertRoom(key: string, data: Record<string, unknown>): Promise<void> {
    const rooms = await $global.getCollectionItems("soldat_rooms", { limit: 100 }).catch(() => []);
    const existing = rooms.find((r: any) => r.key === key);
    const item = { ...(existing || {}), key, ...data, at: Date.now() };
    if (existing && existing.__id) await $global.updateCollectionItem("soldat_rooms", item);
    else await $global.addCollectionItem("soldat_rooms", item);
  }

  async listRooms(): Promise<RoomListingItem[]> {
    const rooms = await $global.getCollectionItems("soldat_rooms", { limit: 100 }).catch(() => []);
    const cutoff = Date.now() - STALE_MS;
    const fresh: any[] = [];
    for (const r of rooms) {
      if ((r.at || 0) >= cutoff) fresh.push(r);
      // 유령 방 청소는 best-effort — 실패해도 목록 응답엔 지장 없음.
      else if (r.__id) $global.deleteCollectionItem("soldat_rooms", r.__id).catch(() => {});
    }
    // 같은 key로 중복 등록됐으면(동시 업서트 레이스) 최신 것만 노출.
    const byKey = new Map<string, any>();
    for (const r of fresh) {
      const prev = byKey.get(r.key);
      if (!prev || (r.at || 0) > (prev.at || 0)) byKey.set(r.key, r);
    }
    return [...byKey.values()].map((r: any) => ({
      key: r.key,
      count: r.count || 0,
      mode: r.mode || 0,
      started: !!r.started,
    }));
  }

  async joinRoom(key: string | null, mode?: number): Promise<{ roomId: string }> {
    const rooms = await $global.getCollectionItems("soldat_rooms", { limit: 100 }).catch(() => []);
    const cutoff = Date.now() - STALE_MS;
    const live = rooms.filter((r: any) => (r.at || 0) >= cutoff);
    let target: string = key as string;
    if (!target) {
      for (const r of live) {
        if ((r.count || 0) < CAP && !r.started) {
          target = r.key;
          break;
        }
      }
      if (!target) {
        let n = 1;
        const have = new Set(rooms.map((r: any) => r.key));
        while (have.has("sr" + n)) n++;
        target = "sr" + n;
      }
    }
    await $global.joinRoom(target);
    // mode는 클라가 넘긴 값 우선 — 등록 시점엔 roomState가 아직 비어 mode가 항상 0(DM)으로
    // 잘못 표기되던 버그 수정. started는 기존 목록 값 보존 — 진행중 방에 난입(M9)해도 목록이
    // '시작 전'으로 되돌아가지 않게(리뷰 #4). 컬렉션 쓰기 실패는 삼키되(입장 자체는 성공시켜야
    // 함), 방장측 touchRoom 하트비트가 재등록으로 자가치유한다.
    const existing = rooms.find((r: any) => r.key === target);
    await this._upsertRoom(target, {
      count: await this._count(),
      mode: mode ?? existing?.mode ?? (await $room.getRoomState()).mode ?? 0,
      started: !!existing?.started,
    }).catch(() => {});
    return { roomId: target };
  }

  async _count(): Promise<number> {
    const s = await $room.getRoomState();
    return Object.keys(s).filter((k: string) => k.startsWith("p_")).length;
  }

  // 방 목록 upsert 하트비트(방장이 주기 호출) — joinRoom의 컬렉션 쓰기가 실패했어도 재등록으로
  // 자가치유 + 인원수/모드/진행상태 최신화. 실패를 삼키지 않는다(클라가 콘솔 경고로 가시화).
  async touchRoom(key: string, mode: number, started: boolean): Promise<void> {
    await this._upsertRoom(key, {
      count: await this._count(),
      mode: mode ?? 0,
      started: !!started,
    });
  }

  async leaveRoom(): Promise<string> {
    try {
      await $room.updateRoomState({ ["p_" + $sender.account]: null });
    } catch (_e) { /* ignore */ }
    return $global.leaveRoom();
  }

  async getRoomState(): Promise<any> {
    return $room.getRoomState();
  }

  async updateRoomState(patch: Record<string, unknown>): Promise<void> {
    await $room.updateRoomState(patch);
    $room.broadcastToRoom("state", await $room.getRoomState());
  }

  relay(event: string, payload: unknown): void {
    $room.broadcastToRoom("relay", { event, payload, from: $sender.account });
  }

  // 고빈도 latest-wins(스냅샷/입력)용 — 클라가 throttle 옵션으로 호출. 같은 "relay" 채널로
  // 브로드캐스트해 수신 핸들러는 동일. 함수 이름을 나눠 relay 호출 캡을 분산한다.
  relayHot(event: string, payload: unknown): void {
    $room.broadcastToRoom("relay", { event, payload, from: $sender.account });
  }
}
