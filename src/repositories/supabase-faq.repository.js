import { AppError, RepositoryError } from '../utils/errors.js';

const ADMIN_FAQ_COLUMNS = [
  'id',
  'faq_key',
  'question',
  'answer',
  'category',
  'source',
  'metadata',
  'status',
  'version',
  'created_at',
  'updated_at'
].join(', ');
const ADMIN_FAQ_DETAIL_COLUMNS = `${ADMIN_FAQ_COLUMNS}, content`;
const ADMIN_SORT_COLUMNS = new Set([
  'updated_at',
  'created_at',
  'faq_key',
  'question',
  'category',
  'status'
]);

export function escapeLikePattern(value) {
  return value
    .replaceAll('\\', '\\\\')
    .replaceAll('%', '\\%')
    .replaceAll('_', '\\_');
}

function faqNotFound() {
  return new AppError('FAQ tidak ditemukan.', {
    status: 404,
    code: 'FAQ_NOT_FOUND'
  });
}

function faqVersionConflict() {
  return new AppError('FAQ telah berubah. Muat ulang data terbaru.', {
    status: 409,
    code: 'FAQ_VERSION_CONFLICT'
  });
}

function invalidListQuery(message) {
  return new AppError(message, {
    status: 400,
    code: 'VALIDATION_ERROR'
  });
}

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

  async listAdminFaqs({ q, status, category, page, page_size, sort_by, sort_order }) {
    if (!ADMIN_SORT_COLUMNS.has(sort_by) || !['asc', 'desc'].includes(sort_order)) {
      throw invalidListQuery('Parameter pengurutan FAQ tidak valid.');
    }
    if (typeof q !== 'string' || q.includes('*')) {
      throw invalidListQuery('Parameter pencarian FAQ tidak valid.');
    }

    const from = (page - 1) * page_size;
    const to = from + page_size - 1;
    if (!Number.isSafeInteger(page)
      || !Number.isSafeInteger(page_size)
      || page < 1
      || page_size < 10
      || page_size > 100
      || !Number.isSafeInteger(from)
      || !Number.isSafeInteger(to)) {
      throw invalidListQuery('Range halaman FAQ tidak valid.');
    }

    let query = this.supabase
      .from('faq_documents')
      .select(ADMIN_FAQ_COLUMNS, { count: 'exact' });

    if (q) {
      query = query.ilike('content', `%${escapeLikePattern(q)}%`);
    }
    if (status !== 'all') {
      query = query.eq('status', status);
    }
    if (category) {
      query = query.eq('category', category);
    }

    const { data, error, count } = await query
      .order(sort_by, { ascending: sort_order === 'asc' })
      .order('id', { ascending: true })
      .range(from, to);

    if (error) {
      throw new RepositoryError('Pengambilan daftar FAQ admin gagal.', error);
    }

    return { data: data ?? [], total: count ?? 0 };
  }

  async getAdminFaqById(id) {
    const { data, error } = await this.supabase
      .from('faq_documents')
      .select(ADMIN_FAQ_DETAIL_COLUMNS)
      .eq('id', id)
      .maybeSingle();

    if (error) {
      throw new RepositoryError('Pengambilan detail FAQ gagal.', error);
    }
    if (!data) {
      throw faqNotFound();
    }

    return data;
  }

  async insertAdminFaq(record) {
    const { data, error } = await this.supabase
      .from('faq_documents')
      .insert(record)
      .select(ADMIN_FAQ_DETAIL_COLUMNS)
      .single();

    if (error?.code === '23505') {
      throw new AppError('FAQ key sudah digunakan.', {
        status: 409,
        code: 'FAQ_KEY_CONFLICT'
      });
    }
    if (error) {
      throw new RepositoryError('Pembuatan FAQ gagal.', error);
    }

    return data;
  }

  async resolveConditionalMiss(id) {
    const { data, error } = await this.supabase
      .from('faq_documents')
      .select('id, version')
      .eq('id', id)
      .maybeSingle();

    if (error) {
      throw new RepositoryError('Pemeriksaan versi FAQ gagal.', error);
    }
    if (!data) {
      throw faqNotFound();
    }

    throw faqVersionConflict();
  }

  async conditionalAdminUpdate({ id, expectedVersion, changes }) {
    const { data, error } = await this.supabase
      .from('faq_documents')
      .update({
        ...changes,
        version: expectedVersion + 1,
        updated_at: new Date().toISOString()
      })
      .eq('id', id)
      .eq('version', expectedVersion)
      .select(ADMIN_FAQ_DETAIL_COLUMNS)
      .maybeSingle();

    if (error) {
      throw new RepositoryError('Pembaruan FAQ gagal.', error);
    }
    if (!data) {
      return this.resolveConditionalMiss(id);
    }

    return data;
  }

  async updateAdminFaq({ id, expectedVersion, changes }) {
    return this.conditionalAdminUpdate({ id, expectedVersion, changes });
  }

  async updateAdminFaqStatus({ id, expectedVersion, status }) {
    return this.conditionalAdminUpdate({
      id,
      expectedVersion,
      changes: { status }
    });
  }

  async archiveFaq(id) {
    const { data, error } = await this.supabase
      .from('faq_documents')
      .update({
        status: 'archived',
        updated_at: new Date().toISOString()
      })
      .eq('id', id)
      .select('id, faq_key, status, updated_at')
      .maybeSingle();

    if (error) {
      throw new RepositoryError('Pengarsipan FAQ gagal.', error);
    }

    if (!data) {
      throw faqNotFound();
    }

    return data;
  }
}
