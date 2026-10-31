// SPDX-License-Identifier: LGPL-2.1-or-later

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import cockpit from 'cockpit';
import { superuser } from 'superuser';

import { Alert, AlertActionCloseButton, AlertActionLink, AlertGroup } from '@patternfly/react-core/dist/esm/components/Alert/index.js';
import { Breadcrumb, BreadcrumbItem } from '@patternfly/react-core/dist/esm/components/Breadcrumb/index.js';
import { Button } from '@patternfly/react-core/dist/esm/components/Button/index.js';
import { Checkbox } from '@patternfly/react-core/dist/esm/components/Checkbox/index.js';
import { Dropdown, DropdownItem, DropdownList } from '@patternfly/react-core/dist/esm/components/Dropdown/index.js';
import { EmptyState, EmptyStateBody, EmptyStateFooter } from '@patternfly/react-core/dist/esm/components/EmptyState/index.js';
import { Label } from '@patternfly/react-core/dist/esm/components/Label/index.js';
import { MenuToggle } from '@patternfly/react-core/dist/esm/components/MenuToggle/index.js';
import { Progress, ProgressSize } from '@patternfly/react-core/dist/esm/components/Progress/index.js';
import { Spinner } from '@patternfly/react-core/dist/esm/components/Spinner/index.js';
import { ToggleGroup, ToggleGroupItem } from '@patternfly/react-core/dist/esm/components/ToggleGroup/index.js';
import { ArrowsAltIcon } from '@patternfly/react-icons/dist/esm/icons/arrows-alt-icon';
import { DownloadIcon } from '@patternfly/react-icons/dist/esm/icons/download-icon';
import { FolderPlusIcon } from '@patternfly/react-icons/dist/esm/icons/folder-plus-icon';
import { ListIcon } from '@patternfly/react-icons/dist/esm/icons/list-icon';
import { PenIcon } from '@patternfly/react-icons/dist/esm/icons/pen-icon';
import { ShieldAltIcon } from '@patternfly/react-icons/dist/esm/icons/shield-alt-icon';
import { ThIcon } from '@patternfly/react-icons/dist/esm/icons/th-icon';
import { TrashIcon } from '@patternfly/react-icons/dist/esm/icons/trash-icon';
import { UploadIcon } from '@patternfly/react-icons/dist/esm/icons/upload-icon';

import {
    cockpitRun, downloadFile, fileWriter, loadMounts, loadSettings, readFolder, resolveEntry, saveSettings,
    watchFolder, type ListError, type RawInfo, type Settings, type Shortcut,
} from '../lib/cockpit-fs';
import { compareEntries, entryKind, formatModified, type EntryKind } from '../lib/format';
import type { Mount } from '../lib/mounts';
import {
    checkDeletable, classify, countEntries, createFolder, deleteEntries, moveEntries, OpError, renameEntry,
    uploadFile, type RunOptions,
} from '../lib/ops';
import { breadcrumbs, childPath, isProtected, nameProblem, normalizePath } from '../lib/paths';
import { AddShortcutDialog, DeleteDialog, MoveDialog, NameDialog, OverwriteDialog, type DeleteItem } from './dialogs';
import { EntryIcon } from './icons';
import { isDenied, listErrorDenied, listErrorText, nameProblemText, opErrorText } from './messages';
import { Sidebar, type SidebarEntry } from './Sidebar';

const _ = cockpit.gettext;

const DEFAULT_START = '/DATA';
const DATA_SUBDIRS = ['Documents', 'Downloads', 'Gallery', 'Media'];
const TEMP_UPLOAD = /^\..*pitexplorer-upload-[0-9a-f]+\.part$|^\.pitexplorer-upload-[0-9a-f]+\.part$/;

interface Entry {
    name: string;
    path: string;
    isDir: boolean;
    isLink: boolean;
    kind: EntryKind;
    size: number | null;
    mtime: number | null;
}

