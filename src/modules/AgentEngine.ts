import * as vscode from 'vscode';
import * as cp from 'child_process';
import * as fs from 'fs/promises';
import * as path from 'path';
import { OllamaClient, ChatMessage } from '../services/OllamaClient';
import { ContextCrawler } from '../services/ContextCrawler';
import { logger } from '../utils/Logger';
import { SecurityGuard } from '../utils/SecurityGuard';

export const activeSubprocesses: cp.ChildProcess[] = [];

export class AgentEngine {
    private ollama: OllamaClient;
    private readonly MAX_DEPTH = 5;
    private outputChannel: vscode.OutputChannel;
    private crawler = new ContextCrawler();

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

    private async writeFile(filePath: string, content: string): Promise<string> {
        try {
            const fullPath = path.resolve(this.getWorkspaceRoot(), filePath);
            await fs.mkdir(path.dirname(fullPath), { recursive: true });
            await fs.writeFile(fullPath, content, 'utf8');
            return `Successfully wrote to ${filePath}`;
        } catch (error: any) {
            return `Error writing file: ${error.message}`;
        }
    }

    /**
     * Executes the task using a streamlined, memory-safe execution loop
     */
    public async executeTask(userGoal: string): Promise<void> {
        // 1. COMPACT CONTEXT STRUCTURE: Crawl dependencies for targeted context
        let activeFilePath = '';
        const activeEditor = vscode.window.activeTextEditor;
        if (activeEditor) {
            activeFilePath = activeEditor.document.fileName;
        }

        let targetFiles: string[] = [];
        if (activeFilePath) {
            try {
                // Readonly target files mapped by ContextCrawler with limited depth
                targetFiles = await this.crawler.crawlDependencies(activeFilePath, 1);
            } catch (err: any) {
                logger.warn(`[AgentEngine] ContextCrawler could not resolve dependencies: ${err.message}`);
            }
        }

        // Fallback to searching basic ts files if no active files crawled
        if (targetFiles.length === 0) {
            try {
                const workspaceFiles = await vscode.workspace.findFiles('src/**/*.ts', '**/node_modules/**', 5);
                targetFiles = workspaceFiles.map(f => f.fsPath);
            } catch {}
        }

        this.outputChannel.appendLine(`[ContextCrawler] Target boundary configured for ${targetFiles.length} files.`);
        for (const file of targetFiles) {
            this.outputChannel.appendLine(`  -> Bound: ${path.relative(this.getWorkspaceRoot(), file)}`);
        }

        // Highly compressed system instruction tailored for qwen2.5-coder:3b
        const compressedSystemMsg = `You are a compact JSON execution block agent targeting qwen2.5-coder:3b.
Rule 1: Never output conversational filler, thoughts, preamble, or notes.
Rule 2: Respond strictly with a single minified JSON object block inside <tool_call>...</tool_call> tags.
Supported JSON formats:
- <tool_call>{"tool": "read", "path": "relative_path"}</tool_call>
- <tool_call>{"tool": "write", "path": "relative_path", "content": "exact_file_content"}</tool_call>
- <tool_call>{"tool": "execute", "command": "shell_command"}</tool_call>

Constraint: When reading code, you are restricted to target only files mapped by ContextCrawler:
${targetFiles.map(f => path.relative(this.getWorkspaceRoot(), f)).join(', ')}

When task is finished or satisfied, respond exactly: Done.`;

        const chatMessages: ChatMessage[] = [
            { role: 'system', content: compressedSystemMsg },
            { role: 'user', content: `Goal: ${userGoal}\nExecute.` }
        ];

        let iteration = 0;
        let activeResponse = '';

        while (iteration < this.MAX_DEPTH) {
            iteration++;
            this.outputChannel.appendLine(`\n>>> [Step ${iteration}/${this.MAX_DEPTH}] Reasoning with qwen2.5-coder:3b...`);
            
            try {
                activeResponse = '';

                // Stream completion with low temperature & keep load low
                const stream = this.ollama.streamChat(chatMessages, {
                    model: 'qwen2.5-coder:3b', // Enforced qwen2.5-coder:3b instead of 8B
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
                    this.outputChannel.appendLine('\n[Agent Concluded Success]: Task parameters satisfied.');
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
                        
                        // Check: Read only specific target files returned by ContextCrawler
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
                    break;
                }

            } catch (err: any) {
                this.outputChannel.appendLine(`\n[Inference Failure]: ${err.message || err}`);
                break;
            } finally {
                // STATE RECLAIM: Explicitly run global GC hint if available and clear temp variables
                activeResponse = '';
                if (global && typeof (global as any).gc === 'function') {
                    try {
                        (global as any).gc();
                    } catch (_) {}
                }
            }
        }

        if (iteration >= this.MAX_DEPTH) {
            this.outputChannel.appendLine('\n[Agent Terminated]: Loop reached maximum threshold bounds.');
        }
    }

    /**
     * Preserves startAgentLoop API while delegating directly to the low-overhead execution loop
     */
    public async startAgentLoop(goal: string): Promise<void> {
        this.outputChannel.show(true);
        this.outputChannel.appendLine('=========================================');
        this.outputChannel.appendLine(`[Agent Loop Triggered]\nGoal: ${goal}`);
        this.outputChannel.appendLine('=========================================\n');

        await this.executeTask(goal);
    }
}
