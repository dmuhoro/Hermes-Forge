import { describe, test, expect, beforeEach, vi } from 'vitest';
import * as vscode from 'vscode';
import * as fs from 'fs/promises';
import { DevVelocityManager } from '../../services/DevVelocityManager';

vi.mock('fs/promises', () => ({
    stat: vi.fn(),
    readFile: vi.fn(),
    writeFile: vi.fn(),
    mkdir: vi.fn()
}));

describe('DevVelocityManager Unit Tests', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        // Reset singleton if possible, or just mock fs
    });

    test('should return default metrics if file is not found', async () => {
        vi.mocked(fs.stat).mockRejectedValue(new Error('ENOENT'));
        const manager = DevVelocityManager.getInstance();
        const metrics = await manager.getMetrics();

        expect(metrics).toEqual({
            sprintsCompleted: 0,
            hoursSaved: 0,
            linesOfCodeGenerated: 0,
            rollbacksPreempted: 0,
            agentStepsExecuted: 0,
            timeSavingActions: 0
        });
    });

    test('should read persisted metrics from dev_velocity.json if file exists', async () => {
        const persisted = {
            sprintsCompleted: 4,
            hoursSaved: 12.5,
            linesOfCodeGenerated: 1540,
            rollbacksPreempted: 2,
            agentStepsExecuted: 42,
            timeSavingActions: 5
        };

        vi.mocked(fs.stat).mockResolvedValue({} as any);
        vi.mocked(fs.readFile).mockResolvedValue(JSON.stringify(persisted));

        const manager = DevVelocityManager.getInstance();
        const metrics = await manager.getMetrics();

        expect(metrics).toEqual(persisted);
    });

    test('should append partial updates and write them atomically', async () => {
        const persisted = {
            sprintsCompleted: 4,
            hoursSaved: 12.5,
            linesOfCodeGenerated: 1500,
            rollbacksPreempted: 2,
            agentStepsExecuted: 40,
            timeSavingActions: 5
        };

        vi.mocked(fs.stat).mockResolvedValue({} as any);
        vi.mocked(fs.readFile).mockResolvedValue(JSON.stringify(persisted));
        const writeMock = vi.mocked(fs.writeFile).mockResolvedValue(undefined);
        const mkdirMock = vi.mocked(fs.mkdir).mockResolvedValue(undefined);

        const executeCommandSpy = vi.spyOn(vscode.commands, 'executeCommand').mockResolvedValue(undefined as any);

        const manager = DevVelocityManager.getInstance();
        const updated = await manager.updateMetrics({
            sprintsCompleted: 1,
            hoursSaved: 1.5,
            linesOfCodeGenerated: 40,
            rollbacksPreempted: 0, // no change
            agentStepsExecuted: 2,
            timeSavingActions: 1
        });

        expect(updated).toEqual({
            sprintsCompleted: 5,
            hoursSaved: 14.0,
            linesOfCodeGenerated: 1540,
            rollbacksPreempted: 2,
            agentStepsExecuted: 42,
            timeSavingActions: 6
        });

        expect(mkdirMock).toHaveBeenCalled();
        expect(writeMock).toHaveBeenCalledWith(
            expect.stringContaining('dev_velocity.json'),
            expect.stringContaining('"linesOfCodeGenerated": 1540'),
            'utf8'
        );
        expect(executeCommandSpy).toHaveBeenCalledWith('hermes-forge.refreshDashboardVelocity');
    });
});
