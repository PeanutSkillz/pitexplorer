// SPDX-License-Identifier: LGPL-2.1-or-later

import { readFileSync, readdirSync, statSync } from 'node:fs';

import QUnit from 'qunit';

import { compareEntries, entryKind, formatModified } from '../../src/lib/format';
import { parseFindmnt } from '../../src/lib/mounts';

QUnit.module('dates', () => {
    QUnit.test('Dutch notation', assert => {
        const now = new Date(2026, 9, 31, 12, 0);
        const t = new Date(2026, 9, 27, 23, 30).getTime() / 1000;
        assert.equal(formatModified(t, 'nl', '$0 om $1', now), '27 oktober om 23:30');
        const old = new Date(2025, 0, 5, 7, 5).getTime() / 1000;
        assert.equal(formatModified(old, 'nl', '$0 om $1', now), '5 januari 2025 om 07:05');
    });
});

QUnit.module('entries', () => {
    QUnit.test('kinds', assert => {
        assert.equal(entryKind('Media', true), 'folder');
        assert.equal(entryKind('a.JPG', false), 'image');
        assert.equal(entryKind('film.mkv', false), 'video');
        assert.equal(entryKind('.bashrc', false), 'file');
        assert.equal(entryKind('noext', false), 'file');
    });

    QUnit.test('folders first, natural order', assert => {
        const list = [
            { name: 'file10', isDir: false }, { name: 'b', isDir: true }, { name: 'file2', isDir: false },
            { name: 'A', isDir: true },
        ].sort(compareEntries).map(e => e.name);
        assert.deepEqual(list, ['A', 'b', 'file2', 'file10']);
    });
});

QUnit.module('mounts', () => {
    QUnit.test('keeps real file systems only', assert => {
        const json = JSON.stringify({
            filesystems: [
                { target: '/', fstype: 'ext4', source: '/dev/sda2' },
                { target: '/proc', fstype: 'proc', source: 'proc' },
                { target: '/sys', fstype: 'sysfs', source: 'sysfs' },
                { target: '/run', fstype: 'tmpfs', source: 'tmpfs' },
                { target: '/boot', fstype: 'ext4', source: '/dev/sda1' },
                { target: '/boot/efi', fstype: 'vfat', source: '/dev/sda0' },
                { target: '/var/lib/docker/overlay2/x/merged', fstype: 'overlay', source: 'overlay' },
                { target: '/snap/core22/1', fstype: 'squashfs', source: '/dev/loop0' },
                { target: '/mnt/storage', fstype: 'ext4', source: '/dev/sdb1' },
                { target: '/mnt/storage', fstype: 'ext4', source: '/dev/sdb1' },
                { target: '/run/user/1000/doc', fstype: 'fuse.portal', source: 'portal' },
                { target: 'relative', fstype: 'ext4', source: 'x' },
            ],
        });
        assert.deepEqual(parseFindmnt(json).map(m => m.target), ['/', '/boot', '/boot/efi', '/mnt/storage']);
        assert.deepEqual(parseFindmnt('not json'), []);
        assert.deepEqual(parseFindmnt('{}'), []);
    });
});

function sources(dir: string): string[] {
    return readdirSync(dir).flatMap(name => {
        const path = `${dir}/${name}`;
        if (statSync(path).isDirectory())
            return sources(path);
        return /\.tsx?$/.test(name) ? [path] : [];
    });
}

QUnit.module('translations', () => {
    QUnit.test('every UI string has a Dutch translation', assert => {
        const po = readFileSync('po/nl.po', 'utf8');
        const unquote = (s: string) => JSON.parse(`"${s}"`) as string;
        const translated = new Set<string>();
        for (const m of po.matchAll(/^msgid "((?:[^"\\]|\\.)*)"\n(?:msgid_plural "(?:[^"\\]|\\.)*"\n)?msgstr(?:\[0\])? "((?:[^"\\]|\\.)+)"/gm))
            translated.add(unquote(m[1]));

        let count = 0;
        for (const file of sources('src')) {
            const text = readFileSync(file, 'utf8');
            assert.notOk(/(?:\b_|gettext)\(\s*'/.test(text), `${file}: use double quotes for translatable strings`);
            for (const m of text.matchAll(/(?:\b_|ngettext)\(\s*"((?:[^"\\]|\\.)*)"/g)) {
                count++;
                assert.ok(translated.has(unquote(m[1])), `${file}: ${m[1]}`);
            }
        }
        assert.ok(count > 50, `found ${count} strings`);
        assert.ok(translated.has('Files'), 'menu entry');
    });
});
