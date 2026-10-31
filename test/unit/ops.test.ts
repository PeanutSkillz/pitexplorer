// SPDX-License-Identifier: LGPL-2.1-or-later
//
// The file operations run against a real temporary folder. The runner starts
// the program directly with its argv (no shell), like cockpit.spawn does in
// the bridge, so the same argv is tested that Cockpit would run.

import { execFile } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';

import QUnit from 'qunit';

import {
    countEntries, createFolder, deleteEntries, moveEntries, OpError, renameEntry, uploadFile,
    type Runner,
} from '../../src/lib/ops';

const calls: string[][] = [];

const nodeRun: Runner = argv => new Promise((resolve, reject) => {
    calls.push(argv);
    execFile(argv[0], argv.slice(1), { env: { ...process.env, LC_ALL: 'C' } }, (error, stdout, stderr) => {
        if (error)
            reject(new Error(stderr || error.message));
        else
            resolve(stdout);
    });
});

/* the TempWriter used in Cockpit refuses to replace an existing file (tag "-");
 * the "wx" flag does the same */
const writer = (content: string) => async (path: string) => {
    writeFileSync(path, content, { flag: 'wx' });
};

function sandbox(): string {
    return mkdtempSync(`${tmpdir()}/pitexplorer-test-`);
}

async function rejection(promise: Promise<unknown>): Promise<OpError | null> {
    try {
        await promise;
        return null;
    } catch (err) {
        return err as OpError;
    }
}

const INVALID = ['../x', 'a/b', '', '.', '..', 'a\0b', '/etc'];

QUnit.module('create folder', () => {
    QUnit.test('creates a folder', async assert => {
        const dir = sandbox();
        assert.equal(await createFolder(nodeRun, dir, 'new'), `${dir}/new`);
        assert.ok(existsSync(`${dir}/new`));
        assert.equal(await createFolder(nodeRun, dir, '-rf'), `${dir}/-rf`, 'a name that looks like an option');
        assert.ok(existsSync(`${dir}/-rf`));
        rmSync(dir, { recursive: true });
    });

    QUnit.test('refuses invalid names without running anything', async assert => {
        const dir = sandbox();
        calls.length = 0;
        for (const name of INVALID) {
            const err = await rejection(createFolder(nodeRun, dir, name));
            assert.equal(err?.code, 'invalid-name', JSON.stringify(name));
        }
        assert.equal(calls.length, 0, 'no command was run');
        assert.deepEqual(readdirSync(dir), []);
        assert.notOk(existsSync(`${dir}/../x`));
        rmSync(dir, { recursive: true });
    });

    QUnit.test('reports an existing name', async assert => {
        const dir = sandbox();
        mkdirSync(`${dir}/a`);
        const err = await rejection(createFolder(nodeRun, dir, 'a'));
        assert.equal(err?.code, 'exists');
        rmSync(dir, { recursive: true });
    });
});

QUnit.module('rename', () => {
    QUnit.test('renames a file', async assert => {
        const dir = sandbox();
        writeFileSync(`${dir}/a.txt`, 'A');
        assert.equal(await renameEntry(nodeRun, `${dir}/a.txt`, 'b.txt', []), `${dir}/b.txt`);
        assert.equal(readFileSync(`${dir}/b.txt`, 'utf8'), 'A');
        assert.notOk(existsSync(`${dir}/a.txt`));
        rmSync(dir, { recursive: true });
    });

    QUnit.test('refuses invalid names', async assert => {
        const dir = sandbox();
        writeFileSync(`${dir}/a.txt`, 'A');
        for (const name of INVALID) {
            const err = await rejection(renameEntry(nodeRun, `${dir}/a.txt`, name, []));
            assert.equal(err?.code, 'invalid-name', JSON.stringify(name));
        }
        assert.deepEqual(readdirSync(dir), ['a.txt']);
        rmSync(dir, { recursive: true });
    });

    QUnit.test('never replaces an existing entry', async assert => {
        const dir = sandbox();
        writeFileSync(`${dir}/a.txt`, 'A');
        writeFileSync(`${dir}/b.txt`, 'B');
        const err = await rejection(renameEntry(nodeRun, `${dir}/a.txt`, 'b.txt', []));
        assert.equal(err?.code, 'exists');
        assert.equal(readFileSync(`${dir}/a.txt`, 'utf8'), 'A');
        assert.equal(readFileSync(`${dir}/b.txt`, 'utf8'), 'B');
        rmSync(dir, { recursive: true });
    });

    QUnit.test('refuses protected paths', async assert => {
        const dir = sandbox();
        mkdirSync(`${dir}/mnt`);
        for (const p of ['/', '/DATA', `${dir}/mnt`]) {
            const err = await rejection(renameEntry(nodeRun, p, 'x', [`${dir}/mnt`]));
            assert.equal(err?.code, 'protected', p);
        }
        assert.ok(existsSync(`${dir}/mnt`));
        rmSync(dir, { recursive: true });
    });
});

