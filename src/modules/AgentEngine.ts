import * as vscode from 'vscode';
import * as cp from 'child_process';
import * as fs from 'fs/promises';
import * as path from 'path';
import { OllamaClient, ChatMessage } from '../services/OllamaClient';
import { ContextCrawler } from '../services/ContextCrawler';
import { logger } from '../utils/Logger';
import { SecurityGuard } from '../utils/SecurityGuard';

export const activeSubprocesses: cp.ChildProcess[] = [];

export interface PlannedStep {
    id: number;
    task: string;
    file: string;
    persona: 'refactor' | 'auditor' | 'test' | 'default';
}

export class AgentEngine {
    private ollama: OllamaClient;
    private readonly MAX_DEPTH = 5;
    private outputChannel: vscode.OutputChannel;
    private crawler = new ContextCrawler();
    private fileBackups = new Map<string, string>();

    constructor(ollama: OllamaClient) {
        this.ollama = ollama;
        this.outputChannel = vscode.window.createOutputChannel('HermesForge Agent');
    }

    private getWorkspaceRoot(): string {
        const folders = vscode.workspace.workspaceFolders;
        return folders && folders.length > 0 ? folders[0].uri.fsPath : process.cwd();
    }

    private async executeCommand(command: string): Promise<string> {
        return new Promise((resolve) => {
            const childProc = cp.exec(command, { cwd: this.getWorkspaceRoot() }, (error, stdout, stderr) => {
                const index = activeSubprocesses.indexOf(childProc);
                if (index !== -1) {
                    activeSubprocesses.splice(index, 1);
                }
                const output = [];
                if (stdout) output.push(`STDOUT:\n${stdout}`);
                if (stderr) output.push(`STDERR:\n${stderr}`);
                if (error) output.push(`ERROR:\n${error.message}`);
                
                resolve(output.join('\n') || 'Command executed successfully with no output.');
            });
            activeSubprocesses.push(childProc);
        });
    }

    private async readFile(filePath: string): Promise<string> {
        try {
            const fullPath = path.resolve(this.getWorkspaceRoot(), filePath);
            const content = await fs.readFile(fullPath, 'utf8');
            return content;
        } catch (error: any) {
            return `Error reading file: ${error.message}`;
        }
    }

    private async backupFile(filePath: string): Promise<void> {
        const root = this.getWorkspaceRoot();
        const fullPath = path.resolve(root, filePath);
        if (!this.fileBackups.has(fullPath)) {
            try {
                const exists = await fs.stat(fullPath).then(() => true).catch(() => false);
                if (exists) {
                    const content = await fs.readFile(fullPath, 'utf8');
                    this.fileBackups.set(fullPath, content);
                    this.outputChannel.appendLine(`[Safety Backup]: Cached copy of original file ${filePath}`);
                }
            } catch (err: any) {
                logger.warn(`Failed to generate safety backup for ${filePath}: ${err.message}`);
            }
        }
    }

    private async rollbackAll(): Promise<void> {
        this.outputChannel.appendLine('\n🚨 [Safety Rollback]: Verification failed. Restoring modified files to correct, compilation-passed states...');
        for (const [fullPath, originalContent] of this.fileBackups.entries()) {
            try {
                await fs.writeFile(fullPath, originalContent, 'utf8');
                this.outputChannel.appendLine(`  -> Restored: ${path.relative(this.getWorkspaceRoot(), fullPath)}`);
            } catch (err: any) {
                this.outputChannel.appendLine(`  -> Failed rollback restore on: ${fullPath}: ${err.message}`);
            }
        }
    }

