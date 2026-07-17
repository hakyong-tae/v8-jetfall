// agent8 서버 런타임 주입 전역(isolated-vm) — 타입은 로컬 tsc 통과용 최소 선언.
// 실제 API: docs.verse8.io/en/docs/gameserver/sdk/* (globalCollection, roomState 등)
declare const $global: {
  joinRoom(roomId: string): Promise<void>
  leaveRoom(): Promise<string>
  getCollectionItems(collectionId: string, options?: { limit?: number }): Promise<any[]>
  addCollectionItem(collectionId: string, item: any): Promise<any>
  updateCollectionItem(collectionId: string, item: any): Promise<any>
  deleteCollectionItem(collectionId: string, itemId: string): Promise<{ __id: string }>
}
declare const $room: {
  getRoomState(): Promise<any>
  updateRoomState(patch: Record<string, unknown>): Promise<void>
  broadcastToRoom(event: string, payload: unknown): void
}
declare const $sender: { account: string }
