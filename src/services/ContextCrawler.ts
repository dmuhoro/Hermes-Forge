import * as fs from 'fs/promises';
import * as path from 'path';
import { logger } from '../utils/Logger';

export interface SemanticChunk {
    filePath: string;
    blockName: string;
    content: string;
    score: number;
}

export class ContextCrawler {
    private visited = new Set<string>();

    private async isTextFile(filePath: string): Promise<boolean> {
        const ext = path.extname(filePath).toLowerCase();
        // Skip common binary and media extensions
        const nonTextExts = ['.png', '.jpg', '.jpeg', '.gif', '.mp4', '.pdf', '.zip', '.tar', '.gz', '.bin', '.exe', '.dll', '.woff', '.woff2', '.ttf'];
        return !nonTextExts.includes(ext);
    }

    private async fileExists(filePath: string): Promise<boolean> {
        try {
            const stat = await fs.stat(filePath);
            return stat.isFile();
        } catch {
            return false;
        }
    }

    public async crawlDependencies(filePath: string, depth: number = 2): Promise<string[]> {
        const dependencies: string[] = [];
        
        if (depth < 0 || this.visited.has(filePath)) {
            return dependencies;
        }
        
        this.visited.add(filePath);

        try {
            // Attempt to resolve file with common TypeScript/JavaScript extensions if lacking
            let finalPath = filePath;
            if (!(await this.fileExists(finalPath))) {
                const exts = ['.ts', '.tsx', '.js', '.jsx'];
                let found = false;
                for (const ext of exts) {
                    if (await this.fileExists(filePath + ext)) {
                        finalPath = filePath + ext;
                        found = true;
                        break;
                    }
                }
                // If we can't find a matching local file, skip to avoid crashing
                if (!found) return dependencies;
            }

            // Exclude node_modules explicitly
            if (finalPath.includes('node_modules')) {
                return dependencies;
            }

            if (!(await this.isTextFile(finalPath))) {
                return dependencies;
            }

            const content = await fs.readFile(finalPath, 'utf8');
            dependencies.push(finalPath);
            
            if (depth > 0) {
                // Optimized regex designed for static JS/TS ES6 local imports matching
                // e.g. import { Module } from './module'
                const importRegex = /import\s+.*?from\s+['"]([^'"]+)['"]/g;
                let match;
                while ((match = importRegex.exec(content)) !== null) {
                    const importTarget = match[1];
                    // Only crawl local relative dependencies to remain vector-less and fast
                    if (importTarget.startsWith('.')) {
                        const resolvedDir = path.dirname(finalPath);
                        const possiblePathBase = path.resolve(resolvedDir, importTarget);
                        
                        const childDeps = await this.crawlDependencies(possiblePathBase, depth - 1);
                        dependencies.push(...childDeps);
                    }
                }
            }
        } catch (error) {
            logger.warn(`[ContextCrawler] Failed to read or parse dependency at path: ${filePath}`, error);
        }

        return [...new Set(dependencies)]; // Ensure uniqueness
    }

    public async getExpandedContext(filePath: string): Promise<string> {
        this.visited.clear();
        logger.info(`[ContextCrawler] Starting File-Tree RAG expansion for primary file: ${filePath}`);
        
        const timerStop = logger.startTimer('File-Tree Context RAG Generation');
        const allFiles = await this.crawlDependencies(filePath, 2);
        
        if (allFiles.length <= 1) {
            timerStop();
            return ''; // No additional local dependencies found
        }
        
        let expandedContext = '';
        const limitPerDependency = 2000; // Limit dependency footprint to be hardware-friendly

        for (const file of allFiles) {
            // Prevent duplicating the primary file that the user is actively staring at
            if (file === filePath) continue; 
            
            try {
                const text = await fs.readFile(file, 'utf8');
                const relName = path.basename(file);
                const compressedText = ContextCrawler.summarizeCode(text, limitPerDependency);
                expandedContext += `\n// START DEPENDENCY: [${relName}]\n${compressedText}\n// END DEPENDENCY\n`;
            } catch {
                // Fixed unused variable warning
            }
        }
        
        timerStop();
        return expandedContext;
    }

