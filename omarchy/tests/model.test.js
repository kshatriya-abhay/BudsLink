// Tests for omarchy/Model.js.   node omarchy/tests/model.test.js
// Model.js is a QML JavaScript library, so it is loaded without its
// `.pragma library` line into a plain context.
const fs = require('fs')
const path = require('path')
const vm = require('vm')
const assert = require('assert/strict')

const source = fs.readFileSync(path.join(__dirname, '..', 'Model.js'), 'utf8').replace(/^\.pragma library\s*$/m, '')
const M = {}
vm.runInNewContext(source, M)

// Arrays made inside the VM context have their own prototype; compare as JSON.
const plain = x => JSON.parse(JSON.stringify(x))

let failed = 0
function test(name, fn) {
  try { fn(); console.log('ok   ' + name) } catch (e) { failed++; console.log('FAIL ' + name + '\n     ' + e.message) }
}

const air8 = { path: '/p/air8', address: '60:55:56:C4:1D:5E', connected: true, family: 'opoBuds' }
const w5 = { path: '/p/w5', address: '84:9D:4B:3E:3B:5C', connected: true, family: 'opoBuds' }
const speaker = { path: '/p/spk', address: '24:CF:24:10:1B:42', connected: true, family: null }
const jlab = { path: '/p/jlab', address: '90:DA:07:9F:94:DE', connected: false, family: 'gfps' }

test('selectable = connected and supported', () => {
  assert.deepEqual(plain(M.selectableDevices([air8, speaker, jlab, w5]).map(d => d.path)), ['/p/air8', '/p/w5'])
})

test('pick: manual choice wins while connected', () => {
  assert.equal(M.pickDevice([air8, w5], '/p/w5', '60:55:56:C4:1D:5E'), '/p/w5')
})
test('pick: audio output when no manual choice', () => {
  assert.equal(M.pickDevice([air8, w5], '', '84:9d:4b:3e:3b:5c'), '/p/w5')
})
test('pick: stale manual choice falls back', () => {
  assert.equal(M.pickDevice([air8], '/p/w5', ''), '/p/air8')
})
test('pick: nothing selectable', () => {
  assert.equal(M.pickDevice([], '/p/w5', ''), '')
})

test('wpctl address parse', () => {
  const text = '  * api.bluez5.address = "60:55:56:c4:1d:5e"\n  * api.bluez5.codec = "aac"'
  assert.equal(M.audioAddressFromWpctl(text), '60:55:56:C4:1D:5E')
  assert.equal(M.audioAddressFromWpctl('alsa sink'), '')
})

const config = {
  battery1Icon: 'earbuds-stem-left', battery2Icon: 'earbuds-stem-right', battery3Icon: 'case-normal',
  battery1ShowOnDisconnect: true, battery2ShowOnDisconnect: true, battery3ShowOnDisconnect: false,
  toggle1Title: 'Noise Control', toggle1Button1Name: 'Off', toggle1Button2Name: 'Transparency',
  toggle1Button3Name: 'Noise Cancellation', toggle1Button4Name: '',
  optionsBox1: ['radio-button', 'check-button'], box1CheckButton: ['Wind Noise Reduction'], box1RadioTitle: 'Noise Cancellation Level',
  box1RadioButton: ['Smart', 'Max', 'Moderate', 'Mild'],
  optionsBox2: ['check-button'], box2CheckButton: ['Wind Noise Reduction', 'Enhance voices'],
}
const state = {
  battery1Level: 90, battery1Status: 'discharging', battery2Level: 85, battery2Status: 'charging',
  battery3Level: 60, battery3Status: 'disconnected', computedBatteryLevel: 85,
  toggle1Visible: true, toggle1State: 3, optionsBoxVisible: 1, box1RadioButtonState: 4,
  box2CheckButton1State: 1, box2CheckButton2State: 0,
}

test('battery rows: labels, charging, hidden disconnected case', () => {
  assert.deepEqual(plain(M.batteryRows(config, state).map(r => [r.label, r.level, r.charging])),
    [['L', 90, false], ['R', 85, true]])
})
test('battery rows: not-reported slots hidden', () => {
  assert.equal(M.batteryRows(config, { ...state, battery2Status: 'not-reported' }).length, 1)
})
test('bar level = emptiest bud', () => {
  assert.equal(M.barLevel(config, state), 85)
})
test('bar level falls back to computed level', () => {
  assert.equal(M.barLevel({ battery1Icon: 'x' }, { battery1Status: 'not-reported', computedBatteryLevel: 40 }), 40)
})

test('toggle row: buttons, value and label', () => {
  const row = M.toggleRow(config, state, 1)
  assert.deepEqual(plain(row.options.map(o => o.label)), ['Off', 'Transparency', 'Noise Cancellation'])
  assert.equal(row.value, '3')
  assert.equal(M.activeLabel(row), 'Noise Cancellation')
  assert.equal(M.nextValue(row), '1')
})
test('toggle row hidden when not visible', () => {
  assert.equal(M.toggleRow(config, state, 2), null)
})

