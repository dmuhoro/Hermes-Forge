import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs/promises';
import * as path from 'path';
import { CheckpointManager } from '../../services/CheckpointManager';
import * as vscode from 'vscode';

// Inject dynamic quick interactions into global mock window
if (!(vscode.window as any).showInputBox) {
  (vscode.window as any).showInputBox = vi.fn();
}
if (!(vscode.window as any).showQuickPick) {
  (vscode.window as any).showQuickPick = vi.fn();
}

describe('CheckpointManager Sprints state tests', () => {
  const tempWorkspaceRoot = path.join(__dirname, 'temp_cp_test');

  beforeEach(async () => {
    await fs.mkdir(tempWorkspaceRoot, { recursive: true });
  });

  afterEach(async () => {
    await fs.rm(tempWorkspaceRoot, { recursive: true, force: true }).catch(() => {});
    vi.restoreAllMocks();
  });

  test('should fail to load checkpoint when no checkpoints dir or files exist', async () => {
    const result = await CheckpointManager.loadCheckpoint(tempWorkspaceRoot);
    expect(result.success).toBe(false);
    expect(result.message).toContain('No saved checkpoints found');
  });

  test('should successfully save checkpoint files when workspace active state exists', async () => {
    // 1. Mock user entering a checkpoint name
    vi.mocked(vscode.window.showInputBox).mockResolvedValue('My-Sprint-Test');

    // 2. Setup mock active state
    const telemetryDir = path.join(tempWorkspaceRoot, '.telemetry');
    await fs.mkdir(telemetryDir, { recursive: true });
    
    const activeState = {
      phase: 'spec',
      userGoal: 'Mock Goal test verification',
      targetSpecPath: 'spec.md',
      currentSteps: [],
      currentStepIndex: 0,
      teamSize: 3,
      timestamp: new Date().toISOString()
    };
    await fs.writeFile(path.join(telemetryDir, 'lifecycle_state.json'), JSON.stringify(activeState), 'utf8');

    // 3. Act
    const result = await CheckpointManager.saveCheckpoint(tempWorkspaceRoot);

    // 4. Assert
    expect(result.success).toBe(true);
    expect(result.message).toContain('saved successfully');

    // Verify file exists on disk
    const checkpointsDir = path.join(tempWorkspaceRoot, '.hermes', 'checkpoints');
    const checkpointFiles = await fs.readdir(checkpointsDir);
    expect(checkpointFiles.length).toBe(1);
    
    const content = await fs.readFile(path.join(checkpointsDir, checkpointFiles[0]), 'utf8');
    const cp = JSON.parse(content);
    expect(cp.name).toBe('My-Sprint-Test');
    expect(cp.stateData.phase).toBe('spec');
  });
});
