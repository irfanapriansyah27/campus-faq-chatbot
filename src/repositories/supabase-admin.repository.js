import { AppError } from '../utils/errors.js';

export class SupabaseAdminRepository {
  constructor(supabase) {
    this.supabase = supabase;
  }

  async findAdminByUserId(userId) {
    const { data, error } = await this.supabase
      .from('admin_users')
      .select('user_id, role, is_active')
      .eq('user_id', userId)
      .maybeSingle();

    if (error) {
      throw new AppError('Pemeriksaan otorisasi admin gagal.', {
        status: 503,
        code: 'ADMIN_REPOSITORY_ERROR'
      });
    }

    return data ?? null;
  }
}
