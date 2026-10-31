// SPDX-License-Identifier: LGPL-2.1-or-later

import React from 'react';
import { createRoot } from 'react-dom/client';

import "cockpit-dark-theme";
import "patternfly/patternfly-6-cockpit.scss";
import './app.scss';

import { FilesPage } from './components/FilesPage';

document.addEventListener("DOMContentLoaded", () => {
    createRoot(document.getElementById("app")!).render(<FilesPage />);
});
