// SPDX-License-Identifier: LGPL-2.1-or-later

import React, { useEffect, useState } from 'react';
import cockpit from 'cockpit';

import { Alert } from '@patternfly/react-core/dist/esm/components/Alert/index.js';
import { Breadcrumb, BreadcrumbItem } from '@patternfly/react-core/dist/esm/components/Breadcrumb/index.js';
import { Button } from '@patternfly/react-core/dist/esm/components/Button/index.js';
import { Form, FormGroup, FormHelperText } from '@patternfly/react-core/dist/esm/components/Form/index.js';
import { HelperText, HelperTextItem } from '@patternfly/react-core/dist/esm/components/HelperText/index.js';
import { List, ListItem } from '@patternfly/react-core/dist/esm/components/List/index.js';
import { Modal, ModalBody, ModalFooter, ModalHeader } from '@patternfly/react-core/dist/esm/components/Modal/index.js';
import { Radio } from '@patternfly/react-core/dist/esm/components/Radio/index.js';
import { Spinner } from '@patternfly/react-core/dist/esm/components/Spinner/index.js';
import { TextInput } from '@patternfly/react-core/dist/esm/components/TextInput/index.js';
import { FolderIcon } from '@patternfly/react-icons/dist/esm/icons/folder-icon';
import { LevelUpAltIcon } from '@patternfly/react-icons/dist/esm/icons/level-up-alt-icon';

import { readFolder, resolveEntry } from '../lib/cockpit-fs';
import { compareEntries } from '../lib/format';
import { breadcrumbs, childPath, dirname, nameProblem, normalizePath } from '../lib/paths';
import { nameProblemText, opErrorText } from './messages';

const _ = cockpit.gettext;

/* Shared footer logic: runs the action, shows its error inside the dialog. */
function useAction(onDone: () => void) {
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const run = (fn: () => Promise<void>) => {
        setBusy(true);
        setError(null);
        fn().then(onDone, err => {
            setBusy(false);
            setError(opErrorText(err));
        });
    };
    return { busy, error, run };
}

/* New folder and rename: one name field, validated while typing. */
export function NameDialog({ title, label, initial, submitLabel, onSubmit, onClose }: {
    title: string, label: string, initial: string, submitLabel: string,
    onSubmit: (name: string) => Promise<void>, onClose: () => void,
}) {
    const [name, setName] = useState(initial);
    const [touched, setTouched] = useState(false);
    const { busy, error, run } = useAction(onClose);
    const problem = nameProblem(name);

    const submit = (ev?: React.FormEvent) => {
        ev?.preventDefault();
        setTouched(true);
        if (!problem && !busy)
            run(() => onSubmit(name));
    };

    return (
        <Modal isOpen onClose={onClose} variant="small" aria-labelledby="pe-name-dialog">
            <ModalHeader title={title} labelId="pe-name-dialog" />
            <ModalBody>
                {error && <Alert variant="danger" isInline title={error} className="pe-dialog-alert" />}
                <Form onSubmit={submit}>
                    <FormGroup label={label} fieldId="pe-name">
                        <TextInput
                            id="pe-name" value={name} autoFocus
                            validated={touched && problem ? 'error' : 'default'}
                            onChange={(_ev, v) => { setName(v); setTouched(true) }}
                        />
                        {touched && problem &&
                            <FormHelperText>
                                <HelperText>
                                    <HelperTextItem variant="error">{nameProblemText(problem)}</HelperTextItem>
                                </HelperText>
                            </FormHelperText>}
                    </FormGroup>
                </Form>
            </ModalBody>
            <ModalFooter>
                <Button variant="primary" onClick={() => submit()} isDisabled={busy || !!problem} isLoading={busy}>
                    {submitLabel}
                </Button>
                <Button variant="link" onClick={onClose}>{_("Cancel")}</Button>
            </ModalFooter>
        </Modal>
    );
}

export interface DeleteItem {
    path: string;
    isDir: boolean;
}

/* Confirmation that lists every full path and, for folders, how many items
 * they contain. */
