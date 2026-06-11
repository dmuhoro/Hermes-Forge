import * as vscode from 'vscode';
import { OllamaClient } from '../services/OllamaClient';
import { CrashShield } from '../utils/CrashShield';
import { logger } from '../utils/Logger';

export class AutocompleteProvider implements vscode.InlineCompletionItemProvider {
    private debounceTimer: NodeJS.Timeout | null = null;
    
    // Strict debouncing to prevent hammering the local instance
    private readonly DEBOUNCE_MS = 200; 
    private readonly FAST_MODEL = 'qwen2.5-coder:1.5b';
    private readonly MAX_CONTEXT_LENGTH = 3000;

    constructor(private ollama: OllamaClient) {}

    public provideInlineCompletionItems(
        document: vscode.TextDocument,
        position: vscode.Position,
        _context: vscode.InlineCompletionContext,
        token: vscode.CancellationToken
    ): Promise<vscode.InlineCompletionList | null> {
        
        return new Promise((resolve) => {
            // Cancel execution if CrashShield is pausing autocomplete triggers to preserve host operating stability
            if (CrashShield.isAutocompletePaused()) {
                return resolve(null);
            }

            // Cancel any pending debounce timer
            if (this.debounceTimer) {
                clearTimeout(this.debounceTimer);
            }

            this.debounceTimer = setTimeout(async () => {
                // If user typed more characters before execution, abort
                if (token.isCancellationRequested) {
                    return resolve(null);
                }

                const abortController = new AbortController();
                const disposable = token.onCancellationRequested(() => {
                    abortController.abort();
                });

                // Context extraction: 75% prefix, 25% suffix of MAX_CONTEXT_LENGTH
                const maxPrefixLength = Math.floor(this.MAX_CONTEXT_LENGTH * 0.75);
                const maxSuffixLength = Math.floor(this.MAX_CONTEXT_LENGTH * 0.25);

                const currentOffset = document.offsetAt(position);
                const text = document.getText();
                
                // Extract prefix
                const prefixStart = Math.max(0, currentOffset - maxPrefixLength);
                const prefix = text.substring(prefixStart, currentOffset);
                
                // Extract suffix
                const suffixEnd = Math.min(text.length, currentOffset + maxSuffixLength);
                const suffix = text.substring(currentOffset, suffixEnd);

                // Construct a standard FIM prompt tailored for code models
                // Qwen uses standard <|fim_prefix|> tokens natively
                const prompt = `<|fim_prefix|>${prefix}<|fim_suffix|>${suffix}<|fim_middle|>`;

                try {
                    let completionText = '';
                    
                    const stream = this.ollama.streamCompletion(prompt, { 
                        model: this.FAST_MODEL,
                        num_predict: 64, // Keep inline completions short to minimize visual jumping
                        temperature: 0.1,
                        stop: ['<|file_separator|>', '<|endoftext|>', '<|fim_'] // Safe boundaries
                    }, abortController.signal);
                    
                    // Consume the AsyncIterable stream
                    for await (const chunk of stream) {
                        // Abort immediately midway if user continues typing
                        if (token.isCancellationRequested) {
                            abortController.abort();
                            disposable.dispose();
                            return resolve(null);
                        }
                        completionText += chunk;
                    }
                    
                    disposable.dispose();

                    if (!completionText.trim()) {
                        return resolve(null);
                    }

                    // Return the completion payload formatted for VS Code
                    resolve(new vscode.InlineCompletionList([
                        new vscode.InlineCompletionItem(
                            completionText,
                            new vscode.Range(position, position)
                        )
                    ]));

                } catch (error: any) {
                    disposable.dispose();
                    if (error.message !== 'Request aborted' && error.message !== 'Stream aborted') {
                        logger.error('[HermesForge] Error fetching inline completion', error);
                    }
                    resolve(null); // Resolve to null to silently fail and allow graceful continuation
                }
            }, this.DEBOUNCE_MS);
        });
    }
}
