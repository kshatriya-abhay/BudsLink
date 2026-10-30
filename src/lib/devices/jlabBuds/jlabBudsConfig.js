'use strict';

export const DeviceTypeJlabBuds = 'jlabBuds';

// Bluetooth SIG company id of Zhuhai Jieli Technology, as BlueZ shows it in
// the device's modalias ("bluetooth:v05D6p...").
export const JieliVendorId = '05D6';

// JLab uses several chip vendors; this family covers the Jieli-based models.
// `pattern` is matched against the Bluetooth name.
export const JlabBudsModelList = [
    {
        name: 'JLab JBuds Lux ANC',
        pattern: /^JLab JBuds Lux ANC/i,
        batteryType: 1,
        icon: 'headphone1',
        // Noise modes, as the JLab app names them.
        noiseModes: [
            {mode: 0, label: 'Off'},
            {mode: 1, label: 'Noise Cancelling', levelTitle: 'Noise cancelling level'},
            {mode: 2, label: 'Be Aware', levelTitle: 'Be Aware level'},
        ],
        // The presets the JLab app offers (the device stores more, 0..6).
        eqPresets: [
            {id: 0x00, label: 'EQ 1'},
            {id: 0x01, label: 'EQ 2'},
            {id: 0x02, label: 'EQ 3'},
            {id: 0x06, label: 'Custom'},
        ],
    },
];

export function findJlabModel(name) {
    return JlabBudsModelList.find(m => m.pattern.test(name ?? '')) ?? null;
}
