# Campus FAQ Chatbot

Starter project chatbot FAQ kampus menggunakan:

- Node.js dan Express sebagai backend/control flow;
- Supabase PostgreSQL dengan pgvector sebagai knowledge base;
- Google Gemini `gemini-embedding-001` untuk embedding 1536 dimensi;
- Cloudflare Workers AI `@cf/qwen/qwen3-30b-a3b-fp8` untuk jawaban natural;
- tawk.to sebagai tujuan handoff ke customer service manusia.

## Mengapa stack ini dipilih?

Gemini Embedding mendukung output fleksibel sampai 3072 dimensi dan pada project ini dikunci menjadi 1536 dimensi. Saat ingestion digunakan task type `RETRIEVAL_DOCUMENT`, sedangkan pertanyaan visitor memakai `RETRIEVAL_QUERY`. LLM generatif tetap memakai model open-weight melalui Cloudflare Workers AI.

Cloudflare memberikan alokasi gratis 10.000 neuron per hari. Alokasi ini sesuai untuk pengembangan dan demonstrasi, tetapi bukan jaminan kapasitas produksi; permintaan akan gagal setelah kuota harian habis pada paket gratis.

Referensi resmi:

- [Cloudflare Workers AI pricing](https://developers.cloudflare.com/workers-ai/platform/pricing/)
- [Cloudflare OpenAI-compatible endpoints](https://developers.cloudflare.com/workers-ai/configuration/open-ai-compatibility/)
- [Cloudflare Qwen3 model](https://developers.cloudflare.com/workers-ai/models/qwen3-30b-a3b-fp8/)
- [Gemini Embedding](https://ai.google.dev/gemini-api/docs/models/gemini-embedding-001)
- [Gemini API pricing](https://ai.google.dev/gemini-api/docs/pricing)
- [Supabase pgvector](https://supabase.com/docs/guides/database/extensions/pgvector)
- [tawk.to webhooks](https://developer.tawk.to/webhooks/)

## Persyaratan

- Node.js 20 atau lebih baru;
- project Supabase;
- API key Google Gemini;
- akun Cloudflare dengan Workers AI aktif;
- Property ID tawk.to kampus untuk handoff pada website sebenarnya.

## Menjalankan secara lokal

1. Instal dependency:

   ```bash
   npm install
   ```

2. Salin environment file:

   ```bash
   cp .env.example .env
   ```

3. Isi kredensial Supabase, Gemini, dan Cloudflare pada `.env`.

4. Buka Supabase SQL Editor dan jalankan seluruh isi:

   ```text
   supabase/migrations/001_faq_pgvector.sql
   ```

5. Jalankan backend:

   ```bash
   npm run dev
   ```

6. Buka `http://localhost:3000`.

## Memasukkan FAQ

File contoh berada pada `knowledge/faqs.sample.json`. Seluruh data contoh berstatus `draft` agar tidak dianggap sebagai kebijakan resmi kampus. Periksa isinya, tambahkan sumber yang benar, lalu ubah menjadi `published`.

Setelah server aktif:

```bash
npm run ingest -- knowledge/faqs.sample.json
```

Atau panggil endpoint:

```bash
curl http://localhost:3000/api/ingest \
  -X POST \
  -H "Authorization: Bearer KUNCI_ADMIN" \
  -H "Content-Type: application/json" \
  --data-binary @payload.json
```

Format `payload.json`:

```json
{
  "faqs": [
    {
      "faq_key": "jadwal-kuliah",
      "question": "Di mana melihat jadwal kuliah?",
      "answer": "Jadwal kuliah tersedia pada sistem akademik kampus.",
      "category": "akademik",
      "source": "Panduan Akademik 2026",
      "metadata": { "page": 12 },
      "status": "published",
      "version": 1
    }
  ]
}
```

## Mencoba API chat

```bash
curl http://localhost:3000/api/chat \
  -X POST \
  -H "Content-Type: application/json" \
  -d '{"message":"Di mana saya melihat jadwal kuliah?","history":[]}'
```

## Integrasi dengan website kampus

Salin UI dalam folder `public` atau hubungkan widget website kampus ke endpoint `/api/chat`. Ketika respons memiliki `decision: "HANDOFF"`, jalankan:

```js
if (window.Tawk_API && typeof window.Tawk_API.maximize === 'function') {
  window.Tawk_API.maximize();
}
```

Snippet widget tawk.to resmi milik kampus tetap harus dipasang pada halaman website. Project ini tidak memakai AI Assist tawk.to.

## Endpoint

| Method | Endpoint | Fungsi | Otorisasi |
|---|---|---|---|
| GET | `/api/health` | Status backend | Tidak |
| POST | `/api/chat` | Pertanyaan visitor | Tidak, rate-limited |
| POST | `/api/ingest` | Ingest/update FAQ | Admin key |
| GET | `/api/faqs` | Daftar FAQ | Admin key |
| POST | `/api/faqs` | Ingest/update FAQ | Admin key |
| DELETE | `/api/faqs/:id` | Soft delete menjadi archived | Admin key |

## Pengujian

```bash
npm test
```

Tes tidak memerlukan kredensial karena provider dan database digantikan mock. Pengujian koneksi nyata baru dapat dilakukan setelah `.env` diisi.

## Catatan keamanan

- Jangan meletakkan `SUPABASE_SERVICE_ROLE_KEY`, token Cloudflare, atau admin key pada frontend.
- RLS tabel aktif dan akses `anon`/`authenticated` dicabut; hanya backend service role yang mengakses FAQ.
- Threshold `0.50` adalah nilai awal. Uji dengan pertanyaan kampus nyata sebelum digunakan ke publik.
- Jika model embedding diganti, seluruh vector FAQ harus dibuat ulang dan ukuran kolom harus disesuaikan.
- Free Tier Gemini dapat menggunakan input untuk peningkatan produk. Jangan masukkan data pribadi visitor ke embedding tanpa penyaringan atau persetujuan yang sesuai.

## Mengganti LLM ke DeepSeek

Embedding Gemini dan skema `vector(1536)` tidak berubah ketika model generatif diganti. Untuk mencoba DeepSeek, ubah satu nilai berikut:

```env
CLOUDFLARE_LLM_MODEL=@cf/deepseek-ai/deepseek-r1-distill-qwen-32b
```

Setelah itu restart backend. FAQ tidak perlu di-ingest ulang karena model embedding tetap sama.

## Jika skema 1024 dimensi pernah dijalankan

Migration utama sekarang menggunakan `vector(1536)`. Jika versi lama `vector(1024)` sudah diterapkan dan belum terdapat data penting, hapus tabel/function lama melalui Supabase lalu jalankan ulang migration. Jika sudah ada FAQ penting, ekspor teks FAQ terlebih dahulu; vector lama tidak dapat dicampur dengan embedding Gemini dan harus dibuat ulang melalui proses ingest.
