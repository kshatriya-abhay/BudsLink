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
// RCSP over SPP (jlabBudsSocket.js): noise control (Off / Noise
// Cancelling / Be Aware) as the generic panel's toggle row, and in its
// options box the current mode's level (slider) and the EQ preset.
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
        this._voiceModes = new Map();  // mode -> last known {mode, max/cur levels}
        this._voiceMode = null;
        this._uiActionId = this.dataHandler.connect('ui-action', (_o, name, value) => this._onUiAction(name, value));
        if (this._model?.eqPresets) {
            this._socket = new JlabBudsSocket(devicePath, profileManager,
                {type: SppUUidType, uuid: SppUUid}, {
                    updateEqList: list => this._updateEqList(list),
                    updateVoiceModes: modes => this._updateVoiceModes(modes),
                    updateVoiceMode: vm => this._updateVoiceMode(vm),
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
        this._refresh();
    }

    _updateEq(eq) {
        this._eqId = eq.id;
        this._refresh();
    }

    // ---- noise control ----

    // Modes offered: the model's list, limited to modes the device reports.
    _noiseOptions() {
        const known = this._model?.noiseModes ?? [];
        return this._voiceModes.size ? known.filter(m => this._voiceModes.has(m.mode)) : [];
    }

    _updateVoiceModes(modes) {
        for (const vm of modes)
            this._voiceModes.set(vm.mode, vm);
        this._refresh();
    }

    _updateVoiceMode(vm) {
        this._voiceMode = vm;
        this._voiceModes.set(vm.mode, vm);
        this._refresh();
    }

    // The current mode's level as 0-100, or null when the mode has none.
    _levelPercent() {
        const vm = this._voiceMode;
        if (!vm || vm.mode === 0 || !vm.leftMax)
            return null;
        return Math.round(vm.leftCur * 100 / vm.leftMax);
    }

    // ---- generic panel: toggle row + options box ----

    _refresh() {
        const noise = this._noiseOptions();
        const eq = this._eqOptions().slice(0, 4);
        const level = this._levelPercent();
        const levelMode = noise.find(m => m.mode === this._voiceMode?.mode);

        // Toggle row 1: noise control.
        this._config.toggle1Title = 'Noise Control';
        for (let b = 1; b <= 4; b++)
            this._config[`toggle1Button${b}Name`] = noise[b - 1]?.label ?? '';
        this._props.toggle1Visible = noise.length >= 2;
        const nIndex = noise.findIndex(m => m.mode === this._voiceMode?.mode);
        this._props.toggle1State = nIndex >= 0 ? nIndex + 1 : 0;

        // Options box 1: the current mode's level, then the EQ preset.
        const box = [];
        if (level !== null && levelMode?.levelTitle) {
            box.push('slider');
            this._config.box1SliderTitle = levelMode.levelTitle;
            this._props.box1SliderValue = level;
        }
        if (eq.length >= 2) {
            box.push('radio-button');
            this._config.box1RadioTitle = 'Equalizer';
            this._config.box1RadioButton = eq.map(o => o.label);
            const eIndex = eq.findIndex(o => o.id === this._eqId);
            this._props.box1RadioButtonState = eIndex >= 0 ? eIndex + 1 : 0;
        }
        this._config.optionsBox1 = box;
        this._props.optionsBoxVisible = box.length ? 1 : 0;

        this.dataHandler?.setConfig(this._config);
        this.dataHandler?.setProps(this._props);
    }

    _onUiAction(name, value) {
        if (!this._socket)
            return;
        if (name === 'box1RadioButtonState') {
            const option = this._eqOptions()[value - 1];
            const gains = option ? this._eqList.presets.get(option.id) : null;
            if (option && gains && option.id !== this._eqId)
                this._socket.setEq(option.id, gains);
        } else if (name === 'toggle1State') {
            // Switch mode, keeping that mode's own stored levels.
            const option = this._noiseOptions()[value - 1];
            const stored = option ? this._voiceModes.get(option.mode) : null;
            if (stored && option.mode !== this._voiceMode?.mode)
                this._socket.setVoiceMode({...stored, mode: option.mode});
        } else if (name === 'box1SliderValue') {
            const vm = this._voiceMode;
            if (!vm || vm.mode === 0 || !vm.leftMax)
                return;
            const pct = Math.max(0, Math.min(100, value));
            const left = Math.round(vm.leftMax * pct / 100);
            const right = Math.round(vm.rightMax * pct / 100);
            if (left !== vm.leftCur)
                this._socket.setVoiceMode({...vm, leftCur: left, rightCur: right});
        }
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