test('options box: radio and checkbox together (ANC level + wind noise)', () => {
  const box = M.optionsBox(config, { ...state, box1CheckButton1State: 1 })
  assert.equal(box.radio.title, 'Noise Cancellation Level')
  assert.equal(box.radio.options.length, 4)
  assert.equal(box.radio.value, '4')
  assert.deepEqual(plain(box.checks.map(c => [c.label, c.checked])), [['Wind Noise Reduction', true]])
})
test('options box: keeps the declared widget order', () => {
  const sony = { optionsBox2: ['check-button', 'radio-button'], box2CheckButton: ['Auto Ambient'],
    box2RadioTitle: 'Auto Ambient Sensitivity', box2RadioButton: ['Standard', 'High', 'Low'] }
  assert.deepEqual(plain(M.optionsBox(sony, { optionsBoxVisible: 2 }).order), ['check-button', 'radio-button'])
  assert.deepEqual(plain(M.optionsBox(config, state).order), ['radio-button', 'check-button'])
})
test('options box: checks only', () => {
  const box = M.optionsBox(config, { ...state, optionsBoxVisible: 2 })
  assert.equal(box.radio, null)
  assert.deepEqual(plain(box.checks.map(c => [c.index, c.checked])), [[1, true], [2, false]])
})
test('options box: slider', () => {
  const box = M.optionsBox({ optionsBox3: ['slider'], box3SliderTitle: 'Level' }, { optionsBoxVisible: 3, box3SliderValue: 40 })
  assert.equal(box.slider.title, 'Level')
  assert.equal(box.slider.value, 40)
})
test('options box: none', () => {
  assert.equal(M.optionsBox(config, { ...state, optionsBoxVisible: 0 }), null)
})

// ---- Realme settings ----
const air8Model = { eqPreset: { originalSound: 0, deepBass: 1, serenade: 2, clearBass: 3 },
  lowLatencyMode: true, spatialAudio: true, inEarDetection: true, dualConnection: true,
  autoAnswer: true, windNoiseReduction: true, highResAudio: true, findMyPhone: true }
const air8Settings = { 'eq-preset': 4, 'custom-eq-list': [{ eqId: 4, name: 'Flat' }], lowlatency: false,
  spatial: true, 'inear-enable': true, 'dual-connection': true, 'auto-answer': false,
  'wind-noise': true, 'high-res': false, 'find-phone': false }
test('realme settings: presets with app names plus custom EQ', () => {
  const r = M.opoSettings('opoBuds', air8Model, air8Settings)
  assert.deepEqual(plain(r.eq.options.map(o => o.label)), ['Original sound', 'Deep bass', 'Serenade', 'Clear bass', 'Flat'])
  assert.equal(r.eq.value, '4')
})
test('realme settings: switches in order, no wind/high-res/find-phone', () => {
  const r = M.opoSettings('opoBuds', air8Model, air8Settings)
  assert.deepEqual(plain(r.switches.map(s => [s.key, s.checked])),
    [['lowlatency', false], ['spatial', true], ['inear-enable', true], ['auto-answer', false], ['dual-connection', true]])
  assert.equal(r.bass, null)
})
test('realme settings: bass level only for bass-engine models with dynamic bass on', () => {
  const w3 = { eqPreset: { originalSound: 0 }, dynamicBass: true, dynamicBassOpo: true, lowLatencyMode: true }
  const on = M.opoSettings('opoBuds', w3, { 'eq-preset': 0, 'dynamic-bass': true, 'bass-level': -3, lowlatency: false })
  assert.deepEqual(plain(on.bass), { value: -3, min: -5, max: 5 })
  const off = M.opoSettings('opoBuds', w3, { 'eq-preset': 0, 'dynamic-bass': false, 'bass-level': -3 })
  assert.equal(off.bass, null)
  assert.equal(M.opoSettings('opoBuds', { dynamicBass: true }, { 'dynamic-bass': true, 'bass-level': 2 }).bass, null)
})
test('realme settings: hidden features are left out', () => {
  const r = M.opoSettings('opoBuds', air8Model, air8Settings, ['auto-answer', 'dual-connection'])
  assert.deepEqual(plain(r.switches.map(s => s.key)), ['lowlatency', 'spatial', 'inear-enable'])
})
test('realme settings: hiding dynamic bass also hides the bass level', () => {
  const w3 = { dynamicBass: true, dynamicBassOpo: true, lowLatencyMode: true }
  const r = M.opoSettings('opoBuds', w3, { 'dynamic-bass': true, 'bass-level': 1, lowlatency: true }, ['dynamic-bass'])
  assert.deepEqual(plain(r.switches.map(s => s.key)), ['lowlatency'])
  assert.equal(r.bass, null)
})
test('realme settings: keys missing from settings are not offered', () => {
  const r = M.opoSettings('opoBuds', air8Model, { 'eq-preset': 0 })
  assert.equal(r.switches.length, 0)
})
test('realme settings: other families get nothing', () => {
  assert.equal(M.opoSettings('gfps', air8Model, air8Settings), null)
})

if (failed) { console.log(`\n${failed} failed`); process.exit(1) }
console.log('\nall passed')
