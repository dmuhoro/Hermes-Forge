import { describe, test, expect, beforeEach, vi } from 'vitest';
import * as vscode from 'vscode';
import * as fs from 'fs/promises';
import { LegacyMigrator } from '../../services/LegacyMigrator';
import { OllamaClient } from '../../services/OllamaClient';

vi.mock('fs/promises', () => ({
    writeFile: vi.fn().mockResolvedValue(undefined),
    readFile: vi.fn().mockResolvedValue('// mock typescript read source')
}));

describe('LegacyMigrator Unit Tests', () => {
    let ollama: OllamaClient;
    let migrator: LegacyMigrator;

    beforeEach(() => {
        vi.clearAllMocks();

        ollama = new OllamaClient({
            baseUrl: 'http://localhost:11434',
            modelCompletion: 'qwen2.5-coder:1.5b',
            modelChat: 'hermes3:8b'
        });

        migrator = new LegacyMigrator(ollama);
    });

    test('should reject migration when no active text editor is open', async () => {
        const activeEditorSpy = vi.spyOn(vscode.window, 'activeTextEditor', 'get').mockReturnValue(undefined);
        const errMsgSpy = vi.spyOn(vscode.window, 'showErrorMessage');

        await migrator.migrateActiveFile();

        expect(errMsgSpy).toHaveBeenCalledWith(expect.stringContaining('No active text editor found'));
        activeEditorSpy.mockRestore();
    });

    test('should modernise Javascript to TypeScript code blocks parsed from model completions', async () => {
        const mockJsCode = `
        const adder = (a, b) => a + b;
        module.exports = { adder };
        `;

        const mockResponse = `
Here is your modern type-safe TypeScript conversion:
\`\`\`typescript
export const adder = (a: number, b: number): number => a + b;
\`\`\`

And here is your unit tests:
\`\`\`test
import { expect, test } from 'vitest';
import { adder } from './foo';
test('adds', () => { expect(adder(1, 2)).toBe(3); });
\`\`\`
        `;

        // Mock active editor with JS file representation
        const mockEditor = {
            document: {
                fileName: '/workspace/foo.js',
                getText: vi.fn(() => mockJsCode)
            }
        };

        const activeEditorSpy = vi.spyOn(vscode.window, 'activeTextEditor', 'get').mockReturnValue(mockEditor as any);
        const generateSpy = vi.spyOn(ollama, 'generateCompletion').mockResolvedValue(mockResponse);
        const progressSpy = vi.spyOn(vscode.window, 'withProgress').mockImplementation(async (_, task) => {
            return task({ report: vi.fn() } as any, { isCancellationRequested: false, onCancellationRequested: vi.fn() as any });
        });

        const showInfoSpy = vi.spyOn(vscode.window, 'showInformationMessage').mockResolvedValue('Write TS File' as any);

        await migrator.migrateActiveFile();

        expect(generateSpy).toHaveBeenCalled();
        expect(showInfoSpy).toHaveBeenCalled();
        expect(fs.writeFile).toHaveBeenCalledWith(expect.stringContaining('foo.ts'), expect.stringContaining('export const adder'), 'utf8');

        activeEditorSpy.mockRestore();
        generateSpy.mockRestore();
        progressSpy.mockRestore();
        showInfoSpy.mockRestore();
    });
});
