#!/usr/bin/python3
# SPDX-License-Identifier: LGPL-2.1-or-later
"""PitExplorer next to PitStore (another Cockpit add-on) in the test VM: all
menu entries are present, every page renders without console errors, also
after switching between them, and each keeps its own settings.

    python3 check_coexist.py OUTDIR

Same environment as check_files.py.
"""

import asyncio
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "common"))
import check_files as c  # noqa: E402
from webdriver_bidi import ChromiumBidi  # noqa: E402

PAGES = [
    # (url path, frame name, check that the page rendered)
    ("pitstore/dashboard", "cockpit1:localhost/pitstore/dashboard",
     "() => document.querySelector('h1')?.textContent === 'Dashboard'"),
    ("pitstore/appstore", "cockpit1:localhost/pitstore/appstore",
     "() => document.querySelector('h1')?.textContent === 'Appstore'"),
    ("pitexplorer", c.FRAME,
     "() => document.querySelectorAll('.pe-tile').length === 5"),
]


async def main(outdir):
    c.OUT = Path(outdir)
    c.OUT.mkdir(parents=True, exist_ok=True)
    async with ChromiumBidi(headless=True) as b:
        await b.bidi("browsingContext.setViewport", context=b.top_context, viewport={"width": 1400, "height": 820})
        await c.login(b, c.USER)

        menu_js = "() => [...document.querySelectorAll('#host-apps a, nav a')].map(a => a.textContent.trim())"
        await c.wait(b, f"() => ['Dashboard', 'Appstore', 'Bestanden'].every(l => ({menu_js})().includes(l))",
                     what="all three menu entries")
        menu = await c.js(b, f"() => ({menu_js})().join(' | ')")
        c.ok(f"menu: {menu}")

        # every page twice, in turn, so that each loads after the other
        for round_ in (1, 2):
            for url, frame, rendered in PAGES:
                b.switch_to_top()
                await b.bidi("browsingContext.navigate", context=b.top_context, url=f"{c.BASE}/{url}",
                             wait="complete", timeout=60)
                await c.wait(b, f"() => !!document.querySelector(\"iframe[name='{frame}']\")")
                await b.switch_to_frame(frame)
                await c.wait(b, rendered, timeout=60, what=f"{url} rendered")
                if round_ == 1:
                    await asyncio.sleep(1)
                    await c.shot(b, "coexist-" + url.replace("/", "-"))
            c.ok(f"round {round_}: Dashboard, Appstore and Bestanden render one after the other")

        # both packages are known to the shell, each with its own manifest
        b.switch_to_top()
        await b.switch_to_frame(c.FRAME)
        manifests = await c.js(b, """async () => {
            const all = await (await fetch('../manifests.json')).json();
            return ['pitstore', 'pitexplorer'].map(p => p + ':' + Object.keys(all[p]?.menu ?? {}).join(',')).join(' ');
        }""")
        if manifests != "pitstore:dashboard,appstore pitexplorer:index":
            raise SystemExit(f"FAILED: manifests {manifests!r}")
        c.ok(f"separate manifests: {manifests}")

        # the two do not share browser storage keys
        keys = await c.js(b, "() => Object.keys(localStorage).filter(k => /pitstore|pitexplorer/.test(k)).join(',')")
        c.ok(f"browser storage keys of the add-ons: {keys or '(none)'}")

        errors = [str(m) for m in b.logs if m.level == "error"]
        if errors:
            raise SystemExit("FAILED: browser console errors:\n" + "\n".join(errors))
        c.ok("no browser console errors")
    print("ALL OK")


if __name__ == "__main__":
    asyncio.run(main(sys.argv[1] if len(sys.argv) > 1 else "."))
