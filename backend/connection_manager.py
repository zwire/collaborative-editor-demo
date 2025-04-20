from typing import Dict, List

from fastapi import WebSocket


class ConnectionManager:
    def __init__(self):
        # table_id をキーとし、そのテーブルに接続している WebSocket のリストを値とする辞書
        self.active_connections: Dict[str, List[WebSocket]] = {}

    async def connect(self, websocket: WebSocket, table_id: str):
        """新しいWebSocket接続を受け入れ、指定されたテーブルIDのリストに追加する"""
        await websocket.accept()
        if table_id not in self.active_connections:
            self.active_connections[table_id] = []
        self.active_connections[table_id].append(websocket)
        print(f"WebSocket connected: {websocket.client} to table {table_id}")
        print(
            f"Current connections for {table_id}: {len(self.active_connections[table_id])}"
        )

    def disconnect(self, websocket: WebSocket, table_id: str):
        """WebSocket接続を切断し、指定されたテーブルIDのリストから削除する"""
        if table_id in self.active_connections:
            try:
                self.active_connections[table_id].remove(websocket)
                print(
                    f"WebSocket disconnected: {websocket.client} from table {table_id}"
                )
                if not self.active_connections[table_id]:
                    # リストが空になったらキー自体を削除（任意）
                    del self.active_connections[table_id]
                    print(f"Table {table_id} has no more connections.")
                else:
                    print(
                        f"Current connections for {table_id}: {len(self.active_connections[table_id])}"
                    )

            except ValueError:
                # removeしようとしたwebsocketがリストにない場合（稀だが念のため）
                print(
                    f"Warning: WebSocket {websocket.client} not found in table {table_id} during disconnect."
                )
        else:
            print(
                f"Warning: Table ID {table_id} not found during disconnect for {websocket.client}."
            )

    async def send_personal_message(self, message: str, websocket: WebSocket):
        """特定のWebSocketクライアントにメッセージを送信する"""
        await websocket.send_text(message)

    async def broadcast(self, message: str, table_id: str, sender: WebSocket):
        """指定されたテーブルIDに接続している全クライアント（送信者を除く）にメッセージをブロードキャストする"""
        if table_id in self.active_connections:
            for connection in self.active_connections[table_id]:
                if connection != sender:
                    await connection.send_text(message)
            print(
                f"Broadcast message to {len(self.active_connections[table_id]) - 1} clients in table {table_id}"
            )