    /**
     * Statically summarizes complex codebase source files down to readable interface definitions, 
     * class structure declarations, and essential skeletons using a hierarchical sliding buffer scheme.
     */
    public static summarizeCode(code: string, maxLength: number = 2000): string {
        if (!code) return '';
        if (code.length <= maxLength) return code;

        const lines = code.split(/\r?\n/);
        const skeleton: string[] = [];
        let braceDepth = 0;

        for (const line of lines) {
            const trimmed = line.trim();
            
            // Brace counting to maintain structure integrity
            for (const char of trimmed) {
                if (char === '{') braceDepth++;
                if (char === '}') braceDepth--;
            }

            // Exclude empty lines or lines with purely brackets if we need space
            if (trimmed === '' || trimmed === '{' || trimmed === '}') {
                if (skeleton.length < 50) {
                    skeleton.push(line);
                }
                continue;
            }

            // Capture structurally significant high-level declarations:
            // imports, class constructors, method/function signatures, exports, types/interfaces
            if (
                trimmed.startsWith('import ') ||
                trimmed.startsWith('export ') ||
                trimmed.startsWith('class ') ||
                trimmed.startsWith('interface ') ||
                trimmed.startsWith('type ') ||
                trimmed.startsWith('enum ') ||
                /^(public|private|protected|static|async|get|set|constructor)\s+/.test(trimmed) ||
                braceDepth === 0 // Root-level declarations
            ) {
                skeleton.push(line);
            } else if (skeleton.length < 30 && (trimmed.startsWith('//') || trimmed.startsWith('/*'))) {
                // Keep lead comments up to length limit
                skeleton.push(line);
            }
        }

        const skeletonText = skeleton.join('\n');
        if (skeletonText.length <= maxLength) {
            return `// [Compressed Structural Skeleton]\n${skeletonText}`;
        }

        // Sliding buffer fallback if skeleton remains larger than ceiling
        const borderLines = Math.floor(maxLength / 160); // estimate chars per line
        const topSlice = lines.slice(0, Math.max(10, borderLines)).join('\n');
        const bottomSlice = lines.slice(-Math.max(10, Math.floor(borderLines / 2))).join('\n');
        return `// [Sliding Buffer Summary - Content Truncated]\n${topSlice}\n\n// ... [REFERENCE INNER LOGIC REMOVED FOR CONTEXT EFFICIENCY] ...\n\n${bottomSlice}`;
    }

