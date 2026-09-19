import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import path from 'path';
import fs from 'fs';
import { MessageStore } from '../src/store.js';

describe('MessageStore and Sequence Engine', () => {
  const testDbPath = path.resolve(process.cwd(), 'data', 'test_store.json');
  let store: MessageStore;

  beforeEach(() => {
    if (fs.existsSync(testDbPath)) {
      fs.unlinkSync(testDbPath);
    }
    store = new MessageStore(testDbPath);
  });

  afterEach(() => {
    if (fs.existsSync(testDbPath)) {
      fs.unlinkSync(testDbPath);
    }
  });

  it('assigns strictly monotonically increasing sequence IDs', () => {
    const roomId = 'incident-test-1';

    const res1 = store.saveMessage({ roomId, content: 'Update 1' });
    const res2 = store.saveMessage({ roomId, content: 'Update 2' });
    const res3 = store.saveMessage({ roomId, content: 'Update 3' });

    expect(res1.message.sequence).toBe(1);
    expect(res2.message.sequence).toBe(2);
    expect(res3.message.sequence).toBe(3);
    expect(store.getLatestSequence(roomId)).toBe(3);
  });

  it('isolates sequence numbers between different incident rooms', () => {
    const roomA = 'incident-room-a';
    const roomB = 'incident-room-b';

    const a1 = store.saveMessage({ roomId: roomA, content: 'A1' });
    const b1 = store.saveMessage({ roomId: roomB, content: 'B1' });
    const a2 = store.saveMessage({ roomId: roomA, content: 'A2' });

    expect(a1.message.sequence).toBe(1);
    expect(b1.message.sequence).toBe(1);
    expect(a2.message.sequence).toBe(2);
  });

  it('handles idempotent ingestion for duplicate clientMessageId', () => {
    const roomId = 'incident-dedupe';
    const clientMessageId = 'msg-uuid-12345';

    const first = store.saveMessage({
      roomId,
      content: 'Database degraded',
      clientMessageId,
    });
    expect(first.isDuplicate).toBe(false);
    expect(first.message.sequence).toBe(1);

    // Repeated submission with the same clientMessageId
    const second = store.saveMessage({
      roomId,
      content: 'Database degraded',
      clientMessageId,
    });
    expect(second.isDuplicate).toBe(true);
    expect(second.message.sequence).toBe(1);
    expect(second.message.id).toBe(clientMessageId);

    // Total stored messages should still be 1
    expect(store.getAllMessages(roomId).length).toBe(1);
  });

  it('correctly returns missed messages after a sequence cursor', () => {
    const roomId = 'incident-replay';

    store.saveMessage({ roomId, content: 'Message 1' }); // seq 1
    store.saveMessage({ roomId, content: 'Message 2' }); // seq 2
    store.saveMessage({ roomId, content: 'Message 3' }); // seq 3
    store.saveMessage({ roomId, content: 'Message 4' }); // seq 4

    // Client had last seen sequence 2, needs updates after 2
    const missed = store.getMessagesAfter(roomId, 2);

    expect(missed.length).toBe(2);
    expect(missed[0].sequence).toBe(3);
    expect(missed[1].sequence).toBe(4);
    expect(missed[0].content).toBe('Message 3');
    expect(missed[1].content).toBe('Message 4');
  });

  it('persists data durably across store instances (simulated process restart)', () => {
    const roomId = 'incident-persistence';

    store.saveMessage({ roomId, content: 'Persisted message 1' });
    store.saveMessage({ roomId, content: 'Persisted message 2' });

    // Simulate new server startup reading same file
    const restartedStore = new MessageStore(testDbPath);

    expect(restartedStore.getLatestSequence(roomId)).toBe(2);
    const messages = restartedStore.getAllMessages(roomId);
    expect(messages.length).toBe(2);
    expect(messages[1].content).toBe('Persisted message 2');
  });
});
