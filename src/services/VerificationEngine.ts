import * as fs from 'fs/promises';
import * as path from 'path';
import * as cp from 'child_process';
import { OllamaClient } from './OllamaClient';
import { logger } from '../utils/Logger';

interface ExecutionResult {
    code: number;
    stdout: string;
    stderr: string;
}

export class VerificationEngine {
    constructor(private readonly ollama: OllamaClient) {}

    /**
     * Executes the local compiler/test process, listens for failures, and feeds error codes/traces
     * into the local model for automated self-healing. Restores file state from cache buffers if limits are hit.
     */
    public async verifyAndHeal(
        workspacePath: string,
        buildCommand: string,
        retryLimit: number = 3
    ): Promise<boolean> {
        logger.info(`[VerificationEngine] Initiating verification sequence. Command: "${buildCommand}" at "${workspacePath}"`);
        
        const originalFileBuffers = new Map<string, string>();
        let attempt = 1;
        let success = false;

        // Helper to back up target file before modification
        const backupFile = async (absolutePath: string) => {
            if (!originalFileBuffers.has(absolutePath)) {
                try {
                    const content = await fs.readFile(absolutePath, 'utf8');
                    originalFileBuffers.set(absolutePath, content);
                    logger.info(`[VerificationEngine] Cached pre-heal state of: ${absolutePath}`);
                } catch (err: any) {
                    logger.warn(`[VerificationEngine] Could not back up file: ${absolutePath}, error: ${err.message}`);
                }
            }
        };

        // Helper to roll back all modified files to pre-heal state
        const triggerRollback = async () => {
            logger.warn(`[VerificationEngine] Retry limit (${retryLimit}) exhausted. Restoring pre-heal file states...`);
            for (const [absPath, originalContent] of originalFileBuffers.entries()) {
                try {
                    await fs.writeFile(absPath, originalContent, 'utf8');
                    logger.info(`[VerificationEngine] Successfully restored state for: ${absPath}`);
                } catch (err: any) {
                    logger.error(`[VerificationEngine] Failed to restore state for: ${absPath}: ${err.message}`);
                }
            }
        };

        while (attempt <= retryLimit && !success) {
            logger.info(`[VerificationEngine] Running compilation check (Attempt ${attempt}/${retryLimit})...`);
            
            const timer = logger.startTimer(`Verification Run - Attempt ${attempt}`);
            const result = await this.runBuildCommand(buildCommand, workspacePath);
            timer();

            if (result.code === 0) {
                logger.info(`[VerificationEngine] Compilation passed perfectly on attempt ${attempt}!`);
                success = true;
                break;
            }

            logger.warn(`[VerificationEngine] Compilation failed on attempt ${attempt}. Error analysis initialized.`);
            logger.debug(`[VerificationEngine] Compiler STDERR:\n${result.stderr}`);
            logger.debug(`[VerificationEngine] Compiler STDOUT:\n${result.stdout}`);

            // Find all affected files based on output logs and recent changes
            const parsedPaths = this.parseAffectedFiles(result.stderr, result.stdout, workspacePath);
            const recentPaths = await this.getRecentFiles(workspacePath);
            
            // Merge files to target
            const targetPaths = Array.from(new Set([...parsedPaths, ...recentPaths]));
            if (targetPaths.length === 0) {
                logger.error('[VerificationEngine] Could not detect any affected or recently modified files. Cannot perform self-healing.');
                attempt++;
                continue;
            }

            logger.info(`[VerificationEngine] Detected ${targetPaths.length} target candidate files for curation:`, targetPaths);

            // Fetch contents and prepare context
            const filesContextList: string[] = [];
            for (const p of targetPaths) {
                try {
                    // Back up file to enable transaction rollback if heals fail
                    await backupFile(p);

                    // Add content block to PM compiler context
                    const content = await fs.readFile(p, 'utf8');
                    const relativeName = path.relative(workspacePath, p);
                    filesContextList.push(`--- FILE: ${relativeName} ---\n${content}`);
                } catch (err) {
                    logger.warn(`[VerificationEngine] Skipping unreadable candidate file: ${p}`);
                }
            }

            const filesContext = filesContextList.join('\n\n');
            const errorReport = result.stderr || result.stdout || 'Unknown compiler exit non-zero status.';

            const prompt = `You are a Principal Systems and Compiler Engineer.
A local TypeScript/JavaScript compiler check has FAILED with compilation errors.

### COMPILATION ERROR DETAILS:
${errorReport}

### DIRECTORY SOURCE FILES CAUSING MISMATCH:
${filesContext}

Your goal is to parse the syntax issue, type constraint violation, or missing namespace import.
Deliver the completely fixed content for any affected files. For each file you correct, output the absolute entire content of the file. No comments skipping code, no ellipses.

To help us parse your updates programmatically, you MUST wrap the fully updated, complete, production-grade contents of each corrected file using these precise start and end markers:

<<<START_FILE:relative/path/to/file>>>
[Whole Corrected File Contents]
<<<END_FILE>>>

Use exactly the relative paths shown in the FILE headers above.
Do not write normal explanations or commentary outside the file markers.`;

            logger.info(`[VerificationEngine] Dispatching compiler healing query to local Hermes3:8b model...`);
            
            let modelResponse = '';
            try {
                modelResponse = await this.ollama.generateCompletion(prompt, {
                    model: 'hermes3:8b',
                    temperature: 0.1
                });
            } catch (err: any) {
                logger.error(`[VerificationEngine] Local LLM healing failed during pipeline execution: ${err.message || err}`);
                attempt++;
                continue;
            }

            const parsedCorrections = this.parseCorrections(modelResponse, targetPaths, workspacePath);
            if (parsedCorrections.size === 0) {
                logger.warn('[VerificationEngine] LLM returned no formatted file corrections in compliance with standard tags.');
                attempt++;
                continue;
            }

            // Write all corrected items to the disk
            for (const [filePath, fileContent] of parsedCorrections.entries()) {
                try {
                    await fs.mkdir(path.dirname(filePath), { recursive: true });
                    await fs.writeFile(filePath, fileContent, 'utf8');
                    logger.info(`[VerificationEngine] Applied healed revision for: ${filePath}`);
                } catch (err: any) {
                    logger.error(`[VerificationEngine] Failed writing healed revision to file: ${filePath}, error: ${err.message}`);
                }
            }

            attempt++;
        }

        if (success) {
            await this.updateProgressTracker(workspacePath);
            return true;
        } else {
            await triggerRollback();
            return false;
        }
    }

