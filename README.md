# SubTranslate

**A local AI subtitle translator.** SubTranslate is a desktop app (Electron) that
translates `.srt` subtitle files using a model running locally through
[Ollama](https://ollama.com). Your subtitles never leave your machine — there is no cloud
service involved.

It does more than translate line-by-line: it merges subtitle fragments into whole
sentences before translating, then redistributes the result back across the original timed
cues, so the output reads naturally **and** keeps every timestamp intact.

> A fun project built with the help of [Claude](https://claude.ai).

---

## Features

- 🖥️ **Fully local & private** — translation runs on your machine via Ollama. No API keys, no cloud.
- 🧠 **Sentence-aware translation** — merges fragmented cues into full sentences for better grammar, then splits the translation back to the original cues.
- 🗒️ **Glossary** — lock exact translations for names/terms; auto-extract proper-noun candidates from a file.
- 📝 **Background context** — give the model a short show/episode brief (any language) for consistent tone and names.
- ↔️ **Side-by-side viewer** — original and translated cues, scroll-synced.
- ⏱️ **Timestamps preserved** — only the text changes; indices and timing are untouched.
- 🎛️ **Configurable** — Ollama host, model, source/target language, batch size, and more.
- 🔌 **Robust Ollama handling** — clear messages when Ollama is unreachable, the model is missing, or a request times out.
- 🪟 **Wide / vertical (9:16) window** for screen recording.

## Requirements

- **[Node.js](https://nodejs.org/) 18 or newer**
- **[Ollama](https://ollama.com)** installed and running, with at least one model pulled
  (Ollama is **not** bundled — install it separately).

## Install

```bash
git clone https://github.com/your-username/subtranslate.git
cd subtranslate
npm install
```

## Install Ollama and pull a model

1. Install Ollama from **https://ollama.com**.
2. Start it (it usually runs automatically; otherwise run `ollama serve`).
3. Pull a model, for example:

   ```bash
   ollama pull llama3.1:8b
   # other options:
   ollama pull gemma3:12b
   ollama pull aya-expanse:8b      # strong multilingual model
   ```

Any chat-capable Ollama model works; multilingual models give the best translations.

## Run (development)

```bash
npm start
```

## Build / package

Create a distributable app with [electron-builder](https://www.electron.build/):

```bash
npm run dist
```

The first run downloads platform build tools; output lands in `dist/`. Targets: Windows
(NSIS), macOS (dmg), Linux (AppImage).

## Usage

1. **Drop or browse** an `.srt` file. The original cues appear in a scrollable list.
2. (Optional) Paste a **Background & Context** brief, or click **Copy context prompt** to
   generate one with another AI and paste it back.
3. (Optional) Attach a **glossary** or click **Scan for names** to build one.
4. Choose **target language** and **model**.
5. Set the **output file** name and folder.
6. Click **Translate Subtitles** — watch it stream into the translated pane, then **Save**.

Use **Preview prompt** any time to see exactly what will be sent to the model.

## Configuration

| Setting | Where | Default |
|---|---|---|
| Ollama host | "Ollama host" field (Model section) or `OLLAMA_URL` env var | `http://localhost:11434` |
| Model | Model dropdown (lists your installed models) or "Custom…" | first multilingual / first installed |
| Source / target language | Languages fields | source optional, target `Hebrew` |
| Batch size, context lines, max group blocks, sentence mode | Advanced | 20 / 3 / 4 / on |
| Output name & folder | Output file card | `<input>.<lang>.srt`, input's folder |

Settings persist between launches (stored in Electron's user-data folder). See
`.env.example` for the optional `OLLAMA_URL` override.

## Supported formats

Currently **`.srt` (SubRip)** only. Other subtitle formats are on the roadmap.

## Privacy

SubTranslate sends your subtitles only to the Ollama server you configure (by default a
local one at `http://localhost:11434`). **This app does not send your data to any cloud
service.** If you point it at a remote Ollama host, your text goes there instead — that's
your choice.

## Troubleshooting

- **"Can't reach Ollama"** — Ollama isn't installed or running. Install it from
  https://ollama.com and ensure `ollama serve` is up; then click **Retry**.
- **"Model is not installed"** — pull it: `ollama pull <model>` (the message shows the
  exact command), then **Recheck**.
- **No models in the dropdown** — pull at least one model and click **Recheck**.
- **"Request timed out"** — large batches on a slow machine can exceed the timeout; reduce
  **Batch size** in Advanced, or try a smaller model.
- **Window won't stay open / GPU errors** — hardware acceleration is already disabled; if
  issues persist, update your GPU drivers.

## Limitations

- `.srt` only (for now).
- Translation quality depends on the Ollama model you choose; small models may still make
  mistakes — the glossary and context brief help a lot.
- The renderer transpiles JSX in-browser via Babel standalone (no build step); fine for
  this app's size, but not a pattern for large apps.

## Roadmap

- Additional formats (`.vtt`, `.ass`).
- Streaming token output in the live preview.
- Batch-translate multiple files.
- Optional second-pass consistency check.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md). Issues and PRs are welcome.

## Credits / third-party

Vendored in `renderer/vendor/` for offline use: **React**, **ReactDOM**, **Babel
standalone**, and **Tailwind CSS** — all MIT-licensed and © their respective authors.

## License

[MIT](LICENSE) © 2026 SubTranslate contributors.
