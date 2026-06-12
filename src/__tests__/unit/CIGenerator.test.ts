import { describe, test, expect, beforeEach, vi } from 'vitest';
import * as vscode from 'vscode';
import * as fs from 'fs/promises';
import { CIGenerator } from '../../services/CIGenerator';

vi.mock('fs/promises', () => ({
    mkdir: vi.fn(),
    writeFile: vi.fn(),
    stat: vi.fn(),
    readFile: vi.fn()
}));

describe('CIGenerator Unit Tests', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    test('should construct GitHub Actions pipeline and save it to the workspace .github folder', async () => {
        const mkdirMock = vi.mocked(fs.mkdir).mockResolvedValue(undefined);
        const writeMock = vi.mocked(fs.writeFile).mockResolvedValue(undefined);

        const showInfoSpy = vi.spyOn(vscode.window, 'showInformationMessage').mockResolvedValue(undefined as any);

        const generator = new CIGenerator();
        await generator.generatePipeline();

        expect(mkdirMock).toHaveBeenCalledWith(expect.stringContaining('.github/workflows'), { recursive: true });
        expect(writeMock).toHaveBeenCalledWith(
            expect.stringContaining('.github/workflows/ci.yml'),
            expect.stringContaining('HermesForge SDLC Integrity Gate'),
            'utf8'
        );
        expect(showInfoSpy).toHaveBeenCalledWith(expect.stringContaining('Success!'));
    });
});
