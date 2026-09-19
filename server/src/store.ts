import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { IncidentMessage, MessageSeverity, PublishInput } from './types.js';

export interface StoreData {
  sequences: Record<string, number>;
  messages: Record<string, IncidentMessage[]>;
}

export class MessageStore {
  private dataFilePath: string;
  private sequences: Map<string, number> = new Map();
  private messagesByRoom: Map<string, IncidentMessage[]> = new Map();
  // Map of roomId -> (clientMessageId -> IncidentMessage) for idempotent ingestion
  private clientMsgDedupe: Map<string, Map<string, IncidentMessage>> = new Map();

  constructor(filePath?: string) {
    const dataDir = path.resolve(process.cwd(), 'data');
    if (!fs.existsSync(dataDir)) {
      fs.mkdirSync(dataDir, { recursive: true });
    }
    this.dataFilePath = filePath || path.join(dataDir, 'incident_store.json');
    this.loadFromDisk();
  }

  private loadFromDisk(): void {
    if (!fs.existsSync(this.dataFilePath)) {
      return;
    }

    try {
      const raw = fs.readFileSync(this.dataFilePath, 'utf-8');
      if (!raw.trim()) return;

      const parsed: StoreData = JSON.parse(raw);
      if (parsed.sequences) {
        for (const [room, seq] of Object.entries(parsed.sequences)) {
          this.sequences.set(room, seq);
        }
      }

      if (parsed.messages) {
        for (const [room, msgs] of Object.entries(parsed.messages)) {
          this.messagesByRoom.set(room, msgs);

          const dedupeMap = new Map<string, IncidentMessage>();
          for (const msg of msgs) {
            dedupeMap.set(msg.id, msg);
          }
          this.clientMsgDedupe.set(room, dedupeMap);
        }
      }
    } catch (err) {
      console.error('[MessageStore] Failed to load data from disk, starting fresh:', err);
    }
  }

  private flushToDisk(): void {
    try {
      const out: StoreData = {
        sequences: Object.fromEntries(this.sequences.entries()),
        messages: Object.fromEntries(this.messagesByRoom.entries()),
      };
      // Atomic write: write to tmp file then rename
      const tmpPath = `${this.dataFilePath}.tmp`;
      fs.writeFileSync(tmpPath, JSON.stringify(out, null, 2), 'utf-8');
      fs.renameSync(tmpPath, this.dataFilePath);
    } catch (err) {
      console.error('[MessageStore] Failed to flush store to disk:', err);
    }
  }

  public getLatestSequence(roomId: string): number {
    return this.sequences.get(roomId) || 0;
  }

  public saveMessage(input: PublishInput): { message: IncidentMessage; isDuplicate: boolean } {
    const roomId = input.roomId.trim();
    const content = input.content.trim();
    const author = input.author?.trim() || 'Anonymous Responder';
    const severity: MessageSeverity = input.severity || 'INFO';
    const messageId = input.clientMessageId?.trim() || crypto.randomUUID();

    // 1. Check for duplicate clientMessageId in this room (Idempotent Ingestion)
    let dedupeMap = this.clientMsgDedupe.get(roomId);
    if (!dedupeMap) {
      dedupeMap = new Map();
      this.clientMsgDedupe.set(roomId, dedupeMap);
    }

    const existing = dedupeMap.get(messageId);
    if (existing) {
      return { message: existing, isDuplicate: true };
    }

    // 2. Atomically allocate next sequence number
    const currentSeq = this.getLatestSequence(roomId);
    const nextSeq = currentSeq + 1;
    this.sequences.set(roomId, nextSeq);

    // 3. Create canonical incident message
    const message: IncidentMessage = {
      id: messageId,
      roomId,
      sequence: nextSeq,
      content,
      author,
      severity,
      timestamp: new Date().toISOString(),
    };

    // 4. Store in memory
    let roomMessages = this.messagesByRoom.get(roomId);
    if (!roomMessages) {
      roomMessages = [];
      this.messagesByRoom.set(roomId, roomMessages);
    }
    roomMessages.push(message);
    dedupeMap.set(messageId, message);

    // 5. Persist to disk
    this.flushToDisk();

    return { message, isDuplicate: false };
  }

  public getMessagesAfter(roomId: string, afterSequenceId = 0, limit = 100): IncidentMessage[] {
    const roomMessages = this.messagesByRoom.get(roomId) || [];
    // Messages are strictly appended in sequence order
    return roomMessages
      .filter((msg) => msg.sequence > afterSequenceId)
      .slice(0, limit);
  }

  public getAllMessages(roomId: string): IncidentMessage[] {
    return this.messagesByRoom.get(roomId) || [];
  }

  public clearAll(): void {
    this.sequences.clear();
    this.messagesByRoom.clear();
    this.clientMsgDedupe.clear();
    if (fs.existsSync(this.dataFilePath)) {
      try {
        fs.unlinkSync(this.dataFilePath);
      } catch {
        // ignore
      }
    }
  }
}

// Singleton instance for runtime
export const defaultStore = new MessageStore();
