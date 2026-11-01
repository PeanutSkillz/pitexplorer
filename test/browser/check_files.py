#!/usr/bin/python3
# SPDX-License-Identifier: LGPL-2.1-or-later
"""Browser test of PitExplorer in a test VM prepared by test/vm/setup-vm.sh,
with the plugin installed. Runs headless Chromium through Cockpit's
WebDriver BiDi driver (test/common/webdriver_bidi.py) and checks the result
of every action on the file system as well.

    python3 check_files.py OUTDIR

Run as the VM's default user (ubuntu); setup-vm.sh leaves copies of the test
passwords in ~ubuntu/pe-pw/ for it.
"""

import asyncio
import base64
import os
import re
import subprocess
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "common"))
from webdriver_bidi import ChromiumBidi  # noqa: E402

BASE = os.environ.get("PITEXPLORER_TEST_BASE", "https://localhost:9090").rstrip("/")
FRAME = "cockpit1:localhost/pitexplorer"
# an empty folder under /DATA; the test user owns it during the test
DOCS = Path(os.environ.get("PE_TEST_DIR", "/DATA/Documents"))
USER = os.environ.get("PE_USER", "pe-auto")
ADMIN = os.environ.get("PE_ADMIN", "pe-auto-admin")
OUT = Path(".")


def password(user):
    return (Path.home() / "pe-pw" / f"{user}.pw").read_text().strip()


async def js(browser, code, *args):
    result = await browser.bidi("script.callFunction", functionDeclaration=code,
                                arguments=[{"type": "string", "value": str(a)} for a in args],
                                awaitPromise=True, target={"context": browser.context}, quiet=True)
    return result["result"]


async def shot(browser, name):
    data = await browser.bidi("browsingContext.captureScreenshot", context=browser.top_context, quiet=True)
    (OUT / f"{name}.png").write_bytes(base64.b64decode(data["data"]))


async def wait(browser, code, *args, timeout=30, what=None):
    loop = asyncio.get_running_loop()
    deadline = loop.time() + timeout
    while loop.time() < deadline:
        try:
            if await js(browser, code, *args):
                return
        except Exception:
            pass
        await asyncio.sleep(0.25)
    await shot(browser, "timeout")
    raise SystemExit(f"FAILED: {what or code} (screenshot timeout.png)")


async def wait_fs(check, what, timeout=15):
    for _ in range(timeout * 4):
        if check():
            return
        await asyncio.sleep(0.25)
    raise SystemExit(f"FAILED: {what}")


def ok(msg):
    print(f"ok   {msg}")


CLICK_TEXT = """(text, scope) => {
    const root = scope ? document.querySelector(scope) : document;
    if (!root) return false;
    const b = [...root.querySelectorAll('button, a, [role=menuitem]')]
        .find(e => e.textContent.trim() === text && !e.disabled && e.getAttribute('aria-disabled') !== 'true');
    if (!b) return false;
    b.click();
    return true;
}"""

SET_VALUE = """(selector, value) => {
    const el = document.querySelector(selector);
    if (!el) return false;
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(el, value);
    el.dispatchEvent(new Event('input', { bubbles: true }));
    return true;
}"""

CLICK = """(selector) => { const el = document.querySelector(selector); if (!el) return false; el.click(); return true; }"""

TEXT = """(selector) => document.querySelector(selector)?.innerText ?? ''"""

MODAL = ".pf-v6-c-modal-box"


async def click_text(browser, text, scope=None):
    await wait(browser, CLICK_TEXT, text, scope or "", what=f"click {text!r}")


async def click(browser, selector):
    await wait(browser, CLICK, selector, what=f"click {selector}")


async def text(browser, selector):
    return await js(browser, TEXT, selector)


async def has_text(browser, selector, needle, timeout=30):
    await wait(browser, "(s, t) => (document.querySelector(s)?.innerText ?? '').includes(t)", selector, needle,
               timeout=timeout, what=f"{selector} shows {needle!r}")


async def tiles(browser):
    return await js(browser, "() => [...document.querySelectorAll('.pe-tile-name')].map(e => e.textContent).join('|')")


