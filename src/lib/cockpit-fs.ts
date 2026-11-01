// SPDX-License-Identifier: LGPL-2.1-or-later
//
// The Cockpit side of file access. Everything goes through the Cockpit bridge
// as the logged-in user; Cockpit's superuser ("try") is only used when the
// caller asks for it explicitly (a retry the user clicked).

import cockpit from 'cockpit';
import { upload } from 'cockpit-upload-helper';

import { parseFindmnt, type Mount } from './mounts';
import type { Runner, RunOptions, TempWriter } from './ops';
import { normalizePath } from './paths';

function su(opts: RunOptions): { superuser?: 'try' } {
    return opts.superuser ? { superuser: 'try' } : {};
}

/* cockpit.spawn with an argv array (never a shell). Messages are kept in the
 * C locale so that errors can be classified. */
export const cockpitRun: Runner = (argv, opts) =>
    cockpit.spawn(argv, { err: 'message', environ: ['LC_ALL=C'], ...su(opts) });

/* --- folder listing (fsinfo channel) --- */

export interface RawInfo {
    type?: string;
    size?: number;
    mtime?: number;
    target?: string;
    entries?: Record<string, RawInfo>;
    targets?: Record<string, RawInfo>;
}

export interface ListError {
    problem?: string;
    message?: string;
    errno?: string;
}

type Json = null | boolean | number | string | Json[] | { [key: string]: Json };

function isDict(v: Json): v is { [key: string]: Json } {
    return v !== null && typeof v === 'object' && !Array.isArray(v);
}

/* RFC 7396 JSON merge patch: fsinfo sends updates as patches. */
export function mergePatch(current: Json, patch: Json): Json {
    if (!isDict(patch))
        return patch;
    const out: { [key: string]: Json } = isDict(current) ? { ...current } : {};
    for (const [k, v] of Object.entries(patch)) {
        if (v === null)
            delete out[k];
        else
            out[k] = mergePatch(out[k] ?? null, v);
    }
    return out;
}

/* Watch a folder; `onChange` gets the full listing on every change. Returns a
 * function that closes the channel. */
export function watchFolder(path: string, opts: RunOptions,
    onChange: (info: RawInfo | null, error: ListError | null) => void): () => void {
    let state: Json = null;
    const channel = cockpit.channel({
        payload: 'fsinfo',
        path: normalizePath(path),
        attrs: ['type', 'size', 'mtime', 'target', 'targets', 'entries'],
        watch: true,
        ...su(opts),
    });
    channel.addEventListener('message', (_ev, payload: string) => {
        state = mergePatch(state, JSON.parse(payload) as Json);
        if (isDict(state) && !state.partial) {
            if (state.info)
                onChange(state.info as RawInfo, null);
            else if (state.error)
                onChange(null, state.error as ListError);
        }
    });
    channel.addEventListener('close', (_ev, message) => {
        if (message.problem)
            onChange(null, { problem: String(message.problem), message: String(message.message ?? message.problem) });
    });
    return () => channel.close();
}

/* One-shot listing (used by the folder picker). */
export function readFolder(path: string, opts: RunOptions = {}): Promise<RawInfo> {
    return new Promise((resolve, reject) => {
        let done = false;
        const close = watchFolder(path, opts, (info, error) => {
            if (done)
                return;
            done = true;
            // closing from inside the handler is fine; the channel is done anyway
            window.setTimeout(close, 0);
            if (info)
                resolve(info);
            else
                reject(error);
        });
    });
}

/* Follow a symlink inside a listing to the entry it points to (null when
 * broken or looping). */
export function resolveEntry(info: RawInfo, name: string): RawInfo | null {
    const entries = info.entries ?? {};
    const targets = info.targets ?? {};
    let entry: RawInfo | null = entries[name] ?? null;
    for (let i = 0; i < 40; i++) {
        const target: string | undefined = entry?.target;
        if (!target)
            return entry;
        if (target === '.')
            return info;
        entry = entries[target] ?? targets[target] ?? null;
    }
    return null;
}

/* --- mounts --- */

export async function loadMounts(): Promise<Mount[]> {
    const out = await cockpit.spawn(['findmnt', '--json', '--list', '--output', 'TARGET,FSTYPE,SOURCE'],
                                    { err: 'message', environ: ['LC_ALL=C'] });
    return parseFindmnt(out);
}

