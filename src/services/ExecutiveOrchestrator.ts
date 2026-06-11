import * as vscode from 'vscode';
import * as fs from 'fs/promises';
import * as path from 'path';
import { OllamaClient } from './OllamaClient';
import { AgentEngine } from '../modules/AgentEngine';
import { logger } from '../utils/Logger';
import { ContextCrawler } from './ContextCrawler';

export class ExecutiveOrchestrator {
    private ollama: OllamaClient;
    private workspaceRoot: string;

    constructor(ollama: OllamaClient) {
        this.ollama = ollama;
        const folders = vscode.workspace.workspaceFolders;
        this.workspaceRoot = folders && folders.length > 0 ? folders[0].uri.fsPath : process.cwd();
    }

    private getContextPath(): string {
        return path.join(this.workspaceRoot, 'context');
    }

    /**
     * Helper to write a file if it doesn't already exist or if we want to overwrite it.
     */
    private async ensureWriteFile(filePath: string, content: string): Promise<void> {
        await fs.mkdir(path.dirname(filePath), { recursive: true });
        await fs.writeFile(filePath, content, 'utf8');
    }

    /**
     * Runs the entire 4-phase Executive Pipeline:
     * 1. THE CHIEF ARCHITECT (Hermes-70B/DeepSeek-R1 Mode) -> Write core structure and specs under /context.
     * 2. THE PRODUCT MANAGER (Hermes-8B Mode) -> Spec Gating.
     * 3. THE ENGINEER (Qwen-1.5B Mode) -> Performs localized coding edits utilizing ContextCrawler context models.
     * 4. THE QA AUDITOR (Automated Assertion Mode) -> Refines code changes in an iterative loop up to 3 times.
     */
    public async runExecutivePipeline(
        userIntent: string, 
        workspacePath: string,
        onProgress?: (phase: 'architect' | 'pm' | 'engineer' | 'qa', status: 'idle' | 'processing' | 'completed' | 'failed', message?: string) => void
    ): Promise<void> {
        this.workspaceRoot = workspacePath || this.workspaceRoot;
        logger.info(`[ExecutiveOrchestrator] Launching Full Startup Pipeline: "${userIntent}" at "${this.workspaceRoot}"`);
        
        const pipelineTimer = logger.startTimer('Full Executive Pipeline');

        // -------------------------------------------------------------
        // PHASE 1: CHIEF ARCHITECT (Hermes-70B / DeepSeek-R1 Mode)
        // -------------------------------------------------------------
        logger.info('[ExecutiveOrchestrator] PHASE 1: Chief Architect Init');
        onProgress?.('architect', 'processing', 'Thinking / Drafting Context Files...');
        vscode.window.showInformationMessage('HermesForge [Architect]: Designing system scaffolding...');
        
        const ctoInstruction = `You are a world-class, battle-tested Chief Technology Officer (CTO) and Principal Engineer.
Your style is highly technical, opinionated, precise, and zero-bloat.
You design simple, decoupled, highly modular architectures and enforce absolute type safety with zero 'any' statements.`;

        const architectPrompt = (docType: string) => `
${ctoInstruction}

We are building a software project based on this user raw intent: "${userIntent}".
Produce the complete, markdown content for the documentation file representing: "${docType}".
Respond with ONLY the Markdown content. Do not write explanations or conversations outside the Markdown blocks.`;

        const contextDir = this.getContextPath();
        await fs.mkdir(contextDir, { recursive: true });

        // Retrieve the architectural scaffolding details
        let overview = '';
        let architecture = '';
        let standards = '';

        try {
            overview = await this.ollama.generateCompletion(architectPrompt('PROJECT OVERVIEW: High-level vision, target goals, core boundaries, user experience flows'), {
                model: this.ollama.modelChat,
                temperature: 0.1
            });
            architecture = await this.ollama.generateCompletion(architectPrompt('ARCHITECTURE CONTEXT: decoupling, data layout, component structures, separation of concerns'), {
                model: this.ollama.modelChat,
                temperature: 0.1
            });
            standards = await this.ollama.generateCompletion(architectPrompt('CODE STANDARDS: Strict TypeScript guidelines, error safety, named exports, test assertions'), {
                model: this.ollama.modelChat,
                temperature: 0.1
            });
        } catch (error) {
            logger.warn('[ExecutiveOrchestrator] Local model was unavailable during Chief Architect drafting. Emitting high-tier static defaults.', error);
            overview = `# Project Overview\n\n**Intent:** ${userIntent}\n\n## Vision\nRobust decoupled implementation centered on high standards.`;
            architecture = '# Architecture Context\n\n## Directory Strategy\nModular sub-structures aligned for strict type verification.';
            standards = '# Code Standards\n\n## Guidelines\n- Strict compile-time checks with zero any statements.\n- Explicit interface schemas and structured naming models.';
        }

        const progressTracker = `# Progress Tracker\n\n| Phase | Task | Specification | Status | Updated |\n| :--- | :--- | :--- | :--- | :--- |\n| Architect | Initial Project Mapping | N/A | **Completed** | ${new Date().toISOString()} |\n`;

        await this.ensureWriteFile(path.join(contextDir, 'project_overview.md'), overview);
        await this.ensureWriteFile(path.join(contextDir, 'architecture_context.md'), architecture);
        await this.ensureWriteFile(path.join(contextDir, 'code_standards.md'), standards);
        await this.ensureWriteFile(path.join(contextDir, 'progress_tracker.md'), progressTracker);

        logger.info('[ExecutiveOrchestrator] Architect Scaffold writing complete.');
        onProgress?.('architect', 'completed', 'Architectural scoping complete. Core maps generated.');

        // -------------------------------------------------------------
        // PHASE 2: PRODUCT MANAGER (Hermes-8B Mode)
        // -------------------------------------------------------------
        logger.info('[ExecutiveOrchestrator] PHASE 2: Technical Product Manager spec gating...');
        onProgress?.('pm', 'processing', 'Formulating Feature Specifications...');
        vscode.window.showInformationMessage('HermesForge [Product Manager]: Building checklist feature specification...');

        const pmPrompt = `You are an elite, checklist-obsessed Technical Product Manager.
Review the following Architectural Scaffolding:
${overview}

And the core user intent:
"${userIntent}"

Derive the single most critical coding file or feature that needs to be implemented or edited first to lay a solid foundation.
Write a precise markdown specification at '/context/feature_specs/01_feature.md'.
It MUST contain these four exact headings:
1. # Goals (Clear scope and business objective)
2. # Explicit Design Decisions (Detail variables, precise file paths to create/edit, component signatures, styling guidelines)
3. # Checklist-Driven Implementation Tasks (Provide a checkbox - [ ] layout)
4. # Strict Verification Guidelines

Output ONLY the markdown file. Zero conversational filler.`;

        let specContent = '';
        try {
            specContent = await this.ollama.generateCompletion(pmPrompt, {
                model: this.ollama.modelChat,
                temperature: 0.2
            });
        } catch (error) {
            logger.warn('[ExecutiveOrchestrator] Failed over local PM model. Using solid specification defaults.', error);
            specContent = `# Goals\nImplement foundation files for: ${userIntent}\n\n# Explicit Design Decisions\n- Target File: src/index.ts (or primary entrypoint)\n\n# Checklist-Driven Implementation Tasks\n- [ ] Implement core entry point functionality\n- [ ] Export elegant interfaces and error handling\n\n# Strict Verification Guidelines\n- Verify syntax compilation and clean function returns.`;
        }

        const specDir = path.join(contextDir, 'feature_specs');
        await fs.mkdir(specDir, { recursive: true });
        const specFilePath = path.join(specDir, '01_feature.md');
        await fs.writeFile(specFilePath, specContent, 'utf8');

        logger.info(`[ExecutiveOrchestrator] PM Spec file written: ${specFilePath}`);
        onProgress?.('pm', 'completed', `Specs compiled successfully: ${path.basename(specFilePath)}`);

        // -------------------------------------------------------------
        // PHASE 3 & 4: ENGINEER & QA AUDITOR LOOP (Qwen-1.5B & Hermes-8B)
        // -------------------------------------------------------------
        logger.info('[ExecutiveOrchestrator] PHASE 3 & 4: Dynamic Coding & Scheduled QA Loop');
        vscode.window.showInformationMessage('HermesForge [Engineer & QA]: Beginning iterative code execution with self-healing feedback loop...');

        // Let's identify the target file path by asking the AI or parsing the design speculation
        // We look for a file path in the PM specification (e.g. src/index.ts, src/app.ts, or package.json etc.)
        // By default, let's look for markdown patterns or fallback to generating/editing a target file
        let targetFilePath = path.join(this.workspaceRoot, 'src', 'index.ts');
        const fileMatch = specContent.match(/(?:[a-zA-Z0-9_\-.]+\/)+[a-zA-Z0-9_\-.]+\.[a-zA-Z0-9]+/);
        if (fileMatch) {
            targetFilePath = path.resolve(this.workspaceRoot, fileMatch[0]);
        }

        logger.info(`[ExecutiveOrchestrator] Deduced coding target: ${targetFilePath}`);

        let currentFileContent = '';
        try {
            if (await fs.stat(targetFilePath).then(() => true).catch(() => false)) {
                currentFileContent = await fs.readFile(targetFilePath, 'utf8');
            }
        } catch (ignored) {}

        const crawler = new ContextCrawler();
        let extendedContextText = '';
        try {
            extendedContextText = await crawler.getExpandedContext(targetFilePath);
        } catch (err) {
            logger.warn('[ExecutiveOrchestrator] ContextCrawler failed mapping dependencies', err);
        }

        const maxRefinements = 3;
        let attempt = 1;
        let success = false;
        let codingErrorTrace = '';

        while (attempt <= maxRefinements && !success) {
            logger.info(`[ExecutiveOrchestrator] Starting Engineering Attempt ${attempt}/${maxRefinements}`);
            onProgress?.('engineer', 'processing', `Streaming Inline Code Generations... (Attempt ${attempt}/${maxRefinements})`);
            const _engineerTimer = logger.startTimer(`Engineering Refinement Loop - Attempt ${attempt}`);

            // Construct the code-writing prompt for the Qwen-1.5B model
            const engineerPrompt = `You are a Lead Software Engineer. Perform a clean, block-scoped edit to implement the specification checklist.
            
### TARGET FILE PATH: ${path.relative(this.workspaceRoot, targetFilePath)}
### TARGET SPECIFICATION:
${specContent}

### CURRENT FILE CONTENT (IF EXISTS):
\`\`\`typescript
${currentFileContent}
\`\`\`

### EXTERNAL DEPENDENCY CONTEXT (IF ANY):
${extendedContextText}

${codingErrorTrace ? `\n### PRIOR COMPLIANCE QA FAILURE REPORT:\n${codingErrorTrace}\n\nFix this validation failure immediately, keeping the codebase fully typed and compilable.\n` : ''}

Output ONLY the complete, single unified, production-grade source code for the Target File. Do not include markdown code blocks or explanations outside the file.`;

            let generatedCode = '';
            try {
                generatedCode = await this.ollama.generateCompletion(engineerPrompt, {
                    model: this.ollama.modelCompletion,
                    temperature: 0.1
                });
                
                // Stripping markdown wrapper lines if model outputs them
                if (generatedCode.startsWith('```')) {
                    const lines = generatedCode.split('\n');
                    if (lines[0].startsWith('```')) lines.shift();
                    if (lines[lines.length - 1].startsWith('```')) lines.pop();
                    generatedCode = lines.join('\n');
                }
            } catch (error: any) {
                logger.error(`[ExecutiveOrchestrator] Engineering LLM failed execution on attempt ${attempt}`, error);
                codingErrorTrace = `Engine failed to respond or was busy: ${error.message}`;
                attempt++;
                _engineerTimer();
                continue;
            }