type Op = (paths: string[], opts: RunOptions) => Promise<OpError[]>;

interface PageAlert {
    key: number;
    title: string;
    variant: 'danger' | 'success' | 'info';
    retry?: () => void;
}

interface Upload {
    name: string;
    sent: number;
    total: number;
}

type Dialog =
    | { type: 'mkdir' }
    | { type: 'rename', entry: Entry }
    | { type: 'move', paths: string[] }
    | { type: 'delete', items: DeleteItem[], refusal: string | null }
    | { type: 'overwrite', files: File[], conflicts: string[] }
    | { type: 'add' };

function locationPath(): string | null {
    const p = cockpit.location.options.path;
    const value = Array.isArray(p) ? p[0] : p;
    if (!value)
        return null;
    try {
        return normalizePath(value);
    } catch {
        return null;
    }
}

function randomHex(): string {
    const bytes = new Uint8Array(8);
    window.crypto.getRandomValues(bytes);
    return Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('');
}

function toEntries(dir: string, info: RawInfo): Entry[] {
    const out: Entry[] = [];
    for (const [name, raw] of Object.entries(info.entries ?? {})) {
        if (nameProblem(name) || TEMP_UPLOAD.test(name))
            continue;
        const resolved = resolveEntry(info, name);
        const isDir = resolved?.type === 'dir';
        out.push({
            name,
            path: childPath(dir, name),
            isDir,
            isLink: raw.type === 'lnk',
            kind: entryKind(name, isDir),
            size: isDir ? null : (resolved?.size ?? raw.size ?? null),
            mtime: raw.mtime ?? null,
        });
    }
    return out.sort(compareEntries);
}

function loadView(): 'grid' | 'list' {
    try {
        return window.localStorage.getItem('pitexplorer-view') === 'list' ? 'list' : 'grid';
    } catch {
        return 'grid';
    }
}

function saveView(view: 'grid' | 'list') {
    try {
        window.localStorage.setItem('pitexplorer-view', view);
    } catch {
        // only a convenience
    }
}

function crumbName(c: { name: string, path: string }) {
    return c.path === '/' ? _("Root") : c.name;
}