/* --- upload / download --- */

/* Writes a browser File to a new path through the fsreplace1 channel (with
 * flow control). The tag "-" makes the bridge refuse to replace an existing
 * file, so the temporary name is never something that already exists. */
export function fileWriter(file: Blob, opts: RunOptions, progress?: (bytes: number) => void,
    signal?: AbortSignal): TempWriter {
    return async (tempPath: string) => {
        try {
            await upload(tempPath, file, progress, signal, { tag: '-', ...su(opts) });
        } catch (err) {
            // the upload helper only passes on cockpit.message(problem); get the
            // problem code back so that the error can be classified
            const message = String((err as Error)?.message ?? err);
            for (const problem of ['access-denied', 'not-found']) {
                if (message === cockpit.message(problem))
                    throw Object.assign(new Error(message), { problem });
            }
            throw err;
        }
    };
}

function base64Utf8(text: string): string {
    const bytes = new TextEncoder().encode(text);
    let bin = '';
    for (const b of bytes)
        bin += String.fromCharCode(b);
    return window.btoa(bin);
}

/* Download a file through a Cockpit external channel: the browser streams it
 * straight from the bridge, nothing is buffered in the page. */
export function downloadFile(path: string, name: string, size: number, opts: RunOptions = {}) {
    const query = base64Utf8(JSON.stringify({
        payload: 'fsread1',
        binary: 'raw',
        path: normalizePath(path),
        max_read_size: size,
        ...su(opts),
        external: {
            'content-disposition': `attachment; filename*=UTF-8''${encodeURIComponent(name)}`,
            'content-type': 'application/octet-stream',
        },
    }));
    const prefix = new URL(cockpit.transport.uri('channel/' + cockpit.transport.csrf_token)).pathname;
    const a = document.createElement('a');
    a.href = `${prefix}?${query}`;
    a.download = name;
    a.style.display = 'none';
    document.body.appendChild(a);
    a.click();
    a.remove();
}

/* --- per-user settings (~/.config/pitexplorer/settings.json) --- */

export interface Shortcut {
    name: string;
    path: string;
}

export interface Settings {
    // null: not configured yet, use the defaults
    shortcuts: Shortcut[] | null;
    locations: Shortcut[];
}

const MAX_SHORTCUTS = 50;

function cleanShortcuts(list: unknown): Shortcut[] {
    if (!Array.isArray(list))
        return [];
    const out: Shortcut[] = [];
    for (const s of list.slice(0, MAX_SHORTCUTS)) {
        if (typeof s?.name !== 'string' || typeof s?.path !== 'string')
            continue;
        const name = s.name.trim().slice(0, 64);
        try {
            if (name)
                out.push({ name, path: normalizePath(s.path) });
        } catch {
            // an invalid stored path is dropped
        }
    }
    return out;
}

export function parseSettings(data: unknown): Settings {
    const d = (data ?? {}) as { shortcuts?: unknown, locations?: unknown };
    return {
        shortcuts: Array.isArray(d.shortcuts) ? cleanShortcuts(d.shortcuts) : null,
        locations: cleanShortcuts(d.locations),
    };
}

async function settingsFile() {
    const user = await cockpit.user();
    if (!user.home?.startsWith('/'))
        throw new Error('cannot determine the home directory');
    return { dir: `${normalizePath(user.home)}/.config/pitexplorer`, file: 'settings.json' };
}

export async function loadSettings(): Promise<Settings> {
    const { dir, file } = await settingsFile();
    const handle = cockpit.file(`${dir}/${file}`, { syntax: JSON });
    try {
        return parseSettings(await handle.read());
    } catch {
        return parseSettings(null);
    } finally {
        handle.close();
    }
}

export async function saveSettings(settings: Settings): Promise<void> {
    const { dir, file } = await settingsFile();
    await cockpit.spawn(['mkdir', '-p', '-m', '0700', '--', dir], { err: 'message' });
    const handle = cockpit.file(`${dir}/${file}`, { syntax: JSON });
    try {
        await handle.replace(settings);
    } finally {
        handle.close();
    }
}
