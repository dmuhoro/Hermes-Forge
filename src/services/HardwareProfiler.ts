import * as os from 'os';
import * as dns from 'dns/promises';
import { logger } from '../utils/Logger';

export type HardwareProfile = 'CONSTRAINED_8GB' | 'STANDARD_16GB' | 'PERFORMANCE_32GB';

export interface OllamaOptionsPayload {
    num_ctx: number;
    num_predict?: number;
    keep_alive: string;
    num_thread?: number;
    low_vram?: boolean;
    use_mlock?: boolean;
    f16_kv?: boolean;
    temperature?: number;
}

export interface ModelAllocationConfig {
    profile: HardwareProfile;
    modelCompletion: string;
    modelChat: string;
    options: OllamaOptionsPayload;
    totalMemoryGB: number;
    freeMemoryGB: number;
    offlineMode: boolean;
}

export class HardwareProfiler {
    private static isOfflineCache: boolean | null = null;
    private static lastCheckTime: number = 0;

    /**
     * Categorizes system RAM configuration and outputs optimized Ollama request variables
     */
    public static async getOptimalModelConfig(): Promise<ModelAllocationConfig> {
        const totalBytes = os.totalmem();
        const freeBytes = os.freemem();

        const totalGB = parseFloat((totalBytes / (1024 * 1024 * 1024)).toFixed(2));
        const freeGB = parseFloat((freeBytes / (1024 * 1024 * 1024)).toFixed(2));

        let profile: HardwareProfile = 'STANDARD_16GB';
        let modelCompletion = 'qwen2.5-coder:1.5b';
        let modelChat = 'hermes3:8b';

        // High efficiency options tailored precisely for host hardware footprint boundaries
        const options: OllamaOptionsPayload = {
            num_ctx: 4096,
            keep_alive: '10m', // 10 minutes default keep-alive
            num_thread: Math.max(2, Math.floor(os.cpus().length / 2))
        };

        if (totalGB < 12.0) {
            // CONSTRAINED (e.g. 8GB systems)
            profile = 'CONSTRAINED_8GB';
            modelCompletion = 'qwen2.5-coder:1.5b';
            modelChat = 'hermes3:3b'; // Lightweight footprint preference

            options.num_ctx = 2048; // Restricted context boundaries to prevent system Thrashing
            options.keep_alive = '2m'; // Short keep-alive to free system RAM rapidly
            options.low_vram = true;
            options.use_mlock = false; // Do not lock memory in RAM to permit swap spaces
            options.f16_kv = false;    // Conserve KV cache storage allocation sizes
        } else if (totalGB >= 24.0) {
            // PERFORMANCE (e.g. 32GB+ systems)
            profile = 'PERFORMANCE_32GB';
            modelCompletion = 'qwen2.5-coder:7b'; // Higher reasoning capacities
            modelChat = 'hermes3:8b';

            options.num_ctx = 16384; // Elite context scaling
            options.keep_alive = '60m'; // Extensive cache longevity
            options.num_thread = Math.max(4, os.cpus().length - 1); // Utilize complete resources
            options.use_mlock = true; // Lock weight pages inside physical memory
            options.f16_kv = true;
        } else {
            // STANDARD (e.g. 12GB - 24GB, typically 16GB systems)
            profile = 'STANDARD_16GB';
            modelCompletion = 'qwen2.5-coder:1.5b';
            modelChat = 'hermes3:8b'; // Balance high capability 8B chats with lower-end completions

            options.num_ctx = 4096;
            options.keep_alive = '10m';
            options.f16_kv = true;
        }

        const isSystemOffline = await this.checkOfflineStatus();

        logger.info('[HardwareProfiler] Dynamic scan completed successfully.', {
            profile,
            totalMemoryGB: totalGB,
            freeMemoryGB: freeGB,
            offlineMode: isSystemOffline,
            threadsAssigned: options.num_thread,
            contextWindow: options.num_ctx
        });

        return {
            profile,
            modelCompletion,
            modelChat,
            options,
            totalMemoryGB: totalGB,
            freeMemoryGB: freeGB,
            offlineMode: isSystemOffline
        };
    }

    /**
     * Conducts a lightning fast lookup to check internet routing availability
     */
    public static async checkOfflineStatus(): Promise<boolean> {
        const now = Date.now();
        // Cache result for 45 seconds to avoid flooding lookups on every request
        if (this.isOfflineCache !== null && (now - this.lastCheckTime) < 45000) {
            return this.isOfflineCache;
        }

        try {
            // High speed lookups against foundational nameservers
            const signal = AbortSignal.timeout(1200); // Strict timeout limit
            await dns.lookup('one.one.one.one', { signal } as any);
            this.isOfflineCache = false;
        } catch {
            try {
                const signal = AbortSignal.timeout(1200);
                await dns.lookup('google.com', { signal } as any);
                this.isOfflineCache = false;
            } catch {
                logger.warn('[HardwareProfiler] System detected as strictly OFFLINE. Prioritizing persistent local assets.');
                this.isOfflineCache = true;
            }
        }

        this.lastCheckTime = now;
        return this.isOfflineCache;
    }
}
