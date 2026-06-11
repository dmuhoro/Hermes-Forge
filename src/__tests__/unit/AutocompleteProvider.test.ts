import { describe, test, expect, beforeEach, afterEach, vi, type Mock } from 'vitest';
import * as vscode from 'vscode';
import { AutocompleteProvider } from '../../modules/AutocompleteProvider';
import { CrashShield } from '../../utils/CrashShield';

vi.mock('../../utils/CrashShield', () => ({
  CrashShield: {
    isAutocompletePaused: vi.fn(() => false)
  }
}));

describe('AutocompleteProvider Unit Tests', () => {
  let provider: AutocompleteProvider;
  let mockOllama: any;
  let mockDocument: any;
  let mockPosition: any;
  let mockToken: any;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();

    mockOllama = {
      streamCompletion: vi.fn()
    } as any;

    provider = new AutocompleteProvider(mockOllama);

    mockDocument = {
      offsetAt: vi.fn().mockReturnValue(50),
      getText: vi.fn().mockReturnValue('function add(a, b) {\n    return a + b;\n}\n')
    };

    mockPosition = new vscode.Position(1, 0);

    mockToken = {
      isCancellationRequested: false,
      onCancellationRequested: vi.fn().mockReturnValue({ dispose: vi.fn() })
    };
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  test('should return null immediately if CrashShield has paused autocomplete triggers', async () => {
    (CrashShield.isAutocompletePaused as Mock).mockReturnValue(true);

    const resultPromise = provider.provideInlineCompletionItems(
      mockDocument,
      mockPosition,
      {} as any,
      mockToken
    );

    vi.runAllTimers();
    const result = await resultPromise;
    expect(result).toBeNull();
    expect(mockOllama.streamCompletion).not.toHaveBeenCalled();
  });

  test('should debounce autocomplete requests and stream FIM completions', async () => {
    (CrashShield.isAutocompletePaused as Mock).mockReturnValue(false);

    const mockStream = (async function* () {
      yield 'return ';
      yield 'a + b;';
    })();

    mockOllama.streamCompletion.mockReturnValue(mockStream);

    const resultPromise = provider.provideInlineCompletionItems(
      mockDocument,
      mockPosition,
      {} as any,
      mockToken
    );

    // Fast-forward timers for standard DEBOUNCE_MS (200ms) to fire compilation
    vi.advanceTimersByTime(200);

    const result = await resultPromise;

    expect(result).not.toBeNull();
    expect(result!.items.length).toBe(1);
    expect(result!.items[0].insertText).toBe('return a + b;');
    expect(mockOllama.streamCompletion).toHaveBeenCalledWith(
      expect.stringContaining('<|fim_prefix|>'),
      expect.any(Object),
      expect.any(AbortSignal)
    );
  });
});
