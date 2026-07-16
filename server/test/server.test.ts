describe("Server", () => {
  test("now returns number", async (server) => {
    const n = server.now();
    expect(typeof n).toBe("number");
  });

  test("listRooms returns an array", async (server) => {
    const rooms = await server.listRooms();
    expect(Array.isArray(rooms)).toBe(true);
  });

  test('joinRoom creates room and returns { roomId }', async (server) => {
    server.connect({ account: "user-a" });
    const result = await server.joinRoom("test-r1");
    expect(typeof result).toBe("object");
    expect(typeof result.roomId).toBe("string");
    expect(result.roomId.length).toBeGreaterThan(0);
  });

  test("joinRoom with null key generates auto room id", async (server) => {
    server.connect({ account: "user-auto" });
    const result = await server.joinRoom(null);
    expect(typeof result.roomId).toBe("string");
    expect(result.roomId.startsWith("sr")).toBe(true);
  });

  test("getRoomState returns object", async (server) => {
    server.connect({ account: "user-gs" });
    await server.joinRoom("gs-room");
    const state = await server.getRoomState();
    expect(typeof state).toBe("object");
  });

  test("updateRoomState merges and broadcasts", async (server) => {
    server.connect({ account: "user-upd" });
    await server.joinRoom("upd-room");
    await server.updateRoomState({ mode: 2, started: true });
    const state = await server.getRoomState();
    expect((state as any).mode).toBe(2);
    expect((state as any).started).toBe(true);
  });

  test("relay broadcasts without throwing", async (server) => {
    server.connect({ account: "user-rly" });
    await server.joinRoom("rly-room");
    server.relay("test-event", { x: 1 });
    expect(true).toBe(true);
  });

  test("leaveRoom leaves the room", async (server) => {
    server.connect({ account: "user-lv" });
    await server.joinRoom("lv-room");
    const result = await server.leaveRoom();
    expect(typeof result).toBe("string");
  });
});
