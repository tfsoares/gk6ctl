// Onboard profile flashing — ported 1:1 from the GK6+ app's libs/profile.js
// (writeDeviceConfig + getMacroData + getLightData + covertLightData + convertMacroData).
//
// This reproduces EXACTLY what the app writes to keyboard flash for onboard layers 1..4,
// so that the keyboard keeps working with no host app running.
const fs = require('fs');
const path = require('path');
const CMD = require('./proto');
const cmf = require('./cmf');
const { crc16_ccitt } = require('./crc16');
const { stringToJson } = require('./macrofmt');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---------------------------------------------------------------------------
// Small lodash helpers the original uses.
// ---------------------------------------------------------------------------
const get = (obj, keyPath, def) => {
    const parts = Array.isArray(keyPath) ? keyPath : keyPath.split('.');
    let o = obj;
    for (const p of parts) {
        if (o == null) return def;
        o = o[p];
    }
    return o === undefined ? def : o;
};
const isEqual = (a, b) => JSON.stringify(a) === JSON.stringify(b);

// ---------------------------------------------------------------------------
// Macro encoding (used only when a profile binds keys to macros).
// ---------------------------------------------------------------------------
async function convertMacroData(index, breakType, byLoopTimes, guid, dataDir) {
    const file = path.join(dataDir, `Account/0/Macro/${guid}.cms`);
    if (!fs.existsSync(file)) {
        throw new Error(`macro file missing: ${file}`);
    }
    const { body } = cmf.decodeFile(file);
    const macroData = stringToJson(body);
    macroData.TaskList.push({ taskName: 'Delay', taskValue: '5' });
    const macroQueue = macroData.TaskList.map(({ taskName, taskValue }) => {
        const item = {};
        if (taskValue === '') {
            item.byType = 0x02;
            if (/Down/.test(taskName)) item.byStatus = 0x01;
            else if (/Up/.test(taskName)) item.byStatus = 0x02;
            if (/Left/.test(taskName)) item.byData0 = 0x01;
            else if (/Right/.test(taskName)) item.byData0 = 0x02;
        } else {
            if (taskName === 'Delay') {
                item.byType = 0x03;
                const delaytime = parseInt(taskValue, 10);
                item.byData1 = Math.floor(delaytime / 256);
                item.byData0 = delaytime % 256;
            } else {
                item.byType = 0x01;
                if (taskName === 'KeyDown') item.byStatus = 0x01;
                else if (taskName === 'KeyUp') item.byStatus = 0x02;
                const tv = String(taskValue);
                if (tv === '"Left Shift"' || tv === '"Shift"') item.byData1 = 0x02;
                else if (tv === '"Right Shift"' || tv === '"ShiftRight"') item.byData1 = 0x20;
                else if (tv === '"Left Ctrl"' || tv === '"Ctrl"') item.byData1 = 0x01;
                else if (tv === '"Right Ctrl"') item.byData1 = 0x10;
                else if (tv === '"Left Alt"' || tv === '"Alt"') item.byData1 = 0x04;
                else if (tv === '"Right Alt"') item.byData1 = 0x40;
                else if (tv === '"Left Win"' || tv === '"Win"' || tv === '"Meta"') item.byData1 = 0x08;
                else if (tv === '"Right Win"' || tv === '"MetaRight"') item.byData1 = 0x80;
                else item.byData0 = getKeyCode(tv);
            }
        }
        return item;
    });

    const frameData = Buffer.alloc(512, 0);
    macroQueue.forEach((item, index) => {
        ['byData0', 'byData1', 'byStatus', 'byType'].forEach((field, i) => {
            if (item[field]) frameData.writeUInt8(item[field], 8 + 4 * index + i);
        });
    });
    frameData.writeUInt16LE(0x55aa, 0);
    frameData.writeUInt16LE(crc16_ccitt(frameData.slice(8, 8 + macroQueue.length * 4)), 2);
    frameData.writeUInt8(macroQueue.length, 4);
    frameData.writeUInt8(index, 5);
    frameData.writeUInt8(breakType, 6);
    frameData.writeUInt8(byLoopTimes, 7);
    return frameData;
}