async def login(browser, user, admin=False):
    await browser.bidi("browsingContext.navigate", context=browser.top_context, url=f"{BASE}/",
                       wait="complete", timeout=60)
    browser.switch_to_top()
    await wait(browser, "() => document.getElementById('login-button')?.offsetParent !== null")
    # Dutch user interface; administrative access right after login for the admin user
    await js(browser, """(user, admin) => {
        document.cookie = 'CockpitLang=nl; path=/; secure';
        localStorage.setItem('cockpit.lang', 'nl');
        if (admin === 'yes') localStorage.setItem('superuser:' + user, 'any');
        return true;
    }""", user, "yes" if admin else "no")
    await browser.bidi("browsingContext.reload", context=browser.top_context, wait="complete", timeout=60)
    await wait(browser, "() => document.getElementById('login-button')?.offsetParent !== null")
    await js(browser, """(user, pw) => {
        document.getElementById('login-user-input').value = user;
        document.getElementById('login-password-input').value = pw;
        document.getElementById('login-button').click();
        return true;
    }""", user, password(user))
    await wait(browser, "() => !!document.querySelector('#host-apps, nav')", timeout=60, what="logged in")


async def open_page(browser, path=None):
    browser.switch_to_top()
    url = f"{BASE}/pitexplorer" + (f"#/?path={path}" if path else "")
    await browser.bidi("browsingContext.navigate", context=browser.top_context, url=url, wait="complete", timeout=60)
    await wait(browser, f"() => !!document.querySelector(\"iframe[name='{FRAME}']\")")
    await browser.switch_to_frame(FRAME)
    await wait(browser, "() => !!document.querySelector('.pe-app')", what="page rendered")


async def name_dialog(browser, value):
    await wait(browser, f"() => !!document.querySelector('{MODAL} #pe-name')")
    await js(browser, SET_VALUE, "#pe-name", value)


async def upload(browser, path):
    node = await browser.bidi("browsingContext.locateNodes", context=browser.context,
                              locator={"type": "css", "value": "input[type=file]"}, quiet=True)
    await browser.bidi("input.setFiles", context=browser.context, element=node["nodes"][0], files=[str(path)])


