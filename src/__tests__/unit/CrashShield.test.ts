import { describe, test, expect, beforeEach, afterEach, vi, type Mock } from 'vitest';
import * as os from 'os';
import * as http from 'http';
import * as vscode from 'vscode';
import { CrashShield, ChatMessage } from '../../utils/CrashShield';

vi.mock('os', () => ({
  freemem: vi.fn(),
  totalmem: vi.fn()
}));

vi.mock('http', async (importOriginal) => {
  const original = await importOriginal<typeof import('http')>();
  return {
    ...original,
    request: vi.fn()
  };
});

describe('CrashShield Unit Tests', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  test('should default to autocomplete unpaused and turn on pause correctly', () => {
    expect(CrashShield.isAutocompletePaused()).toBe(false);
    CrashShield.pauseAutocomplete();
    expect(CrashShield.isAutocompletePaused()).toBe(true);

    // Fast-forward 30 seconds to test auto recovery safety gate
    vi.advanceTimersByTime(30000);
    expect(CrashShield.isAutocompletePaused()).toBe(false);
  });

  test('should check memory limits and trigger warnings when freemem is dangerously low', async () => {
    (os.freemem as Mock).mockReturnValue(500 * 1024 * 1024); // 500 MB (below 1.2 GB limit)
    (os.totalmem as Mock).mockReturnValue(8 * 1024 * 1024 * 1024); // 8 GB

    const mockReq = { write: vi.fn(), end: vi.fn() };
    (http.request as Mock).mockImplementation((_options, callback) => {
      const mockRes = { on: vi.fn() };
      mockRes.on.mockImplementation((event, cb) => {
        if (event === 'end') { cb(); }
      });
      if (callback) { callback(mockRes); }
      return mockReq;
    });

    const didIntervene = await CrashShield.checkMemoryAndIntervene('hermes3:8b', 'http://localhost:11434');
    expect(didIntervene).toBe(true);
    expect(CrashShield.isAutocompletePaused()).toBe(true);
    expect(vscode.window.showWarningMessage).toHaveBeenCalled();
  });

  test('should return false other times when freemem is normal', async () => {
    (os.freemem as Mock).mockReturnValue(4 * 1024 * 1024 * 1024); // 4 GB (safe)
    (os.totalmem as Mock).mockReturnValue(8 * 1024 * 1024 * 1024);

    const didIntervene = await CrashShield.checkMemoryAndIntervene('hermes3:8b', 'http://localhost:11434');
    expect(didIntervene).toBe(false);
  });

  test('should slice the chat dialogue history down to fit constraints and keep system messages', () => {
    const messages: ChatMessage[] = [
      { role: 'system', content: 'You are an AI assistant.' },
      { role: 'user', content: 'Message 1' },
      { role: 'user', content: 'Message 2' },
      { role: 'user', content: 'Message 3' }
    ];

    // Cap at extremely low length of 25 characters
    const processed = CrashShield.compressChatMessages(messages, 45);
    
    // System message should be preserved, and only the newest message should be preserved
    expect(processed[0].role).toBe('system');
    expect(processed[processed.length - 1].content).toBe('Message 3');
  });

  test('should trigger abort via local controller watchdog when stream stalls', () => {
    const controller = new AbortController();
    const watchdog = CrashShield.createStallWatchdog(controller, 'Test Stall Event');

    expect(controller.signal.aborted).toBe(false);

    // Feed watcher should reset timer
    watchdog.feedWatcher();
    vi.advanceTimersByTime(5000);
    expect(controller.signal.aborted).toBe(false);

    // Exceeding 12 seconds
    vi.advanceTimersByTime(8000); // 5s + 8s = 13s (> 12s)
    expect(controller.signal.aborted).toBe(true);
    expect(vscode.window.showErrorMessage).toHaveBeenCalled();
    
    watchdog.cancelWatcher();
  });
});