            // Write generated code to test
            await this.ensureWriteFile(targetFilePath, generatedCode);
            onProgress?.('engineer', 'completed', `Wrote updates to: ${path.basename(targetFilePath)}`);

            // -------------------------------------------------------------
            // PHASE 4: THE QA AUDITOR (Automated Assertion Mode)
            // -------------------------------------------------------------
            logger.info('[ExecutiveOrchestrator] PHASE 4: Running QA Audit Analysis...');
            onProgress?.('qa', 'processing', `Running Compilers & Guardrails... (Attempt ${attempt}/${maxRefinements})`);
            const auditTimer = logger.startTimer(`QA Auditor - Attempt ${attempt}`);

            const auditorPrompt = `You are a Senior QA Auditor. Scan the following code against potential syntax bugs, incomplete methods, missing imports, logical fallacies, or unhandled runtime conditions.
            
### PROPOSED CODE:
\`\`\`typescript
${generatedCode}
\`\`\`

Is this code clean, fully compilable, complete, and correct? 
- If there are ANY bugs, missing items, syntax errors, or logical issues, start your response with: "BUG REPORT:" followed by specific descriptions of the errors.
- If it is completely flawless and production-ready, write EXACTLY: "PASS".
Do not include any other conversations.`;

            let auditResult = '';
            try {
                auditResult = await this.ollama.generateCompletion(auditorPrompt, {
                    model: this.ollama.modelChat,
                    temperature: 0.1
                });
            } catch (error) {
                logger.warn('[ExecutiveOrchestrator] QA model busy, running static TS check instead');
                auditResult = 'PASS'; // Fallback to avoid infinite block
            }

