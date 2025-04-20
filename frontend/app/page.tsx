'use client';

import React, { useState, useEffect, useRef, useCallback } from 'react';
import { throttle } from 'lodash-es';
import {
  useEditorStore,
  applyRemoteUpdate,
  GridData,
  EditorState, // Import EditorState for type annotation
} from '../store/editorStore';

const TABLE_ID = 'default_table';
const WEBSOCKET_URL = `ws://localhost:8000/ws/${TABLE_ID}`;
const THROTTLE_INTERVAL = 2000; // ms

export default function Home() {
  const { gridData, setCellContent } = useEditorStore();
  const { undo, redo, pastStates, futureStates } = useEditorStore.temporal.getState();
  const canUndo = pastStates?.length > 0;
  const canRedo = futureStates?.length > 0;

  const ws = useRef<WebSocket | null>(null);
  const [isConnected, setIsConnected] = useState(false);

  // --- WebSocket Communication ---

  // Throttle function for sending updates via WebSocket
  // useCallback ensures the throttled function is stable across renders
  const throttledSendUpdate = useCallback(
    throttle((currentGridData: GridData) => {
      if (ws.current && ws.current.readyState === WebSocket.OPEN) {
        const message = JSON.stringify({
          type: 'grid_update',
          payload: JSON.stringify(currentGridData), // Send grid data as a JSON string
        });
        console.log('Sending update:', message);
        ws.current.send(message);
      } else {
        console.warn('WebSocket not open. Cannot send update.');
      }
    }, THROTTLE_INTERVAL, { leading: false, trailing: true }), // Throttle options
    [] // No dependencies, ws.current is accessed inside
  );

  useEffect(() => {
    console.log('Attempting to connect WebSocket...');
    ws.current = new WebSocket(WEBSOCKET_URL);

    ws.current.onopen = () => {
      console.log('WebSocket connected');
      setIsConnected(true);
    };

    ws.current.onclose = (event) => {
      console.log('WebSocket disconnected:', event.code, event.reason);
      setIsConnected(false);
      // Optional: Implement reconnection logic here
    };

    ws.current.onerror = (error) => {
      console.error('WebSocket error:', error);
      setIsConnected(false);
    };

    ws.current.onmessage = (event) => {
      try {
        console.log('Message received:', event.data);
        const message = JSON.parse(event.data);

        if (message.type === 'initial_state' || message.type === 'remote_update') {
          // Payload should be a JSON string representing the grid data
          const receivedGridData = JSON.parse(message.payload);
          if (Array.isArray(receivedGridData)) {
             console.log('Applying remote update:', receivedGridData);
             // Apply update without adding to local undo history
             applyRemoteUpdate(receivedGridData);
          } else {
             console.error('Received invalid grid data structure:', receivedGridData);
          }
        } else {
           console.warn('Received unknown message type:', message.type);
        }
      } catch (error) {
        console.error('Failed to parse message or apply update:', error);
      }
    };

    // Cleanup function on component unmount
    return () => {
      console.log('Closing WebSocket connection...');
      ws.current?.close();
    };
  }, []); // Empty dependency array ensures this runs only once on mount

  // --- Event Handlers ---

  const handleCellChange = (
    rowIndex: number,
    colIndex: number,
    event: React.ChangeEvent<HTMLInputElement>
  ) => {
    const newValue = event.target.value;
    // Update local state immediately (triggers re-render via Zustand)
    // This also adds the change to the local undo history
    setCellContent(rowIndex, colIndex, newValue);

    // Trigger throttled WebSocket update with the *new* state
    // Need to get the latest state *after* setCellContent has potentially updated it.
    // Accessing gridData directly from the component's current state.
    throttledSendUpdate(gridData); // Send the current gridData from component state
  };

  const handleUndo = () => {
    if (canUndo) {
      undo();
      // Get state after undo using getState().gridData
      // Use 'as any' here too if getState() has type issues
      const updatedGridData = (useEditorStore.getState() as any).gridData;
      throttledSendUpdate(updatedGridData);
      console.log('Undo performed, sending state.');
    }
  };

  const handleRedo = () => {
    if (canRedo) {
      redo();
      // Get state after redo using getState().gridData
      const updatedGridData = (useEditorStore.getState() as any).gridData;
      throttledSendUpdate(updatedGridData);
      console.log('Redo performed, sending state.');
    }
  };

  // --- Rendering ---

  return (
    <main className="flex min-h-screen flex-col items-center p-8">
      <h1 className="text-2xl font-bold mb-4">Real-time Collaborative Grid</h1>
      <div className="mb-4">
        Connection Status: {isConnected ? <span className="text-green-500">Connected</span> : <span className="text-red-500">Disconnected</span>}
      </div>
      <div className="mb-4 space-x-2">
        <button
          onClick={handleUndo}
          disabled={!canUndo || !isConnected}
          className="px-4 py-2 bg-blue-500 text-white rounded disabled:opacity-50"
        >
          Undo
        </button>
        <button
          onClick={handleRedo}
          disabled={!canRedo || !isConnected}
          className="px-4 py-2 bg-blue-500 text-white rounded disabled:opacity-50"
        >
          Redo
        </button>
      </div>
      <div className="grid grid-cols-5 gap-0 border border-gray-300">
        {/* Add types to map parameters */}
        {gridData.map((row: string[], rowIndex: number) =>
          row.map((cell: string, colIndex: number) => (
            <input
              key={`${rowIndex}-${colIndex}`}
              type="text"
              value={cell}
              onChange={(e) => handleCellChange(rowIndex, colIndex, e)}
              className="w-24 h-10 border border-gray-200 p-1 text-center focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
              disabled={!isConnected} // Disable input if not connected
            />
          ))
        )}
      </div>
       <p className="mt-4 text-sm text-gray-600">
         Changes are sent to other users after a short delay ({THROTTLE_INTERVAL / 1000}s).
       </p>
    </main>
  );
}