    /**
     * Executes the requested command in the local workspace shell.
     */
    private runBuildCommand(command: string, cwd: string): Promise<ExecutionResult> {
        return new Promise((resolve) => {
            cp.exec(command, { cwd }, (error, stdout, stderr) => {
                const code = error ? (error.code ?? 1) : 0;
                resolve({
                    code,
                    stdout: stdout || '',
                    stderr: stderr || ''
                });
            });
        });
    }

    /**
     * Extracts absolute paths of files referenced in error streams.
     */
    private parseAffectedFiles(stderr: string, stdout: string, workspacePath: string): string[] {
        const paths = new Set<string>();
        const combined = `${stderr}\n${stdout}`;
        
        // Match common typescript relative/absolute file path patterns like src/modules/foo.ts(1,2)
        const pathRegex = /(?:src[\\/]\S+\.(?:ts|tsx|js|jsx))/gi;
        let match;
        
        while ((match = pathRegex.exec(combined)) !== null) {
            const rawPath = match[0].trim();
            // strip trailing brackets or commas if any
            const cleanedPath = rawPath.replace(/[()]/g, '');
            const resolved = path.resolve(workspacePath, cleanedPath);
            paths.add(resolved);
        }

        return Array.from(paths);
    }

    /**
     * Automatically queries the repository's TypeScript files and returns files modified recently.
     */
    private async getRecentFiles(workspacePath: string): Promise<string[]> {
        const fileList: { filePath: string; mtime: number }[] = [];
        await this.scanFilesRecursively(path.join(workspacePath, 'src'), fileList);
        
        // Sort files by last modification timestamp descending
        fileList.sort((a, b) => b.mtime - a.mtime);
        
        // Return top 3 recently modified files
        return fileList.slice(0, 3).map(f => f.filePath);
    }

