# Changelog

All notable changes to the HermesForge project will be documented in this file. Correct semantic versioning rules apply.

---

## [1.0.0] — 2026-06-11
### Added
- **OpenClaw Compatible JSON-RPC Bridge Server**: Booting on port `11435`, enabling external agent clients (like auto-tutoring or scripts) to read, write, and execute safely in the local context.
- **Workspace Context Exporter command**: Packaged clean workspace tree context with text files compressed inside `.telemetry/project_context.json` for consumption by external agent chains.
- **EasyTutor Offline Integration Script**: Provided `scripts/demo_easytutor.js` freelance educational worker demonstrating full integration with the bridge server node.
- **Premium Feature Opt-Ins**: Toggleable Cloud Model Fallbacks and Advanced Semantic recursive RAG in settings and bento boards.
- **Robust Unit Testing Suite**: Reached complete unit coverage with modules like `OpenClawBridge.test.ts`, `LegacyMigrator.test.ts`, and `PerformanceAuditor.test.ts`.
- **Marketplace Publishing assets**: Compiled comprehensive `.vscodeignore`, full `MIT` license, and detailed developer guide lines of `CONTRIBUTING.md`.

### Changed
- **Zero console.log standard**: Cleaned up all raw stdout and error logging using encapsulated, unified, level-aware `Logger.ts`.
- **VS Code Extension Contributes**: Full categories, activation events, and configuration schemas finalized in `package.json`.

---

## [1.0.0-Beta] — 2026-06-11
### Added
- **JS-to-TS Legacy Code Migrator**: Specialized command agent persona capable of converting untyped legacy Javascript modules to strong, TS compiled entities with companion `vitest` unit-test suites.
- **Hardware speed benchmarking profiler**: Standardised streaming-inference latency test measuring system processing performance (words per second tokens), Time To First Token (TTFT), and allocating threads correctly offline.
- **Micro algorithmic performance auditor**: Complexity checker scans files for redundant Big-O loops, variables memory leak risks, and lists refactored alternative candidates in `PERF_AUDIT.md`.
- **Differential Git PR Summary Generator**: Automatically structures professional Conventional Commit syntax, logs changelogs, compiles descriptive PR outlines, and gates writes with high-tier local rollback safety.
- **Interactive Control Grid**: Embedded clickable fast-action bento indicators directly into the Executive Control Dashboard webview.
- **Workspace Configuration attributes**: Exposed Settings variables in `package.json` configurations allowing the client to override model names, contexts, or local hostnames inside VS Code options.

### Changed
- **Ollama Initialization**: Refactored `OllamaClient` to retrieve variables dynamically from vscode configurations on settings change.
- **Status Bar Integration**: Augmented the Right hand tracker tooltips to report connected local URLs, missing models, and prompt download clipboard commands.

---

## [0.9.0] — 2026-06-04
### Added
- Multi-agent deliberation router utilizing fast classification strategies.
- AST-driven structural directory crawler context providers.
- Real-time Sidebar Chat streaming UI and micro markdown parser.

---

## [0.1.0] — 2026-05-20
- Initial bootstrap with TCP Keep-Alive pooling client.
- Inline autocomplete provider utilizing Fill-In-The-Middle (FIM) and AbortController cancellation triggers.
