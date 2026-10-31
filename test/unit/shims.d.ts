// SPDX-License-Identifier: LGPL-2.1-or-later
//
// Minimal type declarations for the Node and QUnit APIs used by the unit
// tests, so that no extra @types packages are needed.

declare module 'node:fs' {
    export function readFileSync(path: string, encoding: 'utf8'): string;
    export function readdirSync(path: string): string[];
    export function statSync(path: string): { isDirectory(): boolean };
    export function mkdtempSync(prefix: string): string;
    export function mkdirSync(path: string, options?: { recursive?: boolean }): void;
    export function writeFileSync(path: string, data: string, options?: { flag?: string }): void;
    export function existsSync(path: string): boolean;
    export function rmSync(path: string, options?: { recursive?: boolean, force?: boolean }): void;
}

declare module 'node:os' {
    export function tmpdir(): string;
}

declare module 'node:child_process' {
    export function execFile(file: string, args: string[], options: { env: Record<string, string> },
        callback: (error: Error | null, stdout: string, stderr: string) => void): void;
}

declare const process: { env: Record<string, string> };

declare module 'qunit' {
    interface Assert {
        ok(value: unknown, message?: string): void;
        notOk(value: unknown, message?: string): void;
        equal(actual: unknown, expected: unknown, message?: string): void;
        deepEqual(actual: unknown, expected: unknown, message?: string): void;
        throws(block: () => void, expected?: RegExp | (new (...args: never[]) => Error), message?: string): void;
    }
    interface QUnitStatic {
        module(name: string, callback: () => void): void;
        test(name: string, callback: (assert: Assert) => void | Promise<void>): void;
    }
    const QUnit: QUnitStatic;
    export default QUnit;
}
