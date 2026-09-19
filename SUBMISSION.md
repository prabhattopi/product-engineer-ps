# Product Engineering Challenge Submission

## Candidate

- **Name:** Prabhat
- **Email:** topi9864@gmail.com
- **GitHub:** https://github.com/prabhattopi (or fork URL: `https://github.com/prabhattopi/product-engineer-ps`)
- **Selected problem:** Problem 3: Reconnecting Real-Time Feed (`problems/03-reconnecting-realtime-feed`)
- **Demo video:** [Link to 3–5 min Demo Video - Loom / YouTube] *(Replace with your recorded video URL)*

---

## Run the project

### Prerequisites
- **Node.js**: v18.0.0 or higher (v20+ recommended)
- **npm**: v9.0.0 or higher
- **OS**: Windows, macOS, or Linux (cross-platform scripts provided)

### Setup and Run Commands (< 2 minutes)

Run the following commands from the repository root:

```bash
# 1. Install dependencies for root, server, and client in one step
npm run install:all

# 2. Launch both backend server (:4000) and frontend client (:5173) concurrently
npm run dev
```

The services will start at:
- **Client (Incident Command Center UI)**: `http://localhost:5173`
- **Server (HTTP REST API)**: `http://localhost:4000/api`
- **Server (WebSocket Endpoint)**: `ws://localhost:4000/ws`

*(Alternatively, you can run them in separate terminal tabs using `npm run dev:server` and `npm run dev:client`)*.

---

### How to Trigger the Scenarios in the UI

Open **two browser windows side-by-side** at `http://localhost:5173`:

#### 1. Successful Live Broadcast Scenario (AC1 & AC5)
1. In **Window A**, compose an update (e.g., *"Database replica latency spiking to 450ms"*, Severity: *P1 High*) and click **Broadcast Incident Update**.
2. **Window B** immediately displays the update in real-time without requiring a page refresh.
3. Observe that each message is tagged with a server-assigned sequence number (`#1`, `#2`, `#3`...) proving deterministic chronological ordering.

#### 2. Network Interruption & Connection State Scenario (AC2)
1. In **Window B**, click the red **`Simulate Disconnect (AC2)`** button in the top control bar.
2. Observe the connection indicator immediately transition from green **`CONNECTED`** to an amber/red warning banner **`DISCONNECTED (SIMULATED) - Socket closed for recovery testing`**.
3. Telemetry card updates to show connection state: `DISCONNECTED`.

#### 3. Missed-Update Recovery Scenario (AC3)
1. While **Window B** remains disconnected, switch to **Window A** and broadcast 2 new updates (e.g., *"Failing over to secondary cluster"* and *"Traffic stabilized"*).
2. Observe that **Window B** does not have these updates yet.
3. In **Window B**, click **`Reconnect & Sync (AC3)`**.
4. The WebSocket reconnects, automatically hands over its last known cursor (`lastSequenceId`), and requests a replay.
5. The 2 missed updates stream into **Window B** in correct sequence, and the **`Missed Catch-up`** badge displays **`+2`**.

#### 4. Duplicate Prevention Scenario (AC4)
1. In **Window A**, click **`Simulate Duplicate (AC4)`**.
2. This intentionally re-transmits an existing message with an already-seen `clientMessageId`.
3. The UI recognizes the duplicate, rejects it at both client and server deduplication filters, and does not render a duplicate card.

#### 5. Room Isolation & Server Reset
1. Switch room dropdown from `incident-alpha` to `incident-bravo`.
2. Notice that messages are isolated per room.
3. Clicking **`Reset Room`** sends an authenticated `POST /api/rooms/:roomId/reset` that broadcasts a `ROOM_RESET` frame to all connected clients and wipes the persistent store cleanly.

---

## Run the tests

The project includes an automated Vitest test suite covering unit logic, store persistence, client deduplication, and full end-to-end WebSocket integration scenarios:

```bash
# Run all tests across server and client
npm test
```

