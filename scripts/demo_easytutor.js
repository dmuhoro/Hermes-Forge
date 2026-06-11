/**
 * HermesForge Bridge Integration Demo: EasyTutor Offline Assistant
 * 
 * This script demonstrates a freelance workflow utilizing HermesForge's local server node
 * to act as a 100% offline educational agent. It reads a student's active workspace file
 * via the local JSON bridge, processes it using the local Ollama context model, and
 * generates a structured educational lessons document.
 * 
 * Prerequisites:
 *  1. Open HermesForge in VS Code.
 *  2. Ensure "hermes-forge.nodeEnabled" is set to true (runs on port 11435).
 *  3. Ensure Ollama is active locally.
 * 
 * Execution:
 *  node scripts/demo_easytutor.js
 */

const http = require('http');

const BRIDGE_URL = 'http://127.0.0.1:11435';
const OLLAMA_URL = 'http://127.0.0.1:11434';

// Helper: Make HTTP requests safely
function request(url, options = {}, postData = null) {
    return new Promise((resolve, reject) => {
        const u = new URL(url);
        const reqOpts = {
            hostname: u.hostname,
            port: u.port,
            path: u.pathname + u.search,
            method: options.method || 'GET',
            headers: {
                'Content-Type': 'application/json',
                ...options.headers
            }
        };

        const req = http.request(reqOpts, (res) => {
            let data = '';
            res.on('data', chunk => data += chunk);
            res.on('end', () => {
                if (res.statusCode >= 200 && res.statusCode < 300) {
                    try {
                        resolve(JSON.parse(data));
                    } catch {
                        resolve(data);
                    }
                } else {
                    reject(new Error(`Request failed with status ${res.statusCode}: ${data}`));
                }
            });
        });

        req.on('error', (err) => reject(err));
        
        if (postData) {
            req.write(JSON.stringify(postData));
        }
        req.end();
    });
}

async function runEasyTutor() {
    console.log('========================================================');
    console.log('🧑‍🏫 EASYTUTOR OFFLINE CLIENT — HERMESFORGE INTEGRATION');
    console.log('========================================================');

    try {
        // Step 1: Query HermesForge local bridge status
        console.log('\n[1/4] Pinging active HermesForge Local Server Node on :11435...');
        const status = await request(`${BRIDGE_URL}/status`).catch(() => null);

        if (!status) {
            console.error('🚨 Could not connect to HermesForge Bridge at 11435.');
            console.error('Please open VS Code and check that your extension settings have "nodeEnabled" loaded.');
            process.exit(1);
        }

        console.log(`🟢 HermesForge Node status: ONLINE`);
        console.log(`  - Local Workspace Bound: ${status.workspaceRoot}`);
        console.log(`  - Active Document Target: ${status.activeFile || 'None active'}`);
        console.log(`  - Active Chat Model Model: ${status.ollama.modelChat}`);

        // Step 2: Extract active file content or read the main entry point as a lesson sample
        console.log('\n[2/4] Reading sample source context via Bridge protocol...');
        let targetPath = status.activeFile ? status.activeFile : null;
        let fileContent = '';

        if (!targetPath) {
            console.log('  - No active editor focused. Defaulting to read "package.json"...');
            const readResponse = await request(`${BRIDGE_URL}/file/read`, { method: 'POST' }, { path: 'package.json' });
            fileContent = readResponse.content;
            targetPath = 'package.json';
        } else {
            // Obtain relative path for safe bridge access
            const relativePath = targetPath.replace(status.workspaceRoot, '').replace(/^[\\\/]/, '');
            const readResponse = await request(`${BRIDGE_URL}/file/read`, { method: 'POST' }, { path: relativePath });
            fileContent = readResponse.content;
            targetPath = relativePath;
        }

        console.log(`🟢 Retreived code file content successfully from: ${targetPath}`);
        console.log(`  - Code Length: ${fileContent.length} characters.`);

        // Step 3: Trigger local assistant to synthesize lessons
        console.log(`\n[3/4] Requesting explanation lesson plan from local Ollama model (${status.ollama.modelChat})...`);
        const tutorPrompt = `You are EasyTutor, a world-class coding companion.
Explain the following code snippet from the student's file "${targetPath}" clearly.
Break down the architecture, point out potential learning points, and provide suggestions for junior developers.

SOURCE SNIPPET:
\`\`\`
${fileContent.substring(0, 3000)}
\`\`\`

Render your output in clean Markdown.`;

        const ollamaPayload = {
            model: status.ollama.modelChat,
            prompt: tutorPrompt,
            stream: false
        };

        const ollamaRes = await request(`${OLLAMA_URL}/api/generate`, { method: 'POST' }, ollamaPayload);
        const explanation = ollamaRes.response;
        console.log('🟢 Explanation synthesized successfully.');

        // Step 4: Write tutoring workbook back to the local database via Bridge (gated by user approval!)
        console.log('\n[4/4] Writing synthesized lesson plan to workspace `.telemetry/easytutor_lesson.md`...');
        const writePayload = {
            path: '.telemetry/easytutor_lesson.md',
            content: `# 🧑‍🏫 EasyTutor Offline Assistant Lesson Goal\n\nGenerated on: ${new Date().toLocaleString()}\nTarget Code Document: \`${targetPath}\`\n\n## 📝 Tutor Critique & Architectural Explanation\n\n${explanation}`
        };

        await request(`${BRIDGE_URL}/file/write`, { method: 'POST' }, writePayload);
        console.log('\n🌟 SUCCESS! EasyTutor offline workflow consolidated correctly.');
        console.log('Check your VS Code window to click "Approve" for the file write request.');
        console.log('Tutor lessons sheet saved at: .telemetry/easytutor_lesson.md');

    } catch (err) {
        console.error('\n🚨 Execution failed:', err.message);
        console.log('Ensure both Ollama (port 11434) and the HermesForge Bridge (port 11435) are online and configured.');
    }
}

runEasyTutor();
