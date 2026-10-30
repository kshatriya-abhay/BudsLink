'use strict';
import Gio from 'gi://Gio';
import GObject from 'gi://GObject';

import {createLogger, getDeviceIdentifier} from '../logger.js';
import {createConfig, createProperties, DataHandler} from '../../dataHandler.js';
import {DeviceTypeJlabBuds, JieliVendorId, findJlabModel} from './jlabBudsConfig.js';

export {DeviceTypeJlabBuds};

// Jieli chip (modalias vendor) and a known JLab model name.
export function isJlabBuds(bluezDeviceProxy, _uuids) {
    const modalias = bluezDeviceProxy.Modalias ?? '';
    const name = bluezDeviceProxy.Name ?? bluezDeviceProxy.Alias ?? '';
    if (!modalias)
        return {supported: 'pending', bluezProps: ['Modalias']};
    const jieli = modalias.toUpperCase().includes(`V${JieliVendorId}P`);
    return {supported: jieli && findJlabModel(name) ? 'yes' : 'no', bluezProps: []};
}

const BatteryInterface = `
<node>
  <interface name="org.bluez.Battery1">
    <property name="Percentage" type="y" access="read"/>
  </interface>
</node>`;
const BatteryProxy = Gio.DBusProxy.makeProxyWrapper(BatteryInterface);

// JLab headphones (Jieli). For now: one battery, read from BlueZ (the
// headphones report it over the hands-free profile). Their Fast Pair
// battery report is unreliable (all zeros, three slots), so it isn't used.
// Controls (Jieli RCSP over SPP) are not implemented yet, so this class
// never connects to the device.
export const JlabBudsDevice = GObject.registerClass({
    GTypeName: 'BudsLink_JlabBudsDevice',
}, class JlabBudsDevice extends GObject.Object {
    _init(settings, devicePath, alias, extPath, _profileManager, updateDeviceMapCb) {
        super._init();
        this._log = createLogger(`JlabBudsDevice-${getDeviceIdentifier(devicePath)}`);
        this._log.info('------------------- JlabBudsDevice init -------------------');
        this._devicePath = devicePath;
        this._alias = alias;
        this._extPath = extPath;
        this.updateDeviceMapCb = updateDeviceMapCb;
        this._model = findJlabModel(alias);

        this._config = createConfig();
        this._config.commonIcon = this._model?.icon ?? 'headphone1';
        this._config.albumArtIcon = this._config.commonIcon;
        this._config.battery1Icon = this._config.commonIcon;
        this._config.battery1ShowOnDisconnect = true;
        this._props = createProperties();

        this.dataHandler = new DataHandler(this._config, this._props);
        this.updateDeviceMapCb(this._devicePath, this.dataHandler);

        try {
            this._battery = new BatteryProxy(Gio.DBus.system, 'org.bluez', devicePath);
            this._batteryId = this._battery.connect('g-properties-changed', () => this._updateBattery());
        } catch (e) {
            this._log.error(e, 'Battery1 proxy');
        }
        this._updateBattery();
    }

    _updateBattery() {
        const level = this._battery?.Percentage;
        if (typeof level !== 'number')
            return;
        this._props.battery1Level = level;
        this._props.battery1Status = 'discharging';
        this._props.computedBatteryLevel = level;
        this.dataHandler?.setProps(this._props);
    }

    destroy() {
        if (this._batteryId)
            this._battery?.disconnect(this._batteryId);
        this._batteryId = null;
        this._battery = null;
        this.dataHandler = null;
    }
});