### Test Coverage Breakdown
- **`server/test/store.test.ts`**:
  - Validates atomic monotonic sequence numbering (`1, 2, 3...`)
  - Validates room isolation (Alpha vs Bravo sequences are independent)
  - Validates server-side idempotency (`clientMessageId` deduplication)
  - Validates cursor-based replay queries (`getMessagesAfterSequence`)
  - Validates disk-backed persistence across process restarts
- **`server/test/integration.test.ts`**:
  - **AC1**: Live multi-client broadcast over real WebSockets
  - **AC2**: Physical socket closure and connection state handling
  - **AC3**: Reconnection with sequence cursor replay recovering exact missed updates
  - **AC4**: Duplicate injection prevention across concurrent delivery paths
  - **AC5**: Strict ordering and room segregation
  - **AC3+ Resilience**: Sudden disconnect immediately after sending an update; verifies both server-side durable ingestion, cursor replay recovery, and client outbox retry deduplication
- **`client/src/feedStore.test.ts`**:
  - Tests pure state reducer for message deduplication via `Set<string>`
  - Tests out-of-order sequence sorting
  - Tests room reset wipe and state transitions

**Result:** 15/15 tests pass deterministically in ~3.5 seconds with zero external network or database dependencies.

---

## Architecture and data flow

The system decouples real-time transport from state management and persistence, guaranteeing high throughput and resilient recovery:

```text
┌─────────────────────────┐                     ┌─────────────────────────┐
│ Client A (Window 1)     │                     │ Client B (Window 2)     │
│  - React UI             │                     │  - React UI             │
│  - useIncidentFeed hook │                     │  - useIncidentFeed hook │
│  - feedStore (Pure Set) │                     │  - feedStore (Pure Set) │
└───────────┬─────────────┘                     └────────────▲────────────┘
            │ 1. PUBLISH (clientMsgId)                       │ 3. BROADCAST
            │                                                │    (seq #N)
            ▼                                                │
┌────────────────────────────────────────────────────────────┴────────────┐
│ Express + WS Server (Node.js / TypeScript)                             │
│                                                                         │
│  ┌───────────────────────────────────────────────────────────────────┐  │
│  │ WebSocket Manager (wsHandler.ts)                                  │  │
│  │  - Heartbeat monitor (5s Ping/Pong)                               │  │
│  │  - Room subscription registry: Map<roomId, Set<WebSocket>>       │  │
│  │  - Cursor Replay Handler (SUBSCRIBE -> REPLAY stream)             │  │
│  └──────────────────┬────────────────────────────────────────────────┘  │
│                     │ 2. Allocate Seq & Store                           │
│                     ▼                                                   │
│  ┌───────────────────────────────────────────────────────────────────┐  │
│  │ IncidentStore (store.ts)                                          │  │
│  │  - Atomic Monotonic Sequence Generator (Room -> Counter)          │  │
│  │  - Ingestion Deduplication: Set<clientMessageId>                  │  │
│  │  - Memory Buffer: Map<roomId, IncidentMessage[]>                  │  │
│  │  - Durable Write-Through: server/data/incident_store.json         │  │
│  └───────────────────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────────────┘
```

### Data Flow Walkthrough

1. **Ingestion & Sequencing**:
   - A client dispatches `{ type: 'PUBLISH', roomId, clientMessageId, text, author, severity }`.
   - The server passes the payload to `IncidentStore.addMessage()`.
   - The store checks `seenMessageIds`. If already processed, it returns the existing message (idempotency).
   - If new, it atomically increments `sequenceCounters[roomId]`, stamps `sequence` and ISO `timestamp`, and appends to the durable log.
2. **Real-Time Broadcast**:
   - The WebSocket manager iterates through all active client connections subscribed to `roomId` and dispatches `{ type: 'BROADCAST', roomId, message }`.
3. **Reconnection & Recovery (Catch-up)**:
   - When Client B disconnects, it tracks its last received sequence (`lastSequenceId = 4`).
   - Upon reconnecting, Client B sends `{ type: 'SUBSCRIBE', roomId, lastSequenceId: 4 }`.
   - The server queries `store.getMessagesAfterSequence('incident-alpha', 4)` and responds with `{ type: 'REPLAY', messages, fromSeq: 4, toSeq: 6 }`.
   - Client B processes the replay stream through `feedStore.mergeMessages()`, which enforces deduplication and sort stability.

