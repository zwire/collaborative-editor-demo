import { create } from 'zustand';
import { temporal } from 'zundo';
import { shallow } from 'zustand/shallow';

// グリッドの型定義
export type GridData = string[][];

export interface EditorState {
  gridData: GridData;
  setCellContent: (rowIndex: number, colIndex: number, value: string) => void;
  setGridData: (newGridData: GridData) => void; // fromRemote は applyRemoteUpdate で制御
}

// 初期状態 (5x5 グリッド)
const initialGridData: GridData = Array(5).fill(null).map(() => Array(5).fill(''));

// temporalミドルウェアを適用してストアを作成
export const useEditorStore = create(
  temporal<EditorState>(
    (set, get) => ({
      gridData: initialGridData,
      // 特定のセルの内容を更新するアクション
      setCellContent: (rowIndex, colIndex, value) => {
        const currentGridData = get().gridData;
        // 新しいグリッドデータを作成（イミュータブルに更新）
        const newGridData = currentGridData.map((row, rIdx) =>
          rIdx === rowIndex
            ? row.map((cell, cIdx) => (cIdx === colIndex ? value : cell))
            : row
        );
        set({ gridData: newGridData });
      },
      // グリッド全体のデータを置き換えるアクション
      setGridData: (newGridData) => {
        set({ gridData: newGridData });
      },
    }),
    {
      // zundo の設定
      partialize: (state: EditorState) => {
        // 履歴管理の対象となる状態を選択 (gridData のみ)
        const { gridData } = state;
        return { gridData } as EditorState;
      },
      equality: shallow, // ネストされた配列/オブジェクトの比較用
      // limit: 100, // 履歴の最大数を設定（任意）
      // onSave: (_pastStates, _presentState) => { // 保存時のコールバック（任意）
      //   console.log('State saved to history');
      // },
    }
  )
);

// --- zundo の pause/resume を使うためのヘルパー関数 ---

// リモートからの更新を適用する関数 (zundo履歴に追加しない)
export const applyRemoteUpdate = (newGridData: GridData) => {
  // getState() から直接 setGridData を取得 (型エラーが出るか確認)
  const { setGridData } = useEditorStore.getState();
  const { pause, resume } = useEditorStore.temporal.getState();

  pause(); // 履歴記録を一時停止
  try {
    setGridData(newGridData); // 状態を更新
  } finally {
    resume(); // 履歴記録を再開
  }
};

