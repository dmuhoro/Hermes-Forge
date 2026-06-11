# Contributing to HermesForge ⚡️

Thank you for your interest in contributing to HermesForge! We are thrilled to collaborate with you to build the fast, offline-first developer assistant ecosystem.

Since HermesForge operates strictly 100% offline and features a highly structured **Multi-Agent Council** and **Executive Orchestrator**, we require all contributions to meet rigorous quality, type safety, and testing standards.

---

## 🏛️ Development Philosophy & Architecture

Our design principles focus on raw utility, consumer safety, and low latency:
1. **100% Offline Integrity**: No contribution shall introduce remote network calls (e.g. cloud fallbacks, tracking telemetry, telemetry trackers, or external APIs) unless explicitly configured as safe, toggleable premium opt-ins.
2. **Strict Type Safety**: Treat the TypeScript compiler as your friend. Absolutely zero implicit `any` coordinates, unused imports, or broken enums.
3. **AST Awareness**: All structural context-injection must use native VS Code document symbols rather than lines matching strings to preserve contextual integrity.

---

## 🚀 Step-by-Step Workflow for Contributors

We follow a modular approach to ensure clean, runnable software:

### 1. Repository Setup
1. Clone your fork of HermesForge.
2. Spin up your local Ollama instance (`ollama serve`) and pull the default models:
   ```bash
   ollama pull qwen2.5-coder:1.5b
   ollama pull hermes3:8b
   ```
3. Run package installations in the workspace:
   ```bash
   npm install
   ```

### 2. Implementing Changes
- Enclose your additions in modular service folders inside `src/services` or UI adapters in `src/modules`.
- Expose commands elegantly via standard VS Code registries in `src/extension.ts`.

### 3. Verification & Quality Gates
Before opening a Pull Request (PR), your code **must** pass all verification gates:
- **Lint check**: Run `npm run lint` and verify there are **zero (0) errors**.
- **Automatically mend issues**: Use `npm run lint:fix` to auto-format syntax styling.
- **Unit Testing**: Run `npm test` and double-check that all core integrations parse with successful assertions.
- **VSIX Compilation**: Pack the VS Code bundle locally (`npm run build`) to ensure the production bundler (esbuild) compiles cleanly.

---

## 🧪 Registering Companion Unit Tests
If you develop a new service or engine module, write companion tests inside `/src/__tests__/`. We use **Vitest** as our unit-testing framework because it is incredibly fast and operates beautifully offline.

Run active test suites during development:
```bash
npx vitest run
```

---

## 🤝 Code of Conduct & Submissions
- Be professional, welcoming, and objective.
- Keep your commits descriptive under the **Conventional Commit specification** (e.g., `feat(bridge): add json-rpc compatibility with OpenClaw`).

Let's maintain extreme performance and absolute privacy!
