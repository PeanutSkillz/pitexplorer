// SPDX-License-Identifier: LGPL-2.1-or-later

import React from 'react';
import cockpit from 'cockpit';

import { Button } from '@patternfly/react-core/dist/esm/components/Button/index.js';
import { HddIcon } from '@patternfly/react-icons/dist/esm/icons/hdd-icon';
import { PlusIcon } from '@patternfly/react-icons/dist/esm/icons/plus-icon';
import { TimesIcon } from '@patternfly/react-icons/dist/esm/icons/times-icon';

import type { Shortcut } from '../lib/cockpit-fs';
import { shortcutIcon } from './icons';

const _ = cockpit.gettext;

export interface SidebarEntry extends Shortcut {
    // set for entries the user added and can remove again
    removable?: 'shortcuts' | 'locations';
    isMount?: boolean;
}

function Item({ entry, current, onOpen, onRemove }: {
    entry: SidebarEntry, current: string,
    onOpen: (path: string) => void, onRemove: (entry: SidebarEntry) => void,
}) {
    const Icon = entry.isMount ? HddIcon : shortcutIcon(entry.path);
    const active = current === entry.path;
    return (
        <li className={'pe-side-item' + (active ? ' pe-active' : '')}>
            <button
                type="button" className="pe-side-link" title={entry.path}
                aria-current={active ? 'page' : undefined} onClick={() => onOpen(entry.path)}
            >
                <Icon className="pe-side-icon" aria-hidden />
                <span className="pe-side-name">{entry.name}</span>
            </button>
            {entry.removable &&
                <Button
                    variant="plain" size="sm" className="pe-side-remove" icon={<TimesIcon />}
                    aria-label={cockpit.format(_("Remove $0"), entry.name)}
                    onClick={() => onRemove(entry)}
                />}
        </li>
    );
}

export function Sidebar({ shortcuts, locations, current, onOpen, onAdd, onRemove }: {
    shortcuts: SidebarEntry[], locations: SidebarEntry[], current: string,
    onOpen: (path: string) => void, onAdd: () => void, onRemove: (entry: SidebarEntry) => void,
}) {
    return (
        <nav className="pe-sidebar" aria-label={_("Folders")}>
            <h2 className="pe-side-title">{_("Files")}</h2>
            <ul className="pe-side-list">
                {shortcuts.map(e => <Item key={'s' + e.path} entry={e} current={current} onOpen={onOpen} onRemove={onRemove} />)}
            </ul>
            <div className="pe-side-title pe-side-title-row">
                <h2>{_("Location")}</h2>
                <Button variant="plain" size="sm" icon={<PlusIcon />} aria-label={_("Add location")} onClick={onAdd} />
            </div>
            <ul className="pe-side-list">
                {locations.map(e => <Item key={'l' + e.path} entry={e} current={current} onOpen={onOpen} onRemove={onRemove} />)}
            </ul>
        </nav>
    );
}
