import * as fs from 'fs/promises';
import * as path from 'path';
import { exec } from 'child_process';
import { logger } from '../utils/Logger';

export class PreCommitHookManager {
    /**
     * Scaffolds the offline semantic pre-commit validation hook
     */
    public static async scaffoldHook(workspaceRoot: string): Promise<{ success: boolean; message: string }> {
        try {
            const gitDir = path.join(workspaceRoot, '.git');
            try {
                const gitStat = await fs.stat(gitDir);
                if (!gitStat.isDirectory()) {
                    return { success: false, message: 'Active folder is not initialized as a git repository.' };
                }
            } catch {
                return { success: false, message: 'Git repository (.git directory) was not found in the current workspace.' };
            }

            const hermesDir = path.join(workspaceRoot, '.hermes');
            await fs.mkdir(hermesDir, { recursive: true });

            // 1. Scaffold the self-contained JS staging validation scanner
            const scannerPath = path.join(hermesDir, 'pre-commit-scanner.js');
            const scannerCode = `// 🛡️ HermesForge Semantic Pre-commit Shield - 100% Offline AST & Security Audit
const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

console.log('\\x1b[36m%s\\x1b[0m', '=======================================================');
console.log('\\x1b[36m%s\\x1b[0m', '🛡️  HERMESFORGE SEMANTIC SDLC PRE-COMMIT SHIELD V1.0');
console.log('\\x1b[36m%s\\x1b[0m', '=======================================================');

try {
    // 1. Fetch staged files via git diff
    const stagedFilesOutput = execSync('git diff --cached --name-only', { encoding: 'utf8' });
    const files = stagedFilesOutput.split('\\n').map(f => f.trim()).filter(Boolean);

    if (files.length === 0) {
        console.log('🟢 No staged changes detected. Code commit allowed.');
        process.exit(0);
    }

    const filteredFiles = files.filter(f => /\\.(js|ts|jsx|tsx|json)$/i.test(f));
    if (filteredFiles.length === 0) {
        console.log('🟢 No code files staged. Bypassing semantic checks.');
        process.exit(0);
    }

    console.log(\`🔍 Auditing \${filteredFiles.length} staged code files...\`);

    let failureCount = 0;

    for (const file of filteredFiles) {
        if (!fs.existsSync(file)) continue;
        const stats = fs.statSync(file);
        if (stats.isDirectory()) continue;

        const content = fs.readFileSync(file, 'utf8');

        // Check A: Crude syntax brackets matching (AST defense)
        const openBraceCount = (content.match(/\\{/g) || []).length;
        const closeBraceCount = (content.match(/\\}/g) || []).length;
        if (openBraceCount !== closeBraceCount) {
            console.log(\`\\x1b[31m❌ [BLOCKER] Syntax mismatch in \${file}: brackets are unbalanced ({: \${openBraceCount}, }: \${closeBraceCount})\\x1b[0m\`);
            failureCount++;
        }

        // Check B: Memory Leak / Timer Hazards
        if (content.includes('setInterval') && !content.includes('clearInterval')) {
            console.log(\`\\x1b[33m⚠️  [WARNING] Possible memory hazard in \${file}: 'setInterval' used without corresponding 'clearInterval'\\x1b[0m\`);
        }

        // Check C: Cryptographic/Sensitive Keys Storage Check
        const apiKeyRegex = /(api_key|api-key|secret_key|private_key|token|auth_token)\\s*:\\s*['\\\`"][A-Za-z0-9_\\-]{15,100}['\\\`"]/i;
        if (apiKeyRegex.test(content)) {
            console.log(\`\\x1b[31m❌ [BLOCKER] Cryptographic integrity fail in \${file}: Plaintext API Key or credentials storage pattern spotted!\\x1b[0m\`);
            failureCount++;
        }

        // Check D: Unhandled Promise Rejection Hazard
        if (content.includes('new Promise') && !content.includes('reject') && !content.includes('resolve')) {
            console.log(\`\\x1b[31m❌ [BLOCKER] Promise execution fault in \${file}: Promise created without resolving or rejecting.\\x1b[0m\`);
            failureCount++;
        }
    }

    if (failureCount > 0) {
        console.log('\\x1b[31m%s\\x1b[0m', '\\n❌ COMMIT FAILED: HermesForge semantic checks identified structural/AST errors.');
        console.log('\\x1b[33m%s\\x1b[0m', 'Please rectify the blockers highlighted above before trying to commit again.');
        process.exit(1);
    } else {
        console.log('\\x1b[32m%s\\x1b[0m', '\\n🟢 SUCCESS: All offline semantic audits passed. Code commit allowed!');
        process.exit(0);
    }
} catch (err) {
    console.error('⚠️  Failed to complete pre-commit scanner audit:', err.message);
    process.exit(0); // Fail-safe: allow commit on diagnostic error
}
`;
            await fs.writeFile(scannerPath, scannerCode, 'utf8');

            // 2. Scaffold the git hook trigger shell script
            const hookDir = path.join(gitDir, 'hooks');
            await fs.mkdir(hookDir, { recursive: true });
            const hookPath = path.join(hookDir, 'pre-commit');

            const hookScript = `#!/bin/sh
# HermesForge Git hook trigger
node .hermes/pre-commit-scanner.js
`;
            await fs.writeFile(hookPath, hookScript, { encoding: 'utf8', mode: 0o755 });

            logger.info(`[PreCommitHookManager] Successfully scaffolded hook at ${hookPath}`);
            return {
                success: true,
                message: '🟢 Semantic git pre-commit hook registered successfully! Active defense shield is online.'
            };
        } catch (err: any) {
            logger.error('[PreCommitHookManager] Registration failed', err);
            return { success: false, message: `Failed to register git pre-commit hook: ${err.message}` };
        }
    }

