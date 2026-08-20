import { createClient } from '@supabase/supabase-js';
import { createApp } from './app.factory.js';
import { loadConfig } from './config/env.js';
import { SupabaseAdminRepository } from './repositories/supabase-admin.repository.js';
import { SupabaseFaqRepository } from './repositories/supabase-faq.repository.js';
import { AdminAuthService } from './services/admin-auth.service.js';
import { ChatService } from './services/chat.service.js';
import { CloudflareLLMService } from './services/cloudflare-llm.service.js';
import { GeminiEmbeddingService } from './services/gemini-embedding.service.js';
import { IngestService } from './services/ingest.service.js';

const config = loadConfig();
const supabase = createClient(
  config.SUPABASE_URL,
  config.SUPABASE_SERVICE_ROLE_KEY,
  {
    auth: {
      autoRefreshToken: false,
      persistSession: false
    }
  }
);
const authClientFactory = () => createClient(
  config.SUPABASE_URL,
  config.SUPABASE_PUBLISHABLE_KEY,
  {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
      detectSessionInUrl: false
    }
  }
);

const embeddingService = new GeminiEmbeddingService({
  apiKey: config.GEMINI_API_KEY,
  model: config.GEMINI_EMBEDDING_MODEL
});
const llmService = new CloudflareLLMService({
  accountId: config.CLOUDFLARE_ACCOUNT_ID,
  apiToken: config.CLOUDFLARE_API_TOKEN,
  llmModel: config.CLOUDFLARE_LLM_MODEL
});
const faqRepository = new SupabaseFaqRepository(supabase);
const adminRepository = new SupabaseAdminRepository(supabase);
const adminAuthService = new AdminAuthService({
  authClientFactory,
  adminRepository
});
const ingestService = new IngestService({ embeddingService, faqRepository });
const chatService = new ChatService({
  embeddingService,
  llmService,
  faqRepository,
  matchThreshold: config.MATCH_THRESHOLD,
  matchCount: config.MATCH_COUNT,
  maxChatHistory: config.MAX_CHAT_HISTORY,
  fallbackMessage: config.CS_FALLBACK_MESSAGE
});

const app = createApp({
  config,
  chatService,
  ingestService,
  faqRepository,
  adminAuthService
});

export default app;

if (!process.env.VERCEL) {
  const server = app.listen(config.PORT, () => {
    console.log(
      `Campus FAQ Chatbot berjalan di http://localhost:${config.PORT}`
    );
  });

  function shutdown(signal) {
    console.log(`${signal} diterima, server dihentikan.`);

    server.close(() => process.exit(0));
    setTimeout(() => process.exit(1), 10_000).unref();
  }

  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
}
