// SPDX-License-Identifier: LGPL-2.1-or-later
//
// File operations. Each one runs a fixed program with an argv array; there is
// never a shell. Paths are normalized and names validated before use, and
// "--" ends the options in front of every path argument.
//
// The runner is passed in: in Cockpit it is cockpit.spawn() (see runner.ts),
// in the unit tests it is a Node child process, so the same code is tested
// against a real file system.

import { childPath, dirname, isProtected, isWithin, nameProblem, normalizePath, PathError, uploadTempName } from './paths';

export interface RunOptions {
    // run through Cockpit's superuser channel ("try"); only for explicit retries
    superuser?: boolean;
}

export type Runner = (argv: string[], options: RunOptions) => Promise<string>;

export type OpErrorCode = 'denied' | 'not-found' | 'exists' | 'protected' | 'contains-mount' |
    'invalid-name' | 'into-itself' | 'other';

export class OpError extends Error {
    code: OpErrorCode;
    path: string;
    // for batch operations: the entry the error belongs to
    source?: string;

    constructor(code: OpErrorCode, path: string, detail: string) {
        super(detail);
        this.name = 'OpError';
        this.code = code;
        this.path = path;
    }
}

/* Map a failed command (messages are in the C locale, see runner.ts) to an
 * error code the UI can show as a translated message. */
export function classify(err: unknown, path: string): OpError {
    if (err instanceof OpError)
        return err;
    if (err instanceof PathError)
        return new OpError('invalid-name', path, err.message);
    const e = err as { message?: string, problem?: string } | null;
    const msg = String(e?.message ?? err ?? '');
    let code: OpErrorCode = 'other';
    if (e?.problem === 'access-denied' || /Permission denied|Operation not permitted|Read-only file system/.test(msg))
        code = 'denied';
    else if (/No such file or directory/.test(msg))
        code = 'not-found';
    else if (/File exists|not replacing|Directory not empty/.test(msg))
        code = 'exists';
    return new OpError(code, path, msg.trim());
}

async function attempt<T>(path: string, fn: () => Promise<T>): Promise<T> {
    try {
        return await fn();
    } catch (err) {
        throw classify(err, path);
    }
}

export async function exists(run: Runner, path: string, opts: RunOptions = {}): Promise<boolean> {
    try {
        await run(['stat', '--printf=%n', '--', normalizePath(path)], opts);
        return true;
    } catch (err) {
        const e = classify(err, path);
        if (e.code === 'not-found')
            return false;
        throw e;
    }
}

function checkName(dir: string, name: string): string {
    if (nameProblem(name))
        throw new OpError('invalid-name', `${dir}/${name}`, `invalid name: ${JSON.stringify(name)}`);
    return childPath(dir, name);
}

function checkMovable(path: string, mountPoints: string[]): string {
    const p = normalizePath(path);
    if (isProtected(p, mountPoints))
        throw new OpError('protected', p, 'protected path');
    return p;
}

/* `mv -n` reports a conflict with an error on coreutils >= 9.2 but silently
 * does nothing on older versions; check that the source is gone either way. */
async function moveNoClobber(run: Runner, src: string, dst: string, opts: RunOptions) {
    await run(['mv', '-n', '-T', '--', src, dst], opts);
    if (await exists(run, src, opts))
        throw new OpError('exists', dst, `not replacing '${dst}'`);
}

export async function createFolder(run: Runner, dir: string, name: string, opts: RunOptions = {}): Promise<string> {
    const path = checkName(dir, name);
    await attempt(path, () => run(['mkdir', '--', path], opts));
    return path;
}

export async function renameEntry(run: Runner, path: string, newName: string, mountPoints: string[],
    opts: RunOptions = {}): Promise<string> {
    const src = checkMovable(path, mountPoints);
    const dst = checkName(dirname(src), newName);
    if (dst === src)
        return dst;
    await attempt(dst, () => moveNoClobber(run, src, dst, opts));
    return dst;
}

/* Move entries into folder `target`; existing entries there are never
 * replaced. Returns the errors per entry; the others are moved. */
export async function moveEntries(run: Runner, paths: string[], target: string, mountPoints: string[],
    opts: RunOptions = {}): Promise<OpError[]> {
    const dir = normalizePath(target);
    const errors: OpError[] = [];
    for (const path of paths) {
        try {
            const src = checkMovable(path, mountPoints);
            if (isWithin(dir, src))
                throw new OpError('into-itself', src, 'cannot move a folder into itself');
            const dst = childPath(dir, src.slice(src.lastIndexOf('/') + 1));
            if (dst !== src)
                await attempt(dst, () => moveNoClobber(run, src, dst, opts));
        } catch (err) {
            const e = classify(err, path);
            e.source = path;
            errors.push(e);
        }
    }
    return errors;
}

/* Number of entries below a folder (on the same file system), shown in the
 * delete confirmation. 0 for files. */
export async function countEntries(run: Runner, path: string, opts: RunOptions = {}): Promise<number> {
    const p = normalizePath(path);
    // find takes no "--"; the path is absolute, so it can never be read as an option
    const out = await attempt(p, () => run(['find', p, '-xdev', '-mindepth', '1', '-printf', '.'], opts));
    return out.length;
}

/* Refuse to delete protected paths and anything that has a mount point inside
 * it, before anything is removed. */
export function checkDeletable(paths: string[], mountPoints: string[]): string[] {
    return paths.map(path => {
        const p = checkMovable(path, mountPoints);
        if (mountPoints.some(m => isWithin(m, p)))
            throw new OpError('contains-mount', p, 'contains a mount point');
        return p;
    });
}

export async function deleteEntries(run: Runner, paths: string[], mountPoints: string[],
    opts: RunOptions = {}): Promise<OpError[]> {
    const checked = checkDeletable(paths, mountPoints);
    const errors: OpError[] = [];
    for (const p of checked) {
        try {
            // --one-file-system: never descend into another file system
            await attempt(p, () => run(['rm', '-r', '--one-file-system', '--preserve-root', '--', p], opts));
        } catch (err) {
            const e = classify(err, p);
            e.source = p;
            errors.push(e);
        }
    }
    return errors;
}

/* Writes the uploaded content to the given (new) path. */
export type TempWriter = (tempPath: string) => Promise<void>;

/* Upload: write to a hidden temporary name in the target folder, then rename
 * it to the final name. An existing file is only replaced when `overwrite`
 * is set (after the user confirmed it). The temporary file is removed when
 * anything fails. */
export async function uploadFile(run: Runner, write: TempWriter, dir: string, name: string, overwrite: boolean,
    random: string, opts: RunOptions = {}): Promise<string> {
    const dst = checkName(dir, name);
    const tmp = childPath(dir, uploadTempName(name, random));
    try {
        await write(tmp);
        if (overwrite)
            await run(['mv', '-f', '-T', '--', tmp, dst], opts);
        else
            await moveNoClobber(run, tmp, dst, opts);
    } catch (err) {
        await run(['rm', '-f', '--', tmp], opts).catch(() => undefined);
        throw classify(err, dst);
    }
    return dst;
}
