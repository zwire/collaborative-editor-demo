# Webアプリでの高効率なデータ同期

Excelライクなテーブルデータのエディタ。
複数人が同時操作してもある程度リアルタイムに同期する。
厳密なトランザクションはDBレベルで管理するが、今回はそれを行わない。

技術スタック：
- バックエンド: FastAPI (Python)
- フロントエンド: Next.js (React/TypeScript)
- 状態管理 (Undo/Redo): Zustand + zundo middleware
- リアルタイム同期: WebSocket

## 設計思想

- リアルタイム同期:
  - 双方向通信が可能で、低遅延なWebSocketを選択。
- 状態管理とUndo/Redo:
  - フロントエンドでZustandを用いてエディタの状態（カラム内容など）を管理。
  - zundoミドルウェアを導入し、ローカルでのUndo/Redo操作を容易に実現。
  - zundoは各ユーザーのローカル操作履歴のみを管理し、他ユーザーからの変更は、ローカルのUndo/Redo履歴には含めない。
- データ更新の効率化:
  - ユーザーの入力操作（例: onChange イベント）ごとにWebSocketでデータを送信すると、サーバーとネットワークに過大な負荷がかかる。
  - throttle（または debounce）を用いて、一定時間内の連続的な操作をまとめて送信するようにし、通信頻度を抑制。
- データ形式:
  - 送信するデータは、エディタの全内容を毎回送るのではなく、変更差分（diff）
- サーバー役割:
  - サーバー（FastAPI）は、各テーブル（編集対象）ごとにWebSocket接続を管理し、受け取った変更内容を該当テーブルを編集している他の全ユーザーにブロードキャストする役割を担う。
  - また、ドキュメントの最新状態を保持する（本来はDBだが、今回はインメモリ）。

```mermaid
graph LR
    subgraph "ユーザーAのブラウザ (Next.js)"
        A_Editor[テーブルエディタUI] --> A_Input{入力イベント}
        A_Input -- throttle --> A_Zustand[Zustand Store + zundo]
        A_Zustand -- 変更差分/内容 --> A_WSClient[WebSocket Client]
        A_Undo[Undo/Redoボタン] --> A_Zustand
        A_WSClient -- 受信 --> A_Zustand_Update[Apply Remote Change]
        A_Zustand_Update -- (zundo履歴に含めない) --> A_Zustand
        A_Zustand --> A_Editor
    end

    subgraph "ユーザーBのブラウザ (Next.js)"
        B_Editor[テーブルエディタUI] --> B_Input{入力イベント}
        B_Input -- throttle --> B_Zustand[Zustand Store + zundo]
        B_Zustand -- 変更差分/内容 --> B_WSClient[WebSocket Client]
        B_Undo[Undo/Redoボタン] --> B_Zustand
        B_WSClient -- 受信 --> B_Zustand_Update[Apply Remote Change]
        B_Zustand_Update -- (zundo履歴に含めない) --> B_Zustand
        B_Zustand --> B_Editor
    end

    subgraph "サーバー (FastAPI)"
        S_WSEndpoint[WebSocket Endpoint /ws/{docId}]
        S_ConnMgr[Connection Manager]
        S_DocState[table State Store (In-memory/Redis/DB)]
        S_WSEndpoint -- 接続/切断 --> S_ConnMgr
        S_WSEndpoint -- メッセージ受信 --> S_UpdateLogic{Update & Broadcast}
        S_UpdateLogic -- 更新 --> S_DocState
        S_UpdateLogic -- 配信指示 --> S_ConnMgr
        S_ConnMgr -- メッセージ送信 --> S_WSEndpoint
    end

    A_WSClient -- 変更送信 --> S_WSEndpoint
    B_WSClient -- 変更送信 --> S_WSEndpoint
    S_WSEndpoint -- 変更ブロードキャスト --> A_WSClient
    S_WSEndpoint -- 変更ブロードキャスト --> B_WSClient
```

## コンポーネント詳細

1. フロントエンド (Next.js)

- エディタコンポーネント:
  - テーブル入力エリア。
  - 入力イベント (onChange など) を捕捉。
- 状態管理 (Zustand + zundo):
  - create でストアを作成し、temporal ミドルウェア (zundo) を適用。
  - ストアはドキュメントの現在の内容 (content: string) などを保持。
  - zundo の設定:
  - 他ユーザーからの変更を適用する際に、zundo の履歴に追加されないように、temporal の管理外で状態を更新するロジックが必要。例えば、状態更新関数にフラグを渡し、temporal ミドルウェアがそのフラグを見て履歴操作をスキップする、あるいは temporal が提供する temporal.getState().pause() / resume() を利用するなどの方法が考えられる。
