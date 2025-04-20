import json
from typing import Dict

from connection_manager import ConnectionManager
from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware

app = FastAPI()

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


manager = ConnectionManager()

# インメモリでテーブルの状態を保持 (テーブルID -> グリッドデータのJSON文字列)
# 簡単のため、今回は 'default_table' のみ扱う
table_states: Dict[str, str] = {}
TABLE_ID = "default_table"  # 固定のテーブルIDを使用

# 初期状態として 5x5 の空のグリッドをJSON文字列で設定
initial_grid_data = [["" for _ in range(5)] for _ in range(5)]
table_states[TABLE_ID] = json.dumps(initial_grid_data)


@app.get("/")
async def read_root():
    return {"message": "WebSocket server is running"}


@app.websocket("/ws/{table_id}")
async def websocket_endpoint(websocket: WebSocket, table_id: str):
    # 今回は 'default_table' のみサポート
    if table_id != TABLE_ID:
        await websocket.close(code=1008)  # Policy Violation
        print(f"Connection attempt to unsupported table_id: {table_id}")
        return

    await manager.connect(websocket, table_id)
    try:
        # 接続時に現在のテーブル状態を送信
        current_state = table_states.get(table_id, json.dumps(initial_grid_data))
        await manager.send_personal_message(
            json.dumps({"type": "initial_state", "payload": current_state}), websocket
        )
        print(f"Sent initial state to {websocket.client} for table {table_id}")

        while True:
            # クライアントからのメッセージを受信 (JSON形式を期待)
            data_str = await websocket.receive_text()
            print(f"Received raw data from {websocket.client}: {data_str}")
            try:
                data = json.loads(data_str)
                message_type = data.get("type")
                payload = data.get(
                    "payload"
                )  # payload は grid_update の場合、JSON文字列のはず

                if message_type == "grid_update" and payload is not None:
                    # サーバー側の状態を更新 (payloadは既にJSON文字列)
                    table_states[table_id] = payload
                    print(f"Updated state for table {table_id}")

                    # 送信者以外のクライアントにブロードキャスト
                    # ブロードキャストするデータもJSON文字列にする
                    broadcast_message = json.dumps(
                        {
                            "type": "remote_update",
                            "payload": payload,  # payload は grid_update で受け取ったJSON文字列
                        }
                    )
                    await manager.broadcast(
                        broadcast_message, table_id, sender=websocket
                    )
                else:
                    print(
                        f"Received unknown message type or missing payload from {websocket.client}"
                    )

            except json.JSONDecodeError:
                print(f"Received invalid JSON from {websocket.client}: {data_str}")
            except Exception as e:
                print(f"Error processing message from {websocket.client}: {e}")

    except WebSocketDisconnect:
        print(f"WebSocket disconnected: {websocket.client} from table {table_id}")
    except Exception as e:
        # 予期せぬエラーが発生した場合も切断処理を行う
        print(f"An unexpected error occurred with {websocket.client}: {e}")
    finally:
        # 切断処理
        manager.disconnect(websocket, table_id)
        print(f"Cleaned up connection for {websocket.client} from table {table_id}")
