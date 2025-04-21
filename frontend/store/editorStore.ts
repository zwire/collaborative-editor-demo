import { create } from "zustand";
import { immer } from "zustand/middleware/immer";

// グリッドの型定義
export type GridData = string[][];

export interface EditorState {
	gridData: GridData;
	setCellContent: (rowIndex: number, colIndex: number, value: string) => void;
	setGridData: (newGridData: GridData) => void; // fromRemote は applyRemoteUpdate で制御
}

// 初期状態 (5x5 グリッド)
const initialGridData: GridData = Array(5)
	.fill(null)
	.map(() => Array(5).fill(""));

// immerミドルウェアを適用してストアを作成
export const useEditorStore = create(
	immer<EditorState>((set) => ({
		// immerでラップ
		gridData: initialGridData,
		// 特定のセルの内容を更新するアクション (Immerを使用)
		setCellContent: (rowIndex, colIndex, value) => {
			set((state) => {
				// set関数内でstateを直接変更するように書ける
				// Ensure row and column exist before assignment (optional safety check)
				if (state.gridData[rowIndex] !== undefined) {
					state.gridData[rowIndex][colIndex] = value;
				} else {
					console.warn(`Row index ${rowIndex} out of bounds.`);
				}
			});
		},
		// グリッド全体のデータを置き換えるアクション (Immerを使用)
		setGridData: (newGridData) => {
			set((state) => {
				state.gridData = newGridData;
			});
		},
	})),
);