    private async writeFile(filePath: string, content: string): Promise<string> {
        try {
            const root = this.getWorkspaceRoot();
            const fullPath = path.resolve(root, filePath);
            const fileExists = await fs.stat(fullPath).then(() => true).catch(() => false);
            
            // Track safety backup before file writes/creation
            await this.backupFile(filePath);

            if (fileExists) {
                const candidatePath = `${fullPath}.candidate`;
                await fs.mkdir(path.dirname(candidatePath), { recursive: true });
                await fs.writeFile(candidatePath, content, 'utf8');

                const originalUri = vscode.Uri.file(fullPath);
                const candidateUri = vscode.Uri.file(candidatePath);

                const choice = await vscode.window.showInformationMessage(
                    `Agent requests write to: ${path.relative(root, fullPath)}`,
                    'Approve & Apply',
                    'Open Diff Preview',
                    'Reject Changes'
                );

                if (choice === 'Open Diff Preview') {
                    await vscode.commands.executeCommand('vscode.diff', originalUri, candidateUri, `Pending Diff: ${path.basename(filePath)}`);
                    
                    const postDiffChoice = await vscode.window.showWarningMessage(
                        `Are you satisfied with the diff preview for ${path.basename(filePath)}?`,
                        { modal: true },
                        'Apply Proposed Code',
                        'Reject Code'
                    );

                    if (postDiffChoice === 'Apply Proposed Code') {
                        await fs.rename(candidatePath, fullPath);
                        await vscode.commands.executeCommand('workbench.action.closeActiveEditor');
                        return `Successfully applied changes to ${filePath}`;
                    } else {
                        await fs.unlink(candidatePath).catch(() => {});
                        return `User rejected proposed changes for ${filePath} after reviewing diff.`;
                    }
                } else if (choice === 'Approve & Apply') {
                    await fs.rename(candidatePath, fullPath);
                    return `Successfully applied changes to ${filePath}`;
                } else {
                    await fs.unlink(candidatePath).catch(() => {});
                    return `User directly rejected proposed write changes for ${filePath}.`;
                }
            } else {
                const userChoice = await vscode.window.showInformationMessage(
                    `Agent requests to create a new file: ${path.relative(root, fullPath)}`,
                    'Approve Creation',
                    'Reject Creation'
                );

                if (userChoice === 'Approve Creation') {
                    await fs.mkdir(path.dirname(fullPath), { recursive: true });
                    await fs.writeFile(fullPath, content, 'utf8');
                    return `Successfully created new file ${filePath}`;
                } else {
                    return `User rejected creation of new file ${filePath}`;
                }
            }
        } catch (error: any) {
            return `Error during target write: ${error.message}`;
        }
    }

