import * as vscode from 'vscode';
import * as fs from 'fs/promises';
import * as path from 'path';
import { OllamaClient } from '../services/OllamaClient';
import { ExecutiveOrchestrator } from '../services/ExecutiveOrchestrator';
import { HardwareProfiler } from '../services/HardwareProfiler';
import { logger } from '../utils/Logger';

export class DashboardViewProvider implements vscode.WebviewViewProvider {
    public static readonly viewType = 'hermes-forge.dashboardView';
    private _view?: vscode.WebviewView;

    constructor(
        private readonly _extensionUri: vscode.Uri,
        private readonly ollama: OllamaClient
    ) {}

    public postMessage(message: any): void {
        if (this._view) {
            this._view.webview.postMessage(message);
        }
    }

    public async refreshVelocityMetrics(): Promise<void> {
        if (this._view) {
            try {
                const { DevVelocityManager } = await import('../services/DevVelocityManager');
                const metrics = await DevVelocityManager.getInstance().getMetrics();
                this._view.webview.postMessage({
                    type: 'velocityMetrics',
                    metrics
                });
            } catch (err: any) {
                logger.error('Failed to post velocity metrics to webview', err);
            }
        }
    }

    public resolveWebviewView(
        webviewView: vscode.WebviewView,
        _context: vscode.WebviewViewResolveContext,
        _token: vscode.CancellationToken
    ): void {
        this._view = webviewView;

        webviewView.webview.options = {
            enableScripts: true,
            localResourceRoots: [this._extensionUri]
        };

        webviewView.webview.html = this._getHtmlForWebview();

        const sendConfigUpdate = () => {
            if (this._view) {
                const config = vscode.workspace.getConfiguration('hermes-forge');
                this._view.webview.postMessage({
                    type: 'configUpdate',
                    enableCloudFallback: !!config.get<boolean>('enableCloudFallback'),
                    premiumAdvancedRAG: !!config.get<boolean>('premiumAdvancedRAG'),
                    fastDraftMode: !!config.get<boolean>('fastDraftMode'),
                    aiLaborTeamSize: config.get<number>('aiLaborTeamSize') || 3,
                    nodePort: config.get<number>('nodePort') || 11435,
                    nodeEnabled: config.get<boolean>('nodeEnabled') !== false
                });
                // Sync DevVelocity metrics on hydration
                this.refreshVelocityMetrics();
            }
        };

        const unsubscribe = this.ollama.onStatusChange((status) => {
            if (this._view) {
                this._view.webview.postMessage({
                    type: 'connectionStatus',
                    status,
                    modelCompletion: this.ollama.modelCompletion,
                    modelChat: this.ollama.modelChat
                });
                sendConfigUpdate();
            }
        });

        const configDisposable = vscode.workspace.onDidChangeConfiguration((e) => {
            if (e.affectsConfiguration('hermes-forge')) {
                sendConfigUpdate();
            }
        });

        // Set up background polling for real-time hardware telemetry (CPU & RAM)
        const metricsInterval = setInterval(async () => {
            if (webviewView.visible) {
                try {
                    const metrics = await HardwareProfiler.getLiveMetrics();
                    webviewView.webview.postMessage({
                        type: 'liveHardwareMetrics',
                        metrics
                    });
                } catch (err: any) {
                    logger.error('Failed to post live hardware metrics to webview', err);
                }
            }
        }, 3000);

        webviewView.onDidDispose(() => {
            clearInterval(metricsInterval);
            unsubscribe();
            configDisposable.dispose();
        });

        // Push initial configs after 800ms to allow webview hydration
        setTimeout(sendConfigUpdate, 800);

        webviewView.webview.onDidReceiveMessage(async (data) => {
            if (data.type === 'startPipeline') {
                await this.handlePipelineTrigger(data.value);
            } else if (data.type === 'retryConnection') {
                const connected = await this.ollama.checkConnection();
                if (connected) {
                    vscode.window.showInformationMessage('🟢 Connection successful! Ollama is now online.');
                } else {
                    vscode.window.showErrorMessage('🔴 Could not connect. Ensure Ollama service is active.');
                }
            } else if (data.type === 'runSetupGuide') {
                vscode.commands.executeCommand('hermes-forge.showOllamaSetup');
            } else if (data.type === 'triggerBenchmark') {
                vscode.commands.executeCommand('hermes-forge.benchmarkHardware');
            } else if (data.type === 'triggerMigration') {
                vscode.commands.executeCommand('hermes-forge.legacyMigrate');
            } else if (data.type === 'triggerAudit') {
                vscode.commands.executeCommand('hermes-forge.perfAudit');
            } else if (data.type === 'triggerPrSummary') {
                vscode.commands.executeCommand('hermes-forge.generatePrSummary');
            } else if (data.type === 'submitFeedback') {
                const feedbackText = data.feedback;
                if (feedbackText && feedbackText.trim()) {
                    try {
                        const folders = vscode.workspace.workspaceFolders;
                        const root = folders && folders.length > 0 ? folders[0].uri.fsPath : process.cwd();
                        const telemetryDir = path.join(root, '.telemetry');
                        await fs.mkdir(telemetryDir, { recursive: true });
                        const feedbackFile = path.join(telemetryDir, 'feedback.json');
                        let currentFeedbacks: any[] = [];
                        try {
                            const raw = await fs.readFile(feedbackFile, 'utf8');
                            currentFeedbacks = JSON.parse(raw);
                        } catch {}
                        currentFeedbacks.push({
                            timestamp: new Date().toISOString(),
                            feedback: feedbackText,
                            licenseTier: 'Individual Offline Sandbox'
                        });
                        await fs.writeFile(feedbackFile, JSON.stringify(currentFeedbacks, null, 2), 'utf8');
                        vscode.window.showInformationMessage('🟢 Thank you! Your feedback has been recorded safely in your local telemetry database.');
                    } catch (err: any) {
                        vscode.window.showErrorMessage(`Failed to record feedback offline: ${err.message}`);
                    }
                }
            } else if (data.type === 'togglePremiumFlag') {
                const config = vscode.workspace.getConfiguration('hermes-forge');
                const flag = data.flag; // 'enableCloudFallback' | 'premiumAdvancedRAG'
                const current = !!config.get<boolean>(flag);
                await config.update(flag, !current, vscode.ConfigurationTarget.Global);
                vscode.window.showInformationMessage(`Premium Setting Saved: ${flag} is now ${!current ? 'ENABLED' : 'DISABLED'}`);
                sendConfigUpdate();
            } else if (data.type === 'toggleFastDraftFlag') {
                const config = vscode.workspace.getConfiguration('hermes-forge');
                const current = !!config.get<boolean>('fastDraftMode');
                await config.update('fastDraftMode', !current, vscode.ConfigurationTarget.Global);
                vscode.window.showInformationMessage(`Fast-Draft Mode is now ${!current ? 'ENABLED' : 'DISABLED'}`);
                sendConfigUpdate();
            } else if (data.type === 'updateTeamSize') {
                const config = vscode.workspace.getConfiguration('hermes-forge');
                const value = parseInt(data.value, 10) || 3;
                await config.update('aiLaborTeamSize', value, vscode.ConfigurationTarget.Global);
                sendConfigUpdate();
            }
        });
    }

