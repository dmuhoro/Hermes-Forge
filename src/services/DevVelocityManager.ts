import * as vscode from 'vscode';
import * as fs from 'fs/promises';
import * as path from 'path';
import { logger } from '../utils/Logger';

export interface DevVelocityMetrics {
    sprintsCompleted: number;
    hoursSaved: number;
    linesOfCodeGenerated: number;
    rollbacksPreempted: number;
    agentStepsExecuted: number;
    timeSavingActions: number; // For single-button features like JS->TS, perf audit, etc.
}

export class DevVelocityManager {
    private static instance: DevVelocityManager;
    private fileMutex: Promise<void> = Promise.resolve();

    private constructor() {}

    public static getInstance(): DevVelocityManager {
        if (!DevVelocityManager.instance) {
            DevVelocityManager.instance = new DevVelocityManager();
        }
        return DevVelocityManager.instance;
    }

    private getWorkspaceRoot(): string {
        const folders = vscode.workspace.workspaceFolders;
        return folders && folders.length > 0 ? folders[0].uri.fsPath : process.cwd();
    }

    private getTelemetryFilePath(): string {
        return path.join(this.getWorkspaceRoot(), '.telemetry', 'dev_velocity.json');
    }

    /**
     * Reads dev velocity metrics safely from local telemetry file.
     */
    public async getMetrics(): Promise<DevVelocityMetrics> {
        const filePath = this.getTelemetryFilePath();
        try {
            const contentExists = await fs.stat(filePath).then(() => true).catch(() => false);
            if (!contentExists) {
                return this.getDefaultMetrics();
            }
            const raw = await fs.readFile(filePath, 'utf8');
            return { ...this.getDefaultMetrics(), ...JSON.parse(raw) };
        } catch (err: any) {
            logger.warn(`Failed reading dev velocity metrics: ${err.message}`);
            return this.getDefaultMetrics();
        }
    }

    /**
     * Updates and persists dev velocity metrics, using a promise chain to prevent race conditions.
     */
    public async updateMetrics(updates: Partial<DevVelocityMetrics>): Promise<DevVelocityMetrics> {
        let resolveWriting: () => void = () => {};
        const oldMutex = this.fileMutex;
        this.fileMutex = new Promise<void>((resolve) => {
            resolveWriting = resolve;
        });

        try {
            await oldMutex;
            const current = await this.getMetrics();
            const updated: DevVelocityMetrics = {
                sprintsCompleted: current.sprintsCompleted + (updates.sprintsCompleted || 0),
                hoursSaved: Number((current.hoursSaved + (updates.hoursSaved || 0)).toFixed(2)),
                linesOfCodeGenerated: current.linesOfCodeGenerated + (updates.linesOfCodeGenerated || 0),
                rollbacksPreempted: current.rollbacksPreempted + (updates.rollbacksPreempted || 0),
                agentStepsExecuted: current.agentStepsExecuted + (updates.agentStepsExecuted || 0),
                timeSavingActions: current.timeSavingActions + (updates.timeSavingActions || 0)
            };

            const filePath = this.getTelemetryFilePath();
            await fs.mkdir(path.dirname(filePath), { recursive: true });
            await fs.writeFile(filePath, JSON.stringify(updated, null, 2), 'utf8');

            // Notify open dashboards of updated metrics
            vscode.commands.executeCommand('hermes-forge.refreshDashboardVelocity');

            return updated;
        } catch (err: any) {
            logger.warn(`Failed updating dev velocity metrics: ${err.message}`);
            return this.getDefaultMetrics();
        } finally {
            resolveWriting();
        }
    }

    private getDefaultMetrics(): DevVelocityMetrics {
        return {
            sprintsCompleted: 0,
            hoursSaved: 0,
            linesOfCodeGenerated: 0,
            rollbacksPreempted: 0,
            agentStepsExecuted: 0,
            timeSavingActions: 0
        };
    }
}
