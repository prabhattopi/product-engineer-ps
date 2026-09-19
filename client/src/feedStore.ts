import type { IncidentMessage } from './types';

export interface FeedStoreState {
  messages: IncidentMessage[];
  seenIds: Set<string>;
  highestSequence: number;
  duplicatesFiltered: number;
  missedCaughtUpCount: number;
  initialHistoryCount: number;
  hasInitialLoaded: boolean;
}

export function createInitialFeedStore(): FeedStoreState {
  return {
    messages: [],
    seenIds: new Set<string>(),
    highestSequence: 0,
    duplicatesFiltered: 0,
    missedCaughtUpCount: 0,
    initialHistoryCount: 0,
    hasInitialLoaded: false,
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

  // Insert maintaining stable ascending order by sequence (AC5)
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
 * Ingests a batch of historical or replay messages with deduplication (AC3, AC4).
 * fromSeq indicates the cursor from which the replay was requested. If fromSeq > 0,
/**
 * Ingests a batch of historical or replay messages with deduplication (AC3, AC4).
 * isReconnection: true when recovering updates after a disconnect/reconnection.
 */
export function ingestReplayBatch(
  state: FeedStoreState,
  replayedMessages: IncidentMessage[],
  isReconnection = false
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
      },
      addedCount: 0,
      duplicateCount: dupes,
    };
  }

  const combined = [...state.messages, ...toAdd].sort((a, b) => a.sequence - b.sequence);
  const maxSeq = combined.reduce((acc, m) => Math.max(acc, m.sequence), state.highestSequence);

  // If this batch arrived during a reconnection, ALL newly added messages are missed updates (AC3)!
  const newMissedCaughtUp = isReconnection
    ? state.missedCaughtUpCount + added
    : state.missedCaughtUpCount;
  const newInitialHistory = !isReconnection
    ? state.initialHistoryCount + added
    : state.initialHistoryCount;

  return {
    state: {
      ...state,
      messages: combined,
      seenIds: nextSeenIds,
      highestSequence: maxSeq,
      duplicatesFiltered: state.duplicatesFiltered + dupes,
      missedCaughtUpCount: newMissedCaughtUp,
      initialHistoryCount: newInitialHistory,
      hasInitialLoaded: true,
    },
    addedCount: added,
    duplicateCount: dupes,
  };
}
