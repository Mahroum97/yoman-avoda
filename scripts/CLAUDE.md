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
- The Mac leg asks the running app to quit before replacing the bundle, and **skips the
  replace** if it is still running after eight seconds rather than forcing it.

**The Mac window shows itself even when the renderer never becomes ready.** It is created
with `show: false` so it appears painted rather than white, and `ready-to-show` used to be
the only thing that could ever show it: when the renderer failed to start, the app sat in
the Dock with its menu bar up and *no window at all* — nothing on screen and nothing
written down. `createWindow` now carries an eight-second fallback that shows the window
regardless, plus `did-fail-load` and `render-process-gone` handlers that put the reason on
screen. An empty window that can be reloaded from the menu beats no window.
