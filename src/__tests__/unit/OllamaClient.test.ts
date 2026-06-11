import { describe, test, expect, beforeEach, vi, type Mock } from 'vitest';
import * as http from 'http';
import { OllamaClient } from '../../services/OllamaClient';
import { CrashShield } from '../../utils/CrashShield';

vi.mock('../../utils/CrashShield', () => ({
  CrashShield: {
    checkMemoryAndIntervene: vi.fn(() => Promise.resolve(false)),
    compressChatMessages: vi.fn((m) => m),
    createStallWatchdog: vi.fn(() => ({
      feedWatcher: vi.fn(),
      cancelWatcher: vi.fn()
    }))
  }
}));

vi.mock('http', async (importOriginal) => {
  const original = await importOriginal<typeof import('http')>();
  return {
    ...original,
    request: vi.fn()
  };
});

describe('OllamaClient Unit Tests', () => {
  let client: OllamaClient;
  let mockReq: any;
  let mockRes: any;

  beforeEach(() => {
    vi.clearAllMocks();
    client = new OllamaClient({
      baseUrl: 'http://localhost:11434',
      modelCompletion: 'qwen2.5-coder:1.5b',
      modelChat: 'qwen2.5-coder:3b'
    });

    mockReq = {
      write: vi.fn(),
      end: vi.fn(),
      destroy: vi.fn(),
      on: vi.fn()
    };

    mockRes = {
      statusCode: 200,
      on: vi.fn(),
      destroy: vi.fn()
    };

    (http.request as Mock).mockImplementation((_options, callback) => {
      if (callback) {
        callback(mockRes);
      }
      return mockReq;
    });
  });

  test('should initialize with custom configuration params', () => {
    expect(client.modelCompletion).toBe('qwen2.5-coder:1.5b');
    expect(client.modelChat).toBe('qwen2.5-coder:3b');
  });

  test('should invoke CrashShield memory check before generating completions', async () => {
    const responseJson = JSON.stringify({ response: 'console.log("hello");' });
    
    // Setup mock standard non-streaming response
    mockRes.on.mockImplementation((event: string, cb: any) => {
      if (event === 'data') {
        cb(Buffer.from(responseJson));
      }
      if (event === 'end') {
        cb();
      }
    });

    const result = await client.generateCompletion('Generate a hello world function');
    expect(result).toBe('console.log("hello");');
    expect(CrashShield.checkMemoryAndIntervene).toHaveBeenCalledWith('qwen2.5-coder:1.5b', 'http://localhost:11434');
  });

  test('should safely parse streaming chunks line by line', async () => {
    const chunk1 = JSON.stringify({ response: 'const ', done: false }) + '\n';
    const chunk2 = JSON.stringify({ response: 'foo = 42;', done: true }) + '\n';

    // Set up mock readable stream behavior using AsyncIterable symbol
    mockRes[Symbol.asyncIterator] = async function* () {
      yield Buffer.from(chunk1);
      yield Buffer.from(chunk2);
    };

    const generator = client.streamCompletion('complete code');
    const resultChunks: string[] = [];

    for await (const chunk of generator) {
      resultChunks.push(chunk);
    }

    expect(resultChunks).toEqual(['const ', 'foo = 42;']);
  });
});
