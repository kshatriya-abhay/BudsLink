// Demo mode: one fake device for every model BudsLink knows, so the panel
// can be checked for each of them without owning the hardware.
//
// The real device classes build each panel (config and state), exactly as
// with real earbuds. Bluetooth is cut off at the bottom, inside this
// process only:
//   - socket start and send are no-ops (RFCOMM and BLE), so nothing is
//     ever connected or sent; every command becomes a no-op;
//   - BlueZ device properties for the fake paths are answered locally,
//     which is how families that detect the model from BlueZ (name,
//     modalias, UUIDs) are pointed at a given model.
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import GObject from 'gi://GObject';

import {SocketHandler} from '../../src/lib/devices/socketByProfile.js';
import {GattHandler} from '../../src/lib/devices/socketByGatt.js';
import {SppUUid} from '../../src/lib/devices/deviceUtils.js';

import {AirpodsDevice, DeviceTypeAirpods} from '../../src/lib/devices/airpods/airpodsDevice.js';
import {AirpodsModelList} from '../../src/lib/devices/airpods/airpodsConfig.js';
import {BoseBudsDevice, DeviceTypeBoseBuds} from '../../src/lib/devices/boseBuds/boseBudsDevice.js';
import {BoseBudsModelList} from '../../src/lib/devices/boseBuds/boseBudsConfig.js';
import {CambridgeBudsDevice, DeviceTypeCambridgeBuds} from '../../src/lib/devices/cambridgeBuds/cambridgeBudsDevice.js';
import {CambridgeBudsModelList} from '../../src/lib/devices/cambridgeBuds/cambridgeBudsConfig.js';
import {EdifierBudsDevice, DeviceTypeEdifierBuds} from '../../src/lib/devices/edifierBuds/edifierBudsDevice.js';
import {EdifierBudsModelList} from '../../src/lib/devices/edifierBuds/edifierBudsConfig.js';
import {GalaxyBudsDevice, DeviceTypeGalaxyBuds} from '../../src/lib/devices/galaxyBuds/galaxyBudsDevice.js';
import {GalaxyBudsModelList, GalaxyBudsModel, BudsLegacyUUID, DeviceIdPrefixUUID}
    from '../../src/lib/devices/galaxyBuds/galaxyBudsConfig.js';
import {checkForSamsungBuds} from '../../src/lib/devices/galaxyBuds/galaxyBudsDetector.js';
import {GfpsDevice, DeviceTypeGfps} from '../../src/lib/devices/gfps/gfpsDevice.js';
import {JlabBudsDevice, DeviceTypeJlabBuds} from '../../src/lib/devices/jlabBuds/jlabBudsDevice.js';
import {JlabBudsModelList} from '../../src/lib/devices/jlabBuds/jlabBudsConfig.js';
import {GoogleBudsDevice, DeviceTypeGoogleBuds} from '../../src/lib/devices/googleBuds/googleBudsDevice.js';
import {NothingBudsDevice, DeviceTypeNothingBuds} from '../../src/lib/devices/nothingBuds/nothingBudsDevice.js';
import {NothingBudsModelList} from '../../src/lib/devices/nothingBuds/nothingBudsConfig.js';
import {OpoBudsDevice, DeviceTypeOpoBuds} from '../../src/lib/devices/opoBuds/opoBudsDevice.js';
import {OpoBudsModelList} from '../../src/lib/devices/opoBuds/opoBudsConfig.js';
import {RedmiBudsDevice, DeviceTypeRedmiBuds} from '../../src/lib/devices/redmiBuds/redmiBudsDevice.js';
import {RedmiBudsModelList} from '../../src/lib/devices/redmiBuds/redmiBudsConfig.js';
import {SenhBudsDevice, DeviceTypeSenhBuds} from '../../src/lib/devices/senhBuds/senhBudsDevice.js';
import {SenhBudsModelList} from '../../src/lib/devices/senhBuds/senhBudsConfig.js';
import {SonyDevice, DeviceTypeSonyV1} from '../../src/lib/devices/sony/sonyDevice.js';
import {SonyConfiguration} from '../../src/lib/devices/sony/sonyConfig.js';
import {SoundcoreDevice, DeviceTypeSoundcore} from '../../src/lib/devices/soundcore/soundcoreDevice.js';
import {SoundcoreConfiguration, vendorUuidForModel} from '../../src/lib/devices/soundcore/soundcoreConfig.js';

