import * as fs from 'fs/promises';
import * as path from 'path';
import { logger } from '../utils/Logger';

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
        for (const file of allFiles) {
            // Prevent duplicating the primary file that the user is actively staring at
            if (file === filePath) continue; 
            
            try {
                const text = await fs.readFile(file, 'utf8');
                const relName = path.basename(file);
                expandedContext += `\n// START DEPENDENCY: [${relName}]\n${text}\n// END DEPENDENCY\n`;
            } catch (ignored) {}
        }
        
        timerStop();
        return expandedContext;
    }
}
