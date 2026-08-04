import { Router } from 'express';
import { z } from 'zod';

const historyItemSchema = z.object({
  role: z.enum(['user', 'assistant']),
  content: z.string().min(1).max(2000)
});

const chatRequestSchema = z.object({
  message: z.string().trim().min(2).max(2000),
  history: z.array(historyItemSchema).max(12).default([])
});

export function createChatRouter(chatService) {
  const router = Router();

  router.post('/', async (request, response) => {
    const input = chatRequestSchema.parse(request.body);
    const result = await chatService.answer(input);
    response.json(result);
  });

  return router;
}

