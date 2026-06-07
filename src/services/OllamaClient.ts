import * as http from 'http';
import * as https from 'https';

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

export class OllamaClient {
    private baseUrl: string;
    private isHttps: boolean;

    public modelCompletion: string;
    public modelChat: string;

    private static httpAgent = new http.Agent({ keepAlive: true, maxSockets: 10, keepAliveMsecs: 1000 });
    private static httpsAgent = new https.Agent({ keepAlive: true, maxSockets: 10, keepAliveMsecs: 1000 });

    constructor(config?: OllamaConfig) {
        this.baseUrl = config?.baseUrl || 'http://localhost:11434';
        this.modelCompletion = config?.modelCompletion || 'qwen2.5-coder:1.5b';
        this.modelChat = config?.modelChat || 'hermes3:8b';
        this.isHttps = this.baseUrl.startsWith('https');
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
        const payload = {
            model: options?.model || this.modelCompletion,
            prompt,
            stream: true,
            options
        };

        const res = await this.makeRequest('/api/generate', payload, signal);

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
                if (!line.trim()) continue;
                try {
                    const data = JSON.parse(line);
                    if (data.response) {
                        yield data.response;
                    }
                    if (data.done) {
                        return;
                    }
                } catch (e) {
                    console.error('Error parsing JSON from Ollama stream:', e);
                }
            }
        }
    }

    public async *streamChat(messages: ChatMessage[], options?: CompletionOptions, signal?: AbortSignal): AsyncGenerator<string, void, unknown> {
        const payload = {
            model: options?.model || this.modelChat,
            messages,
            stream: true,
            options
        };

        const res = await this.makeRequest('/api/chat', payload, signal);

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
                if (!line.trim()) continue;
                try {
                    const data = JSON.parse(line);
                    if (data.message?.content) {
                        yield data.message.content;
                    }
                    if (data.done) {
                        return;
                    }
                } catch (e) {
                    console.error('Error parsing JSON from Ollama stream:', e);
                }
            }
        }
    }

    public async generateCompletion(prompt: string, options?: CompletionOptions, signal?: AbortSignal): Promise<string> {
        const payload = {
            model: options?.model || this.modelCompletion,
            prompt,
            stream: false,
            options
        };

        const res = await this.makeRequest('/api/generate', payload, signal);
        return new Promise((resolve, reject) => {
            let data = '';
            res.on('data', chunk => { 
                if (signal?.aborted) {
                    res.destroy();
                    reject(new Error('Request aborted'));
                    return;
                }
                data += chunk.toString(); 
            });
            res.on('end', () => {
                if (signal?.aborted) return;
                try {
                    const parsed = JSON.parse(data);
                    resolve(parsed.response || '');
                } catch (e) {
                    reject(new Error('Failed to parse response from Ollama'));
                }
            });
            res.on('error', reject);
            
            if (signal) {
                signal.addEventListener('abort', () => {
                    res.destroy();
                    reject(new Error('Request aborted'));
                }, { once: true });
            }
        });
    }
}