function getKeyCode(name) {
    if (name[0] === '"' && name[name.length - 1] === '"') name = name.slice(1, -1);
    // HID usage id map for the macro task keys (subset — matches app behaviour).
    const map = {
        A: 0x04, B: 0x05, C: 0x06, D: 0x07, E: 0x08, F: 0x09, G: 0x0a, H: 0x0b, I: 0x0c, J: 0x0d,
        K: 0x0e, L: 0x0f, M: 0x10, N: 0x11, O: 0x12, P: 0x13, Q: 0x14, R: 0x15, S: 0x16, T: 0x17,
        U: 0x18, V: 0x19, W: 0x1a, X: 0x1b, Y: 0x1c, Z: 0x1d,
        '1': 0x1e, '2': 0x1f, '3': 0x20, '4': 0x21, '5': 0x22, '6': 0x23, '7': 0x24, '8': 0x25,
        '9': 0x26, '0': 0x27, Enter: 0x28, Escape: 0x29, Backspace: 0x2a, Tab: 0x2b,
        Space: 0x2c, '-': 0x2d, '=': 0x2e, '[': 0x2f, ']': 0x30, '\\': 0x31, ';': 0x33,
        "'": 0x34, '`': 0x35, ',': 0x36, '.': 0x37, '/': 0x38, CapsLock: 0x39,
        F1: 0x3a, F2: 0x3b, F3: 0x3c, F4: 0x3d, F5: 0x3e, F6: 0x3f, F7: 0x40, F8: 0x41,
        F9: 0x42, F10: 0x43, F11: 0x44, F12: 0x45, PrintScreen: 0x46, ScrollLock: 0x47,
        Pause: 0x48, Insert: 0x49, Home: 0x4a, PageUp: 0x4b, Delete: 0x4c, End: 0x4d,
        PageDown: 0x4e, Right: 0x4f, Left: 0x50, Down: 0x51, Up: 0x52, NumLock: 0x53,
        Numpad0: 0x62, Numpad1: 0x59, Numpad2: 0x5a, Numpad3: 0x5b, Numpad4: 0x5c,
        Numpad5: 0x5d, Numpad6: 0x5e, Numpad7: 0x5f, Numpad8: 0x60, Numpad9: 0x61,
    };
    return map[name] != null ? map[name] : 0;
}

async function getMacroData(profileData, dataDir) {
    const guidList = [];
    const macroFrames = [];
    const indexData = Buffer.alloc(16 * 8 * 2, 0xff);
    (profileData.KeySet || []).forEach((keySet) => {
        if (!keySet.Task || keySet.Task.Type != 'Macro') return;
        const Guid = keySet.Task.Data.GUID;
        const { Task: { Data: { Repeats, StopMode } }, Index } = keySet;
        const checkIndex = guidList.indexOf(Guid);
        if (checkIndex != -1) {
            indexData.writeUInt8(checkIndex, Index);
            return;
        }
        guidList.push(Guid);
        indexData.writeUInt8(guidList.length - 1, Index);
        macroFrames.push(convertMacroData(guidList.length - 1, StopMode, Repeats, Guid, dataDir));
    });
    (profileData.FnKeySet || []).forEach((keySet) => {
        if (!keySet.Task || keySet.Task.Type != 'Macro') return;
        const Guid = keySet.Task.Data.GUID;
        const { Task: { Data: { Repeats, StopMode } }, Index } = keySet;
        const checkIndex = guidList.indexOf(Guid);
        if (checkIndex != -1) {
            indexData.writeUInt8(checkIndex, Index);
            return;
        }
        guidList.push(Guid);
        indexData.writeUInt8(guidList.length - 1, Index);
        macroFrames.push(convertMacroData(guidList.length - 1, StopMode, Repeats, Guid, dataDir));
    });
    return Promise.all(macroFrames).then((frames) => {
        const macroData = frames.length == 1 ? frames[0] : Buffer.concat(frames, frames.length * 512);
        return { macroData, count: frames.length, index: indexData };
    });
}

