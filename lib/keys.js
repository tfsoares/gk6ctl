// Key names <-> DriverValue encoder/decoder.
//
// DriverValue encoding (from analyzing profiles the GK6+ app saved):
//   u32 LE bytes = [M, K, 0x00, 0x02]     normal key (M = modifier bitmap, K = HID usage)
//   u32 LE bytes = [C, 0x00, 0x00, 0x03]  consumer/media key (C = consumer usage)
//   modifier-only key (K = 0x00)          e.g. a key that acts as RCtrl
//   macro key: 0x0A010001 (handled separately by flash.js)
// Hex string form stored in profiles: "0x" + u32 hex, e.g. LCtrl+Up -> 0x02005201.

const MODS = {
    LCtrl: 0x01, LShift: 0x02, LAlt: 0x04, LWin: 0x08,
    RCtrl: 0x10, RShift: 0x20, RAlt: 0x40, RWin: 0x80,
    Ctrl: 0x01, Shift: 0x02, Alt: 0x04, Win: 0x08, Meta: 0x08,
};

const KEY = {
    A: 0x04, B: 0x05, C: 0x06, D: 0x07, E: 0x08, F: 0x09, G: 0x0A, H: 0x0B,
    I: 0x0C, J: 0x0D, K: 0x0E, L: 0x0F, M: 0x10, N: 0x11, O: 0x12, P: 0x13,
    Q: 0x14, R: 0x15, S: 0x16, T: 0x17, U: 0x18, V: 0x19, W: 0x1A, X: 0x1B,
    Y: 0x1C, Z: 0x1D,
    '1': 0x1E, '2': 0x1F, '3': 0x20, '4': 0x21, '5': 0x22, '6': 0x23, '7': 0x24,
    '8': 0x25, '9': 0x26, '0': 0x27,
    Enter: 0x28, Esc: 0x29, Backspace: 0x2A, Tab: 0x2B, Space: 0x2C,
    '-': 0x2D, '=': 0x2E, '[': 0x2F, ']': 0x30, '\\': 0x31, ';': 0x33, "'": 0x34,
    '`': 0x35, ',': 0x36, '.': 0x37, '/': 0x38, Caps: 0x39,
    F1: 0x3A, F2: 0x3B, F3: 0x3C, F4: 0x3D, F5: 0x3E, F6: 0x3F, F7: 0x40,
    F8: 0x41, F9: 0x42, F10: 0x43, F11: 0x44, F12: 0x45, F13: 0x68, F14: 0x69,
    F15: 0x6A, F16: 0x6B, F17: 0x6C, F18: 0x6D, F19: 0x6E, F20: 0x6F,
    PrintScreen: 0x46, ScrollLock: 0x47, Pause: 0x48, Insert: 0x49,
    Home: 0x4A, PageUp: 0x4B, Delete: 0x4C, End: 0x4D, PageDown: 0x4E,
    Right: 0x4F, Left: 0x50, Down: 0x51, Up: 0x52, NumLock: 0x53,
    Numpad0: 0x62, Numpad1: 0x59, Numpad2: 0x5A, Numpad3: 0x5B, Numpad4: 0x5C,
    Numpad5: 0x5D, Numpad6: 0x5E, Numpad7: 0x5F, Numpad8: 0x60, Numpad9: 0x61,
    NumpadEnter: 0x58, NumpadAdd: 0x57, NumpadSubtract: 0x56, NumpadMultiply: 0x55,
    NumpadDivide: 0x54, NumpadDot: 0x63, App: 0x65,
};

// Consumer/media usage ids (single-byte, same class the app's own profiles use).
const MEDIA = {
    MediaPrev: 0xB6, MediaNext: 0xB5, MediaPlayPause: 0xCD, MediaStop: 0xB7,
    Mute: 0xE2, VolUp: 0xE9, VolDown: 0xEA, MediaRewind: 0xB4, MediaFastForward: 0xB3,
};

