// JSON-lines bridge between upstream's per-device data and the shell.
//
// Events out (one object per line, always a full snapshot of its scope):
//   devices   every paired device with its family and our Controls flag
//   config    upstream createConfig() shape: what the generic panel shows
//   state     upstream createProperties() shape: current values
//   settings  this device's item from upstream's <family>-list settings key
//   model     the matched device config (capabilities), where known
//
// Commands in:
//   {"cmd":"ui-action","path":…,"action":"toggle1State","value":2}
//   {"cmd":"set","path":…,"key":"eq-preset","value":1}
//   {"cmd":"controls","path":…,"enabled":false}
import GLib from 'gi://GLib';

import {OpoBudsModelList} from '../../src/lib/devices/opoBuds/opoBudsConfig.js';
import {addressFromPath} from './host.js';

const STATE_DEBOUNCE_MS = 200;

// Upstream settings key holding each family's per-device JSON items.
const SETTINGS_KEYS = {
    airpods: 'airpods-list',
    sonyV1: 'sony-list',
    sonyV2: 'sony-list',
    galaxyBuds: 'galaxy-buds-list',
    galaxybudslegacy: 'galaxy-buds-list',
    nothingBuds: 'nothing-buds-list',
    googleBuds: 'google-buds-list',
    redmiBuds: 'redmi-buds-list',
    senhBuds: 'senh-buds-list',
    boseBuds: 'bose-buds-list',
    edifierBuds: 'edifier-buds-list',
    opoBuds: 'opo-buds-list',
    cambridgeBuds: 'cambridge-buds-list',
    soundcore: 'soundcore-list',
    gfps: 'gfps-list',
};

// Families that record which model they matched (as 'modelid').
const MODEL_LISTS = {
    opoBuds: OpoBudsModelList,
};

// The generic panel's widgets. settingsButtonClicked is left out on purpose:
// upstream answers it by opening a GTK window.
const UI_ACTION = /^(toggle[12]State|box[1-4](SliderValue|SliderIsDragging|CheckButton[12]State|RadioButtonState))$/;

// Identity fields the device code owns; never written from the shell.
const READONLY_KEYS = new Set(['path', 'modelid', 'alias', 'fw-version']);

export class Bridge {
    constructor({settings, emit, stateDir}) {
        this._settings = settings;
        this._emit = emit;
        this._controlsPath = GLib.build_filenamev([stateDir, 'devices.json']);
        this._controls = this._loadControls();
        this._devices = new Map();   // path -> device entry from the host
        this._watched = new Map();   // path -> {dataHandler, ids[], stateTimer}
        this._settingsIds = new Map(); // settings key -> handler id
    }

    // ---- device list -------------------------------------------------

    updateDevices(list) {
        const seen = new Set();
        for (const d of list) {
            seen.add(d.path);
            this._devices.set(d.path, d);
            const handler = d.connected ? d.dataHandler : null;
            const current = this._watched.get(d.path);
            if (current?.dataHandler !== handler) {
                this._unwatch(d.path);
                if (handler)
                    this._watch(d, handler);
            }
        }
        for (const path of [...this._devices.keys()]) {
            if (!seen.has(path)) {
                this._unwatch(path);
                this._devices.delete(path);
            }
        }
        this._emit({t: 'devices', devices: list.map(d => this._publicDevice(d))});
    }

    _publicDevice(d) {
        const model = d.dataHandler ? this._resolveModel(d) : null;
        return {
            path: d.path,
            address: d.address,
            alias: d.alias,
            connected: d.connected,
            family: d.family,
            pending: d.pending,
            ready: Boolean(d.dataHandler),
            model: model?.name ?? null,
            controls: this.controlsEnabled(d.address),
        };
    }

    // ---- per-device data ---------------------------------------------

    _watch(device, handler) {
        const {path} = device;
        const entry = {dataHandler: handler, ids: [], stateTimer: 0};
        entry.ids.push(handler.connect('configuration-changed', () => this._emitConfig(path)));
        entry.ids.push(handler.connect('properties-changed', () => this._scheduleState(path)));
        this._watched.set(path, entry);
        this._watchSettingsKey(device.family);

        this._emitConfig(path);
        this._emitState(path);
        this._emitSettings(path);
        this._emitModel(path);
    }

    _unwatch(path) {
        const entry = this._watched.get(path);
        if (!entry)
            return;
        for (const id of entry.ids)
            entry.dataHandler.disconnect(id);
        if (entry.stateTimer)
            GLib.source_remove(entry.stateTimer);
        this._watched.delete(path);
    }

    _emitConfig(path) {
        const handler = this._watched.get(path)?.dataHandler;
        if (handler)
            this._emit({t: 'config', path, config: handler.getConfig()});
    }

