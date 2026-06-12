import * as os from 'os';
import * as dns from 'dns/promises';
import { logger } from '../utils/Logger';

export type HardwareProfile = 'CONSTRAINED_TIER' | 'CONSTRAINED_8GB' | 'STANDARD_16GB' | 'PERFORMANCE_32GB';

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

export interface LiveHardwareMetrics {
    cpuLoad: number;
    totalMemoryGB: number;
    freeMemoryGB: number;
    usedMemoryGB: number;
    memoryUsagePct: number;
}

export class HardwareProfiler {
    private static isOfflineCache: boolean | null = null;
    private static lastCheckTime: number = 0;

    /**
     * Measures current CPU usage over a short 100ms interval
     */
    public static getCPULoad(): Promise<number> {
        return new Promise((resolve) => {
            const startCPUs = os.cpus();
            if (!startCPUs || startCPUs.length === 0) {
                resolve(0);
                return;
            }

            const startTimes = startCPUs.map(cpu => cpu.times);
            setTimeout(() => {
                const endCPUs = os.cpus();
                if (!endCPUs || endCPUs.length === 0) {
                    resolve(0);
                    return;
                }

                const endTimes = endCPUs.map(cpu => cpu.times);
                let totalDiff = 0;
                let idleDiff = 0;

                for (let i = 0; i < Math.min(startTimes.length, endTimes.length); i++) {
                    const start = startTimes[i];
                    const end = endTimes[i];

                    const startTotal = start.user + start.nice + start.sys + start.idle + start.irq;
                    const endTotal = end.user + end.nice + end.sys + end.idle + end.irq;

                    totalDiff += (endTotal - startTotal);
                    idleDiff += (end.idle - start.idle);
                }

                const cpuPercentage = totalDiff > 0 ? (1 - (idleDiff / totalDiff)) * 100 : 0;
                resolve(parseFloat(Math.min(100, Math.max(0, cpuPercentage)).toFixed(1)));
            }, 100);
        });
    }

    /**
     * Gathers quick system telemetry for alive CPU/RAM metrics
     */
    public static async getLiveMetrics(): Promise<LiveHardwareMetrics> {
        const totalBytes = os.totalmem();
        const freeBytes = os.freemem();

        const totalGB = parseFloat((totalBytes / (1024 * 1024 * 1024)).toFixed(2));
        const freeGB = parseFloat((freeBytes / (1024 * 1024 * 1024)).toFixed(2));
        const usedGB = parseFloat((totalGB - freeGB).toFixed(2));

        const memoryUsagePct = parseFloat(((usedGB / totalGB) * 100).toFixed(1));
        const cpuLoad = await this.getCPULoad();

        return {
            cpuLoad,
            totalMemoryGB: totalGB,
            freeMemoryGB: freeGB,
            usedMemoryGB: usedGB,
            memoryUsagePct
        };
    }

    /**
     * Categorizes system RAM configuration and outputs optimized Ollama request variables
     */
    public static async getOptimalModelConfig(): Promise<ModelAllocationConfig> {
        const totalBytes = os.totalmem();
        const freeBytes = os.freemem();

        const totalGB = parseFloat((totalBytes / (1024 * 1024 * 1024)).toFixed(2));
        const freeGB = parseFloat((freeBytes / (1024 * 1024 * 1024)).toFixed(2));

        // Let's hard-code the tier to CONSTRAINED_TIER for strict low-overhead laptop performance on 8GB RAM
        const profile: HardwareProfile = 'CONSTRAINED_TIER';
        const modelCompletion = 'qwen2.5-coder:1.5b';
        const modelChat = 'qwen2.5-coder:3b';

        // Options specifically tailored to protect resource limits
        const options: OllamaOptionsPayload = {
            num_ctx: 1536, // Strict 1536 context limit to prevent system RAM spiking and thrashing
            keep_alive: '2m', // Unload after 2 minutes of inactivity to release memory
            num_thread: Math.max(2, Math.floor(os.cpus().length / 2)),
            low_vram: true,
            use_mlock: false, // Ensure we don't block pages in physical memory for swap capabilities
            f16_kv: false     // Conserve KV storage capacity
        };

        const isSystemOffline = await this.checkOfflineStatus();

        logger.info('[HardwareProfiler] Direct CONSTRAINED_TIER configuration loaded successfully.', {
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

    /**
     * Executes an active inference speed test against the local Ollama instance
     * to measure Time-To-First-Token (TTFT) and Tokens-Per-Second (TPS) latency statistics.
     */
    public static async runSpeedTest(ollama: any): Promise<{ tps: number; ttft: number; totalTokens: number; durationMs: number }> {
        const startTime = Date.now();
        let firstTokenTime = 0;
        let tokenCount = 0;
        
        try {
            // High-fidelity standard prompt optimized for quick 30-50 tokens response
            const prompt = 'Explain TypeScript interfaces in exactly three short sentences.';
            const stream = ollama.streamCompletion(prompt, { temperature: 0.1 });
            
            for await (const chunk of stream) {
                if (tokenCount === 0) {
                    firstTokenTime = Date.now();
                }
                // Approximate token metrics from space-delimited text chunks
                const words = chunk.split(/\s+/).filter(Boolean).length;
                tokenCount += words > 0 ? words : 1;
            }
            
            const totalTimeMs = Date.now() - startTime;
            const ttft = firstTokenTime ? (firstTokenTime - startTime) : totalTimeMs;
            const tps = tokenCount / ((totalTimeMs - ttft) / 1000 || 1);
            
            return {
                tps: parseFloat(tps.toFixed(1)),
                ttft,
                totalTokens: tokenCount,
                durationMs: totalTimeMs
            };
        } catch (err: any) {
            throw new Error(`Hardware speed test failed: ${err.message}`);
        }
    }
}