// "LCtrl+Up" -> 0x02005201 | "MediaPrev" -> 0x030000B6 | "RCtrl" -> 0x02000010 | "A" -> 0x02000400
function encodeDriverValue(expr) {
    if (typeof expr !== 'string' || !expr.trim()) throw new Error(`bad key spec: ${JSON.stringify(expr)}`);
    const parts = expr.trim().split('+').map((s) => s.trim());
    const mainIsModifier = parts.length === 1 && parts[0] in MODS;
    const main = parts[parts.length - 1];
    let modBits = 0;
    if (parts.length > 1) {
        for (const m of parts.slice(0, -1)) {
            if (!(m in MODS)) throw new Error(`unknown modifier "${m}" in "${expr}"`);
            modBits |= MODS[m];
        }
    }
    if (main in MEDIA) {
        if (modBits) throw new Error(`media key cannot have modifiers: "${expr}"`);
        return '0x' + (0x03000000 | MEDIA[main]).toString(16).toUpperCase().padStart(8, '0');
    }
    if (mainIsModifier) {
        return '0x' + (0x02000000 | MODS[main]).toString(16).toUpperCase().padStart(8, '0');
    }
    if (!(main in KEY)) throw new Error(`unknown key "${main}" in "${expr}"`);
    return '0x' + (0x02000000 | (KEY[main] << 8) | modBits).toString(16).toUpperCase().padStart(8, '0');
}

const KEY_BY_CODE = Object.fromEntries(Object.entries(KEY).map(([n, c]) => [c, n]));
const MEDIA_BY_CODE = Object.fromEntries(Object.entries(MEDIA).map(([n, c]) => [c, n]));

// 0x02005201 -> "LCtrl+Up" | 0x030000B6 -> "MediaPrev" (best effort for unknowns).
function decodeDriverValue(dv) {
    const v = parseInt(dv, 16) >>> 0;
    const bank = (v >> 24) & 0xff;
    if (bank === 0x03) return MEDIA_BY_CODE[v & 0xff] || `Media(0x${(v & 0xff).toString(16).toUpperCase()})`;
    if (bank !== 0x02) return `0x${v.toString(16).toUpperCase()}`;
    const m = v & 0xff;
    const k = (v >> 8) & 0xff;
    const modNames = [];
    if (m & 0x01) modNames.push('LCtrl');
    if (m & 0x02) modNames.push('LShift');
    if (m & 0x04) modNames.push('LAlt');
    if (m & 0x08) modNames.push('LWin');
    if (m & 0x10) modNames.push('RCtrl');
    if (m & 0x20) modNames.push('RShift');
    if (m & 0x40) modNames.push('RAlt');
    if (m & 0x80) modNames.push('RWin');
    if (k === 0) return modNames.length === 1 ? modNames[0] : (modNames.join('+') || '0x02000000');
    const kn = KEY_BY_CODE[k] || `0x${k.toString(16).toUpperCase()}`;
    return [...modNames, kn].join('+');
}

function listKeys() {
    const used = new Set(Object.values(KEY));
    const byCode = [];
    for (const [name, code] of Object.entries(KEY)) {
        if (!used.has(code)) continue;
        if (byCode[code]) continue;
        byCode[code] = name;
    }
    const out = ['--- keys ---'];
    byCode.forEach((name, code) => {
        if (name) out.push(`  ${name.padEnd(14)} 0x${code.toString(16).padStart(2, '0')}`);
    });
    out.push('--- modifiers (combo-only, e.g. "LCtrl+Up", or alone as a mapped key) ---');
    for (const n of Object.keys(MODS)) out.push(`  ${n}`);
    out.push('--- media ---');
    for (const [name, code] of Object.entries(MEDIA)) {
        out.push(`  ${name.padEnd(14)} 0x${code.toString(16).padStart(2, '0')}`);
    }
    return out.join('\n');
}

module.exports = { encodeDriverValue, decodeDriverValue, listKeys };