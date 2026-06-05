# Contributing to SubTranslate

Thanks for your interest! This is a small, hackable Electron app.

## Project layout

```
main.js            Electron main process (window, IPC, file dialogs, window sizing)
preload.js         Secure bridge exposing window.subtranslate.* to the renderer
engine.js          Translation engine: SRT parsing, sentence merge, Ollama calls, redistribute
cli.js             Headless CLI over the same engine (no Electron needed)
renderer/
  index.html       The whole UI (React via vendored libs, JSX transpiled in-browser by Babel)
  vendor/          Vendored React / ReactDOM / Babel / Tailwind (offline-first)
test/engine.test.js  Plain-Node unit tests for the engine
```

## Dev setup

```bash
npm install
npm start        # run the app
npm test         # run engine unit tests
node cli.js subtitles.srt --to Hebrew --model llama3.1:8b   # headless
```

## Before opening a PR

- Run `npm test` and make sure it passes.
- Keep the engine free of Electron/DOM dependencies (it must stay usable from `cli.js` and tests).
- Match the existing style; keep changes focused and avoid large rewrites.
- If you change UI logic, sanity-check that the renderer still transpiles (the app simply
  won't render if the JSX is invalid).

## Reporting bugs

Open an issue with steps to reproduce, your OS, Node version, Ollama version, and the model
you used.
