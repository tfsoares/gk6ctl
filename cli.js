#!/usr/bin/env node
// gk6ctl — control GK6+ / COR-M3 keyboards without the GK6+ Electron app.
const fs = require('fs');
const path = require('path');
const os = require('os');
const { spawnSync } = require('child_process');

const cmf = require('./lib/cmf');
const transport = require('./lib/transport');
const flash = require('./lib/flash');
const keys = require('./lib/keys');
const spec = require('./lib/spec');

const DEFAULT_DATA_DIR = process.env.GK6_DATA || path.join(os.homedir(), 'GK6XPlus-CMS');

const help = `gk6ctl — flash GK6+ / COR-M3 keyboard onboard profiles without the app
(uses the same HID protocol and .cmf payloads as the GK6+ app; keeps your mapping in the keyboard)

USAGE
  gk6ctl list                       enumerate COR-M3 keyboards on USB
  gk6ctl status                     probe the connected keyboard (firmware/model/matrix)
  gk6ctl decode <file.cmf>          unpack a .cmf profile / .cms macro / .le light to JSON
  gk6ctl apply <file.cmf>           flash an onboard layer (ModeIndex 1..4) and activate it
  gk6ctl apply --json <file.json>   flash a raw JSON profile body
  gk6ctl build <spec.json> [--out p.json]  create a profile from a key spec (no app needed)
  gk6ctl keys                      list key names usable in a spec
  gk6ctl ensure <file.cmf>         apply only if the keyboard is present (for login/boot
                                   agents; idempotent, silent when nothing to do)
  gk6ctl backup [dir]               copy your profiles/macros/LE data into ./backups
  gk6ctl help

ENV
  GK6_DATA    data dir (default ~/GK6XPlus-CMS — the GK6+ app's own data dir)

NOTES
  - Layers 1..4 are stored in the keyboard itself and work with no app running.
  - The Layer 0 "driver" profile is ONLINE-ONLY (host-rendered) and can't be flashed;
    applying it isn't supported on purpose.

example spec:
  { "name": "my-layer", "mode": 3,
    "keys":   [ { "index": 65, "key": "LCtrl+Up" } ],
    "fnKeys": [ { "index": 2, "key": "MediaPlayPause" } ] }
`;

function takeArgs(argv, names) {
    const out = {};
    const rest = [];
    for (let i = 0; i < argv.length; i++) {
        const a = argv[i];
        let matched = false;
        for (const n of names) {
            if (a === n) {
                out[n] = argv[++i];
                matched = true;
                break;
            }
        }
        if (!matched) rest.push(a);
    }
    return { opts: out, rest };
}

async function cmdList() {
    const raw = transport.listRaw();
    if (!raw.length) {
        console.log('no COR-M3 keyboards found (looked for 0x1ea7:0x0907).');
        process.exit(1);
    }
    for (const d of raw) {
        console.log(
            `${d.path}\n` +
            `  vendorId=${d.vendorId.toString(16)} productId=${d.productId.toString(16)} ` +
            `usagePage=0x${d.usagePage.toString(16)} usage=0x${d.usage.toString(16)} interface=${d.interface}\n` +
            `  product=${d.product} manufacturer=${d.manufacturer}`
        );
    }
}

async function cmdStatus() {
    const found = await transport.findDevice();
    if (!found) {
        console.error('no responsive GK6+ keyboard found. Is the GK6+ app running? Quit it first.');
        process.exit(1);
    }
    const { probe, info } = found;
    console.log(JSON.stringify({ device: info.path, ...probe }, null, 2));
    found.dev.close();
}

async function cmdKeys() {
    console.log(keys.listKeys());
}

async function cmdBuild(specFile, out) {
    const s = JSON.parse(fs.readFileSync(specFile, 'utf8'));
    const profile = spec.buildProfile(s);
    const json = JSON.stringify(profile, null, 2);
    if (out) {
        fs.writeFileSync(out, json);
        console.log(`profile written to ${out}`);
        console.log(`next: gk6ctl apply --json ${out}`);
    } else {
        console.log(json);
    }
}