    private async handlePipelineTrigger(intent: string): Promise<void> {
        if (!this._view) return;

        // Reset and signal pipeline starting
        this._view.webview.postMessage({ type: 'pipelineStart' });

        const orchestrator = new ExecutiveOrchestrator(this.ollama);

        const workspaceFolders = vscode.workspace.workspaceFolders;
        const workspacePath = workspaceFolders && workspaceFolders.length > 0 ? workspaceFolders[0].uri.fsPath : process.cwd();

        try {
            await orchestrator.runExecutivePipeline(intent, workspacePath, (phase, status, message) => {
                if (this._view) {
                    this._view.webview.postMessage({
                        type: 'phaseUpdate',
                        phase,
                        status,
                        message
                    });
                }
            });

            this._view.webview.postMessage({ type: 'pipelineEnd', success: true });
        } catch (error: any) {
            logger.error(`[Dashboard] Pipeline execution failed: ${error.message || error}`);
            if (this._view) {
                this._view.webview.postMessage({ 
                    type: 'pipelineEnd', 
                    success: false, 
                    error: error.message || 'Unknown orchestrator failure' 
                });
            }
        }
    }

    private _getHtmlForWebview(): string {
        return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>HermesForge Dashboard</title>
    <style>
        :root {
            --bg-color: var(--vscode-editor-background, #0b0d10);
            --text-color: var(--vscode-editor-foreground, #cccccc);
            --border-color: var(--vscode-panel-border, #1f242d);
            --button-bg: var(--vscode-button-background, #007acc);
            --button-hover: var(--vscode-button-hoverBackground, #0062a3);
            --font-family: var(--vscode-font-family, monospace);
            --font-mono: var(--vscode-editor-font-family, 'Courier New', monospace);
            
            /* High fidelity Cyberpunk slate metrics */
            --neon-mint: #00ffaa;
            --neon-pink: #ff007f;
            --neon-orange: #ffaa00;
            --cool-blue: #00d2ff;
            --dark-surface: rgba(16, 21, 30, 0.7);
        }

        * {
            box-sizing: border-box;
            margin: 0;
            padding: 0;
        }

        body {
            font-family: var(--font-family);
            background-color: var(--bg-color);
            color: var(--text-color);
            padding: 12px;
            display: flex;
            flex-direction: column;
            gap: 16px;
            font-size: 12px;
            overflow-y: auto;
            min-height: 100vh;
        }

        /* Branding header */
        .header {
            border-bottom: 2px solid var(--border-color);
            padding-bottom: 8px;
            display: flex;
            align-items: center;
            justify-content: space-between;
        }

        .header h1 {
            font-family: var(--font-mono);
            font-size: 15px;
            color: var(--neon-mint);
            letter-spacing: 1px;
            text-transform: uppercase;
            font-weight: bold;
        }

        .header .pulse-badge {
            display: flex;
            align-items: center;
            gap: 6px;
            font-size: 10px;
            font-family: var(--font-mono);
            text-transform: uppercase;
            opacity: 0.8;
        }

        .pulse-dot {
            width: 8px;
            height: 8px;
            background-color: var(--neon-mint);
            border-radius: 50%;
            box-shadow: 0 0 8px var(--neon-mint);
            animation: pulse-glow 1.5s infinite;
        }

        @keyframes pulse-glow {
            0% { transform: scale(0.9); opacity: 0.6; }
            50% { transform: scale(1.1); opacity: 1; }
            100% { transform: scale(0.9); opacity: 0.6; }
        }

        /* Executive status panel */
        .matrix-container {
            display: flex;
            flex-direction: column;
            gap: 10px;
        }

        .section-title {
            font-family: var(--font-mono);
            font-size: 11px;
            text-transform: uppercase;
            color: var(--cool-blue);
            letter-spacing: 0.5px;
            margin-bottom: 4px;
        }

        .member-card {
            background-color: var(--dark-surface);
            border: 1px solid var(--border-color);
            border-radius: 4px;
            padding: 10px;
            display: flex;
            flex-direction: column;
            gap: 4px;
            transition: all 0.3s ease;
            position: relative;
            overflow: hidden;
        }

        .member-card::before {
            content: '';
            position: absolute;
            top: 0;
            left: 0;
            height: 100%;
            width: 3px;
            background-color: var(--border-color);
            transition: background-color 0.3s ease;
        }

        /* Statuses: Idle, Processing, Completed, Failed */
        .member-card.status-idle::before {
            background-color: #444;
        }
        .member-card.status-processing::before {
            background-color: var(--neon-orange);
            box-shadow: 0 0 6px var(--neon-orange);
        }
        .member-card.status-completed::before {
            background-color: var(--neon-mint);
            box-shadow: 0 0 6px var(--neon-mint);
        }
        .member-card.status-failed::before {
            background-color: var(--neon-pink);
            box-shadow: 0 0 6px var(--neon-pink);
        }

        .member-card.status-processing {
            border-color: rgba(255, 170, 0, 0.3);
            animation: border-flicker 2s infinite alternate;
        }

        @keyframes border-flicker {
            0% { border-color: rgba(255, 170, 0, 0.1); }
            100% { border-color: rgba(255, 170, 0, 0.4); }
        }

        .member-header {
            display: flex;
            align-items: center;
            justify-content: space-between;
        }

        .member-role {
            font-family: var(--font-mono);
            font-weight: bold;
            font-size: 11px;
            display: flex;
            align-items: center;
            gap: 6px;
        }

        .member-status-label {
            font-size: 9px;
            font-family: var(--font-mono);
            text-transform: uppercase;
            padding: 1px 5px;
            border-radius: 2px;
            background: rgba(255,255,255,0.05);
            letter-spacing: 0.5px;
        }

        .status-idle .member-status-label { color: #888; }
        .status-processing .member-status-label { color: var(--neon-orange); border: 1px solid rgba(255,170,0,0.3); }
        .status-completed .member-status-label { color: var(--neon-mint); border: 1px solid rgba(0,255,170,0.3); }
        .status-failed .member-status-label { color: var(--neon-pink); border: 1px solid rgba(255,0,127,0.3); }

        .member-desc {
            font-size: 11px;
            opacity: 0.7;
            line-height: 1.4;
        }

        .member-detail {
            font-family: var(--font-mono);
            font-size: 10px;
            color: #888;
            background: rgba(0,0,0,0.2);
            padding: 4px;
            border-radius: 2px;
            white-space: pre-wrap;
            word-break: break-all;
            display: none;
            border-left: 1px solid rgba(255,255,255,0.05);
        }

        .member-card.status-processing .member-detail,
        .member-card.status-completed .member-detail,
        .member-card.status-failed .member-detail {
            display: block;
        }

        /* Interactive terminal input area */
        .terminal-container {
            display: flex;
            flex-direction: column;
            gap: 8px;
            margin-top: 4px;
        }

        .terminal {
            background-color: #05070a;
            border: 1px solid var(--border-color);
            border-radius: 4px;
            padding: 8px;
            display: flex;
            flex-direction: column;
            gap: 6px;
            box-shadow: inset 0 0 10px rgba(0,0,0,0.8);
        }

        .terminal-header {
            display: flex;
            align-items: center;
            justify-content: space-between;
            font-size: 9px;
            color: #555;
            font-family: var(--font-mono);
            text-transform: uppercase;
            border-bottom: 1px solid rgba(255,255,255,0.05);
            padding-bottom: 4px;
        }

        .terminal-row {
            display: flex;
            align-items: flex-start;
            gap: 4px;
        }

        .terminal-prompt {
            color: var(--neon-mint);
            font-family: var(--font-mono);
            font-weight: bold;
            user-select: none;
        }

        .terminal-textarea {
            flex: 1;
            background: transparent;
            border: none;
            outline: none;
            color: #fff;
            font-family: var(--font-mono);
            font-size: 11px;
            resize: none;
            min-height: 50px;
            line-height: 1.4;
        }

        .terminal-textarea::placeholder {
            color: #444;
        }

        button {
            width: 100%;
            background-color: var(--dark-surface);
            color: var(--neon-mint);
            border: 1px solid var(--neon-mint);
            padding: 8px;
            cursor: pointer;
            font-family: var(--font-mono);
            text-transform: uppercase;
            letter-spacing: 1px;
            font-weight: bold;
            border-radius: 4px;
            transition: all 0.2s ease;
            display: flex;
            align-items: center;
            justify-content: center;
            gap: 6px;
        }

        button:hover:not(:disabled) {
            background-color: rgba(0, 255, 170, 0.1);
            box-shadow: 0 0 8px rgba(0, 255, 170, 0.3);
        }

        button:active:not(:disabled) {
            transform: scale(0.99);
        }

        button:disabled {
            border-color: var(--border-color);
            color: #555;
            cursor: not-allowed;
        }

        .pipeline-status-text {
            font-family: var(--font-mono);
            font-size: 10px;
            color: var(--neon-orange);
            text-align: center;
            text-transform: uppercase;
            display: none;
        }

        .loading-loader {
            display: inline-block;
            width: 12px;
            height: 12px;
            border: 2px solid rgba(0,255,170,0.2);
            border-radius: 50%;
            border-top-color: var(--neon-mint);
            animation: spin 0.8s linear infinite;
        }

        @keyframes spin {
            to { transform: rotate(360deg); }
        }

        .terminal-log {
            font-family: var(--font-mono);
            font-size: 10px;
            background: #000;
            border: 1px solid var(--border-color);
            padding: 6px;
            border-radius: 2px;
            max-height: 120px;
            overflow-y: auto;
            color: #aaa;
            white-space: pre-wrap;
            display: none;
        }

        /* Bento Grid Style for Advanced Fast Tools */
        .bento-grid {
            display: grid;
            grid-template-columns: 1fr 1fr;
            gap: 8px;
            margin-top: 6px;
        }
        .bento-card {
            background-color: var(--dark-surface);
            border: 1px solid var(--border-color);
            border-radius: 4px;
            padding: 10px;
            cursor: pointer;
            text-align: left;
            transition: all 0.2s ease;
            display: flex;
            flex-direction: column;
            gap: 2px;
        }
        .bento-card:hover {
            border-color: var(--cool-blue);
            background-color: rgba(0, 210, 255, 0.05);
            box-shadow: 0 0 6px rgba(0, 210, 255, 0.15);
        }
        .bento-title {
            font-family: var(--font-mono);
            font-size: 10px;
            font-weight: bold;
            color: var(--cool-blue);
            text-transform: uppercase;
            letter-spacing: 0.5px;
        }
        .bento-desc {
            font-size: 9px;
            opacity: 0.7;
            line-height: 1.3;
        }
        .toggle-container {
            border: 1px solid var(--border-color);
            background: rgba(255, 0, 127, 0.1);
            color: var(--neon-pink);
            transition: all 0.2s ease;
            padding: 2px 8px;
            border-radius: 2px;
            font-family: var(--font-mono);
            font-size: 9px;
            font-weight: bold;
        }
        .toggle-container.active {
            background: rgba(0, 255, 170, 0.1);
            color: var(--neon-mint);
            border-color: var(--neon-mint);
        }
    </style>
</head>
<body>

    <div class="header">
        <h1>HermesForge Core</h1>
        <div class="pulse-badge" id="setup-pulse-badge" style="cursor: pointer;" title="Click for guided local configuration">
            <div id="connection-pulse-dot" class="pulse-dot"></div>
            <span id="connection-pulse-text">CONNECTING</span>
        </div>
    </div>

    <!-- Live Executive Status Matrix -->
    <div class="matrix-container">
        <div class="section-title">Executive Status Matrix</div>

        <!-- Architect -->
        <div id="card-architect" class="member-card status-idle">
            <div class="member-header">
                <div class="member-role">🏛️ Chief Architect</div>
                <div class="member-status-label">Idle</div>
            </div>
            <div class="member-desc">Formulates structural configurations, initializes context directories, drafts operational maps.</div>
            <div class="member-detail" id="detail-architect">Ready to outline files...</div>
        </div>

        <!-- PM -->
        <div id="card-pm" class="member-card status-idle">
            <div class="member-header">
                <div class="member-role">📋 Product Manager</div>
                <div class="member-status-label">Idle</div>
            </div>
            <div class="member-desc">Creates insulated feature specifications, defines variable decisions, designs checklists.</div>
            <div class="member-detail" id="detail-pm">Awaiting system design...</div>
        </div>

        <!-- Engineer -->
        <div id="card-engineer" class="member-card status-idle">
            <div class="member-header">
                <div class="member-role">💻 Principal Engineer</div>
                <div class="member-status-label">Idle</div>
            </div>
            <div class="member-desc">Generates codeblocks, performs AST-constrained dependency edits, compiles typescript units.</div>
            <div class="member-detail" id="detail-engineer">Awaiting PM specs...</div>
        </div>

        <!-- QA -->
        <div id="card-qa" class="member-card status-idle">
            <div class="member-header">
                <div class="member-role">🛡️ QA Auditor</div>
                <div class="member-status-label">Idle</div>
            </div>
            <div class="member-desc">Performs logical assertion passes, analyzes compiler failure reports, drives healing loops.</div>
            <div class="member-detail" id="detail-qa">Awaiting candidate code...</div>
        </div>
    </div>

    <!-- Advanced Fast Actions Bento Grid -->
    <div class="matrix-container" style="margin-top: 4px;">
        <div class="section-title">Specialized AI Missions</div>
        <div class="bento-grid">
            <div class="bento-card" id="btn-legacy-migrate" title="Click to modernize your active legacy JavaScript document to clean TypeScript.">
                <span class="bento-title">🔄 JS to TS Migrator</span>
                <span class="bento-desc">Type declarations, exports and unit tests drafts.</span>
            </div>
            <div class="bento-card" id="btn-perf-audit" title="Click to perform a logical Big-O bottleneck analysis in your output window.">
                <span class="bento-title">⚡️ Bottleneck Auditor</span>
                <span class="bento-desc">Algorithmic complexity, leak scoring and latency saves.</span>
            </div>
            <div class="bento-card" id="btn-benchmark" title="Click to run system profile benchmark for model word processing speed (TPS).">
                <span class="bento-title">🧪 HW Speed Benchmark</span>
                <span class="bento-desc">Latency, processor speed and model profiles.</span>
            </div>
            <div class="bento-card" id="btn-pr-summary" title="Click to outline clean PR description logs and changelog commits from git diffs.">
                <span class="bento-title">📦 Git PR Builder</span>
                <span class="bento-desc">Conventional commit, changelog entry and rollback checks.</span>
            </div>
        </div>
    </div>

    <!-- Interactive Terminal Command Area -->
    <div class="terminal-container">
        <div class="section-title">Mission Control Terminal</div>
        <div class="terminal">
            <div class="terminal-header">
                <span>LOCAL INSTANCE / SHELL</span>
                <span>CTRL+ENTER</span>
            </div>
            <div class="terminal-row">
                <span class="terminal-prompt">&gt;</span>
                <textarea id="intent-input" class="terminal-textarea" placeholder="Input raw project intent to spin up Executive Orchestrator loop..."></textarea>
            </div>
        </div>
        <button id="launch-btn">LNC_STARTUP_PIPELINE</button>
        <div id="pipeline-status" class="pipeline-status-text">Pipeline Executing...</div>
        <div id="terminal-log" class="terminal-log"></div>
    </div>

    <!-- Hardware Benchmark Visualizer -->
    <div class="matrix-container" id="benchmark-insights-panel" style="margin-top: 12px; display: none;">
        <div class="section-title">⚡️ Hardware Benchmark Device Profile</div>
        <div style="background: rgba(16, 21, 30, 0.7); border: 1px solid var(--border-color); border-radius: 4px; padding: 12px; display: flex; flex-direction: column; gap: 8px;">
            <div style="display: flex; justify-content: space-between; align-items: center;">
                <span style="font-size: 11px; opacity: 0.8;">Inference Speed:</span>
                <span id="bench-speed-val" style="font-family: var(--font-mono); font-size: 14px; font-weight: bold; color: var(--neon-mint);">0.0 words/sec</span>
            </div>
            <!-- Progress representation bar -->
            <div style="width: 100%; height: 6px; background: #0c0f13; border-radius: 3px; overflow: hidden; border: 1px solid var(--border-color);">
                <div id="bench-speed-bar" style="width: 0%; height: 100%; background: linear-gradient(90deg, var(--cool-blue), var(--neon-mint)); transition: width 0.5s ease-out;"></div>
            </div>
            <div style="display: flex; gap: 10px; justify-content: space-between; margin-top: 4px; font-size: 9px; opacity: 0.7; border-top: 1px solid var(--border-color); padding-top: 6px;">
                <div>TTFT Latency: <span id="bench-ttft" style="color: var(--cool-blue); font-family: var(--font-mono);">0ms</span></div>
                <div>RAM: <span id="bench-ram" style="color: var(--cool-blue); font-family: var(--font-mono);">0GB</span></div>
                <div>Threads: <span id="bench-threads" style="color: var(--cool-blue); font-family: var(--font-mono);">0</span></div>
            </div>
        </div>
    </div>

    <!-- Real-time Hardware Health Dashboard -->
    <div class="matrix-container" style="margin-top: 12px;">
        <div class="section-title">⚡️ System Health &amp; Hardware Telemetry</div>
        <div style="background: rgba(16, 21, 30, 0.7); border: 1px solid var(--border-color); border-radius: 4px; padding: 12px; display: flex; flex-direction: column; gap: 10px;">
            <!-- CPU Load Row -->
            <div style="display: flex; flex-direction: column; gap: 4px;">
                <div style="display: flex; justify-content: space-between; align-items: center; font-size: 11px;">
                    <span>CPU Core Load:</span>
                    <span id="hardware-cpu-val" style="font-family: var(--font-mono); font-weight: bold; color: var(--neon-mint);">0.0%</span>
                </div>
                <div style="width: 100%; height: 6px; background: #0c0f13; border-radius: 3px; overflow: hidden; border: 1px solid var(--border-color);">
                    <div id="hardware-cpu-bar" style="width: 0%; height: 100%; background: var(--neon-mint); transition: width 0.3s ease-out;"></div>
                </div>
            </div>
            <!-- RAM Memory Row -->
            <div style="display: flex; flex-direction: column; gap: 4px;">
                <div style="display: flex; justify-content: space-between; align-items: center; font-size: 11px;">
                    <span>RAM Allocation:</span>
                    <span id="hardware-ram-val" style="font-family: var(--font-mono); font-weight: bold; color: var(--cool-blue);">0.0 / 0.0 GB (0%)</span>
                </div>
                <div style="width: 100%; height: 6px; background: #0c0f13; border-radius: 3px; overflow: hidden; border: 1px solid var(--border-color);">
                    <div id="hardware-ram-bar" style="width: 0%; height: 100%; background: var(--cool-blue); transition: width 0.3s ease-out;"></div>
                </div>
            </div>
        </div>
    </div>

    <!-- Local DevVelocity Metrics Telemetry Panel -->
    <div class="matrix-container" style="margin-top: 12px;">
        <div class="section-title">📊 DevVelocity Telemetry (Local Savings)</div>
        <div style="background: rgba(0, 255, 170, 0.03); border: 1px solid rgba(0, 255, 170, 0.2); border-radius: 4px; padding: 12px; display: grid; grid-template-columns: 1fr 1fr; gap: 10px;">
            <div style="display: flex; flex-direction: column;">
                <span style="font-size: 8px; opacity: 0.7; text-transform: uppercase; letter-spacing: 0.3px;">Est. Hours Saved</span>
                <span id="vel-hours-saved" style="font-family: var(--font-mono); font-size: 18px; font-weight: bold; color: var(--neon-mint);">0.0h</span>
            </div>
            <div style="display: flex; flex-direction: column;">
                <span style="font-size: 8px; opacity: 0.7; text-transform: uppercase; letter-spacing: 0.3px;">Sprints Completed</span>
                <span id="vel-sprints" style="font-family: var(--font-mono); font-size: 18px; font-weight: bold; color: var(--cool-blue);">0</span>
            </div>
            <div style="display: flex; flex-direction: column;">
                <span style="font-size: 8px; opacity: 0.7; text-transform: uppercase; letter-spacing: 0.3px;">LOC Crafted/Gen</span>
                <span id="vel-loc" style="font-family: var(--font-mono); font-size: 12px; font-weight: bold; color: var(--neon-orange);">0 lines</span>
            </div>
            <div style="display: flex; flex-direction: column;">
                <span style="font-size: 8px; opacity: 0.7; text-transform: uppercase; letter-spacing: 0.3px;">Rollbacks Preempted</span>
                <span id="vel-rollbacks" style="font-family: var(--font-mono); font-size: 12px; font-weight: bold; color: var(--neon-pink);">0 times</span>
            </div>
            <div style="grid-column: span 2; display: flex; justify-content: space-between; align-items: center; border-top: 1px solid rgba(255, 255, 255, 0.05); padding-top: 6px; margin-top: 2px;">
                <span style="font-size: 8px; opacity: 0.6; text-transform: uppercase; letter-spacing: 0.3px;">Total Agent Steps:</span>
                <span id="vel-ops" style="font-family: var(--font-mono); font-size: 9px; font-weight: bold; color: #fff;">0</span>
            </div>
        </div>
    </div>

    <!-- AI Labor Team Panel -->
    <div class="matrix-container" style="margin-top: 12px;">
        <div class="section-title">👥 AI Labor Team Squad Configuration</div>
        <div style="background: rgba(16, 21, 30, 0.7); border: 1px solid var(--border-color); border-radius: 4px; padding: 12px; display: flex; flex-direction: column; gap: 10px;">
            <div style="display: flex; justify-content: space-between; align-items: center; font-size: 11px;">
                <span>Autonomous Squad Size</span>
                <span id="team-size-val" style="font-family: var(--font-mono); color: var(--cool-blue); font-weight: bold;">3 Agents</span>
            </div>
            <div style="display: flex; align-items: center; gap: 8px;">
                <input type="range" id="team-slider" min="1" max="8" value="3" style="flex: 1; accent-color: var(--cool-blue); background: #0c0f13; border: 1px solid var(--border-color); height: 4px; border-radius: 2px; cursor: pointer;">
            </div>
            <div style="display: flex; justify-content: space-between; align-items: center; font-size: 11px; border-top: 1px solid var(--border-color); padding-top: 8px;">
                <span>Fast-Draft Mode (One-Shot)</span>
                <div class="toggle-container" id="toggle-fast-draft" style="cursor: pointer;">OFF</div>
            </div>
        </div>
    </div>

    <!-- Monetization & Premium Panel -->
    <div class="matrix-container" style="margin-top: 12px;">
        <div class="section-title">💎 License & Premium Options</div>
        <div style="background: rgba(16, 21, 30, 0.7); border: 1px solid var(--border-color); border-radius: 4px; padding: 12px; display: flex; flex-direction: column; gap: 10px;">
            <div style="display: flex; justify-content: space-between; align-items: center; font-size: 11px;">
                <span>Cloud Fallback Model (Opt-in)</span>
                <div class="toggle-container" id="toggle-cloud" style="cursor: pointer;">OFF</div>
            </div>
            <div style="display: flex; justify-content: space-between; align-items: center; font-size: 11px;">
                <span>Advanced Semantic RAG</span>
                <div class="toggle-container" id="toggle-rag" style="cursor: pointer;">OFF</div>
            </div>
            <div style="display: flex; justify-content: space-between; align-items: center; font-size: 10px; border-top: 1px solid var(--border-color); padding-top: 8px; opacity: 0.8;">
                <span>Hermes-Forge Local Server Node</span>
                <span id="bridge-server-port" style="font-family: var(--font-mono); color: var(--neon-mint); font-weight: bold;">OFFLINE</span>
            </div>
        </div>
    </div>

    <!-- Offline Telemetry Feedback Widget -->
    <div class="matrix-container" style="margin-top: 12px; margin-bottom: 12px;">
        <div class="section-title">💬 Offline Community Feedback</div>
        <div style="background: rgba(16, 21, 30, 0.7); border: 1px solid var(--border-color); border-radius: 4px; padding: 12px; display: flex; flex-direction: column; gap: 8px;">
            <div style="font-size: 9px; opacity: 0.7; line-height: 1.4;">Submit feature thoughts offline. It writes safely to <code>.telemetry/feedback.json</code> inside this workspace.</div>
            <textarea id="feedback-text" style="width: 100%; height: 45px; background: #0c0f13; border: 1px solid var(--border-color); border-radius: 2px; color: var(--text-color); font-family: var(--font-family); font-size: 10px; padding: 6px; resize: none;" placeholder="Provide feedback or report local issues here..."></textarea>
            <button id="feedback-btn" style="width: 100%; background: var(--border-color); border: 1px solid var(--border-color); color: rgb(200, 200, 200); cursor: pointer; padding: 6px; border-radius: 2px; font-size: 10px; font-family: var(--font-mono); text-transform: uppercase;">Submit Message</button>
        </div>
    </div>

    <script>
        const vscode = acquireVsCodeApi();

        // Bento buttons event listeners
        document.getElementById('btn-legacy-migrate').addEventListener('click', () => {
            vscode.postMessage({ type: 'triggerMigration' });
        });
        document.getElementById('btn-perf-audit').addEventListener('click', () => {
            vscode.postMessage({ type: 'triggerAudit' });
        });
        document.getElementById('btn-benchmark').addEventListener('click', () => {
            vscode.postMessage({ type: 'triggerBenchmark' });
        });
        document.getElementById('btn-pr-summary').addEventListener('click', () => {
            vscode.postMessage({ type: 'triggerPrSummary' });
        });
        
        const launchBtn = document.getElementById('launch-btn');
        const inputArea = document.getElementById('intent-input');
        const pipelineStatus = document.getElementById('pipeline-status');
        const terminalLog = document.getElementById('terminal-log');

        const cards = {
            architect: document.getElementById('card-architect'),
            pm: document.getElementById('card-pm'),
            engineer: document.getElementById('card-engineer'),
            qa: document.getElementById('card-qa')
        };

        const details = {
            architect: document.getElementById('detail-architect'),
            pm: document.getElementById('detail-pm'),
            engineer: document.getElementById('detail-engineer'),
            qa: document.getElementById('detail-qa')
        };

        function resetMatrix() {
            Object.keys(cards).forEach(key => {
                cards[key].className = 'member-card status-idle';
                cards[key].querySelector('.member-status-label').textContent = 'Idle';
            });
            details.architect.textContent = 'Ready to outline files...';
            details.pm.textContent = 'Awaiting system design...';
            details.engineer.textContent = 'Awaiting PM specs...';
            details.qa.textContent = 'Awaiting candidate code...';
            terminalLog.style.display = 'none';
            terminalLog.textContent = '';
        }

        function appendLog(line) {
            terminalLog.style.display = 'block';
            terminalLog.textContent += line + '\\n';
            terminalLog.scrollTop = terminalLog.scrollHeight;
        }

        launchBtn.addEventListener('click', () => {
            const val = inputArea.value.trim();
            if(!val) return;
            resetMatrix();
            vscode.postMessage({ type: 'startPipeline', value: val });
        });

        // Trigger on Cmd+Enter / Ctrl+Enter
        inputArea.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
                e.preventDefault();
                launchBtn.click();
            }
        });

        const pulseBadge = document.getElementById('setup-pulse-badge');
        pulseBadge.addEventListener('click', () => {
            vscode.postMessage({ type: 'runSetupGuide' });
        });

        let ollamaOnline = false;

        window.addEventListener('message', event => {
            const msg = event.data;
            
            if (msg.type === 'pipelineStart') {
                launchBtn.disabled = true;
                inputArea.disabled = true;
                launchBtn.innerHTML = '<span class="loading-loader"></span> PIPELINE_RUNNING';
                pipelineStatus.style.display = 'block';
                pipelineStatus.textContent = 'Pipeline Executing...';
                appendLog('[SYSTEM] Initializing HermesForge Executive Orchestrator loop...');
            } 
            else if (msg.type === 'phaseUpdate') {
                const { phase, status, message } = msg;
                const card = cards[phase];
                const detail = details[phase];
                
                if (card) {
                    card.className = \`member-card status-\${status}\`;
                    card.querySelector('.member-status-label').textContent = status;
                    if (message) {
                        detail.textContent = message;
                        appendLog(\`[\${phase.toUpperCase()}] status: \${status.toUpperCase()} | \${message}\`);
                    }
                }
            } 
            else if (msg.type === 'pipelineEnd') {
                launchBtn.disabled = !ollamaOnline;
                inputArea.disabled = !ollamaOnline;
                launchBtn.textContent = ollamaOnline ? 'LNC_STARTUP_PIPELINE' : 'OLLAMA OFFLINE';
                pipelineStatus.style.display = 'block';
                
                if (msg.success) {
                    pipelineStatus.textContent = 'PIPELINE COMPLETE: SUCCESS';
                    pipelineStatus.style.color = 'var(--neon-mint)';
                    appendLog('[SYSTEM] All executive validations passed! Pipeline consolidated successfully.');
                } else {
                    pipelineStatus.textContent = 'PIPELINE FAIL: ERROR';
                    pipelineStatus.style.color = 'var(--neon-pink)';
                    appendLog(\`[SYSTEM] Epic fail: \${msg.error || 'Unknown core orchestrator interrupt'}\`);
                }
            }
            else if (msg.type === 'connectionStatus') {
                const status = msg.status;
                const pulseDot = document.getElementById('connection-pulse-dot');
                const pulseText = document.getElementById('connection-pulse-text');
                
                if (!status.connected) {
                    ollamaOnline = false;
                    pulseDot.style.backgroundColor = 'var(--neon-pink)';
                    pulseDot.style.boxShadow = '0 0 8px var(--neon-pink)';
                    pulseText.textContent = 'OFFLINE';
                    pulseText.style.color = 'var(--neon-pink)';
                    launchBtn.disabled = true;
                    launchBtn.textContent = 'OLLAMA OFFLINE';
                } else if (!status.completionModelExists || !status.chatModelExists) {
                    ollamaOnline = false;
                    pulseDot.style.backgroundColor = 'var(--neon-orange)';
                    pulseDot.style.boxShadow = '0 0 8px var(--neon-orange)';
                    pulseText.textContent = 'PULL_MODELS';
                    pulseText.style.color = 'var(--neon-orange)';
                    launchBtn.disabled = true;
                    launchBtn.textContent = 'MODELS MISSING';
                } else {
                    ollamaOnline = true;
                    pulseDot.style.backgroundColor = 'var(--neon-mint)';
                    pulseDot.style.boxShadow = '0 0 8px var(--neon-mint)';
                    pulseText.textContent = 'ONLINE';
                    pulseText.style.color = 'var(--neon-mint)';
                    
                    if (launchBtn.textContent === 'OLLAMA OFFLINE' || launchBtn.textContent === 'MODELS MISSING') {
                        launchBtn.disabled = false;
                        inputArea.disabled = false;
                        launchBtn.textContent = 'LNC_STARTUP_PIPELINE';
                    }
                }
            }
            else if (msg.type === 'configUpdate') {
                const cloudActive = !!msg.enableCloudFallback;
                const ragActive = !!msg.premiumAdvancedRAG;
                const fastDraftActive = !!msg.fastDraftMode;
                const teamSize = msg.aiLaborTeamSize || 3;

                const toggleCloud = document.getElementById('toggle-cloud');
                const toggleRag = document.getElementById('toggle-rag');
                const toggleFastDraft = document.getElementById('toggle-fast-draft');

                if (cloudActive) {
                    toggleCloud.className = 'toggle-container active';
                    toggleCloud.textContent = 'ON';
                } else {
                    toggleCloud.className = 'toggle-container';
                    toggleCloud.textContent = 'OFF';
                }

                if (ragActive) {
                    toggleRag.className = 'toggle-container active';
                    toggleRag.textContent = 'ON';
                } else {
                    toggleRag.className = 'toggle-container';
                    toggleRag.textContent = 'OFF';
                }

                if (toggleFastDraft) {
                    if (fastDraftActive) {
                        toggleFastDraft.className = 'toggle-container active';
                        toggleFastDraft.textContent = 'ON';
                    } else {
                        toggleFastDraft.className = 'toggle-container';
                        toggleFastDraft.textContent = 'OFF';
                    }
                }

                const teamSlider = document.getElementById('team-slider');
                const teamSizeVal = document.getElementById('team-size-val');
                if (teamSlider && teamSizeVal) {
                    teamSlider.value = teamSize;
                    teamSizeVal.textContent = teamSize + (teamSize === 1 ? ' Agent' : ' Agents');
                }

                const serverPortSpan = document.getElementById('bridge-server-port');
                if (serverPortSpan) {
                    if (msg.nodeEnabled) {
                        serverPortSpan.textContent = 'LISTENING : ' + msg.nodePort;
                        serverPortSpan.style.color = 'var(--neon-mint)';
                    } else {
                        serverPortSpan.textContent = 'DISABLED';
                        serverPortSpan.style.color = 'var(--neon-pink)';
                    }
                }
            }
            else if (msg.type === 'benchmarkResult') {
                const bInsights = document.getElementById('benchmark-insights-panel');
                const bSpeedVal = document.getElementById('bench-speed-val');
                const bSpeedBar = document.getElementById('bench-speed-bar');
                const bTtft = document.getElementById('bench-ttft');
                const bRam = document.getElementById('bench-ram');
                const bThreads = document.getElementById('bench-threads');

                if (bInsights) {
                    bInsights.style.display = 'block';
                    bSpeedVal.textContent = msg.stats.tps.toFixed(1) + ' words/sec';
                    bTtft.textContent = msg.stats.ttft + 'ms';
                    bRam.textContent = msg.config.totalMemoryGB + 'GB';
                    bThreads.textContent = msg.config.threads;

                    // Gauge calculation: 30 words/sec is 100% capacity in offline contexts
                    const pct = Math.min(100, Math.max(5, (msg.stats.tps / 30) * 100));
                    bSpeedBar.style.width = pct + '%';
                }
            }
            else if (msg.type === 'liveHardwareMetrics') {
                const metrics = msg.metrics;
                const cpuVal = document.getElementById('hardware-cpu-val');
                const cpuBar = document.getElementById('hardware-cpu-bar');
                const ramVal = document.getElementById('hardware-ram-val');
                const ramBar = document.getElementById('hardware-ram-bar');

                if (cpuVal) cpuVal.textContent = metrics.cpuLoad.toFixed(1) + '%';
                if (cpuBar) cpuBar.style.width = metrics.cpuLoad + '%';
                if (ramVal) {
                    ramVal.textContent = metrics.usedMemoryGB.toFixed(1) + ' / ' + metrics.totalMemoryGB.toFixed(1) + ' GB (' + metrics.memoryUsagePct.toFixed(0) + '%)';
                }
                if (ramBar) ramBar.style.width = metrics.memoryUsagePct + '%';
            }
            else if (msg.type === 'velocityMetrics') {
                const metrics = msg.metrics;
                document.getElementById('vel-hours-saved').textContent = (metrics.hoursSaved || 0.0).toFixed(1) + 'h';
                document.getElementById('vel-sprints').textContent = metrics.sprintsCompleted || 0;
                document.getElementById('vel-loc').textContent = (metrics.linesOfCodeGenerated || 0) + ' lines';
                document.getElementById('vel-rollbacks').textContent = (metrics.rollbacksPreempted || 0) + ' times';
                document.getElementById('vel-ops').textContent = metrics.agentStepsExecuted || 0;
            }
        });

        const toggleFastDraftBtn = document.getElementById('toggle-fast-draft');
        if (toggleFastDraftBtn) {
            toggleFastDraftBtn.addEventListener('click', () => {
                vscode.postMessage({ type: 'toggleFastDraftFlag' });
            });
        }

        const teamSliderEl = document.getElementById('team-slider');
        if (teamSliderEl) {
            teamSliderEl.addEventListener('input', (e) => {
                const val = e.target.value;
                document.getElementById('team-size-val').textContent = val + (val === '1' ? ' Agent' : ' Agents');
            });
            teamSliderEl.addEventListener('change', (e) => {
                vscode.postMessage({ type: 'updateTeamSize', value: e.target.value });
            });
        }

        // Toggle settings event listeners
        document.getElementById('toggle-cloud').addEventListener('click', () => {
            vscode.postMessage({ type: 'togglePremiumFlag', flag: 'enableCloudFallback' });
        });

        document.getElementById('toggle-rag').addEventListener('click', () => {
            vscode.postMessage({ type: 'togglePremiumFlag', flag: 'premiumAdvancedRAG' });
        });

        // Offline feedback submit events
        const feedbackBtn = document.getElementById('feedback-btn');
        const feedbackText = document.getElementById('feedback-text');

        feedbackBtn.addEventListener('click', () => {
            const feed = feedbackText.value.trim();
            if (feed) {
                vscode.postMessage({ type: 'submitFeedback', feedback: feed });
                feedbackText.value = '';
                feedbackBtn.textContent = 'LOGGED SECURELY!';
                feedbackBtn.style.color = 'var(--neon-mint)';
                setTimeout(() => {
                    feedbackBtn.textContent = 'Submit Message';
                    feedbackBtn.style.color = 'rgb(200,200,200)';
                }, 2000);
            }
        });
    </script>
</body>
</html>`;
    }
}
