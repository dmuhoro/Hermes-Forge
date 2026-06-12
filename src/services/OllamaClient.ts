import * as http from 'http';
import * as https from 'https';
import * as vscode from 'vscode';
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

    public shouldUseCloudFallback(): boolean {
        try {
            const config = vscode.workspace.getConfiguration('hermes-forge');
            const fallbackEnabled = !!config.get<boolean>('enableCloudFallback');
            const apiKey = config.get<string>('cloudApiKey') || '';
            return fallbackEnabled && apiKey.trim().length > 0;
        } catch {
            return false;
        }
    }

    public shouldRedirectToCloud(promptOrMessages: string | ChatMessage[], options?: CompletionOptions): boolean {
        if (!this.shouldUseCloudFallback()) {
            return false;
        }

        if (!this.lastStatus.connected) {
            return true;
        }

        if (options?.model === 'cloud-trigger') {
            return true;
        }

        try {
            const config = vscode.workspace.getConfiguration('hermes-forge');
            let textContent = '';
            if (typeof promptOrMessages === 'string') {
                textContent = promptOrMessages;
            } else if (Array.isArray(promptOrMessages)) {
                textContent = promptOrMessages.map(m => m.content).join(' ');
            }

            const contextLimit = config.get<number>('contextLimits') || 1536;
            if (textContent.length > contextLimit * 4) {
                logger.info(`[Hybrid Intelligence] Redirecting query to cloud: Prompt size (${textContent.length} chars) exceeds optimal local context.`);
                return true;
            }

            const complexKeywords = /kubernetes multi-resource|gcp terraform|aws fargate ecs cluster|microservice architecture analysis|security scan pipeline vulnerability|kubernetes ingress template/i;
            if (complexKeywords.test(textContent)) {
                logger.info('[Hybrid Intelligence] High-reasoning cloud/architectural query detected. Offloading to target cloud frontier model.');
                return true;
            }
        } catch {
            // Ignore config reading errors
        }

        return false;
    }

    private getCloudConfig() {
        const config = vscode.workspace.getConfiguration('hermes-forge');
        const provider = config.get<string>('cloudProvider') || 'gemini';
        const apiKey = config.get<string>('cloudApiKey') || '';
        const overrideModel = config.get<string>('cloudModel') || '';

        let model = overrideModel;
        let url = '';
        const headers: Record<string, string> = {};

        if (provider === 'gemini') {
            if (!model) model = 'gemini-1.5-flash';
            url = 'https://generativelanguage.googleapis.com/v1beta/openai/v1/chat/completions';
            headers['Authorization'] = `Bearer ${apiKey}`;
        } else if (provider === 'claude') {
            if (!model) model = 'claude-3-5-haiku-20241022';
            url = 'https://api.anthropic.com/v1/messages';
            headers['x-api-key'] = apiKey;
            headers['anthropic-version'] = '2023-06-01';
        } else if (provider === 'groq') {
            if (!model) model = 'llama-3.3-70b-versatile';
            url = 'https://api.groq.com/openai/v1/chat/completions';
            headers['Authorization'] = `Bearer ${apiKey}`;
        } else if (provider === 'grok') {
            if (!model) model = 'grok-beta';
            url = 'https://api.x.ai/v1/chat/completions';
            headers['Authorization'] = `Bearer ${apiKey}`;
        }

        return { provider, apiKey, model, url, headers };
    }

    private makeHttpsRequest(urlStr: string, headers: Record<string, string>, payload: any, signal?: AbortSignal): Promise<http.IncomingMessage> {
        return new Promise((resolve, reject) => {
            if (signal?.aborted) {
                return reject(new Error('Request aborted before starting'));
            }

            const url = new URL(urlStr);
            const options: https.RequestOptions = {
                hostname: url.hostname,
                port: 443,
                path: url.pathname + url.search,
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    ...headers
                },
                agent: OllamaClient.httpsAgent
            };

            const req = https.request(options, (res) => {
                if (res.statusCode && res.statusCode >= 400) {
                    let errorData = '';
                    res.on('data', chunk => { errorData += chunk; });
                    res.on('end', () => {
                        reject(new Error(`Cloud API Error (${res.statusCode}): ${errorData}`));
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
                reject(new Error(`Cloud connection failed: ${e.message}`));
            });

            req.write(JSON.stringify(payload));
            req.end();
        });
    }

    public async generateCompletionCloud(prompt: string, signal?: AbortSignal): Promise<string> {
        const { provider, model, url, headers } = this.getCloudConfig();
        const messages: ChatMessage[] = [{ role: 'user', content: prompt }];
        let payload: any;

        if (provider === 'claude') {
            payload = {
                model,
                messages: messages.map(m => ({ role: m.role, content: m.content })),
                max_tokens: 4000,
                stream: false
            };
        } else {
            payload = {
                model,
                messages,
                stream: false
            };
        }

        const res = await this.makeHttpsRequest(url, headers, payload, signal);
        return new Promise((resolve, reject) => {
            let data = '';
            res.on('data', chunk => { data += chunk.toString(); });
            res.on('end', () => {
                try {
                    const parsed = JSON.parse(data);
                    if (provider === 'claude') {
                        resolve(parsed.content?.[0]?.text || '');
                    } else {
                        resolve(parsed.choices?.[0]?.message?.content || '');
                    }
                } catch {
                    reject(new Error('Failed to parse Cloud response'));
                }
            });
            res.on('error', reject);
        });
    }

    public async *streamChatCloud(messages: ChatMessage[], signal?: AbortSignal): AsyncGenerator<string, void, unknown> {
        const { provider, model, url, headers } = this.getCloudConfig();
        let payload: any;

        if (provider === 'claude') {
            const sysMessage = messages.find(m => m.role === 'system');
            const otherMessages = messages.filter(m => m.role !== 'system');
            payload = {
                model,
                system: sysMessage ? sysMessage.content : undefined,
                messages: otherMessages.map(m => ({ role: m.role, content: m.content })),
                max_tokens: 4000,
                stream: true
            };
        } else {
            payload = {
                model,
                messages,
                stream: true
            };
        }

        const res = await this.makeHttpsRequest(url, headers, payload, signal);
        let buffer = '';

        for await (const chunk of res) {
            if (signal?.aborted) {
                res.destroy();
                throw new Error('Stream aborted');
            }

            buffer += chunk.toString();
            const lines = buffer.split('\n');
            buffer = lines.pop() || '';

            for (const line of lines) {
                const trimmed = line.trim();
                if (!trimmed) continue;

                if (trimmed.startsWith('data: ')) {
                    const content = trimmed.substring(6).trim();
                    if (content === '[DONE]') continue;

                    try {
                        const parsed = JSON.parse(content);
                        if (provider === 'claude') {
                            if (parsed.type === 'content_block_delta' && parsed.delta?.text) {
                                yield parsed.delta.text;
                            }
                        } else {
                            const text = parsed.choices?.[0]?.delta?.content;
                            if (text) {
                                yield text;
                            }
                        }
                    } catch {}
                }
            }
        }
    }

    public async *streamCompletionCloud(prompt: string, signal?: AbortSignal): AsyncGenerator<string, void, unknown> {
        const messages: ChatMessage[] = [{ role: 'user', content: prompt }];
        yield* this.streamChatCloud(messages, signal);
    }

    public async *streamCompletion(prompt: string, options?: CompletionOptions, signal?: AbortSignal): AsyncGenerator<string, void, unknown> {
        if (this.shouldRedirectToCloud(prompt, options)) {
            try {
                yield* this.streamCompletionCloud(prompt, signal);
                return;
            } catch (err: any) {
                logger.error('Stream Completion Cloudfallback failed:', err);
            }
        }

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
        } catch (error: any) {
            watchdog.cancelWatcher();
            if (this.shouldUseCloudFallback()) {
                logger.info('Ollama streamCompletion failed. Falling back to Cloud provider.');
                yield* this.streamCompletionCloud(prompt, signal);
                return;
            }
            throw error;
        } finally {
            localController.signal.removeEventListener('abort', onAbortDuringStream);
            if (signal) {
                signal.removeEventListener('abort', onAbort);
            }
            watchdog.cancelWatcher();
        }
    }

    public async *streamChat(messages: ChatMessage[], options?: CompletionOptions, signal?: AbortSignal): AsyncGenerator<string, void, unknown> {
        if (this.shouldRedirectToCloud(messages, options)) {
            try {
                yield* this.streamChatCloud(messages, signal);
                return;
            } catch (err: any) {
                logger.error('Stream Chat Cloudfallback failed:', err);
            }
        }

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
        } catch (error: any) {
            watchdog.cancelWatcher();
            if (this.shouldUseCloudFallback()) {
                logger.info('Ollama streamChat failed. Falling back to Cloud provider.');
                yield* this.streamChatCloud(messages, signal);
                return;
            }
            throw error;
        } finally {
            localController.signal.removeEventListener('abort', onAbortDuringStream);
            if (signal) {
                signal.removeEventListener('abort', onAbort);
            }
            watchdog.cancelWatcher();
        }
    }

    public async generateCompletion(prompt: string, options?: CompletionOptions, signal?: AbortSignal): Promise<string> {
        if (this.shouldRedirectToCloud(prompt, options)) {
            try {
                return await this.generateCompletionCloud(prompt, signal);
            } catch (err: any) {
                logger.error('generateCompletion Cloudfallback failed, routing to native Ollama:', err);
            }
        }

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
            if (this.shouldUseCloudFallback()) {
                logger.info('Ollama generateCompletion failed, falling back to cloud endpoint.');
                try {
                    return await this.generateCompletionCloud(prompt, signal);
                } catch (err: any) {
                    logger.error('Ollama cloud fallback generator failed:', err);
                }
            }
            throw error;
        }
    }
}