async def user_session(browser):
    await login(browser, USER)
    menu_js = "() => [...document.querySelectorAll('#host-apps a, nav a')].map(a => a.textContent.trim()).join('|')"
    await wait(browser, f"() => ({menu_js})().split('|').includes('Bestanden')", timeout=30,
               what="'Bestanden' in the Cockpit menu")
    await shot(browser, "00-menu")
    ok("menu entry 'Bestanden' in the Cockpit navigation")

    # 1. start at /DATA: grid, sidebar, counter, Dutch dates
    await open_page(browser)
    await wait(browser, "() => document.querySelectorAll('.pe-tile').length === 5", what="5 folders in /DATA")
    assert await tiles(browser) == "AppData|Documents|Downloads|Gallery|Media", await tiles(browser)
    await has_text(browser, ".pe-toolbar", "In totaal 5 items")
    meta = await js(browser, "() => document.querySelector('.pe-tile-meta').textContent")
    months = "januari|februari|maart|april|mei|juni|juli|augustus|september|oktober|november|december"
    if not re.fullmatch(rf"\d{{1,2}} ({months})( \d{{4}})? om \d\d:\d\d", meta):
        raise SystemExit(f"FAILED: date {meta!r}")
    ok(f"/DATA: 5 folders in a grid, 'In totaal 5 items', date '{meta}'")
    side = await text(browser, ".pe-sidebar")
    for label in ["Bestanden", "Root", "DATA", "Documents", "Downloads", "Gallery", "Media", "Locatie", "boot", "efi",
                  "storage"]:
        if label not in side.split("\n"):
            raise SystemExit(f"FAILED: sidebar lacks {label!r}: {side!r}")
    ok("sidebar: Root, DATA, the four /DATA folders; Locatie: boot, efi, storage")
    await asyncio.sleep(1)
    await shot(browser, "01-grid-data")

    # 2. navigate by tile and breadcrumb
    await click(browser, f".pe-tile-main[title='{DOCS.name}']")
    await has_text(browser, ".pe-crumbs", DOCS.name)
    await has_text(browser, ".pe-content", "Deze map is leeg")
    ok(f"open folder by tile; breadcrumb Root > DATA > {DOCS.name}; empty folder message")

    # 3. new folder; invalid names are refused
    await click_text(browser, "Uploaden of aanmaken")
    await click_text(browser, "Nieuwe map")
    for bad, msg in [("a/b", 'geen "/"'), ("../x", 'geen "/"'), ("..", "niet toegestaan")]:
        await name_dialog(browser, bad)
        await has_text(browser, MODAL, msg)
        disabled = await js(browser, f"() => [...document.querySelectorAll('{MODAL} button')].find(b => b.textContent === 'Aanmaken').disabled")
        if not disabled:
            raise SystemExit(f"FAILED: create button enabled for {bad!r}")
    ok("new folder: 'a/b', '../x' and '..' are refused with a message, button disabled")
    await shot(browser, "02-invalid-name")
    await name_dialog(browser, "test-map")
    await click_text(browser, "Aanmaken", MODAL)
    await wait(browser, "() => !!document.querySelector(\".pe-tile-main[title='test-map']\")")
    await wait_fs(lambda: (DOCS / "test-map").is_dir(), "test-map created")
    if any(p.name in ("a", "x", "a/b") for p in DOCS.parent.iterdir()) or (DOCS / "a").exists():
        raise SystemExit("FAILED: an invalid name created something")
    ok("new folder 'test-map' created on disk")

    # 4. rename
    await click(browser, "input[aria-label='test-map selecteren']")
    await click_text(browser, "Hernoemen")
    await name_dialog(browser, "hernoemd")
    await click_text(browser, "Hernoemen", MODAL)
    await wait_fs(lambda: (DOCS / "hernoemd").is_dir() and not (DOCS / "test-map").exists(), "renamed")
    ok("rename test-map -> hernoemd")

    # 5. upload, conflict: skip, conflict: replace
    src = Path("/tmp/pe-upload")
    (src / "a").mkdir(parents=True, exist_ok=True)
    (src / "b").mkdir(parents=True, exist_ok=True)
    (src / "a" / "hallo.txt").write_text("versie 1\n")
    (src / "b" / "hallo.txt").write_text("versie 2\n")
    await upload(browser, src / "a" / "hallo.txt")
    await wait_fs(lambda: (DOCS / "hallo.txt").is_file() and (DOCS / "hallo.txt").read_text() == "versie 1\n", "uploaded")
    leftovers = [p.name for p in DOCS.iterdir() if p.name.endswith(".part")]
    if leftovers:
        raise SystemExit(f"FAILED: temporary upload files left: {leftovers}")
    await wait(browser, "() => !!document.querySelector(\".pe-tile-main[title='hallo.txt']\")")
    ok("upload hallo.txt (temporary name, then renamed; nothing left behind)")
    await upload(browser, src / "b" / "hallo.txt")
    await has_text(browser, MODAL, "Bestaand bestand vervangen?")
    await shot(browser, "03-overwrite")
    await click_text(browser, "Deze overslaan", MODAL)
    await asyncio.sleep(2)
    if (DOCS / "hallo.txt").read_text() != "versie 1\n":
        raise SystemExit("FAILED: file replaced although skipped")
    ok("upload of an existing name asks first; 'Deze overslaan' keeps the file")
    await upload(browser, src / "b" / "hallo.txt")
    await click_text(browser, "Vervangen", MODAL)
    await wait_fs(lambda: (DOCS / "hallo.txt").read_text() == "versie 2\n", "replaced")
    ok("'Vervangen' replaces the file after confirmation")

    # 6. download (the URL the page creates is fetched by the test)
    await js(browser, """() => {
        window.__downloads = [];
        HTMLAnchorElement.prototype.click = function () { window.__downloads.push(this.href); };
        return true;
    }""")
    await click(browser, "input[aria-label='hallo.txt selecteren']")
    await click_text(browser, "Downloaden")
    body = await js(browser, "async () => { const r = await fetch(window.__downloads[0]); "
                             "return r.headers.get('content-disposition') + '|' + await r.text(); }")
    if body != "attachment; filename*=UTF-8''hallo.txt|versie 2\n":
        raise SystemExit(f"FAILED: download returned {body!r}")
    ok("download streams the file with content-disposition attachment")

    # 7. move into a folder
    await click_text(browser, "Verplaatsen naar…")
    await wait(browser, f"() => !!document.querySelector('{MODAL} .pe-picker-item')")
    await click_text(browser, "hernoemd", MODAL)
    await has_text(browser, f"{MODAL} .pf-v6-c-breadcrumb", "hernoemd")
    await shot(browser, "04-move")
    await click_text(browser, "Hierheen verplaatsen", MODAL)
    await wait_fs(lambda: (DOCS / "hernoemd" / "hallo.txt").is_file() and not (DOCS / "hallo.txt").exists(), "moved")
    ok("move hallo.txt into hernoemd")

    # 8. list view, select all, delete with confirmation
    await click(browser, "button[aria-label='Lijstweergave']")
    await wait(browser, "() => document.querySelectorAll('.pe-list tbody tr').length === 1")
    await click(browser, "#pe-select-all")
    await has_text(browser, ".pe-toolbar", "1 geselecteerd")
    await shot(browser, "05-list")
    await click_text(browser, "Verwijderen")
    await has_text(browser, MODAL, f"{DOCS}/hernoemd")
    await has_text(browser, MODAL, "map met 1 item")
    await shot(browser, "06-delete-confirm")
    await click_text(browser, "Verwijderen", MODAL)
    await wait_fs(lambda: not (DOCS / "hernoemd").exists(), "deleted")
    ok("list view; select all; delete shows full path and 'map met 1 item', then deletes")
    await click(browser, "button[aria-label='Rasterweergave']")

    # 9. protected paths
    await click_text(browser, "Root", ".pe-sidebar")
    await wait(browser, "() => !!document.querySelector(\"input[aria-label='DATA selecteren']\")")
    await click(browser, "input[aria-label='DATA selecteren']")
    renamable = await js(browser, "() => ![...document.querySelectorAll('.pe-toolbar button')].find(b => b.textContent === 'Hernoemen').disabled")
    if renamable:
        raise SystemExit("FAILED: /DATA can be renamed")
    await click_text(browser, "Verwijderen")
    await has_text(browser, MODAL, "/DATA is beschermd")
    has_delete = await js(browser, f"() => [...document.querySelectorAll('{MODAL} button')].some(b => b.textContent === 'Verwijderen')")
    if has_delete:
        raise SystemExit("FAILED: delete button offered for /DATA")
    await shot(browser, "07-protected")
    await click_text(browser, "Annuleren", MODAL)
    ok("/DATA: rename disabled, delete refused ('is beschermd', no delete button)")

    # 10. permission denied: listing and an action
    await open_page(browser, "/DATA/AppData")
    await has_text(browser, ".pe-content", "Toegang geweigerd: /DATA/AppData")
    await has_text(browser, ".pe-content", "Zet beheerderstoegang in Cockpit aan")
    await shot(browser, "08-denied")
    ok("folder without permission: message, no silent failure")
    await click_text(browser, "DATA", ".pe-sidebar")
    await click_text(browser, "Uploaden of aanmaken")
    await click_text(browser, "Nieuwe map")
    await name_dialog(browser, "mag-niet")
    await click_text(browser, "Aanmaken", MODAL)
    await has_text(browser, ".pf-v6-c-alert-group", "Toegang geweigerd: /DATA/mag-niet")
    retry = await js(browser, "() => (document.querySelector('.pf-v6-c-alert-group')?.innerText ?? '').includes('Opnieuw proberen')")
    if retry or Path("/DATA/mag-niet").exists():
        raise SystemExit("FAILED: retry offered to a user without administrative access, or folder created")
    ok("action without permission: alert 'Toegang geweigerd', no administrator retry for an ordinary user")

    # 11. a location from the mount list
    await click_text(browser, "storage", ".pe-sidebar")
    await has_text(browser, ".pe-crumbs", "storage")
    ok("location 'storage' opens /mnt/storage")


