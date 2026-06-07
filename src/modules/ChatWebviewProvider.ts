import * as vscode from 'vscode';
import { OllamaClient, ChatMessage } from '../services/OllamaClient';
import { AgentRouter } from '../services/AgentRouter';
import { logger } from '../utils/Logger';

export class ChatWebviewProvider implements vscode.WebviewViewProvider {
    public static readonly viewType = 'hermes-forge-sidebar';
    private _view?: vscode.WebviewView;
    private router?: AgentRouter;
    
    constructor(private readonly _extensionUri: vscode.Uri, private ollama: OllamaClient) {}

    public setRouter(router: AgentRouter) {
        this.router = router;
    }

    public resolveWebviewView(
        webviewView: vscode.WebviewView,
        _context: vscode.WebviewViewResolveContext,
        _token: vscode.CancellationToken,
    ) {
        this._view = webviewView;
        webviewView.webview.options = {
            enableScripts: true,
            localResourceRoots: [this._extensionUri]
        };

        webviewView.webview.html = this._getHtmlForWebview();

        webviewView.webview.onDidReceiveMessage(async (data) => {
            if (data.type === 'sendPrompt') {
                await this.handleChatInteraction(data.value);
            }
        });
    }

    public sendSystemNotification(message: string) {
        if (!this._view) return;
        this._view.webview.postMessage({ type: 'streamChunk', value: `\n\n*${message}*\n\n` });
    }

    private async handleChatInteraction(prompt: string) {
        if (!this._view) return;
        
        // Extract selected text context from the active editor
        let contextText = '';
        const activeEditor = vscode.window.activeTextEditor;
        if (activeEditor) {
            const selection = activeEditor.selection;
            if (!selection.isEmpty) {
                const selectedText = activeEditor.document.getText(selection);
                const fileName = activeEditor.document.fileName.split('/').pop() || 'file';
                contextText = `\n\nContext from ${fileName}:\n\`\`\`\n${selectedText}\n\`\`\``;
            }
        }
        
        // Switch to Router logic to dynamically classify instead of hardcoding stream dispatch
        this._view.webview.postMessage({ type: 'startStream' });
        
        if (this.router) {
            await this.router.routeTask(prompt, contextText);
        } else {
            // Fallback safety
            await this.streamResponse(prompt, contextText, this.ollama.modelChat);
        }
    }

    public async streamResponse(prompt: string, contextText: string, model: string) {
        if (!this._view) return;

        const finalPrompt = prompt + contextText;
        
        const messages: ChatMessage[] = [
            { 
                role: 'system', 
                content: 'You are HermesForge, an advanced offline software engineering AI running locally in VS Code. Keep answers concise. Provide cleanly formatted code blocks.' 
            },
            { role: 'user', content: finalPrompt }
        ];

        const ttftTracker = logger.trackTTFT(model, 'Sidebar Chat');

        try {
            const stream = this.ollama.streamChat(messages, { 
                model: model, 
                temperature: 0.3 
            });
            
            for await (const chunk of stream) {
                ttftTracker();
                if (this._view) {
                    this._view.webview.postMessage({ type: 'streamChunk', value: chunk });
                }
            }
            this._view.webview.postMessage({ type: 'endStream' });
        } catch (error: any) {
            this._view.webview.postMessage({ type: 'error', value: error.message || 'Error communicating with Ollama' });
            logger.error('[HermesForge] Chat Stream Error:', error);
        }
    }