// ---------------------------------------------------------------------------
// Light effect data building (mode light + per-key light).
// ---------------------------------------------------------------------------
function getVlogDataBuffer(vlogData) {
    const buffer = Buffer.alloc(32);
    buffer.writeUInt8(vlogData.byType, 0);
    buffer.writeUInt8(vlogData.byLenght, 1);
    vlogData.byBitmap.copy(buffer, 2, 0, 22);
    buffer.writeUInt8(vlogData.byColor[0], 24);
    buffer.writeUInt8(vlogData.byColor[1], 25);
    buffer.writeUInt8(vlogData.byColor[2], 26);
    buffer.writeUInt8(vlogData.byColor[3], 27);
    buffer.writeUInt16LE(vlogData.byData0 || 0, 28);
    buffer.writeUInt16LE(vlogData.byData1 || 0, 30);
    return buffer;
}

function getLeHeaderBuffer(header) {
    const buffer = Buffer.alloc(16);
    buffer.writeUInt32LE(header.nFrameAddress, 0);
    buffer.writeUInt32LE(header.nFrameCount, 4);
    buffer.writeUInt32LE(header.nLogicAddress, 8);
    buffer.writeUInt32LE(header.nLogicCount, 12);
    return buffer;
}

async function covertLightData(guidList, jsonLightData, dataDir) {
    const headers = [];
    const lightDatas = [];
    let nFrameAddress = 512;
    for (let i = 0; i < guidList.length; i++) {
        const curGuid = guidList[i].GUID;
        const curLEConfigs = guidList[i].LEConfigs;
        let tempJsonData = {};

        if (curGuid != 'invailed') {
            const file = path.join(dataDir, `Account/0/LE/${curGuid}.le`);
            if (!fs.existsSync(file)) {
                console.warn(`[gk6ctl] skipping missing light effect: ${file}`);
                continue;
            }
            const { body } = cmf.decodeFile(file);
            try {
                tempJsonData = JSON.parse(body);
            } catch (e) {
                continue;
            }
            if (curLEConfigs && tempJsonData['LEConfigs'] && tempJsonData['LEConfigs'].length == curLEConfigs.length) {
                for (let j = 0; j < tempJsonData['LEConfigs'].length; j++) {
                    tempJsonData['LEConfigs'][j]['Color'] = curLEConfigs[j]['Color'];
                }
            }
        } else {
            tempJsonData['Data'] = jsonLightData;
            const tHeadData = {};
            tHeadData.nLogicAddress = 0;
            tHeadData.nLogicCount = 0;
            tHeadData.nFrameCount = 1;
            tHeadData.nFrameAddress = nFrameAddress;
            const ptrFrameData = Buffer.alloc(176 * 4 + 4, 0);
            const nLen = 176 * 4;
            tHeadData.nFrameAddress = nFrameAddress;
            for (const it in tempJsonData['Data']) {
                const nKey = parseInt(it, 10);
                if (nKey >= 176) continue;
                const nKeyValue = parseInt(tempJsonData['Data'][nKey], 16);
                ptrFrameData[4 + nKey * 4] = (nKeyValue >> 16) & 0xff;
                ptrFrameData[4 + nKey * 4 + 1] = (nKeyValue >> 8) & 0xff;
                ptrFrameData[4 + nKey * 4 + 2] = (nKeyValue >> 0) & 0xff;
                ptrFrameData[4 + nKey * 4 + 3] = 100;
            }
            headers.push(tHeadData);
            lightDatas.push(ptrFrameData);
            nFrameAddress += 176 * 4 + 4;
            continue;
        }

        const tHeadData = {};
        tHeadData.nFrameAddress = nFrameAddress;
        const jsonData = JSON.parse(JSON.stringify(tempJsonData));
        jsonData['Frames'] = [];
        for (let i = 0; i < (tempJsonData['Frames'] || []).length; i++) {
            let nCountFrames = 1;
            if (Number.isInteger(tempJsonData['Frames'][i]['Count'])) nCountFrames = tempJsonData['Frames'][i]['Count'];
            for (let j = 0; j < nCountFrames; j++) jsonData['Frames'].push(tempJsonData['Frames'][i]);
        }
        tHeadData.nFrameCount = jsonData['Frames'].length;
        const ptrFrameData = Buffer.alloc(tHeadData.nFrameCount * 26, 0);
        for (let i = 0; i < jsonData['Frames'].length; i++) {
            ptrFrameData[i * 26 + 0] = 3;
            ptrFrameData[i * 26 + 2] = 22;
            for (const it in jsonData['Frames'][i]['Data']) {
                const nKey = parseInt(it, 10);
                if (nKey >= 176) continue;
                ptrFrameData[i * 26 + 4 + Math.floor(nKey / 8)] |= 1 << (nKey % 8);
            }
        }
        tHeadData.nLogicAddress = nFrameAddress + 26 * jsonData['Frames'].length;
        tHeadData.nLogicCount = (jsonData['LEConfigs'] || []).length;

        const vLogicData = [];
        for (let i = 0; i < (jsonData['LEConfigs'] || []).length; i++) {
            const tLogicData = { byColor: new Array(4) };
            tLogicData.byLenght = 32;
            const byBitmap = Buffer.alloc(22, 0);
            for (let j = 0; j < jsonData['LEConfigs'][i]['Keys'].length; j++) {
                const nLogicIndex = jsonData['LEConfigs'][i]['Keys'][j] * 1;
                byBitmap[Math.floor(nLogicIndex / 8)] |= 1 << (nLogicIndex % 8);
            }
            tLogicData.byBitmap = byBitmap;
            const nKeyValue = parseInt(jsonData['LEConfigs'][i]['Color'], 16);
            tLogicData.byColor[2] = (nKeyValue >> 0) & 0xff;
            tLogicData.byColor[1] = (nKeyValue >> 8) & 0xff;
            tLogicData.byColor[0] = (nKeyValue >> 16) & 0xff;
            tLogicData.byColor[3] = 0;
            if (jsonData['LEConfigs'][i]['Type'] * 1 == 0) tLogicData.byType = 0;
            else if (jsonData['LEConfigs'][i]['Type'] * 1 == 1) {
                tLogicData.byType = 1;
                tLogicData.byData0 = Math.floor(360 / (jsonData['LEConfigs'][i]['Count'] * 1));
            } else if (jsonData['LEConfigs'][i]['Type'] * 1 == 2) {
                tLogicData.byType = 2;
                tLogicData.byData1 = jsonData['LEConfigs'][i]['StayCount'] * 1;
                tLogicData.byData0 = Math.floor(100 / (jsonData['LEConfigs'][i]['Count'] * 1));
            }
            vLogicData.push(tLogicData);
        }
        nFrameAddress = tHeadData.nLogicAddress + 32 * (jsonData['LEConfigs'] || []).length;
        headers.push(tHeadData);

        const nDataLength = tHeadData.nFrameCount * 26 + vLogicData.length * 32;
        const ptrCurData = Buffer.alloc(nDataLength, 0);
        ptrFrameData.copy(ptrCurData, 0, 0, tHeadData.nFrameCount * 26);
        for (let i = 0; i < vLogicData.length; i++) {
            getVlogDataBuffer(vLogicData[i]).copy(ptrCurData, tHeadData.nFrameCount * 26 + i * 32, 0, 32);
        }
        lightDatas.push(ptrCurData);
    }

    if (headers.length === 0) return null;

    let lightData = null;
    let nTotalSize = 128 * 1024 - 512;
    let nLightCount = 0;
    for (let i = 0; i < lightDatas.length; i++) {
        if (nTotalSize - lightDatas[i].length < 0) return lightData;
        nTotalSize -= lightDatas[i].length;
        nLightCount++;
    }
    if (nLightCount !== 0) {
        lightData = Buffer.alloc(128 * 1024 - nTotalSize, 0xff);
        let nAddress = 512;
        for (let i = 0; i < nLightCount; i++) {
            lightDatas[i].copy(lightData, nAddress, 0, lightDatas[i].length);
            nAddress += lightDatas[i].length;
        }
        for (let i = 0; i < headers.length; i++) {
            getLeHeaderBuffer(headers[i]).copy(lightData, i * 16, 0, 16);
        }
    }
    return lightData;
}

