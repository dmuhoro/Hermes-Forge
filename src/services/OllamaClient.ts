import * as http from 'http';
import * as https from 'https';
import { HardwareProfiler } from './HardwareProfiler';
import { CrashShield } from '../utils/CrashShield';
import { logger } from '../utils/Logger';

export interface OllamaConfig {
    baseUrl?: string;
    modelCompletion?: string;
    modelChat?: string;
}

export interface ChatMessage {
    role: 'system' | 'user' | 'assistant';
    content: string;
}

export interface CompletionOptions {
    model?: string;
    temperature?: number;
    num_predict?: number;
    top_p?: number;
    stop?: string[];
}

export interface OllamaStatus {
    connected: boolean;
    completionModelExists: boolean;
    chatModelExists: boolean;
    models: string[];
}

export class OllamaClient {
    public baseUrl: string;
    private isHttps: boolean;

    public modelCompletion: string;
    public modelChat: string;

    private lastStatus: OllamaStatus = {
        connected: false,
        completionModelExists: false,
        chatModelExists: false,
        models: []
    };
    private statusListeners: ((status: OllamaStatus) => void)[] = [];
    private heartbeatTimer: NodeJS.Timeout | null = null;

    private static httpAgent = new http.Agent({ keepAlive: true, maxSockets: 10, keepAliveMsecs: 1000 });
    private static httpsAgent = new https.Agent({ keepAlive: true, maxSockets: 10, keepAliveMsecs: 1000 });

    constructor(config?: OllamaConfig) {
        this.baseUrl = config?.baseUrl || 'http://localhost:11434';
        this.modelCompletion = config?.modelCompletion || 'qwen2.5-coder:1.5b';
        this.modelChat = config?.modelChat || 'hermes3:8b';
        this.isHttps = this.baseUrl.startsWith('https');
    }

    public getStatus(): OllamaStatus {
        return this.lastStatus;
    }

    public onStatusChange(listener: (status: OllamaStatus) => void): () => void {
        this.statusListeners.push(listener);
        // Invoke immediately with last state
        listener(this.lastStatus);
        
        // Return unsubscribe function
        return () => {
            this.statusListeners = this.statusListeners.filter(l => l !== listener);
        };
    }

    private notifyListeners() {
        for (const listener of this.statusListeners) {
            try {
                listener(this.lastStatus);
            } catch (err) {
                logger.error('Error in status change listener:', err);
            }
        }
    }

    public checkConnection(): Promise<boolean> {
        return new Promise((resolve) => {
            try {
                const url = new URL(this.baseUrl);
                const options = {
                    hostname: url.hostname,
                    port: url.port || (this.isHttps ? '443' : '80'),
                    path: '/',
                    method: 'GET',
                    agent: this.isHttps ? OllamaClient.httpsAgent : OllamaClient.httpAgent,
                    timeout: 2000
                };
                const client = this.isHttps ? https : http;
                const req = client.request(options, (res) => {
                    if (res.statusCode && res.statusCode < 400) {
                        resolve(true);
                    } else {
                        resolve(false);
                    }
                    res.resume();
                });
                req.on('error', () => {
                    resolve(false);
                });
                req.on('timeout', () => {
                    req.destroy();
                    resolve(false);
                });
                req.end();
            } catch {
                resolve(false);
            }
        });
    }

    public checkModels(): Promise<{ completionModelExists: boolean; chatModelExists: boolean; models: string[] }> {
        return new Promise((resolve) => {
            try {
                const url = new URL(`${this.baseUrl}/api/tags`);
                const options = {
                    hostname: url.hostname,
                    port: url.port || (this.isHttps ? '443' : '11434'),
                    path: url.pathname,
                    method: 'GET',
                    agent: this.isHttps ? OllamaClient.httpsAgent : OllamaClient.httpAgent,
                    timeout: 2000
                };
                const client = this.isHttps ? https : http;
                const req = client.request(options, (res) => {
                    let data = '';
                    res.on('data', chunk => { data += chunk; });
                    res.on('end', () => {
                        try {
                            const parsed = JSON.parse(data);
                            const models: string[] = (parsed.models || []).map((m: any) => m.name);
                            
                            const completionModelExists = models.some(m => 
                                m.includes(this.modelCompletion) || this.modelCompletion.includes(m)
                            );
                            const chatModelExists = models.some(m => 
                                m.includes(this.modelChat) || this.modelChat.includes(m)
                            );
                            
                            resolve({ completionModelExists, chatModelExists, models });
                        } catch {
                            resolve({ completionModelExists: false, chatModelExists: false, models: [] });
                        }
                    });
                });
                req.on('error', () => {
                    resolve({ completionModelExists: false, chatModelExists: false, models: [] });
                });
                req.on('timeout', () => {
                    req.destroy();
                    resolve({ completionModelExists: false, chatModelExists: false, models: [] });
                });
                req.end();
            } catch {
                resolve({ completionModelExists: false, chatModelExists: false, models: [] });
            }
        });
    }

