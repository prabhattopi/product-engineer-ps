import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { AddressInfo } from 'net';
import WebSocket from 'ws';
import { server, wsHandler, defaultStore } from '../src/index.js';
import { ClientMessage, ServerMessage } from '../src/types.js';

describe('Real-Time Feed Integration Tests (AC1 - AC5)', () => {
  let port: number;
  let wsUrl: string;

  beforeAll(async () => {
    await new Promise<void>((resolve) => {
      server.listen(0, () => {
        const addr = server.address() as AddressInfo;
        port = addr.port;
        wsUrl = `ws://localhost:${port}`;
        resolve();
      });
    });
  });

  afterAll(async () => {
    wsHandler.close();
    await new Promise<void>((resolve) => {
      server.close(() => resolve());
    });
  });

  beforeEach(() => {
    defaultStore.clearAll();
  });

  function connectClient(): Promise<WebSocket> {
    return new Promise((resolve, reject) => {
      const ws = new WebSocket(wsUrl);
      ws.on('open', () => resolve(ws));
      ws.on('error', reject);
    });
  }

  function waitForMessage(
    ws: WebSocket,
    predicate: (msg: ServerMessage) => boolean,
    timeoutMs = 3000
  ): Promise<ServerMessage> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        ws.off('message', handler);
        reject(new Error(`Timeout waiting for message after ${timeoutMs}ms`));
      }, timeoutMs);

      const handler = (raw: WebSocket.RawData) => {
        try {
          const parsed: ServerMessage = JSON.parse(raw.toString());
          if (predicate(parsed)) {
            clearTimeout(timer);
            ws.off('message', handler);
            resolve(parsed);
          }
        } catch {
          // ignore non-json
        }
      };

      ws.on('message', handler);
    });
  }

  it('AC1: Live update broadcast to multiple connected clients', async () => {
    const roomId = 'incident-live-test';

    const clientA = await connectClient();
    const clientB = await connectClient();

    // Subscribe both clients
    clientA.send(JSON.stringify({ type: 'SUBSCRIBE', roomId, lastSequenceId: 0 } as ClientMessage));
    clientB.send(JSON.stringify({ type: 'SUBSCRIBE', roomId, lastSequenceId: 0 } as ClientMessage));

    await waitForMessage(clientA, (m) => m.type === 'SUBSCRIBED');
    await waitForMessage(clientB, (m) => m.type === 'SUBSCRIBED');

    // Setup listener on Client B for broadcast
    const broadcastPromise = waitForMessage(
      clientB,
      (m) => m.type === 'BROADCAST' && m.message.content === 'Primary database lag critical'
    );

    // Client A publishes
    const publishMsg: ClientMessage = {
      type: 'PUBLISH',
      roomId,
      content: 'Primary database lag critical',
      author: 'Incident Commander',
      severity: 'CRITICAL',
    };
    clientA.send(JSON.stringify(publishMsg));

    const received = await broadcastPromise;
    expect(received.type).toBe('BROADCAST');
    if (received.type === 'BROADCAST') {
      expect(received.message.sequence).toBe(1);
      expect(received.message.content).toBe('Primary database lag critical');
      expect(received.message.severity).toBe('CRITICAL');
      expect(received.message.author).toBe('Incident Commander');
    }

    clientA.close();
    clientB.close();
  });

  it('AC2: Detects client disconnection gracefully', async () => {
    const roomId = 'incident-disconnect-test';
    const client = await connectClient();

    client.send(JSON.stringify({ type: 'SUBSCRIBE', roomId, lastSequenceId: 0 } as ClientMessage));
    await waitForMessage(client, (m) => m.type === 'SUBSCRIBED');

    expect(wsHandler.getConnectedClientsCount(roomId)).toBe(1);

    // Disconnect client
    client.close();
    await new Promise((r) => setTimeout(r, 100));

    expect(wsHandler.getConnectedClientsCount(roomId)).toBe(0);
  });

  it('AC3: Recovers missed updates upon reconnection using sequence cursor', async () => {
    const roomId = 'incident-recovery-test';

    // 1. Client A and Client B connect
    const clientA = await connectClient();
    let clientB = await connectClient();

    clientA.send(JSON.stringify({ type: 'SUBSCRIBE', roomId, lastSequenceId: 0 } as ClientMessage));
    clientB.send(JSON.stringify({ type: 'SUBSCRIBE', roomId, lastSequenceId: 0 } as ClientMessage));

    await waitForMessage(clientA, (m) => m.type === 'SUBSCRIBED');
    await waitForMessage(clientB, (m) => m.type === 'SUBSCRIBED');

    // 2. Client A publishes message #1
    clientA.send(
      JSON.stringify({
        type: 'PUBLISH',
        roomId,
        content: 'Update 1: Initial alert',
      } as ClientMessage)
    );
    const m1 = await waitForMessage(clientB, (m) => m.type === 'BROADCAST');
    expect((m1 as any).message.sequence).toBe(1);

    // 3. Client B disconnects after receiving sequence #1
    clientB.close();
    await new Promise((r) => setTimeout(r, 50));

    // 4. While Client B is disconnected, Client A publishes update #2 and update #3
    clientA.send(
      JSON.stringify({
        type: 'PUBLISH',
        roomId,
        content: 'Update 2: Standby promoted',
      } as ClientMessage)
    );
    await new Promise((r) => setTimeout(r, 50));

    clientA.send(
      JSON.stringify({
        type: 'PUBLISH',
        roomId,
        content: 'Update 3: Health checks passing',
      } as ClientMessage)
    );
    await new Promise((r) => setTimeout(r, 50));

    // 5. Client B reconnects and asks for updates after sequence #1
    clientB = await connectClient();
    const replayPromise = waitForMessage(clientB, (m) => m.type === 'REPLAY');

    clientB.send(
      JSON.stringify({
        type: 'SUBSCRIBE',
        roomId,
        lastSequenceId: 1, // Cursor checkpoint
      } as ClientMessage)
    );

    const replayMsg = await replayPromise;
    expect(replayMsg.type).toBe('REPLAY');
    if (replayMsg.type === 'REPLAY') {
      expect(replayMsg.messages.length).toBe(2);
      expect(replayMsg.messages[0].sequence).toBe(2);
      expect(replayMsg.messages[0].content).toBe('Update 2: Standby promoted');
      expect(replayMsg.messages[1].sequence).toBe(3);
      expect(replayMsg.messages[1].content).toBe('Update 3: Health checks passing');
      expect(replayMsg.fromSeq).toBe(1);
      expect(replayMsg.toSeq).toBe(3);
    }

    clientA.close();
    clientB.close();
  });

  it('AC4: Idempotent ingestion prevents duplicate server-side events', async () => {
    const roomId = 'incident-idempotency-test';
    const client = await connectClient();

    client.send(JSON.stringify({ type: 'SUBSCRIBE', roomId, lastSequenceId: 0 } as ClientMessage));
    await waitForMessage(client, (m) => m.type === 'SUBSCRIBED');

    const fixedMessageId = 'client-unique-uuid-1234';

    // Publish first time
    client.send(
      JSON.stringify({
        type: 'PUBLISH',
        roomId,
        content: 'Database connection pool exhausted',
        clientMessageId: fixedMessageId,
      } as ClientMessage)
    );

    const firstBroadcast = await waitForMessage(client, (m) => m.type === 'BROADCAST');
    expect((firstBroadcast as any).message.sequence).toBe(1);
    expect((firstBroadcast as any).message.id).toBe(fixedMessageId);

    // Resend same message with identical clientMessageId (e.g. client retry)
    client.send(
      JSON.stringify({
        type: 'PUBLISH',
        roomId,
        content: 'Database connection pool exhausted',
        clientMessageId: fixedMessageId,
      } as ClientMessage)
    );

    // Wait a brief moment to verify no new sequence was created
    await new Promise((r) => setTimeout(r, 100));

    expect(defaultStore.getLatestSequence(roomId)).toBe(1);
    expect(defaultStore.getAllMessages(roomId).length).toBe(1);

    client.close();
  });

  it('AC5: Room isolation ensures messages never cross rooms', async () => {
    const clientAlpha = await connectClient();
    const clientBravo = await connectClient();

    clientAlpha.send(JSON.stringify({ type: 'SUBSCRIBE', roomId: 'room-alpha', lastSequenceId: 0 } as ClientMessage));
    clientBravo.send(JSON.stringify({ type: 'SUBSCRIBE', roomId: 'room-bravo', lastSequenceId: 0 } as ClientMessage));

    await waitForMessage(clientAlpha, (m) => m.type === 'SUBSCRIBED');
    await waitForMessage(clientBravo, (m) => m.type === 'SUBSCRIBED');

    let bravoReceivedMessage = false;
    clientBravo.on('message', (raw) => {
      try {
        const parsed = JSON.parse(raw.toString());
        if (parsed.type === 'BROADCAST') {
          bravoReceivedMessage = true;
        }
      } catch {
        // ignore
      }
    });

    // Publish to room-alpha only
    clientAlpha.send(
      JSON.stringify({
        type: 'PUBLISH',
        roomId: 'room-alpha',
        content: 'Secret alpha incident',
      } as ClientMessage)
    );

    await waitForMessage(clientAlpha, (m) => m.type === 'BROADCAST');
    await new Promise((r) => setTimeout(r, 150));

    expect(bravoReceivedMessage).toBe(false);

    clientAlpha.close();
    clientBravo.close();
  });
});
