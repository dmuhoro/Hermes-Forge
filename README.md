# HermesForge ⚡️

**An ultra-fast, fully offline, privacy-first AI IDE extension for VS Code.**

HermesForge merges the capabilities of real-time Context Chat (Cursor), Agentic Execution (Claude Code), and Inline Autocomplete (Codex)—all powered entirely 100% offline via local LLM instances utilizing the Ollama API layer.

```text
 ┌──────────────────────────────────────┐  ┌──────────────────────────────────────┐
 │          1. CONTEXT CHAT             │  │      2. EXECUTIVE CONTROL CENTER     │
 ├──────────────────────────────────────┤  ├──────────────────────────────────────┤
 │ 👤 User: Migrate auth-helper.js      │  │ CONNECTION STATUS: 🟢 localhost:11434│
 │                                      │  │                                      │
 │ 🤖 HermesForge:                      │  │ [ ACTIVE SELECTED MISSIONS ]         │
 │    Understood. Booting the Legacy    │  │ ┌──────────────────────────────────┐ │
 │    Migrator persona...                │  │ │ 🔄 JS-to-TS Legacy Migrator      │ │
 │                                      │  │ ├──────────────────────────────────┤ │
 │    [1] Isolate modules.              │  │ │ ⚡ Algorithmic Bottleneck Auditor│ │
 │    [2] Synthesize Type Interfaces.  │  │ ├──────────────────────────────────┤ │
 │    [3] Compile Unit Tests.           │  │ │ 🧪 Hardware Speed Benchmark     │ │
 │                                      │  │ ├──────────────────────────────────┤ │
 │ 🟢 SUCCESS: src/auth-helper.ts       │  │ │ 📦 Differential Git PR Builder   │ │
 │             src/auth-helper.test.ts  │  │ └──────────────────────────────────┘ │
 └──────────────────────────────────────┘  └──────────────────────────────────────┘
```

---

## 🏗️ Core Architecture & Optimizations

We built HermesForge with a strict focus on preserving consumer GPU memory and reducing latency. 

### 1. HTTP Keep-Alive Pipeline
Local inference often suffers from TCP handshake latency loop delays. We use persistent `http.Agent` instances with `keepAlive: true` and `keepAliveMsecs: 1000` to maintain an evergreen connection socket with Ollama.

### 2. AbortController Connection Slicing
In highly responsive elements like Inline Autocomplete, keystrokes occur faster than a local model can process them. HermesForge actively hooks into VS Code's `CancellationToken`. When a user breaks an autocomplete prediction by typing another character, an `AbortSignal` forces the Node.js `req.destroy()` method, destroying the background HTTP stream. **This prevents ghost inference streams from silently continuing to eat GPU VRAM and stalling the main inference queue.**

### 3. AST-Driven Structural Contexts
Instead of blind context-injection, our Agent Engine uses `vscode.executeDocumentSymbolProvider`. It recursively injects an AST (Abstract Syntax Tree) representation of the active file (Classes, Methods, Variables) into the LLM system prompt, granting high-tier structural metadata without blowing up the context window. 

### 4. Interceptor Security Bridge
The Agent Engine creates a tight loop capable of editing code and running bash commands via `child_process`. We've built an interception membrane: every single shell command (`executeCommand`) stops execution and renders a modal VS Code warning (`vscode.window.showWarningMessage`). The loop only proceeds if the user explicitly approves the command, preventing catastrophic accidental deletions (`rm -rf`).

---

## 🛠 Model Routing Configuration Settings

Customize connection URLs, context heights, or model candidates dynamically inside VS Code Settings (`Cmd+,` > Search for `HermesForge`):

| Setting Key | Default Value | Description |
| :--- | :--- | :--- |
| `hermes-forge.ollamaBaseUrl` | `http://localhost:11434` | The target local URL address running Ollama. |
| `hermes-forge.modelCompletion` | `qwen2.5-coder:1.5b` | Ultra-low latency model utilized for rapid inline autocompletion. |
| `hermes-forge.modelChat` | `hermes3:8b` | Strong reasoning model used for chat conversations and multi-agent systems. |

---

## 🚀 Specialized AI Missions (Bento Actions)

Our specialized missions can be triggered instantly from the **Executive Control Dashboard** located in the sidebar panel:

### 🔄 JavaScript-to-TypeScript Migrator
Saves hours of refactoring by converting untyped legacy Javascript code into fully-typed TS modules.
- Generates clean types, interfaces, and function signatures.
- Automatically creates companion `vitest` unit-test files next to the migrated code.
- Runs verification compilation loops using `VerificationEngine` for error self-healing.

### ⚡️ Algorithmic Bottleneck Auditor
Scans the active editor document for time/space complexity vectors, memory leaks, and performance thrashes.
- Details complexity shifts (e.g. optimizing $O(N^2)$ down to $O(N)$).
- Flags unclosed event listeners or streams and offers optimized refactored alternatives inside `PERF_AUDIT.md`.

### 🧪 Hardware Speed Benchmark
Profiles your hardware compute capabilities by running localized streaming speed tests against your local Ollama connection.
- Measures tokens processing speed (Words Per Second).
- Calculates latency to Time-To-First-Token (TTFT) in milliseconds.
- Detects host memory size to assign compute worker allocations automatically.

