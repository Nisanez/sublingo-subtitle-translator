// Plain-Node unit tests for the translation engine (no test framework).
// Run with:  npm test
const assert = require('assert');
const e = require('../engine');

let passed = 0;
function test(name, fn) {
  try { fn(); passed++; console.log('  ok  ' + name); }
  catch (err) { console.error('FAIL  ' + name + '\n      ' + err.message); process.exitCode = 1; }
}

const SAMPLE =
  '1\n00:00:01,000 --> 00:00:03,000\nThe amazing race was\n\n' +
  '2\n00:00:03,200 --> 00:00:05,000\ninspired by two friends\n\n' +
  '3\n00:00:05,200 --> 00:00:07,000\nbackpacking through Europe.\n\n' +
  '4\n00:00:07,200 --> 00:00:09,000\nWelcome back!';

test('parseSrt reads index, timing, content and preserves order', () => {
  const en = e.parseSrt(SAMPLE);
  assert.strictEqual(en.length, 4);
  assert.strictEqual(en[0].index, '1');
  assert.strictEqual(en[0].timing, '00:00:01,000 --> 00:00:03,000');
  assert.deepStrictEqual(en[3].content, ['Welcome back!']);
});

test('segmentIntoSentences merges whole blocks until terminal punctuation', () => {
  const en = e.parseSrt(SAMPLE);
  const groups = e.segmentIntoSentences(en, 4);
  // blocks 1-3 form one sentence ("...through Europe."), block 4 is its own.
  assert.deepStrictEqual(groups[0].blockIdx, [0, 1, 2]);
  assert.ok(/backpacking through Europe\.$/.test(groups[0].text));
  assert.deepStrictEqual(groups[1].blockIdx, [3]);
});

test('segmentIntoSentences respects the max-blocks cap', () => {
  const en = e.parseSrt(SAMPLE);
  const groups = e.segmentIntoSentences(en, 2); // force a split before the period
  assert.ok(groups[0].blockIdx.length <= 2);
});

test('redistribute splits proportionally on word boundaries and preserves word count', () => {
  const parts = e.redistribute('alpha beta gamma delta epsilon zeta', [10, 10, 10]);
  assert.strictEqual(parts.length, 3);
  const total = parts.join(' ').split(/\s+/).filter(Boolean).length;
  assert.strictEqual(total, 6);
  parts.forEach((p) => assert.ok(!p.startsWith(' ') && !p.endsWith(' ')));
});

test('redistribute returns text unchanged for a single block', () => {
  assert.deepStrictEqual(e.redistribute('hello world', [5]), ['hello world']);
});

test('loadGlossary parses pairs, strips inline # comments, ignores blanks/comments', () => {
  const g = e.loadGlossary('# header\nDutch = הולנדי    # x9\nbackpacking = טיול תרמילאים\nEmpty =\n');
  assert.strictEqual(g.get('Dutch'), 'הולנדי');
  assert.strictEqual(g.get('backpacking'), 'טיול תרמילאים');
  assert.ok(!g.has('Empty'));
});

test('resolveSelection handles all / first / range', () => {
  assert.deepStrictEqual(e.resolveSelection('all', 0, 0, 0, 100), { start0: 0, end: 100, partial: false });
  assert.deepStrictEqual(e.resolveSelection('first', 30, 0, 0, 100), { start0: 0, end: 30, partial: true });
  assert.deepStrictEqual(e.resolveSelection('range', 0, 40, 60, 100), { start0: 39, end: 60, partial: true });
});

test('extractNameCandidates finds names, skips lone sentence-initial caps', () => {
  const en = e.parseSrt(SAMPLE);
  const names = e.extractNameCandidates(en).map(([t]) => t);
  assert.ok(names.includes('Europe'));       // mid-sentence capital
  assert.ok(!names.includes('Welcome'));      // lone sentence-initial capital -> skipped
});

console.log(`\n${passed} passed`);
