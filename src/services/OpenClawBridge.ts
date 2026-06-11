import * as vscode from 'vscode';
import * as http from 'http';
import * as fs from 'fs/promises';
import * as path from 'path';
import { OllamaClient } from './OllamaClient';
import { ContextCrawler } from './ContextCrawler';
import { logger } from '../utils/Logger';

export class OpenClawBridge {
    private server: http.Server | null = null;
    private port = 11435;
    private crawler = new ContextCrawler();
    private outputChannel: vscode.OutputChannel;
    private static instance: OpenClawBridge | null = null;
    private activeLogs: string[] = [];

    private constructor(private readonly ollama: OllamaClient) {
        this.outputChannel = vscode.window.createOutputChannel('HermesForge Bridge Server');
    }

    public static getInstance(ollama: OllamaClient): OpenClawBridge {
        if (!OpenClawBridge.instance) {
            OpenClawBridge.instance = new OpenClawBridge(ollama);
        }
        return OpenClawBridge.instance;
    }

    private getWorkspaceRoot(): string {
        const folders = vscode.workspace.workspaceFolders;
        return folders && folders.length > 0 ? folders[0].uri.fsPath : process.cwd();
    }

    private log(message: string): void {
        const timestamp = new Date().toLocaleTimeString();
        const formatted = `[${timestamp}] ${message}`;
        this.activeLogs.push(formatted);
        if (this.activeLogs.length > 100) {
            this.activeLogs.shift();
        }
        this.outputChannel.appendLine(formatted);
        logger.info(`[OpenClawBridge] ${message}`);
    }

    public getLogs(): string[] {
        return this.activeLogs;
    }

    /**
     * Starts the HTTP JSON-RPC bridge server if enabled.
     */
    public async start(): Promise<void> {
        const config = vscode.workspace.getConfiguration('hermes-forge');
        const enabled = config.get<boolean>('nodeEnabled') !== false;
        this.port = config.get<number>('nodePort') || 11435;

        if (!enabled) {
            this.log('Bridge server is disabled in VS Code configurations. Skipping initialization.');
            return;
        }

        if (this.server) {
            this.log('Server is already active. Restarting...');
            await this.stop();
        }

        this.server = http.createServer((req, res) => this.handleRequest(req, res));

        return new Promise<void>((resolve, reject) => {
            this.server?.listen(this.port, '127.0.0.1', () => {
                this.log(`🚀 HermesForge Local Node online at http://127.0.0.1:${this.port}`);
                this.log('Compatible with OpenClaw Node API and external Hermes coordinates.');
                resolve();
            });

            this.server?.on('error', (err: any) => {
                this.log(`🚨 Server initialization failure: ${err.message}`);
                reject(err);
            });
        });
    }

    /**
     * Shuts down the background HTTP server.
     */
    public async stop(): Promise<void> {
        if (this.server) {
            return new Promise<void>((resolve) => {
                this.server?.close(() => {
                    this.log('🛑 HermesForge Bridge Server terminated cleanly.');
                    this.server = null;
                    resolve();
                });
            });
        }
    }

