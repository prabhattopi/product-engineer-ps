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

export interface PublishInput {
  roomId: string;
  content: string;
  author?: string;
  severity?: MessageSeverity;
  clientMessageId?: string;
}

// WebSocket Protocol - Client to Server
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

// WebSocket Protocol - Server to Client
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
