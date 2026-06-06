// engine.js — SubLingo translation engine.
// Pure Node, no dependencies. Parses SRT, merges fragments into sentences,
// translates each sentence via Ollama's REST API (global fetch, Node 18+),
// then redistributes the translation back across the original timed cues.

const DEFAULT_OLLAMA = 'http://localhost:11434';
const DEFAULT_TIMEOUT_MS = 120000; // per-request translation timeout

// No hidden/assumed instructions: by default nothing show-specific is injected.
// All tone/context comes from the user's Context box (the `summary`) + glossary.
const DEFAULT_CONTEXT = '';

const SEP = (n) => `<<<SUBTITLE ${n}>>>`;
const SEP_RE = /<<<SUBTITLE\s+(\d+)>>>/g;
const TERMINAL_RE = /[.!?…]["')\]»”’]*\s*$/;

// ── SRT parsing ───────────────────────────────────────────
function parseSrt(text) {
  const blocks = text.replace(/\r\n/g, '\n').trim().split(/\n\n+/);
  const entries = [];
  for (const block of blocks) {
    const lines = block.split('\n');
    if (lines.length < 2) continue;
    entries.push({
      index: lines[0].trim(),
      timing: lines[1].trim(),
      content: lines.slice(2),
    });
  }
  return entries;
}

function blockText(entry, joiner = ' ') {
  return entry.content.map((s) => s.trim()).filter(Boolean).join(joiner).trim();
}

function timingParts(timing) {
  const m = timing.match(/(\d{2}:\d{2}:\d{2},\d{3})\s*-->\s*(\d{2}:\d{2}:\d{2},\d{3})/);
  return m ? { start: m[1], end: m[2] } : { start: '', end: '' };
}

// ── Glossary ──────────────────────────────────────────────
function loadGlossary(text) {
  const g = new Map();
  if (!text) return g;
  for (let line of text.split(/\r?\n/)) {
    line = line.trim();
    if (!line || line.startsWith('#') || !line.includes('=')) continue;
    const i = line.indexOf('=');
    let src = line.slice(0, i).trim();
    let tgt = line.slice(i + 1);
    tgt = tgt.split('#')[0].trim(); // strip inline "# x9" comment
    if (src && tgt) g.set(src, tgt);
  }
  return g;
}

// ── Sentence grouping ─────────────────────────────────────
function segmentIntoSentences(entries, maxBlocks = 4, maxChars = 200) {
  const groups = [];
  let curIdx = [], curParts = [];
  const flush = () => {
    if (curIdx.length) {
      groups.push({ blockIdx: curIdx.slice(), text: curParts.filter(Boolean).join(' ').trim() });
      curIdx = []; curParts = [];
    }
  };
  for (let i = 0; i < entries.length; i++) {
    curIdx.push(i);
    curParts.push(blockText(entries[i]));
    const joined = curParts.filter(Boolean).join(' ').trim();
    if (TERMINAL_RE.test(joined) || curIdx.length >= maxBlocks || joined.length >= maxChars) flush();
  }
  flush();
  return groups;
}

function buildGroups(entries, sentenceMode, maxGroupBlocks) {
  if (sentenceMode) return segmentIntoSentences(entries, maxGroupBlocks);
  return entries.map((e, i) => ({ blockIdx: [i], text: e.content.join('\n') }));
}

// ── Redistribution ────────────────────────────────────────
// Split one translated sentence back across N timed cues, proportional to each cue's
// source length, breaking only at word boundaries. The caller pairs each returned piece
// with the cue's ORIGINAL index + timestamp, so timing/structure are always preserved.
function redistribute(translatedText, weights) {
  const n = weights.length;
  if (n === 1) return [translatedText.trim()];
  const words = translatedText.split(/\s+/).filter(Boolean);
  if (!words.length) return new Array(n).fill('');

  let totalW = weights.reduce((a, b) => a + b, 0);
  if (totalW <= 0) { weights = new Array(n).fill(1); totalW = n; }

  const exact = weights.map((w) => (words.length * w) / totalW);
  const counts = exact.map((x) => Math.floor(x));
  let remainder = words.length - counts.reduce((a, b) => a + b, 0);
  const order = exact.map((x, i) => i).sort((a, b) => (exact[b] - counts[b]) - (exact[a] - counts[a]));
  for (let k = 0; k < remainder; k++) counts[order[k]]++;

  // don't starve a non-empty source block to zero
  const nonempty = weights.map((w, i) => (w > 0 ? i : -1)).filter((i) => i >= 0);
  if (words.length >= nonempty.length) {
    for (const i of nonempty) {
      if (counts[i] === 0) {
        let donor = 0;
        for (let k = 1; k < n; k++) if (counts[k] > counts[donor]) donor = k;
        if (counts[donor] > 1) { counts[donor]--; counts[i]++; }
      }
    }
  }

  const out = []; let pos = 0;
  for (const c of counts) { out.push(words.slice(pos, pos + c).join(' ')); pos += c; }
  return out;
}

// ── Prompt building ───────────────────────────────────────
function buildPrompt(texts, srcLang, tgtLang, glossary, primer, prevLines, summary) {
  const srcPart = srcLang ? `from ${srcLang} ` : '';
  const sections = [];
  if (primer) sections.push(primer.trim());
  if (summary) sections.push(
    'BACKGROUND — episode/scene summary for understanding only; do NOT translate or output ' +
    'this, just use it to translate accurately and keep names/terms consistent:\n' + summary.trim());
  if (glossary && glossary.size) {
    const pairs = [...glossary.entries()].map(([s, t]) => `- ${s} → ${t}`).join('\n');
    sections.push('Use these EXACT translations for the following terms; do not translate them any other way:\n' + pairs);
  }
  if (prevLines && prevLines.length) {
    sections.push('PREVIOUS CONTEXT (already translated — for reference only; do NOT re-translate or re-output these lines):\n' + prevLines.join('\n'));
  }
  const joined = texts.map((t, i) => `${SEP(i)}\n${t}`).join('\n');
  sections.push(
    `Translate the subtitle texts below ${srcPart}to ${tgtLang}.\n` +
    'Each subtitle is preceded by a marker line like <<<SUBTITLE 0>>>.\n' +
    'Rules:\n' +
    '- Keep every marker line EXACTLY as-is, on its own line.\n' +
    '- Translate ONLY the text under each marker.\n' +
    '- Preserve line breaks within each subtitle.\n' +
    '- Output nothing but the markers and translations.\n\n' +
    joined);
  return sections.join('\n\n');
}

// ── Ollama call + batch translate ─────────────────────────
// Combine an optional external abort (user cancel) with a timeout abort, without
// relying on AbortSignal.any (Node 20+) so we stay compatible with Node 18.
function withTimeout(externalSignal, timeoutMs) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(new Error('timeout')), timeoutMs);
  if (externalSignal) {
    if (externalSignal.aborted) ctrl.abort();
    else externalSignal.addEventListener('abort', () => ctrl.abort(), { once: true });
  }
  return { signal: ctrl.signal, cancel: () => clearTimeout(timer) };
}

