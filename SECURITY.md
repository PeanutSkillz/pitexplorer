# Security policy

## Supported versions

Only the latest release receives security fixes.

## Reporting a vulnerability

Please **do not** open a public issue for security problems.

Report privately through GitHub's
[private vulnerability reporting](https://docs.github.com/en/code-security/security-advisories/guidance-on-reporting-and-writing-information-about-vulnerabilities/privately-reporting-a-security-vulnerability)
("Security" tab → "Report a vulnerability").

Please include:

* the PitExplorer version or commit, and the distribution and Cockpit versions,
* a description of the issue and its impact,
* steps to reproduce, or a proof of concept,
* whether the issue is already public.

What happens next:

1. We confirm receipt within **5 working days**.
2. We assess the report and share our severity rating (CVSS 3.1) within
   **14 days**.
3. We develop a fix in a private advisory. You can review it if you like.
4. We release the fix and publish a GitHub Security Advisory, and request a
   CVE where appropriate. Unless you prefer otherwise, you are credited.

We aim to fix critical and high issues within 30 days, and others with the
next regular release.

## Scope

In scope: the PitExplorer page, in particular anything that lets a user
reach files or run commands beyond their own rights, bypass the protection
of `/`, `/DATA` and mount points, or replace files without confirmation.

Out of scope: vulnerabilities in Cockpit itself, the Linux kernel or other
system components. Please report those to the respective projects.
