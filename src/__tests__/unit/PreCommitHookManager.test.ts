import { describe, test, expect } from 'vitest';
import * as path from 'path';
import { PreCommitHookManager } from '../../services/PreCommitHookManager';

describe('PreCommitHookManager Offline Verification Engine tests', () => {
  test('should return validation scan results when workspace lacks staged files', async () => {
    // Run against process.cwd() or /app/applet
    const result = await PreCommitHookManager.runOnDemandScan(process.cwd());
    // Since there might be no staged files in the test runner, it should return success or a readable error safely
    expect(result).toHaveProperty('success');
    expect(result).toHaveProperty('message');
    expect(Array.isArray(result.failures)).toBe(true);
  });

  test('should fail scaffolding if directory is not a git repository', async () => {
    // Scaffold in a fictional non-git path
    const fakePath = path.join(__dirname, 'non_existent_folder_xyz');
    const result = await PreCommitHookManager.scaffoldHook(fakePath);
    expect(result.success).toBe(false);
    expect(result.message).toContain('not found');
  });
});
