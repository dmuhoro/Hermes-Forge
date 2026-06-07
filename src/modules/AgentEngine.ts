import * as vscode from 'vscode';
import * as cp from 'child_process';
import * as fs from 'fs/promises';
import * as path from 'path';
import { OllamaClient, ChatMessage } from '../services/OllamaClient';
import { logger } from '../utils/Logger';

export const activeSubprocesses: cp.ChildProcess[] = [];

export class AgentEngine {
    private ollama: OllamaClient;
    private readonly MAX_DEPTH = 5;
    private outputChannel: vscode.OutputChannel;

    constructor(ollama: OllamaClient) {
        this.ollama = ollama;
        this.outputChannel = vscode.window.createOutputChannel("HermesForge Agent");
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
                
                resolve(output.join('\n') || "Command executed successfully with no output.");
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

    private async getSymbolContext(document: vscode.TextDocument): Promise<string> {
        try {
            const symbols: vscode.DocumentSymbol[] | undefined = await vscode.commands.executeCommand(
                'vscode.executeDocumentSymbolProvider',
                document.uri
            );

            if (!symbols || symbols.length === 0) {
                return '';
            }

            const formatSymbols = (syms: vscode.DocumentSymbol[], depth = 0): string => {
                let result = '';
                const indent = '  '.repeat(depth);
                for (const sym of syms) {
                    const kind = vscode.SymbolKind[sym.kind] || 'Unknown';
                    result += `${indent}- [${kind}] ${sym.name}\n`;
                    if (sym.children && sym.children.length > 0) {
                        result += formatSymbols(sym.children, depth + 1);
                    }
                }
                return result;
            };

            return `\nActive File Symbols (${path.basename(document.fileName)}):\n${formatSymbols(symbols)}`;
        } catch (error) {
            logger.warn(`Failed to retrieve document symbols: ${error}`);
            return '';
        }
    }

    public async startAgentLoop(goal: string): Promise<void> {
        this.outputChannel.show(true);
        this.outputChannel.appendLine("=========================================");
        this.outputChannel.appendLine(`[Agent Loop Started]\nGoal: ${goal}`);
        this.outputChannel.appendLine("=========================================\n");

        let astContext = '';
        const activeEditor = vscode.window.activeTextEditor;
        if (activeEditor) {
            astContext = await this.getSymbolContext(activeEditor.document);
        }

        const systemPrompt = `You are an autonomous software engineering agent running locally in VS Code.
You can execute tools to interact with the file system and terminal. 
You must think step-by-step to fulfill the user's goal.${astContext ? `\n\nWorkspace Context:\n${astContext}` : ''}

You have access to the following strictly defined JSON tools:
[
  { 
    "name": "readFile", 
    "description": "Read the contents of a file", 
    "parameters": { "path": "string" } 
  },
  { 
    "name": "writeFile", 
    "description": "Write exact content to a file", 
    "parameters": { "path": "string", "content": "string" } 
  },
  { 
    "name": "executeCommand", 
    "description": "Execute a shell command in the project directory", 
    "parameters": { "command": "string" } 
  }
]

To use a tool, you MUST output a JSON block bounded by <tool_call> tags. 
DO NOT put anything else around it, just provide the tag if a tool is needed.
Format:
<tool_call>
{
  "name": "tool_name",
  "arguments": {
    "key": "value"
  }
}
</tool_call>

Once you have gathered enough information and completed the goal, respond with your final thoughts normally explaining what you did, WITHOUT <tool_call> tags. Do not hallucinate the result of a tool call before it happens. Wait for the tool response provided by the user.`;

        let messages: ChatMessage[] = [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: `Goal: ${goal}\nBegin.` }
        ];

        let loopCount = 0;

        while (loopCount < this.MAX_DEPTH) {
            loopCount++;
            this.outputChannel.appendLine(`\n>>> [Step ${loopCount}/${this.MAX_DEPTH}] Model is thinking...`);

            try {
                let responseContent = '';
                const stream = this.ollama.streamChat(messages, { 
                    model: 'hermes3:8b', 
                    temperature: 0.1, 
                    stop: ['</tool_call>'] 
                });

                for await (const chunk of stream) {
                    responseContent += chunk;
                }

                if (responseContent.includes('<tool_call>') && !responseContent.includes('</tool_call>')) {
                    responseContent += '</tool_call>';
                }

                messages.push({ role: 'assistant', content: responseContent });

                const toolCallMatch = responseContent.match(/<tool_call>([\s\S]*?)<\/tool_call>/);
                
                if (toolCallMatch) {
                    const rawJson = toolCallMatch[1].trim();
                    try {
                        const toolCall = JSON.parse(rawJson);
                        this.outputChannel.appendLine(`\n[Tool Invocation]: ${toolCall.name}`);
                        this.outputChannel.appendLine(`[Tool Arguments]: ${JSON.stringify(toolCall.arguments)}`);
                        
                        let toolResult = '';
                        if (toolCall.name === 'readFile') {
                            toolResult = await this.readFile(toolCall.arguments.path);
                        } else if (toolCall.name === 'writeFile') {
                            toolResult = await this.writeFile(toolCall.arguments.path, toolCall.arguments.content);
                        } else if (toolCall.name === 'executeCommand') {
                            const command = toolCall.arguments.command;
                            const choice = await vscode.window.showWarningMessage(
                                `Agent wants to execute command:\n\n${command}`,
                                { modal: true },
                                "Approve Run",
                                "Reject & Cancel Loop"
                            );

                            if (choice === "Approve Run") {
                                toolResult = await this.executeCommand(command);
                            } else {
                                logger.error(`Agent execution rejected by user. Command: ${command}`);
                                this.outputChannel.appendLine(`\n[Agent Terminated]: Loop cancelled by user due to rejected execution.`);
                                break;
                            }
                        } else {
                            toolResult = `Error: Tool '${toolCall.name}' not found.`;
                        }

                        const truncatedResult = toolResult.length > 2000 ? toolResult.substring(0, 2000) + '\n...[Truncated]' : toolResult;
                        this.outputChannel.appendLine(`\n[Tool Result]:\n${truncatedResult}`);
                        
                        messages.push({
                            role: 'user',
                            content: `Tool response:\n${toolResult}\nProceed with the next step or conclude if finished.`
                        });

                    } catch (parseError: any) {
                        this.outputChannel.appendLine(`\n[Parse Error]: Failed to parse tool execution JSON. ${parseError.message}`);
                        messages.push({
                            role: 'user',
                            content: `System Error: Failed to parse tool call JSON. Ensure it is valid JSON. Error: ${parseError.message}`
                        });
                    }
                } else {
                    this.outputChannel.appendLine(`\n[Agent Concluded Task]:\n${responseContent.trim()}`);
                    break;
                }

            } catch (error: any) {
                this.outputChannel.appendLine(`\n[Communication Error]: ${error.message}`);
                break;
            }
        }

        if (loopCount >= this.MAX_DEPTH) {
            this.outputChannel.appendLine(`\n[Agent Terminated]: Maximum loop depth (${this.MAX_DEPTH}) reached to prevent infinite loops.`);
        }
    }
}
