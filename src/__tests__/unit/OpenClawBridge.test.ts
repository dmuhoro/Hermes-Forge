import { describe, test, expect, beforeEach, vi } from 'vitest';
import * as vscode from 'vscode';
import * as http from 'http';
import { OpenClawBridge } from '../../services/OpenClawBridge';
import { OllamaClient } from '../../services/OllamaClient';

const mockServerInstance = {
    listen: vi.fn((port, host, cb) => {
        if (cb) cb();
        return mockServerInstance;
    }),
    close: vi.fn((cb) => {
        if (cb) cb();
        return mockServerInstance;
    }),
    on: vi.fn()
};

vi.mock('http', async (importOriginal) => {
    const original = await importOriginal<typeof import('http')>();
    return {
        ...original,
        createServer: vi.fn(() => mockServerInstance)
    };
});

vi.mock('fs/promises', () => ({
    readFile: vi.fn().mockResolvedValue('{"key": "value"}'),
    writeFile: vi.fn().mockResolvedValue(undefined),
    mkdir: vi.fn().mockResolvedValue(undefined)
}));

describe('OpenClawBridge Unit Tests', () => {
    let ollama: OllamaClient;
    let bridge: OpenClawBridge;

    beforeEach(() => {
        vi.clearAllMocks();
        
        ollama = new OllamaClient({
            baseUrl: 'http://localhost:11434',
            modelCompletion: 'qwen2.5-coder:1.5b',
            modelChat: 'hermes3:8b'
        });

        // Use custom getStatus mock for ollama to return mock status
        vi.spyOn(ollama, 'getStatus').mockReturnValue({
            connected: true,
            models: ['qwen2.5-coder:1.5b', 'hermes3:8b'],
            completionModelExists: true,
            chatModelExists: true
        });

        bridge = OpenClawBridge.getInstance(ollama);
    });

    test('should act as a singleton instance', () => {
        const instance2 = OpenClawBridge.getInstance(ollama);
        expect(bridge).toBe(instance2);
    });

    test('should maintain local buffer logs of connection sequences', () => {
        const logs = bridge.getLogs();
        expect(Array.isArray(logs)).toBe(true);
    });

    test('should handle active configurations correctly', async () => {
        // Mock active setting retrieval
        vi.spyOn(vscode.workspace, 'getConfiguration').mockReturnValue({
            get: vi.fn((key: string) => {
                if (key === 'nodePort') return 11435;
                if (key === 'nodeEnabled') return true;
                return undefined;
            })
        } as any);

        await bridge.start();

        expect(http.createServer).toHaveBeenCalled();
        expect(mockServerInstance.listen).toHaveBeenCalledWith(11435, '127.0.0.1', expect.any(Function));

        await bridge.stop();
        expect(mockServerInstance.close).toHaveBeenCalled();
    });
});