    /**
     * Statically chunk complex codebase files based on declarations and line numbers.
     */
    public static chunkFile(filePath: string, content: string): SemanticChunk[] {
        const chunks: SemanticChunk[] = [];
        const lines = content.split(/\r?\n/);
        let currentChunkLines: string[] = [];
        let currentScope = 'root';
        
        for (const line of lines) {
            const trimmed = line.trim();
            
            // Regex to isolate structural declarations
            const classMatch = trimmed.match(/^export\s+class\s+(\w+)|^class\s+(\w+)/);
            const funcMatch = trimmed.match(/^(?:export\s+)?(?:public|private|protected|static|async)?\s*function\s+(\w+)|^(?:export\s+)?const\s+(\w+)\s*=\s*(?:async\s*)?\(/);
            const interfaceMatch = trimmed.match(/^export\s+interface\s+(\w+)|^interface\s+(\w+)/);
            
            if (classMatch) {
                currentScope = `class:${classMatch[1] || classMatch[2]}`;
            } else if (funcMatch) {
                currentScope = `function:${funcMatch[1] || funcMatch[2]}`;
            } else if (interfaceMatch) {
                currentScope = `interface:${interfaceMatch[1] || interfaceMatch[2]}`;
            }
            
            currentChunkLines.push(line);
            
            // Split chunks around 45 lines to keep context precise and readable
            if (currentChunkLines.length >= 45) {
                chunks.push({
                    filePath,
                    blockName: currentScope,
                    content: currentChunkLines.join('\n'),
                    score: 0
                });
                currentChunkLines = currentChunkLines.slice(-5); // 5-line sliding overlap
            }
        }
        
        if (currentChunkLines.length > 0) {
            chunks.push({
                filePath,
                blockName: currentScope,
                content: currentChunkLines.join('\n'),
                score: 0
            });
        }
        
        return chunks;
    }

    /**
     * Parse code text into normalized lowercase keyword tokens, removing noise and stop-words.
     */
    private tokenize(text: string): string[] {
        const words = text.toLowerCase().match(/\b[a-z_][a-z0-9_]{2,19}\b/g) || [];
        const programmingStopwords = new Set([
            'and', 'the', 'for', 'let', 'const', 'var', 'class', 'interface', 'import', 'export', 
            'from', 'this', 'return', 'function', 'async', 'await', 'public', 'private', 'protected',
            'true', 'false', 'null', 'undefined', 'this', 'with', 'static', 'extends', 'implements'
        ]);
        return words.filter(word => !programmingStopwords.has(word));
    }

    /**
     * Ranks all codebase chunks offline using a full high-fidelity in-memory Term Frequency-Inverse Document Frequency
     * cosine similarity metric relative to the user query.
     */
    public async searchWorkspace(workspaceRoot: string, query: string, topN: number = 6): Promise<SemanticChunk[]> {
        const fileList: string[] = [];
        
        const scan = async (dir: string) => {
            let items: string[] = [];
            try {
                items = await fs.readdir(dir);
            } catch {
                return;
            }
            for (const item of items) {
                if (item === 'node_modules' || item === 'dist' || item === '.git' || item === 'out' || item === 'build' || item === '.next') {
                    continue;
                }
                const fullPath = path.join(dir, item);
                try {
                    const stat = await fs.stat(fullPath);
                    if (stat.isDirectory()) {
                        await scan(fullPath);
                    } else if (stat.isFile()) {
                        const ext = path.extname(item).toLowerCase();
                        if (['.ts', '.tsx', '.js', '.jsx'].includes(ext)) {
                            fileList.push(fullPath);
                        }
                    }
                } catch {}
            }
        };

        await scan(workspaceRoot);
        
        const allChunks: SemanticChunk[] = [];
        for (const file of fileList) {
            try {
                const text = await fs.readFile(file, 'utf8');
                const chunks = ContextCrawler.chunkFile(file, text);
                allChunks.push(...chunks);
            } catch {}
        }

        if (allChunks.length === 0) return [];

        // Begin TF-IDF scoring indexation
        const documentRepresentations: Map<SemanticChunk, Map<string, number>> = new Map();
        const documentFrequencies: Map<string, number> = new Map();

        for (const chunk of allChunks) {
            const tokens = this.tokenize(chunk.content);
            const tokenCounts = new Map<string, number>();
            for (const token of tokens) {
                tokenCounts.set(token, (tokenCounts.get(token) || 0) + 1);
            }
            documentRepresentations.set(chunk, tokenCounts);

            for (const token of tokenCounts.keys()) {
                documentFrequencies.set(token, (documentFrequencies.get(token) || 0) + 1);
            }
        }

        const queryTokens = this.tokenize(query);
        const queryCounts = new Map<string, number>();
        for (const token of queryTokens) {
            queryCounts.set(token, (queryCounts.get(token) || 0) + 1);
        }

        const totalDocuments = allChunks.length;
        const idf = (token: string): number => {
            const df = documentFrequencies.get(token) || 0;
            return Math.log(1 + (totalDocuments / (1 + df)));
        };

        // Query vector
        const queryVector = new Map<string, number>();
        let queryNormal = 0;
        for (const [token, count] of queryCounts.entries()) {
            const tf = count;
            const factor = tf * idf(token);
            queryVector.set(token, factor);
            queryNormal += factor * factor;
        }
        queryNormal = Math.sqrt(queryNormal);

        // Score documents using vector dot product cosine equivalence
        for (const chunk of allChunks) {
            const termCounts = documentRepresentations.get(chunk);
            if (!termCounts) continue;

            let dotProduct = 0;
            let docNormal = 0;

            for (const [token, tf] of termCounts.entries()) {
                const factor = tf * idf(token);
                docNormal += factor * factor;
                if (queryVector.has(token)) {
                    dotProduct += factor * (queryVector.get(token) || 0);
                }
            }

            docNormal = Math.sqrt(docNormal);
            const score = (queryNormal > 0 && docNormal > 0) ? (dotProduct / (queryNormal * docNormal)) : 0;
            chunk.score = score;
        }

        // Return top N highest scored chunks, ignoring completely irrelevant zero-score ones
        return allChunks
            .filter(c => c.score > 0)
            .sort((a, b) => b.score - a.score)
            .slice(0, topN);
    }

    /**
     * Smart Context Injection resolves top matching chunks and files, injecting a cohesive local RAG context format.
     */
    public async getSmartContext(workspaceRoot: string, userQuery: string, limit: number = 4): Promise<string> {
        const stopTimer = logger.startTimer('In-Memory TF-IDF Smart Context Retrieval');
        const relevantChunks = await this.searchWorkspace(workspaceRoot, userQuery, limit);
        stopTimer();

        if (relevantChunks.length === 0) return '';

        let injection = '\n\n### 💡 Smart Offline RAG Semantic Context Injector ###\n';
        for (const chunk of relevantChunks) {
            const relativePath = path.relative(workspaceRoot, chunk.filePath);
            injection += `\n--- File Content Segment: ${relativePath} (${chunk.blockName || 'unnamed segment'}) (Relevance match: ${(chunk.score * 100).toFixed(1)}%) ---\n${chunk.content}\n`;
        }
        return injection;
    }

    /**
     * Scans the repository codebase recursively, detecting used tech stacks, estimating density,
     * assessing structural and pattern risk profiles, all completely offline.
     */
    public async analyzeRepository(workspaceRoot: string): Promise<string> {
        const fileList: string[] = [];
        const techStackSet = new Set<string>();
        const riskProfiles: string[] = [];
        let totalLines = 0;
        let anyCount = 0;
        let tryCatchCount = 0;

        const scan = async (dir: string) => {
            let items: string[] = [];
            try {
                items = await fs.readdir(dir);
            } catch {
                return;
            }
            for (const item of items) {
                if (item === 'node_modules' || item === 'dist' || item === '.git' || item === 'out' || item === 'build' || item === '.next') {
                    continue;
                }
                const fullPath = path.join(dir, item);
                try {
                    const stat = await fs.stat(fullPath);
                    if (stat.isDirectory()) {
                        await scan(fullPath);
                    } else if (stat.isFile()) {
                        const ext = path.extname(item).toLowerCase();
                        if (['.ts', '.tsx', '.js', '.jsx', '.json'].includes(ext)) {
                            fileList.push(fullPath);
                            
                            if (ext !== '.json') {
                                const content = await fs.readFile(fullPath, 'utf8');
                                const lines = content.split('\n');
                                totalLines += lines.length;

                                // Fingerprints
                                if (content.includes('import * as vscode') || content.includes("require('vscode')")) {
                                    techStackSet.add('VS Code Extension API');
                                }
                                if (content.includes('react') || content.includes('React')) {
                                    techStackSet.add('React SPA Platform');
                                }
                                if (content.includes('tailwind') || content.includes('@import "tailwindcss"')) {
                                    techStackSet.add('Tailwind CSS Spec v4');
                                }
                                if (content.includes('express') || content.includes('http.createServer')) {
                                    techStackSet.add('Node.js Server Backend');
                                }
                                if (content.includes('ollama') || content.includes('OllamaClient')) {
                                    techStackSet.add('Ollama Local AI');
                                }

                                const matchedAnys = content.match(/:\s*any\b/g);
                                if (matchedAnys) anyCount += matchedAnys.length;

                                const matchedTryCatch = content.match(/\btry\s*\{/g);
                                if (matchedTryCatch) tryCatchCount += matchedTryCatch.length;
                            }
                        }
                    }
                } catch {}
            }
        };

        await scan(workspaceRoot);

        // Parse package config for dependency discovery
        try {
            const pkgPath = path.join(workspaceRoot, 'package.json');
            const pkgData = JSON.parse(await fs.readFile(pkgPath, 'utf8'));
            const deps = { ...(pkgData.dependencies || {}), ...(pkgData.devDependencies || {}) };
            for (const dep of Object.keys(deps)) {
                if (dep.includes('typescript')) techStackSet.add('TypeScript Typings');
                if (dep.includes('eslint')) techStackSet.add('ESLint Linter');
                if (dep.includes('mocha') || dep.includes('jest') || dep.includes('vitest')) techStackSet.add('Testing Suite');
                if (dep.includes('vite')) techStackSet.add('Vite Build Engine');
            }
        } catch {}

        if (techStackSet.size === 0) {
            techStackSet.add('Standard Node.js Runtime');
        }

        // Assess risks
        if (anyCount > 5) {
            riskProfiles.push(`⚠️ Suboptimal Type Safety: Found ${anyCount} instances of unsafe 'any' references.`);
        }
        if (totalLines > 1000 && tryCatchCount < (totalLines / 400)) {
            riskProfiles.push(`⚠️ Volatile Exception Safety: Low Try/Catch frequency (${tryCatchCount} blocks) under high code lines density.`);
        }
        if (fileList.some(f => path.basename(f) === 'server.ts' || path.basename(f) === 'server.js')) {
            riskProfiles.push('ℹ️ Full-Stack Entrypoint: Root web socket or HTTP server routing detected.');
        }

        const techStackArr = Array.from(techStackSet);
        const report = `## 📊 Repository Analysis Report

### 🏗️ Architecture & Statistics
- **Total Workspace Source Files:** ${fileList.length} files scanned.
- **Physical Volume Metrics:** ~${totalLines} total physical code lines.
- **Code Health Score:** ${Math.max(40, 100 - (anyCount * 5) - (riskProfiles.length * 15))}/100.

### 🛠️ Core Technology Stack
${techStackArr.map(tech => `  - **${tech}**`).join('\n')}

### 🚨 Structural Risk Profile
${riskProfiles.length > 0 ? riskProfiles.map(r => `  - ${r}`).join('\n') : '  - ✅ No elevated architectural or pattern risks detected.'}

### 📂 Repository File Index
${fileList.slice(0, 12).map(f => `  - \`${path.relative(workspaceRoot, f)}\``).join('\n')}${fileList.length > 12 ? '\n  - ...and more source files.' : ''}`;

        return report;
    }

    /**
     * Recursively walks a directory, filtering out heavy assets and node dependencies to compile a safe index.
     */
    public async crawlDirectory(dirPath: string): Promise<string[]> {
        const results: string[] = [];
        try {
            const list = await fs.readdir(dirPath);
            for (const file of list) {
                if (file === 'node_modules' || file === '.git' || file === 'dist' || file === 'out' || file === '.telemetry') {
                    continue;
                }
                const fullPath = path.join(dirPath, file);
                const stat = await fs.stat(fullPath);
                if (stat.isDirectory()) {
                    const subFiles = await this.crawlDirectory(fullPath);
                    results.push(...subFiles);
                } else {
                    const ext = path.extname(fullPath).toLowerCase();
                    const textExtensions = ['.ts', '.js', '.json', '.md', '.tsx', '.jsx', '.css', '.html', '.txt', '.yaml', '.yml', '.xml', '.example'];
                    if (textExtensions.includes(ext)) {
                        results.push(fullPath);
                    }
                }
            }
        } catch {}
        return results;
    }
}
