import * as vscode from 'vscode';
import * as fs from 'fs/promises';
import * as path from 'path';
import { logger } from '../utils/Logger';

export class CIGenerator {
    private getWorkspaceRoot(): string {
        const folders = vscode.workspace.workspaceFolders;
        return folders && folders.length > 0 ? folders[0].uri.fsPath : process.cwd();
    }

    public async generatePipeline(): Promise<void> {
        const root = this.getWorkspaceRoot();
        const workflowsDir = path.join(root, '.github', 'workflows');
        const ciPath = path.join(workflowsDir, 'ci.yml');

        const ymlContent = `# 🚀 HermesForge: High-Leverage Offline-first CI/CD Pipeline
# Automatically generated to execute rapid validation and clean compilation checking.
name: HermesForge SDLC Integrity Gate

on:
  push:
    branches: [ main, master ]
  pull_request:
    branches: [ main, master ]

jobs:
  validate-and-package:
    name: Lint, Test, and Package VSIX
    runs-on: ubuntu-latest

    steps:
      - name: Checkout Code Repository
        uses: actions/checkout@v4

      - name: Initialize Node.js Local Workspace Runtime
        uses: actions/setup-node@v4
        with:
          node-version: 20
          cache: 'npm'

      - name: Install Project Dependencies
        run: npm ci

      - name: Verify Strict Typography & Code Linter Rules
        run: npm run lint

      - name: Execute Deterministic Vitest Suite Verification
        run: npm test

      - name: Package Release VSIX Artifact
        run: npx vsce package --no-dependencies

      - name: Archive Production VSIX Extension Build
        uses: actions/upload-artifact@v4
        with:
          name: packaged-extension
          path: "*.vsix"
          if-no-files-found: error
`;

        try {
            await fs.mkdir(workflowsDir, { recursive: true });
            await fs.writeFile(ciPath, ymlContent, 'utf8');

            const relativePath = path.relative(root, ciPath);
            vscode.window.showInformationMessage(`🟢 GitHub Actions CI Generator: Success! Saved profile to \`${relativePath}\`.`);
            
            // Add to DevVelocity metrics
            const { DevVelocityManager } = await import('./DevVelocityManager');
            await DevVelocityManager.getInstance().updateMetrics({
                timeSavingActions: 1,
                hoursSaved: 0.5
            });

        } catch (err: any) {
            logger.error(`CI Pipeline generation failed: ${err.message}`);
            vscode.window.showErrorMessage(`CI Generator Error: ${err.message}`);
        }
    }
}