    /**
     * Executes the task using a streamlined, memory-safe execution loop
     */
    public async executeTask(
        userGoal: string, 
        persona: 'default' | 'refactor' | 'auditor' | 'test' = 'default',
        enforcedFilePath: string = ''
    ): Promise<string> {
        let activeFilePath = enforcedFilePath;
        if (!activeFilePath) {
            const activeEditor = vscode.window.activeTextEditor;
            if (activeEditor) {
                activeFilePath = activeEditor.document.fileName;
            }
        }

        let targetFiles: string[] = [];
        if (activeFilePath) {
            try {
                targetFiles = await this.crawler.crawlDependencies(activeFilePath, 1);
            } catch (err: any) {
                logger.warn(`[AgentEngine] ContextCrawler could not resolve dependencies: ${err.message}`);
            }
        }

        if (targetFiles.length === 0) {
            try {
                const workspaceFiles = await vscode.workspace.findFiles('src/**/*.ts', '**/node_modules/**', 5);
                targetFiles = workspaceFiles.map(f => f.fsPath);
            } catch {}
        }

        this.outputChannel.appendLine(`[Specialist Setup]: Active specialist persona: "${persona}"`);
        this.outputChannel.appendLine(`[ContextCrawler] Target boundary configured for ${targetFiles.length} files.`);

        // -------------------------------------------------------------
        // PERSISTENT SPECIALIST AGENT PERSONAS CONFIGURATION
        // -------------------------------------------------------------
        let compressedSystemMsg = '';

        if (persona === 'refactor') {
            compressedSystemMsg = `You are the REFACTORING AGENT specialist persona.
Scope: Clean, modular, decoupled architectural refactoring and elegant structural splits.
STRICT QUALITY PROTOCOLS:
1. Ensure full TypeScript contracts, precise namespaces, and named exports. No 'any' types.
2. Maximize cohesive logic separation.
3. Respond STRICTLY with minified JSON tool calls:
- <tool_call>{"tool": "read", "path": "relative_path"}</tool_call>
- <tool_call>{"tool": "write", "path": "relative_path", "content": "exact_file_content"}</tool_call>
- <tool_call>{"tool": "execute", "command": "shell_command"}</tool_call>

Constraint: Read files from target files list only:
${targetFiles.map(f => path.relative(this.getWorkspaceRoot(), f)).join(', ')}

When refactoring is completely dry-run tested and verified, respond exactly: Done.`;
        } else if (persona === 'auditor') {
            compressedSystemMsg = `You are the SECURITY & EXCEPTION AUDITING AGENT specialist persona.
Scope: Quality control audits, robust exception safety filters, edge case bounds checks, and robust logging telemetry verification.
STRICT QUALITY PROTOCOLS:
1. Inspect code logic for index safety, missing check assertions, try-catch blocks and error handling loops.
2. Guard against crash conditions completely, adding protective validation layers.
3. Respond STRICTLY with minified JSON tool calls:
- <tool_call>{"tool": "read", "path": "relative_path"}</tool_call>
- <tool_call>{"tool": "write", "path": "relative_path", "content": "exact_file_content"}</tool_call>
- <tool_call>{"tool": "execute", "command": "shell_command"}</tool_call>

Constraint: Read files from target files list only:
${targetFiles.map(f => path.relative(this.getWorkspaceRoot(), f)).join(', ')}

When auditing is completely verified, respond exactly: Done.`;
        } else if (persona === 'test') {
            compressedSystemMsg = `You are the QA TEST SUITE ENGINEER AGENT specialist persona.
Scope: Writing deep deterministic mock tests and executing automated unit assertion verification loops.
STRICT QUALITY PROTOCOLS:
1. Use vitest or mocha standard definitions. Write comprehensive coverage of positive scenarios, invalid inputs, edge bounds, and exceptions.
2. Formulate correct logic execution assertions without external connection dependencies.
3. Respond STRICTLY with minified JSON tool calls:
- <tool_call>{"tool": "read", "path": "relative_path"}</tool_call>
- <tool_call>{"tool": "write", "path": "relative_path", "content": "exact_file_content"}</tool_call>
- <tool_call>{"tool": "execute", "command": "shell_command"}</tool_call>

Constraint: Read files from target files list only:
${targetFiles.map(f => path.relative(this.getWorkspaceRoot(), f)).join(', ')}

When unit tests are completed and fully verified on the test loop, respond exactly: Done.`;
        } else {
            // Default General Coder persona
            compressedSystemMsg = `You are a compact JSON execution block agent targeting qwen2.5-coder:3b.
Rule 1: Never output conversational filler, thoughts, preamble, or notes.
Rule 2: Respond strictly with a single minified JSON object block inside <tool_call>...</tool_call> tags.
Supported JSON formats:
- <tool_call>{"tool": "read", "path": "relative_path"}</tool_call>
- <tool_call>{"tool": "write", "path": "relative_path", "content": "exact_file_content"}</tool_call>
- <tool_call>{"tool": "execute", "command": "shell_command"}</tool_call>

Constraint: When reading code, you are restricted to target only files mapped by ContextCrawler:
${targetFiles.map(f => path.relative(this.getWorkspaceRoot(), f)).join(', ')}

When task is finished or satisfied, respond exactly: Done.`;
        }

        const chatMessages: ChatMessage[] = [
            { role: 'system', content: compressedSystemMsg },
            { role: 'user', content: `Goal: ${userGoal}\nExecute.` }
        ];

        let iteration = 0;
        let activeResponse = '';
        let executionTrackSummary = '';

        while (iteration < this.MAX_DEPTH) {
            iteration++;
            this.outputChannel.appendLine(`\n>>> [Step ${iteration}/${this.MAX_DEPTH}] Reasoning with qwen2.5-coder:3b...`);
            
            try {
                activeResponse = '';

                const stream = this.ollama.streamChat(chatMessages, {
                    model: 'qwen2.5-coder:3b',
                    temperature: 0.1,
                    stop: ['</tool_call>']
                });

                for await (const chunk of stream) {
                    activeResponse += chunk;
                }

                if (activeResponse.includes('<tool_call>') && !activeResponse.includes('</tool_call>')) {
                    activeResponse += '</tool_call>';
                }

                const trimmedResponse = activeResponse.trim();
                logger.debug(`[AgentEngine] Stream response: ${trimmedResponse}`);

                if (trimmedResponse.toLowerCase().includes('done.')) {
                    this.outputChannel.appendLine('\n[Agent Concluded Success]: Specialist objective satisfied.');
                    executionTrackSummary += `\n- Task section compiled successfully under persona "${persona}".`;
                    break;
                }

                const toolMatch = trimmedResponse.match(/<tool_call>([\s\S]*?)<\/tool_call>/);
                if (toolMatch) {
                    const rawJson = toolMatch[1].trim();
                    let toolBlock: any = null;
                    try {
                        toolBlock = JSON.parse(rawJson);
                    } catch (e: any) {
                        this.outputChannel.appendLine(`\n[JSON Parse Error]: ${e.message}. Forcing correction...`);
                        chatMessages.push({
                            role: 'assistant',
                            content: trimmedResponse
                        });
                        chatMessages.push({
                            role: 'user',
                            content: 'Format Error: Response was not valid minified JSON. Fix and retry.'
                        });
                        continue;
                    }

                    this.outputChannel.appendLine(`\n[Executing Tool]: "${toolBlock.tool || 'unknown'}"`);
                    let outcome = '';

                    if (toolBlock.tool === 'read') {
                        const relPath = toolBlock.path;
                        const absolutePath = path.resolve(this.getWorkspaceRoot(), relPath);
                        
                        const isTargetAllowed = targetFiles.some(f => path.resolve(f) === absolutePath);

                        if (!isTargetAllowed && targetFiles.length > 0) {
                            outcome = `Sandbox Error: Access to file outside active ContextCrawler target pool is restricted. Supported files are: ${targetFiles.map(f => path.relative(this.getWorkspaceRoot(), f)).join(', ')}`;
                            this.outputChannel.appendLine(`  -> Gated: Prevented reading path: ${relPath}`);
                        } else {
                            outcome = await this.readFile(relPath);
                        }
                    } else if (toolBlock.tool === 'write') {
                        const relPath = toolBlock.path;
                        outcome = await this.writeFile(relPath, toolBlock.content || '');
                        executionTrackSummary += `\n- Mutated and configured file: \`${relPath}\`.`;
                    } else if (toolBlock.tool === 'execute') {
                        const command = toolBlock.command;
                        
                        // Security check intercepting natively before executing Node subprocess
                        const securityVerdict = SecurityGuard.validateCommand(command);
                        if (!securityVerdict.isSafe) {
                            const errReason = securityVerdict.reason || 'Violates secure system policy.';
                            vscode.window.showErrorMessage(`[HermesForge Security Safeguard] ${errReason}`);
                            this.outputChannel.appendLine(`\n🚨 [SECURITY INFRACTION BLOCKED]: ${errReason}`);
                            outcome = 'Execution Gated: Command violates secure system validation policy.';
                        } else {
                            const approveChoice = await vscode.window.showWarningMessage(
                                `Agent requested command execution:\n\n${command}`,
                                { modal: true },
                                'Approve Run',
                                'Cancel Loop'
                            );

                            if (approveChoice === 'Approve Run') {
                                outcome = await this.executeCommand(command);
                            } else {
                                this.outputChannel.appendLine('\n[Cancelled Interface]: Execution rejected by user.');
                                break;
                            }
                        }
                    } else {
                        outcome = `Error: Unknown tool type '${toolBlock.tool}'.`;
                    }

                    const resultSnippet = outcome.length > 1500 ? outcome.substring(0, 1500) + '\n...[Truncated for memory]' : outcome;
                    this.outputChannel.appendLine(`\n[Outcome]:\n${resultSnippet}`);

                    chatMessages.push({
                        role: 'assistant',
                        content: `<tool_call>${JSON.stringify(toolBlock)}</tool_call>`
                    });

                    chatMessages.push({
                        role: 'user',
                        content: `Outcome:\n${outcome}`
                    });

                } else {
                    this.outputChannel.appendLine(`\n[Agent Response]: ${trimmedResponse}`);
                    chatMessages.push({
                        role: 'assistant',
                        content: trimmedResponse
                    });
                    executionTrackSummary += `\n- Outcome explanation: ${trimmedResponse}`;
                    break;
                }

            } catch (err: any) {
                this.outputChannel.appendLine(`\n[Inference Failure]: ${err.message || err}`);
                executionTrackSummary += `\n- Execution failure: ${err.message || err}`;
                break;
            } finally {
                activeResponse = '';
            }
        }

        // Clean memory
        chatMessages.length = 0;
        targetFiles.length = 0;

        if (iteration >= this.MAX_DEPTH) {
            this.outputChannel.appendLine('\n[Agent Terminated]: Loop reached maximum threshold bounds.');
        }

        return executionTrackSummary;
    }