QUnit.module('move', () => {
    QUnit.test('moves entries into a folder, never replacing', async assert => {
        const dir = sandbox();
        mkdirSync(`${dir}/target`);
        writeFileSync(`${dir}/a`, 'A');
        writeFileSync(`${dir}/b`, 'B new');
        writeFileSync(`${dir}/target/b`, 'B old');
        const errors = await moveEntries(nodeRun, [`${dir}/a`, `${dir}/b`], `${dir}/target`, []);
        assert.equal(errors.length, 1);
        assert.equal(errors[0].code, 'exists');
        assert.equal(errors[0].source, `${dir}/b`);
        assert.equal(readFileSync(`${dir}/target/a`, 'utf8'), 'A');
        assert.equal(readFileSync(`${dir}/target/b`, 'utf8'), 'B old');
        assert.equal(readFileSync(`${dir}/b`, 'utf8'), 'B new');
        rmSync(dir, { recursive: true });
    });

    QUnit.test('refuses moving a folder into itself and protected paths', async assert => {
        const dir = sandbox();
        mkdirSync(`${dir}/f/sub`, { recursive: true });
        let errors = await moveEntries(nodeRun, [`${dir}/f`], `${dir}/f/sub`, []);
        assert.equal(errors[0]?.code, 'into-itself');
        errors = await moveEntries(nodeRun, ['/DATA'], `${dir}/f`, []);
        assert.equal(errors[0]?.code, 'protected');
        assert.ok(existsSync(`${dir}/f/sub`));
        rmSync(dir, { recursive: true });
    });
});

QUnit.module('delete', () => {
    QUnit.test('counts and deletes a folder recursively', async assert => {
        const dir = sandbox();
        mkdirSync(`${dir}/f/sub`, { recursive: true });
        writeFileSync(`${dir}/f/a`, 'A');
        writeFileSync(`${dir}/f/sub/b`, 'B');
        writeFileSync(`${dir}/keep`, 'K');
        assert.equal(await countEntries(nodeRun, `${dir}/f`), 3);
        assert.equal(await countEntries(nodeRun, `${dir}/keep`), 0);
        assert.deepEqual(await deleteEntries(nodeRun, [`${dir}/f`], []), []);
        assert.deepEqual(readdirSync(dir), ['keep']);
        rmSync(dir, { recursive: true });
    });

    QUnit.test('deletes names that look like options', async assert => {
        const dir = sandbox();
        writeFileSync(`${dir}/-rf`, 'x');
        assert.deepEqual(await deleteEntries(nodeRun, [`${dir}/-rf`], []), []);
        assert.deepEqual(readdirSync(dir), []);
        rmSync(dir, { recursive: true });
    });

    QUnit.test('never deletes /, /DATA, a mount point or a folder containing one', async assert => {
        const dir = sandbox();
        mkdirSync(`${dir}/outer/mnt`, { recursive: true });
        writeFileSync(`${dir}/outer/mnt/data`, 'D');
        const mounts = ['/', `${dir}/outer/mnt`];
        calls.length = 0;
        for (const [p, code] of [['/', 'protected'], ['/DATA', 'protected'], [`${dir}/outer/mnt`, 'protected'],
            [`${dir}/outer`, 'contains-mount']]) {
            const err = await rejection(deleteEntries(nodeRun, [p], mounts));
            assert.equal(err?.code, code, p);
        }
        // a batch with one forbidden path deletes nothing at all
        writeFileSync(`${dir}/other`, 'O');
        const err = await rejection(deleteEntries(nodeRun, [`${dir}/other`, `${dir}/outer`], mounts));
        assert.equal(err?.code, 'contains-mount');
        assert.equal(calls.length, 0, 'no command was run');
        assert.ok(existsSync(`${dir}/other`));
        assert.equal(readFileSync(`${dir}/outer/mnt/data`, 'utf8'), 'D');
        rmSync(dir, { recursive: true });
    });

    QUnit.test('reports a missing entry', async assert => {
        const dir = sandbox();
        const errors = await deleteEntries(nodeRun, [`${dir}/missing`], []);
        assert.equal(errors[0]?.code, 'not-found');
        rmSync(dir, { recursive: true });
    });
});