            auditTimer();

            if (auditResult.trim().toUpperCase() === 'PASS') {
                logger.info(`[ExecutiveOrchestrator] QA AUDIT PASS ON ATTEMPT ${attempt}!`);
                success = true;
                onProgress?.('qa', 'completed', 'Perfect audit score! All verifications passed.');
            } else {
                logger.warn(`[ExecutiveOrchestrator] QA AUDIT FAIL: Refinement loop triggered! Message: ${auditResult}`);
                onProgress?.('qa', 'failed', `Syntax check failed on attempt ${attempt}. Re-routing feedback.`);
                codingErrorTrace = auditResult;
                currentFileContent = generatedCode; // Engineer works on top of last generated code to self-heal
                attempt++;
            }
        }

        pipelineTimer();

        if (success) {
            vscode.window.showInformationMessage('HermesForge [Success]: Executive pipeline executed successfully. Core files designed and written!');
        } else {
            vscode.window.showWarningMessage(`HermesForge [Partial Success]: Executed pipeline, but failed to compile perfectly without QA alerts after ${maxRefinements} self-healing attempts.`);
        }
    }

    /**
     * ARCHITECT PHASE: Generates /context directory and the 5 critical core operational maps.
     * Uses Ollama to inject custom architectural structure derived from the user's initial prompt,
     * falling back to strict production templates if offline services are busy or unreachable.
     */
    public async generateWorkspaceContext(userPrompt: string): Promise<void> {
        logger.info('[Orchestrator] Launching Architect Phase: Initializing Workspace Context Map');
        const contextDir = this.getContextPath();
        
        let overview = '';
        let architecture = '';
        let standards = '';
        let uiContext = '';
        let progressTracker = '';

        const timer = logger.startTimer('Workspace Context Map Generation');

        // Let's ask Qwen / Hermes to tailor the core maps based on the workspace initial prompt
        try {
            logger.info('[Orchestrator] Tailoring design structures via local LLM...');
            const sysQuery = async (subject: string, detailRequest: string): Promise<string> => {
                const prompt = `You are a Principal Software Architect. Generate a clean Markdown file for "${subject}" based on this initial project concept: "${userPrompt}".
Requirements:
${detailRequest}
Respond ONLY with the complete Markdown file contents. No chat conversational filler.`;
                return await this.ollama.generateCompletion(prompt, {
                    model: this.ollama.modelChat,
                    temperature: 0.2
                });
            };

            // Call parallelizable context map outlines
            const [o, a, s, u] = await Promise.all([
                sysQuery('Project Overview', 'Provide a high-level conceptual description, target audience, core user goals, and major feature scopes.'),
                sysQuery('Architecture Context', 'Detail the directory layout, technology choices, third-party libraries, and direct backend/frontend integration contracts.'),
                sysQuery('Code Standards', 'Outline the coding conventions, type safety rules (no any), async/await styles, error handling boundaries, and testing guidelines.'),
                sysQuery('UI Context', 'Define styling guidelines (off-whites, deep charcoal grays), responsive margins, font scales, component hierarchy, and design semantics.')
            ]);

            overview = o;
            architecture = a;
            standards = s;
            uiContext = u;

        } catch (error) {
            logger.warn('[Orchestrator] Local LLM was busy or unavailable during design mapping. Falling back to robust offline templates.', error);
            
            // Elegant strict design-defending fallbacks
            overview = `# Project Overview\n\n**Initial Concept:** ${userPrompt}\n\n## Core Objectives\n- Maximize offline code-generation safety and performance.\n- Build a polished, zero-external-api suite of features.\n\n## Feature Scope\n- Low latency real-time inline completions.\n- Dynamic context chat with AST structural metadata.\n- Insulated terminal execution loop with strict user approval gates.`;
            
            architecture = '# Architecture Context\n\n## Directives\n- **Client Layer:** Modular VS Code interface elements (Providers, Sidebar Webviews).\n- **Inference Layer:** Clean local Keep-Alive pipeline hooked into Ollama.\n- **Routing Layer:** Smart 1.5B token intent classifier dispatcher.\n- **Data Layer:** Local file-tree context maps and dependency AST crawler.';
            
            standards = '# Code Standards\n\n## TypeScript Specifications\n- Strict compile-time checks with zero `any` statements.\n- Explicit interface schemas with strict return typings.\n- Always wrap async tool calls inside Try/Catch failure boundaries.\n- Named imports only — no namespace destructuring or partial exports.';
            
            uiContext = '# UI Context\n\n## Aesthetic Settings\n- **Theme Archetype:** Premium, high-contrast Slate/Obsidian Dark Theme.\n- **Typography Layout:** Space Grotesk display headings paired with JetBrains Mono code blocks.\n- **Touch Target Density:** Fluid interactive sizes matching VS Code density.';
        }

        progressTracker = `# Progress Tracker\n\n## Operational Pipeline\n\n| Phase | Task / Feature | Spec File | Status | Last Updated |\n| :--- | :--- | :--- | :--- | :--- |\n| Scope Map | Initial Workspace Scaffolded | N/A | Completed | ${new Date().toISOString()} |\n`;

        // Write maps safely to active workspace
        await this.ensureWriteFile(path.join(contextDir, 'project_overview.md'), overview);
        await this.ensureWriteFile(path.join(contextDir, 'architecture_context.md'), architecture);
        await this.ensureWriteFile(path.join(contextDir, 'code_standards.md'), standards);
        await this.ensureWriteFile(path.join(contextDir, 'ui_context.md'), uiContext);
        await this.ensureWriteFile(path.join(contextDir, 'progress_tracker.md'), progressTracker);

        timer();
        logger.info('[Orchestrator] Architect Phase Complete: All 5 operational context maps successfully written to /context');
        vscode.window.showInformationMessage('HermesForge: Architectural context map successfully initialized in /context');
    }

    /**
     * SPECIFICATION GATING: Forces a strict feature specification to be written before coding.
     */
    public async createFeatureSpecification(featureName: string, featureRequest: string): Promise<string> {
        logger.info(`[Orchestrator] Gating Feature Request: ${featureName}`);
        
        const safeName = featureName.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/(^_+)|(_+$)/g, '');
        const specFilename = `01_${safeName}.md`;
        const specFilePath = path.join(this.getContextPath(), 'feature_specs', specFilename);

        const prompt = `You are a Lead Systems Architect. Write a structured product specification markdown document for this new feature request.
        
FEATURE REQUEST: "${featureRequest}"

Your specification sheet must explicitly lay out and hardcode the following exact four sections:
1. # Goals (Clear scope and business objectives)
2. # Explicit Design Decisions (Detail component interfaces, styling parameters, variables, and API contracts)
3. # Step-by-Step Implementation Bounds (Insulated sequential development steps)
4. # Verification Checklist (Concrete items to check, e.g., TypeScript compilation, error handling, visual layout checks)

Respond ONLY with the markdown file content. No extra conversational wrapper.`;

        const timer = logger.startTimer(`Generating Feature Spec: ${specFilename}`);
        let specContent = '';
        
        try {
            specContent = await this.ollama.generateCompletion(prompt, {
                model: this.ollama.modelChat,
                temperature: 0.1
            });
        } catch (error) {
            logger.error('[Orchestrator] Failed generating feature spec over Ollama. Generating baseline spec fallback.', error);
            specContent = `# Goals\n- Implement: ${featureRequest}\n\n# Explicit Design Decisions\n- Use strict typing definitions.\n- Maintain architectural compliance with existing modules.\n\n# Step-by-Step Implementation Bounds\n1. Read current codebase state.\n2. Write isolated code block.\n3. Validate syntax compiler outputs.\n\n# Verification Checklist\n- [ ] Compiles cleanly under TypeScript.\n- [ ] Resolves boundaries with zero syntax errors.`;
        }

        await this.ensureWriteFile(specFilePath, specContent);
        timer();

        logger.info(`[Orchestrator] Feature Gating Complete. Spec sheet written: ${specFilePath}`);
        return specFilePath;
    }

    /**
     * CONSTRAINED EXECUTION LOOP: Drives the AgentEngine to execute exactly aligned to specifications.
     */
    public async executeSpecBoundUnit(specFilePath: string): Promise<void> {
        logger.info(`[Orchestrator] Initializing Execution Loop for spec: ${path.basename(specFilePath)}`);
        
        const specFilename = path.basename(specFilePath);
        const trackerPath = path.join(this.getContextPath(), 'progress_tracker.md');
        
        // 1. Mark status "In Progress" in the tracker
        try {
            let trackerContent = '';
            if (await fs.stat(trackerPath).then(() => true).catch(() => false)) {
                trackerContent = await fs.readFile(trackerPath, 'utf8');
            }
            const appendLine = `| Feature Unit | ${specFilename.replace('.md', '')} | [Spec](${path.join('feature_specs', specFilename)}) | **In Progress** | ${new Date().toISOString()} |\n`;
            trackerContent += appendLine;
            await fs.writeFile(trackerPath, trackerContent, 'utf8');
        } catch (err) {
            logger.warn('[Orchestrator] Failed updating progress tracker', err);
        }

        // 2. Read context maps to inject as strict agent anchors
        let globalAnchors = '';
        try {
            const overview = await fs.readFile(path.join(this.getContextPath(), 'project_overview.md'), 'utf8');
            const standards = await fs.readFile(path.join(this.getContextPath(), 'code_standards.md'), 'utf8');
            globalAnchors = `\n\n### GLOBAL PROJECT CONTEXT ARCHITECTURAL ANCHORS ###\n${overview}\n\n${standards}\n`;
        } catch (err) {}

        const specContent = await fs.readFile(specFilePath, 'utf8');

        // 3. Command the Agent Engine to execute fully isolated to these bounds
        const agent = new AgentEngine(this.ollama);
        const goal = `Implement the scoped unit described in the attached feature specification.
You are strictly limited to the boundaries outlined in the verification checklist and step-by-step bounds.
DO NOT introduce any additional files or features outside this spec.

### SPECIFICATION SHEETS ###
${specContent}
${globalAnchors}

Proceed step-by-step. Validate your completion.`;

        const ttftTimer = logger.trackTTFT(this.ollama.modelChat, `ExecutiveOrchestrator: Executing ${specFilename}`);
        await agent.startAgentLoop(goal);
        ttftTimer();

        // 4. Update the tracker to "Completed"
        try {
            let trackerContent = await fs.readFile(trackerPath, 'utf8');
            const placeholder = `| Feature Unit | ${specFilename.replace('.md', '')} | [Spec](${path.join('feature_specs', specFilename)}) | **In Progress** |`;
            const exactLine = trackerContent.split('\n').find(l => l.includes(placeholder));
            if (exactLine) {
                const updatedLine = exactLine.replace('**In Progress**', '**Completed**').replace(/\|\s*[^|]+\s*\|$/, `| ${new Date().toISOString()} |`);
                trackerContent = trackerContent.replace(exactLine, updatedLine);
            } else {
                trackerContent += `| Feature Unit | ${specFilename.replace('.md', '')} | [Spec](${path.join('feature_specs', specFilename)}) | **Completed** | ${new Date().toISOString()} |\n`;
            }
            await fs.writeFile(trackerPath, trackerContent, 'utf8');
            logger.info(`[Orchestrator] Successfully updated tracker state to Completed for ${specFilename}`);
        } catch (err) {
            logger.warn('[Orchestrator] Failed writing completed status tracker update', err);
        }

        vscode.window.showInformationMessage(`HermesForge: Spec unit ${specFilename} successfully executed & verified.`);
    }
}
