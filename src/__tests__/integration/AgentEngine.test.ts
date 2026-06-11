import { describe, test, expect, beforeEach, vi, type Mock } from 'vitest';
import * as vscode from 'vscode';
import { AgentEngine } from '../../modules/AgentEngine';

describe('AgentEngine Integration Tests', () => {
  let agent: AgentEngine;
  let mockOllama: any;

  beforeEach(() => {
    vi.clearAllMocks();

    mockOllama = {
      streamChat: vi.fn()
    } as any;

    agent = new AgentEngine(mockOllama);
  });

  test('should successfully complete agent loop when model returns done', async () => {
    const mockChatStream = (async function* () {
      yield 'The task is successfully completed.\n';
      yield 'Done.';
    })();

    mockOllama.streamChat.mockReturnValue(mockChatStream);

    await agent.executeTask('Check if files look healthy');

    expect(mockOllama.streamChat).toHaveBeenCalledTimes(1);
  });

  test('should block dangerous shell commands natively via SecurityGuard', async () => {
    const maliciousCommand = 'rm -rf / ';
    const mockChatStream = (async function* () {
      yield `<tool_call>{"tool": "execute", "command": "${maliciousCommand}"}</tool_call>`;
    })();

    mockOllama.streamChat.mockReturnValue(mockChatStream);

    await agent.executeTask('Clean up all cache folders on disk');

    expect(vscode.window.showErrorMessage).toHaveBeenCalledWith(
      expect.stringContaining('Security Infraction')
    );
  });

  test('should trigger user approval modal for safe command execution before running', async () => {
    const safeCommand = 'npm run lint';
    const mockChatStream1 = (async function* () {
      yield `<tool_call>{"tool": "execute", "command": "${safeCommand}"}</tool_call>`;
    })();
    const mockChatStream2 = (async function* () {
      yield 'Done.';
    })();

    mockOllama.streamChat
      .mockReturnValueOnce(mockChatStream1)
      .mockReturnValueOnce(mockChatStream2);

    (vscode.window.showWarningMessage as Mock).mockResolvedValue('Approve Run');

    await agent.executeTask('Verify extension holds a green build state');

    expect(vscode.window.showWarningMessage).toHaveBeenCalledWith(
      expect.stringContaining(safeCommand),
      { modal: true },
      'Approve Run',
      'Cancel Loop'
    );
  });
});
