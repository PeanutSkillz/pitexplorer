# PitExplorer

A file browser for the [Cockpit](https://cockpit-project.org) web console.
PitExplorer adds one page, **Files**, to the Cockpit menu ("Bestanden" when
Cockpit is set to Dutch):

* a sidebar with shortcuts (Root, `/DATA` and its `Documents`, `Downloads`,
  `Gallery` and `Media` folders when they exist) and a **Location** list with
  the mounted file systems; you can add your own entries with **+** and
  remove them again
* a breadcrumb, a grid view with large folder icons and a list view with
  size and modification date ("27 oktober om 23:30")
* select one or more items, or all of them, and download, rename, move or
  delete them; create folders and upload files with **Upload or create**

It is a separate Cockpit package: install it alone or next to other Cockpit
add-ons.

## Requirements

* Cockpit 314 or newer (`cockpit-ws` and `cockpit-bridge`); tested with
  Cockpit 314 on Ubuntu 24.04
* `findmnt` (util-linux) and GNU coreutils, which every supported
  distribution has

## Installation from source

Building needs Node.js 20 or newer, npm, git and make.

```sh
git clone https://github.com/PeanutSkillz/pitexplorer.git
cd pitexplorer
NODE_ENV=production make  # npm ci, Cockpit's build helpers, minified build
```

Then install it for **all users**:

```sh
sudo make install PREFIX=/usr     # copies dist/ to /usr/share/cockpit/pitexplorer
```

or for **your own account only**, without root:

```sh
make devel-install        # symlink ~/.local/share/cockpit/pitexplorer -> dist/
make devel-uninstall      # removes that symlink again
```

Log in to Cockpit again (or reload the page) and open **Files** in the menu.
To uninstall a system-wide installation, remove
`/usr/share/cockpit/pitexplorer`.

## Security

PitExplorer has no backend of its own: no daemon, no web server and no
open port. Everything runs through the Cockpit bridge of your login session.

* **Your own rights by default.** Listing, reading and changing files runs as
  the logged-in user. Cockpit's administrative access is only used when you
  ask for it, per action: after "Permission denied" an alert offers
  **Retry as administrator** for that action, and a folder you may not read
  offers **Open as administrator** (shown with an "Administrator" label that
  you can switch off). Both only appear when Cockpit's administrative access
  is turned on; Cockpit itself stays in charge of who may use it.
* **No shell.** Every command is started with an argument array
  (`cockpit.spawn([...])`), never through `sh -c` or a command string.
  `--` ends the options in front of every path for `mkdir`, `mv`, `rm` and
  `stat`; `find` only ever gets absolute paths.
* **Validated names and paths.** A name may not be empty, `.` or `..`, and
  may not contain `/`, NUL or control characters (so `../x` and `a/b` are
  refused); paths are normalized before use and every new path is built as
  a direct child of its folder.
* **Protected paths.** `/`, `/DATA` and every mount point can never be
  deleted, moved or renamed, and a folder that contains a mount point cannot
  be deleted. `rm` runs with `--one-file-system` and `--preserve-root`.
* **Confirmed deletion.** The delete dialog lists the full path of every
  item and, for folders, how many items they contain.
* **Safe uploads.** A file is written to a hidden temporary name in the
  target folder (`.NAME.pitexplorer-upload-RANDOM.part`, through Cockpit's
  `fsreplace1` channel, which refuses to replace an existing file) and then
  renamed. An existing file is only replaced after you confirm it; otherwise
  the rename uses `mv -n` and is checked afterwards. The temporary file is
  removed when anything fails.
* **Moves and renames never overwrite** existing entries.
* **Streaming downloads** go through a Cockpit channel URL of your session;
  nothing is stored outside the browser's download.
* **Errors are shown**, never ignored: permission denied, not found, already
  exists and other failures appear as messages.
* Shortcuts are stored per user in `~/.config/pitexplorer/settings.json`
  (folder created with mode 0700); the view choice (grid/list) is kept in the
  browser.

## Development

```sh
make check                # eslint, stylelint, TypeScript, unit tests
npm run build             # development build into dist/
make watch                # rebuild on changes
```

The unit tests (`test/unit/`) run the file operations against a real
temporary folder with the same argument arrays Cockpit would run, and check
that invalid names are refused, protected paths are never touched and that
no command uses a shell. `test/vm/` and `test/browser/` contain a browser
test for a throwaway test VM (never a real server): `setup-vm.sh` prepares
the VM, `run-test.sh` installs the build and runs `check_files.py`;
`check_coexist.py` checks PitExplorer next to another add-on (PitStore).

Translations use Cockpit's gettext: the source strings are English, the Dutch
translation is `po/nl.po`. A unit test checks that every string in `src/`
has a Dutch translation.

## License

LGPL-2.1-or-later, see [LICENSE](LICENSE).
