import 'dotenv/config';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const DATA_DIR = path.resolve(ROOT, process.env.DATA_DIR || 'data');
export const OUTPUT_DIR = path.resolve(ROOT, process.env.OUTPUT_DIR || 'outputs');

const defaults = {
  maxParallelPapers: Number(process.env.MAX_PARALLEL_PAPERS || 2),
  llmApiKey: process.env.LLM_API_KEY || '',
  llmBaseUrl: process.env.LLM_BASE_URL || 'https://api.openai.com/v1',
  llmModel: process.env.LLM_MODEL || '',
  visionModel: process.env.VISION_MODEL || '',
  tavilyApiKey: process.env.TAVILY_API_KEY || '',
  semanticScholarApiKey: process.env.SEMANTIC_SCHOLAR_API_KEY || '',
  imageHost: process.env.IMAGE_HOST || 'local',
  publicBaseUrl: process.env.PUBLIC_BASE_URL || '',
  s3Endpoint: process.env.S3_ENDPOINT || '',
  s3Region: process.env.S3_REGION || 'auto',
  s3Bucket: process.env.S3_BUCKET || '',
  s3AccessKeyId: process.env.S3_ACCESS_KEY_ID || '',
  s3SecretAccessKey: process.env.S3_SECRET_ACCESS_KEY || '',
  s3PublicBaseUrl: process.env.S3_PUBLIC_BASE_URL || '',
  customUploadUrl: process.env.CUSTOM_UPLOAD_URL || '',
  customUploadToken: process.env.CUSTOM_UPLOAD_TOKEN || '',
  browserExecutable: process.env.BROWSER_EXECUTABLE || ''
};

export function ensureDirectories() {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.mkdirSync(path.join(DATA_DIR, 'jobs'), { recursive: true });
  fs.mkdirSync(OUTPUT_DIR, { recursive: true });
}

export function readSettings() {
  ensureDirectories();
  return { ...defaults };
}
