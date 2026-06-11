# 🧠 HermesForge: Multi-Agent Collaboration Engine

HermesForge executes complex features offline through a multi-agent assembly pipeline. Instead of relying on a single monolithic prompt, tasks are split and executed sequentially by specialized, AST-insulated personas.

---

## 🏛️ 1. The Multi-Agent Council

Four core personas coordinate systematically on every "Mission Control" or agent task:

```
[User Goal]
     │
     ▼
┌──────────────┐
│  Architect   │ ──► Map structural directories and files paths to modify
└──────────────┘
     │
     ▼
┌──────────────┐
│      PM      │ ──► Parse requirements and define strict Checklist tasks
└──────────────┘
     │
     ▼
┌──────────────┐
│   Engineer   │ ──► Write non-ellided code blocks with strong TS typing
└──────────────┘
     │
     ▼
┌──────────────┐
│  QA Auditor  │ ──► Inspect compilation, run linter, and trigger self-healing
└──────────────┘
```

### 🏛️ Chief Architect (Structural Design)
- **Role**: Explores file-tree contexts and establishes structural guidelines.
- **Goals**: Map directory scopes, list required new/existing files, and draft file outline definitions.

### 📋 Product Manager (Requirements Isolation)
- **Role**: Refines code architectures into concrete insulated checklists.
- **Goals**: Prevent out-of-scope code leaks, enforce API types, and define strict success boundaries.

### 💻 Principal Engineer (Code Generation)
- **Role**: Translates specification lists into production-ready TypeScript code.
- **Goals**: Return complete lines without ellipses (`...`), parse AST typings, and maintain exact logic models.

### 🛡️ QA Auditor (Compilation & Self-Healing Safeguards)
- **Role**: Validates compiler and linter results against codebases.
- **Goals**: Parse compiler trace reports, isolate AST error scopes, query Ollama for self-healing, and rollback files on timeout.

---

## ⚡️ 2. Advanced Specialized Personas

Beyond the core orchestrator pipeline, HermesForge embeds three on-demand professional missions:

### 🔄 Legacy Javascript to TypeScript Migrator
Converts legacy, untyped Javascript modules to strict TypeScript models.

- **How it Works**:
  1. Parses legacy AST patterns and infers custom types and interface variables.
  2. Modifies module structures (such as `CommonJS` to `ESM`).
  3. Formulates specialized `vitest` unit tests.
  4. Runs targeted TypeScript compiler health evaluations on the result.

### ⚡️ Micro Performance Bottleneck Scorer
Scans active files for algorithmic complexity spikes, memory leaks, and GC overhead thrashes.

- **How it Works**:
  1. Computes mathematical Big-O scores of active documents.
  2. Spies out double-loop hazards, uncleared timer subscriptions, or synchronous blocking calls.
  3. Renders clean, refactored alternatives in the user's workspace as `PERF_AUDIT.md`.

### 📦 Differential Git Pull Request Developer
Integrates with localized git structures to automate release commits safely.

- **How it Works**:
  1. Aggregates status and diff output from `git diff`.
  2. Uses Ollama to compose standard Conventional Commit messages and CHANGELOG notes.
  3. Provides an interactive rollback gate to discard edits if compilation fails.

---

## 🚀 3. Multi-Agent Workflows: Complete Examples

### Scenario A: Adding a Local Encryption Helper
*Promptentered in Dashboard Terminal:*
> "Create a secure workspace encryption utility using Node.js crypto module."

1. **Architect Planning**:
   - Maps path: `src/utils/CryptoHelper.ts`
   - Defines exports: `encrypt(data: string): string`, `decrypt(cipher: string): string`
2. **PM Checklist**:
   - Tasks: Include IV parameter initialization, use AES-256-GCM, handle base64 inputs securely, check for empty values.
3. **Engineer Generation**:
   - Generates complete file contents in `CryptoHelper.ts` with no missing code blocks.
4. **QA Auditor Check**:
   - Runs `npm run lint` or `npx tsc`. If a type failure is spotted (e.g. key length mismatches), the self-healing cycle corrects it automatically.

### Scenario B: Migrating a legacy Node.js Express route
*Clicking 🔄 JS to TS Migrator inside a dirty JS file:*

```typescript
// Input (legacy.js)
const express = require('express');
const router = express.Router();
router.get('/user', (req, res) => {
    res.json({ id: req.query.id || 1 });
});
module.exports = router;
```

*Output generated after Migration Agent run (legacy.ts):*

```typescript
import { Router, Request, Response } from 'express';

interface UserQuery {
    id?: string;
}

const router = Router();

router.get('/user', (req: Request<{}, {}, {}, UserQuery>, res: Response) => {
    const id = req.query.id ? parseInt(req.query.id, 10) : 1;
    res.json({ id });
});

export default router;
```

*And the corresponding companion test suite written next to it (legacy.test.ts):*

```typescript
import { describe, it, expect } from 'vitest';
// Test assertions formulated...
```