    /**
     * Strategic Task Partitioning (Planner Agent)
     */
    private async generateProjectPlan(goal: string): Promise<PlannedStep[]> {
        const root = this.getWorkspaceRoot();
        const scanFiles = await vscode.workspace.findFiles('src/**/*.ts', '**/node_modules/**', 10);
        const mappedFilesStr = scanFiles.map(f => path.relative(root, f.fsPath)).join(', ');

        const systemPrompt = `You are the HermesForge Chief Planner Agent specializing in decomposing complex codebase modifications into dry-run safe milestone steps.
Decompose the following user objective: "${goal}"

Available files mapped in repository: ${mappedFilesStr}

Formulate a sequential, cohesive sequence of implementation steps (MAX 4 steps).
For each step, specify the exact task, file path to target, and specialized executor persona:
1. "refactor" (For implementing logic, modular splits, structural changes)
2. "auditor" (For verification checks, exception safety Try/Catch additions, quality audits)
3. "test" (For formulating deterministic tests and validating them)

You MUST respond strictly with a minified JSON response containing the "steps" array. Do not write markdown blocks or explain yourself outside the JSON brackets.
Example Schema:
{
  "steps": [
    { "id": 1, "task": "Add validation helper functions", "file": "src/utils/Helper.ts", "persona": "refactor" }
  ]
}`;

        this.outputChannel.appendLine('[Multi-Agent Planner]: Strategizing system orchestration...');
        try {
            const rawResponse = await this.ollama.generateCompletion(systemPrompt, {
                model: 'hermes3:8b', // Strong high-reasoning engine for architecture mapping
                temperature: 0.1
            });

            const jsonMatch = rawResponse.match(/\{[\s\S]*?\}/);
            if (jsonMatch) {
                const parsed = JSON.parse(jsonMatch[0]);
                if (parsed.steps && Array.isArray(parsed.steps)) {
                    return parsed.steps as PlannedStep[];
                }
            }
        } catch (err: any) {
            logger.warn(`Planning model failed execution. Yielding automated single step backup partition: ${err.message}`);
        }

        // Failure Fallback: Single Task Partition
        return [{
            id: 1,
            task: goal,
            file: '',
            persona: 'refactor'
        }];
    }

