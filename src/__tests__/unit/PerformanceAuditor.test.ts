import { describe, test, expect, beforeEach, vi } from 'vitest';
import * as vscode from 'vscode';
import * as fs from 'fs/promises';
import { PerformanceAuditor } from '../../services/PerformanceAuditor';
import { OllamaClient } from '../../services/OllamaClient';

vi.mock('fs/promises', () => ({
    writeFile: vi.fn().mockResolvedValue(undefined),
    readFile: vi.fn().mockResolvedValue('')
}));

describe('PerformanceAuditor Unit Tests', () => {
    let ollama: OllamaClient;
    let auditor: PerformanceAuditor;

    beforeEach(() => {
        vi.clearAllMocks();

        ollama = new OllamaClient({
            baseUrl: 'http://localhost:11434',
            modelCompletion: 'qwen2.5-coder:1.5b',
            modelChat: 'hermes3:8b'
        });

        auditor = new PerformanceAuditor(ollama);
    });

    test('should reject performance audit when no active file is loaded in the workspace editor', async () => {
        const activeEditorSpy = vi.spyOn(vscode.window, 'activeTextEditor', 'get').mockReturnValue(undefined);
        const errMsgSpy = vi.spyOn(vscode.window, 'showErrorMessage');

        await auditor.auditActiveFile();

        expect(errMsgSpy).toHaveBeenCalledWith(expect.stringContaining('No active text editor found'));
        activeEditorSpy.mockRestore();
    });

    test('should successfully perform Micro-optimization analysis and save diagnostics on request', async () => {
        const mockCode = `
        function slowSearch(arr, val) {
            for(let i=0; i<arr.length; i++) {
                for(let j=0; j<arr.length; j++) {
                    if (arr[i] === val) return i;
                }
            }
        }
        `;

        const mockReport = `## 🚀 Comprehensive Performance Audit Report
### 📊 Computational complexity score
- Current Time Complexity: O(N^2)
- Target Time Complexity: O(N)
`;

        const mockEditor = {
            document: {
                fileName: '/workspace/bubble.ts',
                getText: vi.fn(() => mockCode)
            }
        };

        const activeEditorSpy = vi.spyOn(vscode.window, 'activeTextEditor', 'get').mockReturnValue(mockEditor as any);
        const generateSpy = vi.spyOn(ollama, 'generateCompletion').mockResolvedValue(mockReport);
        const progressSpy = vi.spyOn(vscode.window, 'withProgress').mockImplementation(async (_, task) => {
            return task({ report: vi.fn() } as any, { isCancellationRequested: false, onCancellationRequested: vi.fn() as any });
        });

        const showInfoSpy = vi.spyOn(vscode.window, 'showInformationMessage').mockResolvedValue('Save markdown report' as any);

        await auditor.auditActiveFile();

        expect(generateSpy).toHaveBeenCalled();
        expect(showInfoSpy).toHaveBeenCalled();
        expect(fs.writeFile).toHaveBeenCalledWith(expect.stringContaining('PERF_AUDIT.md'), expect.stringContaining('## 🚀 Comprehensive Performance Audit Report'), 'utf8');

        activeEditorSpy.mockRestore();
        generateSpy.mockRestore();
        progressSpy.mockRestore();
        showInfoSpy.mockRestore();
    });
});