const DEMO_PATH_PREFIX = '/org/bluez/hci0/dev_00_DE_00_00_';

// ---- cut Bluetooth off (this process only) ----------------------------------

let sentCount = 0;
const fakeBluez = new Map(); // object path -> {Name, Alias, Modalias, UUIDs, ...}
const BLUEZ_TYPES = {
    Alias: 's', Name: 's', Modalias: 's', Icon: 's',
    Connected: 'b', Paired: 'b', ServicesResolved: 'b', UUIDs: 'as',
};

// Applied only when the demo host starts. main.js imports this module in
// every mode, so nothing here may touch Bluetooth at import time.
let cutOff = false;
function cutOffBluetooth() {
    if (cutOff)
        return;
    cutOff = true;

    for (const klass of [SocketHandler, GattHandler]) {
        klass.prototype.startSocket = async function () {};
        klass.prototype.sendMessage = async function () {
            sentCount++;
        };
    }

    const realGetCached = Gio.DBusProxy.prototype.get_cached_property;
    Gio.DBusProxy.prototype.get_cached_property = function (name) {
        const props = fakeBluez.get(this.g_object_path);
        if (props && this.g_interface_name === 'org.bluez.Battery1')
            return name === 'Percentage' ? new GLib.Variant('y', 80) : null;
        if (props && this.g_interface_name === 'org.bluez.Device1') {
            const type = BLUEZ_TYPES[name];
            return type && props[name] !== undefined ? new GLib.Variant(type, props[name]) : null;
        }
        return realGetCached.call(this, name);
    };
}

const fakeProfileManager = {
    acquireFd: async () => -1,
    releaseFd: async () => {},
};

// ---- per-family recipes -------------------------------------------------------

// A device name that matches a model's name regex (e.g. /.*WF-C500.*/).
function nameFromPattern(re, fallback) {
    if (!re)
        return fallback;
    const guess = re.source.replace(/\.\*|\^|\$|\\/g, '');
    return re.test(guess) ? guess : fallback;
}

function galaxyBluez(model) {
    if (model.modelId === GalaxyBudsModel.GalaxyBuds)
        return {UUIDs: [BudsLegacyUUID]};
    for (let id = 0x0100; id < 0x0400; id++) {
        const uuids = [SppUUid, DeviceIdPrefixUUID + id.toString(16).padStart(4, '0')];
        if (checkForSamsungBuds(uuids, '') === model.modelId)
            return {UUIDs: uuids};
    }
    return {UUIDs: [SppUUid], Name: model.name ?? ''};
}

