import express from 'express';
import http from 'http';
import cors from 'cors';
import { WebSocketServer } from 'ws';
import { defaultStore } from './store.js';
import { WebSocketHandler } from './wsHandler.js';
import { createRoutes } from './routes.js';

const app = express();
const port = process.env.PORT || 4000;

app.use(cors());
app.use(express.json());

// Health check endpoint
app.get('/health', (_req, res) => {
  res.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    uptimeSeconds: Math.floor(process.uptime()),
  });
});

const server = http.createServer(app);
const wss = new WebSocketServer({ server });
const wsHandler = new WebSocketHandler(wss, defaultStore);

// Mount API routes
app.use('/api', createRoutes(defaultStore, wsHandler));

if (process.env.NODE_ENV !== 'test') {
  server.listen(port, () => {
    console.log(`[IncidentFeed] HTTP Server listening on http://localhost:${port}`);
    console.log(`[IncidentFeed] WebSocket Server listening on ws://localhost:${port}`);
  });
}

export { app, server, wss, defaultStore, wsHandler };
