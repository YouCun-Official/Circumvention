import fs from 'node:fs';
import path from 'node:path';
import { PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { fetchWithRetry } from '../utils.js';

function contentType(file) {
  const ext = path.extname(file).toLowerCase();
  return ext === '.jpg' || ext === '.jpeg' ? 'image/jpeg' : ext === '.webp' ? 'image/webp' : 'image/png';
}

function joinUrl(base, key) {
  return `${String(base).replace(/\/+$/, '')}/${key.split('/').map(encodeURIComponent).join('/')}`;
}

function sleep(ms) {
  return ms > 0 ? new Promise(resolve => setTimeout(resolve, ms)) : Promise.resolve();
}

function normalizePublicUrl(value) {
  const raw = String(value || '').trim();
  const markdownLink = raw.match(/^\[[^\]]*\]\((https:\/\/[^)]+)\)$/i);
  return markdownLink ? markdownLink[1] : raw;
}

function responseError(result) {
  const details = result?.data?.errors;
  const suffix = details ? `：${JSON.stringify(details)}` : '';
  return `${result?.message || '图床返回失败状态'}${suffix}`;
}

function multipartBoolean(value) {
  return /^(?:1|true|yes|on)$/i.test(String(value).trim()) ? '1' : '0';
}

async function uploadS3(file, key, cfg) {
  const client = new S3Client({
    region: cfg.s3Region || 'auto',
    ...(cfg.s3Endpoint ? { endpoint: cfg.s3Endpoint } : {}),
    credentials: { accessKeyId: cfg.s3AccessKeyId, secretAccessKey: cfg.s3SecretAccessKey },
    forcePathStyle: Boolean(cfg.s3Endpoint && !/amazonaws\.com/i.test(cfg.s3Endpoint))
  });
  await client.send(new PutObjectCommand({
    Bucket: cfg.s3Bucket,
    Key: key,
    Body: fs.createReadStream(file),
    ContentType: contentType(file),
    CacheControl: 'public, max-age=31536000, immutable'
  }));
  return joinUrl(cfg.s3PublicBaseUrl, key);
}

async function uploadCustom(file, key, cfg) {
  const data = new FormData();
  data.append('file', new Blob([fs.readFileSync(file)], { type: contentType(file) }), path.basename(file));
  if (cfg.customUploadStorageId) data.append('storage_id', String(cfg.customUploadStorageId));
  if (cfg.customUploadPublic !== '') data.append('is_public', multipartBoolean(cfg.customUploadPublic));
  if (cfg.customUploadRemoveExif !== '') data.append('is_remove_exif', multipartBoolean(cfg.customUploadRemoveExif));
  data.append('intro', `PaperFlow: ${key}`);
  const response = await fetchWithRetry(cfg.customUploadUrl, {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      ...(cfg.customUploadToken ? { Authorization: `Bearer ${cfg.customUploadToken}` } : {})
    },
    body: data,
    timeoutMs: 120000,
    onRetry: ({ attempt, delayMs, status }) => cfg.onUploadRetry?.({ attempt, delayMs, status })
  }, 3);
  const result = await response.json().catch(() => { throw new Error('图床返回的内容不是有效 JSON。'); });
  if (result?.status && result.status !== 'success') throw new Error(responseError(result));
  const url = normalizePublicUrl(result.url || result.public_url || result.data?.url || result.data?.public_url || result.data?.link || result.link);
  if (!url || !/^https:\/\//i.test(url)) throw new Error('自定义图床没有返回 HTTPS 图片地址。');
  return url;
}

export async function uploadFigures(figures, batchId, paperSlug, cfg, onLog = () => {}) {
  const output = [];
  for (let index = 0; index < figures.length; index += 1) {
    const figure = figures[index];
    let publicUrl = /^https:\/\//i.test(figure.publicUrl || '') ? figure.publicUrl : null;
    if (publicUrl) {
      onLog(`复用已上传图片 ${figure.id}`);
    } else if (cfg.imageHost === 's3') {
      if (!cfg.s3Bucket || !cfg.s3PublicBaseUrl || !cfg.s3AccessKeyId || !cfg.s3SecretAccessKey) throw new Error('S3 图床配置不完整。');
      onLog(`上传图片 ${figure.id} 到 S3`);
      publicUrl = await uploadS3(figure.file, `paperflow/${batchId}/${paperSlug}/${path.basename(figure.file)}`, cfg);
    } else if (cfg.imageHost === 'custom') {
      if (!cfg.customUploadUrl) throw new Error('自定义图床地址未配置。');
      onLog(`上传图片 ${figure.id} 到自定义图床`);
      publicUrl = await uploadCustom(figure.file, `paperflow/${batchId}/${paperSlug}/${path.basename(figure.file)}`, {
        ...cfg,
        onUploadRetry: ({ attempt, delayMs, status }) => onLog(`图片上传第 ${attempt} 次失败${status ? `（HTTP ${status}）` : ''}，${Math.ceil(delayMs / 1000)} 秒后重试`)
      });
    } else if (cfg.publicBaseUrl) {
      publicUrl = joinUrl(cfg.publicBaseUrl, `${batchId}/${paperSlug}/assets/${path.basename(figure.file)}`);
    }
    output.push({ ...figure, publicUrl });
    if (cfg.imageHost === 'custom' && publicUrl && index < figures.length - 1) await sleep(cfg.customUploadDelayMs);
  }
  return output;
}