// Ping Ollama and list installed models. Never throws — returns a status object.
async function checkOllama(baseUrl = DEFAULT_OLLAMA, timeoutMs = 5000) {
  const { signal, cancel } = withTimeout(null, timeoutMs);
  try {
    const resp = await fetch(`${baseUrl}/api/tags`, { signal });
    if (!resp.ok) return { reachable: false, models: [], error: `HTTP ${resp.status}` };
    const data = await resp.json();
    return { reachable: true, models: (data.models || []).map((m) => m.name), error: null };
  } catch (e) {
    return { reachable: false, models: [], error: e.name === 'AbortError' ? 'timeout' : e.message };
  } finally {
    cancel();
  }
}

async function callOllama(baseUrl, model, prompt, signal, timeoutMs = DEFAULT_TIMEOUT_MS) {
  const { signal: s, cancel } = withTimeout(signal, timeoutMs);
  let resp;
  try {
    resp = await fetch(`${baseUrl}/api/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model, prompt, stream: false, options: { temperature: 0.2 } }),
      signal: s,
    });
  } catch (e) {
    if (signal && signal.aborted) throw new Error('cancelled');
    // The timeout controller aborts with our own Error; a real timeout shows as AbortError.
    if (e.name === 'AbortError') { const err = new Error(`Ollama request timed out after ${Math.round(timeoutMs / 1000)}s`); err.code = 'TIMEOUT'; throw err; }
    const err = new Error(`Cannot reach Ollama at ${baseUrl}. Is it running? (https://ollama.com)`); err.code = 'UNREACHABLE'; throw err;
  } finally {
    cancel();
  }
  if (!resp.ok) {
    const body = await resp.text().catch(() => '');
    if (resp.status === 404) { const err = new Error(`Model "${model}" is not installed. Run:  ollama pull ${model}`); err.code = 'MODEL_NOT_FOUND'; throw err; }
    const err = new Error(`Ollama returned an error (HTTP ${resp.status}). ${body.slice(0, 200)}`); err.code = 'HTTP'; throw err;
  }
  const data = await resp.json();
  return (data.response || '').trim();
}

async function translateBatch(texts, opts, prevLines, signal) {
  const prompt = buildPrompt(texts, opts.srcLang, opts.tgtLang, opts.glossary,
    opts.primer, prevLines, opts.summary);
  const out = await callOllama(opts.baseUrl, opts.model, prompt, signal, opts.timeoutMs);

  const result = {};
  let m;
  SEP_RE.lastIndex = 0;
  const idxs = []; const positions = [];
  while ((m = SEP_RE.exec(out)) !== null) { idxs.push(parseInt(m[1], 10)); positions.push(m.index + m[0].length); }
  for (let j = 0; j < idxs.length; j++) {
    const from = positions[j];
    const to = j + 1 < idxs.length ? out.indexOf('<<<SUBTITLE', from) : out.length;
    result[idxs[j]] = out.slice(from, to < 0 ? out.length : to).trim();
  }
  // fallback to source for any dropped marker
  return texts.map((t, i) => (result[i] !== undefined ? result[i] : t));
}

function tailLines(translatedTexts, n) {
  if (n <= 0) return [];
  const lines = [];
  for (const t of translatedTexts) for (const s of t.split('\n')) if (s.trim()) lines.push(s);
  return lines.slice(-n);
}

// ── Selection (range / limit) ─────────────────────────────
function resolveSelection(rangeMode, rangeN, rangeA, rangeB, total) {
  if (rangeMode === 'first') {
    const end = Math.min(Math.max(1, rangeN), total);
    return { start0: 0, end, partial: true };
  }
  if (rangeMode === 'range') {
    const start = Math.max(1, rangeA), end = Math.min(rangeB, total);
    if (start > end) throw new Error(`Invalid range ${start}:${end}`);
    return { start0: start - 1, end, partial: true };
  }
  return { start0: 0, end: total, partial: false };
}

// ── Proper-noun extraction ────────────────────────────────
const CAP_SEQ_RE = /[A-Z][a-z'’]+(?:\s+[A-Z][a-z'’]+)*/g;
const SENT_SPLIT_RE = /(?<=[.!?])\s+/;
function extractNameCandidates(entries) {
  const counts = new Map();
  for (const e of entries) {
    const text = e.content.join(' ').trim();
    if (!text) continue;
    for (const sentence of text.split(SENT_SPLIT_RE)) {
      const stripped = sentence.replace(/^["'“”‘’\-–— \t]+/, '');
      const offset = sentence.length - stripped.length;
      let m; CAP_SEQ_RE.lastIndex = 0;
      while ((m = CAP_SEQ_RE.exec(sentence)) !== null) {
        const token = m[0].trim();
        const multiword = token.includes(' ');
        const atStart = m.index <= offset;
        if (atStart && !multiword) continue;
        counts.set(token, (counts.get(token) || 0) + 1);
      }
    }
  }
  return [...counts.entries()].sort((a, b) => (b[1] - a[1]) || a[0].toLowerCase().localeCompare(b[0].toLowerCase()));
}

function glossaryTemplate(candidates, sourceName) {
  const lines = [
    '# ============================================================',
    '# AI FILL INSTRUCTION (remove this block after use):',
    '# Fill in the target-language translation after each "=".',
    '# - Keep proper names phonetic; use official localized titles where they exist.',
    '# - Delete rows that are not real names/terms. Blank targets are ignored.',
    '# ============================================================',
    '',
    `# Glossary template generated from ${sourceName}`,
    '# Format:  source = target',
    '',
  ];
  for (const [term, count] of candidates) lines.push(`${term} =    # x${count}`);
  return lines.join('\n') + '\n';
}

// ── Full translation ──────────────────────────────────────
async function translateAll(options, onProgress, signal) {
  const {
    srtText, tgtLang, srcLang = '', model, baseUrl = DEFAULT_OLLAMA,
    glossaryText = '', summary = '', primer = DEFAULT_CONTEXT,
    batchSize = 20, ctxLines = 3, maxGroupBlocks = 4, sentenceMode = true,
    rangeMode = 'all', rangeN = 30, rangeA = 1, rangeB = 100,
    timeoutMs = DEFAULT_TIMEOUT_MS,
  } = options;

  if (!tgtLang) throw new Error('Please choose a target language.');
  if (!model) throw new Error('Please choose an Ollama model.');

  const entries = parseSrt(srtText);
  if (!entries.length) throw new Error('No subtitle entries found — is this a valid .srt file?');

  // Preflight: fail fast with a clear message instead of silently producing
  // untranslated output when Ollama is down or the model is missing.
  const health = await checkOllama(baseUrl);
  if (!health.reachable) {
    throw new Error(`Cannot reach Ollama at ${baseUrl}. Make sure Ollama is installed and running — see https://ollama.com`);
  }
  if (!health.models.includes(model)) {
    const avail = health.models.length ? ` Installed models: ${health.models.join(', ')}.` : ' No models are installed yet.';
    throw new Error(`Model "${model}" is not installed. Run:  ollama pull ${model}.${avail}`);
  }

  const total = entries.length;
  const sel = resolveSelection(rangeMode, rangeN, rangeA, rangeB, total);
  const chunk = entries.slice(sel.start0, sel.end);

  const glossary = loadGlossary(glossaryText);
  const opts = { srcLang, tgtLang, model, baseUrl, glossary, primer, summary, timeoutMs };
  let warnings = 0; // blocks that kept their original text due to a non-fatal model error

  // seed rolling context from blocks just before a partial range
  let prevLines = [];
  if (sel.partial && sel.start0 > 0 && ctxLines > 0) {
    const seedStart = Math.max(0, sel.start0 - ctxLines * 2);
    const seedGroups = buildGroups(entries.slice(seedStart, sel.start0), sentenceMode, maxGroupBlocks);
    if (seedGroups.length) {
      try {
        const seedTr = await translateBatch(seedGroups.map((g) => g.text), opts, [], signal);
        prevLines = tailLines(seedTr, ctxLines);
      } catch (e) { /* non-fatal */ }
    }
  }

  const groups = buildGroups(chunk, sentenceMode, maxGroupBlocks);
  const outBlocks = new Array(chunk.length).fill(null);
  let doneBlocks = 0;

  for (let start = 0; start < groups.length; start += batchSize) {
    if (signal?.aborted) throw new Error('cancelled');
    const batch = groups.slice(start, start + batchSize);
    const texts = batch.map((g) => g.text);

    let translated;
    try {
      translated = await translateBatch(texts, opts, prevLines, signal);
    } catch (e) {
      if (signal?.aborted || e.message === 'cancelled') throw new Error('cancelled');
      // Fatal conditions: don't pretend to succeed with untranslated text — surface them.
      if (['UNREACHABLE', 'TIMEOUT', 'MODEL_NOT_FOUND'].includes(e.code)) throw e;
      // Incidental error (e.g. a transient 500): keep originals for this batch and warn.
      warnings += batch.reduce((n, g) => n + g.blockIdx.length, 0);
      translated = texts;
    }

    for (let b = 0; b < batch.length; b++) {
      const g = batch[b];
      const members = g.blockIdx;
      let parts;
      if (members.length === 1) parts = [translated[b].trim()];
      else parts = redistribute(translated[b], members.map((bi) => blockText(chunk[bi]).length));
      for (let k = 0; k < members.length; k++) {
        const bi = members[k];
        const e = chunk[bi];
        outBlocks[bi] = `${e.index}\n${e.timing}\n${parts[k]}`;
        doneBlocks++;
        const tp = timingParts(e.timing);
        onProgress && onProgress({
          done: doneBlocks, total: chunk.length,
          cue: { start: tp.start, end: tp.end, text: parts[k] },
        });
      }
    }
    prevLines = tailLines(translated, ctxLines);
  }

  for (let i = 0; i < outBlocks.length; i++) {
    if (outBlocks[i] === null) {
      const e = chunk[i];
      outBlocks[i] = `${e.index}\n${e.timing}\n${blockText(e)}`;
    }
  }

  return { outputText: outBlocks.join('\n\n') + '\n', partial: sel.partial,
    start: sel.start0 + 1, end: sel.end, translatedBlocks: chunk.length, warnings };
}

module.exports = {
  DEFAULT_OLLAMA, DEFAULT_CONTEXT, DEFAULT_TIMEOUT_MS,
  parseSrt, blockText, loadGlossary, segmentIntoSentences, buildGroups,
  redistribute, buildPrompt, callOllama, checkOllama, translateBatch, tailLines,
  resolveSelection, extractNameCandidates, glossaryTemplate, translateAll, timingParts,
};
