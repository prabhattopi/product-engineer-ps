import type { IncidentMessage } from './types';

export interface FeedStoreState {
  messages: IncidentMessage[];
  seenIds: Set<string>;
  highestSequence: number;
  duplicatesFiltered: number;
  lastReplayCount: number;
}

export function createInitialFeedStore(): FeedStoreState {
  return {
    messages: [],
    seenIds: new Set<string>(),
    highestSequence: 0,
    duplicatesFiltered: 0,
    lastReplayCount: 0,
  };
}

/**
 * Ingests a single message with strict deduplication (AC4) and stable sequence ordering (AC5).
 */
export function ingestMessage(
  state: FeedStoreState,
  message: IncidentMessage
): { state: FeedStoreState; added: boolean; isDuplicate: boolean } {
  if (state.seenIds.has(message.id)) {
    return {
      state: {
        ...state,
        duplicatesFiltered: state.duplicatesFiltered + 1,
      },
      added: false,
      isDuplicate: true,
    };
  }

  const nextSeenIds = new Set(state.seenIds);
  nextSeenIds.add(message.id);

  // Insert maintaining stable ascending order by sequence
  const nextMessages = [...state.messages, message].sort((a, b) => a.sequence - b.sequence);
  const nextHighestSeq = Math.max(state.highestSequence, message.sequence);

  return {
    state: {
      ...state,
      messages: nextMessages,
      seenIds: nextSeenIds,
      highestSequence: nextHighestSeq,
    },
    added: true,
    isDuplicate: false,
  };
}

/**
 * Ingests a batch of historical / replay messages with deduplication (AC3, AC4).
 */
export function ingestReplayBatch(
  state: FeedStoreState,
  replayedMessages: IncidentMessage[]
): { state: FeedStoreState; addedCount: number; duplicateCount: number } {
  let dupes = 0;
  let added = 0;
  const nextSeenIds = new Set(state.seenIds);
  const toAdd: IncidentMessage[] = [];

  for (const msg of replayedMessages) {
    if (nextSeenIds.has(msg.id)) {
      dupes++;
    } else {
      nextSeenIds.add(msg.id);
      toAdd.push(msg);
      added++;
    }
  }

  if (toAdd.length === 0) {
    return {
      state: {
        ...state,
        duplicatesFiltered: state.duplicatesFiltered + dupes,
        lastReplayCount: 0,
      },
      addedCount: 0,
      duplicateCount: dupes,
    };
  }

  const combined = [...state.messages, ...toAdd].sort((a, b) => a.sequence - b.sequence);
  const maxSeq = combined.reduce((acc, m) => Math.max(acc, m.sequence), state.highestSequence);

  return {
    state: {
      ...state,
      messages: combined,
      seenIds: nextSeenIds,
      highestSequence: maxSeq,
      duplicatesFiltered: state.duplicatesFiltered + dupes,
      lastReplayCount: added,
    },
    addedCount: added,
    duplicateCount: dupes,
  };
}
