// Keyboard protocol commands — ported 1:1 from the GK6+ app's libs/cmd.js.
// Every request is a 64-byte packet:
//   [0] cmd, [1] sub_cmd, [2..5] header (u32 LE), [6..7] crc16-ccitt (u16 LE), [8..] body
const { crc16_ccitt } = require('./crc16');

class CMD {
    constructor(cmd, sub_cmd, header, body) {
        this.cmd = cmd;
        this.sub_cmd = sub_cmd;
        this.header = header || 0;
        this.body = body;
    }
    toBuffer() {
        const buffer = Buffer.alloc(64);
        buffer.fill(0);
        buffer.writeUInt8(this.cmd, 0);
        buffer.writeUInt8(this.sub_cmd, 1);
        buffer.writeUInt32LE(this.header, 2);
        if (this.body) this.body.copy(buffer, 8, 0, this.body.length);
        buffer.writeUInt16LE(crc16_ccitt(buffer), 6);
        return buffer;
    }
}

const create = (...a) => new CMD(...a);

module.exports = {
    CMD,
    create,
    VER: {
        req: create(1, 1),
        res: (b) => ({ FWID: b.readUInt32LE(8), FWVersion: b.readUInt16LE(12) }),
    },
    DEVICE_ID: {
        req: create(1, 2),
        res: (b) => {
            let device_id = 0n;
            for (let i = 0; i < 6; i++) device_id |= BigInt(b[8 + i]) << BigInt(i * 8);
            return { DeviceID: BigInt.asUintN(64, device_id).toString(10) };
        },
    },
    MODEL_ID: {
        req: create(1, 8),
        res: (b) => ({ ModelID: b.readUInt32LE(8) }),
    },
    MATRIX: {
        req: create(1, 9),
        res: (b) => ({ key_col: b.readUInt8(8), key_row: b.readUInt8(9) }),
    },
    CHANGE_MODE: (mode) => ({
        req: create(0x0b, mode),
        res: (b) => ({ mode: b.readUInt8(1) }),
    }),
    CleanData: (mode, dataType) => ({
        req: create(0x21, mode, dataType),
        res: (b) => ({ ack: b.readUInt8(1) }),
    }),
    writeKeyData: (mode, addr, data) => ({
        req: create(0x22, mode, (data.length << 16) + addr, data),
        res: (b) => ({ ack: b.readUInt8(1), crc: b.readUInt16LE(6) }),
    }),
    writeFnData: (mode, addr, data) => ({
        req: create(0x31, mode, (data.length << 16) + addr, data),
        res: (b) => ({ ack: b.readUInt8(1), crc: b.readUInt16LE(6) }),
    }),
    writeModeLE: (mode, addr, data) => ({
        req: create(0x24, mode, (data.length << 16) + addr, data),
        res: (b) => ({ ack: b.readUInt8(1), crc: b.readUInt16LE(6) }),
    }),
    writeMacro: (mode, addr, data) => ({
        req: create(0x25, mode, (data.length << 16) + addr, data),
        res: (b) => ({ ack: b.readUInt8(1), crc: b.readUInt16LE(6) }),
    }),
    writeLightKey: (mode, addr, data) => ({
        req: create(0x26, mode, (data.length << 16) + addr, data),
        res: (b) => ({ ack: b.readUInt8(1), crc: b.readUInt16LE(6) }),
    }),
    writeLightData: (mode, addr, data) => ({
        req: create(0x27, mode, (data.length << 24) + addr, data),
        res: (b) => ({ ack: b.readUInt8(1), crc: b.readUInt16LE(6) }),
    }),
    ToggleKeyReport: (enabled) => ({
        req: create(0x15, 0x03, 0, Buffer.from([enabled ? 0x01 : 0x00])),
        res: (b) => ({ ack: b.readUInt8(2) == 1 }),
    }),
    Ping: {
        timeout: 1000,
        req: create(0x0c),
        res: (b) => ({ ack: b.readUInt8(1) }),
    },
};