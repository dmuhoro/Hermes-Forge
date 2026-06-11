import * as vscode from 'vscode';
import { OllamaClient } from './OllamaClient';
import { logger } from '../utils/Logger';
import { AgentEngine } from '../modules/AgentEngine';
import { ChatWebviewProvider } from '../modules/ChatWebviewProvider';
import { ContextCrawler } from './ContextCrawler';

export enum TaskCategory {
    AUTOCOMPLETE_OR_EDIT = 'AUTOCOMPLETE_OR_EDIT',
    EXPLAIN_OR_AUDIT = 'EXPLAIN_OR_AUDIT',
    COMPLEX_AGENTIC = 'COMPLEX_AGENTIC'
}

export class AgentRouter {
    constructor(
        private ollama: OllamaClient,
        private chatProvider: ChatWebviewProvider
    ) {}

    public async routeTask(userPrompt: string, fileContext: string): Promise<void> {
        const stopTimer = logger.startTimer('AgentRouter Decision Pipeline');
        
        // Check for static command interception: analyze or /analyze
        const trimmedPrompt = userPrompt.trim().toLowerCase();
        if (trimmedPrompt.includes('analyze this repository') || trimmedPrompt === '/analyze') {
            this.chatProvider.sendSystemNotification('🔍 **Analyzer**: Scanning and profiling codebase architecture...');
            const folders = vscode.workspace.workspaceFolders;
            const root = folders && folders.length > 0 ? folders[0].uri.fsPath : process.cwd();
            const crawler = new ContextCrawler();
            const report = await crawler.analyzeRepository(root);
            await this.chatProvider.streamResponseDirectly(report);
            stopTimer();
            return;
        }

        let category = TaskCategory.EXPLAIN_OR_AUDIT;

        // 1. Ultra-fast cheap token-pass to classify the user's intent using Qwen-1.5B
        try {
            const systemPrompt = `Classify this prompt into EXACTLY ONE of these categories:
AUTOCOMPLETE_OR_EDIT (For small edits, typos, single line fixes)
EXPLAIN_OR_AUDIT (For code explanation, refactoring advice, or architecture review)
COMPLEX_AGENTIC (For executing terminal commands, fixing multiple files, diagnosing bugs)
Reply ONLY with the exact spelled category name.

USER PROMPT: ${userPrompt}`;

            const response = await this.ollama.generateCompletion(systemPrompt, {
                model: 'qwen2.5-coder:1.5b',
                temperature: 0.1,
                num_predict: 20
            });
            
            const raw = response.trim().toUpperCase();
            if (raw.includes(TaskCategory.COMPLEX_AGENTIC)) {
                category = TaskCategory.COMPLEX_AGENTIC;
            } else if (raw.includes(TaskCategory.AUTOCOMPLETE_OR_EDIT)) {
                category = TaskCategory.AUTOCOMPLETE_OR_EDIT;
            } else if (raw.includes(TaskCategory.EXPLAIN_OR_AUDIT)) {
                category = TaskCategory.EXPLAIN_OR_AUDIT;
            }
        } catch (error) {
            logger.warn('1.5B token-pass classification failed. Falling back to syntax heuristics.', { error });
            const heuristic = userPrompt.toLowerCase();
            if (heuristic.includes('refactor') || heuristic.includes('build') || heuristic.includes('diagnose') || heuristic.includes('terminal')) {
                category = TaskCategory.COMPLEX_AGENTIC;
            } else if (heuristic.includes('fix line') || heuristic.includes('typo') || heuristic.includes('autocomplete') || userPrompt.length < 50) {
                category = TaskCategory.AUTOCOMPLETE_OR_EDIT;
            }
        }

        logger.info('[Router] Classified task execution context', { 
            category, 
            promptLength: userPrompt.length 
        });
        stopTimer();

        // 2. Sprint 3: Advanced Smart Offline RAG Context Injection
        const activeEditor = vscode.window.activeTextEditor;
        let enhancedContext = fileContext;
        
        try {
            const folders = vscode.workspace.workspaceFolders;
            const root = folders && folders.length > 0 ? folders[0].uri.fsPath : process.cwd();
            const crawler = new ContextCrawler();
            const smartContext = await crawler.getSmartContext(root, userPrompt, 5);
            if (smartContext) {
                enhancedContext += smartContext;
            } else if (activeEditor && activeEditor.document.fileName) {
                const extendedDependencies = await crawler.getExpandedContext(activeEditor.document.fileName);
                if (extendedDependencies) {
                    enhancedContext += `\n\n### Expanded Workspace Context ###\n${extendedDependencies}`;
                }
            }
        } catch (err: any) {
            logger.warn(`[AgentRouter] Smart context injection encountered issue: ${err.message}`);
        }

        // 3. Dispatch Execution Based on Classification
        switch (category) {
            case TaskCategory.AUTOCOMPLETE_OR_EDIT:
                this.chatProvider.sendSystemNotification('⚡️ **Router**: Task identified as Edit. Routing to fast Qwen-1.5B...');
                await this.chatProvider.streamResponse(userPrompt, enhancedContext, this.ollama.modelCompletion);
                break;
                
            case TaskCategory.EXPLAIN_OR_AUDIT:
                this.chatProvider.sendSystemNotification('🧠 **Router**: Task identified as Explanation. Routing to standard deep logic Hermes-8B...');
                await this.chatProvider.streamResponse(userPrompt, enhancedContext, this.ollama.modelChat);
                break;
                
            case TaskCategory.COMPLEX_AGENTIC:
                this.chatProvider.sendSystemNotification('⚙️ **Router**: High-complexity objective identified. Handing off to the background Agent Engine loop execution...');
                const agent = new AgentEngine(this.ollama);
                await agent.startAgentLoop(userPrompt + '\n\n' + enhancedContext);
                break;
        }
    }
}