### 📦 Differential Git PR Builder
Inspects current git states dynamically to compile release metadata.
- Outputs standardized, professional Conventional Commit statements.
- Drafts descriptive summaries for pull requests and updates `CHANGELOG.md` automatically.
- Gated securely behind hard resets to enable safe one-click rollbacks of workspace experiments.

---

## 🛠 Troubleshooting Matrix

Developing with local models can sometimes have hardware-level bottlenecks. Consult this matrix for common offline infrastructure states:

| Error State | Diagnosis | Solution |
| :--- | :--- | :--- |
| **Silent Autocomplete & Chat hangs** | The local `OllamaClient` cannot reach `http://localhost:11434`. Connection refused. | Open terminal and run `ollama serve` or ensure the Ollama app is actively open in your background tray. |
| **High Latency / Slow TTFT (Time-To-First-Token)** | Hardware limits handling the `hermes3:8b` or `qwen2.5-coder:1.5b` weights (often non-Nvidia / non-Apple Silicon environments). | Check the Output window for `HermesForge Core`. If TTFT is > 900ms, use a tighter model: Replace `hermes3:8b` with `llama-3.2:3b`. |
| **Agent Execution Returns "Permission Denied"** | The child process lacks the structural permissions to run a specific command or output in a specific directory. | Check your active VS Code `.workspace` file permissions. If attempting globally elevated commands, they will fail due to the Security Bridge sandbox. |

---

## 📦 Packaging & Installation (.vsix)

Ready to use HermesForge daily across all your workspaces without running a debugger window? You can compile the repository into a standalone `.vsix` bundle and side-load it into your main VS Code instance.

### 1. Packaging Commands
Compile your workspace into a deployable package. Run this inside the project root:
```bash
npm install
npm run build
npx @vscode/vsce package --no-dependencies
```
*(This will generate a file named `hermes-forge-1.0.0.vsix` in your folder).*

### 2. Sideload into VS Code
You can install this packaged bundle directly into VS Code via the CLI:
```bash
code --install-extension hermes-forge-1.0.0.vsix
```
Alternatively, in VS Code:
1. Open the **Extensions** view (`Cmd+Shift+X`).
2. Click the `...` menu in the top-right corner of the Extensions menu.
3. Select **Install from VSIX...**
4. Choose your generated `hermes-forge-1.0.0.vsix`.

_Now you can close your development window and hit `Cmd+Shift+P > HermesForge: Run Local Agent` in any project!_

---

## 🧑‍💻 Advanced Integrations & External Tool Hook-ins

HermesForge is built to be a server-authoritative hub for all your offline coding tools.

### 1. EasyTutor Offline Assistant
We provide a standalone educational tutor utility loop located in `scripts/demo_easytutor.js`. It queries the local HermesForge OpenClaw Server Node (at port `11435`) to securely extract the developer's working context and generates local training sheets:
- **Run the tutor**: Ensure `nodeEnabled` is true in settings, and run:
  ```bash
  node scripts/demo_easytutor.js
  ```
- EasyTutor will download code snippets via the bridge, run reflection assessments through Ollama, and save the resulting tutorial workbook at `.telemetry/easytutor_lesson.md`.

### 2. Exporting Workspace Context for External Agents
Want to feed your entire, clean workspace codebase directly into larger offline agent chains like AutoGen, LangGraph, or local DeepSeek pipelines? 
- Use the command **`HermesForge: Export Workspace Context for External Agents`** (`hermes-forge.exportContext`).
- This command crawls the directories, filters out binaries and node dependencies, reads the text entries, and packages them into a beautifully structured, offline-safe JSON context index saved at `.telemetry/project_context.json`.

---

## 💎 Premium Tier & Open-Source Sponsorship

HermesForge is built by developers, for developers under the **MIT License**. We guarantee that core autocomplete, local agentic execution loops, and benchmark gauges will remain free and fully offline forever.

To support rapid engineering cycles, we offer two premium opt-in configurations that you can toggle directly in the **Executive Control Dashboard**:
1. **Cloud Fallback Model**: Uses low-cost, secure proxy endpoints to model completions in high-concurrency environments when your local memory capacity hits peak thread thresholds.
2. **Advanced Semantic RAG**: Boosts prompt intelligence using local embedding models to retrieve relevant files across your entire project workspace.

### 💖 Sponsorship & Donation Nodes
Support privacy-first developers and help finance the local AI revolution!
- [Support us on GitHub Sponsors](https://github.com/sponsors/hermesforge-studios)
- [Back the project via Buy Me A Coffee](https://buymeacoffee.com/hermesforge)

---

## 🗺️ Product Roadmap v1.x

- [x] Multi-agent task planning loops with self-healing (Sprint v1.0).
- [x] OpenClaw JSON-RPC / REST bridge node on `:11435`.
- [x] Fast token benchmarking & speed gauge integrations.
- [ ] Local semantic search vector store database (Chrome SQLite Vector Ext).
- [ ] Fine-tuned ultra-small autocomplete weights (700M parameters) package.

---

*HermesForge — Your codebase, your rules, 0 bits sent to the cloud.*
