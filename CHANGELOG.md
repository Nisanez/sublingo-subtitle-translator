# Changelog

All notable changes to this project are documented here. The format is based on
[Keep a Changelog](https://keepachangelog.com/), and this project adheres to
[Semantic Versioning](https://semver.org/).

## [1.0.0] - 2026-06-05

### Added
- Initial public release.
- Electron desktop app translating `.srt` subtitles locally via Ollama.
- Sentence-aware translation: merge fragments → translate → redistribute, preserving
  original indices and timestamps.
- Glossary support plus proper-noun auto-extraction ("Scan for names").
- Background/context brief, with a copyable context-generator prompt.
- Side-by-side, scroll-synced original/translation viewer.
- Configurable Ollama host, model (from installed models), languages, batching.
- Robust Ollama handling: reachability/model preflight, request timeout, and clear UI
  messages instead of silent failures.
- Output file name + destination with an overwrite guard.
- Wide / vertical (9:16) window modes; light/dark themes.
- Headless `cli.js` over the same engine; engine unit tests (`npm test`).
