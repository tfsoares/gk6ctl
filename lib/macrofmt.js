// Parse/serialize the app's text macro format (["General"] / ["Script"]), as in libs/macro.js.
function stringToJson(content) {
    const result = { TaskList: [] };
    let state = '';
    String(content)
        .split(/[\r\n]+/)
        .forEach((line) => {
            if (!line) return;
            const match = line.match(/\s*\[(.+)\]\s*/);
            if (match) {
                state = match[1];
            } else {
                if (state === 'General') {
                    const kv = line.split('=');
                    if (kv[0] === 'Name') result['MacroName'] = kv[1];
                    if (kv[0] === 'ScriptID') result['GUID'] = kv[1];
                }
                if (state === 'Script') {
                    const arr = line.split(' ');
                    if (arr.length === 1) result.TaskList.push({ taskName: line, taskValue: '' });
                    else result.TaskList.push({ taskName: arr[0], taskValue: arr.slice(1).join(' ') });
                }
            }
        });
    return result;
}

function jsonToString(json) {
    return [
        '[General]',
        `Name=${json.MacroName}`,
        `ScriptID=${json.GUID}`,
        'Repeats=1',
        'StopMode=1',
        '',
        '[Script]',
        ...json.TaskList.map(({ taskName, taskValue }) => (taskValue ? `${taskName} ${taskValue}` : taskName)),
    ].join('\n');
}

module.exports = { stringToJson, jsonToString };