    public startHeartbeat(intervalMs = 5000) {
        if (this.heartbeatTimer) return;
        
        const check = async () => {
            const connected = await this.checkConnection();
            let completionModelExists = false;
            let chatModelExists = false;
            let models: string[] = [];
            
            if (connected) {
                const modelCheck = await this.checkModels();
                completionModelExists = modelCheck.completionModelExists;
                chatModelExists = modelCheck.chatModelExists;
                models = modelCheck.models;
            }
            
            this.lastStatus = { connected, completionModelExists, chatModelExists, models };
            this.notifyListeners();
        };

        check(); // Run immediately
        this.heartbeatTimer = setInterval(check, intervalMs);
    }

    public stopHeartbeat() {
        if (this.heartbeatTimer) {
            clearInterval(this.heartbeatTimer);
            this.heartbeatTimer = null;
        }
    }

    private makeRequest(path: string, payload: any, signal?: AbortSignal): Promise<http.IncomingMessage> {
        return new Promise((resolve, reject) => {
            if (signal?.aborted) {
                return reject(new Error('Request aborted before starting'));
            }

            const url = new URL(`${this.baseUrl}${path}`);
            const options = {
                hostname: url.hostname,
                port: url.port,
                path: url.pathname,
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                agent: this.isHttps ? OllamaClient.httpsAgent : OllamaClient.httpAgent
            };

            const client = this.isHttps ? https : http;
            const req = client.request(options, (res) => {
                if (res.statusCode && res.statusCode >= 400) {
                    let errorData = '';
                    res.on('data', chunk => { errorData += chunk; });
                    res.on('end', () => {
                        reject(new Error(`Ollama API Error (${res.statusCode}): ${errorData}`));
                    });
                    return;
                }
                resolve(res);
            });

            if (signal) {
                const abortHandler = () => {
                    req.destroy();
                    reject(new Error('Request aborted'));
                };
                signal.addEventListener('abort', abortHandler, { once: true });
                req.on('close', () => {
                    signal.removeEventListener('abort', abortHandler);
                });
            }

            req.on('error', (e) => {
                reject(new Error(`Failed to connect to Ollama at ${this.baseUrl}: ${e.message}`));
            });

            req.write(JSON.stringify(payload));
            req.end();
        });
    }

    public async *streamCompletion(prompt: string, options?: CompletionOptions, signal?: AbortSignal): AsyncGenerator<string, void, unknown> {
        const localController = new AbortController();
        if (signal?.aborted) {
            throw new Error('Stream aborted before starting');
        }
        const onAbort = () => localController.abort();
        if (signal) {
            signal.addEventListener('abort', onAbort, { once: true });
        }

        const model = options?.model || this.modelCompletion;
        await CrashShield.checkMemoryAndIntervene(model, this.baseUrl);

        if (localController.signal.aborted) {
            if (signal) signal.removeEventListener('abort', onAbort);
            throw new Error('Stream aborted during pre-checks');
        }

        const hwConfig = await HardwareProfiler.getOptimalModelConfig();
        const mergedOptions = {
            ...hwConfig.options,
            ...options
        };
        const payload = {
            model,
            prompt,
            stream: true,
            options: mergedOptions
        };

        const watchdog = CrashShield.createStallWatchdog(localController, `streamCompletion (${model})`);

        let responseStream: http.IncomingMessage | null = null;
        const onAbortDuringStream = () => {
            if (responseStream) {
                responseStream.destroy();
            }
        };
        localController.signal.addEventListener('abort', onAbortDuringStream, { once: true });

        try {
            const res = await this.makeRequest('/api/generate', payload, localController.signal);
            responseStream = res;
            let buffer = '';

            for await (const chunk of res) {
                if (signal?.aborted || localController.signal.aborted) {
                    res.destroy();
                    throw new Error('Stream aborted');
                }
                watchdog.feedWatcher();

                buffer += chunk.toString();
                const lines = buffer.split('\n');
                buffer = lines.pop() || '';

                for (const line of lines) {
                    if (!line.trim()) continue;
                    try {
                        const data = JSON.parse(line);
                        if (data.response) {
                            yield data.response;
                        }
                        if (data.done) {
                            return;
                        }
                    } catch (err) {
                        logger.error('Error parsing JSON from Ollama stream:', err);
                    }
                }
            }
        } finally {
            localController.signal.removeEventListener('abort', onAbortDuringStream);
            if (signal) {
                signal.removeEventListener('abort', onAbort);
            }
            watchdog.cancelWatcher();
        }
    }

