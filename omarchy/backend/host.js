// Headless stand-in for upstream's app.js.
//
// EnhancedDeviceSupportManager expects a host ("toggle") object. This
// provides the same members app.js does, minus the GTK window and the
// D-Bus service: settings, extPath, one enabled flag per device family,
// sync(), and send/withdraw_notification().
import GObject from 'gi://GObject';

import {BluetoothClient} from '../../src/lib/bluetoothClient.js';
import {EnhancedDeviceSupportManager} from '../../src/lib/enhancedDeviceSupportManager.js';

const FAMILIES = [
    'airpods', 'sony', 'galaxyBuds', 'nothingBuds', 'googleBuds', 'redmiBuds',
    'senhBuds', 'boseBuds', 'edifierBuds', 'opoBuds', 'cambridgeBuds',
    'soundcore', 'gfps',
];

export const Host = GObject.registerClass({
    GTypeName: 'OmarchyBuds_Host',
    Signals: {
        // Emitted after every sync with the full device list.
        'devices-changed': {param_types: [GObject.TYPE_JSOBJECT]},
        'notification': {param_types: [GObject.TYPE_STRING, GObject.TYPE_BOOLEAN]},
    },
}, class Host extends GObject.Object {
    // detectOnly: identify device families but never create device objects,
    // so nothing is ever sent to a device.
    _init({settings, extPath, detectOnly = false}) {
        super._init();
        this.settings = settings;
        this.extPath = extPath;
        this._detectOnly = detectOnly;
        for (const family of FAMILIES)
            this[`${family}Enabled`] = true;

        this._syncRunning = false;
        this._syncPending = false;
        this._devices = new Map();
    }

    async start() {
        this._client = new BluetoothClient();
        this._manager = new EnhancedDeviceSupportManager(this);
        await this._client.initClient();
        this._client.connect('devices-update', () => this.sync());
        this.sync();
    }

    // Called by the manager when detection or a device's data handler changes.
    sync() {
        if (this._syncRunning) {
            this._syncPending = true;
            return;
        }
        this._syncRunning = true;
        do {
            this._syncPending = false;
            this._sync();
        } while (this._syncPending);
        this._syncRunning = false;
    }

    _sync() {
        const list = [];
        for (const [path, dev] of this._client.devices) {
            const result = this._manager.onDeviceSync(path, dev.connected, dev.icon, dev.alias);
            const entry = {
                path,
                address: addressFromPath(path),
                alias: dev.alias ?? '',
                connected: Boolean(dev.connected),
                family: result?.type ?? null,
                pending: Boolean(result?.pendingDetection),
                dataHandler: result?.dataHandler ?? null,
            };
            this._devices.set(path, entry);
            list.push(entry);
        }

        if (!this._detectOnly)
            this._manager.updateEnhancedDevicesInstance();

        this.emit('devices-changed', list);
    }

    get devices() {
        return this._devices;
    }

    // Notifier's only notification: another program holds a device family's
    // Bluetooth profile, so this backend can't talk to those devices.
    send_notification(id, _notification) {
        this.emit('notification', id, true);
    }

    withdraw_notification(id) {
        this.emit('notification', id, false);
    }

    destroy() {
        this._manager?.destroy();
        this._manager = null;
    }
});

export function addressFromPath(path) {
    const m = /dev_([0-9A-Fa-f_]{17})$/.exec(path ?? '');
    return m ? m[1].replace(/_/g, ':').toUpperCase() : '';
}
