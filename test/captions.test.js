import test from 'node:test';
import assert from 'node:assert/strict';
import { captionRows } from '../src/services/pdf.js';
test('caption detector excludes prose references to tables and figures', () => {
  const lines = ['Table 1 is simulated 100 times.', 'Table 11 lists the variables.',
    'Figure 2 shows the results.', 'Figure 1: System architecture', 'Table 2. Results', 'Table 3 Results'];
  assert.deepEqual(captionRows(lines.map(text => ({ text }))).map(x => x.text), lines.slice(3));
});
