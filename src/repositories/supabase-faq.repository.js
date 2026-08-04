import { RepositoryError } from '../utils/errors.js';

export class SupabaseFaqRepository {
  constructor(supabase) {
    this.supabase = supabase;
  }

  async matchFaq({ embedding, threshold, count }) {
    const { data, error } = await this.supabase.rpc('match_faq', {
      query_embedding: embedding,
      match_threshold: threshold,
      match_count: count
    });

    if (error) {
      throw new RepositoryError('Pencarian FAQ di Supabase gagal.', error);
    }

    return data ?? [];
  }

  async upsertFaqs(records) {
    const { data, error } = await this.supabase
      .from('faq_documents')
      .upsert(records, { onConflict: 'faq_key' })
      .select('id, faq_key, question, category, status, updated_at');

    if (error) {
      throw new RepositoryError('Penyimpanan FAQ ke Supabase gagal.', error);
    }

    return data ?? [];
  }

  async listFaqs() {
    const { data, error } = await this.supabase
      .from('faq_documents')
      .select('id, faq_key, question, answer, category, source, metadata, status, version, created_at, updated_at')
      .order('updated_at', { ascending: false });

    if (error) {
      throw new RepositoryError('Pengambilan daftar FAQ gagal.', error);
    }

    return data ?? [];
  }

  async archiveFaq(id) {
    const { data, error } = await this.supabase
      .from('faq_documents')
      .update({ status: 'archived' })
      .eq('id', id)
      .select('id, faq_key, status, updated_at')
      .single();

    if (error) {
      throw new RepositoryError('Pengarsipan FAQ gagal.', error);
    }

    return data;
  }
}