const RECIPES = [
    {type: DeviceTypeOpoBuds, Device: OpoBudsDevice, models: OpoBudsModelList,
        init: (d, m) => d.modelInitialized(m), battery: 'opo'},
    {type: DeviceTypeNothingBuds, Device: NothingBudsDevice, models: NothingBudsModelList,
        init: (d, m) => d.modelIntialized(m)},
    {type: DeviceTypeRedmiBuds, Device: RedmiBudsDevice, models: RedmiBudsModelList,
        init: (d, m) => {
            // A real Redmi socket learns its model from the buds' replies.
            if (d._redmiBudsSocket)
                d._redmiBudsSocket._modelData = m;
            d.modelIntialized(m, m.vid?.[0] ?? 0, m.pid?.[0] ?? 0);
        }},
    {type: DeviceTypeSenhBuds, Device: SenhBudsDevice, models: SenhBudsModelList,
        init: (d, m) => d.modelIntialized(m, m.modelId ?? m.id)},
    {type: DeviceTypeEdifierBuds, Device: EdifierBudsDevice, models: EdifierBudsModelList,
        init: (d, m) => d.modelIntialized(m, m.modelId ?? m.id)},
    {type: DeviceTypeAirpods, Device: AirpodsDevice, models: AirpodsModelList,
        bluez: m => ({Modalias: `bluetooth:v004Cp${m.key}d0001`})},
    {type: DeviceTypeBoseBuds, Device: BoseBudsDevice, models: BoseBudsModelList,
        bluez: m => ({Modalias: `bluetooth:v009Ep${m.id}d0001`})},
    {type: DeviceTypeSonyV1, Device: SonyDevice, models: SonyConfiguration,
        bluez: m => ({
            Modalias: m.modaliasPrefix ? `bluetooth:${m.modaliasPrefix}d0001` : '',
            Name: nameFromPattern(m.pattern, m.name ?? ''),
            UUIDs: [],
        })},
    {type: DeviceTypeSoundcore, Device: SoundcoreDevice, models: SoundcoreConfiguration,
        bluez: m => ({UUIDs: [SppUUid, vendorUuidForModel(m.modelCode)]})},
    {type: DeviceTypeCambridgeBuds, Device: CambridgeBudsDevice, models: CambridgeBudsModelList,
        bluez: m => ({Name: nameFromPattern(m.namePattern, m.name ?? '')})},
    {type: DeviceTypeGalaxyBuds, Device: GalaxyBudsDevice, models: GalaxyBudsModelList,
        bluez: galaxyBluez},
    {type: DeviceTypeJlabBuds, Device: JlabBudsDevice, models: JlabBudsModelList,
        bluez: m => ({Modalias: 'bluetooth:v05D6p000Ad0240', Name: m.name})},
    {type: DeviceTypeGoogleBuds, Device: GoogleBudsDevice, models: [{name: 'Pixel Buds'}]},
    {type: DeviceTypeGfps, Device: GfpsDevice, models: [{name: 'Google Fast Pair (generic)'}],
        init: d => d.updateInitDevice(3),
        after: d => d.updateNoiseControl?.(0x01, 0x07)},
];

const BATTERY = {
    battery1Level: 80, battery1Status: 'discharging',
    battery2Level: 65, battery2Status: 'discharging',
    battery3Level: 40, battery3Status: 'charging',
};
const OPO_BATTERY = {
    left: {level: 80, isCharging: false},
    right: {level: 65, isCharging: false},
    case: {level: 40, isCharging: true},
};

// AirPods configs carry no name field; their name is the comment above
// `key:` in each deviceConfigs file ("// AirPods Pro 2nd Gen").
function airpodsNames(repoRoot) {
    const names = new Map();
    const dir = Gio.File.new_for_path(GLib.build_filenamev(
        [repoRoot, 'src', 'lib', 'devices', 'airpods', 'deviceConfigs']));
    try {
        const files = dir.enumerate_children('standard::name', Gio.FileQueryInfoFlags.NONE, null);
        let info;
        while ((info = files.next_file(null))) {
            const [, bytes] = dir.get_child(info.get_name()).load_contents(null);
            const m = /\/\/\s*(.+)\n[\s\S]*?key:\s*'(\w+)'/.exec(new TextDecoder().decode(bytes));
            if (m)
                names.set(m[2], m[1].trim());
        }
    } catch {
        // names are cosmetic
    }
    return names;
}

let airpodsNameMap = new Map();
function modelName(m) {
    return m.name ?? airpodsNameMap.get(m.key) ?? m.key ?? m.modelId ?? m.id ?? 'unknown';
}

// Two things real buds do that demo devices can't, emulated here on the
// device's data handler (demo only):
//
// 1. Reveal rows. Some families keep defined rows hidden until the buds
//    report a mode (toggleNVisible, optionsBoxVisible). With no buds, show
//    what the config defines so its layout can be checked.
// 2. Confirm actions. Many families send a command and update their state
//    only when the buds confirm it (e.g. the AirPods ambient level slider),
//    so without buds every control would snap back. The last value the user
//    picked for each control is applied as if the buds had confirmed it.
//
// Device classes keep their own copy of the state and push it whole on
// every update, which would undo both. So setProps is wrapped to re-apply
// them on every push.
const CONFIRMABLE = /^(toggle[12]State|box[1-4](SliderValue|CheckButton[12]State|RadioButtonState))$/;