---

## Technology choices

| Layer | Chosen Technology | Alternatives Considered | Rationale & Trade-offs Accepted |
|---|---|---|---|
| **Transport** | **WebSockets (`ws`)** | Server-Sent Events (SSE), HTTP Long-Polling | **Chosen:** True full-duplex bidirectional streaming over a single TCP connection. SSE requires separate HTTP POSTs for publishing, introducing connection race conditions and double TCP overhead. Long-polling introduces high latency and server load. |
| **Backend** | **Node.js + Express + TypeScript** | Go, Python FastAPI | Fast event-loop I/O, lightweight WebSocket primitives, and unified TypeScript type contracts between frontend and backend. |
| **Frontend** | **React 19 + Vite + Tailwind CSS v4** | Next.js, Vanilla HTML/JS | Vite provides sub-second HMR for rapid prototyping. Decoupled pure state reducer (`feedStore.ts`) ensures rendering is decoupled from socket message bursts. |
| **Persistence** | **In-memory + Write-Through JSON file** | SQLite, PostgreSQL, Redis | Zero external dependencies; tests run completely self-contained and offline. For production scale, this would be replaced with Redis Streams or PostgreSQL (detailed below). |
| **Testing** | **Vitest** | Jest, Playwright | Native ESM and TypeScript support with instant startup. Executes unit and end-to-end WebSocket integration tests in <4 seconds. |

---

## Important decisions

### 1. Monotonic Server-Assigned Sequence Numbers as Canonical Ordering
- **Problem**: Client timestamps suffer from clock drift, NTP skew, and out-of-order packet arrivals over wireless networks.
- **Decision**: The backend `IncidentStore` assigns an atomic incrementing integer sequence (`sequence: 1, 2, 3...`) scoped per room.
- **Impact**: Sequence numbers serve two critical roles: (1) deterministic chronological feed sorting on the UI, and (2) an exact, low-overhead cursor for missed-update recovery (`lastSequenceId`). Reconnection query complexity is O(k) where k is the number of missed messages.

### 2. Layered Two-Tier Idempotent Deduplication
- **Problem**: Under network instability, a client may retry publishing an update, or replay requests might overlap with in-flight live broadcasts.
- **Decision**: Implemented two deduplication barriers:
  1. *Server-side*: Every update requires a client-generated UUID (`clientMessageId`). Duplicate publishes return the existing record without generating a new sequence number.
  2. *Client-side*: `feedStore` maintains an in-memory `Set<string>` of seen message IDs. Any incoming message from either `REPLAY` or `BROADCAST` is filtered before appending to state.
- **Impact**: Completely eliminates duplicate visual cards even during concurrent race conditions.

### 3. Exponential Backoff with Jitter and Observable State Machine
- **Problem**: When a server restarts or network drops, thousands of clients reconnecting simultaneously cause a "thundering herd" retry storm.
- **Decision**: Built a resilient reconnection state machine inside `useIncidentFeed.ts` with exponential backoff:
  $$\text{delay} = \min(1000 \times 1.5^n + \text{random}(0, 500), 10000)$$
  Exposed explicit states: `CONNECTED`, `RECONNECTING`, `DISCONNECTED`.
- **Impact**: Bounded reconnect attempts (capped at 10s) prevent server collapse. Incident commanders immediately see warning banners when offline rather than assuming the feed is up to date.

### 4. Stale Sequence & Out-of-Band Room Reset Synchronization
- **Problem**: If a client disconnects at sequence #5, an admin resets the room on the server, and the client reconnects, the client's `lastSequenceId` (5) is higher than the server's reset sequence (0).
- **Decision**: The server detects `lastSequenceId > currentLatestSeq`, immediately emits a `ROOM_RESET` frame to wipe the client's stale local memory, and synchronizes the client to sequence #0.
- **Impact**: Guarantees consistency across distributed tabs even across out-of-band administrative operations.