    public async *streamChat(messages: ChatMessage[], options?: CompletionOptions, signal?: AbortSignal): AsyncGenerator<string, void, unknown> {
        const localController = new AbortController();
        if (signal?.aborted) {
            throw new Error('Stream aborted before starting');
        }
        const onAbort = () => localController.abort();
        if (signal) {
            signal.addEventListener('abort', onAbort, { once: true });
        }

        const model = options?.model || this.modelChat;
        await CrashShield.checkMemoryAndIntervene(model, this.baseUrl);

        if (localController.signal.aborted) {
            if (signal) signal.removeEventListener('abort', onAbort);
            throw new Error('Stream aborted during pre-checks');
        }

        const compressedMessages = CrashShield.compressChatMessages(messages, 8000);

        const hwConfig = await HardwareProfiler.getOptimalModelConfig();
        const mergedOptions = {
            ...hwConfig.options,
            ...options
        };
        const payload = {
            model,
            messages: compressedMessages,
            stream: true,
            options: mergedOptions
        };

        const watchdog = CrashShield.createStallWatchdog(localController, `streamChat (${model})`);

        let responseStream: http.IncomingMessage | null = null;
        const onAbortDuringStream = () => {
            if (responseStream) {
                responseStream.destroy();
            }
        };
        localController.signal.addEventListener('abort', onAbortDuringStream, { once: true });

        try {
            const res = await this.makeRequest('/api/chat', payload, localController.signal);
            responseStream = res;
            let buffer = '';

            for await (const chunk of res) {
                if (signal?.aborted || localController.signal.aborted) {
                    res.destroy();
                    throw new Error('Stream aborted');
                }
                watchdog.feedWatcher();

                buffer += chunk.toString();
                const lines = buffer.split('\n');
                buffer = lines.pop() || '';

                for (const line of lines) {
                    if (!line.trim()) continue;
                    try {
                        const data = JSON.parse(line);
                        if (data.message?.content) {
                            yield data.message.content;
                        }
                        if (data.done) {
                            return;
                        }
                    } catch (err) {
                        logger.error('Error parsing JSON from Ollama stream:', err);
                    }
                }
            }
        } finally {
            localController.signal.removeEventListener('abort', onAbortDuringStream);
            if (signal) {
                signal.removeEventListener('abort', onAbort);
            }
            watchdog.cancelWatcher();
        }
    }

    public async generateCompletion(prompt: string, options?: CompletionOptions, signal?: AbortSignal): Promise<string> {
        const localController = new AbortController();
        if (signal?.aborted) {
            return Promise.reject(new Error('Request aborted before starting'));
        }
        if (signal) {
            const onAbort = () => localController.abort();
            signal.addEventListener('abort', onAbort, { once: true });
        }

        const model = options?.model || this.modelCompletion;
        await CrashShield.checkMemoryAndIntervene(model, this.baseUrl);

        if (localController.signal.aborted) {
            return Promise.reject(new Error('Request aborted during pre-checks'));
        }

        const hwConfig = await HardwareProfiler.getOptimalModelConfig();
        const mergedOptions = {
            ...hwConfig.options,
            ...options
        };
        const payload = {
            model,
            prompt,
            stream: false,
            options: mergedOptions
        };

        const watchdog = CrashShield.createStallWatchdog(localController, `generateCompletion (${model})`);

        try {
            const res = await this.makeRequest('/api/generate', payload, localController.signal);
            return new Promise((resolve, reject) => {
                let data = '';
                res.on('data', chunk => { 
                    if (signal?.aborted || localController.signal.aborted) {
                        res.destroy();
                        watchdog.cancelWatcher();
                        reject(new Error('Request aborted'));
                        return;
                    }
                    data += chunk.toString(); 
                });
                res.on('end', () => {
                    watchdog.cancelWatcher();
                    if (signal?.aborted || localController.signal.aborted) return;
                    try {
                        const parsed = JSON.parse(data);
                        resolve(parsed.response || '');
                    } catch {
                        reject(new Error('Failed to parse response from Ollama'));
                    }
                });
                res.on('error', (err) => {
                    watchdog.cancelWatcher();
                    reject(err);
                });
                
                localController.signal.addEventListener('abort', () => {
                    res.destroy();
                    watchdog.cancelWatcher();
                    reject(new Error('Request aborted'));
                }, { once: true });
            });
        } catch (error) {
            watchdog.cancelWatcher();
            throw error;
        }
    }
}