async def admin_session(browser):
    await login(browser, ADMIN, admin=True)
    await open_page(browser, "/DATA/AppData")
    await click_text(browser, "Openen als beheerder")
    await wait(browser, "() => !!document.querySelector(\".pe-tile-main[title='config.txt']\")",
               what="config.txt listed with administrative access")
    ok("admin: 'Openen als beheerder' lists a root-only folder")
    await click(browser, ".pf-v6-c-label button")  # stop administrative listing
    await open_page(browser, "/DATA")
    await click_text(browser, "Uploaden of aanmaken")
    await click_text(browser, "Nieuwe map")
    await name_dialog(browser, "als-beheerder")
    await click_text(browser, "Aanmaken", MODAL)
    await has_text(browser, ".pf-v6-c-alert-group", "Toegang geweigerd")
    if Path("/DATA/als-beheerder").exists():
        raise SystemExit("FAILED: created with administrative access without asking")
    await shot(browser, "09-retry-admin")
    await click_text(browser, "Opnieuw proberen als beheerder")
    await wait_fs(lambda: Path("/DATA/als-beheerder").is_dir(), "created as administrator")
    if Path("/DATA/als-beheerder").stat().st_uid != 0:
        raise SystemExit("FAILED: not created by root")
    ok("admin: first try as the user is denied; 'Opnieuw proberen als beheerder' creates it as root")

    # upload into that root-owned folder: denied as the user, retry as administrator
    await click(browser, ".pe-tile-main[title='als-beheerder']")
    await has_text(browser, ".pe-crumbs", "als-beheerder")
    src = Path("/tmp/pe-upload/c")
    src.mkdir(parents=True, exist_ok=True)
    (src / "beheer.txt").write_text("root\n")
    await upload(browser, src / "beheer.txt")
    await has_text(browser, ".pf-v6-c-alert-group", "Toegang geweigerd: /DATA/als-beheerder/beheer.txt")
    await has_text(browser, ".pf-v6-c-alert-group", "Opnieuw proberen als beheerder")
    await shot(browser, "10-upload-denied")
    await click_text(browser, "Opnieuw proberen als beheerder")
    target = Path("/DATA/als-beheerder/beheer.txt")
    await wait_fs(lambda: target.is_file() and target.read_text() == "root\n", "uploaded as administrator")
    if target.stat().st_uid != 0 or any(p.name.endswith(".part") for p in target.parent.iterdir()):
        raise SystemExit("FAILED: upload as administrator not owned by root, or temporary file left")
    subprocess.run(["sudo", "rm", "-r", "--", "/DATA/als-beheerder"], check=True)
    ok("admin: upload into a root folder is denied with a retry; the retry uploads as root")


async def main(outdir):
    global OUT
    OUT = Path(outdir)
    OUT.mkdir(parents=True, exist_ok=True)
    owner = subprocess.run(["stat", "-c", "%U:%G", "--", str(DOCS)], check=True, capture_output=True,
                           text=True).stdout.strip()
    subprocess.run(["sudo", "chown", f"{USER}:{USER}", "--", str(DOCS)], check=True)
    try:
        await sessions()
    finally:
        subprocess.run(["sudo", "chown", owner, "--", str(DOCS)], check=True)
    print("ALL OK")


async def sessions():
    for session in (user_session, admin_session):
        async with ChromiumBidi(headless=True) as browser:
            await browser.bidi("browsingContext.setViewport", context=browser.top_context,
                               viewport={"width": 1400, "height": 820})
            await session(browser)
            errors = [str(m) for m in browser.logs if m.level == "error"]
            if errors:
                raise SystemExit("FAILED: browser console errors:\n" + "\n".join(errors))


if __name__ == "__main__":
    asyncio.run(main(sys.argv[1] if len(sys.argv) > 1 else "."))