### 5. Client Unacknowledged Outbox Queue with Reconnection Reconciliation
- **Problem**: When a user clicks Broadcast and the connection drops immediately, the message packet may either (A) have reached the server before the drop, or (B) have dropped in-flight before the server received it.
- **Decision**: Built an in-memory `outboxRef` tracking queue inside `useIncidentFeed.ts`. When publishing, the message is tracked with its unique `clientMessageId`. It is only removed once acknowledged via `BROADCAST` or `REPLAY`. If the connection drops and reconnects, any unacknowledged items in the outbox are automatically re-transmitted over the newly opened socket with the identical `clientMessageId`.
- **Impact**: Completely eliminates message loss during sudden network drops. Due to server-side idempotency, Scenario A retries are discarded harmlessly as duplicates, while Scenario B retries are committed and broadcasted.

---

## Assumptions and limitations

1. **Single-Node In-Memory Storage**: The prototype persists messages to `server/data/incident_store.json`. In a multi-instance cluster, a shared distributed log is required.
2. **Replay Size Bounded by Room Size**: The current implementation replays all missed messages from `lastSequenceId` to `latestSeq`. In high-volume enterprise rooms with millions of events, pagination / sliding windows are necessary.
3. **No User Authentication**: Anonymous author handles are used for demonstration simplicity.
4. **Browser Refresh State**: Hard browser refresh resets local in-memory state and performs a clean initial sync from sequence 0.

---

## Production and scale

If this prototype needed to operate in production at enterprise scale:

1. **Distributed Sequence Generation & Log (Redis Streams or Apache Kafka)**:
   - Replace in-memory arrays with Redis Streams (`XADD` / `XRANGE`) or Kafka partitioned by `roomId`.
   - Redis Streams naturally provide monotonically ordered 64-bit sequence IDs (`<timestamp>-<sequence>`) and O(log N) range queries for cursor replay.
2. **Horizontal WebSocket Scaling with Pub/Sub Backplane**:
   - Deploy stateless WebSocket gateway instances behind an AWS ALB with sticky sessions.
   - Connect gateways via Redis Pub/Sub or NATS JetStream: when an update is published to Gateway 1, it publishes to Redis, which fans out to Gateways 2 & 3 to notify connected clients.
3. **Compaction & Snapshot Checkpoints**:
   - For clients disconnected for hours or days, replaying 100,000 raw frames is wasteful. We would introduce periodic room snapshotting: clients >1,000 messages behind receive a consolidated state snapshot + the last 50 delta messages.

---

## Questions to address

### 1. What happens if a client disconnects immediately after sending an update?

In real-world networks, a sudden disconnect after clicking Broadcast results in one of two physical realities:

- **Scenario A: The server received the message before the socket closed.**
  1. The server processed the `PUBLISH` frame, assigned monotonic sequence `#5`, saved it to durable persistence, and attempted to broadcast back to the sender.
  2. The sender's socket severed before the server's broadcast or ACK arrived.
  3. Other connected participants received update `#5` in real time.
  4. Upon reconnecting, the sender transmits `SUBSCRIBE { lastSequenceId: 4 }`.
  5. The server queries messages where `sequence > 4` and returns a `REPLAY` stream containing update `#5`.
  6. The sender's client ingests `#5`, identifies its matching `clientMessageId`, reconciles and clears it from its pending outbox queue, and renders it seamlessly into the feed.
  7. **Result**: Zero data loss, correct sequence `#5` ordering, and zero duplicate rendering.

- **Scenario B: The connection severed in transit before the packet reached the server.**
  1. The server never received the packet; the room's sequence counter was not incremented.
  2. The client transitions to `RECONNECTING`, preserving the unacknowledged update in its local `outboxRef`.
  3. Upon reconnecting and re-subscribing, the client checks its outbox and finds the unacknowledged message.
  4. The client's `flushOutbox()` automatically re-transmits the payload over the fresh socket with the **identical** `clientMessageId`.
  5. The server receives the update, sequences it, writes it to disk, and broadcasts it.
  6. **Result**: Zero lost messages even if the socket severed at the exact millisecond of dispatch.

- **Automated Verification**: This dual-scenario resilience is tested in `server/test/integration.test.ts` (*"AC3+ Resilience: Sudden disconnect immediately after publishing recovers safely via replay and deduplicates outbox retries"*).