async function cmdDecode(file) {
    const { header, body } = cmf.decodeFile(file);
    console.log(`file: ${file}`);
    console.log(`type: ${header.type} (${['_', 'PROFILE', 'LIGHT', 'STATS', 'APPCONF', 'MACRO'][header.type] || '?'}) name='${header.name}'`);
    console.log(`size: ${header.size} bytes, saved: ${new Date(header.time * 1000).toISOString()}`);
    try {
        console.log(JSON.stringify(JSON.parse(body), null, 2));
    } catch (e) {
        console.log(body); // not JSON (e.g. macro text); print raw
    }
}

async function cmdApply(file, dataDir, opts, { silent = false } = {}) {
    let jsonData;
    if (opts.json) {
        jsonData = JSON.parse(fs.readFileSync(opts.json, 'utf8'));
    } else {
        const { header, body } = cmf.decodeFile(file);
        if (header.type !== 1) throw new Error(`not a profile file (type=${header.type})`);
        jsonData = JSON.parse(body);
    }
    const mode = jsonData.ModeIndex * 1;
    if (!(mode >= 1 && mode <= 4)) {
        throw new Error(`ModeIndex=${mode}: only onboard layers 1..4 can be flashed (layer 0 is app/online-only).`);
    }

    const found = await transport.findDevice();
    if (!found) {
        if (silent) {
            console.log('no responsive keyboard found — nothing to do.');
            return;
        }
        throw new Error('no responsive keyboard found. Quit the GK6+ app first (right-click tray icon → Quit).');
    }
    const dev = found.dev;
    const { probe } = found;
    console.log(`keyboard: model ${probe.ModelID} fw ${probe.FWVersion} (${probe.FWID}) matrix ${probe.matrix.key_col}x${probe.matrix.key_row}`);
    jsonData._matrix = probe.matrix; // fill matrix for flash

    console.log(`flashing onboard layer ${mode} (name: ${jsonData.Name || '?'})…`);
    await flash.writeDeviceConfig(dev, jsonData, dataDir);
    await flash.activateLayer(dev, mode, { toggleReport: true });
    dev.close();
    console.log(`done. layer ${mode} is now active and stored onboard — the GK6+ app is no longer needed.`);
}

async function cmdBackup(dest) {
    const src = path.join(DEFAULT_DATA_DIR, 'Account');
    if (!fs.existsSync(src)) {
        console.error(`no data found at ${src}`);
        process.exit(1);
    }
    const outDir = path.resolve(dest || path.join(__dirname, 'backups'));
    fs.mkdirSync(outDir, { recursive: true });
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const out = path.join(outDir, `gk6-data-${stamp}.tar.gz`);
    const r = spawnSync('tar', ['-czf', out, '-C', path.dirname(src), path.basename(src)], { stdio: 'inherit' });
    if (r.status !== 0) process.exit(r.status || 1);
    console.log(`backup written: ${out}`);
}

async function main() {
    const argv = process.argv.slice(2);
    const cmd = argv[0] || 'help';
    const { opts, rest } = takeArgs(argv.slice(1), ['--json', '--data', '--out']) ;
    const dataDir = opts['--data'] || DEFAULT_DATA_DIR;

    try {
        switch (cmd) {
            case 'list': return cmdList();
            case 'keys': return cmdKeys();
            case 'build':
                if (!rest[0]) throw new Error('usage: gk6ctl build <spec.json> [--out out.json]');
                return cmdBuild(rest[0], opts['--out']);
            case 'status': return cmdStatus();
            case 'decode': return cmdDecode(rest[0]);
            case 'apply':
                if (!rest[0] && !opts['--json']) throw new Error('usage: gk6ctl apply <file.cmf> | gk6ctl apply --json <file.json>');
                return cmdApply(rest[0], dataDir, opts);
            case 'ensure':
                if (!rest[0]) throw new Error('usage: gk6ctl ensure <file.cmf>');
                return cmdApply(rest[0], dataDir, opts, { silent: true });
            case 'backup': return cmdBackup(rest[0]);
            case 'help':
            case '--help':
            case '-h':
                console.log(help);
                return;
            default:
                console.error(help);
                process.exit(2);
        }
    } catch (e) {
        console.error(`error: ${e.message}`);
        process.exit(1);
    }
}

main();