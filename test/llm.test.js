import test from 'node:test';
import assert from 'node:assert/strict';
import { parseModelResponse } from '../src/services/llm.js';

test('streamed OpenAI chat chunks are assembled', () => {
  const stream = [
    'data: {"choices":[{"delta":{"content":"{\\"ok\\":"}}]}',
    '',
    'data: {"choices":[{"delta":{"content":"true}"}}]}',
    '',
    'data: [DONE]'
  ].join('\n');
  assert.equal(parseModelResponse(stream, 'text/event-stream'), '{"ok":true}');
});

test('streamed upstream errors are surfaced for retry', () => {
  const stream = 'data: {"error":{"message":"upstream authentication failed"}}\n\ndata: [DONE]\n';
  assert.throws(() => parseModelResponse(stream, 'text/event-stream'), /upstream authentication failed/);
});
