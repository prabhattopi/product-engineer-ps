import { describe, it, expect } from 'vitest';
import {
  createInitialFeedStore,
  ingestMessage,
  ingestReplayBatch,
} from './feedStore';
import type { IncidentMessage } from './types';

function createMsg(id: string, sequence: number, content: string): IncidentMessage {
  return {
    id,
    roomId: 'incident-alpha',
    sequence,
    content,
    author: 'Test Responder',
    severity: 'INFO',
    timestamp: new Date().toISOString(),
  };
}

describe('Client FeedStore (Deduplication & Monotonic Ordering)', () => {
  it('ingests live messages in monotonic sequence order (AC1 & AC5)', () => {
    let store = createInitialFeedStore();

    const m1 = createMsg('id-1', 1, 'Server started');
    const m2 = createMsg('id-2', 2, 'CPU high');

    const res1 = ingestMessage(store, m1);
    expect(res1.added).toBe(true);
    expect(res1.isDuplicate).toBe(false);

    const res2 = ingestMessage(res1.state, m2);
    expect(res2.added).toBe(true);
    expect(res2.state.messages.length).toBe(2);
    expect(res2.state.highestSequence).toBe(2);
  });

  it('maintains strict sequence ordering even if network messages arrive out of order (AC5)', () => {
    let store = createInitialFeedStore();

    // Arrives in reverse order: sequence 3 then sequence 1 then sequence 2
    const m3 = createMsg('id-3', 3, 'Resolution deployed');
    const m1 = createMsg('id-1', 1, 'Issue detected');
    const m2 = createMsg('id-2', 2, 'Investigating');

    store = ingestMessage(store, m3).state;
    store = ingestMessage(store, m1).state;
    store = ingestMessage(store, m2).state;

    expect(store.messages.length).toBe(3);
    // Verified sorted order: 1, 2, 3
    expect(store.messages[0].sequence).toBe(1);
    expect(store.messages[1].sequence).toBe(2);
    expect(store.messages[2].sequence).toBe(3);
    expect(store.messages[0].content).toBe('Issue detected');
    expect(store.messages[2].content).toBe('Resolution deployed');
  });

  it('filters out duplicates when the same message is delivered more than once (AC4)', () => {
    let store = createInitialFeedStore();

    const m1 = createMsg('id-1', 1, 'First update');

    const first = ingestMessage(store, m1);
    expect(first.added).toBe(true);
    expect(first.isDuplicate).toBe(false);

    // Identical message ID sent again
    const second = ingestMessage(first.state, m1);
    expect(second.added).toBe(false);
    expect(second.isDuplicate).toBe(true);
    expect(second.state.messages.length).toBe(1);
    expect(second.state.duplicatesFiltered).toBe(1);
  });

  it('deduplicates overlapping messages delivered via historical replay and live stream (AC3 & AC4)', () => {
    let store = createInitialFeedStore();

    // Suppose client already received message 1 and message 2 via live stream
    store = ingestMessage(store, createMsg('msg-1', 1, 'Message 1')).state;
    store = ingestMessage(store, createMsg('msg-2', 2, 'Message 2')).state;

    // After reconnecting, replay delivers messages [msg-2, msg-3, msg-4]
    // where msg-2 overlaps with what client already has!
    const replayBatch = [
      createMsg('msg-2', 2, 'Message 2'), // DUPLICATE
      createMsg('msg-3', 3, 'Message 3'), // NEW
      createMsg('msg-4', 4, 'Message 4'), // NEW
    ];

    const replayResult = ingestReplayBatch(store, replayBatch);

    expect(replayResult.addedCount).toBe(2);
    expect(replayResult.duplicateCount).toBe(1);
    expect(replayResult.state.messages.length).toBe(4);
    expect(replayResult.state.duplicatesFiltered).toBe(1);
    expect(replayResult.state.highestSequence).toBe(4);
    expect(replayResult.state.messages.map((m) => m.sequence)).toEqual([1, 2, 3, 4]);
  });
});
