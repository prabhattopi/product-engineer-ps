import { WebSocket, WebSocketServer } from 'ws';
import crypto from 'crypto';
import { ClientMessage, IncidentMessage, ServerMessage } from './types.js';
import { MessageStore } from './store.js';

interface ClientSession {
  connectionId: string;
  ws: WebSocket;
  roomId?: string;
  isAlive: boolean;
  connectedAt: string;
}

export class WebSocketHandler {
  private wss: WebSocketServer;
  private store: MessageStore;
  private clients: Map<string, ClientSession> = new Map();
  private heartbeatInterval?: NodeJS.Timeout;

  constructor(wss: WebSocketServer, store: MessageStore) {
    this.wss = wss;
    this.store = store;
    this.init();
  }

  private init(): void {
    this.wss.on('connection', (ws: WebSocket) => {
      const connectionId = crypto.randomUUID();
      const session: ClientSession = {
        connectionId,
        ws,
        isAlive: true,
        connectedAt: new Date().toISOString(),
      };

      this.clients.set(connectionId, session);

      // Send initial WELCOME frame
      this.send(ws, {
        type: 'WELCOME',
        connectionId,
        timestamp: session.connectedAt,
      });

      // Handle raw ping/pong
      ws.on('pong', () => {
        session.isAlive = true;
      });

      ws.on('message', (data: Buffer | string) => {
        this.handleMessage(session, data.toString());
      });

      ws.on('close', () => {
        this.clients.delete(connectionId);
      });

      ws.on('error', (err) => {
        console.error(`[WebSocket] Client ${connectionId} error:`, err.message);
        this.clients.delete(connectionId);
      });
    });

    // Start 5-second ping/pong heartbeat
    this.heartbeatInterval = setInterval(() => {
      this.runHeartbeat();
    }, 5000);
  }

  private runHeartbeat(): void {
    for (const [connectionId, session] of this.clients.entries()) {
      if (!session.isAlive) {
        // Socket failed to respond to previous ping
        session.ws.terminate();
        this.clients.delete(connectionId);
        continue;
      }

      session.isAlive = false;
      try {
        session.ws.ping();
        this.send(session.ws, {
          type: 'PING',
          timestamp: new Date().toISOString(),
        });
      } catch {
        session.ws.terminate();
        this.clients.delete(connectionId);
      }
    }
  }

  private handleMessage(session: ClientSession, rawText: string): void {
    let parsed: ClientMessage;
    try {
      parsed = JSON.parse(rawText);
    } catch {
      this.send(session.ws, {
        type: 'ERROR',
        message: 'Invalid JSON payload format',
      });
      return;
    }

    switch (parsed.type) {
      case 'PONG': {
        session.isAlive = true;
        break;
      }

      case 'SUBSCRIBE': {
        const roomId = parsed.roomId?.trim();
        if (!roomId) {
          this.send(session.ws, {
            type: 'ERROR',
            message: 'roomId is required for SUBSCRIBE',
          });
          return;
        }

        session.roomId = roomId;
        const currentLatestSeq = this.store.getLatestSequence(roomId);
        const lastSequenceId = typeof parsed.lastSequenceId === 'number' ? parsed.lastSequenceId : 0;

        // Catch-up / Missed updates recovery (AC3)
        if (currentLatestSeq > lastSequenceId) {
          const missedMessages = this.store.getMessagesAfter(roomId, lastSequenceId);
          this.send(session.ws, {
            type: 'REPLAY',
            roomId,
            messages: missedMessages,
            fromSeq: lastSequenceId,
            toSeq: currentLatestSeq,
          });
        }

        // Acknowledge subscription
        this.send(session.ws, {
          type: 'SUBSCRIBED',
          roomId,
          latestSequence: currentLatestSeq,
        });
        break;
      }

      case 'PUBLISH': {
        const roomId = parsed.roomId?.trim() || session.roomId;
        if (!roomId) {
          this.send(session.ws, {
            type: 'ERROR',
            message: 'roomId is required for PUBLISH',
          });
          return;
        }

        if (!parsed.content || !parsed.content.trim()) {
          this.send(session.ws, {
            type: 'ERROR',
            message: 'content cannot be empty',
          });
          return;
        }

        const { message, isDuplicate } = this.store.saveMessage({
          roomId,
          content: parsed.content,
          author: parsed.author,
          severity: parsed.severity,
          clientMessageId: parsed.clientMessageId,
        });

        // Broadcast to all active subscribers in the room
        this.broadcastToRoom(roomId, message);
        break;
      }

      default: {
        this.send(session.ws, {
          type: 'ERROR',
          message: `Unknown message type`,
        });
      }
    }
  }

  public broadcastToRoom(roomId: string, message: IncidentMessage): void {
    const payload: ServerMessage = {
      type: 'BROADCAST',
      roomId,
      message,
    };

    for (const session of this.clients.values()) {
      if (
        session.roomId === roomId &&
        session.ws.readyState === WebSocket.OPEN
      ) {
        this.send(session.ws, payload);
      }
    }
  }

  private send(ws: WebSocket, message: ServerMessage): void {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(message));
    }
  }

  public getConnectedClientsCount(roomId?: string): number {
    if (!roomId) return this.clients.size;
    let count = 0;
    for (const session of this.clients.values()) {
      if (session.roomId === roomId && session.ws.readyState === WebSocket.OPEN) {
        count++;
      }
    }
    return count;
  }

  public close(): void {
    if (this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval);
    }
    for (const session of this.clients.values()) {
      session.ws.terminate();
    }
    this.clients.clear();
  }
}
