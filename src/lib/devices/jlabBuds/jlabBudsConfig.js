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
    },
];

export function findJlabModel(name) {
    return JlabBudsModelList.find(m => m.pattern.test(name ?? '')) ?? null;
}
