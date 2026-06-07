import * as vscode from 'vscode';
import { OllamaClient } from '../services/OllamaClient';
import { ExecutiveOrchestrator } from '../services/ExecutiveOrchestrator';
import { logger } from '../utils/Logger';

export class DashboardViewProvider implements vscode.WebviewViewProvider {
    public static readonly viewType = 'hermes-forge.dashboardView';
    private _view?: vscode.WebviewView;

    constructor(
        private readonly _extensionUri: vscode.Uri,
        private readonly ollama: OllamaClient
    ) {}

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

        webviewView.webview.onDidReceiveMessage(async (data) => {
            if (data.type === 'startPipeline') {
                await this.handlePipelineTrigger(data.value);
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
    </style>
</head>
<body>

    <div class="header">
        <h1>HermesForge Core</h1>
        <div class="pulse-badge">
            <div class="pulse-dot"></div>
            <span>ONLINE</span>
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

    <script>
        const vscode = acquireVsCodeApi();
        
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
                launchBtn.disabled = false;
                inputArea.disabled = false;
                launchBtn.textContent = 'LNC_STARTUP_PIPELINE';
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
        });
    </script>
</body>
</html>`;
    }
}
