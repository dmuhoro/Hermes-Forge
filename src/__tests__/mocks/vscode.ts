import { vi } from 'vitest';

export class Position {
    constructor(public readonly line: number, public readonly character: number) {}
}

export class Range {
    constructor(
        public readonly start: Position,
        public readonly end: Position
    ) {}
}

export class Selection extends Range {
    constructor(
        public readonly anchor: Position,
        public readonly active: Position
    ) {
        super(anchor, active);
    }
}

export class Uri {
    public readonly scheme: string = 'file';
    public readonly authority: string = '';
    public readonly path: string;
    public readonly query: string = '';
    public readonly fragment: string = '';
    
    private constructor(public readonly fsPath: string) {
        this.path = fsPath;
    }

    public static file(filePath: string): Uri {
        return new Uri(filePath);
    }

    public toString(): string {
        return `file://${this.path}`;
    }
}

export class DocumentSymbol {
    constructor(
        public name: string,
        public detail: string,
        public kind: number,
        public range: Range,
        public selectionRange: Range,
        public children: DocumentSymbol[] = []
    ) {}
}

export class EventEmitter<T> {
    private listeners: ((e: T) => any)[] = [];
    public event = (listener: (e: T) => any) => {
        this.listeners.push(listener);
        return {
            dispose: () => {
                this.listeners = this.listeners.filter(l => l !== listener);
            }
        };
    };
    public fire(data: T): void {
        this.listeners.forEach(l => l(data));
    }
}

export class Disposable {
    constructor(private callOnDispose: () => any) {}
    public dispose() {
        this.callOnDispose();
    }
}

export class InlineCompletionItem {
    constructor(public insertText: string, public range?: Range) {}
}

export class InlineCompletionList {
    constructor(public items: InlineCompletionItem[]) {}
}

export enum StatusBarAlignment {
    Left = 1,
    Right = 2
}

// Mock elements tracking state using Vitest's vi.fn()
export const mockOutputChannel = {
    appendLine: vi.fn(),
    append: vi.fn(),
    show: vi.fn(),
    clear: vi.fn(),
    dispose: vi.fn()
};

export const mockTextEditor = {
    document: {
        fileName: '/workspace/foo.ts',
        getText: vi.fn((_range?: Range) => '// Mock text in editor\nfunction add(a, b) { return a + b; }'),
        lineCount: 10,
        uri: Uri.file('/workspace/foo.ts')
    },
    selection: new Selection(new Position(0, 0), new Position(0, 0)),
    selections: [new Selection(new Position(0, 0), new Position(0, 0))]
};

export const window = {
    createOutputChannel: vi.fn(() => mockOutputChannel),
    showWarningMessage: vi.fn().mockResolvedValue('Approve Run'),
    showErrorMessage: vi.fn().mockResolvedValue(undefined),
    showInformationMessage: vi.fn().mockResolvedValue(undefined),
    activeTextEditor: mockTextEditor,
    visibleTextEditors: [mockTextEditor],
    createStatusBarItem: vi.fn(() => ({
        show: vi.fn(),
        hide: vi.fn(),
        dispose: vi.fn(),
        text: '',
        tooltip: '',
        command: ''
    }))
};

export const workspace = {
    workspaceFolders: [
        {
            uri: Uri.file('/workspace'),
            name: 'workspace',
            index: 0
        }
    ],
    findFiles: vi.fn().mockResolvedValue([Uri.file('/workspace/foo.ts')]),
    openTextDocument: vi.fn().mockImplementation(async (uri: Uri) => ({
        fileName: uri.fsPath,
        getText: vi.fn(() => '// Mock file content\nfunction hello() {}'),
        lineCount: 15,
        uri: uri
    }))
};

export const commands = {
    executeCommand: vi.fn().mockImplementation(async (commandName: string, ..._args: any[]) => {
        if (commandName === 'vscode.executeDocumentSymbolProvider') {
            return [
                new DocumentSymbol(
                    'hello',
                    '',
                    11,
                    new Range(new Position(0, 0), new Position(5, 0)),
                    new Range(new Position(0, 0), new Position(1, 0))
                )
            ];
        }
        return undefined;
    }),
    registerCommand: vi.fn().mockImplementation((_id, _cb) => new Disposable(() => {}))
};