export function FilesPage() {
    const [path, setPath] = useState<string>(() => locationPath() ?? DEFAULT_START);
    const [elevated, setElevated] = useState(false);
    const [info, setInfo] = useState<RawInfo | null>(null);
    const [listError, setListError] = useState<ListError | null>(null);
    const [view, setView] = useState<'grid' | 'list'>(loadView);
    const [selected, setSelected] = useState<Set<string>>(new Set());
    const [settings, setSettings] = useState<Settings | null>(null);
    const [mounts, setMounts] = useState<Mount[]>([]);
    const [dataDirs, setDataDirs] = useState<string[] | null>(null);
    const [dialog, setDialog] = useState<Dialog | null>(null);
    const [alerts, setAlerts] = useState<PageAlert[]>([]);
    const [uploads, setUploads] = useState<Upload[]>([]);
    const [menuOpen, setMenuOpen] = useState(false);
    const [suAllowed, setSuAllowed] = useState<boolean>(superuser.allowed === true);
    const fileInput = useRef<HTMLInputElement>(null);
    const alertKey = useRef(0);

    /* --- navigation --- */

    useEffect(() => {
        const changed = () => setPath(locationPath() ?? DEFAULT_START);
        cockpit.addEventListener('locationchanged', changed);
        return () => cockpit.removeEventListener('locationchanged', changed);
    }, []);

    useEffect(() => {
        const changed = () => setSuAllowed(superuser.allowed === true);
        superuser.addEventListener('changed', changed);
        return () => superuser.removeEventListener('changed', changed);
    }, []);

    const navigate = useCallback((target: string) => {
        cockpit.location.go([], { path: normalizePath(target) });
    }, []);

    useEffect(() => {
        setInfo(null);
        setListError(null);
        setSelected(new Set());
        return watchFolder(path, { superuser: elevated }, (newInfo, error) => {
            setInfo(newInfo);
            setListError(error);
        });
    }, [path, elevated]);

    // the default start folder does not exist on every system
    useEffect(() => {
        if (listError?.errno === 'ENOENT' && path === DEFAULT_START && locationPath() === null)
            setPath('/');
    }, [listError, path]);

    const entries = useMemo(() => info ? toEntries(path, info) : [], [info, path]);

    // forget selected names that disappeared
    useEffect(() => {
        setSelected(sel => {
            const names = new Set(entries.map(e => e.name));
            const next = new Set([...sel].filter(n => names.has(n)));
            return next.size === sel.size ? sel : next;
        });
    }, [entries]);

    /* --- sidebar data --- */

    useEffect(() => {
        loadSettings().then(setSettings, () => setSettings({ shortcuts: null, locations: [] }));
        loadMounts().then(setMounts, err => addAlert('danger', cockpit.format(_("Cannot list mounted file systems: $0"), String(err?.message ?? err))));
        readFolder('/DATA').then(i => setDataDirs(DATA_SUBDIRS.filter(n => resolveEntry(i, n)?.type === 'dir')),
                                 () => setDataDirs([]));
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    const defaultShortcuts = useCallback((): Shortcut[] => {
        const list: Shortcut[] = [{ name: _("Root"), path: '/' }];
        if (dataDirs !== null && (dataDirs.length > 0 || mounts.some(m => m.target === '/DATA') || info !== null))
            list.push({ name: 'DATA', path: '/DATA' });
        for (const n of dataDirs ?? [])
            list.push({ name: n, path: `/DATA/${n}` });
        return list;
    }, [dataDirs, mounts, info]);

    const shortcuts: SidebarEntry[] = (settings?.shortcuts ?? defaultShortcuts())
            .map(s => ({ ...s, removable: 'shortcuts' as const }));
    const locations: SidebarEntry[] = [
        ...mounts.filter(m => m.target !== '/')
                .map(m => ({ name: m.target.slice(m.target.lastIndexOf('/') + 1), path: m.target, isMount: true })),
        ...(settings?.locations ?? []).map(s => ({ ...s, removable: 'locations' as const })),
    ];
    const mountPoints = useMemo(() => mounts.map(m => m.target), [mounts]);

    const updateSettings = async (change: (s: Settings) => Settings) => {
        const next = change(settings ?? { shortcuts: null, locations: [] });
        await saveSettings(next);
        setSettings(next);
    };

    const removeShortcut = (entry: SidebarEntry) => {
        updateSettings(s => entry.removable === 'shortcuts'
            ? { ...s, shortcuts: (s.shortcuts ?? defaultShortcuts()).filter(x => x.path !== entry.path) }
            : { ...s, locations: s.locations.filter(x => x.path !== entry.path) })
                .catch(err => addAlert('danger', String(err?.message ?? err)));
    };

    /* --- alerts and errors --- */

    const addAlert = (variant: PageAlert['variant'], title: string, retry?: () => void) => {
        const key = ++alertKey.current;
        setAlerts(a => [...a, { key, variant, title, ...retry ? { retry } : {} }]);
        if (variant === 'success')
            window.setTimeout(() => setAlerts(a => a.filter(x => x.key !== key)), 4000);
    };
    const closeAlert = (key: number) => setAlerts(a => a.filter(x => x.key !== key));

    /* Report errors of an operation. "Permission denied" gets a retry with
     * Cockpit's administrative access when the session may use it; that is
     * the only way an operation runs with more than the user's rights. */
    const report = (errors: OpError[], op: Op, elevatedRetry: boolean) => {
        const denied = errors.filter(isDenied);
        for (const e of errors.filter(e => !isDenied(e)))
            addAlert('danger', opErrorText(e));
        if (denied.length === 0)
            return;
        const title = denied.length === 1
            ? opErrorText(denied[0])
            : cockpit.format(_("Permission denied for $0 items"), denied.length);
        const retry = !elevatedRetry && suAllowed
            ? () => {
                const paths = denied.map(e => e.source ?? e.path);
                op(paths, { superuser: true }).then(errs => report(errs, op, true),
                                                    err => report([classify(err, '')], op, true));
            }
            : undefined;
        addAlert('danger', title, retry);
    };

    /* Run an operation from a dialog: errors other than "permission denied"
     * stay in the dialog (it is not closed), so the user can correct them. */
    const fromDialog = async (paths: string[], op: Op) => {
        const errors = await op(paths, {});
        const denied = errors.filter(isDenied);
        if (denied.length === 0 && errors.length > 0 && paths.length <= 1)
            throw errors[0];
        report(errors, op, false);
    };

    const single = (fn: (opts: RunOptions) => Promise<unknown>, path: string): Op => async (_paths, opts) => {
        try {
            await fn(opts);
            return [];
        } catch (err) {
            return [classify(err, path)];
        }
    };

    /* --- selection --- */

    const selectedEntries = entries.filter(e => selected.has(e.name));
    const allSelected = entries.length > 0 && selected.size === entries.length;
    const toggle = (name: string) => setSelected(sel => {
        const next = new Set(sel);
        if (!next.delete(name))
            next.add(name);
        return next;
    });
    const selectAll = (on: boolean) => setSelected(on ? new Set(entries.map(e => e.name)) : new Set());

    /* --- actions --- */

    const startUpload = (files: File[]) => {
        const bad = files.filter(f => nameProblem(f.name));
        for (const f of bad)
            addAlert('danger', cockpit.format(_("Cannot upload \"$0\": $1"), f.name, nameProblemText(nameProblem(f.name)!)));
        const good = files.filter(f => !nameProblem(f.name));
        const existing = new Set(entries.map(e => e.name));
        const conflicts = good.filter(f => existing.has(f.name)).map(f => f.name);
        if (conflicts.length > 0)
            setDialog({ type: 'overwrite', files: good, conflicts });
        else
            doUpload(good, new Set());
    };

    const doUpload = async (files: File[], overwrite: Set<string>) => {
        const dir = path;
        const one = (file: File): Op => async (_paths, opts) => {
            setUploads(u => [...u, { name: file.name, sent: 0, total: file.size }]);
            const progress = (sent: number) => setUploads(u => u.map(x => x.name === file.name ? { ...x, sent } : x));
            try {
                await uploadFile(cockpitRun, fileWriter(file, opts, progress), dir, file.name,
                                 overwrite.has(file.name), randomHex(), opts);
                return [];
            } catch (err) {
                return [classify(err, childPath(dir, file.name))];
            } finally {
                setUploads(u => u.filter(x => x.name !== file.name));
            }
        };
        let done = 0;
        for (const file of files) {
            const op = one(file);
            const errors = await op([], {});
            if (errors.length)
                report(errors, op, false);
            else
                done++;
        }
        if (done > 0)
            addAlert('success', cockpit.format(cockpit.ngettext("$0 file uploaded", "$0 files uploaded", done), done));
    };

    const download = () => {
        for (const e of selectedEntries.filter(e => !e.isDir))
            downloadFile(e.path, e.name, e.size ?? 0, { superuser: elevated });
    };

    const askDelete = () => {
        const items = selectedEntries.map(e => ({ path: e.path, isDir: e.isDir && !e.isLink }));
        let refusal: string | null = null;
        try {
            checkDeletable(items.map(i => i.path), mountPoints);
        } catch (err) {
            refusal = opErrorText(err);
        }
        setDialog({ type: 'delete', items, refusal });
    };

    const count = useCallback((p: string) => countEntries(cockpitRun, p, { superuser: elevated }), [elevated]);

    const selectionProtected = selectedEntries.some(e => isProtected(e.path, mountPoints));
    const onlyFiles = selectedEntries.length > 0 && selectedEntries.every(e => !e.isDir);

    /* --- rendering --- */

    const open = (e: Entry) => {
        if (e.isDir)
            navigate(e.path);
        else
            toggle(e.name);
    };

    const modified = (e: Entry) => e.mtime === null ? '' : formatModified(e.mtime, cockpit.language, _("$0 at $1"));
    const size = (e: Entry) => e.isDir || e.size === null ? '' : cockpit.format_bytes(e.size);

    const counter = selected.size > 0
        ? cockpit.format(cockpit.ngettext("$0 selected", "$0 selected", selected.size), selected.size)
        : cockpit.format(cockpit.ngettext("$0 item in total", "$0 items in total", entries.length), entries.length);

    let body: React.ReactNode;
    if (listError) {
        body = (
            <EmptyState titleText={listErrorText(listError, path)} headingLevel="h2" status="danger">
                {listErrorDenied(listError) && !elevated &&
                    <EmptyStateBody>
                        {suAllowed
                            ? _("You can open this folder with administrative access.")
                            : _("Turn on administrative access in Cockpit to open this folder.")}
                    </EmptyStateBody>}
                {listErrorDenied(listError) && !elevated && suAllowed &&
                    <EmptyStateFooter>
                        <Button variant="secondary" icon={<ShieldAltIcon />} onClick={() => setElevated(true)}>
                            {_("Open as administrator")}
                        </Button>
                    </EmptyStateFooter>}
            </EmptyState>
        );
    } else if (!info) {
        body = <div className="pe-loading"><Spinner size="lg" /></div>;
    } else if (entries.length === 0) {
        body = <EmptyState titleText={_("This folder is empty")} headingLevel="h2" />;
    } else if (view === 'grid') {
        body = (
            <ul className="pe-grid" aria-label={_("Folder contents")}>
                {entries.map(e =>
                    <li key={e.name} className={'pe-tile' + (selected.has(e.name) ? ' pe-selected' : '')}>
                        <Checkbox
                            id={'pe-sel-' + e.name} className="pe-tile-check" isChecked={selected.has(e.name)}
                            aria-label={cockpit.format(_("Select $0"), e.name)} onChange={() => toggle(e.name)}
                        />
                        <button type="button" className="pe-tile-main" onClick={() => open(e)} title={e.name}>
                            <EntryIcon name={e.name} kind={e.kind} isLink={e.isLink} size="large" />
                            <span className="pe-tile-name">{e.name}</span>
                            <span className="pe-tile-meta">{modified(e)}</span>
                        </button>
                    </li>)}
            </ul>
        );
    } else {
        body = (
            <table className="pe-list" aria-label={_("Folder contents")}>
                <thead>
                    <tr>
                        <th className="pe-col-check"><span className="pe-sr-only">{_("Selected")}</span></th>
                        <th>{_("Name")}</th>
                        <th className="pe-col-size">{_("Size")}</th>
                        <th className="pe-col-date">{_("Modified")}</th>
                    </tr>
                </thead>
                <tbody>
                    {entries.map(e =>
                        <tr key={e.name} className={selected.has(e.name) ? 'pe-selected' : undefined}>
                            <td className="pe-col-check">
                                <Checkbox
                                    id={'pe-sel-' + e.name} isChecked={selected.has(e.name)}
                                    aria-label={cockpit.format(_("Select $0"), e.name)} onChange={() => toggle(e.name)}
                                />
                            </td>
                            <td>
                                <button type="button" className="pe-row-name" onClick={() => open(e)} title={e.name}>
                                    <EntryIcon name={e.name} kind={e.kind} isLink={e.isLink} size="small" />
                                    <span>{e.name}</span>
                                </button>
                            </td>
                            <td className="pe-col-size">{size(e)}</td>
                            <td className="pe-col-date">{modified(e)}</td>
                        </tr>)}
                </tbody>
            </table>
        );
    }

    /* --- handlers used by the markup --- */

    const closeDialog = () => setDialog(null);
    const retryAlert = (a: PageAlert) => {
        closeAlert(a.key);
        a.retry?.();
    };
    const submitMkdir = (name: string) =>
        fromDialog([], single(opts => createFolder(cockpitRun, path, name, opts), path === '/' ? `/${name}` : `${path}/${name}`));
    const submitRename = (entry: Entry, name: string) =>
        fromDialog([], single(opts => renameEntry(cockpitRun, entry.path, name, mountPoints, opts), entry.path));
    const submitMove = (paths: string[], target: string) =>
        fromDialog(paths, (ps, opts) => moveEntries(cockpitRun, ps, target, mountPoints, opts));
    const submitDelete = (items: DeleteItem[]) =>
        fromDialog(items.map(i => i.path), (ps, opts) => deleteEntries(cockpitRun, ps, mountPoints, opts));
    const overwriteChoice = (files: File[], conflicts: string[], replace: boolean) => {
        setDialog(null);
        if (replace)
            doUpload(files, new Set(conflicts));
        else
            doUpload(files.filter(f => !conflicts.includes(f.name)), new Set());
    };
    const addShortcut = (section: 'shortcuts' | 'locations', name: string, p: string) =>
        updateSettings(s => section === 'shortcuts'
            ? { ...s, shortcuts: [...(s.shortcuts ?? defaultShortcuts()), { name, path: p }] }
            : { ...s, locations: [...s.locations, { name, path: p }] });
    const filesChosen = (ev: React.ChangeEvent<HTMLInputElement>) => {
        const files = Array.from(ev.target.files ?? []);
        ev.target.value = '';
        if (files.length)
            startUpload(files);
    };
    const menuToggle = (ref: React.Ref<HTMLButtonElement>) => (
        <MenuToggle
            ref={ref} variant="primary" icon={<UploadIcon />} isDisabled={!info}
            onClick={() => setMenuOpen(!menuOpen)} isExpanded={menuOpen}
        >
            {_("Upload or create")}
        </MenuToggle>
    );

    return (
        <div className="pe-app">
            <Sidebar
                shortcuts={shortcuts} locations={locations} current={path}
                onOpen={navigate} onAdd={() => setDialog({ type: 'add' })} onRemove={removeShortcut}
            />

            <main className="pe-main">
                <header className="pe-header">
                    <Breadcrumb className="pe-crumbs">
                        {breadcrumbs(path).map(c =>
                            <BreadcrumbItem
                                key={c.path} isActive={c.path === path} component="button"
                                onClick={() => c.path !== path && navigate(c.path)}
                            >
                                {crumbName(c)}
                            </BreadcrumbItem>)}
                    </Breadcrumb>
                    <div className="pe-header-actions">
                        {elevated &&
                            <Label
                                color="orange" icon={<ShieldAltIcon />} onClose={() => setElevated(false)}
                                closeBtnAriaLabel={_("Stop administrative access")}
                            >
                                {_("Administrator")}
                            </Label>}
                        <Dropdown
                            isOpen={menuOpen} onOpenChange={setMenuOpen} popperProps={{ position: 'right' }}
                            onSelect={() => setMenuOpen(false)} toggle={menuToggle}
                        >
                            <DropdownList>
                                <DropdownItem icon={<UploadIcon />} onClick={() => fileInput.current?.click()}>
                                    {_("Upload files")}
                                </DropdownItem>
                                <DropdownItem icon={<FolderPlusIcon />} onClick={() => setDialog({ type: 'mkdir' })}>
                                    {_("New folder")}
                                </DropdownItem>
                            </DropdownList>
                        </Dropdown>
                        <input ref={fileInput} type="file" multiple hidden onChange={filesChosen} />
                    </div>
                </header>

                <div className="pe-toolbar">
                    <Checkbox
                        id="pe-select-all" isChecked={allSelected ? true : selected.size > 0 ? null : false}
                        isDisabled={entries.length === 0} label={counter}
                        aria-label={_("Select all")} onChange={(_ev, on) => selectAll(on && !allSelected)}
                    />
                    {selected.size > 0 &&
                        <div className="pe-selection-actions">
                            <Button
                                variant="secondary" size="sm" icon={<DownloadIcon />} isDisabled={!onlyFiles}
                                onClick={download}
                            >
                                {_("Download")}
                            </Button>
                            <Button
                                variant="secondary" size="sm" icon={<PenIcon />}
                                isDisabled={selected.size !== 1 || selectionProtected}
                                onClick={() => setDialog({ type: 'rename', entry: selectedEntries[0] })}
                            >
                                {_("Rename")}
                            </Button>
                            <Button
                                variant="secondary" size="sm" icon={<ArrowsAltIcon />} isDisabled={selectionProtected}
                                onClick={() => setDialog({ type: 'move', paths: selectedEntries.map(e => e.path) })}
                            >
                                {_("Move to…")}
                            </Button>
                            <Button variant="danger" size="sm" icon={<TrashIcon />} onClick={askDelete}>
                                {_("Delete")}
                            </Button>
                        </div>}
                    <ToggleGroup className="pe-view-toggle" aria-label={_("View")}>
                        <ToggleGroupItem
                            icon={<ThIcon />} aria-label={_("Grid view")} isSelected={view === 'grid'}
                            onChange={() => { setView('grid'); saveView('grid') }}
                        />
                        <ToggleGroupItem
                            icon={<ListIcon />} aria-label={_("List view")} isSelected={view === 'list'}
                            onChange={() => { setView('list'); saveView('list') }}
                        />
                    </ToggleGroup>
                </div>

                {uploads.map(u =>
                    <Progress
                        key={u.name} className="pe-upload" size={ProgressSize.sm}
                        title={cockpit.format(_("Uploading $0"), u.name)}
                        value={u.total ? (u.sent / u.total) * 100 : 100}
                    />)}

                <div className="pe-content">{body}</div>
            </main>

            <AlertGroup isToast isLiveRegion>
                {alerts.map(a =>
                    <Alert
                        key={a.key} variant={a.variant} title={a.title}
                        actionClose={<AlertActionCloseButton onClose={() => closeAlert(a.key)} />}
                        actionLinks={a.retry && <AlertActionLink onClick={() => retryAlert(a)}>{_("Retry as administrator")}</AlertActionLink>}
                    />)}
            </AlertGroup>

            {dialog?.type === 'mkdir' &&
                <NameDialog
                    title={_("New folder")} label={_("Folder name")} initial="" submitLabel={_("Create")}
                    onClose={closeDialog} onSubmit={submitMkdir}
                />}
            {dialog?.type === 'rename' &&
                <NameDialog
                    title={_("Rename")} label={_("New name")} initial={dialog.entry.name}
                    submitLabel={_("Rename")} onClose={closeDialog} onSubmit={name => submitRename(dialog.entry, name)}
                />}
            {dialog?.type === 'move' &&
                <MoveDialog
                    start={path} count={dialog.paths.length} onClose={closeDialog}
                    onMove={target => submitMove(dialog.paths, target)}
                />}
            {dialog?.type === 'delete' &&
                <DeleteDialog
                    items={dialog.items} refusal={dialog.refusal} count={count} onClose={closeDialog}
                    onDelete={() => submitDelete(dialog.items)}
                />}
            {dialog?.type === 'overwrite' &&
                <OverwriteDialog
                    names={dialog.conflicts} onClose={closeDialog}
                    onReplace={() => overwriteChoice(dialog.files, dialog.conflicts, true)}
                    onSkip={() => overwriteChoice(dialog.files, dialog.conflicts, false)}
                />}
            {dialog?.type === 'add' &&
                <AddShortcutDialog initialPath={path} onClose={closeDialog} onAdd={addShortcut} />}
        </div>
    );
}
