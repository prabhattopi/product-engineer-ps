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
  const highestSequenceRef = useRef<number>(0);
  const isSimulatedOfflineRef = useRef<boolean>(false);
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const countdownIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Keep refs in sync
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
          roomId,
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
              // Missed-update recovery (AC3) + deduplication (AC4)
              if (data.roomId === roomId && data.messages.length > 0) {
                setFeedState((prev) => {
                  const { state } = ingestReplayBatch(prev, data.messages);
                  return state;
                });
              }
              break;
            }

            case 'BROADCAST': {
              // Live update (AC1) + deduplication (AC4) + monotonic ordering (AC5)
              if (data.roomId === roomId) {
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

            case 'SUBSCRIBED':
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
  }, [wsUrl, roomId, clearTimers]);

  // Connect on mount or roomId change
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

      const clientMessageId = crypto.randomUUID();

      // If socket is open, send via WebSocket
      if (socketRef.current && socketRef.current.readyState === WebSocket.OPEN) {
        const payload: ClientMessage = {
          type: 'PUBLISH',
          roomId,
          content: content.trim(),
          author,
          severity,
          clientMessageId,
        };
        socketRef.current.send(JSON.stringify(payload));
      } else {
        // Fallback: send via REST API if disconnected
        try {
          const res = await fetch(`${apiUrl}/rooms/${roomId}/messages`, {
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
    [roomId, apiUrl]
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

  // Switch Room
  const switchRoom = useCallback(
    (newRoomId: string) => {
      if (newRoomId === roomId) return;
      setRoomId(newRoomId);
      setFeedState(createInitialFeedStore());
      highestSequenceRef.current = 0;
    },
    [roomId]
  );

  const stats: FeedStats = {
    highestSequenceId: feedState.highestSequence,
    totalReceived: feedState.messages.length,
    duplicatesFiltered: feedState.duplicatesFiltered,
    reconnectAttempts: reconnectAttempt,
    lastReplayCount: feedState.lastReplayCount,
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
  };
}
