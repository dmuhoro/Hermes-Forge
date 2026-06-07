import * as fs from 'fs/promises';
import * as path from 'path';
import { OllamaClient } from './OllamaClient';
import { logger } from '../utils/Logger';

export class ProductManager {
    constructor(private readonly ollama: OllamaClient) {}

    /**
     * Translates a high-level non-technical goal and project context into precise,
     * action-oriented developer tasks written to an active sprint markdown checklist.
     *
     * @param rawGoal Raw business/product intent formulated by the user
     * @param projectContext Fallback project context string if the physical file is unreadable
     * @param workspacePath Absolute path to the active workspace folder
     */
    public async decomposeBusinessGoal(
        rawGoal: string,
        projectContext: string,
        workspacePath?: string
    ): Promise<string[]> {
        const rootPath = workspacePath || process.cwd();
        const overviewFilePath = path.join(rootPath, 'context', 'project_overview.md');
        
        let mergedContext = projectContext;

        try {
            const fileContext = await fs.readFile(overviewFilePath, 'utf8');
            if (fileContext.trim()) {
                mergedContext = `${fileContext}\n\n### ADDITIONAL AD-HOC CONTEXT:\n${projectContext}`;
                logger.info(`[ProductManager] Successfully integrated contextual details from file: ${overviewFilePath}`);
            }
        } catch (err: any) {
            logger.warn(`[ProductManager] Could not load project_overview.md directly: ${err.message}. Relying on provided context parameters.`);
        }

        logger.info(`[ProductManager] Formatting business goal decomposition for intent: "${rawGoal}"`);

        const prompt = `You are a world-class Product Director and Strategic Technical Product Manager specializing in developer sprint alignment.
We are translating a raw product goal from a non-technical founder into a precise, step-by-step technical feature checklist.

### RAW PRODUCT GOAL:
"${rawGoal}"

### PROJECT CONTEXT \& ARCHITECTURAL GUIDELINES:
${mergedContext}

Your mission is to break this high-level, business-oriented goal down into a series of small, concrete, progressive, step-by-step development ticket requirements.
Each ticket must be explicit, detailed, and clear enough so that an autonomous coding agent can read, parse, and verify it one task at a time.

Please generate a clean, highly polished markdown specification.
Avoid any conversational filler, intro, or outro text. Respond with ONLY the markdown content.

The output document MUST follow this format exactly:

# Active Sprint Feature Specification

## Product Goals
[Explain high-level goal and user outcome in 1-2 paragraphs]

## Explicit Technical Decisions
[Formulate specific file paths to modify, typing dependencies, database schemas, or function signatures needed to execute this sprint safely]

## Implementation Checklist
Provide a list of step-by-step checklist items using the exact "- [ ] **[TASK-X]:** Description" prefix format. Each checklist task MUST have a verification expectation.

Example:
- [ ] **[TASK-1]: Core Storage Initializer**
  - Spec: Create storage files and implement type mappings.
  - Verification: Ensure clean type compiles and persists to local database.

## Verification Parameters
[Provide guidance on how to run compilers or lint tests to confirm everything builds perfectly]`;

        let specContent = '';
        try {
            specContent = await this.ollama.generateCompletion(prompt, {
                model: this.ollama.modelChat,
                temperature: 0.1
            });
        } catch (error: any) {
            logger.error(`[ProductManager] Local reasoning LLM failed decomposition sequence: ${error.message || error}`);
            // Provide a graceful, highly functional fallback specification to ensure the developer flow is never blocked
            specContent = `# Active Sprint Feature Specification\n\n## Product Goals\nImplement: ${rawGoal}\n\n## Implementation Checklist\n- [ ] **[TASK-1]: Feature Scaffolding**\n  - Spec: Establish the structural elements for: ${rawGoal}\n  - Verification: Execute basic compilation check to pass.`;
        }

        // Write output active sprint file
        const sprintDir = path.join(rootPath, 'context', 'feature_specs');
        const sprintFilePath = path.join(sprintDir, 'active_sprint.md');

        try {
            await fs.mkdir(sprintDir, { recursive: true });
            await fs.writeFile(sprintFilePath, specContent, 'utf8');
            logger.info(`[ProductManager] Beautiful active sprint spec compiled and written to: ${sprintFilePath}`);
        } catch (err: any) {
            logger.error(`[ProductManager] Failed to write active_sprint.md to disk: ${err.message}`);
        }

        // Parse individual task descriptions out of the checklist to return as individual strings
        const taskList: string[] = [];
        const lines = specContent.split('\n');
        
        for (const line of lines) {
            const trimmed = line.trim();
            // Match standard bullet checkbox pattern like: - [ ] **[TASK-1]:** ... or - [ ] [TASK-1]
            if (trimmed.startsWith('- [ ]') || trimmed.startsWith('* [ ]')) {
                const taskContent = trimmed.substring(5).replace(/\*\*|\[|\]/g, '').trim();
                if (taskContent) {
                    taskList.push(taskContent);
                }
            }
        }

        // Fallback if no checkboxes were found/parsed correctly
        if (taskList.length === 0) {
            taskList.push(`TASK-1: Establish core scaffold for ${rawGoal}`);
        }

        return taskList;
    }
}
