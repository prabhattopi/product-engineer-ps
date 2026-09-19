import { useEffect, useRef, useState, useCallback } from 'react';
import type {
  ClientMessage,
  ConnectionState,
  FeedStats,
  MessageSeverity,
  ServerMessage,
} from '../types';
import {
  createInitialFeedStore,
  type FeedStoreState,
  ingestMessage,
  ingestReplayBatch,
} from '../feedStore';

interface UseIncidentFeedOptions {
  wsUrl?: string;
  apiUrl?: string;
  initialRoomId?: string;
}

export function useIncidentFeed(options: UseIncidentFeedOptions = {}) {
  const wsUrl = options.wsUrl || 'ws://localhost:4000';
  const apiUrl = options.apiUrl || 'http://localhost:4000/api';
  const [roomId, setRoomId] = useState<string>(options.initialRoomId || 'incident-alpha');

  const [connectionState, setConnectionState] = useState<ConnectionState>('DISCONNECTED');
  const [feedState, setFeedState] = useState<FeedStoreState>(createInitialFeedStore);
  const [isSimulatedOffline, setIsSimulatedOffline] = useState<boolean>(false);
  const [reconnectAttempt, setReconnectAttempt] = useState<number>(0);
  const [nextRetryInMs, setNextRetryInMs] = useState<number>(0);
  const [errorNotice, setErrorNotice] = useState<string | null>(null);

  const socketRef = useRef<WebSocket | null>(null);
  const roomIdRef = useRef<string>(roomId);
  const highestSequenceRef = useRef<number>(0);
  const isSimulatedOfflineRef = useRef<boolean>(false);
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const countdownIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const hasConnectedOnceRef = useRef<boolean>(false);

  // Keep refs in sync
  useEffect(() => {
    roomIdRef.current = roomId;
  }, [roomId]);

  useEffect(() => {
    highestSequenceRef.current = feedState.highestSequence;
  }, [feedState.highestSequence]);

  useEffect(() => {
    isSimulatedOfflineRef.current = isSimulatedOffline;
  }, [isSimulatedOffline]);

  const clearTimers = useCallback(() => {
    if (reconnectTimerRef.current) {
      clearTimeout(reconnectTimerRef.current);
      reconnectTimerRef.current = null;
    }
    if (countdownIntervalRef.current) {
      clearInterval(countdownIntervalRef.current);
      countdownIntervalRef.current = null;
    }
    setNextRetryInMs(0);
  }, []);

  const connect = useCallback(() => {
    clearTimers();

    if (isSimulatedOfflineRef.current) {
      setConnectionState('DISCONNECTED');
      return;
    }

    try {
      const socket = new WebSocket(wsUrl);
      socketRef.current = socket;

      socket.onopen = () => {
        setConnectionState('CONNECTED');
        setReconnectAttempt(0);
        setErrorNotice(null);

        // Send SUBSCRIBE with current sequence cursor for missed updates recovery (AC3)
        const subscribePayload: ClientMessage = {
          type: 'SUBSCRIBE',
          roomId: roomIdRef.current,
          lastSequenceId: highestSequenceRef.current,
        };
        socket.send(JSON.stringify(subscribePayload));
      };

      socket.onmessage = (event) => {
        try {
          const data: ServerMessage = JSON.parse(event.data);

          switch (data.type) {
            case 'PING': {
              socket.send(JSON.stringify({ type: 'PONG' }));
              break;
            }

            case 'REPLAY': {
              // Only process replay messages for our active room
              if (data.roomId === roomIdRef.current && data.messages.length > 0) {
                const isReconnection = hasConnectedOnceRef.current;
                setFeedState((prev) => {
                  const { state } = ingestReplayBatch(prev, data.messages, isReconnection);
                  return state;
                });
              }
              hasConnectedOnceRef.current = true;
              break;
            }

            case 'ROOM_RESET': {
              if (data.roomId === roomIdRef.current) {
                setFeedState(createInitialFeedStore());
                highestSequenceRef.current = 0;
              }
              break;
            }

            case 'BROADCAST': {
              // Live update (AC1) + deduplication (AC4) + monotonic ordering (AC5)
              if (data.roomId === roomIdRef.current) {
                setFeedState((prev) => {
                  const { state } = ingestMessage(prev, data.message);
                  return state;
                });
              }
              break;
            }

            case 'ERROR': {
              setErrorNotice(data.message);
              break;
            }

            case 'SUBSCRIBED': {
              hasConnectedOnceRef.current = true;
              // If server reports a sequence smaller than local state, the room was reset while offline
              if (data.latestSequence < highestSequenceRef.current) {
                setFeedState(createInitialFeedStore());
                highestSequenceRef.current = data.latestSequence;
              }
              break;
            }

            case 'WELCOME':
            default:
              break;
          }
        } catch (err) {
          console.error('[FeedHook] Error parsing server message:', err);
        }
      };

      socket.onclose = () => {
        socketRef.current = null;

        if (isSimulatedOfflineRef.current) {
          setConnectionState('DISCONNECTED');
          return;
        }

        // Connection interrupted (AC2) -> transition to RECONNECTING
        setConnectionState('RECONNECTING');

        // Exponential backoff with jitter: 1s, 2s, 4s, capped at 10s
        setReconnectAttempt((prevAttempt) => {
          const nextAttempt = prevAttempt + 1;
          const baseDelay = Math.min(1000 * Math.pow(1.8, prevAttempt), 10000);
          const jitter = Math.floor(Math.random() * 400);
          const totalDelay = Math.round(baseDelay + jitter);

          setNextRetryInMs(totalDelay);

          const startTime = Date.now();
          countdownIntervalRef.current = setInterval(() => {
            const elapsed = Date.now() - startTime;
            const remaining = Math.max(0, totalDelay - elapsed);
            setNextRetryInMs(remaining);
            if (remaining <= 0 && countdownIntervalRef.current) {
              clearInterval(countdownIntervalRef.current);
            }
          }, 100);

          reconnectTimerRef.current = setTimeout(() => {
            connect();
          }, totalDelay);

          return nextAttempt;
        });
      };

      socket.onerror = () => {
        // Handled in onclose
      };
    } catch {
      setConnectionState('DISCONNECTED');
    }
  }, [wsUrl, clearTimers]);

  // Connect on mount
  useEffect(() => {
    connect();

    return () => {
      clearTimers();
      if (socketRef.current) {
        socketRef.current.close();
        socketRef.current = null;
      }
    };
  }, [connect, clearTimers]);

  // Publish a new update
  const publishUpdate = useCallback(
    async (content: string, severity: MessageSeverity = 'INFO', author = 'Current User') => {
      if (!content.trim()) return;

      const currentRoom = roomIdRef.current;
      const clientMessageId = crypto.randomUUID();

      // If socket is open, send via WebSocket
      if (socketRef.current && socketRef.current.readyState === WebSocket.OPEN) {
        const payload: ClientMessage = {
          type: 'PUBLISH',
          roomId: currentRoom,
          content: content.trim(),
          author,
          severity,
          clientMessageId,
        };
        socketRef.current.send(JSON.stringify(payload));
      } else {
        // Fallback: send via REST API if disconnected
        try {
          const res = await fetch(`${apiUrl}/rooms/${currentRoom}/messages`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              content: content.trim(),
              author,
              severity,
              clientMessageId,
            }),
          });
          if (!res.ok) {
            throw new Error(`HTTP error ${res.status}`);
          }
        } catch (err: any) {
          setErrorNotice(`Failed to publish update: ${err.message}`);
        }
      }
    },
    [apiUrl]
  );

  // Simulate network disconnect (for testing and demo video)
  const simulateDisconnect = useCallback(() => {
    setIsSimulatedOffline(true);
    isSimulatedOfflineRef.current = true;
    clearTimers();

    if (socketRef.current) {
      socketRef.current.close();
      socketRef.current = null;
    }
    setConnectionState('DISCONNECTED');
  }, [clearTimers]);

  // Reconnect manually
  const reconnect = useCallback(() => {
    setIsSimulatedOffline(false);
    isSimulatedOfflineRef.current = false;
    setReconnectAttempt(0);
    setConnectionState('RECONNECTING');
    connect();
  }, [connect]);

  // Switch Room (seamless in-flight subscription change without tearing down socket!)
  const switchRoom = useCallback(
    (newRoomId: string) => {
      if (newRoomId === roomIdRef.current) return;
      setRoomId(newRoomId);
      roomIdRef.current = newRoomId;
      setFeedState(createInitialFeedStore());
      highestSequenceRef.current = 0;
      hasConnectedOnceRef.current = false; // Fresh room initial load

      // If socket is open, switch subscription immediately
      if (socketRef.current && socketRef.current.readyState === WebSocket.OPEN) {
        const payload: ClientMessage = {
          type: 'SUBSCRIBE',
          roomId: newRoomId,
          lastSequenceId: 0,
        };
        socketRef.current.send(JSON.stringify(payload));
      }
    },
    []
  );

  // Reset room on server (broadcasts ROOM_RESET to all connected tabs)
  const resetRoomOnServer = useCallback(async () => {
    const currentRoom = roomIdRef.current;
    try {
      const res = await fetch(`${apiUrl}/rooms/${currentRoom}/reset`, { method: 'POST' });
      if (!res.ok) {
        throw new Error(`HTTP ${res.status}`);
      }
      setFeedState(createInitialFeedStore());
      highestSequenceRef.current = 0;
    } catch (err: any) {
      setErrorNotice(`Failed to reset room: ${err.message}`);
    }
  }, [apiUrl]);

  // Clear local feed view only
  const clearFeed = useCallback(() => {
    setFeedState(createInitialFeedStore());
    highestSequenceRef.current = 0;
  }, []);

  // Injects a deliberate duplicate packet to demonstrate and verify AC4
  const injectSimulatedDuplicate = useCallback(() => {
    if (feedState.messages.length === 0) {
      setErrorNotice('Cannot simulate duplicate on empty feed. Post at least one message first.');
      return;
    }

    // Pick the latest message and try to ingest it a second time
    const targetMsg = feedState.messages[feedState.messages.length - 1];
    setFeedState((prev) => {
      const { state, isDuplicate } = ingestMessage(prev, targetMsg);
      if (isDuplicate) {
        setErrorNotice(`[AC4 Verified] Duplicate packet for message #${targetMsg.sequence} intercepted and dropped!`);
      }
      return state;
    });
  }, [feedState.messages]);

  const stats: FeedStats = {
    highestSequenceId: feedState.highestSequence,
    totalReceived: feedState.messages.length,
    duplicatesFiltered: feedState.duplicatesFiltered,
    reconnectAttempts: reconnectAttempt,
    missedCaughtUpCount: feedState.missedCaughtUpCount,
    initialHistoryCount: feedState.initialHistoryCount,
  };

  return {
    roomId,
    connectionState,
    messages: feedState.messages,
    stats,
    isSimulatedOffline,
    nextRetryInMs,
    errorNotice,
    publishUpdate,
    simulateDisconnect,
    reconnect,
    switchRoom,
    clearFeed,
    resetRoomOnServer,
    injectSimulatedDuplicate,
  };
}
