import 'dotenv/config';
import { z } from 'zod';

function isCanonicalOrigin(value) {
  try {
    return new URL(value).origin === value;
  } catch {
    return false;
  }
}

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(3000),
  ALLOWED_ORIGINS: z.string().default('http://localhost:3000'),
  ADMIN_INGEST_KEY: z.string().min(20),
  ADMIN_APP_ORIGIN: z.string().url().refine(isCanonicalOrigin, {
    message: 'Harus berupa origin kanonis tanpa path, slash akhir, query, fragment, atau credential.'
  }).default('http://localhost:3000'),
  ADMIN_REFRESH_COOKIE_MAX_AGE_SECONDS: z.coerce.number().int().min(3600).max(2_592_000)
    .default(604800),
  ADMIN_LOGIN_RATE_LIMIT: z.coerce.number().int().min(1).max(100).default(10),
  SUPABASE_URL: z.string().url(),
  SUPABASE_PUBLISHABLE_KEY: z.string().min(20),
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(20),
  GEMINI_API_KEY: z.string().min(20),
  GEMINI_EMBEDDING_MODEL: z.string().default('gemini-embedding-001'),
  CLOUDFLARE_ACCOUNT_ID: z.string().min(1),
  CLOUDFLARE_API_TOKEN: z.string().min(20),
  CLOUDFLARE_LLM_MODEL: z.string().default('@cf/qwen/qwen3-30b-a3b-fp8'),
  MATCH_THRESHOLD: z.coerce.number().min(0).max(1).default(0.5),
  MATCH_COUNT: z.coerce.number().int().min(1).max(10).default(3),
  MAX_CHAT_HISTORY: z.coerce.number().int().min(0).max(12).default(6),
  CS_FALLBACK_MESSAGE: z.string().min(10).default(
    'Maaf, informasi tersebut belum tersedia dalam FAQ kampus. Saya akan mengarahkan Anda ke petugas layanan kampus.'
  )
});

export function loadConfig(source = process.env) {
  const parsed = envSchema.safeParse(source);

  if (!parsed.success) {
    const details = parsed.error.issues
      .map((issue) => `${issue.path.join('.')}: ${issue.message}`)
      .join('; ');
    throw new Error(`Konfigurasi environment tidak valid: ${details}`);
  }

  return {
    ...parsed.data,
    allowedOrigins: parsed.data.ALLOWED_ORIGINS
      .split(',')
      .map((origin) => origin.trim())
      .filter(Boolean)
  };
}
