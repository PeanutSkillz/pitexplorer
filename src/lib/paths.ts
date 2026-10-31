// SPDX-License-Identifier: LGPL-2.1-or-later
//
// Path and file name handling. Everything here is pure so that it can be unit
// tested; every path that reaches a command or channel goes through
// normalizePath() or childPath() first.

export type NameProblem = 'empty' | 'dot' | 'slash' | 'nul' | 'control' | 'too-long';

const MAX_NAME_BYTES = 255;

/* Why a single file or folder name is not acceptable, or null when it is.
 * A name is one path component: no "/", not "." or "..", no NUL. Control
 * characters (newlines etc.) are refused as well, as they make names
 * ambiguous in listings and dialogs. */
export function nameProblem(name: string): NameProblem | null {
    if (name.length === 0)
        return 'empty';
    if (name.includes('\0'))
        return 'nul';
    if (name.includes('/'))
        return 'slash';
    if (name === '.' || name === '..')
        return 'dot';
    // eslint-disable-next-line no-control-regex
    if (/[\x01-\x1f\x7f]/.test(name))
        return 'control';
    if (new TextEncoder().encode(name).length > MAX_NAME_BYTES)
        return 'too-long';
    return null;
}

export class PathError extends Error {
    constructor(message: string) {
        super(message);
        this.name = 'PathError';
    }
}

/* Normalize an absolute path: collapse duplicate slashes, resolve "." and
 * "..", drop a trailing slash. ".." never goes above "/". Relative paths and
 * NUL bytes are refused. */
export function normalizePath(path: string): string {
    if (typeof path !== 'string' || !path.startsWith('/'))
        throw new PathError(`not an absolute path: ${JSON.stringify(path)}`);
    if (path.includes('\0'))
        throw new PathError('path contains a NUL byte');

    const out: string[] = [];
    for (const part of path.split('/')) {
        if (part === '' || part === '.')
            continue;
        if (part === '..')
            out.pop();
        else
            out.push(part);
    }
    return '/' + out.join('/');
}

/* The path of entry `name` inside folder `dir`. The name is validated, so the
 * result is always a direct child of the normalized folder. */
export function childPath(dir: string, name: string): string {
    const problem = nameProblem(name);
    if (problem)
        throw new PathError(`invalid name (${problem}): ${JSON.stringify(name)}`);
    const base = normalizePath(dir);
    return base === '/' ? `/${name}` : `${base}/${name}`;
}

export function basename(path: string): string {
    const p = normalizePath(path);
    return p === '/' ? '/' : p.slice(p.lastIndexOf('/') + 1);
}

export function dirname(path: string): string {
    const p = normalizePath(path);
    const i = p.lastIndexOf('/');
    return i <= 0 ? '/' : p.slice(0, i);
}

/* Whether `path` is `ancestor` itself or lies below it. */
export function isWithin(path: string, ancestor: string): boolean {
    const p = normalizePath(path);
    const a = normalizePath(ancestor);
    return a === '/' || p === a || p.startsWith(a + '/');
}

/* Breadcrumb parts: [{ name: '/', path: '/' }, { name: 'DATA', path: '/DATA' }, ...] */
export function breadcrumbs(path: string): { name: string, path: string }[] {
    const p = normalizePath(path);
    const crumbs = [{ name: '/', path: '/' }];
    let current = '';
    for (const part of p.split('/').filter(Boolean)) {
        current += '/' + part;
        crumbs.push({ name: part, path: current });
    }
    return crumbs;
}

/* Paths that may never be deleted, moved or renamed: "/", "/DATA" and every
 * mount point. */
export function isProtected(path: string, mountPoints: Iterable<string>): boolean {
    const p = normalizePath(path);
    if (p === '/' || p === '/DATA')
        return true;
    for (const m of mountPoints) {
        if (normalizePath(m) === p)
            return true;
    }
    return false;
}

/* Name of the temporary file an upload is written to before it is renamed to
 * its final name. Hidden, recognizable and unique. */
export function uploadTempName(name: string, random: string): string {
    const tmp = `.${name}.pitexplorer-upload-${random}.part`;
    // very long names cannot get a suffix; fall back to a short one
    return nameProblem(tmp) ? `.pitexplorer-upload-${random}.part` : tmp;
}
