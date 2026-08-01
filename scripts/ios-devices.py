#!/usr/bin/env python3
"""
Lists every iPhone and iPad this Mac can see, one per line:

    <identifier>\t<state>\t<kind>\t<name>

`state` is the single thing standing between the device and an install:

    ready     reachable, paired, developer mode on — can be installed to
    gone      remembered from a previous session, but not connected now
    asleep    paired, but locked or sleeping, so the Mac gets no answer
    devmode   developer mode is off
    unpaired  this Mac has never been trusted on it

Both `ios-install.sh` and `ios-check.sh` read this, so the two agree about what
is connected. It has to list *every* device: with an iPhone and an iPad plugged
in at once, stopping at the first one means a working phone gets skipped because
a freshly unboxed iPad happens to enumerate ahead of it.

The Apple Watch is left out — its platform is watchOS and the diary does not
run there.
"""

import json
import os
import subprocess
import sys
import tempfile


def devices():
    """Every device `devicectl` knows about, or an empty list if it fails."""
    # devicectl writes a human-readable table to stdout as well, so the JSON has
    # to go to a file of its own — parsing stdout mixes the two and finds nothing.
    handle, path = tempfile.mkstemp(suffix=".json", prefix="yoman-devices")
    os.close(handle)
    try:
        subprocess.run(
            ["xcrun", "devicectl", "list", "devices", "--json-output", path],
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
            check=False,
        )
        with open(path) as file:
            return json.load(file).get("result", {}).get("devices", [])
    except Exception:
        return []
    finally:
        os.unlink(path)


def state_of(device):
    """What is stopping this device from taking an install, most basic first."""
    connection = device.get("connectionProperties", {})
    properties = device.get("deviceProperties", {})
    mode = properties.get("developerModeStatus")

    # Reachability comes first, because devicectl keeps listing a device it has
    # seen before with everything about it still looking healthy — paired, its
    # developer mode remembered as enabled — long after the cable is out. Taking
    # that at face value reported an unplugged iPad as ready and then failed
    # deep inside xcodebuild with "unable to find a destination", which says
    # nothing about the actual problem.
    if not connection.get("transportType"):
        return "gone"

    # Pairing is checked before developer mode on purpose. An untrusted device
    # cannot report its developer-mode status at all, and the setting does not
    # even appear on it until it has been connected to a Mac it trusts — so
    # "trust this computer" is genuinely the first step, not a later one.
    if connection.get("pairingState") != "paired":
        return "unpaired"
    if mode == "disabled":
        return "devmode"
    if mode in (None, "unknown"):
        return "asleep"
    return "ready"


def clean(text, fallback):
    """Names carry right-to-left marks; keep them, drop only the separators."""
    value = (text or fallback).replace("\t", " ").replace("\n", " ").strip()
    return value or fallback


found = False
for device in devices():
    hardware = device.get("hardwareProperties", {})
    if hardware.get("platform") != "iOS":
        continue
    identifier = device.get("identifier")
    if not identifier:
        continue
    found = True
    print(
        "\t".join(
            [
                identifier,
                state_of(device),
                clean(hardware.get("deviceType"), "iOS"),
                clean(device.get("deviceProperties", {}).get("name"), "מכשיר"),
            ]
        )
    )

sys.exit(0 if found else 1)
