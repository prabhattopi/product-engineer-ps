import { Router, Request, Response } from 'express';
import { MessageStore } from './store.js';
import { WebSocketHandler } from './wsHandler.js';

function getParam(param: string | string[] | undefined): string {
  if (Array.isArray(param)) return param[0] || '';
  return param || '';
}

export function createRoutes(store: MessageStore, wsHandler: WebSocketHandler): Router {
  const router = Router();

  // Get messages for an incident room (with cursor-based catch-up via afterSequenceId)
  router.get('/rooms/:roomId/messages', (req: Request, res: Response) => {
    const roomId = getParam(req.params.roomId);
    const afterParam = getParam(req.query.afterSequenceId as string | undefined);
    const limitParam = getParam(req.query.limit as string | undefined);

    const afterSequenceId = afterParam ? parseInt(afterParam, 10) : 0;
    const limit = limitParam ? parseInt(limitParam, 10) : 100;

    const messages = store.getMessagesAfter(roomId, isNaN(afterSequenceId) ? 0 : afterSequenceId, limit);
    const latestSequence = store.getLatestSequence(roomId);

    res.json({
      roomId,
      messages,
      afterSequenceId: isNaN(afterSequenceId) ? 0 : afterSequenceId,
      latestSequence,
      count: messages.length,
    });
  });

  // Publish a new incident update (REST fallback)
  router.post('/rooms/:roomId/messages', (req: Request, res: Response) => {
    const roomId = getParam(req.params.roomId);
    const { content, author, severity, clientMessageId } = req.body;

    if (!content || typeof content !== 'string' || !content.trim()) {
      return res.status(400).json({ error: 'Field "content" is required and cannot be empty' });
    }

    const { message, isDuplicate } = store.saveMessage({
      roomId,
      content,
      author,
      severity,
      clientMessageId,
    });

    // Broadcast update via WebSocket to connected live clients
    wsHandler.broadcastToRoom(roomId, message);

    res.status(isDuplicate ? 200 : 201).json({
      message,
      isDuplicate,
    });
  });

  // Room statistics for health and inspection
  router.get('/rooms/:roomId/stats', (req: Request, res: Response) => {
    const roomId = getParam(req.params.roomId);
    res.json({
      roomId,
      latestSequence: store.getLatestSequence(roomId),
      totalMessages: store.getAllMessages(roomId).length,
      activeSubscribers: wsHandler.getConnectedClientsCount(roomId),
    });
  });

  return router;
}