    private _getHtmlForWebview() {
        return `<!DOCTYPE html>
        <html lang="en">
        <head>
            <meta charset="UTF-8">
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
            <title>HermesForge Chat</title>
            <style>
                :root {
                    --bg-color: var(--vscode-editor-background);
                    --text-color: var(--vscode-editor-foreground);
                    --input-bg: var(--vscode-input-background);
                    --input-border: var(--vscode-input-border, #3c3c3c);
                    --border-color: var(--vscode-panel-border, #444);
                    --button-bg: var(--vscode-button-background);
                    --button-hover: var(--vscode-button-hoverBackground);
                    --user-msg-color: var(--vscode-textPreformat-foreground, #ce9178);
                    --code-bg: var(--vscode-textCodeBlock-background, rgba(0, 0, 0, 0.4));
                    --font-family: var(--vscode-font-family, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif);
                }

                * {
                    box-sizing: border-box;
                }

                body { 
                    font-family: var(--font-family); 
                    background-color: var(--bg-color);
                    color: var(--text-color);
                    margin: 0;
                    padding: 0;
                    display: flex;
                    flex-direction: column;
                    height: 100vh;
                    overflow: hidden;
                }

                #chat-container { 
                    flex: 1;
                    overflow-y: auto;
                    padding: 16px;
                    display: flex;
                    flex-direction: column;
                    gap: 16px;
                    line-height: 1.5;
                    font-size: 13px;
                }

                .message {
                    display: flex;
                    flex-direction: column;
                }

                .message-role {
                    font-weight: 600;
                    margin-bottom: 4px;
                    font-size: 11px;
                    text-transform: uppercase;
                    opacity: 0.7;
                }

                .user-role { color: var(--user-msg-color); }
                .ai-role { color: var(--button-bg); }

                .message-content {
                    word-wrap: break-word;
                    white-space: pre-wrap;
                }

                .message-content pre {
                    background: var(--code-bg);
                    padding: 10px;
                    border-radius: 4px;
                    overflow-x: auto;
                    margin: 8px 0;
                    border: 1px solid var(--border-color);
                }

                .message-content code {
                    font-family: var(--vscode-editor-font-family, monospace);
                    font-size: 12px;
                }

                #input-container {
                    padding: 12px;
                    border-top: 1px solid var(--border-color);
                    background: var(--bg-color);
                }

                .input-wrapper {
                    position: relative;
                    display: flex;
                    flex-direction: column;
                    border: 1px solid var(--input-border);
                    border-radius: 4px;
                    background: var(--input-bg);
                    padding: 8px;
                }

                .input-wrapper:focus-within {
                    border-color: var(--button-bg);
                }

                textarea { 
                    width: 100%; 
                    min-height: 48px;
                    max-height: 200px;
                    background: transparent; 
                    color: var(--text-color); 
                    border: none;
                    resize: none;
                    outline: none;
                    font-family: var(--font-family);
                    font-size: 13px;
                    padding: 0;
                }

                /* Context Badge styling */
                #context-badge {
                    display: none;
                    font-size: 11px;
                    background: var(--button-bg);
                    color: #fff;
                    padding: 2px 6px;
                    border-radius: 10px;
                    align-self: flex-start;
                    margin-bottom: 6px;
                    opacity: 0.8;
                }

                .toolbar {
                    display: flex;
                    justify-content: flex-end;
                    margin-top: 8px;
                }

                button { 
                    background: var(--button-bg); 
                    color: #fff; 
                    border: none; 
                    border-radius: 2px;
                    padding: 6px 12px; 
                    cursor: pointer; 
                    font-size: 12px;
                    font-weight: 500;
                    display: flex;
                    align-items: center;
                    justify-content: center;
                }

                button:disabled {
                    opacity: 0.5;
                    cursor: not-allowed;
                }

                button:hover:not(:disabled) {
                    background: var(--button-hover);
                }

                .loading {
                    display: inline-block;
                    width: 12px;
                    height: 12px;
                    border: 2px solid rgba(255,255,255,0.3);
                    border-radius: 50%;
                    border-top-color: #fff;
                    animation: spin 1s ease-in-out infinite;
                }

                @keyframes spin {
                    to { transform: rotate(360deg); }
                }

            </style>
        </head>
        <body>
            <div id="chat-container">
                <div class="message">
                    <div class="message-role ai-role">HermesForge</div>
                    <div class="message-content">Hello! How can I help you code today? Highlighting text in your editor automatically includes it as context.</div>
                </div>
            </div>
            <div id="input-container">
                <div class="input-wrapper">
                    <div id="context-badge">Context: Active Selection</div>
                    <textarea id="prompt" placeholder="Ask a question or request a code change... (Cmd+Enter to send)"></textarea>
                    <div class="toolbar">
                        <button id="send-btn">Send</button>
                    </div>
                </div>
            </div>
            
            <script>
                const vscode = acquireVsCodeApi();
                const chatContainer = document.getElementById('chat-container');
                const promptInput = document.getElementById('prompt');
                const sendBtn = document.getElementById('send-btn');
                
                let currentAiContent = null;
                let isGenerating = false;

                function escapeHtml(unsafe) {
                    return unsafe
                         .replace(/&/g, "&amp;")
                         .replace(/</g, "&lt;")
                         .replace(/>/g, "&gt;")
                         .replace(/"/g, "&quot;")
                         .replace(/'/g, "&#039;");
                }

                // Simple markdown formatter to handle code blocks
                function formatMessage(text) {
                    const escaped = escapeHtml(text);
                    // Minimal formatting for code blocks
                    return escaped.replace(/&#x60;&#x60;&#x60;([\\w]*)\\n([\\s\\S]*?)&#x60;&#x60;&#x60;/g, '<pre><code>$2</code></pre>')
                                  .replace(/&#x60;([^&#x60;]+)&#x60;/g, '<code>$1</code>');
                }

                function autoResize() {
                    promptInput.style.height = 'auto';
                    promptInput.style.height = Math.min(promptInput.scrollHeight, 200) + 'px';
                }

                promptInput.addEventListener('input', autoResize);

                function sendMessage() {
                    const text = promptInput.value.trim();
                    if (!text || isGenerating) return;

                    // Add user message
                    const userMsg = document.createElement('div');
                    userMsg.className = 'message';
                    userMsg.innerHTML = '<div class="message-role user-role">You</div><div class="message-content">' + escapeHtml(text) + '</div>';
                    chatContainer.appendChild(userMsg);

                    // Prep AI message container
                    const aiMsg = document.createElement('div');
                    aiMsg.className = 'message';
                    aiMsg.innerHTML = '<div class="message-role ai-role">HermesForge</div><div class="message-content"></div>';
                    chatContainer.appendChild(aiMsg);
                    currentAiContent = aiMsg.querySelector('.message-content');

                    // Reset input
                    promptInput.value = '';
                    promptInput.style.height = 'auto';
                    vscode.postMessage({ type: 'sendPrompt', value: text });
                    scrollToBottom();
                }

                sendBtn.addEventListener('click', sendMessage);

                promptInput.addEventListener('keydown', (e) => {
                    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
                        e.preventDefault();
                        sendMessage();
                    } else if (e.key === 'Enter' && !e.shiftKey) {
                        // Prevent default newline behavior if they just hit Enter, encourage Cmd+Enter or allow default based on preference
                        // Let's make standard enter insert newline, Cmd+Enter send (like Cursor)
                    }
                });

                function scrollToBottom() {
                    chatContainer.scrollTop = chatContainer.scrollHeight;
                }

                // Temporary buffer to handle streaming formatted markdown correctly when complete
                let rawStreamContent = "";

                window.addEventListener('message', event => {
                    const msg = event.data;
                    
                    if (msg.type === 'startStream') {
                        isGenerating = true;
                        sendBtn.innerHTML = '<span class="loading"></span>';
                        sendBtn.disabled = true;
                        promptInput.disabled = true;
                        rawStreamContent = "";
                    } else if (msg.type === 'streamChunk') {
                        if (currentAiContent) {
                            rawStreamContent += msg.value;
                            // Update live, simple pre-wrap handles most streams fine until complete
                            currentAiContent.textContent = rawStreamContent;
                            scrollToBottom();
                        }
                    } else if (msg.type === 'endStream') {
                        isGenerating = false;
                        sendBtn.textContent = 'Send';
                        sendBtn.disabled = false;
                        promptInput.disabled = false;
                        promptInput.focus();
                        if (currentAiContent) {
                            // Apply final formatting
                            currentAiContent.innerHTML = formatMessage(rawStreamContent);
                        }
                        scrollToBottom();
                    } else if (msg.type === 'error') {
                        isGenerating = false;
                        sendBtn.textContent = 'Send';
                        sendBtn.disabled = false;
                        promptInput.disabled = false;
                        if (currentAiContent) {
                            currentAiContent.innerHTML = '<span style="color:red">Error: ' + escapeHtml(msg.value) + '</span>';
                        }
                        scrollToBottom();
                    }
                });
            </script>
        </body>
        </html>`;
    }
}
