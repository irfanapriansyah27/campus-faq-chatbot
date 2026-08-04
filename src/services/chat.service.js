import { buildGroundedMessages } from '../prompts/faq-answer.prompt.js';
import { parseLlmAnswer } from '../utils/llm-json.js';

export class ChatService {
  constructor({
    embeddingService,
    llmService,
    faqRepository,
    matchThreshold,
    matchCount,
    maxChatHistory,
    fallbackMessage
  }) {
    this.embeddingService = embeddingService;
    this.llmService = llmService;
    this.faqRepository = faqRepository;
    this.matchThreshold = matchThreshold;
    this.matchCount = matchCount;
    this.maxChatHistory = maxChatHistory;
    this.fallbackMessage = fallbackMessage;
  }

  handoff(reason) {
    return {
      decision: 'HANDOFF',
      answer: this.fallbackMessage,
      sources: [],
      handoff: {
        provider: 'tawk.to',
        action: 'OPEN_WIDGET',
        reason
      }
    };
  }

  async answer({ message, history = [] }) {
    const queryEmbedding = await this.embeddingService.createQueryEmbedding(message);
    const matches = await this.faqRepository.matchFaq({
      embedding: queryEmbedding,
      threshold: this.matchThreshold,
      count: this.matchCount
    });

    if (matches.length === 0) {
      return this.handoff('NO_RELEVANT_FAQ');
    }

    const safeHistory = history.slice(-this.maxChatHistory);
    const messages = buildGroundedMessages({
      message,
      contexts: matches,
      history: safeHistory
    });

    let parsed;

    try {
      const rawAnswer = await this.llmService.createChatCompletion(messages);
      parsed = parseLlmAnswer(rawAnswer);
    } catch {
      return this.handoff('LLM_SERVICE_UNAVAILABLE');
    }

    if (!parsed) {
      return this.handoff('LLM_RESPONSE_INVALID');
    }

    if (parsed.decision === 'HANDOFF') {
      return this.handoff('LLM_CONTEXT_INSUFFICIENT');
    }

    const allowedIds = new Set(matches.map((match) => String(match.id)));
    const citedIds = parsed.faq_ids.filter((id) => allowedIds.has(String(id)));

    if (citedIds.length === 0) {
      return this.handoff('UNVERIFIED_LLM_CITATION');
    }

    return {
      decision: 'ANSWER',
      answer: parsed.answer,
      confidence: parsed.confidence,
      sources: matches
        .filter((match) => citedIds.includes(String(match.id)))
        .map((match) => ({
          faq_id: String(match.id),
          question: match.question,
          similarity: Number(match.similarity)
        })),
      mode: 'GROUNDED_LLM'
    };
  }
}
