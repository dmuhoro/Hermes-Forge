import * as vscode from 'vscode';
import * as fs from 'fs/promises';
import * as path from 'path';
import { OllamaClient } from './OllamaClient';
import { VerificationEngine } from './VerificationEngine';
import { logger } from '../utils/Logger';

export class LegacyMigrator {
    constructor(private readonly ollama: OllamaClient) {}

    /**
     * Entrypoint to migrate the active JavaScript code to type-safe TS with accompanying unit tests.
     */
    public async migrateActiveFile(): Promise<void> {
        const editor = vscode.window.activeTextEditor;
        if (!editor) {
            vscode.window.showErrorMessage('No active text editor found. Please open a JavaScript (.js) file to migrate.');
            return;
        }

        const filePath = editor.document.fileName;
        const fileExt = path.extname(filePath).toLowerCase();

        if (fileExt !== '.js' && fileExt !== '.jsx') {
            const warningChoice = await vscode.window.showWarningMessage(
                `The active file is not a JavaScript file (${fileExt}). Proceed anyway?`,
                'Proceed',
                'Cancel'
            );
            if (warningChoice !== 'Proceed') {
                return;
            }
        }

        const originalCode = editor.document.getText();
        if (!originalCode.trim()) {
            vscode.window.showErrorMessage('Active file is empty. Nothing to migrate.');
            return;
        }

        await vscode.window.withProgress({
            location: vscode.ProgressLocation.Notification,
            title: 'HermesForge: Migrating Legacy Code...',
            cancellable: false
        }, async (progress) => {
            try {
                // 1. Core Codebase Analysis & Modernization prompt
                progress.report({ message: 'Analyzing legacy semantics & converting AST contracts...' });

                const migrationPrompt = `You are the HermesForge LEGACY CODE MIGRATION AGENT.
Your mission is to modernize old legacy JavaScript code to high-standard TypeScript:
- Implement strict type contracts, type annotations, and custom interfaces.
- Eliminate loose assignments and any 'any' typings. Replace them with concrete structural definitions.
- Use ES Module named exports instead of CommonJS modules.exports.
- Maintain exact business logic behavior without functional alterations.

FILE NAME: ${path.basename(filePath)}
LEGACY CODE:
\`\`\`javascript
${originalCode}
\`\`\`

You MUST respond strictly with two clear code blocks.
First block: The updated complete TypeScript file content wrapped in a markdown code block starting with \`\`\`typescript.
Second block: Comprehensive companion unit tests using "vitest" format wrapped in a markdown code block starting with \`\`\`test.

Do not write conversational preamble. Prioritize safety and compilation capabilities.`;

                const response = await this.ollama.generateCompletion(migrationPrompt, {
                    model: this.ollama.modelChat,
                    temperature: 0.1
                });

                // Parse response
                progress.report({ message: 'Extracting modernized code blocks...' });
                const tsCode = this.extractCodeBlock(response, 'typescript');
                const testCode = this.extractCodeBlock(response, 'test') || this.extractCodeBlock(response, 'javascript');

                if (!tsCode) {
                    throw new Error('Local model failed to generate compliant TypeScript block structures.');
                }

                // 2. Draft target path
                const directory = path.dirname(filePath);
                const fileStem = path.basename(filePath, fileExt);
                const targetTsPath = path.join(directory, `${fileStem}.ts`);
                const targetTestPath = path.join(directory, `${fileStem}.test.ts`);

                // Prevent immediate overwrite before approval
                progress.report({ message: 'Awaiting write approvals...' });
                
                const writeTsChoice = await vscode.window.showInformationMessage(
                    `Modernization complete! Create typescript file to: ${path.relative(process.cwd(), targetTsPath)}?`,
                    'Write TS File',
                    'Cancel migration'
                );

                if (writeTsChoice !== 'Write TS File') {
                    vscode.window.showInformationMessage('Legacy migration cancelled.');
                    return;
                }

                // Write modern TS file
                await fs.writeFile(targetTsPath, tsCode, 'utf8');
                logger.info(`[LegacyMigrator] Created TypeScript file: ${targetTsPath}`);

                // Write companion test file if generated
                if (testCode) {
                    const writeTestChoice = await vscode.window.showInformationMessage(
                        `Would you like to write companion tests to: ${path.relative(process.cwd(), targetTestPath)}?`,
                        'Write Tests',
                        'Skip Tests'
                    );

                    if (writeTestChoice === 'Write Tests') {
                        await fs.writeFile(targetTestPath, testCode, 'utf8');
                        logger.info(`[LegacyMigrator] Created test file: ${targetTestPath}`);
                    }
                }

                // 3. Self-Healing verification loop
                progress.report({ message: 'Verifying typescript typechecks (npm run lint)...' });
                const verifier = new VerificationEngine(this.ollama);
                const folders = vscode.workspace.workspaceFolders;
                const root = folders && folders.length > 0 ? folders[0].uri.fsPath : process.cwd();

                const compilationPass = await verifier.verifyAndHeal(root, 'npm run lint', 2);

                if (compilationPass) {
                    vscode.window.showInformationMessage(`🟢 Legacy code modernized and fully verified successfully! Created: ${path.basename(targetTsPath)}`);
                } else {
                    vscode.window.showWarningMessage('⚠️ TypeScript file created, but typechecking or linter failed verification check. Please inspect and correct types.');
                }

            } catch (err: any) {
                logger.error('[LegacyMigrator] Error modernizing code:', err);
                vscode.window.showErrorMessage(`Legacy Migration failed: ${err.message}`);
            }
        });
    }

    private extractCodeBlock(text: string, language: string): string | null {
        const regex = new RegExp(`\`\`\`${language}[\\s\\S]*?\\n([\\s\\S]*?)\`\`\``, 'i');
        const match = text.match(regex);
        if (match) {
            return match[1].trim();
        }
        
        // Fallback for general block structure if specific is not found
        if (language === 'typescript') {
            const genericBlock = text.match(/\`\`\`(ts|typescript)?\n([\s\S]*?)\`\`\`/i);
            if (genericBlock) return genericBlock[2].trim();
        }
        return null;
    }
}