    private async scanFilesRecursively(dir: string, fileList: { filePath: string; mtime: number }[]): Promise<void> {
        let items: string[] = [];
        try {
            items = await fs.readdir(dir);
        } catch {
            return;
        }

        for (const item of items) {
            if (item === 'node_modules' || item === 'dist' || item === '.git') {
                continue;
            }
            const fullPath = path.join(dir, item);
            try {
                const stat = await fs.stat(fullPath);
                if (stat.isDirectory()) {
                    await this.scanFilesRecursively(fullPath, fileList);
                } else if (stat.isFile() && /\.(tsx?|jsx?)$/.test(item)) {
                    fileList.push({ filePath: fullPath, mtime: stat.mtimeMs });
                }
            } catch {}
        }
    }

    /**
     * Parses the custom START_FILE and END_FILE boundaries out of the LLM responses.
     */
    private parseCorrections(response: string, targetPaths: string[], workspacePath: string): Map<string, string> {
        const corrections = new Map<string, string>();
        
        // Split response lines and track parse states
        const lines = response.split('\n');
        let currentFile: string | null = null;
        let currentLines: string[] = [];

        for (const line of lines) {
            const trimmedLine = line.trim();
            const startMatch = trimmedLine.match(/^<<<START_FILE:(.*?)>>>$/);
            
            if (startMatch) {
                currentFile = startMatch[1].trim();
                currentLines = [];
                continue;
            }

            if (trimmedLine === '<<<END_FILE>>>') {
                if (currentFile) {
                    const resolvedPath = path.resolve(workspacePath, currentFile);
                    corrections.set(resolvedPath, currentLines.join('\n'));
                    currentFile = null;
                }
                continue;
            }

            if (currentFile !== null) {
                currentLines.push(line);
            }
        }

        // Robust fallback: if LLM output does not include custom delimiters but only 1 candidate was passed
        if (corrections.size === 0 && targetPaths.length === 1) {
            const codeBlockRegex = /```(?:typescript|typescript|javascript)?([\s\S]*?)```/i;
            const codeBlockMatch = codeBlockRegex.exec(response);
            if (codeBlockMatch) {
                corrections.set(targetPaths[0], codeBlockMatch[1].trim());
                logger.info(`[VerificationEngine] Used fallback markdown extractor for file: ${targetPaths[0]}`);
            }
        }

        return corrections;
    }

    /**
     * Updates progress_tracker.md with the latest compilation outcomes.
     */
    private async updateProgressTracker(workspacePath: string): Promise<void> {
        const trackerPath = path.join(workspacePath, 'context', 'progress_tracker.md');
        let content = '';
        try {
            content = await fs.readFile(trackerPath, 'utf8');
        } catch {
            content = `# Progress Tracker\n\n| Phase | Task | Specification | Status | Updated |\n| :--- | :--- | :--- | :--- | :--- |\n`;
        }

        const dateStr = new Date().toISOString();
        const verificationRow = `| Auditor | Auto Compilation Verification | Build Validation | **Verified & Compiled** | ${dateStr} |\n`;

        if (content.includes('| Auditor |')) {
            content = content.replace(/\| Auditor \|.*(?:\r?\n)?/g, verificationRow);
        } else {
            // Append as final row to mark consolidation
            if (!content.endsWith('\n')) content += '\n';
            content += verificationRow;
        }

        await fs.mkdir(path.dirname(trackerPath), { recursive: true });
        await fs.writeFile(trackerPath, content, 'utf8');
        logger.info(`[VerificationEngine] Saved verification log to progress tracker.`);
    }
}
