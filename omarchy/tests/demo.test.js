// Demo mode tests: no Bluetooth (fake paths only, sockets cut off inside
// the demo), so safe to run anywhere.
//
//   gjs -m omarchy/tests/demo.test.js
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';

import {SocketHandler} from '../../src/lib/devices/socketByProfile.js';
import {GattHandler} from '../../src/lib/devices/socketByGatt.js';

Gio._promisify(Gio.DBusProxy, 'new_for_bus');
Gio._promisify(Gio.DBusProxy.prototype, 'call');

const repoRoot = GLib.path_get_dirname(GLib.path_get_dirname(
    GLib.path_get_dirname(Gio.File.new_for_uri(import.meta.url).get_path())));

let failures = 0;
function check(name, ok, detail = '') {
    print(`${ok ? 'ok  ' : 'FAIL'} ${name}${ok || !detail ? '' : ` -- ${detail}`}`);
    if (!ok)
        failures++;
}

// 1. Importing demo.js must not touch Bluetooth: main.js imports it in
//    every mode, and an import-time patch once silently cut real devices off.
const patched = () => [
    SocketHandler.prototype.startSocket, SocketHandler.prototype.sendMessage,
    GattHandler.prototype.startSocket, GattHandler.prototype.sendMessage,
    Gio.DBusProxy.prototype.get_cached_property,
];
const before = patched();
const {DemoHost} = await import('../backend/demo.js');
const {createSettings} = await import('../backend/settings.js');
check('importing demo.js leaves Bluetooth untouched', patched().every((f, i) => f === before[i]));

// 2. Start the demo: every device gets a panel.
const tmp = GLib.dir_make_tmp('omarchy-buds-demo-XXXXXX');
const settings = createSettings(repoRoot, tmp, {memory: true});
const host = new DemoHost({settings, extPath: repoRoot});
let list = [];
host.connect('devices-changed', (_h, l) => {
    list = l;
});
await host.start();
const ready = list.filter(d => d.dataHandler);
check(`every demo device has a panel (${ready.length}/${list.length})`, list.length > 100 && ready.length === list.length);
check('starting the demo cuts sockets off', SocketHandler.prototype.startSocket !== before[0]);

const tick = () => new Promise(resolve => GLib.timeout_add(GLib.PRIORITY_DEFAULT, 20, () => {
    resolve();
    return GLib.SOURCE_REMOVE;
}));

// 3. Clicking a noise control button keeps the row visible.
let lostRow = [];
for (const d of ready) {
    const h = d.dataHandler;
    if (!h.getProps().toggle1Visible)
        continue;
    for (const b of [1, 2, 3, 4]) {
        if (!h.getConfig()[`toggle1Button${b}Name`])
            continue;
        h.emitUIAction('toggle1State', b);
        if (!h.getProps().toggle1Visible) {
            lostRow.push(d.alias);
            break;
        }
    }
}
check('noise control rows stay after clicks', lostRow.length === 0, lostRow.join(', '));

// 4. Option controls keep the picked value, also after a noise control click.
let checked = 0;
const lost = [];
for (const d of ready) {
    const h = d.dataHandler, c = h.getConfig();
    for (const n of [1, 2, 3, 4]) {
        const kinds = c[`optionsBox${n}`] ?? [];
        const actions = [];
        if (kinds.includes('slider'))
            actions.push([`box${n}SliderValue`, 37]);
        if (kinds.includes('check-button'))
            actions.push([`box${n}CheckButton1State`, 1]);
        if (kinds.includes('radio-button'))
            actions.push([`box${n}RadioButtonState`, 2]);
        for (const [name, value] of actions) {
            h.emitUIAction(name, value);
            await tick();
            if (c.toggle1Button1Name) {
                h.emitUIAction('toggle1State', 1);
                await tick();
            }
            checked++;
            if (h.getProps()[name] !== value)
                lost.push(`${d.alias}:${name}`);
        }
    }
}
check(`option controls keep their value (${checked} checked)`, checked > 50 && lost.length === 0, lost.join(', '));

host.destroy();
Gio.Subprocess.new(['rm', '-rf', tmp], Gio.SubprocessFlags.NONE).wait(null);
print(failures ? `\n${failures} failed` : '\nall passed');
if (failures)
    imports.system.exit(1);
