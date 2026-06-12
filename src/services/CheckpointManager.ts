import * as vscode from 'vscode';
import * as fs from 'fs/promises';
import * as path from 'path';
import { logger } from '../utils/Logger';

export interface CheckpointMetadata {
    id: string;
    name: string;
    timestamp: string;
    phase: string;
    userGoal: string;
    stateData: any;
}

export class CheckpointManager {
    private static getCheckpointsDir(workspaceRoot: string): string {
        return path.join(workspaceRoot, '.hermes', 'checkpoints');
    }

    private static getActiveStatePath(workspaceRoot: string): string {
        return path.join(workspaceRoot, '.telemetry', 'lifecycle_state.json');
    }

    /**
     * Saves the current active SDLC lifecycle state as a named checkpoint
     */
    public static async saveCheckpoint(workspaceRoot: string): Promise<{ success: boolean; message: string }> {
        try {
            const activePath = this.getActiveStatePath(workspaceRoot);
            let activeState: any = null;

            try {
                const raw = await fs.readFile(activePath, 'utf8');
                activeState = JSON.parse(raw);
            } catch {
                // If no active session, ask if they want to bootstrap a clean checkpoint
                activeState = {
                    phase: 'idea',
                    userGoal: 'Custom Developer Workspace Checkpoint',
                    targetSpecPath: '',
                    currentSteps: [],
                    currentStepIndex: 0,
                    teamSize: 3,
                    timestamp: new Date().toISOString()
                };
            }

            const checkpointName = await vscode.window.showInputBox({
                prompt: 'Enter a descriptive name for this Sprint Checkpoint:',
                placeHolder: 'e.g., Feature-A-Spec-Completed, Auth-Hook-Seeded',
                value: activeState.userGoal.replace(/[^a-zA-Z0-9-]/g, '_').substring(0, 30)
            });

            if (!checkpointName) {
                return { success: false, message: 'Checkpoint save aborted.' };
            }

            const dir = this.getCheckpointsDir(workspaceRoot);
            await fs.mkdir(dir, { recursive: true });

            const id = `checkpoint_${Date.now()}`;
            const checkpointFile = path.join(dir, `${id}.json`);

            const checkpoint: CheckpointMetadata = {
                id,
                name: checkpointName,
                timestamp: new Date().toISOString(),
                phase: activeState.phase,
                userGoal: activeState.userGoal,
                stateData: activeState
            };

            await fs.writeFile(checkpointFile, JSON.stringify(checkpoint, null, 2), 'utf8');
            logger.info(`[CheckpointManager] Saved named checkpoint: ${checkpointName} at ${checkpointFile}`);

            return {
                success: true,
                message: `🟢 Checkpoint "${checkpointName}" saved successfully in your local .hermes/checkpoints database.`
            };
        } catch (err: any) {
            logger.error('[CheckpointManager] Failed to save checkpoint', err);
            return { success: false, message: `Failed to save checkpoint: ${err.message}` };
        }
    }

    /**
     * Lists local checkpoints and restores the selected checkpoints to the active state
     */
    public static async loadCheckpoint(workspaceRoot: string): Promise<{ success: boolean; message: string }> {
        try {
            const dir = this.getCheckpointsDir(workspaceRoot);
            try {
                await fs.mkdir(dir, { recursive: true });
            } catch {}

            const files = await fs.readdir(dir);
            const checkpointFiles = files.filter(f => f.startsWith('checkpoint_') && f.endsWith('.json'));

            if (checkpointFiles.length === 0) {
                return { success: false, message: 'No saved checkpoints found in .hermes/checkpoints directory.' };
            }

            const checkpointsList: CheckpointMetadata[] = [];
            for (const file of checkpointFiles) {
                try {
                    const raw = await fs.readFile(path.join(dir, file), 'utf8');
                    checkpointsList.push(JSON.parse(raw));
                } catch {
                    // skip corrupted checkpoint files
                }
            }

            // Sort checkpoints descending by timestamp
            checkpointsList.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());

            const items = checkpointsList.map(cp => ({
                label: `🕒 ${cp.name}`,
                description: `Phase: ${cp.phase.toUpperCase()}`,
                detail: `Goal: ${cp.userGoal.substring(0, 100)}... (Saved: ${new Date(cp.timestamp).toLocaleString()})`,
                checkpoint: cp
            }));

            const selection = await vscode.window.showQuickPick(items, {
                placeHolder: 'Select a local HermesForge checkpoint to restore:'
            });

            if (!selection) {
                return { success: false, message: 'Checkpoint restoration aborted.' };
            }

            const chosen = selection.checkpoint;
            const activePath = this.getActiveStatePath(workspaceRoot);
            await fs.mkdir(path.dirname(activePath), { recursive: true });
            await fs.writeFile(activePath, JSON.stringify(chosen.stateData, null, 2), 'utf8');

            logger.info(`[CheckpointManager] Restored checkpoint: ${chosen.name}`);
            return {
                success: true,
                message: `🟢 Active SDLC Workspace state restored to check-in point: "${chosen.name}"!`
            };
        } catch (err: any) {
            logger.error('[CheckpointManager] Failed to restore checkpoint', err);
            return { success: false, message: `Failed to restore checkpoint: ${err.message}` };
        }
    }
}