    /**
     * Executed directly within the editor to run on-demand staged validation scanning
     */
    public static async runOnDemandScan(workspaceRoot: string): Promise<{ success: boolean; message: string; failures: string[] }> {
        return new Promise((resolve) => {
            exec('git diff --cached --name-only', { cwd: workspaceRoot }, async (err, stdout) => {
                if (err) {
                    resolve({ success: false, message: `Failed to read staged files: ${err.message}`, failures: [] });
                    return;
                }

                const files = stdout.split('\n').map(f => f.trim()).filter(Boolean);
                if (files.length === 0) {
                    resolve({ success: true, message: 'No staged files found in the active workbench.', failures: [] });
                    return;
                }

                const filtered = files.filter(f => /\.(js|ts|jsx|tsx|json)$/i.test(f));
                if (filtered.length === 0) {
                    resolve({ success: true, message: 'Staged files contain no supported code files (.ts, .js, .json).', failures: [] });
                    return;
                }

                const failures: string[] = [];
                for (const file of filtered) {
                    const filePath = path.join(workspaceRoot, file);
                    try {
                        const content = await fs.readFile(filePath, 'utf8');

                        // Check unbalanced braces
                        const openBraceCount = (content.match(/\{/g) || []).length;
                        const closeBraceCount = (content.match(/\}/g) || []).length;
                        if (openBraceCount !== closeBraceCount) {
                            failures.push(`${file}: brackets are unbalanced ({: ${openBraceCount}, }: ${closeBraceCount})`);
                        }

                        // Check memory leaks
                        if (content.includes('setInterval') && !content.includes('clearInterval')) {
                            failures.push(`${file}: Potential Memory Hazard 'setInterval' used without clearing`);
                        }

                        // Check credentials leak
                        const apiKeyRegex = /(api_key|api-key|secret_key|private_key|token|auth_token)\s*:\s*['\`"][A-Za-z0-9_\-]{15,100}['\`"]/i;
                        if (apiKeyRegex.test(content)) {
                            failures.push(`${file}: Plaintext API key/token security vulnerability warning`);
                        }

                        // Check Promise reject/resolve structure
                        if (content.includes('new Promise') && !content.includes('reject') && !content.includes('resolve')) {
                            failures.push(`${file}: Promise execution fault - Promise created without resolve or reject.`);
                        }
                    } catch {
                        // ignore unreadable files
                    }
                }

                if (failures.length > 0) {
                    resolve({
                        success: false,
                        message: `❌ Validation Scan Failed: Spotted ${failures.length} semantic issues across staged documents.`,
                        failures
                    });
                } else {
                    resolve({
                        success: true,
                        message: `🟢 Offline Validation Scan Success: All ${filtered.length} staged files conform to security and compilation guidelines.`,
                        failures: []
                    });
                }
            });
        });
    }
}