function getLightData(profileData, dataDir) {
    const guidList = [];
    let jsonLightData;
    let indexData = Buffer.alloc(16 * 8, 0xff);
    if (profileData.ModeLE && typeof profileData.ModeLE.GUID == 'string' && Array.isArray(profileData.KeySet)) {
        if (profileData.ModeLE.GUID) {
            guidList.push({ GUID: profileData.ModeLE.GUID, LEConfigs: get(profileData, ['ModeLE', 'Params', 'LEConfigs']) });
        } else {
            guidList.push({ GUID: 'invailed' });
            jsonLightData = profileData.ModeLE.LEData;
        }
        profileData.KeySet.forEach((keySet) => {
            const temp = {};
            if (keySet.KeyLE && keySet.KeyLE.GUID) {
                temp.GUID = keySet.KeyLE.GUID;
                temp.LEConfigs = get(keySet, ['KeyLE', 'Params', 'LEConfig']);
                const checkIndex = guidList.findIndex((obj) => isEqual(obj, temp));
                if (checkIndex != -1) {
                    indexData.writeUInt8(checkIndex, keySet.Index * 1);
                    return;
                }
                guidList.push(temp);
                indexData.writeUInt8(guidList.length - 1, keySet.Index * 1);
            }
        });
    } else if (Array.isArray(profileData.DriverLE)) {
        profileData.DriverLE.forEach(({ GUID, LEConfigs }) => {
            if (GUID) {
                const temp = { GUID, LEConfigs };
                const checkIndex = guidList.findIndex((obj) => isEqual(obj, temp));
                if (checkIndex != -1) return;
                guidList.push(temp);
            }
        });
    }
    return covertLightData(guidList, jsonLightData, dataDir).then((lightData) => ({
        lightData,
        indexData,
    }));
}

