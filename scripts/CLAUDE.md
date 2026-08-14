# scripts/ — getting a build onto the devices

Loaded when working in `scripts/`. The root `CLAUDE.md` carries the summary and the one
rule that must not be forgotten anywhere: `push-reminder.sh` stays a *reminder*, because
Claude Code's `Stop` hook fires after every reply.

## The three legs

`scripts/push-all.sh` is the one way a build reaches the user. It builds the web assets
**once** and hands the same output to three independent legs — the Mac app (rebuilt and
copied into `/Applications`), every connected iPhone and iPad, and GitHub Pages.

- **No `set -e` in the push scripts, deliberately.** The legs must not depend on each
  other: an iPad that has not been trusted yet cannot be allowed to stop the Mac app from
  updating, and a missing GitHub remote cannot stop either. Each leg records its own
  outcome and the summary at the end reports what reached where.
- **Sub-scripts honour `YOMAN_SKIP_BUILD=1`**, which is how one push avoids running four
  identical Vite builds (`ios-install.sh`, `deploy-pages.sh`, and `app:build` each build
  on their own when run directly).
- **The web leg does not build anything.** `deploy-pages.sh` commits and pushes;
  `.github/workflows/deploy.yml` builds the site on GitHub and deploys it to Pages from
  the artifact, so the published site always comes from a committed state rather than
  from whatever happened to be in `dist/`. Pages is configured with `build_type=workflow`,
  so there is no `gh-pages` branch any more.
- **`scripts/ios-devices.py` is the only place that enumerates devices**, and it lists
  *all* of them. Both `ios-install.sh` and `ios-check.sh` read it. Stopping at the first
  device — which both used to do — silently skips a working phone whenever an unready
  iPad happens to enumerate ahead of it, and enumeration order is not stable.
- It checks **reachability first**: `devicectl` keeps listing a device long after the
  cable is out, still paired and with its developer mode remembered as enabled. Trusting
  that reported an unplugged iPad as ready and then failed deep inside `xcodebuild` with
  "unable to find a destination", which says nothing useful. No `transportType` means
  not connected, whatever else the record claims.
- It classifies pairing **before** developer mode: an untrusted device cannot report its
  developer-mode status, and the setting does not appear on it until it has been connected
  to a Mac it trusts. "Trust this computer" is genuinely the first step on a new device.
- **A locked device passes every readiness test and then fails the build.** It is on the
  end of the cable and answering, so `ios-devices.py` calls it ready — but the developer
  disk image cannot mount on a locked device, and `xcodebuild` spends a minute timing out
  on a destination that will never appear. `build_for` therefore tees its output to
  `$BUILD_LOG`, and `device_is_locked` reads that back for
  `developer disk image could not be mounted` / `Timed out waiting for all destinations`.
  That case reports "המכשיר נעול" and **skips the Swift-package retry**, which costs
  another minute per device and cannot possibly help. Both devices failed this way on a
  push at 21:20 at night and the summary said only "בנייה נכשלה" — four wasted minutes
  and nothing pointing at the passcode. `ios-check.sh` cannot detect it in advance (there
  is nothing to ask before a build is attempted), so it says so as a reminder instead.
- The Mac leg asks the running app to quit before replacing the bundle, and **skips the
  replace** if it is still running after eight seconds rather than forcing it.

**`ios-check.sh` checks the Apple ID account, not just the certificate.** They are
different things and only one of them used to be tested. The signing certificate sits in
the keychain and survives; the *account* in Xcode is what creates and renews the
provisioning profile that goes with it. When the account went missing the certificate
stayed behind, the check reported "✔ יש תעודת חתימה", and the build failed five minutes
later with `No Accounts: Add a new account in Accounts settings` — by which time the app
on the phone had already expired with nothing able to re-sign it. Signing in again is the
one repair here that cannot be automated: it needs the user's Apple ID password.

**The Mac window shows itself even when the renderer never becomes ready.** It is created
with `show: false` so it appears painted rather than white, and `ready-to-show` used to be
the only thing that could ever show it: when the renderer failed to start, the app sat in
the Dock with its menu bar up and *no window at all* — nothing on screen and nothing
written down. `createWindow` now carries an eight-second fallback that shows the window
regardless, plus `did-fail-load` and `render-process-gone` handlers that put the reason on
screen. An empty window that can be reloaded from the menu beats no window.