export function DeleteDialog({ items, refusal, count, onDelete, onClose }: {
    items: DeleteItem[],
    refusal: string | null,
    count: (path: string) => Promise<number>,
    onDelete: () => Promise<void>,
    onClose: () => void,
}) {
    const [counts, setCounts] = useState<Record<string, number | string>>({});
    const { busy, error, run } = useAction(onClose);

    useEffect(() => {
        if (refusal)
            return;
        for (const item of items.filter(i => i.isDir)) {
            count(item.path).then(n => setCounts(c => ({ ...c, [item.path]: n })),
                                  err => setCounts(c => ({ ...c, [item.path]: opErrorText(err) })));
        }
    }, [items, refusal, count]);

    const pending = items.some(i => i.isDir && counts[i.path] === undefined);
    const describe = (item: DeleteItem) => {
        if (!item.isDir)
            return _("file");
        const c = counts[item.path];
        if (c === undefined)
            return _("counting items…");
        if (typeof c === 'string')
            return c;
        return cockpit.format(cockpit.ngettext("folder with $0 item", "folder with $0 items", c), c);
    };
    const title = cockpit.format(cockpit.ngettext("Delete $0 item?", "Delete $0 items?", items.length), items.length);

    return (
        <Modal isOpen onClose={onClose} variant="medium" aria-labelledby="pe-delete-dialog">
            <ModalHeader title={title} titleIconVariant="warning" labelId="pe-delete-dialog" />
            <ModalBody>
                {refusal && <Alert variant="danger" isInline title={refusal} className="pe-dialog-alert" />}
                {error && <Alert variant="danger" isInline title={error} className="pe-dialog-alert" />}
                {!refusal &&
                    <>
                        <p className="pe-dialog-text">{_("The following will be permanently deleted. This cannot be undone.")}</p>
                        <List className="pe-delete-list">
                            {items.map(item =>
                                <ListItem key={item.path}>
                                    <code className="pe-path">{item.path}</code>
                                    <span className="pe-delete-count"> — {describe(item)}</span>
                                </ListItem>)}
                        </List>
                    </>}
            </ModalBody>
            <ModalFooter>
                {!refusal &&
                    <Button variant="danger" onClick={() => run(onDelete)} isDisabled={busy || pending} isLoading={busy}>
                        {_("Delete")}
                    </Button>}
                <Button variant="link" onClick={onClose}>{_("Cancel")}</Button>
            </ModalFooter>
        </Modal>
    );
}

/* Choose a target folder by browsing folders. */
export function MoveDialog({ start, count, onMove, onClose }: {
    start: string, count: number, onMove: (target: string) => Promise<void>, onClose: () => void,
}) {
    const [dir, setDir] = useState(start);
    const [folders, setFolders] = useState<string[] | null>(null);
    const [listError, setListError] = useState<string | null>(null);
    const { busy, error, run } = useAction(onClose);

    useEffect(() => {
        let cancelled = false;
        setFolders(null);
        setListError(null);
        readFolder(dir).then(info => {
            if (cancelled)
                return;
            const names = Object.keys(info.entries ?? {})
                    .filter(n => resolveEntry(info, n)?.type === 'dir')
                    .map(name => ({ name, isDir: true }))
                    .sort(compareEntries)
                    .map(e => e.name);
            setFolders(names);
        }, err => {
            if (!cancelled)
                setListError(err?.message || String(err?.problem ?? err));
        });
        return () => { cancelled = true };
    }, [dir]);

    const title = cockpit.format(cockpit.ngettext("Move $0 item to…", "Move $0 items to…", count), count);

    return (
        <Modal isOpen onClose={onClose} variant="medium" aria-labelledby="pe-move-dialog">
            <ModalHeader title={title} labelId="pe-move-dialog" />
            <ModalBody>
                {error && <Alert variant="danger" isInline title={error} className="pe-dialog-alert" />}
                <div className="pe-picker-head">
                    <Button
                        variant="plain" aria-label={_("Parent folder")} isDisabled={dir === '/'}
                        onClick={() => setDir(dirname(dir))} icon={<LevelUpAltIcon />}
                    />
                    <Breadcrumb>
                        {breadcrumbs(dir).map(c =>
                            <BreadcrumbItem
                                key={c.path} isActive={c.path === dir}
                                onClick={() => setDir(c.path)} component="button"
                            >
                                {c.path === '/' ? _("Root") : c.name}
                            </BreadcrumbItem>)}
                    </Breadcrumb>
                </div>
                <div className="pe-picker-list">
                    {listError && <Alert variant="warning" isInline isPlain title={listError} />}
                    {!listError && folders === null && <Spinner size="md" />}
                    {folders?.length === 0 && <p className="pe-muted">{_("No subfolders")}</p>}
                    {folders?.map(name =>
                        <Button
                            key={name} variant="plain" className="pe-picker-item" icon={<FolderIcon />}
                            onClick={() => setDir(childPath(dir, name))}
                        >
                            {name}
                        </Button>)}
                </div>
            </ModalBody>
            <ModalFooter>
                <Button
                    variant="primary" onClick={() => run(() => onMove(dir))}
                    isDisabled={busy || dir === normalizePath(start)} isLoading={busy}
                >
                    {_("Move here")}
                </Button>
                <Button variant="link" onClick={onClose}>{_("Cancel")}</Button>
            </ModalFooter>
        </Modal>
    );
}

