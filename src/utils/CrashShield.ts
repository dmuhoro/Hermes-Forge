import * as os from 'os';
import * as http from 'http';
import * as vscode from 'vscode';
import { logger } from './Logger';

export interface ChatMessage {
    role: 'system' | 'user' | 'assistant';
    content: string;
}

export class CrashShield {
    private static readonly LOW_MEM_THRESHOLD = 1.5 * 1024 * 1024 * 1024; // 1.5 GB in bytes
    private static autocompletePaused = false;
    private static pauseTimer: NodeJS.Timeout | null = null;

    /**
     * Checks if autocomplete should be bypassed
     */
    public static isAutocompletePaused(): boolean {
        return this.autocompletePaused;
    }

    /**
     * Explicitly sets autocomplete pause state, with automatic recovery after 30 seconds
     */
    public static pauseAutocomplete(): void {
        this.autocompletePaused = true;
        logger.warn('[CrashShield] Low memory intervention: Pausing autocomplete keystroke triggers.');

        if (this.pauseTimer) {
            clearTimeout(this.pauseTimer);
        }

        this.pauseTimer = setTimeout(() => {
            this.autocompletePaused = false;
            logger.info('[CrashShield] Safe system state restored: Resuming autocomplete capability.');
        }, 30000); // 30 second auto-re-enable safety gate
    }

    /**
     * Conducts proactive memory footprint evaluation.
     * Unloads model files from VRAM/RAM if thresholds are violated.
     */
    public static async checkMemoryAndIntervene(model: string, baseUrl: string): Promise<boolean> {
        const freeMem = os.freemem();
        const totalMem = os.totalmem();
        const freeMemGB = (freeMem / (1024 * 1024 * 1024)).toFixed(2);

        if (freeMem < this.LOW_MEM_THRESHOLD) {
            logger.warn(`[CrashShield] Resource alert! Only ${freeMemGB}GB RAM remaining of ${(totalMem / (1024 * 1024 * 1024)).toFixed(2)}GB. Initiating pre-crash mitigations.`);
            
            // Step 1: Force pause autocomplete inline triggers
            this.pauseAutocomplete();
            vscode.window.showWarningMessage(`[HermesForge CrashShield] Low RAM Alert (${freeMemGB}GB left). Pausing autocomplete and purifying cache weights to protect host OS.`);

            // Step 2: Trigger explicit model weight ejection to clean up GPU/CPU-RAM memory pages
            await this.evictModel(model, baseUrl);
            
            return true; // Return true to indicate intervention occurred
        }

        return false;
    }

    /**
     * Evicts specific weights from the active Ollama thread
     */
    public static async evictModel(modelName: string, baseUrl: string): Promise<void> {
        logger.info(`[CrashShield] Evicting active model weight context for model: "${modelName}"`);
        
        const payload = JSON.stringify({
            model: modelName,
            keep_alive: 0
        });

        const url = new URL(`${baseUrl}/api/generate`);
        const options = {
            hostname: url.hostname,
            port: url.port || 11434,
            path: '/api/generate',
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Content-Length': Buffer.byteLength(payload)
            }
        };

        return new Promise((resolve) => {
            const req = http.request(options, (res) => {
                res.on('data', () => {}); // Consume stream
                res.on('end', () => {
                    logger.info(`[CrashShield] Eviction request completed for: "${modelName}". VRAM cache successfully purged.`);
                    resolve();
                });
            });

            req.on('error', (err) => {
                logger.warn(`[CrashShield] Eviction request to local host failed: ${err.message}`);
                resolve(); // Do not block executing flow
            });

            req.write(payload);
            req.end();
        });
    }

    /**
     * Slices the dialogue down to fit within a safe maximum of characters (~2,048 tokens)
     * keeps System messages intact at front.
     */
    public static compressChatMessages(messages: ChatMessage[], maxChars: number = 8000): ChatMessage[] {
        let currentLength = 0;
        const systemMessages = messages.filter(m => m.role === 'system');
        const standardMessages = messages.filter(m => m.role !== 'system');

        systemMessages.forEach(m => { currentLength += m.content.length; });

        const trimmedStandard: ChatMessage[] = [];
        // Walk backwards to keep the most recent context
        for (let i = standardMessages.length - 1; i >= 0; i--) {
            const msg = standardMessages[i];
            if (currentLength + msg.content.length <= maxChars) {
                trimmedStandard.unshift(msg);
                currentLength += msg.content.length;
            } else {
                logger.warn('[CrashShield] Context window limit met. Truncating earlier chat messages.');
                break;
            }
        }

        return [...systemMessages, ...trimmedStandard];
    }

    /**
     * Attaches a watchdog timer that restarts whenever new stream responses arrive.
     * Aborts execution if no incoming token arrives for 15 seconds.
     */
    public static createStallWatchdog(abortController: AbortController, label: string = 'Inference Stream'): { feedWatcher: () => void; cancelWatcher: () => void } {
        let watchTimer: NodeJS.Timeout | null = null;

        const kickWatcher = () => {
            if (watchTimer) {
                clearTimeout(watchTimer);
            }
            watchTimer = setTimeout(() => {
                logger.error(`[CrashShield] STALL ALERT: "${label}" did not output a token for 15 seconds. Triggering abort cancel signal.`);
                vscode.window.showErrorMessage(`[HermesForge CrashShield] Stalled Local Model process aborted to prevent Host freeze.`);
                abortController.abort();
            }, 15000);
        };

        const feedWatcher = () => {
            // Kick the watcher upon receiving any stream chunk
            kickWatcher();
        };

        const cancelWatcher = () => {
            if (watchTimer) {
                clearTimeout(watchTimer);
                watchTimer = null;
            }
        };

        // Start first watchdog cycle immediately
        kickWatcher();

        return {
            feedWatcher,
            cancelWatcher
        };
    }
}
