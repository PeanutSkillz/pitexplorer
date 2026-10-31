#!/bin/sh
# SPDX-License-Identifier: LGPL-2.1-or-later
#
# Inside the test VM (after setup-vm.sh): install the built plugin system wide
# like `make install-dist PREFIX=/usr` does, then run the browser test.
#
#     sh test/vm/run-test.sh DIST_DIR OUTDIR
set -eu
dist=$1
out=$2
sudo rm -rf /usr/share/cockpit/pitexplorer
sudo mkdir -p /usr/share/cockpit/pitexplorer
sudo cp -r "$dist"/* /usr/share/cockpit/pitexplorer/
sudo rm -f /usr/share/cockpit/pitexplorer/*.LEGAL.txt
ls /usr/share/cockpit/pitexplorer
python3 "$(dirname "$0")/../browser/check_files.py" "$out"
