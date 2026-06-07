import * as vscode from 'vscode';

export enum LogLevel {
    DEBUG = 0,
    INFO = 1,
    WARN = 2,
    ERROR = 3
}

export class OfflineLogger {
    private static instance: OfflineLogger;
    private channel: vscode.OutputChannel;
    private logLevel: LogLevel = LogLevel.DEBUG;

    private constructor() {
        this.channel = vscode.window.createOutputChannel('[HermesForge Engine]');
    }

    public static getInstance(): OfflineLogger {
        if (!OfflineLogger.instance) {
            OfflineLogger.instance = new OfflineLogger();
        }
        return OfflineLogger.instance;
    }

    public setLevel(level: LogLevel) {
        this.logLevel = level;
    }

    private log(level: LogLevel, prefix: string, message: string, meta?: any) {
        if (level < this.logLevel) return;

        const timestamp = new Date().toISOString();
        
        let metaStr = '';
        if (meta) {
            try {
                metaStr = ` | Meta: ${JSON.stringify(meta)}`;
            } catch (e) {
                metaStr = ` | [Unserializable Meta]`;
            }
        }
        
        this.channel.appendLine(`[${timestamp}] [${prefix}] ${message}${metaStr}`);
    }

    public debug(message: string, meta?: any) {
        this.log(LogLevel.DEBUG, 'DEBUG', message, meta);
    }

    public info(message: string, meta?: any) {
        this.log(LogLevel.INFO, 'INFO', message, meta);
    }

    public warn(message: string, meta?: any) {
        this.log(LogLevel.WARN, 'WARN', message, meta);
    }

    public error(message: string, meta?: any) {
        this.log(LogLevel.ERROR, 'ERROR', message, meta);
    }

    /**
     * Core Performance Tracking: Measures generalized execution time.
     */
    public startTimer(label: string): () => void {
        const start = performance.now();
        return () => {
            const durationMs = performance.now() - start;
            this.info(`[Performance Timer] ${label} finished execution`, { durationMs: parseFloat(durationMs.toFixed(2)) });
        };
    }

    /**
     * Specialized TTFT (Time-To-First-Token) Tracker for local hardware benchmarking.
     * Use this specifically to measure the latency bridge between VS Code and Ollama.
     */
    public trackTTFT(model: string, feature: string): () => void {
        const start = performance.now();
        let firstTokenTracked = false;
        
        return () => {
            if (firstTokenTracked) return; // Guard to only trigger on the actual first emitted token
            firstTokenTracked = true;
            const ttftMs = performance.now() - start;
            this.info(`[TTFT Benchmark: ${feature}] Response started`, { 
                model, 
                ttftMs: parseFloat(ttftMs.toFixed(2)) 
            });
        };
    }

    /**
     * Records TTFT for pipeline phase triggers
     */
    public trackPhaseTTFT(phase: string, model: string): () => void {
        const start = performance.now();
        return () => {
            const durationMs = performance.now() - start;
            this.info(`[Executive Phase Metrics] Phase [${phase.toUpperCase()}] reached first responsive milestone using model: ${model}`, {
                phase,
                model,
                ttftMs: parseFloat(durationMs.toFixed(2))
            });
        };
    }
}

export const logger = OfflineLogger.getInstance();
