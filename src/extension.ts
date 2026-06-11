import * as vscode from 'vscode';
import { OllamaClient } from './services/OllamaClient';
import { AutocompleteProvider } from './modules/AutocompleteProvider';
import { ChatWebviewProvider } from './modules/ChatWebviewProvider';
import { DashboardViewProvider } from './modules/DashboardViewProvider';
import { AgentEngine, activeSubprocesses } from './modules/AgentEngine';
import { AgentRouter } from './services/AgentRouter';

export function activate(context: vscode.ExtensionContext) {
    console.log('HermesForge extension activating...');

    // Initialize a shared instance of OllamaClient
    const ollama = new OllamaClient({
        baseUrl: 'http://localhost:11434',
        modelCompletion: 'qwen2.5-coder:1.5b',
        modelChat: 'hermes3:8b'
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
}

export function deactivate() {
    console.log('HermesForge extension deactivating...');
    // Cleanly wind down any running local terminal subprocesses
    if (activeSubprocesses.length > 0) {
        console.log(`Killing ${activeSubprocesses.length} child processes...`);
        for (const proc of activeSubprocesses) {
            if (proc && !proc.killed) {
                proc.kill('SIGKILL');
            }
        }
        activeSubprocesses.length = 0;
    }
}

