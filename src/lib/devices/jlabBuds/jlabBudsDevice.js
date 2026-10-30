'use strict';
import Gio from 'gi://Gio';
import GObject from 'gi://GObject';

import {createLogger, getDeviceIdentifier} from '../logger.js';
import {createConfig, createProperties, DataHandler} from '../../dataHandler.js';
import {SppUUid, SppUUidType} from '../deviceUtils.js';
import {JlabBudsSocket} from './jlabBudsSocket.js';
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

// JLab headphones (Jieli). Battery comes from BlueZ (the headphones report
// it over the hands-free profile); their Fast Pair battery report is
// unreliable (all zeros, three slots), so it isn't used. Controls use Jieli
// RCSP over SPP (jlabBudsSocket.js): so far the EQ preset, shown as the
// generic panel's options box.
export const JlabBudsDevice = GObject.registerClass({
    GTypeName: 'BudsLink_JlabBudsDevice',
}, class JlabBudsDevice extends GObject.Object {
    _init(settings, devicePath, alias, extPath, profileManager, updateDeviceMapCb) {
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

        this._eqList = null;
        this._eqId = null;
        this._uiActionId = this.dataHandler.connect('ui-action', (_o, name, value) => this._onUiAction(name, value));
        if (this._model?.eqPresets) {
            this._socket = new JlabBudsSocket(devicePath, profileManager,
                {type: SppUUidType, uuid: SppUUid}, {
                    updateEqList: list => this._updateEqList(list),
                    updateEq: eq => this._updateEq(eq),
                    authFailed: () => this._log.info('RCSP authentication failed; battery only'),
                });
        }
    }

    // ---- EQ ----

    // Presets offered: the model's list, limited to ids the device stores.
    _eqOptions() {
        const presets = this._model?.eqPresets ?? [];
        return this._eqList ? presets.filter(p => this._eqList.presets.has(p.id)) : [];
    }

    _updateEqList(list) {
        this._eqList = list;
        const options = this._eqOptions().slice(0, 4);
        this._config.optionsBox1 = options.length >= 2 ? ['radio-button'] : [];
        this._config.box1RadioTitle = 'Equalizer';
        this._config.box1RadioButton = options.map(o => o.label);
        this.dataHandler?.setConfig(this._config);
        this._updateEqState();
    }

    _updateEq(eq) {
        this._eqId = eq.id;
        this._updateEqState();
    }

    _updateEqState() {
        const options = this._eqOptions().slice(0, 4);
        const index = options.findIndex(o => o.id === this._eqId);
        this._props.optionsBoxVisible = options.length >= 2 ? 1 : 0;
        this._props.box1RadioButtonState = index >= 0 ? index + 1 : 0;
        this.dataHandler?.setProps(this._props);
    }

    _onUiAction(name, value) {
        if (name !== 'box1RadioButtonState' || !this._socket)
            return;
        const option = this._eqOptions()[value - 1];
        const gains = option ? this._eqList.presets.get(option.id) : null;
        if (option && gains && option.id !== this._eqId)
            this._socket.setEq(option.id, gains);
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
        this._socket?.destroy();
        this._socket = null;
        if (this._uiActionId)
            this.dataHandler?.disconnect(this._uiActionId);
        this._uiActionId = null;
        if (this._batteryId)
            this._battery?.disconnect(this._batteryId);
        this._batteryId = null;
        this._battery = null;
        this.dataHandler = null;
    }
});