### 2. How would multiple backend instances share and order events?
- Multiple backend nodes cannot independently generate local integer sequence numbers without race conditions.
- **Architecture**:
  - Route room traffic to a shared distributed log partitioned by `roomId` (e.g., Apache Kafka partition or Redis Stream).
  - A single partition per `roomId` enforces a single writer / linearizable log, guaranteeing total order and monotonically increasing offset IDs.
  - Alternatively, use a relational database with `SERIAL` / `BIGINT AUTO_INCREMENT` with `pg_notify` / CDC (Debezium) for event broadcast.
  - All WebSocket gateway nodes subscribe to the room's stream and broadcast updates to their locally connected clients.

### 3. How would you prevent an unbounded history replay?
- A client disconnected for 30 days should not request 500,000 messages on reconnect.
- **Techniques**:
  1. **Sliding Window / Pagination**: Limit `REPLAY` to a maximum limit (e.g., `LIMIT 100`). The response includes a `hasMore: true` flag and pagination cursor.
  2. **Snapshot + Delta Sync**: If `latestSeq - lastSequenceId > THRESHOLD`, the server sends a consolidated current state snapshot (e.g., active incident summary and pinned tasks) plus the most recent 50 messages, discarding stale intermediate chatter.
  3. **TTL / Log Retention Policy**: Expire incident messages older than 14 days to long-term cold storage (S3/Parquet), keeping only hot cache in the fast replay layer.

### 4. What would you monitor in production?
- **Real-Time Telemetry & SLIs**:
  - **Connection Metrics**: Active WebSocket connections count, connection churn rate (connects/disconnects per second), and distribution of connection drops.
  - **Latency (P50, P95, P99)**: Ingestion-to-broadcast propagation latency (time from `PUBLISH` receipt to `BROADCAST` dispatch across all room subscribers).
  - **Reconnection & Replay Health**: Number of replay requests per minute, average missed messages recovered per replay, and count of stale sequence reset events.
  - **Heartbeat Failures**: Frequency of dead socket cleanups triggered by missed 5s ping/pong heartbeats.
  - **Deduplication Rate**: Rate of duplicate `clientMessageId` submissions (spikes indicate client retry storms or network jitter).

---

## AI usage

- **AI Tools Used**: Google DeepMind Antigravity / Gemini 2.0.
- **Contribution**:
  - Scaffolding the initial monorepo structure (Vite + React + Tailwind v4 and Express + `ws`).
  - Generating comprehensive unit and end-to-end integration tests (`server/test/store.test.ts`, `server/test/integration.test.ts`, `client/src/feedStore.test.ts`).
  - Assisting in debugging edge-case race conditions discovered during manual testing:
    - Implemented in-flight room switching over the existing WebSocket connection without triggering false disconnect timeouts.
  - All code, architectural decisions, protocols, and test verifications were guided, reviewed, and validated line-by-line.

---

## Credibility note

### High-Throughput Real-Time Incident & Telemetry System
- **The problem it solved**: Built a mission-critical real-time operations dashboard for tracking high-frequency field service alerts, vehicle telemetry, and incident dispatching across 1,000+ field units and 100+ concurrent dispatchers.
- **Personal contribution**: Designed and implemented the bidirectional streaming gateway using Node.js WebSockets and Redis Streams. Authored the client-side sequence reconciliation logic that allowed dispatchers moving between Wi-Fi and mobile networks to seamlessly resume feeds without missing critical updates or suffering UI jitter.
- **The scale or operational complexity involved**: Handled ~15,000 incoming telemetry events per second at peak. Managed WebSocket connection state, heartbeat monitoring, and distributed fan-out across multiple containerized instances behind a load balancer.
- **One difficult engineering decision**: Choosing between optimistic client-side message insertion vs. strict server-acknowledged sequencing. An early prototype with optimistic UI updates led to message flickering and re-ordering bugs when dispatchers on spotty networks submitted alerts out-of-sequence. I pivoted to server-assigned monotonic sequencing with immediate local pending indicators, which eliminated state divergence and simplified the deduplication protocol across all clients.
