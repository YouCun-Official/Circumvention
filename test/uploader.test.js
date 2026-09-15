import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import assert from 'node:assert/strict';
import { uploadFigures } from '../src/services/uploader.js';

test('Boltp-style custom uploader sends required fields and reads data.public_url', async t => {
  const originalFetch = globalThis.fetch;
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'paperflow-upload-'));
  const file = path.join(folder, 'fig-01.png');
  fs.writeFileSync(file, Buffer.from([137, 80, 78, 71]));
  t.after(() => {
    globalThis.fetch = originalFetch;
    fs.rmSync(folder, { recursive: true, force: true });
  });

  globalThis.fetch = async (_url, options) => {
    assert.equal(options.method, 'POST');
    assert.equal(options.headers.Accept, 'application/json');
    assert.equal(options.headers.Authorization, 'Bearer test-token');
    assert.equal(options.body.get('storage_id'), '2');
    assert.equal(options.body.get('is_public'), '1');
    assert.equal(options.body.get('is_remove_exif'), '1');
    assert.match(options.body.get('intro'), /paperflow\/batch\/paper\/fig-01\.png/i);
    assert.equal(options.body.get('key'), null);
    assert.equal(options.body.get('file').name, 'fig-01.png');
    return new Response(JSON.stringify({
      status: 'success',
      data: { public_url: 'https://img.example.test/fig-01.png' }
    }), { status: 200, headers: { 'content-type': 'application/json' } });
  };

  const result = await uploadFigures([{ id: 'fig-01', file }], 'batch', 'paper', {
    imageHost: 'custom',
    customUploadUrl: 'https://www.boltp.com/api/v2/upload',
    customUploadToken: 'test-token',
    customUploadStorageId: '2',
    customUploadPublic: 'true',
    customUploadRemoveExif: 'true',
    customUploadDelayMs: 0
  });
  assert.equal(result[0].publicUrl, 'https://img.example.test/fig-01.png');
});

test('uploader reuses a public URL without uploading again', async t => {
  const originalFetch = globalThis.fetch;
  t.after(() => { globalThis.fetch = originalFetch; });
  globalThis.fetch = async () => { throw new Error('should not fetch'); };
  const result = await uploadFigures([{
    id: 'fig-01',
    file: 'missing.png',
    publicUrl: 'https://img.example.test/existing.png'
  }], 'batch', 'paper', { imageHost: 'custom', customUploadUrl: 'https://upload.example.test' });
  assert.equal(result[0].publicUrl, 'https://img.example.test/existing.png');
});
