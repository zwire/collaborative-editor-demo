"use client";

import { useEditorStore } from "@/store/editorStore";
import { throttle } from "lodash-es";
import type React from "react";
import { useCallback, useEffect, useRef, useState } from "react";

const TABLE_ID = "default_table";
const WEBSOCKET_URL = `ws://localhost:8000/ws/${TABLE_ID}`;
const THROTTLE_INTERVAL = 2000; // ms

// Define the structure for cell updates
interface CellUpdate {
	rowIndex: number;
	colIndex: number;
	value: string;
}

export default function Home() {
	const { gridData, setCellContent, setGridData } = useEditorStore();

	const ws = useRef<WebSocket | null>(null);
	const [isConnected, setIsConnected] = useState(false);
	const pendingUpdatesRef = useRef<CellUpdate[]>([]);

	// --- WebSocket Communication ---

	// Throttle function for sending cell updates via WebSocket
	const throttledSendUpdate = useCallback(
		throttle(() => {
			const updatesToSend = pendingUpdatesRef.current; // Get updates from ref
			if (
				ws.current &&
				ws.current.readyState === WebSocket.OPEN &&
				updatesToSend.length > 0
			) {
				const message = JSON.stringify({
					type: "cell_updates",
					payload: updatesToSend, // Send the array of updates from ref
				});
				console.log("Sending cell updates:", message);
				ws.current.send(message);
				// Clear pending updates ref after sending
				pendingUpdatesRef.current = [];
			} else if (updatesToSend.length > 0) {
				console.warn("WebSocket not open or no updates to send.");
			}
		}, THROTTLE_INTERVAL),
		[],
	);

	useEffect(() => {
		console.log("Attempting to connect WebSocket...");
		ws.current = new WebSocket(WEBSOCKET_URL);

		ws.current.onopen = () => {
			console.log("WebSocket connected");
			setIsConnected(true);
		};

		ws.current.onclose = (event) => {
			console.log("WebSocket disconnected:", event.code, event.reason);
			setIsConnected(false);
			// TODO: Implement reconnection logic here
		};

		ws.current.onerror = (error) => {
			console.error("WebSocket error:", error);
			setIsConnected(false);
		};

		ws.current.onmessage = (event) => {
			try {
				console.log("Message received:", event.data);
				const message = JSON.parse(event.data);

				if (message.type === "initial_state") {
					// Payload should be a JSON string representing the grid data
					const receivedGridData = JSON.parse(message.payload);
					if (Array.isArray(receivedGridData)) {
						console.log("Applying initial state:", receivedGridData);
						// Use setGridData for initial state
						setGridData(receivedGridData);
					} else {
						console.error(
							"Received invalid grid data structure for initial_state:",
							receivedGridData,
						);
					}
				} else if (message.type === "remote_cell_update") {
					// Payload should be an object { rowIndex, colIndex, value }
					const { rowIndex, colIndex, value } = message.payload;
					if (
						typeof rowIndex === "number" &&
						typeof colIndex === "number" &&
						typeof value === "string"
					) {
						console.log("Applying remote cell update:", message.payload);
						// Directly update the cell using setCellContent from the store
						// No need for applyRemoteUpdate as Immer handles immutability
						setCellContent(rowIndex, colIndex, value);
					} else {
						console.error(
							"Received invalid payload for remote_cell_update:",
							message.payload,
						);
					}
				} else {
					console.warn("Received unknown message type:", message.type);
				}
			} catch (error) {
				console.error("Failed to parse message or apply update:", error);
			}
		};

		// Cleanup function on component unmount
		return () => {
			console.log("Closing WebSocket connection...");
			ws.current?.close();
		};
	}, [setGridData, setCellContent]);

	// --- Event Handlers ---

	const handleCellChange = (
		rowIndex: number,
		colIndex: number,
		event: React.ChangeEvent<HTMLInputElement>,
	) => {
		const newValue = event.target.value;
		// Update local state immediately (triggers re-render via Zustand + Immer)
		setCellContent(rowIndex, colIndex, newValue);

		// Add the change to the pending updates ref
		const update: CellUpdate = { rowIndex, colIndex, value: newValue };
		pendingUpdatesRef.current.push(update);

		// Trigger throttled WebSocket update (no arguments needed)
		throttledSendUpdate();
	};

	// --- Rendering ---

	return (
		<main className="flex min-h-screen flex-col items-center p-8">
			<h1 className="text-2xl font-bold mb-4">Real-time Collaborative Grid</h1>
			<div className="mb-4">
				Connection Status:{" "}
				{isConnected ? (
					<span className="text-green-500">Connected</span>
				) : (
					<span className="text-red-500">Disconnected</span>
				)}
			</div>
			<div className="grid grid-cols-5 gap-0 border border-gray-300">
				{/* Add types to map parameters */}
				{gridData.map((row: string[], rowIndex: number) =>
					row.map((cell: string, colIndex: number) => (
						<input
							key={`${rowIndex}-${colIndex.toString()}`}
							type="text"
							value={cell}
							onChange={(e) => handleCellChange(rowIndex, colIndex, e)}
							className="w-24 h-10 border border-gray-200 p-1 text-center focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
							disabled={!isConnected} // Disable input if not connected
						/>
					)),
				)}
			</div>
			<p className="mt-4 text-sm text-gray-600">
				Changes are sent to other users after a short delay (
				{THROTTLE_INTERVAL / 1000}s).
			</p>
		</main>
	);
}
