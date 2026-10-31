# Omarchy Buds

Battery, noise control and settings for Bluetooth earbuds and headphones, right in the
[Omarchy](https://omarchy.org/) bar. Built on [BudsLink](https://github.com/maniacx/BudsLink)'s
device support, so it works with the brands BudsLink knows: AirPods and Beats, Samsung Galaxy Buds,
Sony, Nothing and CMF, Pixel Buds, Redmi and Xiaomi, Realme, Oppo and OnePlus, Bose, Sennheiser,
Edifier, Cambridge Audio, Soundcore, and others through Google Fast Pair.

The plugin is this folder ([`omarchy/`](.)) plus [`manifest.json`](../manifest.json) at the
repository root; the device code is BudsLink's (`src/`), run without its GTK window.

## Features

- **Detects your earbuds automatically** when they connect. With several connected, a dropdown
  switches between them, starting with whichever is playing your audio.
- **Battery** for each earbud and the case, or a single bar for headphones. The bar icon shows the
  emptiest one and turns urgent when it runs low.
- **Noise control** (off, ANC, transparency, and the levels each model has), plus whatever extra
  options BudsLink offers for the model: wind noise, conversation awareness, ambient level, and so on.
- **Model settings** where supported: for Realme, Oppo and OnePlus, EQ presets (including custom
  ones saved on the buds), game mode, spatial audio, in-ear detection and the bass level.
- **Read first, write on purpose.** On connect it only reads. Nothing is sent to your earbuds
  until you click a control. A per-device **Controls** switch makes a device read-only.
- **Keyboard**: ↑/↓ (or j/k) moves through the panel, ←/→ (or h/l) through choices or a slider,
  Enter/Space selects, `m` cycles noise control.
- **Demo mode** shows the panel of every model BudsLink knows, with fake data and Bluetooth cut off.

## Requirements

- Omarchy 4 (the Quickshell-based `omarchy-shell`).
- `gjs`: installed on stock Omarchy (it comes with `sushi`). If it's missing, the panel says so:
  `omarchy pkg add gjs`.
- BlueZ, with your earbuds paired as usual (the Bluetooth menu or `bluetoothctl`). This plugin
  doesn't pair devices.
- Optional: `wpctl` (PipeWire), to start on the device that plays your audio.

## Install

Review the code first: plugins run unsandboxed inside the shell. Then add the repository that
hosts this plugin:

```bash
omarchy plugin add <repository URL> --enable
```

Updates: `omarchy plugin update kshatriya-abhay.buds` (the id is in `manifest.json`).

## Remove

```bash
omarchy plugin remove kshatriya-abhay.buds
rm -rf ~/.local/state/omarchy-buds    # settings, logs and snapshots, for a clean removal
```

The earbuds keep whatever settings they had.

## What it does on your system

- **One background process**: `gjs` running BudsLink's device code (`backend/`), started
  and stopped with the shell. It talks to the plugin over stdin/stdout.
- **Bluetooth**: for each connected device it supports, it registers a BlueZ `Profile1` client on
  the system D-Bus and opens that device's control channel (RFCOMM or L2CAP; BLE for some Edifier
  models). On connect it reads status. It sends commands only when you use a control.
- **Commands it runs**: `gjs`, `glib-compile-schemas` (at startup, into its state folder) and
  `wpctl inspect` (to find the current audio output).
- **Files**: only `~/.local/state/omarchy-buds/` (settings, a per-device Controls file, an
  optional log, snapshots).
- **Network**: none. **Privileges**: none beyond your user. **Keybindings**: none added.
- **One program per earbud control channel**: close the BudsLink Flatpak and other earbud plugins
  (Galaxy Buds, Nothing, Omipods and so on) for the same device, or one of them will lose the
  connection.

## Settings

In the widget's settings:

| Setting | Default | |
|---|---|---|
| Show battery in the bar | on | The emptiest bud's level next to the icon |
| Hide when no earbuds are connected | on | |
| Low battery level | 15 % | The icon turns urgent at or below this |
| Hidden features | auto-answer, dual connection | Feature switches the panel leaves out (for every device) |

## Keybindings and IPC

```lua
-- ~/.config/hypr/bindings.lua
o.bind("SUPER + CTRL + A", "Cycle noise control", "omarchy-shell kshatriya-abhay.buds cycle")
```

`omarchy-shell kshatriya-abhay.buds <method>`:

| Method | |
|---|---|
| `open`, `close`, `toggle` | The panel |
| `cycle` | Next noise control mode on the shown device |
| `set <mode>` | `off`, `transparency`, `anc`, or any button label |
| `select <address>` | Show this device |
| `status` | Everything the panel knows, as JSON |
| `demo on\|off` | Demo mode (every known model, fake data) |

## Troubleshooting

- **"Waiting for the earbuds…"**: the model isn't supported yet, or the control channel didn't
  open. Turn on the log with `touch ~/.local/state/omarchy-buds/verbose`, restart the shell
  (`omarchy restart shell`), and look at `~/.local/state/omarchy-buds/log/runtime.log`.
- **A warning about another app**: something else holds the earbud's control channel (see above).

## Development

```bash
omarchy/dev/sync.sh                   # copy this checkout into ~/.config/omarchy/plugins
omarchy restart shell                 # pick up changes to Service.qml
node omarchy/tests/model.test.js      # panel logic
gjs -m omarchy/tests/bridge.test.js   # backend ↔ shell bridge
gjs -m omarchy/tests/demo.test.js     # every model's panel, Bluetooth cut off
omarchy/dev/gallery-snapshots.sh      # render every demo page to PNGs (demo mode on)
```

How it fits together: `backend/` runs BudsLink's device code headless (no GTK window, no
Flatpak) and speaks JSON lines; `Service.qml` owns that process for the session;
`BarWidget.qml` and `components/` draw the bar icon and panel. Changes to
BudsLink's own files are kept small and in separate commits, so upstream updates merge cleanly.

## Credits and license

All device support comes from [BudsLink](https://github.com/maniacx/BudsLink) by maniacx
(GPL-3.0-or-later), which builds on the work of many reverse-engineering projects. Not affiliated
with any earbud maker or with Omarchy.

GPL-3.0-or-later, like BudsLink: see [LICENSE](../LICENSE). The repository also carries BudsLink's
bundled copy of libgnome-volume-control (`subprojects/gvc`, GPL-2.0-or-later), which only BudsLink's
Flatpak build uses; the plugin doesn't load it.
