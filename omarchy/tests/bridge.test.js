// Bridge tests with a fake device: upstream's real DataHandler and settings
// schema, an in-memory settings backend, no Bluetooth.
//
//   gjs -m omarchy/tests/bridge.test.js
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';

import {Bridge} from '../backend/bridge.js';
import {SCHEMA_ID} from '../backend/settings.js';
import {DataHandler, createConfig, createProperties} from '../../src/lib/dataHandler.js';

const repoRoot = GLib.path_get_dirname(GLib.path_get_dirname(
    GLib.path_get_dirname(Gio.File.new_for_uri(import.meta.url).get_path())));
const tmp = GLib.dir_make_tmp('omarchy-buds-test-XXXXXX');

let failures = 0;
function check(name, ok, detail = '') {
    print(`${ok ? 'ok  ' : 'FAIL'} ${name}${ok || !detail ? '' : ` -- ${detail}`}`);
    if (!ok)
        failures++;
}

function memorySettings() {
    const dir = GLib.build_filenamev([tmp, 'schemas']);
    GLib.mkdir_with_parents(dir, 0o755);
    const proc = Gio.Subprocess.new(['glib-compile-schemas', `--targetdir=${dir}`,
        GLib.build_filenamev([repoRoot, 'data'])], Gio.SubprocessFlags.NONE);
    proc.wait(null);
    const source = Gio.SettingsSchemaSource.new_from_directory(dir, null, false);
    return new Gio.Settings({
        settings_schema: source.lookup(SCHEMA_ID, false),
        backend: Gio.memory_settings_backend_new(),
    });
}

const wait = ms => new Promise(resolve => GLib.timeout_add(GLib.PRIORITY_DEFAULT, ms, () => {
    resolve();
    return GLib.SOURCE_REMOVE;
}));

const PATH = '/org/bluez/hci0/dev_60_55_56_C4_1D_5E';
const settings = memorySettings();
settings.set_strv('opo-buds-list', [JSON.stringify({
    path: PATH, modelid: '064812', alias: 'Test buds', 'eq-preset': 0, 'inear-enable': true,
})]);

const config = {...createConfig(), toggle1Title: 'Noise control', toggle1Button1Name: 'Off'};
const handler = new DataHandler(config, createProperties());
const uiActions = [];
handler.connect('ui-action', (_h, name, value) => uiActions.push([name, value]));

const events = [];
const bridge = new Bridge({settings, stateDir: tmp, emit: e => events.push(e)});
const of = t => events.filter(e => e.t === t);

const device = {
    path: PATH, address: '60:55:56:C4:1D:5E', alias: 'Test buds', connected: true,
    family: 'opoBuds', pending: false, dataHandler: handler,
};

const main = async () => {
    bridge.updateDevices([device]);
    const dev = of('devices').at(-1)?.devices[0];
    check('devices: ready, model and controls', dev?.ready && dev.model === 'Realme Buds Air 7' && dev.controls === true,
        JSON.stringify(dev));
    check('config emitted', of('config').at(-1)?.config.toggle1Title === 'Noise control');
    check('state emitted', of('state').length === 1);
    check('settings emitted', of('settings').at(-1)?.settings?.['eq-preset'] === 0);
    check('model emitted', of('model').at(-1)?.model?.modelId === '064812');

    // Several property changes inside the debounce window -> one state event.
    handler.setProps({...createProperties(), battery1Level: 80});
    handler.setProps({...createProperties(), battery1Level: 79});
    await wait(300);
    check('state debounced', of('state').length === 2 && of('state').at(-1).state.battery1Level === 79,
        `${of('state').length} state events`);

    bridge.handle({cmd: 'ui-action', path: PATH, action: 'toggle1State', value: 2});
    check('ui-action reaches the device', uiActions.length === 1 && uiActions[0][1] === 2);

    bridge.handle({cmd: 'ui-action', path: PATH, action: 'settingsButtonClicked', value: 1});
    check('settingsButtonClicked refused', uiActions.length === 1 && of('error').at(-1)?.code === 'bad-ui-action');

    bridge.handle({cmd: 'set', path: PATH, key: 'eq-preset', value: 2});
    const item = JSON.parse(settings.get_strv('opo-buds-list')[0]);
    check('set writes the settings item', item['eq-preset'] === 2);
    check('settings re-emitted after set', of('settings').at(-1)?.settings?.['eq-preset'] === 2);

    bridge.handle({cmd: 'set', path: PATH, key: 'modelid', value: 'X'});
    bridge.handle({cmd: 'set', path: PATH, key: 'no-such-key', value: 1});
    check('identity and unknown keys refused',
        JSON.parse(settings.get_strv('opo-buds-list')[0]).modelid === '064812' &&
        of('error').slice(-2).every(e => e.code === 'bad-setting'));

    bridge.handle({cmd: 'controls', path: PATH, enabled: false});
    check('controls off reported', of('devices').at(-1).devices[0].controls === false);
    bridge.handle({cmd: 'ui-action', path: PATH, action: 'toggle1State', value: 1});
    bridge.handle({cmd: 'set', path: PATH, key: 'eq-preset', value: 3});
    check('controls off blocks commands',
        uiActions.length === 1 &&
        JSON.parse(settings.get_strv('opo-buds-list')[0])['eq-preset'] === 2 &&
        of('error').slice(-2).every(e => e.code === 'controls-disabled'));

    const reloaded = new Bridge({settings, stateDir: tmp, emit: () => {}});
    check('controls setting persists', reloaded.controlsEnabled('60:55:56:C4:1D:5E') === false);
    reloaded.destroy();

    bridge.updateDevices([{...device, connected: false, dataHandler: null}]);
    handler.setProps(createProperties());
    await wait(300);
    check('disconnect stops state events', of('state').length === 2);

    bridge.destroy();
};

await main();
Gio.Subprocess.new(['rm', '-rf', tmp], Gio.SubprocessFlags.NONE).wait(null);
print(failures ? `\n${failures} failed` : '\nall passed');
if (failures)
    imports.system.exit(1);
