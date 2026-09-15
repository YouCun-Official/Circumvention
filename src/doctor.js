import fs from 'node:fs';
import { OUTPUT_DIR, DATA_DIR, ensureDirectories, readSettings } from './config.js';
import { findBrowser } from './render.js';

ensureDirectories();
const cfg = readSettings();

const imageHostingReady = cfg.imageHost === 'local'
  || (cfg.imageHost === 's3' && Boolean(cfg.s3PublicBaseUrl && cfg.s3Bucket && cfg.s3AccessKeyId && cfg.s3SecretAccessKey))
  || (cfg.imageHost === 'custom' && Boolean(cfg.customUploadUrl && cfg.customUploadToken && cfg.customUploadStorageId))
  || Boolean(cfg.publicBaseUrl);

function testWritable(dir) {
  const file = `${dir}/.write-test-${process.pid}`;
  try { fs.writeFileSync(file, 'ok'); fs.unlinkSync(file); return true; } catch { return false; }
}

const checks = [
  ['Node.js 版本', Number(process.versions.node.split('.')[0]) >= 20, process.versions.node],
  ['数据目录可写', testWritable(DATA_DIR), DATA_DIR],
  ['输出目录可写', testWritable(OUTPUT_DIR), OUTPUT_DIR],
  ['Edge/Chrome', Boolean(findBrowser(cfg.browserExecutable)), findBrowser(cfg.browserExecutable) || '未找到'],
  ['模型接口', Boolean(cfg.llmApiKey && cfg.llmModel), cfg.llmModel || '未配置'],
  ['Tavily', Boolean(cfg.tavilyApiKey), cfg.tavilyApiKey ? '已配置' : '未配置（指定论文模式不需要）'],
  ['图片托管', imageHostingReady, cfg.imageHost]
];

for (const [label, ok, detail] of checks) console.log(`${ok ? '✓' : '○'} ${label}：${detail}`);
const required = checks.slice(0, 4).every(item => item[1]);
if (!required) process.exitCode = 1;
