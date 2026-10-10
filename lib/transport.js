// HID transport — mirrors the GK6+ app's libs/driver.js request()/probe() logic.
// The app writes 64-byte packets directly (no report-id prefix) on macOS.
const HID = require('node-hid');
const CMD = require('./proto');

const VID = 0x1ea7;
const PID_KEYBOARD = 0x0907; // COR-M3 keyboard interface (usagePage 0xFF00, usage 0x0050)
const PID_BOOT = 0x0905; // bootloader interface — read-only, never used for flashing
const MAX_VENDOR = 0x08000; // sanity guard for vendor strings

function listRaw() {
    return HID.devices().filter(
        (d) => d.vendorId === VID && (d.productId === PID_KEYBOARD || d.productId === PID_BOOT)
    );
}

function matchesKeyboard(path) {
    // Prefer the 0xFF00/0x0050 interface (as probed by the app's driver meta).
    // We enumerate candidate paths and probe each one until FWID parses.
    return path;
}

class Device {
    constructor(path) {
        this.path = path;
        this.device = null;
        this.opened = false;
    }

    open() {
        if (this.opened) return;
        this.device = new HID.HID(this.path);
        try {
            this.device.setNonBlocking(true);
        } catch (e) {
            /* non-blocking is best-effort */
        }
        this.opened = true;
    }

    close() {
        if (!this.opened) return;
        this.device.removeAllListeners();
        this.device.close();
        this.device = null;
        this.opened = false;
    }

    // Send one command and wait for a response whose first byte matches the command.
    // Mirrors app behaviour (default timeout 5000 ms, PING 1000 ms).
    request(cmd, timeout) {
        if (!cmd.req || !cmd.req.toBuffer) throw new Error('invalid cmd');
        const waitMs = timeout != null ? timeout : cmd.timeout || 5000;
        return new Promise((resolve, reject) => {
            const timer = setTimeout(() => {
                cleanup();
                reject(new Error(`timeout waiting for response to cmd 0x${cmd.req.cmd.toString(16)}`));
            }, waitMs);

            const onData = (data) => {
                if (data[0] !== cmd.req.cmd) return; // not a reply to this command
                if (cmd.res) {
                    try {
                        cleanup();
                        resolve(cmd.res(data));
                    } catch (e) {
                        cleanup();
                        reject(e);
                    }
                } else {
                    cleanup();
                    resolve({});
                }
            };
            const cleanup = () => {
                clearTimeout(timer);
                this.device.removeListener('data', onData);
            };

            this.device.on('data', onData);
            try {
                this.device.write(cmd.req.toBuffer());
            } catch (e) {
                cleanup();
                reject(e);
            }
        });
    }

    // Handshake: identify the device and report firmware/model/matrix.
    async probe() {
        const { FWID, FWVersion } = await this.request(CMD.VER);
        const { DeviceID } = await this.request(CMD.DEVICE_ID);
        const { ModelID } = await this.request(CMD.MODEL_ID);
        const { key_col, key_row } = await this.request(CMD.MATRIX);
        return {
            FWID: '0x' + FWID.toString(16).padStart(8, '0'),
            FWVersion: `v${(FWVersion >> 8) & 0xff}.${FWVersion & 0xff}`,
            DeviceID,
            ModelID,
            matrix: { key_col, key_row },
        };
    }
}

// Find the keyboard interface: try every 0x1EA7:0x0907 path until one answers VER.
async function findDevice() {
    const raw = listRaw().filter((d) => d.productId === PID_KEYBOARD && d.path);
    if (!raw.length) return null;
    for (const info of raw) {
        const dev = new Device(info.path);
        try {
            dev.open();
            const info_ = await dev.probe();
            return { info, dev, probe: info_ };
        } catch (e) {
            dev.close();
        }
    }
    // If none of the keyboard interfaces answered, still return the raw list info for diagnostics.
    return null;
}

module.exports = { Device, findDevice, listRaw, VID, PID_KEYBOARD, PID_BOOT, matchesKeyboard };