QUnit.module('upload', () => {
    QUnit.test('writes to a temporary name, then renames', async assert => {
        const dir = sandbox();
        let tempSeen = '';
        const write = async (path: string) => {
            tempSeen = path;
            await writer('content')(path);
        };
        assert.equal(await uploadFile(nodeRun, write, dir, 'up.txt', false, 'abc123'), `${dir}/up.txt`);
        assert.equal(tempSeen, `${dir}/.up.txt.pitexplorer-upload-abc123.part`);
        assert.equal(readFileSync(`${dir}/up.txt`, 'utf8'), 'content');
        assert.deepEqual(readdirSync(dir), ['up.txt'], 'no temporary file is left');
        rmSync(dir, { recursive: true });
    });

    QUnit.test('does not replace an existing file without confirmation', async assert => {
        const dir = sandbox();
        writeFileSync(`${dir}/up.txt`, 'old');
        const err = await rejection(uploadFile(nodeRun, writer('new'), dir, 'up.txt', false, 'abc123'));
        assert.equal(err?.code, 'exists');
        assert.equal(readFileSync(`${dir}/up.txt`, 'utf8'), 'old');
        assert.deepEqual(readdirSync(dir), ['up.txt'], 'the temporary file was removed');
        rmSync(dir, { recursive: true });
    });

    QUnit.test('replaces an existing file when confirmed', async assert => {
        const dir = sandbox();
        writeFileSync(`${dir}/up.txt`, 'old');
        await uploadFile(nodeRun, writer('new'), dir, 'up.txt', true, 'abc123');
        assert.equal(readFileSync(`${dir}/up.txt`, 'utf8'), 'new');
        assert.deepEqual(readdirSync(dir), ['up.txt']);
        rmSync(dir, { recursive: true });
    });

    QUnit.test('refuses invalid names and cleans up after a failed write', async assert => {
        const dir = sandbox();
        for (const name of INVALID) {
            const err = await rejection(uploadFile(nodeRun, writer('x'), dir, name, false, 'abc123'));
            assert.equal(err?.code, 'invalid-name', JSON.stringify(name));
        }
        const failing = async (path: string) => {
            writeFileSync(path, 'partial', { flag: 'wx' });
            throw new Error('connection lost');
        };
        const err = await rejection(uploadFile(nodeRun, failing, dir, 'up.txt', false, 'abc123'));
        assert.ok(err instanceof OpError);
        assert.deepEqual(readdirSync(dir), [], 'nothing is left behind');
        rmSync(dir, { recursive: true });
    });
});

QUnit.module('command lines', () => {
    QUnit.test('no shell, and "--" before every path', assert => {
        assert.ok(calls.length > 0);
        for (const argv of calls) {
            assert.notOk(['sh', 'bash', 'dash', 'env'].includes(argv[0]), argv.join(' '));
            assert.ok(['mkdir', 'mv', 'rm', 'stat', 'find'].includes(argv[0]), argv.join(' '));
            if (argv[0] !== 'find') {
                const dashes = argv.indexOf('--');
                assert.ok(dashes > 0, `"--" in: ${argv.join(' ')}`);
                assert.ok(argv.slice(1, dashes).every(a => !a.startsWith('/')), `paths after "--": ${argv.join(' ')}`);
            } else {
                assert.ok(argv[1].startsWith('/'), 'find gets an absolute path');
            }
        }
    });
});
