import * as vscode from 'vscode';
import { OllamaClient } from './services/OllamaClient';
import { AutocompleteProvider } from './modules/AutocompleteProvider';
import { ChatWebviewProvider } from './modules/ChatWebviewProvider';
import { DashboardViewProvider } from './modules/DashboardViewProvider';
import { AgentEngine, activeSubprocesses } from './modules/AgentEngine';
import { AgentRouter } from './services/AgentRouter';
import { LegacyMigrator } from './services/LegacyMigrator';
import { PerformanceAuditor } from './services/PerformanceAuditor';
import { PRGenerator } from './services/PRGenerator';
import { HardwareProfiler } from './services/HardwareProfiler';
import { OpenClawBridge } from './services/OpenClawBridge';
import { ContextCrawler } from './services/ContextCrawler';
import { logger } from './utils/Logger';
import * as fs from 'fs/promises';
import * as path from 'path';

let ollamaInstance: OllamaClient | null = null;
let bridgeInstance: OpenClawBridge | null = null;

export function activate(context: vscode.ExtensionContext) {
    logger.info('HermesForge extension activating...');

    // Initialize OllamaClient dynamically from workspace configurations
    const extConfig = vscode.workspace.getConfiguration('hermes-forge');
    const baseUrl = extConfig.get<string>('ollamaBaseUrl') || 'http://localhost:11434';
    const modelCompletion = extConfig.get<string>('modelCompletion') || 'qwen2.5-coder:1.5b';
    const modelChat = extConfig.get<string>('modelChat') || 'hermes3:8b';

    const ollama = new OllamaClient({
        baseUrl,
        modelCompletion,
        modelChat
    });
    ollamaInstance = ollama;

    // Boot OpenClaw and Hermes Forge local API bridge server
    const bridge = OpenClawBridge.getInstance(ollama);
    bridge.start().catch((err: any) => {
        logger.error('Failed to start OpenClaw / Hermes local bridge server', err);
    });
    bridgeInstance = bridge;

    // Start background health checking heartbeat
    ollama.startHeartbeat();

    // Create a status bar item for connection tracking
    const statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
    statusBarItem.command = 'hermes-forge.showOllamaSetup';
    statusBarItem.text = '$(sync~spin) HermesForge: Connecting...';
    statusBarItem.show();
    context.subscriptions.push(statusBarItem);

    // Subscribe status bar to heartbeat status changes
    const unsubscribeStatus = ollama.onStatusChange((status) => {
        if (!status.connected) {
            statusBarItem.text = '$(warning) Ollama Offline';
            statusBarItem.tooltip = `Failed to connect to Ollama at ${ollama.baseUrl}. Click to view Setup Guide.`;
            statusBarItem.backgroundColor = new vscode.ThemeColor('statusBarItem.warningBackground');
        } else if (!status.completionModelExists || !status.chatModelExists) {
            const missing = [];
            if (!status.completionModelExists) missing.push(ollama.modelCompletion);
            if (!status.chatModelExists) missing.push(ollama.modelChat);
            
            statusBarItem.text = '$(alert) Ollama Models Missing';
            statusBarItem.tooltip = `Ollama connected, but missing required models: ${missing.join(', ')}. Click to view Pull Guide.`;
            statusBarItem.backgroundColor = new vscode.ThemeColor('statusBarItem.warningBackground');
        } else {
            statusBarItem.text = '$(hubot) Ollama Online';
            statusBarItem.tooltip = `Ollama fully operational with modern fast models. BaseUrl: ${ollama.baseUrl}`;
            statusBarItem.backgroundColor = undefined;
        }
    });

    // Handle configuration shifts on active setting adjustments
    const configListener = vscode.workspace.onDidChangeConfiguration((e) => {
        if (e.affectsConfiguration('hermes-forge')) {
            const upConfig = vscode.workspace.getConfiguration('hermes-forge');
            ollama.baseUrl = upConfig.get<string>('ollamaBaseUrl') || 'http://localhost:11434';
            ollama.modelCompletion = upConfig.get<string>('modelCompletion') || 'qwen2.5-coder:1.5b';
            ollama.modelChat = upConfig.get<string>('modelChat') || 'hermes3:8b';
            
            statusBarItem.text = '$(sync~spin) HermesForge: Config Updated';
            ollama.checkConnection().then(() => ollama.checkModels());

            if (e.affectsConfiguration('hermes-forge.nodePort') || e.affectsConfiguration('hermes-forge.nodeEnabled')) {
                bridge.start().catch((err: any) => {
                    vscode.window.showErrorMessage(`Failed to reload bridge server: ${err.message}`);
                });
            }
        }
    });
    context.subscriptions.push(configListener);

    // Clean up status change subscription on deactivate
    context.subscriptions.push({
        dispose: () => {
            unsubscribeStatus();
        }
    });

    // Register Fast Inline Autocomplete provider
    const inlineProvider = vscode.languages.registerInlineCompletionItemProvider(
        { pattern: '**' },
        new AutocompleteProvider(ollama)
    );
    context.subscriptions.push(inlineProvider);

    // Register Sidebar Context Chat & attach Router
    const sidebarProvider = new ChatWebviewProvider(context.extensionUri, ollama);
    const chatView = vscode.window.registerWebviewViewProvider(
        ChatWebviewProvider.viewType,
        sidebarProvider,
        { webviewOptions: { retainContextWhenHidden: true } }
    );
    context.subscriptions.push(chatView);

    // Register Sidebar Core Dashboard View
    const dashboardProvider = new DashboardViewProvider(context.extensionUri, ollama);
    const dashboardView = vscode.window.registerWebviewViewProvider(
        DashboardViewProvider.viewType,
        dashboardProvider,
        { webviewOptions: { retainContextWhenHidden: true } }
    );
    context.subscriptions.push(dashboardView);

    // Initialize the Multi-Agent Router and wire it back to the sidebar chat
    const agentRouter = new AgentRouter(ollama, sidebarProvider);
    sidebarProvider.setRouter(agentRouter);

    // Register Agentic Loop Command (Explicit Trigger)
    const agentCommand = vscode.commands.registerCommand('hermes-forge.runAgent', async () => {
        let contextHint = '';
        const editor = vscode.window.activeTextEditor;
        
        if (editor && !editor.selection.isEmpty) {
            const selectedStr = editor.document.getText(editor.selection);
            contextHint = ` (Context: "${selectedStr}")`;
        }

        const goal = await vscode.window.showInputBox({ 
            prompt: 'What should the agent execute?',
            placeHolder: 'e.g. Build a React scaffold, or find and fix type errors',
            value: contextHint ? 'Refactor this block: ' : ''
        });
        
        if (goal) {
            const agent = new AgentEngine(ollama);
            await agent.startAgentLoop(goal + contextHint);
        }
    });
    context.subscriptions.push(agentCommand);

    // Register the Guided Setup Prompt Command
    const setupCommand = vscode.commands.registerCommand('hermes-forge.showOllamaSetup', async () => {
        const currentStatus = ollama.getStatus();
        
        if (!currentStatus.connected) {
            const choice = await vscode.window.showErrorMessage(
                `HermesForge cannot connect to Ollama at ${ollama.baseUrl}. Would you like help configuring?`,
                'Show Installation Guide',
                'Retry Connection'
            );
            
            if (choice === 'Show Installation Guide') {
                vscode.env.openExternal(vscode.Uri.parse('https://ollama.com'));
            } else if (choice === 'Retry Connection') {
                const connected = await ollama.checkConnection();
                if (connected) {
                    vscode.window.showInformationMessage('🟢 Connection successful! Ollama is now online.');
                } else {
                    vscode.window.showErrorMessage('🔴 Retry failed. Please make sure Ollama is installed and running.');
                }
            }
        } else if (!currentStatus.completionModelExists || !currentStatus.chatModelExists) {
            const missing = [];
            if (!currentStatus.completionModelExists) missing.push(ollama.modelCompletion);
            if (!currentStatus.chatModelExists) missing.push(ollama.modelChat);
            
            const choice = await vscode.window.showWarningMessage(
                `Ollama is running, but missing required models: ${missing.join(', ')}.`,
                'Copy Pull Commands',
                'Show Model list'
            );
            
            if (choice === 'Copy Pull Commands') {
                const commands = missing.map(m => `ollama pull ${m}`).join(' && ');
                await vscode.env.clipboard.writeText(commands);
                vscode.window.showInformationMessage(`Copied to clipboard: "${commands}"`);
            } else if (choice === 'Show Model list') {
                vscode.window.showInformationMessage(`Available local models: ${currentStatus.models.join(', ') || 'none'}`);
            }
        } else {
            vscode.window.showInformationMessage('🟢 HermesForge is connected and all local models are properly cached!');
        }
    });
    context.subscriptions.push(setupCommand);

    // Register Legacy Migration Agent
    const legacyMigrateCommand = vscode.commands.registerCommand('hermes-forge.legacyMigrate', async () => {
        const migrator = new LegacyMigrator(ollama);
        await migrator.migrateActiveFile();
    });
    context.subscriptions.push(legacyMigrateCommand);

    // Register Performance Auditor
    const perfAuditCommand = vscode.commands.registerCommand('hermes-forge.perfAudit', async () => {
        const auditor = new PerformanceAuditor(ollama);
        await auditor.auditActiveFile();
    });
    context.subscriptions.push(perfAuditCommand);

    // Register Codebase Oracle Mode
    const codebaseOracleCommand = vscode.commands.registerCommand('hermes-forge.codebaseOracle', async () => {
        const { CodebaseOracle } = await import('./services/CodebaseOracle');
        const oracle = new CodebaseOracle(ollama);
        await oracle.consultOracle();
    });
    context.subscriptions.push(codebaseOracleCommand);

    // Register Git PR Generator
    const prSummaryCommand = vscode.commands.registerCommand('hermes-forge.generatePrSummary', async () => {
        const prGen = new PRGenerator(ollama);
        await prGen.generatePRMetadata();
    });
    context.subscriptions.push(prSummaryCommand);

    // Register Hardware Benchmark Profiler
    const benchmarkCommand = vscode.commands.registerCommand('hermes-forge.benchmarkHardware', async () => {
        await vscode.window.withProgress({
            location: vscode.ProgressLocation.Notification,
            title: 'HermesForge: Benchmarking local hardware...',
            cancellable: false
        }, async (progress) => {
            try {
                // Read system RAM & speed stats
                progress.report({ message: 'Running direct speed profiling against local Ollama...' });
                const stats = await HardwareProfiler.runSpeedTest(ollama);
                const optimalConfig = await HardwareProfiler.getOptimalModelConfig();

                const channel = vscode.window.createOutputChannel('HermesForge Hardware Benchmarking');
                channel.show(true);
                channel.clear();
                channel.appendLine('========================================');
                channel.appendLine('💻 HERMESFORGE HARDWARE BENCHMARK DEVICE PROFILE');
                channel.appendLine('========================================');
                channel.appendLine(`- System Memory Size: ${optimalConfig.totalMemoryGB} GB`);
                channel.appendLine(`- Available Memory Memory: ${optimalConfig.freeMemoryGB} GB`);
                channel.appendLine(`- Local Hostname Resolution: ${optimalConfig.offlineMode ? 'STRICLY OFFLINE MODE' : 'ROUTABLE ONLINE MODE'}`);
                channel.appendLine(`- Inference Speed Measured: ${stats.tps} words/sec`);
                channel.appendLine(`- Time to First Token (TTFT): ${stats.ttft} ms`);
                channel.appendLine(`- Model Assigned Keep-Alive Duration: ${optimalConfig.options.keep_alive}`);
                channel.appendLine(`- Compute Threads Assigned: ${optimalConfig.options.num_thread}`);
                channel.appendLine(`- Active context limit assigned: ${optimalConfig.options.num_ctx} bytes`);
                channel.appendLine('========================================');

                vscode.window.showInformationMessage(`🟢 Hardware Benchmark completed! Measured Speed: ${stats.tps} words/second.`);
                
                // Route results to update Dashboard webview gauges
                dashboardProvider.postMessage({
                    type: 'benchmarkResult',
                    stats,
                    config: {
                        totalMemoryGB: optimalConfig.totalMemoryGB,
                        freeMemoryGB: optimalConfig.freeMemoryGB,
                        threads: optimalConfig.options.num_thread,
                        ctx: optimalConfig.options.num_ctx,
                        keepAlive: optimalConfig.options.keep_alive
                    }
                });
            } catch (err: any) {
                vscode.window.showErrorMessage(`Hardware Benchmark failed: ${err.message}`);
            }
        });
    });
    context.subscriptions.push(benchmarkCommand);

    // Register Project Context Exporter for External Agents
    const exportContextCommand = vscode.commands.registerCommand('hermes-forge.exportContext', async () => {
        await vscode.window.withProgress({
            location: vscode.ProgressLocation.Notification,
            title: 'HermesForge: Bundling workspace context...',
            cancellable: false
        }, async (progress) => {
            try {
                const folders = vscode.workspace.workspaceFolders;
                const root = folders && folders.length > 0 ? folders[0].uri.fsPath : process.cwd();
                
                progress.report({ message: 'Crawling active directories...' });
                const crawler = new ContextCrawler();
                const files = await crawler.crawlDirectory(root);

                progress.report({ message: `Reading ${files.length} context files...` });
                const bundle: { path: string; size: number; content: string }[] = [];

                for (const file of files) {
                    const relativePath = path.relative(root, file);
                    try {
                        const content = await fs.readFile(file, 'utf8');
                        bundle.push({
                            path: relativePath,
                            size: content.length,
                            content
                        });
                    } catch {}
                }

                progress.report({ message: 'Writing compressed JSON bundle payload...' });
                const telemetryDir = path.join(root, '.telemetry');
                await fs.mkdir(telemetryDir, { recursive: true });
                const targetBundlePath = path.join(telemetryDir, 'project_context.json');
                
                await fs.writeFile(targetBundlePath, JSON.stringify({
                    exportedAt: new Date().toISOString(),
                    workspaceRoot: root,
                    filesCount: bundle.length,
                    files: bundle
                }, null, 2), 'utf8');

                vscode.window.showInformationMessage(`🟢 Workspace context bundled successfully! Saved ${bundle.length} files to: .telemetry/project_context.json`);
            } catch (err: any) {
                vscode.window.showErrorMessage(`Context compilation failed: ${err.message}`);
            }
        });
    });
    context.subscriptions.push(exportContextCommand);
}

export function deactivate() {
    logger.info('HermesForge extension deactivating...');
    
    // Stop local bridge server
    if (bridgeInstance) {
        bridgeInstance.stop().catch(err => logger.error('Error stopping bridge server', err));
        bridgeInstance = null;
    }

    // Stop Ollama heartbeat timer
    if (ollamaInstance) {
        ollamaInstance.stopHeartbeat();
        ollamaInstance = null;
    }

    // Cleanly wind down any running local terminal subprocesses
    if (activeSubprocesses.length > 0) {
        logger.info(`Killing ${activeSubprocesses.length} child processes...`);
        for (const proc of activeSubprocesses) {
            if (proc && !proc.killed) {
                proc.kill('SIGKILL');
            }
        }
        activeSubprocesses.length = 0;
    }
}

