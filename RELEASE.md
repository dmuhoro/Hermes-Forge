# 🚀 HermesForge v1.0.0 Official Release Guide

Welcome to the official launch of **HermesForge v1.0.0**—the 100% offline-first AI suite for Visual Studio Code. This document outlines the official packaging, sideloading instructions, recommended configurations, and first-use checklists.

---

## 📦 1. Sideloading & Installation

Sideloading lets you install HermesForge natively in your day-to-day VS Code editor without needing to run it in a developer/debug mode.

### Option A: Direct Command-Line Installation (Fastest)

If you have VS Code installed in your system PATH (the `code` CLI tool):

1. **Package the `.vsix` bundle** inside this workspace root:
   ```bash
   npx @vscode/vsce package --no-dependencies
   ```
2. **Install the generated bundle** directly from your terminal:
   ```bash
   code --install-extension hermes-forge-1.0.0.vsix
   ```
3. Restart or reload VS Code (`Developer: Reload Window` from Command Palette).

### Option B: Graphic Interface Installation (GUI)

If you configure extensions manually through the VS Code UI:

1. Package the extension using `npx @vscode/vsce package --no-dependencies`.
2. Open your daily **VS Code** app.
3. Bring up the Extensions View (shortcut: `Cmd+Shift+X` on Mac / `Ctrl+Shift+X` on Windows/Linux).
4. Click the three dots Context Menu (`...`) in the top-right corner of the Extensions Sidebar.
5. Choose **Install from VSIX...** in the dropdown.
6. Browse and select your newly built `hermes-forge-1.0.0.vsix` file.
7. Accept the verification message and reload the VS Code workspace.

---

## 🚦 2. First-Use Walkthrough

To ensure a seamless local AI experience, verify your hardware environment and follow this step-by-step checklist:

### Step 1: Initialize Ollama Serving Node
HermesForge depends entirely on Ollama for local LLM requests.
- Launch your native desktop Ollama client, or run this in a terminal window:
  ```bash
  ollama serve
  ```
- To test if the local port is successfully listening, navigate to `http://localhost:11434` or execute:
  ```bash
  curl http://localhost:11434
  ```

### Step 2: Download Optimized Weights
We recommend downloading the lightweight coder models inside your terminal:
```bash
# Low-latency inline suggestions (1.5 Billion parameters)
ollama pull qwen2.5-coder:1.5b

# Highly capable chat and multi-agent persona planner (8 Billion parameters)
ollama pull hermes3:8b
```

### Step 3: Configure Settings in VS Code
1. Open VS Code Settings using shortcut `Cmd+,` (or `Ctrl+,`).
2. Search for `HermesForge` in the search bar.
3. Review your configured settings:
   - **Ollama Base Url**: `http://localhost:11434`
   - **Model Completion**: `qwen2.5-coder:1.5b`
   - **Model Chat**: `hermes3:8b`
   - **Node Port**: `11435`
   - **Node Enabled**: `true` (boots the local OpenClaw-compatible bridge)

### Step 4: Fire Up Inline Completion
- Open any source code file (e.g., `test.ts` or `App.jsx`).
- Place your cursor and write an empty function signature:
  ```typescript
  // Find the maximum value in an array of numbers
  function findMax(nums: number[]): number {
  ```
- Pause for a fraction of a second—Ghost Text containing suggestions will appear! Press `Tab` to automatically insert.

### Step 5: Execute Sidebar Actions
- Choose the Robot icon in your VS Code primary sidebar array.
- Open the **Context Chat** view to ask questions about your active codebase.
- Toggle open the **Executive Control Center** to run specialized multi-agent developer tasks offline.

---

## 🧪 3. Offline Verification Tests

You can run automated, localized verification scenarios to guarantee 100% integrity of all system paths and modules:

```bash
# Verify ESLint syntax cleanliness and TypeScript compiles cleanly
npm run lint

# Execute full suite of isolated Unit and Integration tests
npm test
```

All 20+ tests should report complete pass metrics across `OllamaClient`, `LegacyMigrator`, `PerformanceAuditor`, `CrashShield`, and `OpenClawBridge`!

---

## 🛡️ 4. Local Troubleshooting & Failure Recovery

| Issue | Root Cause | Immediate Action |
| :--- | :--- | :--- |
| **Silent Autocomplete** | Ollama background server is offline or busy. | Run `ollama list` in terminal to check if models are loaded. Make sure `ollama serve` is running. |
| **High GPU RAM Spikes** | Leftover ghost requests from rapid keyboard typing. | HermesForge includes built-in `AbortController` cancellation. If your custom IDE model lacks connection slicing, switch settings to `qwen2.5-coder:1.5b` to prevent hardware exhaustion. |
| **Slow Streaming Responses** | Model file is too heavy for host system Unified Memory. | Replace `hermes3:8b` in your Settings with lighter weights like `llama3.2:3b`. |
| **"Failed to start OpenClaw Bridge"** | Port `11435` is already in use by another server. | Modify `hermes-forge.nodePort` inside VS Code settings to an unused port like `11439`. |

---

*Enjoy developer autonomy with 100% local, high-performance private AI coding assistant pipelines!*
