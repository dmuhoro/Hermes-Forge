import * as vscode from 'vscode';
import * as cp from 'child_process';
import * as fs from 'fs/promises';
import * as path from 'path';
import { OllamaClient } from './OllamaClient';
import { logger } from '../utils/Logger';

export class PRGenerator {
    private outputChannel: vscode.OutputChannel;

    constructor(private readonly ollama: OllamaClient) {
        this.outputChannel = vscode.window.createOutputChannel('HermesForge PR Builder');
    }

    private getWorkspaceRoot(): string {
        const folders = vscode.workspace.workspaceFolders;
        return folders && folders.length > 0 ? folders[0].uri.fsPath : process.cwd();
    }

    private runShell(command: string): Promise<{ code: number; stdout: string; stderr: string }> {
        return new Promise((resolve) => {
            cp.exec(command, { cwd: this.getWorkspaceRoot() }, (error, stdout, stderr) => {
                resolve({
                    code: error ? (error.code ?? 1) : 0,
                    stdout: stdout || '',
                    stderr: stderr || ''
                });
            });
        });
    }

    /**
     * Inspects git repository state, parses exact diff strings, and builds a PR-Ready document,
     * commit message, and changelog changes with integrated rollback gates.
     */
    public async generatePRMetadata(): Promise<void> {
        this.outputChannel.show(true);
        this.outputChannel.clear();
        this.outputChannel.appendLine('========================================');
        this.outputChannel.appendLine('🛠️ [HermesForge PR-Ready metadata formulator initialized]');
        this.outputChannel.appendLine('========================================\n');

        const root = this.getWorkspaceRoot();

        // 1. Check if git repo exists
        const gitCheck = await this.runShell('git rev-parse --is-inside-work-tree');
        if (gitCheck.code !== 0) {
            this.outputChannel.appendLine('⚠️ Repository is not a git workspace. Using manual directory crawler backup...');
            await this.generateManualChangesSummary();
            return;
        }

        // 2. Extract git status and raw diff
        this.outputChannel.appendLine('[Git Checker]: Scanning modified structures...');
        const statusRes = await this.runShell('git status --porcelain');
        if (!statusRes.stdout.trim()) {
            vscode.window.showInformationMessage('🟢 Git status is completely clean. No modified files found.');
            this.outputChannel.appendLine('No local changes detected in working copy trees.');
            return;
        }

        this.outputChannel.appendLine('[Git Diff]: Tracking active line differences...');
        const diffRes = await this.runShell('git diff');
        const stagedDiffRes = await this.runShell('git diff --staged');
        
        const combinedDiff = `${diffRes.stdout}\n${stagedDiffRes.stdout}`.trim();
        const filesChanged = statusRes.stdout.trim();

        if (!combinedDiff) {
            this.outputChannel.appendLine('Modified files found but no diff could be generated (possible untracked files).');
            this.outputChannel.appendLine(`File states:\n${filesChanged}`);
        }

        await vscode.window.withProgress({
            location: vscode.ProgressLocation.Notification,
            title: 'HermesForge: Building PR changelog...',
            cancellable: false
        }, async (progress) => {
            try {
                // Compile changes to Hermes-3 model
                progress.report({ message: 'Analyzing git differences...' });

                const diffSlice = combinedDiff.length > 12000 ? combinedDiff.substring(0, 12000) + '\n... [Diff truncated for size]' : combinedDiff;

                const prompt = `You are a Principal Software Release Architect.
We need to generate a Pull Request summary and clear commit details from these git changes:

### ACTIVE MODIFIED FILES:
${filesChanged}

### RAW DIFFERENTIAL GIT PATCH:
\`\`\`diff
${diffSlice || 'No code differences available. Review the file names list.'}
\`\`\`

Generate a high-tier GitHub release summary in English, responding strictly with these exact markdown sections:

## 🚀 PR Summary
### 📝 Change Description
[Clear 2-sentence explanation of what has been implemented and why]

### 📂 File Modifications
- [List relative file path and their specific functional changes]

## 📝 Commit Message Proposal
\`\`\`
[Provide a strict Conventional Commit string, e.g., "feat(autoclose): optimize memory leaks by clearing timer hooks"]
\`\`\`

## 📌 CHANGELOG Entry
\`\`\`markdown
- [Short bullet list describing enhancements to be appended to CHANGELOG.md]
\`\`\``;

                this.outputChannel.appendLine('[PR Plan]: Processing diff metrics with Ollama Hermes-3 model...');
                const response = await this.ollama.generateCompletion(prompt, {
                    model: this.ollama.modelChat,
                    temperature: 0.1
                });

                this.outputChannel.appendLine('\n========================================');
                this.outputChannel.appendLine('📈 REPORT COMPLETED GENERATION SUCCESSFULLY:');
                this.outputChannel.appendLine('========================================\n');
                this.outputChannel.appendLine(response);

                // Option 1: Save metadata to workspace
                const savePrReport = await vscode.window.showInformationMessage(
                    'PR summary generated! Save report to PR_SUMMARY.md next to package?',
                    'Save PR_SUMMARY.md',
                    'Open Commit Transaction',
                    'Discard Changes'
                );

                if (savePrReport === 'Save PR_SUMMARY.md') {
                    const prSummaryPath = path.join(root, 'PR_SUMMARY.md');
                    await fs.writeFile(prSummaryPath, `# HermesForge PR Metadata\n\n${response}`, 'utf8');
                    vscode.window.showInformationMessage(`🟢 Successfully created: ${path.basename(prSummaryPath)}`);
                    
                    // Trigger changelog update
                    await this.appendToChangelog(response);
                } else if (savePrReport === 'Open Commit Transaction') {
                    // Extract commit message from model response
                    const commitRegex = /## 📝 Commit Message Proposal\s*```\s*([\s\S]*?)\s*```/;
                    const match = response.match(commitRegex);
                    const suggestedMsg = match ? match[1].trim() : 'feat: update workspace modules';

                    const userMsg = await vscode.window.showInputBox({
                        prompt: 'Accept or edit proposed conventional commit message:',
                        value: suggestedMsg
                    });

                    if (userMsg) {
                        this.outputChannel.appendLine('[Commit Loop]: Running automatic stage and commit...');
                        await this.runShell('git add .');
                        const commitResult = await this.runShell(`git commit -m "${userMsg.replace(/"/g, '\\"')}"`);
                        
                        if (commitResult.code === 0) {
                            vscode.window.showInformationMessage('🟢 Git staging and commit accomplished perfectly!');
                            this.outputChannel.appendLine('Git revision committed successfully.');
                        } else {
                            vscode.window.showErrorMessage(`Git commit failed: ${commitResult.stderr}`);
                        }
                    }
                } else if (savePrReport === 'Discard Changes') {
                    const doubleCheck = await vscode.window.showWarningMessage(
                        'WARNING: This will trigger a safety rollback discarding all uncommitted changes on git! Proceed?',
                        { modal: true },
                        'Yes, Rollback All Changes',
                        'Cancel'
                    );

                    if (doubleCheck === 'Yes, Rollback All Changes') {
                        this.outputChannel.appendLine('[Rollback Safety]: Discarding dirty working copy edits...');
                        await this.runShell('git reset --hard HEAD');
                        await this.runShell('git clean -fd');
                        vscode.window.showInformationMessage('🛡️ Workspace successfully rolled back to last clean commit!');
                        this.outputChannel.appendLine('Rollback accomplished. Status is clean.');
                    }
                }

            } catch (err: any) {
                logger.error('[PRGenerator] Planning failure:', err);
                vscode.window.showErrorMessage(`PR metadata compilation failed: ${err.message}`);
            }
        });
    }

