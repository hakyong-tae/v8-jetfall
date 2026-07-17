const CAP = 8;

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

  async listRooms(): Promise<RoomListingItem[]> {
    const rooms = await $global.getCollectionItems("soldat_rooms", { limit: 100 }).catch(() => []);
    return rooms.map((r: any) => ({
      key: r.key,
      count: r.count || 0,
      mode: r.mode || 0,
      started: !!r.started,
    }));
  }

  async joinRoom(key: string | null, mode?: number): Promise<{ roomId: string }> {
    const rooms = await $global.getCollectionItems("soldat_rooms", { limit: 100 }).catch(() => []);
    let target: string = key as string;
    if (!target) {
      for (const r of rooms) {
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
    await $global
      .updateCollectionItem("soldat_rooms", target, {
        key: target,
        count: await this._count(),
        mode: mode ?? existing?.mode ?? (await $room.getRoomState()).mode ?? 0,
        started: !!existing?.started,
      })
      .catch(() => {});
    return { roomId: target };
  }

  async _count(): Promise<number> {
    const s = await $room.getRoomState();
    return Object.keys(s).filter((k: string) => k.startsWith("p_")).length;
  }

  // 방 목록 upsert 하트비트(방장이 주기 호출) — joinRoom의 컬렉션 쓰기가 실패했어도 재등록으로
  // 자가치유 + 인원수/모드/진행상태 최신화. 실패를 삼키지 않는다(클라가 콘솔 경고로 가시화).
  async touchRoom(key: string, mode: number, started: boolean): Promise<void> {
    await $global.updateCollectionItem("soldat_rooms", key, {
      key,
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
