import express from 'express';
import http from 'http';
import cors from 'cors';
import { WebSocketServer } from 'ws';

const app = express();
const port = process.env.PORT || 4000;

app.use(cors());
app.use(express.json());

app.get('/health', (_req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

const server = http.createServer(app);
const wss = new WebSocketServer({ server });

wss.on('connection', (ws) => {
  ws.send(JSON.stringify({ type: 'WELCOME', message: 'Connected to Incident Feed Server' }));
});

if (process.env.NODE_ENV !== 'test') {
  server.listen(port, () => {
    console.log(`[IncidentFeed] Server running on http://localhost:${port}`);
    console.log(`[IncidentFeed] WebSocket listening on ws://localhost:${port}`);
  });
}

export { app, server, wss };
