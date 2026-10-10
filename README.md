# gk6ctl

**Flash and manage GK6+ / COR-M3 keyboards from the command line — no 359 MB Electron app.**

`gk6ctl` writes your keyboard layouts into the keyboard's **onboard flash** using the
same HID protocol and `.cmf` payloads the "GK6+" app uses. Once flashed, the layout
lives in the keyboard and works with **no host software running at all**.

Verified on: COR-M3 "75" keyboard (ModelID `656802006`, firmware v5.207,
USB `0x1EA7:0x0907`) on macOS (M1, Node 22). `lib/` is generic for any model the
app supports — flashes come from the app's data dir.

## Background (why this exists)

The GK6+ app is an Electron 22 app (x86_64, so it runs under **Rosetta 2** on Apple
Silicon) that burns **~30% of a CPU core while idle** — the renderer runs animation
timers and the LE (light-effect) player loops on a 5 ms interval, plus a 2 s USB
keepalive ping. It is also deliberately hard to leave:

- clicking the close button only **hides** the window (`ev.preventDefault()`),
- the application menu is removed, so **⌘Q doesn't work**,
- the only way out is tray icon → Quit.

Worse, the app's **layer 0 "driver" profile is online-only**: it switches the
keyboard into a mode that exposes every keystroke to the host, and the app itself
plays combos/macros/light effects in software. If the app quits or dies, the
keyboard is left in a half-online state that only works "barely" until you reopen
the app (or replug it).

`gk6ctl` avoids all of that:

- Layers **1–4** are genuinely stored **in the keyboard's flash** by the app.
  `gk6ctl` sends exactly the same commands to write them (ported 1:1 from the app's
  own `profile.js` / `cmd.js` / `driver.js` / `cmfcodec.js`), so the result is
  byte-identical to what the app would write — then it switches the keyboard to a
  local layer and disables host key-report mode.
- The app is only needed if you want its GUI editor; `gk6ctl` also has a
  `build` command so you can author layouts without the app at all.

## Install

```bash
git clone https://github.com/tfsoares/gk6ctl.git
cd gk6ctl
npm install                 # installs node-hid (same HID library the app uses)
ln -s "$PWD/bin/gk6ctl" /usr/local/bin/gk6ctl   # optional
```

Needs Node ≥ 16. First `npm install` may compile `node-hid` (needs Xcode Command
Line Tools) if no prebuilt binary matches.

## Usage

```bash
gk6ctl list                      # enumerate COR-M3 keyboards on USB
gk6ctl status                    # probe: firmware, model, matrix
gk6ctl decode <file.cmf>         # unpack a profile/macro/light file to JSON
gk6ctl apply <file.cmf>          # flash an onboard layer (ModeIndex 1..4) + activate
gk6ctl apply --json <file.json>  # flash a raw JSON profile body
gk6ctl build <spec.json> [--out p.json]  # create a profile from key names
gk6ctl keys                      # list key names you can use in a spec
gk6ctl backup [dir]              # snapshot the data dir into ./backups
```

Profiles are read from the app's data dir `~/GK6XPlus-CMS/Account/0/Devices/<ModelID>/*.cmf`
(override with `GK6_DATA`). `gk6ctl apply` refuses ModeIndex 0 — the online-only
layer cannot be persisted (by design of the keyboard family).

### Authoring a layout without the app

```json
// layer.json
{
  "name": "gaming layer",
  "mode": 3,
  "keys":   [ { "index": 65, "key": "LCtrl+Up" } ],
  "fnKeys": [ { "index": 2,  "key": "MediaPlayPause" } ]
}
```

```bash
gk6ctl build layer.json --out layer-built.json
gk6ctl apply --json layer-built.json
```

Key names: `A`..`Z`, `0`..`9`, `F1`..`F20`, `Esc`, `Space`, `Home`, arrows,
`Numpad0`..`Numpad9`, media (`MediaPrev`, `MediaNext`, `MediaPlayPause`,
`Mute`, `VolUp`, `VolDown`, ...), modifiers combined with `+`
(`LCtrl+Up`, `LWin+D`, `LCtrl+LShift+LWin+4`), or a modifier alone (`RCtrl`).
Unspecified keys keep the keyboard's factory default (the tool writes `0xFF`
"leave as-is" entries, matching app behaviour).

### Editing an existing layer

```bash
gk6ctl decode ~/GK6XPlus-CMS/Account/0/Devices/656802006/8154bca4-...cmf > layer.json
# edit KeySet[].DriverValue / FnKeySet by hand (driver value format below)
gk6ctl apply --json layer.json
```

`DriverValue` encoding (from the app's own saved profiles):

| value | meaning |
|---|---|
| `0x02` | normal key: `0x02`<<24 \| keyCode<<8 \| modifierBitmap |
| `0x03` | consumer/media key: `0x03`<<24 \| usage (e.g. `0xCD` Play/Pause) |
| modifier bitmap | LCtrl `01` LShift `02` LAlt `04` LWin `08` RCtrl `10` RShift `20` RAlt `40` RWin `80` |
| `0x0A010001` | key bound to a macro (macro bytes uploaded on flash) |

Examples: `LCtrl+Up` = `0x02005201`, `LWin+Space` = `0x02002C08`, `MediaPrev` = `0x030000B6`.

## Deleting the GK6+ app

```bash
killall "GK6+" 2>/dev/null
rm -rf "/Applications/GK6+.app" ~/Library/Application\ Support/GK6+
```

(It is not a login item — nothing else to clean.) Keep `~/GK6XPlus-CMS` or the
`gk6ctl backup` tarball: that's the source for future flashes.

## Troubleshooting

- **Keyboard stuck after killing the app** (works "barely"): the keyboard was left
  in host-online mode. Run `gk6ctl apply <an onboard layer>` — it disables key
  reports and switches to a local layer. Unplugging/replugging also resets it.
- **No responsive keyboard found**: quit the GK6+ app first (it owns the HID
  interface); then `gk6ctl status`.
- **Flashing fails mid-way**: your profiles are safe on disk; just run `apply`
  again (the flash is idempotent).

## Layout

```
bin/gk6ctl        CLI entry
cli.js            subcommands
lib/proto.js      protocol: 64-byte packets + CRC16-CCITT (port of cmd.js)
lib/transport.js  HID open/request/probe via node-hid (port of driver.js)
lib/flash.js      onboard flash writer + macro/light builders (port of profile.js)
lib/cmf.js        .cmf/.cms/.le packed-file codec (port of cmfcodec.js)
lib/crc16.js      CRC16-CCITT table
lib/keys.js       key names <-> DriverValue encoder
lib/spec.js       spec -> profile builder
lib/macrofmt.js   macro text format
```

## License

MIT. The HID protocol and file formats in `lib/` are a byte-compatible,
independent implementation reverse-engineered from the GK6+ app
(DONGGUAN JIZHIDIANZI Co., LTD, the keyboard ODM; the app declares MIT in its
package metadata). See [LICENSE](LICENSE).