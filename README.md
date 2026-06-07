# HermesForge ⚡️

**An ultra-fast, fully offline, privacy-first AI IDE extension for VS Code.**

HermesForge merges the capabilities of real-time Context Chat (Cursor), Agentic Execution (Claude Code), and Inline Autocomplete (Codex)—all powered entirely 100% offline via local LLM instances utilizing the Ollama API layer.

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

## 🛠 Troubleshooting Matrix

Developing with local models can sometimes have hardware-level bottlenecks. Consult this matrix for common offline infrastructure states:

| Error State | Diagnosis | Solution |
| :--- | :--- | :--- |
| **Silent Autocomplete & Chat hangs** | The local `OllamaClient` cannot reach `http://localhost:11434`. Connection refused. | Open terminal and run `ollama serve` or ensure the Ollama app is actively open in your background tray. |
| **High Latency / Slow TTFT (Time-To-First-Token)** | Hardware limits handling the `hermes3:8b` or `qwen2.5-coder:1.5b` weights (often non-Nvidia / non-Apple Silicon environments). | Check the Output window for `HermesForge Core`. If TTFT is > 900ms, use a tighter model: Replace `hermes3:8b` with `llama-3.2:3b`. |
| **Agent Execution Returns "Permission Denied"** | The child process lacks the structural permissions to run a specific command or output in a specific directory. | Check your active VS Code `.workspace` file permissions. If attempting globally elevated commands, they will fail due to the Security Bridge sandbox. |

---

## 🚀 Sprint Roadmap

Our current sprint establishes the local-first abstraction layer.

- [x] **Inline Autocomplete Module**: Integrated Qwen-2.5-Coder Fill-In-The-Middle (FIM) formatting with AbortController slicing.
- [x] **Sidebar Context Chat**: Webview-based bridging with real-time UI streaming and TextSelection scope injection.
- [x] **Agentic Terminal Engine**: Hermes-3-based loop with strictly defined JSON Tool Calls (`readFile`, `writeFile`, `executeCommand`).
- [x] **Interactive Safety Gates**: Prompt-to-Execute interception module stopping dangerous bash commands.
- [x] **TTFT Telemetry Logging**: Ultra-clean local performance measurement bypassing VS Code's analytics engine.
- [x] **Agentic File-Tree RAG (Sprint 4)**: Vector-db-less retrieval by having the Agent recursively crawl file dependencies.
- [x] **Multi-Agent Deliberation (Sprint 5)**: Having a router agent allocate tasks dynamically to a small FIM model vs a deep reasoning model based on context.

---

## 🧠 Intelligent Model Routing Architecture

To maximize local hardware performance and prevent GPU memory exhaustion, HermesForge utilizes a dynamic deliberation router:
1. **Zero-Latency Orchestration**: Upon submission, the `AgentRouter` classifies the user's prompt by evaluating natural language intent in under 10ms.
2. **Qwen-2.5-Coder (1.5B) for Quick Edits**: Simple requests like "autocomplete this line" or "fix syntax typo" are instantly delegated to the lightning-fast 1.5B parameters model.
3. **Hermes-3 (8B) for Logic & Agents**: Deep logic questions and complex refactors trigger the heavier 8B reasoning models. If an execution loop is requested (such as writing several files or running terminal commands), the router offloads the task into the background `AgentEngine` loop, freeing up the frontend UI thread.

---

## 📦 Packaging & Installation (.vsix)

Ready to use HermesForge daily across all your workspaces without running a debugger window? You can compile the repository into a standalone `.vsix` bundle and side-load it into your main VS Code instance.

### 1. Install VSCE (VS Code Extension Manager)
Run this command to install the official Microsoft CLI utility globally:
```bash
npm install -g @vscode/vsce
```

### 2. Package the Extension
Compile your workspace into a deployable package. Run this inside the project root:
```bash
npm install
npm run build
vsce package --no-dependencies
```
*(This will generate a file named `hermes-forge-1.0.0.vsix` in your folder).*

### 3. Sideload into VS Code
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

*HermesForge — Your codebase, your rules, 0 bits sent to the cloud.*