// ---------------------------------------------------------------------------
// writeDeviceConfig: flash an onboard layer (ModeIndex 1..4).
// ---------------------------------------------------------------------------
async function writeDeviceConfig(device, jsonData, dataDir) {
    const byCol = jsonData._matrix.key_col;
    const byRow = jsonData._matrix.key_row;
    const byModel = jsonData.ModeIndex * 1;
    if (!(byModel >= 1 && byModel <= 4)) {
        throw new Error(`ModeIndex ${jsonData.ModeIndex} is not an onboard layer (use 1..4)`);
    }

    const { macroData: pMacroData, count: nMacroCount, index: pMacroIndex } = await getMacroData(jsonData, dataDir);
    const { indexData: pKeyIndex, lightData: pLightData } = await getLightData(jsonData, dataDir);

    const byKeyDefine = Buffer.alloc(byCol * byRow * 4, 0xff);
    const byFnKeyDefine = Buffer.alloc(byCol * byRow * 4, 0xff);

    if (Array.isArray(jsonData.KeySet)) {
        let nKeyCount = jsonData.KeySet.length;
        if (nKeyCount > 128) nKeyCount = 128;
        for (let i = 0; i < nKeyCount; i++) {
            const nIndex = jsonData['KeySet'][i]['Index'] * 1;
            const nKeyValue = parseInt(jsonData.KeySet[i].DriverValue, 16);
            if (nKeyValue == 0x0a010001) byKeyDefine[nIndex * 4] = pMacroIndex[nIndex];
            else byKeyDefine[nIndex * 4] = (nKeyValue >> 0) & 0xff;
            byKeyDefine[nIndex * 4 + 1] = (nKeyValue >> 8) & 0xff;
            byKeyDefine[nIndex * 4 + 2] = (nKeyValue >> 16) & 0xff;
            byKeyDefine[nIndex * 4 + 3] = (nKeyValue >> 24) & 0xff;
        }
        await device.request(CMD.CleanData(byModel, 0x01));
        for (let i = 0; i < byKeyDefine.length; i += 56) {
            await device.request(CMD.writeKeyData(byModel, i, byKeyDefine.slice(i, i + 56)));
            await sleep(10);
        }
    }

    if (Array.isArray(jsonData.FnKeySet)) {
        let nKeyCount = jsonData.FnKeySet.length;
        if (nKeyCount > 128) nKeyCount = 128;
        for (let i = 0; i < nKeyCount; i++) {
            const nIndex = jsonData['FnKeySet'][i]['Index'] * 1;
            const nKeyValue = parseInt(jsonData['FnKeySet'][i]['DriverValue'], 16);
            if (nKeyValue == 0x0a010001) byFnKeyDefine[nIndex * 4] = pMacroIndex[256 + nIndex];
            else byFnKeyDefine[nIndex * 4] = (nKeyValue >> 0) & 0xff;
            byFnKeyDefine[nIndex * 4 + 1] = (nKeyValue >> 8) & 0xff;
            byFnKeyDefine[nIndex * 4 + 2] = (nKeyValue >> 16) & 0xff;
            byFnKeyDefine[nIndex * 4 + 3] = (nKeyValue >> 24) & 0xff;
        }
        await device.request(CMD.CleanData(byModel, 0x07));
        for (let i = 0; i < byFnKeyDefine.length; i += 56) {
            await device.request(CMD.writeFnData(byModel, i, byFnKeyDefine.slice(i, i + 56)));
            await sleep(10);
        }
    }

    if (typeof jsonData['LEData'] == 'object' && jsonData['LEData'] !== null) {
        const byLEDataCfg = Buffer.alloc(176 * 4, 0);
        for (const it in jsonData['LEData']) {
            const nKey = parseInt(it, 10);
            if (nKey >= 176) continue;
            const nKeyValue = parseInt(jsonData['LEData'][nKey], 16);
            byLEDataCfg[nKey * 4 + 2] = (nKeyValue >> 0) & 0xff;
            byLEDataCfg[nKey * 4 + 1] = (nKeyValue >> 8) & 0xff;
            byLEDataCfg[nKey * 4] = (nKeyValue >> 16) & 0xff;
            byLEDataCfg[nKey * 4 + 3] = 100;
        }
        await device.request(CMD.CleanData(byModel, 0x03));
        for (let n = 0; n < 176 * 4; n += 56) {
            await device.request(CMD.writeModeLE(byModel, n, byLEDataCfg.slice(n, n + 56)));
            await sleep(10);
        }
    }

    const wMacroLen = nMacroCount * 512;
    await device.request(CMD.CleanData(byModel, 0x04));
    if (pMacroData) {
        for (let i = 0; i < wMacroLen; i += 56) {
            await device.request(CMD.writeMacro(byModel, i, pMacroData.slice(i, i + 56)));
            await sleep(10);
        }
    }

    await device.request(CMD.CleanData(byModel, 0x05));
    if (pKeyIndex) {
        for (let i = 0; i < byCol * byRow; i += 56) {
            await device.request(CMD.writeLightKey(byModel, i, pKeyIndex.slice(i, i + 56)));
        }
        await sleep(10);
    }

    await device.request(CMD.CleanData(byModel, 0x06));
    if (pLightData) {
        for (let i = 0; i < pLightData.length; i += 56) {
            await device.request(CMD.writeLightData(byModel, i, pLightData.slice(i, i + 56)));
            await sleep(10);
        }
    }
}

// Switch the keyboard to a specific onboard layer.
async function activateLayer(device, mode, { toggleReport = true } = {}) {
    if (toggleReport) {
        try {
            await device.request(CMD.ToggleKeyReport(false), 1000);
        } catch (e) {
            /* best-effort */
        }
    }
    await device.request(CMD.CHANGE_MODE(mode), 2000);
}

module.exports = { writeDeviceConfig, activateLayer, get, getMacroData, getLightData };