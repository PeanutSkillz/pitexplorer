// SPDX-License-Identifier: LGPL-2.1-or-later
//
// Display helpers without Cockpit dependencies (unit tested).

/* "27 oktober om 23:30": day and month in the given language, the year only
 * when it is not the current one. `atTemplate` is the translated "$0 at $1". */
export function formatModified(mtimeSeconds: number, lang: string, atTemplate: string, now = new Date()): string {
    const d = new Date(mtimeSeconds * 1000);
    let day: string;
    let time: string;
    try {
        const sameYear = d.getFullYear() === now.getFullYear();
        day = new Intl.DateTimeFormat(lang, {
            day: 'numeric', month: 'long', ...sameYear ? {} : { year: 'numeric' }
        }).format(d);
        time = new Intl.DateTimeFormat(lang, { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(d);
    } catch {
        return d.toISOString();
    }
    return atTemplate.replace('$0', day).replace('$1', time);
}

export type EntryKind = 'folder' | 'image' | 'video' | 'audio' | 'archive' | 'pdf' | 'code' | 'text' | 'file';

const EXTENSIONS: Record<string, EntryKind> = {};
function register(kind: EntryKind, exts: string) {
    for (const e of exts.split(' '))
        EXTENSIONS[e] = kind;
}
register('image', 'png jpg jpeg gif webp bmp svg tif tiff heic heif avif ico raw cr2 nef');
register('video', 'mp4 mkv avi mov wmv webm m4v mpg mpeg ts flv 3gp');
register('audio', 'mp3 flac wav ogg oga opus m4a aac wma');
register('archive', 'zip tar gz tgz bz2 xz zst 7z rar deb rpm iso img');
register('pdf', 'pdf');
register('code', 'js ts tsx jsx py sh json yml yaml xml html css scss c h cpp go rs java php rb toml ini conf');
register('text', 'txt md log csv rst doc docx odt rtf');

export function entryKind(name: string, isDir: boolean): EntryKind {
    if (isDir)
        return 'folder';
    const dot = name.lastIndexOf('.');
    if (dot <= 0)
        return 'file';
    return EXTENSIONS[name.slice(dot + 1).toLowerCase()] ?? 'file';
}

/* Folders first, then by name, natural order ("file2" before "file10"). */
export function compareEntries(a: { name: string, isDir: boolean }, b: { name: string, isDir: boolean }): number {
    if (a.isDir !== b.isDir)
        return a.isDir ? -1 : 1;
    return a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' }) ||
        (a.name < b.name ? -1 : a.name > b.name ? 1 : 0);
}