- アクション:
  - setContent(newContent: string, fromRemote: boolean = false): 内容を更新するアクション。fromRemote フラグでローカル操作かリモートからの更新かを区別し、zundo の挙動を制御する。
  - undo(): temporal.getState().undo() を呼び出す。
  - redo(): temporal.getState().redo() を呼び出す。
- WebSocketクライアント:
  - useEffect フック等でコンポーネントマウント時にWebSocket接続を確立し、アンマウント時に切断する。
  - サーバーからのメッセージ (message イベント) をリッスンし、受け取ったデータで setContent(..., true) を呼び出してローカルの状態を更新する。
- Throttling:
  - エディタの onChange イベントハンドラ内で、setContent(newContent, false) を呼び出し、同時に WebSocketでサーバーに変更を送信する処理を throttle 関数（例: lodash/throttle）でラップ。送信間隔は 2000ms 程度。
- Undo/Redo ボタン:
  - クリック時に、Zustandストアの undo() / redo() アクションを呼び出す。
  - ローカルで Undo/Redo を実行した後、その結果の状態（新しい content）を 改めてWebSocketでサーバーに送信 し、他のユーザーにも反映させる必要がある。これも throttle の対象にする。

2. バックエンド (FastAPI)
- WebSocketエンドポイント (/ws/{table_id}):
  - @app.websocket("/ws/{table_id}") デコレータを使用。
  - クライアントからの接続を受け付け (websocket.accept())、table_id ごとに接続を管理。
- Connection Manager:
  - 接続中のWebSocketクライアント (WebSocket オブジェクト) を管理するクラス。
  - table_id をキーとして、接続リストを辞書 (Dict[str, List[WebSocket]]) で保持。
  - メソッド例: connect(websocket: WebSocket, table_id: str), disconnect(websocket: WebSocket, table_id: str), broadcast(message: str, table_id: str, sender: WebSocket)
- テーブル状態管理:
  - 各 table_id の最新の内容をサーバー側で保持。
  - 初期実装: Pythonの辞書 (Dict[str, str]) でインメモリ管理。サーバーが再起動すると内容は消える。
- メッセージ処理:
  - クライアント接続時:
    - manager.connect() で接続を登録。
    - 現在のテーブル内容 (table_state.get(table_id, "")) を接続してきたクライアントに送信 (manager.send_personal_message())。
  - クライアントからのメッセージ受信時 (websocket.receive_text() または receive_json()):
    - 受信データをパース（JSON形式が扱いやすい）。
    - メッセージタイプ（例: content_update）に応じて処理を分岐。
    - content_update の場合:
      - サーバー側の table_state[table_id] を更新。
      - manager.broadcast() を呼び出し、送信者以外の 同じ table_id に接続している全クライアントに変更内容を送信。
  - クライアント切断時 (try...except WebSocketDisconnect など):
    - manager.disconnect() で接続を解除。

## データフロー例
1. ユーザーAが あるセルに 'Hello' と入力:
  - Next.js: onChange -> handleEditorChange -> setContent('Hello', false) (Zustand更新, zundo履歴追加) -> throttledSendChange('Hello') 呼び出し。
  - Throttle待機後: sendChangeViaWebSocket({ type: 'content_update', payload: 'Hello' }) 実行。
  - FastAPI: /ws/doc1 でメッセージ受信 -> document_state['doc1'] = 'Hello' -> ユーザーBに { type: 'remote_update', payload: 'Hello' } をブロードキャスト。
  - ユーザーB (Next.js): WebSocketでメッセージ受信 -> setContent('Hello', true) 呼び出し (Zustand更新、zundo履歴には追加しない)。エディタUIの該当セルが 'Hello' に更新される。
2. ユーザーAがUndo:
  - Next.js: Undoボタンクリック -> handleUndo -> temporal.undo() (Zustandの状態が元に戻る, 例: 空文字列に) -> sendChangeViaWebSocket({ type: 'content_update', payload: '' })。
  - FastAPI: /ws/doc1 でメッセージ受信 -> document_state['doc1'] = '' -> ユーザーBに { type: 'remote_update', payload: '' } をブロードキャスト。
  - ユーザーB (Next.js): WebSocketでメッセージ受信 -> setContent('', true)。エディタUIの該当セルが空に更新される。

## 考慮事項と発展 (今回は実装しない)

- 衝突解決: この設計では、サーバーが最後に受け取った内容で状態を上書きする「Last Write Wins」方式。複数人が同時に近い場所を編集すると、意図しない結果になる可能性がある。
- プレゼンス表示: 誰が同じドキュメントを編集中かを表示するには、接続/切断イベントをクライアントに通知する仕組みが必要。
- エラーハンドリング: WebSocket接続の切断と再接続、メッセージの欠落などに対するハンドリングを強化する必要がある。