function emulateBuds(handler) {
    const config = handler.getConfig();
    const rows = [1, 2].filter(n =>
        [1, 2, 3, 4].filter(b => config[`toggle${n}Button${b}Name`]).length >= 2);
    const box = [1, 2, 3, 4].find(n => (config[`optionsBox${n}`] ?? []).length > 0);
    const confirmed = {};

    const apply = props => {
        const out = {...props, ...confirmed};
        for (const n of rows) {
            if (!out[`toggle${n}Visible`]) {
                out[`toggle${n}Visible`] = true;
                if (!out[`toggle${n}State`])
                    out[`toggle${n}State`] = 1;
            }
        }
        if (!out.optionsBoxVisible && box)
            out.optionsBoxVisible = box;
        return out;
    };

    const setProps = handler.setProps.bind(handler);
    handler.setProps = props => setProps(apply(props));

    // Connected after the device's own handler, so the device acts first
    // (and sends nothing, Bluetooth being cut off); then the "buds" confirm.
    handler.connect('ui-action', (_h, name, value) => {
        if (!CONFIRMABLE.test(name))
            return;
        confirmed[name] = value;
        GLib.idle_add(GLib.PRIORITY_DEFAULT, () => {
            handler.setProps(handler.getProps());
            return GLib.SOURCE_REMOVE;
        });
    });

    handler.setProps(handler.getProps());
}

// ---- host ----------------------------------------------------------------------

export const DemoHost = GObject.registerClass({
    GTypeName: 'OmarchyBuds_DemoHost',
    Signals: {
        'devices-changed': {param_types: [GObject.TYPE_JSOBJECT]},
        'notification': {param_types: [GObject.TYPE_STRING, GObject.TYPE_BOOLEAN]},
    },
}, class DemoHost extends GObject.Object {
    _init({settings, extPath, log}) {
        super._init();
        this._settings = settings;
        this._extPath = extPath;
        this._log = log ?? (() => {});
        this._entries = [];
        this._instances = [];
    }

    async start() {
        cutOffBluetooth();
        airpodsNameMap = airpodsNames(this._extPath);
        let index = 0;
        for (const recipe of RECIPES) {
            for (const model of recipe.models) {
                index++;
                const hex = index.toString(16).padStart(4, '0').toUpperCase();
                const path = `${DEMO_PATH_PREFIX}${hex.slice(0, 2)}_${hex.slice(2)}`;
                const alias = `${modelName(model)} (demo)`;
                fakeBluez.set(path, {
                    Alias: alias, Name: alias, Connected: true, Paired: true,
                    ServicesResolved: true, Modalias: '', UUIDs: [],
                    ...recipe.bluez?.(model),
                });
                const entry = {
                    path, address: `00:DE:00:00:${hex.slice(0, 2)}:${hex.slice(2)}`, alias,
                    connected: true, family: recipe.type, pending: false, dataHandler: null,
                    error: null,
                };
                this._entries.push(entry);
                try {
                    const device = new recipe.Device(this._settings, path, alias, this._extPath,
                        fakeProfileManager, (p, handler) => {
                            entry.dataHandler = handler;
                            this.sync();
                        });
                    this._instances.push(device);
                    recipe.init?.(device, model);
                    device.updateBatteryProps?.(recipe.battery === 'opo' ? OPO_BATTERY : {...BATTERY});
                    recipe.after?.(device);
                    if (entry.dataHandler)
                        emulateBuds(entry.dataHandler);
                } catch (e) {
                    entry.error = String(e?.message ?? e);
                    this._log(`demo: ${alias}: ${entry.error}`);
                }
            }
        }
        this.sync();
    }

    sync() {
        this.emit('devices-changed', this._entries);
    }

    get sentCount() {
        return sentCount;
    }

    send_notification() {}
    withdraw_notification() {}

    destroy() {
        for (const d of this._instances) {
            try {
                d.destroy?.();
            } catch {
                // demo teardown is best effort
            }
        }
        this._instances = [];
    }
});