    _scheduleState(path) {
        const entry = this._watched.get(path);
        if (!entry || entry.stateTimer)
            return;
        entry.stateTimer = GLib.timeout_add(GLib.PRIORITY_DEFAULT, STATE_DEBOUNCE_MS, () => {
            entry.stateTimer = 0;
            this._emitState(path);
            return GLib.SOURCE_REMOVE;
        });
    }

    _emitState(path) {
        const handler = this._watched.get(path)?.dataHandler;
        if (handler)
            this._emit({t: 'state', path, state: handler.getProps()});
    }

    _watchSettingsKey(family) {
        const key = SETTINGS_KEYS[family];
        if (!key || this._settingsIds.has(key))
            return;
        const id = this._settings.connect(`changed::${key}`, () => {
            for (const [path, d] of this._devices) {
                if (SETTINGS_KEYS[d.family] === key && this._watched.has(path)) {
                    this._emitSettings(path);
                    this._emitModel(path);
                }
            }
        });
        this._settingsIds.set(key, id);
    }

    _settingsItem(device) {
        const key = SETTINGS_KEYS[device?.family];
        if (!key)
            return {key: null, list: [], index: -1};
        const list = this._settings.get_strv(key).map(s => {
            try {
                return JSON.parse(s);
            } catch {
                return null;
            }
        });
        const index = list.findIndex(item => item?.path === device.path);
        return {key, list, index};
    }

    _emitSettings(path) {
        const {list, index} = this._settingsItem(this._devices.get(path));
        this._emit({t: 'settings', path, settings: index >= 0 ? list[index] : null});
    }

    _resolveModel(device) {
        const models = MODEL_LISTS[device.family];
        if (!models)
            return null;
        const {list, index} = this._settingsItem(device);
        const id = index >= 0 ? list[index]?.modelid : null;
        return id ? models.find(m => m.modelId?.toUpperCase() === String(id).toUpperCase()) ?? null : null;
    }

    _emitModel(path) {
        const device = this._devices.get(path);
        this._emit({t: 'model', path, model: device ? this._resolveModel(device) : null});
    }

    // ---- Controls switch (read-only mode) ------------------------------

    _loadControls() {
        try {
            const [, bytes] = GLib.file_get_contents(this._controlsPath);
            const data = JSON.parse(new TextDecoder().decode(bytes));
            return data && typeof data === 'object' ? data : {};
        } catch {
            return {};
        }
    }

    controlsEnabled(address) {
        return this._controls[address]?.controls !== false;
    }

    _setControls(address, enabled) {
        this._controls[address] = {...this._controls[address], controls: enabled};
        GLib.file_set_contents(this._controlsPath, JSON.stringify(this._controls, null, 2));
    }

    // ---- commands -----------------------------------------------------

    handle(cmd) {
        const device = this._devices.get(cmd.path);
        if (cmd.cmd === 'controls') {
            const address = device?.address ?? addressFromPath(cmd.path);
            if (!address)
                return this._error('unknown-device', cmd.path);
            this._setControls(address, Boolean(cmd.enabled));
            this._emit({t: 'devices', devices: [...this._devices.values()].map(d => this._publicDevice(d))});
            return;
        }

        if (cmd.cmd !== 'ui-action' && cmd.cmd !== 'set')
            return this._error('unknown-command', String(cmd.cmd));
        if (!device || !this._watched.has(cmd.path))
            return this._error('not-ready', String(cmd.path));
        if (!this.controlsEnabled(device.address))
            return this._error('controls-disabled', cmd.path);

        if (cmd.cmd === 'ui-action') {
            if (!UI_ACTION.test(String(cmd.action)) || !Number.isInteger(cmd.value))
                return this._error('bad-ui-action', `${cmd.action}=${cmd.value}`);
            this._watched.get(cmd.path).dataHandler.emitUIAction(cmd.action, cmd.value);
            return;
        }

        // set: change one existing field of this device's settings item. The
        // device code watches the key and sends the command to the buds.
        const {key, list, index} = this._settingsItem(device);
        if (index < 0)
            return this._error('no-settings', cmd.path);
        if (READONLY_KEYS.has(cmd.key) || !(cmd.key in list[index]))
            return this._error('bad-setting', String(cmd.key));
        list[index][cmd.key] = cmd.value;
        this._settings.set_strv(key, list.map(item => JSON.stringify(item)));
    }

    _error(code, message) {
        this._emit({t: 'error', code, message});
    }

    destroy() {
        for (const path of [...this._watched.keys()])
            this._unwatch(path);
        for (const id of this._settingsIds.values())
            this._settings.disconnect(id);
        this._settingsIds.clear();
    }
}