    private async handleRequest(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
        // Enforce secure localhost local-only ingress
        const remote = req.socket.remoteAddress;
        if (remote !== '127.0.0.1' && remote !== '::1' && remote !== '::ffff:127.0.0.1') {
            this.log(`🛡️ Blocked cross-origin request attempt from unauthorized address: ${remote}`);
            res.writeHead(403, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'Insecure cross-origin request blocked.' }));
            return;
        }

        // Set response headers
        res.setHeader('Content-Type', 'application/json');
        res.setHeader('Access-Control-Allow-Origin', '*');
        res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
        res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

        if (req.method === 'OPTIONS') {
            res.writeHead(204);
            res.end();
            return;
        }

        const url = req.url || '/';
        this.log(`Incoming Request: ${req.method} ${url}`);

        try {
            if (req.method === 'GET' && url === '/status') {
                await this.handleStatus(res);
            } else if (req.method === 'GET' && url === '/files') {
                await this.handleGetFiles(res);
            } else if (req.method === 'POST' && url === '/file/read') {
                await this.handleReadFile(req, res);
            } else if (req.method === 'POST' && url === '/file/write') {
                await this.handleWriteFile(req, res);
            } else if (req.method === 'POST' && url === '/command/execute') {
                await this.handleExecuteCommand(req, res);
            } else if (req.method === 'GET' && url === '/premium/status') {
                await this.handlePremiumStatus(res);
            } else {
                res.writeHead(404);
                res.end(JSON.stringify({ error: `Not Found: ${url}` }));
            }
        } catch (err: any) {
            this.log(`Request handling exception error: ${err.message}`);
            res.writeHead(500);
            res.end(JSON.stringify({ error: 'Internal Bridge Error: ' + err.message }));
        }
    }

    private async readRequestBody(req: http.IncomingMessage): Promise<any> {
        return new Promise((resolve, reject) => {
            let body = '';
            req.on('data', chunk => {
                body += chunk.toString();
            });
            req.on('end', () => {
                try {
                    resolve(body ? JSON.parse(body) : {});
                } catch {
                    reject(new Error('Invalid JSON format in payload.'));
                }
            });
            req.on('error', (err) => reject(err));
        });
    }

    private async handleStatus(res: http.ServerResponse): Promise<void> {
        const config = vscode.workspace.getConfiguration('hermes-forge');
        const activeEditor = vscode.window.activeTextEditor;
        const ollamaStatus = this.ollama.getStatus();

        const payload = {
            status: 'online',
            nodeType: 'Hermes-Forge Local Agent Node',
            protocolVersion: '1.0.0-Beta',
            workspaceRoot: this.getWorkspaceRoot(),
            activeFile: activeEditor ? activeEditor.document.fileName : null,
            activeSelection: activeEditor && !activeEditor.selection.isEmpty 
                ? activeEditor.document.getText(activeEditor.selection) 
                : null,
            ollama: {
                connected: ollamaStatus.connected,
                baseUrl: this.ollama.baseUrl,
                modelChat: this.ollama.modelChat,
                modelCompletion: this.ollama.modelCompletion,
                availableModels: ollamaStatus.models
            },
            config: {
                enableCloudFallback: !!config.get<boolean>('enableCloudFallback'),
                premiumAdvancedRAG: !!config.get<boolean>('premiumAdvancedRAG'),
                contextLimits: config.get<number>('contextLimits') || 1536
            }
        };

        res.writeHead(200);
        res.end(JSON.stringify(payload));
    }

    private async handlePremiumStatus(res: http.ServerResponse): Promise<void> {
        const config = vscode.workspace.getConfiguration('hermes-forge');
        const cloudEnabled = !!config.get<boolean>('enableCloudFallback');
        const ragEnabled = !!config.get<boolean>('premiumAdvancedRAG');

        const payload = {
            premiumLicensed: cloudEnabled || ragEnabled,
            tier: (cloudEnabled && ragEnabled) ? 'HermesForge Enterprise' : (cloudEnabled || ragEnabled ? 'HermesForge Pro' : 'Free Sandbox Tier'),
            features: {
                cloudModelFallback: cloudEnabled ? 'ACTIVE (Opt-in)' : 'INACTIVE (Offered in Settings)',
                advancedSemanticRAG: ragEnabled ? 'ACTIVE (Opt-in)' : 'INACTIVE (Offered in Settings)',
                localLocalNodePort: this.port
            },
            telemetrySummary: {
                logsCached: this.activeLogs.length,
                healthStatus: 'Excellent (100% Offline)'
            }
        };

        res.writeHead(200);
        res.end(JSON.stringify(payload));
    }

    private async handleGetFiles(res: http.ServerResponse): Promise<void> {
        try {
            const root = this.getWorkspaceRoot();
            this.log('Context crawling workspace files tree for external orchestrator...');
            const files = await this.crawler.crawlDirectory(root); // Depth-free recursive tree scan
            
            res.writeHead(200);
            res.end(JSON.stringify({ files }));
        } catch (err: any) {
            res.writeHead(500);
            res.end(JSON.stringify({ error: err.message }));
        }
    }

    private async handleReadFile(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
        try {
            const body = await this.readRequestBody(req);
            const relativePath = body.path;

            if (!relativePath) {
                res.writeHead(400);
                res.end(JSON.stringify({ error: 'Missing "path" string attribute.' }));
                return;
            }

            const root = this.getWorkspaceRoot();
            const fullPath = path.resolve(root, relativePath);

            // Double check safety path escapes
            if (!fullPath.startsWith(root)) {
                this.log(`⚠️ Prevented out-of-workspace read request at: ${fullPath}`);
                res.writeHead(403);
                res.end(JSON.stringify({ error: 'Access Denied: Path resides outside workspace bounds.' }));
                return;
            }

            const content = await fs.readFile(fullPath, 'utf8');
            res.writeHead(200);
            res.end(JSON.stringify({ path: relativePath, content }));
        } catch (err: any) {
            res.writeHead(500);
            res.end(JSON.stringify({ error: err.message }));
        }
    }

    private async handleWriteFile(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
        try {
            const body = await this.readRequestBody(req);
            const relativePath = body.path;
            const content = body.content;

            if (!relativePath || content === undefined) {
                res.writeHead(400);
                res.end(JSON.stringify({ error: 'Missing "path" or "content" parameters.' }));
                return;
            }

            const root = this.getWorkspaceRoot();
            const fullPath = path.resolve(root, relativePath);

            // Path escapes check
            if (!fullPath.startsWith(root)) {
                this.log(`⚠️ Prevented out-of-workspace write request at: ${fullPath}`);
                res.writeHead(403);
                res.end(JSON.stringify({ error: 'Access Denied: Path resides outside workspace boundaries.' }));
                return;
            }

            // Gated behind user interactive check prompt
            const approvalChoice = await vscode.window.showInformationMessage(
                `🛡️ EXTERNAL NODE REQUEST: Write to file "${relativePath}"?`,
                { modal: true },
                'Approve & Apply Write',
                'Reject Request'
            );

            if (approvalChoice !== 'Approve & Apply Write') {
                this.log(`❌ User rejected external write request for: ${relativePath}`);
                res.writeHead(401);
                res.end(JSON.stringify({ error: 'Write request rejected by user.' }));
                return;
            }

            await fs.mkdir(path.dirname(fullPath), { recursive: true });
            await fs.writeFile(fullPath, content, 'utf8');
            this.log(`🟢 Successfully wrote external content to: ${relativePath}`);

            res.writeHead(200);
            res.end(JSON.stringify({ success: true, path: relativePath }));
        } catch (err: any) {
            res.writeHead(500);
            res.end(JSON.stringify({ error: err.message }));
        }
    }

    private async handleExecuteCommand(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
        try {
            const body = await this.readRequestBody(req);
            const cmd = body.command;
            const args = body.args || [];

            if (!cmd) {
                res.writeHead(400);
                res.end(JSON.stringify({ error: 'Missing "command" string parameter.' }));
                return;
            }

            // Gated behind interactive security validation
            const approvalChoice = await vscode.window.showWarningMessage(
                `🛡️ SECURITY INTERCEPT: Allow external agent to execute VS Code command "${cmd}"?`,
                { modal: true },
                'Execute',
                'Block Command'
            );

            if (approvalChoice !== 'Execute') {
                this.log(`❌ Blocked execution sequence for command: ${cmd} on user request.`);
                res.writeHead(401);
                res.end(JSON.stringify({ error: 'Command execution blocked by security policy.' }));
                return;
            }

            this.log(`⚙️ Executing command "${cmd}" on behalf of client...`);
            const outcome = await vscode.commands.executeCommand(cmd, ...args);

            res.writeHead(200);
            res.end(JSON.stringify({ success: true, command: cmd, outcome }));
        } catch (err: any) {
            this.log(`Failure executing command via bridge: ${err.message}`);
            res.writeHead(500);
            res.end(JSON.stringify({ error: err.message }));
        }
    }
}
