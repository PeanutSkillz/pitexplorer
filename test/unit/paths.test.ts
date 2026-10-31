// SPDX-License-Identifier: LGPL-2.1-or-later

import QUnit from 'qunit';

import {
    basename, breadcrumbs, childPath, dirname, isProtected, isWithin, nameProblem, normalizePath, PathError,
    uploadTempName,
} from '../../src/lib/paths';

QUnit.module('names', () => {
    QUnit.test('accepts ordinary names', assert => {
        for (const ok of ['a', 'file.txt', '.hidden', 'with space', 'ünïcödé', '...', 'a..b', '-rf', '--'])
            assert.equal(nameProblem(ok), null, ok);
    });

    QUnit.test('refuses invalid names', assert => {
        assert.equal(nameProblem(''), 'empty');
        assert.equal(nameProblem('.'), 'dot');
        assert.equal(nameProblem('..'), 'dot');
        assert.equal(nameProblem('../x'), 'slash');
        assert.equal(nameProblem('a/b'), 'slash');
        assert.equal(nameProblem('/'), 'slash');
        assert.equal(nameProblem('a\0b'), 'nul');
        assert.equal(nameProblem('a\nb'), 'control');
        assert.equal(nameProblem('x'.repeat(256)), 'too-long');
        assert.equal(nameProblem('é'.repeat(128)), 'too-long', 'the limit is in bytes');
        assert.equal(nameProblem('x'.repeat(255)), null);
    });
});

QUnit.module('paths', () => {
    QUnit.test('normalizes absolute paths', assert => {
        assert.equal(normalizePath('/'), '/');
        assert.equal(normalizePath('//DATA//Media/'), '/DATA/Media');
        assert.equal(normalizePath('/DATA/./Media/../Documents'), '/DATA/Documents');
        assert.equal(normalizePath('/../../etc'), '/etc', '".." stops at /');
        assert.equal(normalizePath('/a/b/../../..'), '/');
    });

    QUnit.test('refuses relative paths and NUL', assert => {
        assert.throws(() => normalizePath(''), PathError);
        assert.throws(() => normalizePath('DATA'), PathError);
        assert.throws(() => normalizePath('../x'), PathError);
        assert.throws(() => normalizePath('/a\0b'), PathError);
    });

    QUnit.test('child paths stay inside their folder', assert => {
        assert.equal(childPath('/', 'DATA'), '/DATA');
        assert.equal(childPath('/DATA/', 'Media'), '/DATA/Media');
        assert.equal(childPath('/DATA', '-rf'), '/DATA/-rf');
        for (const bad of ['../x', 'a/b', '..', '.', '', 'x\0'])
            assert.throws(() => childPath('/DATA', bad), PathError, JSON.stringify(bad));
    });

    QUnit.test('basename, dirname, isWithin, breadcrumbs', assert => {
        assert.equal(basename('/DATA/Media'), 'Media');
        assert.equal(basename('/'), '/');
        assert.equal(dirname('/DATA/Media'), '/DATA');
        assert.equal(dirname('/DATA'), '/');
        assert.equal(dirname('/'), '/');
        assert.ok(isWithin('/DATA/Media', '/DATA'));
        assert.ok(isWithin('/DATA', '/DATA'));
        assert.notOk(isWithin('/DATA2', '/DATA'));
        assert.ok(isWithin('/anything', '/'));
        assert.deepEqual(breadcrumbs('/DATA/Media'), [
            { name: '/', path: '/' }, { name: 'DATA', path: '/DATA' }, { name: 'Media', path: '/DATA/Media' },
        ]);
    });

    QUnit.test('protected paths', assert => {
        const mounts = ['/', '/boot', '/boot/efi', '/mnt/storage'];
        for (const p of ['/', '/DATA', '/DATA/', '/boot', '/boot/efi', '/mnt/storage/', '/mnt/x/../storage'])
            assert.ok(isProtected(p, mounts), p);
        for (const p of ['/DATA/Media', '/boot/grub', '/mnt'])
            assert.notOk(isProtected(p, mounts), p);
    });

    QUnit.test('upload temp names are valid hidden names', assert => {
        const t = uploadTempName('photo.jpg', 'abcd');
        assert.equal(t, '.photo.jpg.pitexplorer-upload-abcd.part');
        assert.equal(nameProblem(t), null);
        const long = uploadTempName('x'.repeat(250), 'abcd');
        assert.equal(long, '.pitexplorer-upload-abcd.part');
    });
});
