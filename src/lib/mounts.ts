// SPDX-License-Identifier: LGPL-2.1-or-later
//
// Mounted file systems for the "Location" list, parsed from
// `findmnt --json --list --output TARGET,FSTYPE,SOURCE`.

// virtual, in-memory and container file systems that are not storage locations
const PSEUDO_FS = new Set([
    'autofs', 'binfmt_misc', 'bpf', 'cgroup', 'cgroup2', 'configfs', 'debugfs', 'devpts', 'devtmpfs',
    'efivarfs', 'fusectl', 'hugetlbfs', 'mqueue', 'nsfs', 'overlay', 'proc', 'pstore', 'ramfs',
    'rpc_pipefs', 'securityfs', 'selinuxfs', 'squashfs', 'sysfs', 'tmpfs', 'tracefs', 'nfsd',
    'fuse.gvfsd-fuse', 'fuse.portal', 'fuse.lxcfs', 'zram',
]);

// system trees whose mounts are never storage locations
const PSEUDO_PREFIXES = ['/proc', '/sys', '/dev', '/run', '/snap', '/var/lib/docker', '/var/lib/containers'];

export interface Mount {
    target: string;
    fstype: string;
    source: string;
}

function under(path: string, prefix: string) {
    return path === prefix || path.startsWith(prefix + '/');
}

/* All real mount points (including "/"), sorted, without duplicates. */
export function parseFindmnt(json: string): Mount[] {
    let data: unknown;
    try {
        data = JSON.parse(json);
    } catch {
        return [];
    }
    const list = (data as { filesystems?: unknown })?.filesystems;
    if (!Array.isArray(list))
        return [];

    const seen = new Map<string, Mount>();
    for (const fs of list) {
        const target = typeof fs?.target === 'string' ? fs.target : '';
        const fstype = typeof fs?.fstype === 'string' ? fs.fstype : '';
        const source = typeof fs?.source === 'string' ? fs.source : '';
        if (!target.startsWith('/') || target.includes('\0') || PSEUDO_FS.has(fstype))
            continue;
        if (PSEUDO_PREFIXES.some(p => under(target, p)))
            continue;
        if (!seen.has(target))
            seen.set(target, { target, fstype, source });
    }
    return [...seen.values()].sort((a, b) => a.target.localeCompare(b.target));
}
