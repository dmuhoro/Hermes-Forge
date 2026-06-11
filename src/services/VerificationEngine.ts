import * as fs from 'fs/promises';
import * as path from 'path';
import * as cp from 'child_process';
import * as vscode from 'vscode';
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

            // Find specific line errors and their enclosing scopes
            const errorLocations = this.parseErrorLocations(result.stderr, result.stdout, workspacePath);
            const filesContextList: string[] = [];
            const targetedFiles = new Set<string>();

            if (errorLocations.length > 0) {
                logger.info(`[VerificationEngine] AST Error Isolation: Found ${errorLocations.length} specific compiler error locations.`);
                
                for (const loc of errorLocations) {
                    try {
                        await backupFile(loc.filePath);
                        targetedFiles.add(loc.filePath);

                        const { scopeText, scopeName } = await this.getASTIsolatedScope(loc.filePath, loc.line);
                        const relativeName = path.relative(workspacePath, loc.filePath);

                        if (scopeText) {
                            filesContextList.push(`--- FILE: ${relativeName} (ERROR SCOPE BLOCK: "${scopeName}" on or around line ${loc.line}) ---\n${scopeText}`);
                        } else {
                            // Fallback to reading the full file
                            const content = await fs.readFile(loc.filePath, 'utf8');
                            filesContextList.push(`--- FILE: ${relativeName} ---\n${content}`);
                        }
                    } catch (err: any) {
                        logger.warn(`[VerificationEngine] Skipping unreadable error candidate: ${loc.filePath}`);
                    }
                }
            }

            // Fallback: If no explicit line locations were resolved, or to augment with recently modified files
            const parsedPaths = this.parseAffectedFiles(result.stderr, result.stdout, workspacePath);
            const recentPaths = await this.getRecentFiles(workspacePath);
            const targetPaths = Array.from(new Set([...parsedPaths, ...recentPaths, ...targetedFiles]));

            if (targetPaths.length === 0) {
                logger.error('[VerificationEngine] Could not detect any affected, localized or recently modified files. Cannot perform self-healing.');
                attempt++;
                continue;
            }

            // Include files that were parsed but not isolated by line yet
            for (const p of targetPaths) {
                if (targetedFiles.has(p)) continue; // Already added as an isolated block or fallback above
                try {
                    await backupFile(p);
                    const content = await fs.readFile(p, 'utf8');
                    const relativeName = path.relative(workspacePath, p);
                    filesContextList.push(`--- FILE: ${relativeName} ---\n${content}`);
                } catch (err) {
                    logger.warn(`[VerificationEngine] Skipping unreadable candidate file: ${p}`);
                }
            }

            const filesContext = filesContextList.join('\n\n');
            const errorReport = result.stderr || result.stdout || 'Unknown compiler exit status.';

            const prompt = `You are a Principal Systems and Compiler Engineer.
A local TypeScript/JavaScript compiler check has FAILED with compilation errors.

### COMPILATION ERROR DETAILS:
${errorReport}

### DIRECTORY SOURCE FILES OR ISOLATED SCOPE BLOCKS CAUSING TS FAILURE:
${filesContext}

Your goal is to parse the syntax issue, nesting or formatting mismatch, or type constraint violation.
Deliver the completely fixed content for any affected files. For each file you correct, output the absolute entire content of the file. No comments skipping code, no ellipses.

To help us parse your updates programmatically, you MUST wrap the fully updated, complete, production-grade contents of each corrected file using these precise start and end markers:

<<<START_FILE:relative/path/to/file>>>
[Whole Corrected File Contents]
<<<END_FILE>>>

Use exactly the relative paths shown in the FILE headers above (do not append the string "ERROR SCOPE BLOCK..." or "RECENTLY MODIFIED" to the filepath).
Do not write normal explanations or commentary outside the file markers.`;

            logger.info('[VerificationEngine] Dispatching compiler healing query to local Hermes3:8b model...');
            
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
            content = '# Progress Tracker\n\n| Phase | Task | Specification | Status | Updated |\n| :--- | :--- | :--- | :--- | :--- |\n';
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
        logger.info('[VerificationEngine] Saved verification log to progress tracker.');
    }

    /**
     * Parses the console error output using regex patterns to isolate specific file paths
     * and line/col numbers of compiler errors.
     */
    private parseErrorLocations(stderr: string, stdout: string, workspacePath: string): Array<{ filePath: string; line: number; col: number }> {
        const locations: Array<{ filePath: string; line: number; col: number }> = [];
        const combined = `${stderr}\n${stdout}`;
        
        // Match standard patterns:
        // 1. path/to/file.ts:line:col
        // 2. path/to/file.ts(line,col)
        const patterns = [
            /(src[\\/]\S+\.(?:tsx?|jsx?)):(\d+):(\d+)/gi,
            /(src[\\/]\S+\.(?:tsx?|jsx?))\((\d+),(\d+)\)/gi
        ];

        for (const regex of patterns) {
            let match;
            while ((match = regex.exec(combined)) !== null) {
                const relativePath = match[1];
                const line = parseInt(match[2], 10);
                const col = parseInt(match[3], 10);
                const absolutePath = path.resolve(workspacePath, relativePath);
                
                if (!locations.some(loc => loc.filePath === absolutePath && loc.line === line)) {
                    locations.push({ filePath: absolutePath, line, col });
                }
            }
        }
        return locations;
    }

    /**
     * Finds the deepest/most specific DocumentSymbol containing a specific line index.
     */
    private findSymbolEnclosingLine(symbols: vscode.DocumentSymbol[], lineZeroIndexed: number): vscode.DocumentSymbol | null {
        let bestMatch: vscode.DocumentSymbol | null = null;
        for (const sym of symbols) {
            if (sym.range && sym.range.start.line <= lineZeroIndexed && sym.range.end.line >= lineZeroIndexed) {
                bestMatch = sym;
                if (sym.children && sym.children.length > 0) {
                    const childMatch = this.findSymbolEnclosingLine(sym.children, lineZeroIndexed);
                    if (childMatch) {
                        bestMatch = childMatch;
                    }
                }
            }
        }
        return bestMatch;
    }

    /**
     * Isolates a specific scope block either via VS Code Symbols or via a high-fidelity brace matching fallback tracker.
     */
    private async getASTIsolatedScope(filePath: string, lineNumber: number): Promise<{ scopeText: string; scopeName: string }> {
        const lineZeroIndexed = lineNumber - 1;

        // Try method 1: VS Code programmatic Symbol Provider
        try {
            const uri = vscode.Uri.file(filePath);
            const symbols = await vscode.commands.executeCommand<vscode.DocumentSymbol[]>(
                'vscode.executeDocumentSymbolProvider',
                uri
            );

            if (symbols && symbols.length > 0) {
                const enclosingSymbol = this.findSymbolEnclosingLine(symbols, lineZeroIndexed);
                if (enclosingSymbol) {
                    const doc = await vscode.workspace.openTextDocument(uri);
                    const scopeText = doc.getText(enclosingSymbol.range);
                    logger.info(`[VerificationEngine] AST Error Isolation: Located enclosing scope "${enclosingSymbol.name}" using VS Code symbols.`);
                    return { scopeText, scopeName: enclosingSymbol.name };
                }
            }
        } catch (err: any) {
            logger.debug(`[VerificationEngine] VS Code Document Symbol isolation failed or skipped: ${err.message || err}`);
        }

        // Try method 2: Brace-counting algorithm fallback
        logger.info(`[VerificationEngine] Method symbols unavailable. Triggering micro brace-counting scope isolation on file: ${filePath}`);
        return this.isolateErrorEnclosingScopeFallback(filePath, lineNumber);
    }

    /**
     * Brace-tracking scope parser fallback that walks backwards to declare borders and forward to extract the code block.
     */
    private async isolateErrorEnclosingScopeFallback(filePath: string, lineNumber: number): Promise<{ scopeText: string; scopeName: string }> {
        try {
            const content = await fs.readFile(filePath, 'utf8');
            const lines = content.split(/\r?\n/);
            const targetIndex = lineNumber - 1;

            if (targetIndex < 0 || targetIndex >= lines.length) {
                return { scopeText: content, scopeName: 'Full File' };
            }

            // Move backwards up to 35 lines to locate a declaration block
            let scopeStartIndex = Math.max(0, targetIndex - 10);
            let scopeName = 'Local Scope';
            const declRegex = /(?:class|function|interface|const|let|public|private|static|async|get|set|export)\s+([a-zA-Z0-9_$]+)/;

            for (let i = targetIndex; i >= Math.max(0, targetIndex - 35); i--) {
                const match = lines[i].match(declRegex);
                if (match) {
                    scopeStartIndex = i;
                    scopeName = match[1] || match[0].trim();
                    break;
                }
            }

            // Track braces to isolate the closing boundary
            let braceCount = 0;
            let foundOpenBrace = false;
            let scopeEndIndex = Math.min(lines.length - 1, targetIndex + 15);

            for (let i = scopeStartIndex; i < lines.length; i++) {
                const line = lines[i];
                for (const char of line) {
                    if (char === '{') {
                        braceCount++;
                        foundOpenBrace = true;
                    } else if (char === '}') {
                        braceCount--;
                    }
                }
                if (foundOpenBrace && braceCount === 0) {
                    scopeEndIndex = i;
                    break;
                }
            }

            if (scopeEndIndex < targetIndex) {
                scopeEndIndex = Math.min(lines.length - 1, targetIndex + 15);
            }

            const scopeText = lines.slice(scopeStartIndex, scopeEndIndex + 1).join('\n');
            return { scopeText, scopeName };
        } catch (err: any) {
            logger.warn(`[VerificationEngine] Local scope extraction failed completely: ${err.message}`);
            return { scopeText: '', scopeName: '' };
        }
    }
}
