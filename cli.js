#!/usr/bin/env node
// cli.js — headless translator using the same engine (no Electron needed).
//   node cli.js input.srt --to Hebrew --model gemma3:12b --glossary g.txt --summary-file s.txt
const fs = require('fs');
const path = require('path');
const engine = require('./engine');

function parseArgs(argv) {
  const a = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const t = argv[i];
    if (t === '-o') { a.o = argv[++i]; }
    else if (t.startsWith('--')) {
      const key = t.slice(2);
      const next = argv[i + 1];
      if (key === 'block-mode') { a.sentenceMode = false; }
      else if (next && !next.startsWith('--')) { a[key] = next; i++; }
      else a[key] = true;
    } else a._.push(t);
  }
  return a;
}

(async () => {
  const a = parseArgs(process.argv.slice(2));
  const input = a._[0];
  if (!input || !a.to) {
    console.error('Usage: node cli.js <input.srt> --to <Language> [--model m] [--from L]');
    console.error('  [--glossary file] [--summary-file file] [--batch N] [--context-lines N]');
    console.error('  [--max-group-blocks N] [--block-mode] [--limit N] [--range A:B] [-o out.srt]');
    process.exit(1);
  }
  const srtText = fs.readFileSync(input, 'utf8').replace(/^﻿/, '');
  const glossaryText = a.glossary ? fs.readFileSync(a.glossary, 'utf8') : '';
  const summary = a['summary-file'] ? fs.readFileSync(a['summary-file'], 'utf8') : (a.summary || '');

  let rangeMode = 'all', rangeN = 30, rangeA = 1, rangeB = 100;
  if (a.limit) { rangeMode = 'first'; rangeN = +a.limit; }
  else if (a.range) { const [x, y] = String(a.range).split(':'); rangeMode = 'range'; rangeA = +x || 1; rangeB = +y || 999999; }

  const opts = {
    srtText, tgtLang: a.to, srcLang: a.from || '', model: a.model || 'gemma3:12b',
    glossaryText, summary, batchSize: +a.batch || 20, ctxLines: a['context-lines'] != null ? +a['context-lines'] : 3,
    maxGroupBlocks: +a['max-group-blocks'] || 4, sentenceMode: a.sentenceMode !== false,
    rangeMode, rangeN, rangeA, rangeB,
  };

  let last = 0;
  const res = await engine.translateAll(opts, (p) => {
    if (p.done - last >= 10 || p.done === p.total) { last = p.done; process.stdout.write(`\rTranslated ${p.done}/${p.total} blocks`); }
  });
  process.stdout.write('\n');

  const base = input.replace(/\.[^.]+$/, '');
  const lang = a.to.toLowerCase();
  const out = a.o || (res.partial ? `${base}.${lang}.${res.start}-${res.end}.srt` : `${base}.${lang}.srt`);
  fs.writeFileSync(out, res.outputText, 'utf8');
  console.log(`Done -> ${out}`);
})().catch((e) => { console.error('Error:', e.message); process.exit(1); });
