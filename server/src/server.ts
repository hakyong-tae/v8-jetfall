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

  async joinRoom(key: string | null): Promise<{ roomId: string }> {
    let target: string = key as string;
    if (!target) {
      const rooms = await $global.getCollectionItems("soldat_rooms", { limit: 100 }).catch(() => []);
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
    await $global
      .updateCollectionItem("soldat_rooms", target, {
        key: target,
        count: await this._count(),
        mode: (await $room.getRoomState()).mode || 0,
        started: false,
      })
      .catch(() => {});
    return { roomId: target };
  }

  async _count(): Promise<number> {
    const s = await $room.getRoomState();
    return Object.keys(s).filter((k: string) => k.startsWith("p_")).length;
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
}
