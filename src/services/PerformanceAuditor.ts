import * as vscode from 'vscode';
import * as fs from 'fs/promises';
import * as path from 'path';
import { OllamaClient } from './OllamaClient';
import { logger } from '../utils/Logger';

export class PerformanceAuditor {
    private outputChannel: vscode.OutputChannel;

    constructor(private readonly ollama: OllamaClient) {
        this.outputChannel = vscode.window.createOutputChannel('HermesForge Performance Auditor');
    }

    /**
     * Inspects active files for micro-optimizations, concurrency limits, and memory leaks.
     */
    public async auditActiveFile(): Promise<void> {
        const editor = vscode.window.activeTextEditor;
        if (!editor) {
            vscode.window.showErrorMessage('No active text editor found. Please open a code file to perform a latency and bottleneck scan.');
            return;
        }

        const filePath = editor.document.fileName;
        const code = editor.document.getText();

        if (!code.trim()) {
            vscode.window.showErrorMessage('The active code file is empty.');
            return;
        }

        this.outputChannel.show(true);
        this.outputChannel.clear();
        this.outputChannel.appendLine('========================================');
        this.outputChannel.appendLine(`🚀 [Initializing Performance Auditing: ${path.basename(filePath)}]`);
        this.outputChannel.appendLine('========================================\n');

        await vscode.window.withProgress({
            location: vscode.ProgressLocation.Notification,
            title: 'HermesForge: Scoring performance bottlenecks...',
            cancellable: false
        }, async (progress) => {
            try {
                progress.report({ message: 'Analyzing time/space complexity vectors...' });

                const auditPrompt = `You are the lead HermesForge PERFORMANCE & ARCHITECTURAL OPTIMIZATION ENGINEER.
Your task is to audit the following code block for bottlenecks:
- Analyze Time/Space Complexity metrics (Big-O notation drag).
- Spot O(N^2) or higher nested iteration hazards, un-indexed lookups, or heavy string joins.
- Check for memory leak vulnerabilities (e.g. uncleared intervals, leaking event handlers, massive closures).
- Check for non-optimal I/O blocking synchronous loops or excessive GC overhead thrashing.

FILE PATH: ${filePath}
CODE CONTENT:
\`\`\`ts
${code}
\`\`\`

Provide your findings strictly in structured Markdown:
## 🚀 Comprehensive Performance Audit Report
### 📊 Computational complexity score
- Current Time Complexity: [e.g. O(N^2)]
- Target Time Complexity: [e.g. O(N)]
- Estimated CPU Latency Saving: [e.g. 45%]

### 🔍 Identified Bottlenecks & Drag Vectors
1. **[Bottleneck Title]**: [Explain precise reasons and line references]

### 🛠️ Refactored Optimal Alternatives
Provide the entire fully-optimized code block.

Output ONLY your markdown report. Avoid standard intro chat text.`;

                this.outputChannel.appendLine('[Audit]: Requesting local reasoning scan from Ollama model...');
                const response = await this.ollama.generateCompletion(auditPrompt, {
                    model: this.ollama.modelChat,
                    temperature: 0.2
                });

                this.outputChannel.appendLine(response);
                
                // Offer to save review as a report
                const choice = await vscode.window.showInformationMessage(
                    'Audit report complete! Save results to PERF_AUDIT.md in workspace?',
                    'Save markdown report',
                    'Close'
                );

                if (choice === 'Save markdown report') {
                    const folders = vscode.workspace.workspaceFolders;
                    const workspacePath = folders && folders.length > 0 ? folders[0].uri.fsPath : path.dirname(filePath);
                    const reportPath = path.join(workspacePath, 'PERF_AUDIT.md');

                    let header = `# ⚡️ Performance Audit Report — ${path.basename(filePath)}\n`;
                    header += `*Generated offline via HermesForge on ${new Date().toLocaleString()}*\n\n`;
                    
                    await fs.writeFile(reportPath, header + response, 'utf8');
                    vscode.window.showInformationMessage(`🟢 Saved comprehensive performance diagnostics to: ${path.basename(reportPath)}`);
                }

            } catch (err: any) {
                logger.error('[PerformanceAuditor] Critical profiling failure:', err);
                this.outputChannel.appendLine(`\n🚨 [Auditor Scan Aborted]: Error: ${err.message}`);
                vscode.window.showErrorMessage(`Performance Audit terminated: ${err.message}`);
            }
        });
    }
}
