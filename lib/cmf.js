// Read/write of the app's ".cmf" packed files (profiles, macros, light effects).
// Ported 1:1 from the GK6+ app's libs/cmfcodec.js + libs/utils.js.
const fs = require('fs');
const { crc16_ccitt } = require('./crc16');

const CMFH_MAGIC = 0x434d4631; // "CMF1"

const Type = {
    TYPE_INVALID: 0,
    TYPE_PROFILE: 1,
    TYPE_LIGHT: 2,
    TYPE_STATASTIC: 3,
    TYPE_APPCONF: 4,
    TYPE_MACRO: 5,
};
const TypeName = ['_', 'PROFILE', 'LIGHT', 'STATASTIC', 'APPCONF', 'MACRO'];

// Initial running CRC for a given file type/name (as in the app).
function getInitCRC(type, name) {
    let g_nCRC = crc16_ccitt(Buffer.from(TypeName[type]));
    const nameBuffer = Buffer.alloc(8, 0);
    nameBuffer.write(name, 0, 'latin1');
    return crc16_ccitt(g_nCRC, nameBuffer);
}

// XOR-decode body data in place; returns the buffer.
function decodeData(info, pData) {
    let g_nCRC = getInitCRC(info.type, info.name);
    let g_nDataCRC = 0xffff;
    let nLen = pData.length;
    let index = 0;
    while (nLen > 0) {
        pData[index] = pData[index] ^ (g_nCRC & 0xff);
        g_nCRC = crc16_ccitt(g_nCRC, pData.slice(index, index + 1));
        g_nDataCRC = crc16_ccitt(g_nDataCRC, pData.slice(index, index + 1));
        index++;
        nLen--;
    }
    return pData;
}

// XOR-encode body data in place; returns the buffer (same algorithm as decode for the CRC
// chain, but the original app does a full second pass; this is the decode of encode()).
function encodeData(info, pData) {
    let g_nCRC = getInitCRC(info.type, info.name);
    let g_nDataCRC = 0xffff;
    let nLen = pData.length;
    let index = 0;
    while (nLen > 0) {
        const nNextCRC = g_nCRC;
        const by = pData[index] ^ (nNextCRC & 0xff);
        g_nCRC = crc16_ccitt(g_nCRC, pData.slice(index, index + 1));
        g_nDataCRC = crc16_ccitt(g_nDataCRC, pData.slice(index, index + 1));
        pData[index] = by;
        index++;
        nLen--;
    }
    return pData;
}

function parseHeaderInfo(buf) {
    return {
        magic: buf.readUInt32LE(0),
        hcrc: buf.readUInt32LE(4),
        time: buf.readUInt32LE(8),
        size: buf.readUInt32LE(12),
        dcrc: buf.readUInt32LE(16),
        type: buf.readUInt8(20),
        name: buf.slice(24, 32).toString('latin1').split('\x00')[0],
    };
}

function decodeFile(fileName) {
    const buffer = fs.readFileSync(fileName);
    const info = parseHeaderInfo(buffer.slice(0, 32));
    const body = decodeData(info, buffer.slice(32));
    return { header: info, body };
}

function encodeFile(fileName, info, content) {
    const body = Buffer.from(content, 'utf8');
    const dcrc = crc16_ccitt(body);
    const infoBuf = Buffer.alloc(32);
    infoBuf.writeUInt32LE(CMFH_MAGIC, 0);
    infoBuf.writeUInt32LE(0, 4); // hcrc placeholder
    infoBuf.writeUInt32LE(info.time || Math.round(Date.now() / 1000), 8);
    infoBuf.writeUInt32LE(body.length, 12);
    infoBuf.writeUInt32LE(dcrc, 16);
    infoBuf.writeUInt8(info.type, 20);
    infoBuf.write(info.name, 24, 8, 'latin1');
    const hcrc = crc16_ccitt(infoBuf);
    infoBuf.writeUInt32LE(hcrc, 4);
    const enc = encodeData(info, body);
    fs.writeFileSync(fileName, Buffer.concat([infoBuf, enc]));
    return fileName;
}

module.exports = { Type, decodeFile, encodeFile, parseHeaderInfo };