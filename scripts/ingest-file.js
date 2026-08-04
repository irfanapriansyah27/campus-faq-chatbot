import fs from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import 'dotenv/config';

const inputPath = path.resolve(process.argv[2] ?? 'knowledge/faqs.sample.json');
const apiUrl = process.env.CHATBOT_API_URL ?? 'http://localhost:3000';
const adminKey = process.env.ADMIN_INGEST_KEY;

if (!adminKey) {
  throw new Error('ADMIN_INGEST_KEY belum tersedia pada file .env.');
}

const fileContent = await fs.readFile(inputPath, 'utf8');
const faqs = JSON.parse(fileContent);
const response = await fetch(`${apiUrl}/api/ingest`, {
  method: 'POST',
  headers: {
    Authorization: `Bearer ${adminKey}`,
    'Content-Type': 'application/json'
  },
  body: JSON.stringify({ faqs })
});
const payload = await response.json();

if (!response.ok) {
  console.error(JSON.stringify(payload, null, 2));
  process.exitCode = 1;
} else {
  console.log(JSON.stringify(payload, null, 2));
}

