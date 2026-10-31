// SPDX-License-Identifier: LGPL-2.1-or-later

import React from 'react';

import { CubeIcon } from '@patternfly/react-icons/dist/esm/icons/cube-icon';
import { DatabaseIcon } from '@patternfly/react-icons/dist/esm/icons/database-icon';
import { DownloadIcon } from '@patternfly/react-icons/dist/esm/icons/download-icon';
import { FileAltIcon } from '@patternfly/react-icons/dist/esm/icons/file-alt-icon';
import { FileArchiveIcon } from '@patternfly/react-icons/dist/esm/icons/file-archive-icon';
import { FileAudioIcon } from '@patternfly/react-icons/dist/esm/icons/file-audio-icon';
import { FileCodeIcon } from '@patternfly/react-icons/dist/esm/icons/file-code-icon';
import { FileIcon } from '@patternfly/react-icons/dist/esm/icons/file-icon';
import { FileImageIcon } from '@patternfly/react-icons/dist/esm/icons/file-image-icon';
import { FilePdfIcon } from '@patternfly/react-icons/dist/esm/icons/file-pdf-icon';
import { FileVideoIcon } from '@patternfly/react-icons/dist/esm/icons/file-video-icon';
import { FolderIcon } from '@patternfly/react-icons/dist/esm/icons/folder-icon';
import { HomeIcon } from '@patternfly/react-icons/dist/esm/icons/home-icon';
import { ImageIcon } from '@patternfly/react-icons/dist/esm/icons/image-icon';
import { LinkIcon } from '@patternfly/react-icons/dist/esm/icons/link-icon';
import { PlayIcon } from '@patternfly/react-icons/dist/esm/icons/play-icon';

import type { SVGIconProps } from '@patternfly/react-icons/dist/esm/createIcon';

import type { EntryKind } from '../lib/format';

type IconType = React.ComponentType<SVGIconProps>;

// glyphs on well-known folders, by folder name
const FOLDER_GLYPHS: Record<string, IconType> = {
    appdata: CubeIcon,
    documents: FileAltIcon,
    downloads: DownloadIcon,
    gallery: ImageIcon,
    pictures: ImageIcon,
    media: PlayIcon,
    videos: PlayIcon,
};

const FILE_ICONS: Record<Exclude<EntryKind, 'folder'>, IconType> = {
    image: FileImageIcon,
    video: FileVideoIcon,
    audio: FileAudioIcon,
    archive: FileArchiveIcon,
    pdf: FilePdfIcon,
    code: FileCodeIcon,
    text: FileAltIcon,
    file: FileIcon,
};

/* Large folder picture: a folder shape with a glyph for well-known folders. */
function BigFolder({ name }: { name: string }) {
    const Glyph = FOLDER_GLYPHS[name.toLowerCase()];
    return (
        <span className="pe-bigfolder" aria-hidden>
            <svg viewBox="0 0 96 76" className="pe-bigfolder-shape">
                <path className="pe-bigfolder-back" d="M4 8a6 6 0 0 1 6-6h24l8 8h44a6 6 0 0 1 6 6v6H4z" />
                <rect className="pe-bigfolder-front" x="2" y="16" width="92" height="58" rx="5" />
            </svg>
            {Glyph && <Glyph className="pe-bigfolder-glyph" aria-hidden />}
        </span>
    );
}

export function EntryIcon({ name, kind, isLink, size }: {
    name: string, kind: EntryKind, isLink: boolean, size: 'large' | 'small'
}) {
    let icon: React.ReactNode;
    if (kind === 'folder') {
        icon = size === 'large' ? <BigFolder name={name} /> : <FolderIcon className="pe-icon-folder" aria-hidden />;
    } else {
        const Icon = FILE_ICONS[kind];
        icon = <Icon className={`pe-icon-file pe-icon-${kind}`} aria-hidden />;
    }
    return (
        <span className={`pe-entry-icon pe-entry-icon-${size}`}>
            {icon}
            {isLink && <LinkIcon className="pe-link-badge" aria-hidden />}
        </span>
    );
}

export function shortcutIcon(path: string): IconType {
    if (path === '/')
        return HomeIcon;
    if (path === '/DATA')
        return DatabaseIcon;
    return FOLDER_GLYPHS[path.slice(path.lastIndexOf('/') + 1).toLowerCase()] ?? FolderIcon;
}
