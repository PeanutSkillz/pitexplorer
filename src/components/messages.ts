// SPDX-License-Identifier: LGPL-2.1-or-later

import cockpit from 'cockpit';

import type { ListError } from '../lib/cockpit-fs';
import { OpError } from '../lib/ops';
import type { NameProblem } from '../lib/paths';

const _ = cockpit.gettext;

export function nameProblemText(problem: NameProblem): string {
    switch (problem) {
    case 'empty': return _("Enter a name.");
    case 'dot': return _("\".\" and \"..\" are not allowed as a name.");
    case 'slash': return _("A name cannot contain \"/\".");
    case 'nul': return _("A name cannot contain a NUL character.");
    case 'control': return _("A name cannot contain control characters such as line breaks.");
    case 'too-long': return _("The name is too long.");
    }
}

export function opErrorText(err: unknown): string {
    if (!(err instanceof OpError))
        return String((err as Error)?.message ?? err);
    const p = err.path;
    switch (err.code) {
    case 'denied': return cockpit.format(_("Permission denied: $0"), p);
    case 'not-found': return cockpit.format(_("Not found: $0"), p);
    case 'exists': return cockpit.format(_("Already exists: $0"), p);
    case 'protected': return cockpit.format(_("$0 is protected and cannot be changed."), p);
    case 'contains-mount': return cockpit.format(_("$0 contains a mounted file system and cannot be deleted."), p);
    case 'invalid-name': return cockpit.format(_("Invalid name: $0"), p);
    case 'into-itself': return cockpit.format(_("A folder cannot be moved into itself: $0"), p);
    default: return cockpit.format(_("$0: $1"), p, err.message || _("Unknown error"));
    }
}

export function isDenied(err: unknown): boolean {
    return err instanceof OpError && err.code === 'denied';
}

export function listErrorDenied(error: ListError): boolean {
    return error.errno === 'EACCES' || error.errno === 'EPERM' || error.problem === 'access-denied';
}

export function listErrorText(error: ListError, path: string): string {
    if (listErrorDenied(error))
        return cockpit.format(_("Permission denied: $0"), path);
    if (error.errno === 'ENOENT' || error.problem === 'not-found')
        return cockpit.format(_("Not found: $0"), path);
    if (error.errno === 'ENOTDIR')
        return cockpit.format(_("Not a folder: $0"), path);
    return cockpit.format(_("$0: $1"), path, error.message || error.problem || _("Unknown error"));
}
