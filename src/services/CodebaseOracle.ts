import * as vscode from 'vscode';
import * as fs from 'fs/promises';
import * as path from 'path';
import { OllamaClient } from './OllamaClient';
import { ContextCrawler } from './ContextCrawler';
import { logger } from '../utils/Logger';

export class CodebaseOracle {
    private ollama: OllamaClient;
    private crawler = new ContextCrawler();

    constructor(ollama: OllamaClient) {
        this.ollama = ollama;
    }

    private getWorkspaceRoot(): string {
        const folders = vscode.workspace.workspaceFolders;
        return folders && folders.length > 0 ? folders[0].uri.fsPath : process.cwd();
    }

    /**
     * Executes the architectural review and outputs a detailed migration or audit specification.
     */
    public async consultOracle(): Promise<void> {
        const workspaceRoot = this.getWorkspaceRoot();
        
        // Let the user select or enter their specific architectural aspiration
        const options = [
            'Assess Codebase Health & Structural Risk Profile',
            'Plan Migration from Legacy JS/CommonJS to strict TypeScript ESM',
            'Evaluate Layer Optimization & Micro-Performance Design',
            'Draft Modular Split Plan for Large Sub-modules',
            'Custom Architectural Enquiry...'
        ];

        const selection = await vscode.window.showQuickPick(options, {
            placeHolder: 'What architectural insights or migration blueprints does the Codebase Oracle need to construct?'
        });

        if (!selection) return;

        let userAspiration = selection;
        if (selection === 'Custom Architectural Enquiry...') {
            const entered = await vscode.window.showInputBox({
                prompt: 'Enter your custom architectural question or migration target:',
                placeHolder: 'e.g., Migrate routing layout from REST to GraphQL design...'
            });
            if (!entered) return;
            userAspiration = entered;
        }

        await vscode.window.withProgress({
            location: vscode.ProgressLocation.Notification,
            title: 'HermesForge: Consult Codebase Oracle...',
            cancellable: false
        }, async (progress) => {
            try {
                progress.report({ message: 'Mapping workspace directory structures...' });
                const reportStr = await this.crawler.analyzeRepository(workspaceRoot);
                const memory = await this.crawler.buildOrLoadProjectMemory(workspaceRoot);

                progress.report({ message: 'Invoking offline Chief System Architect...' });
                
                const systemPrompt = `You are the HermesForge Codebase Oracle — an elite Systems Architect and systems migration planner.
You specialize in evaluating software structures, assessing decoupling margins, detecting performance bottlenecks, and laying out flawless step-by-step migration plans.

### REPOSITORY PROFILE:
${reportStr}

### IN-MEMORY PROJECT LAYOUT SUMMARY:
- Total scanned files: ${memory.totalFiles}
- Volume lines scanned: ${memory.totalLines}
- Discovered sub-modules:
${Object.keys(memory.subModules).map(m => `  - Module Folder [${m}]: ${memory.subModules[m].purposeSummary} (~${memory.subModules[m].totalLines} lines)`).join('\n')}

### USER ARCHITECTURAL ASPIRATION / INQUIRY:
"${userAspiration}"

Review this codebase metadata and raw aspiration completely offline. Evaluate architectural coupling constraints, layout transitions, and construct an authoritative, professional system blueprint document. 
Your blueprint document must adhere to high engineering standards (no any statements, dry-run safety checkpoints, and custom typings) and be styled cleanly in beautiful markdown.

Output the complete, unified blueprint with exact headers:
# 🧠 Systems Oracle: Architectural & Migration Blueprint
## 📂 Section 1: Executive Architectural Summary
[Construct a comprehensive architectural review detailing module layout, strong and weak couplings, and tech stack compliance.]
## 🌪️ Section 2: Coupling & Risk Assessment
[Assess the structural patterns, namespace density, and risk metrics discovered in the files.]
## 🗺️ Section 3: Step-by-Step Migration Map
[Provide an explicit, sequential chronological plan of exactly which files to create, edit, or split — organized in dry-run milestones.]
## 🛡️ Section 4: Type-Safe Interfaces & Specifications
[Detail precise TypeScript interface schemas, named export contracts, or standard signatures representing the migrated modules.]

Output ONLY the markdown content list. No conversational introductions or notes outside the markdown blocks.`;

                const oracleResponseHtml = await this.ollama.generateCompletion(systemPrompt, {
                    model: 'hermes3:8b',
                    temperature: 0.1
                });

                const targetBlueprintPath = path.join(workspaceRoot, '.telemetry', 'oracle_migration_blueprint.md');
                await fs.mkdir(path.dirname(targetBlueprintPath), { recursive: true });
                await fs.writeFile(targetBlueprintPath, oracleResponseHtml, 'utf8');

                logger.info(`[CodebaseOracle] Successfully synthesized full systems migration blueprint at: ${targetBlueprintPath}`);

                // Show output blueprint inside editor
                const doc = await vscode.workspace.openTextDocument(vscode.Uri.file(targetBlueprintPath));
                await vscode.window.showTextDocument(doc, vscode.ViewColumn.Beside);

                vscode.window.showInformationMessage('🟢 Codebase Oracle compiled system review! Blueprint saved to .telemetry/oracle_migration_blueprint.md');

            } catch (err: any) {
                vscode.window.showErrorMessage(`Systems Oracle enquiry failed: ${err.message}`);
            }
        });
    }
}
