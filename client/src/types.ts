export type MessageSeverity = 'INFO' | 'WARNING' | 'CRITICAL';

export interface IncidentMessage {
  id: string;
  roomId: string;
  sequence: number;
  content: string;
  author: string;
  severity: MessageSeverity;
  timestamp: string;
}

export type ConnectionState = 'CONNECTED' | 'RECONNECTING' | 'DISCONNECTED';

export interface FeedStats {
  highestSequenceId: number;
  totalReceived: number;
  duplicatesFiltered: number;
  reconnectAttempts: number;
  lastReplayCount: number;
  lastConnectedAt?: string;
  lastDisconnectedAt?: string;
}

// WebSocket Protocol
export type ClientMessage =
  | {
      type: 'SUBSCRIBE';
      roomId: string;
      lastSequenceId?: number;
    }
  | {
      type: 'PUBLISH';
      roomId: string;
      content: string;
      author?: string;
      severity?: MessageSeverity;
      clientMessageId?: string;
    }
  | {
      type: 'PONG';
    };

export type ServerMessage =
  | {
      type: 'WELCOME';
      connectionId: string;
      timestamp: string;
    }
  | {
      type: 'SUBSCRIBED';
      roomId: string;
      latestSequence: number;
    }
  | {
      type: 'REPLAY';
      roomId: string;
      messages: IncidentMessage[];
      fromSeq: number;
      toSeq: number;
    }
  | {
      type: 'BROADCAST';
      roomId: string;
      message: IncidentMessage;
    }
  | {
      type: 'PING';
      timestamp: string;
    }
  | {
      type: 'ERROR';
      message: string;
      code?: string;
    };
