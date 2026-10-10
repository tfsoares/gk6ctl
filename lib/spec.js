// Build a profile JSON body (same shape the app stores and flash.js expects) from
// a simple human-friendly spec. Unspecified keys are left 0xFF so the keyboard
// keeps its factory default for them.
//
// Spec format (JSON):
// {
//   "name": "Gaming layer",
//   "mode": 3,                           // onboard layer 1..4
//   "keys":   [ { "index": 65, "key": "LCtrl+Up" }, ... ],    // base layer
//   "fnKeys": [ { "index": 2, "key": "MediaPlayPause" }, ... ] // Fn layer
// }
const { encodeDriverValue, decodeDriverValue } = require('./keys');

function toKeySet(entries, maxIdx) {
    const seen = new Set();
    return (entries || []).map(({ index, key }) => {
        const idx = index * 1;
        if (!Number.isInteger(idx) || idx < 0 || idx >= maxIdx) {
            throw new Error(`index ${index} out of range (0..${maxIdx - 1})`);
        }
        if (seen.has(idx)) throw new Error(`duplicate index ${idx}`);
        seen.add(idx);
        const DriverValue = encodeDriverValue(key);
        return {
            Index: idx,
            MenuPID: '',
            MenuID: '',
            MenuName: decodeDriverValue(DriverValue),
            DriverValue,
            Task: { Type: '', Data: { Type: 'Macro', GUID: '', Repeats: 1, StopMode: 1 } },
            KeyLE: { GUID: '', Name: '' },
        };
    });
}

function buildProfile(spec) {
    if (!spec || typeof spec !== 'object') throw new Error('spec must be a JSON object');
    const mode = spec.mode * 1;
    if (!(mode >= 1 && mode <= 4)) throw new Error('mode must be 1..4 (onboard layers only)');
    if (!Array.isArray(spec.keys) && spec.keys != null) throw new Error('spec.keys must be an array');
    const maxIdx = 128;
    return {
        Name: spec.name || 'layer_onboard',
        ModeIndex: mode,
        Active: 0,
        Game: { GUID: 'ECA1CE5C-597C-4047-9F78-AB638FDE7737', Name: 'Idle' },
        Application: { AppName: '', AppPath: '' },
        KeySet: toKeySet(spec.keys || [], maxIdx),
        FnKeySet: toKeySet(spec.fnKeys || [], maxIdx),
    };
}

module.exports = { buildProfile };