    private async appendToChangelog(response: string): Promise<void> {
        const root = this.getWorkspaceRoot();
        const changelogPath = path.join(root, 'CHANGELOG.md');

        // Extract changelog entries
        const matches = response.match(/## 📌 CHANGELOG Entry\s*```markdown\s*([\s\S]*?)\s*```/);
        const entries = matches ? matches[1].trim() : '';

        if (!entries) {
            return;
        }

        try {
            let originalContent = '';
            try {
                originalContent = await fs.readFile(changelogPath, 'utf8');
            } catch {
                originalContent = '# Changelog\nAll notable changes to this project will be documented in this file.\n';
            }

            const headerPattern = `\n## [1.0.0-Beta] — ${new Date().toISOString().slice(0,10)}\n`;
            const updatedContent = originalContent.includes('[1.0.0-Beta]')
                ? originalContent.replace('[1.0.0-Beta]', `[1.0.0-Beta]\n${entries}\n`)
                : originalContent + headerPattern + entries + '\n';

            await fs.writeFile(changelogPath, updatedContent, 'utf8');
            logger.info('[PRGenerator] Packaged change details appended to CHANGELOG.md');
            vscode.window.showInformationMessage('🟢 Automatically updated: CHANGELOG.md');
        } catch (err: any) {
            logger.warn(`Failed writing changelog addition: ${err.message}`);
        }
    }

    private async generateManualChangesSummary(): Promise<void> {
        // Fallback directory scanner if git is not active
        const trackerPath = path.join(this.getWorkspaceRoot(), 'context', 'progress_tracker.md');
        let fileContent = '';
        try {
            fileContent = await fs.readFile(trackerPath, 'utf8');
            this.outputChannel.appendLine(`[Crawler]: Found progress tracker summaries:\n${fileContent.substring(0, 800)}...`);
        } catch {
            this.outputChannel.appendLine('No progress tracker data found. Skipping manual changes.');
            return;
        }

        const prompt = `Draft a high-level PR-Ready report using this local progress ledger:
${fileContent}

Focus on completed milestones.`;

        const report = await this.ollama.generateCompletion(prompt, {
            model: this.ollama.modelChat,
            temperature: 0.1
        });
        
        this.outputChannel.appendLine('\n' + report);
        const prSummaryPath = path.join(this.getWorkspaceRoot(), 'PR_SUMMARY.md');
        await fs.writeFile(prSummaryPath, report, 'utf8');
        vscode.window.showInformationMessage('Saved: PR_SUMMARY.md');
    }
}