/* Uploads whose name already exists: replace them or skip them. */
export function OverwriteDialog({ names, onReplace, onSkip, onClose }: {
    names: string[], onReplace: () => void, onSkip: () => void, onClose: () => void,
}) {
    const title = cockpit.ngettext("Replace existing file?", "Replace existing files?", names.length);
    return (
        <Modal isOpen onClose={onClose} variant="small" aria-labelledby="pe-overwrite-dialog">
            <ModalHeader title={title} titleIconVariant="warning" labelId="pe-overwrite-dialog" />
            <ModalBody>
                <p className="pe-dialog-text">{_("These names already exist in this folder:")}</p>
                <List>{names.map(n => <ListItem key={n}><code className="pe-path">{n}</code></ListItem>)}</List>
            </ModalBody>
            <ModalFooter>
                <Button variant="danger" onClick={onReplace}>{_("Replace")}</Button>
                <Button variant="secondary" onClick={onSkip}>{_("Skip these")}</Button>
                <Button variant="link" onClick={onClose}>{_("Cancel")}</Button>
            </ModalFooter>
        </Modal>
    );
}

/* Add a shortcut to the "Files" or the "Location" section. */
export function AddShortcutDialog({ initialPath, onAdd, onClose }: {
    initialPath: string,
    onAdd: (section: 'shortcuts' | 'locations', name: string, path: string) => Promise<void>,
    onClose: () => void,
}) {
    const [path, setPath] = useState(initialPath);
    const [name, setName] = useState(initialPath === '/' ? '' : initialPath.slice(initialPath.lastIndexOf('/') + 1));
    const [section, setSection] = useState<'shortcuts' | 'locations'>('locations');
    const { busy, error, run } = useAction(onClose);

    let pathError: string | null = null;
    try {
        normalizePath(path);
    } catch {
        pathError = _("Enter an absolute path, starting with \"/\".");
    }
    const nameError = name.trim() ? null : _("Enter a name.");

    return (
        <Modal isOpen onClose={onClose} variant="small" aria-labelledby="pe-add-dialog">
            <ModalHeader title={_("Add location")} labelId="pe-add-dialog" />
            <ModalBody>
                {error && <Alert variant="danger" isInline title={error} className="pe-dialog-alert" />}
                <Form onSubmit={ev => ev.preventDefault()}>
                    <FormGroup label={_("Name")} fieldId="pe-add-name">
                        <TextInput
                            id="pe-add-name" value={name} maxLength={64}
                            onChange={(_ev, v) => setName(v)}
                        />
                    </FormGroup>
                    <FormGroup label={_("Path")} fieldId="pe-add-path">
                        <TextInput
                            id="pe-add-path" value={path} validated={pathError ? 'error' : 'default'}
                            onChange={(_ev, v) => setPath(v)}
                        />
                        {pathError &&
                            <FormHelperText>
                                <HelperText><HelperTextItem variant="error">{pathError}</HelperTextItem></HelperText>
                            </FormHelperText>}
                    </FormGroup>
                    <FormGroup label={_("Show under")} role="radiogroup" fieldId="pe-add-section" isInline>
                        <Radio
                            id="pe-add-locations" name="pe-add-section" label={_("Location")}
                            isChecked={section === 'locations'} onChange={() => setSection('locations')}
                        />
                        <Radio
                            id="pe-add-shortcuts" name="pe-add-section" label={_("Files")}
                            isChecked={section === 'shortcuts'} onChange={() => setSection('shortcuts')}
                        />
                    </FormGroup>
                </Form>
            </ModalBody>
            <ModalFooter>
                <Button
                    variant="primary" isDisabled={busy || !!pathError || !!nameError} isLoading={busy}
                    onClick={() => run(() => onAdd(section, name.trim(), normalizePath(path)))}
                >
                    {_("Add")}
                </Button>
                <Button variant="link" onClick={onClose}>{_("Cancel")}</Button>
            </ModalFooter>
        </Modal>
    );
}
