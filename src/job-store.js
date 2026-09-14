import fs from 'node:fs';
import path from 'node:path';
import { DATA_DIR, ensureDirectories } from './config.js';
import { atomicJson, jobId } from './utils.js';

function fileFor(id) {
  return path.join(DATA_DIR, 'jobs', `${id}.json`);
}

export function createJob(request) {
  ensureDirectories();
  const now = new Date().toISOString();
  const job = {
    id: jobId(),
    status: 'queued',
    phase: '等待开始',
    progress: 0,
    request,
    papers: [],
    logs: [],
    createdAt: now,
    updatedAt: now
  };
  atomicJson(fileFor(job.id), job);
  return job;
}

export function getJob(id) {
  try { return JSON.parse(fs.readFileSync(fileFor(id), 'utf8')); }
  catch (error) { if (error.code === 'ENOENT') return null; throw error; }
}

export function updateJob(id, change) {
  const job = getJob(id);
  if (!job) throw new Error(`任务不存在：${id}`);
  const patch = typeof change === 'function' ? change(job) || {} : change;
  Object.assign(job, patch, { updatedAt: new Date().toISOString() });
  atomicJson(fileFor(id), job);
  return job;
}

export function logJob(id, message, level = 'info') {
  return updateJob(id, job => {
    job.logs.push({ at: new Date().toISOString(), level, message });
    if (job.logs.length > 300) job.logs.splice(0, job.logs.length - 300);
  });
}

export function listJobs() {
  ensureDirectories();
  return fs.readdirSync(path.join(DATA_DIR, 'jobs'))
    .filter(name => name.endsWith('.json'))
    .map(name => {
      try { return JSON.parse(fs.readFileSync(path.join(DATA_DIR, 'jobs', name), 'utf8')); }
      catch { return null; }
    })
    .filter(Boolean)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    .slice(0, 50);
}