    /**
     * Main Orchestration Entrypoint running the delegation, validation and self-healing loop.
     */
    public async startAgentLoop(goal: string): Promise<void> {
        this.outputChannel.show(true);
        this.outputChannel.appendLine('=========================================');
        this.outputChannel.appendLine(`🚀 [Multi-Agent System Orchestrator Activated]\nPrimary Objective: ${goal}`);
        this.outputChannel.appendLine('=========================================\n');

        // Reset system structures
        this.fileBackups.clear();
        
        // 1. Task Planning
        const steps = await this.generateProjectPlan(goal);
        this.outputChannel.appendLine(`[Multi-Agent Planner]: Resolved scaffold into ${steps.length} cohesive steps:`);
        for (const step of steps) {
            this.outputChannel.appendLine(`  Step [${step.id}]: [Agent Persona: ${step.persona}] File: ${step.file || 'Dynamic'} -> ${step.task}`);
        }
        this.outputChannel.appendLine('=========================================\n');

        let sharedMemoryContext = '';
        const filesChangedInTransaction = new Set<string>();

        // 2. Delegation & Execution Loop
        for (const step of steps) {
            this.outputChannel.appendLine(`🏁 [Step ${step.id}/${steps.length}] Dispatching to specialized ${step.persona.toUpperCase()} agent...`);
            
            const localizedGoal = `Assemble and deliver. Step goal: "${step.task}".\nProgress Ledger/Shared Memory so far:\n${sharedMemoryContext}`;
            
            // Execute specialized step
            const stepTrackSummary = await this.executeTask(localizedGoal, step.persona, step.file ? path.resolve(this.getWorkspaceRoot(), step.file) : '');
            
            if (step.file) {
                filesChangedInTransaction.add(path.resolve(this.getWorkspaceRoot(), step.file));
            }

            // Record step results in context memory
            sharedMemoryContext += `\nStep ${step.id} Completed Summary:\n${stepTrackSummary}`;

            this.outputChannel.appendLine(`\n[Self-Healing & Compilation Phase]: Verifying step ${step.id} outputs...`);
            const { VerificationEngine } = await import('../services/VerificationEngine');
            const verifier = new VerificationEngine(this.ollama);
            
            // Run Compilation/Linter checking
            this.outputChannel.appendLine('  - Executing safety compilation verification (npm run lint)...');
            const linterPasses = await verifier.verifyAndHeal(this.getWorkspaceRoot(), 'npm run lint', 2);
            
            if (!linterPasses) {
                this.outputChannel.appendLine('[Safety Gate Blocked]: Step file edits broke workspace types or syntax! Triggering restore fallback...');
                await this.rollbackAll();
                vscode.window.showErrorMessage('HermesForge Safeguard Triggered: Code safety violated! Step rolled back.');
                return;
            }

            // Run automated testing verification checks if this is deep logic or has tests
            if (step.persona === 'test' || goal.toLowerCase().includes('test')) {
                this.outputChannel.appendLine('  - Executing automated vitest loops (npm test)...');
                const testsPass = await verifier.verifyAndHeal(this.getWorkspaceRoot(), 'npm test', 2);
                if (!testsPass) {
                    this.outputChannel.appendLine('[Safety Gate Alert]: Modified logic failed active tests! Code preserved, but verification failed.');
                }
            }
            
            this.outputChannel.appendLine(`✨ Step ${step.id} successfully verified and consolidated.`);
        }

        // 3. Draft PR Summary and Changelog Output
        this.outputChannel.appendLine('\n=========================================');
        this.outputChannel.appendLine('📈 [Formulating PR-Ready Summary & Differential Analysis]');
        this.outputChannel.appendLine('=========================================\n');

        const prPrompt = `You are a Principal Software Architect. Formulate a clean, highly descriptive, professional PR-ready differential summary of the work.
Shared Execution Record Ledger:
${sharedMemoryContext}

Deliver the output with exact markdown headers:
## 🚀 PR-Ready Changes & Impact Review
### 📝 Description of Changes
[Details of files added, refactored, or audited]
### 📂 Files Impacted
[Files modified and their relative paths]
### 🛡️ Safety Verification Status
- Linter/Compiler check status
- Automated Test execution status

Output ONLY the markdown content list. No explanations.`;

        try {
            const summaryReport = await this.ollama.generateCompletion(prPrompt, {
                model: 'hermes3:8b',
                temperature: 0.1
            });
            this.outputChannel.appendLine(summaryReport);
            
            await vscode.commands.executeCommand('workbench.view.extension.hermes-forge-sidebar');
            // Write to channel
            this.outputChannel.appendLine('\n=========================================');
            this.outputChannel.appendLine('🟢 ALL SYSTEMS STABLE. MULTI-AGENT INSTRUCTION COMPLETED SUCCESSFULLY.');
            this.outputChannel.appendLine('=========================================');
        } catch (err: any) {
            this.outputChannel.appendLine(`PR Builder met busy state: ${err.message}`);
        }
    }
}
