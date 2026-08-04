import { ProviderError } from '../utils/errors.js';

export class CloudflareLLMService {
  constructor({ accountId, apiToken, llmModel, fetchImpl = fetch }) {
    this.baseUrl = `https://api.cloudflare.com/client/v4/accounts/${accountId}/ai/v1`;
    this.apiToken = apiToken;
    this.llmModel = llmModel;
    this.fetchImpl = fetchImpl;
  }

  async request(path, body) {
    try {
      const response = await this.fetchImpl(`${this.baseUrl}${path}`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${this.apiToken}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(30_000)
      });

      const payload = await response.json().catch(() => null);

      if (!response.ok) {
        const providerMessage = payload?.errors?.[0]?.message
          ?? payload?.error?.message
          ?? `HTTP ${response.status}`;
        throw new Error(providerMessage);
      }

      return payload;
    } catch (error) {
      if (error instanceof ProviderError) {
        throw error;
      }
      throw new ProviderError('Permintaan LLM ke Cloudflare Workers AI gagal.', error);
    }
  }

  async createChatCompletion(messages) {
    const payload = await this.request('/chat/completions', {
      model: this.llmModel,
      messages,
      temperature: 0.2,
      max_tokens: 400
    });
    const content = payload?.choices?.[0]?.message?.content;

    if (typeof content !== 'string' || !content.trim()) {
      throw new ProviderError('Respons LLM Cloudflare kosong atau tidak sesuai format.');
    }

    return content;
  }
}

