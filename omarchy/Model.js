.pragma library

// Pure view logic for the Omarchy Buds panel: no QML imports, unit-tested
// with node (omarchy/tests/model.test.js).
//
// `config` and `state` follow upstream's generic contract
// (src/lib/dataHandler.js: createConfig / createProperties).

var BATTERY_SLOTS = [1, 2, 3]

// Devices the dropdown offers: connected and handled by a BudsLink family.
function selectableDevices(devices) {
  var out = []
  for (var i = 0; i < (devices || []).length; i++) {
    var d = devices[i]
    if (d && d.connected && d.family) out.push(d)
  }
  return out
}

// Which device the panel shows: the user's pick while it stays connected,
// else the current audio output, else the first one.
function pickDevice(selectable, manualPath, audioAddress) {
  if (!selectable || selectable.length === 0) return ""
  var i
  if (manualPath) {
    for (i = 0; i < selectable.length; i++)
      if (selectable[i].path === manualPath) return manualPath
  }
  if (audioAddress) {
    var want = String(audioAddress).toUpperCase()
    for (i = 0; i < selectable.length; i++)
      if (String(selectable[i].address).toUpperCase() === want) return selectable[i].path
  }
  return selectable[0].path
}

// `wpctl inspect @DEFAULT_AUDIO_SINK@` -> Bluetooth address, or "".
function audioAddressFromWpctl(text) {
  var m = /api\.bluez5\.address\s*=\s*"([0-9A-Fa-f:]{17})"/.exec(String(text || ""))
  return m ? m[1].toUpperCase() : ""
}

function batteryLabel(icon, slot) {
  var name = String(icon || "")
  if (/-left$/.test(name)) return "L"
  if (/-right$/.test(name)) return "R"
  if (slot === 3 || /case/.test(name)) return "Case"
  return "Battery"
}

// Rows for the battery section. A slot shows when the device declares it
// (an icon) and reports it; a disconnected bud shows only when the config
// asks for it.
function batteryRows(config, state) {
  var rows = []
  if (!config || !state) return rows
  for (var i = 0; i < BATTERY_SLOTS.length; i++) {
    var n = BATTERY_SLOTS[i]
    var icon = config["battery" + n + "Icon"]
    if (!icon) continue
    var status = String(state["battery" + n + "Status"] || "not-reported")
    if (status === "not-reported") continue
    var disconnected = status === "disconnected"
    if (disconnected && !config["battery" + n + "ShowOnDisconnect"]) continue
    rows.push({
      slot: n,
      label: batteryLabel(icon, n),
      level: Number(state["battery" + n + "Level"]) || 0,
      charging: status === "charging",
      disconnected: disconnected
    })
  }
  return rows
}

// The number next to the bar icon: the emptiest bud that is reporting.
function barLevel(config, state) {
  var rows = batteryRows(config, state)
  var best = -1
  for (var i = 0; i < rows.length; i++) {
    if (rows[i].disconnected || rows[i].label === "Case") continue
    if (best < 0 || rows[i].level < best) best = rows[i].level
  }
  if (best < 0 && state && state.computedBatteryLevel > 0) best = Number(state.computedBatteryLevel)
  return best
}

// One of the two toggle rows (noise control, usually). Values are the
// 1-based button index upstream expects in a toggleNState ui-action.
function toggleRow(config, state, n) {
  if (!config || !state || !state["toggle" + n + "Visible"]) return null
  var options = []
  for (var b = 1; b <= 4; b++) {
    var name = config["toggle" + n + "Button" + b + "Name"]
    if (name) options.push({ value: String(b), label: String(name) })
  }
  if (options.length < 2) return null
  return {
    n: n,
    title: String(config["toggle" + n + "Title"] || ""),
    options: options,
    value: String(state["toggle" + n + "State"] || 0)
  }
}

// Label of the active button in a toggle row ("" when none).
function activeLabel(row) {
  if (!row) return ""
  for (var i = 0; i < row.options.length; i++)
    if (row.options[i].value === row.value) return row.options[i].label
  return ""
}

// Next value when cycling a toggle row (keybind, right-click).
function nextValue(row) {
  if (!row || row.options.length === 0) return ""
  for (var i = 0; i < row.options.length; i++)
    if (row.options[i].value === row.value) return row.options[(i + 1) % row.options.length].value
  return row.options[0].value
}

// The options box upstream shows under the toggles, or null. One box can
// hold one of each widget kind: a slider, 1-2 checkboxes and/or 2-4 radio
// buttons (e.g. the ANC level picker plus a wind noise checkbox).
// `order` lists the kinds present in the order the config declares them,
// which is the order upstream draws them in (src/lib/widgets/optionsBox.js).
function optionsBox(config, state) {
  if (!config || !state) return null
  var n = Number(state.optionsBoxVisible) || 0
  if (n < 1 || n > 4) return null
  var kinds = config["optionsBox" + n] || []
  var box = { n: n, radio: null, checks: [], slider: null, order: [] }
  for (var k = 0; k < kinds.length; k++) {
    var kind = String(kinds[k])
    if (kind === "slider") {
      box.order.push(kind)
      box.slider = {
        title: String(config["box" + n + "SliderTitle"] || ""),
        value: Number(state["box" + n + "SliderValue"]) || 0
      }
    } else if (kind === "check-button") {
      box.order.push(kind)
      var titles = config["box" + n + "CheckButton"] || []
      for (var c = 0; c < titles.length && c < 2; c++)
        box.checks.push({ index: c + 1, label: String(titles[c]), checked: Number(state["box" + n + "CheckButton" + (c + 1) + "State"]) === 1 })
    } else if (kind === "radio-button") {
      var names = config["box" + n + "RadioButton"] || []
      var options = []
      for (var r = 0; r < names.length && r < 4; r++)
        options.push({ value: String(r + 1), label: String(names[r]) })
      if (options.length > 0) box.order.push(kind)
      if (options.length > 0)
        box.radio = {
          title: String(config["box" + n + "RadioTitle"] || ""),
          options: options,
          value: String(state["box" + n + "RadioButtonState"] || 0)
        }
    }
  }
  if (!box.radio && !box.slider && box.checks.length === 0) return null
  return box
}

// ---- Realme / Oppo / OnePlus settings (family "opoBuds") ----
// Built from the matched model config (what the hardware has) and the
// device's settings item (current values). Changes go out as a `set` of one
// settings key, which upstream's device code turns into the command.

// Preset names as the realme Link app shows them.
var OPO_EQ_LABELS = {
  originalSound: "Original sound", deepBass: "Deep bass", serenade: "Serenade",
  clearBass: "Clear bass", bass: "Bass"
}

// Switches, in display order: model flag -> settings key. Wind noise lives
// in the generic options box already; High-res (LHDC) is left out on
// purpose (it can silence the control channel, upstream #95); find-phone
// rings the phone and means nothing on a laptop.
var OPO_SWITCHES = [
  { flag: "lowLatencyMode", key: "lowlatency", label: "Game mode" },
  { flag: "spatialAudio", key: "spatial", label: "Spatial audio" },
  { flag: "inEarDetection", key: "inear-enable", label: "In-ear detection" },
  { flag: "autoAnswer", key: "auto-answer", label: "Auto-answer calls" },
  { flag: "dualConnection", key: "dual-connection", label: "Dual connection" },
  { flag: "dynamicBass", key: "dynamic-bass", label: "Dynamic bass" }
]

function words(key) {
  var s = String(key).replace(/([a-z])([A-Z])/g, "$1 $2").toLowerCase()
  return s.charAt(0).toUpperCase() + s.slice(1)
}

// Returns null when there is nothing to show, else
// { eq: {options, value} | null, switches: [{key, label, checked}],
//   bass: {value, min, max} | null }
function opoSettings(family, model, settings) {
  if (family !== "opoBuds" || !model || !settings) return null
  var out = { eq: null, switches: [], bass: null }

  if (model.eqPreset && settings["eq-preset"] !== undefined) {
    var options = []
    for (var key in model.eqPreset)
      options.push({ value: String(model.eqPreset[key]), label: OPO_EQ_LABELS[key] || words(key) })
    // Custom profiles saved on the buds (e.g. "Flat" on the Air 8).
    var customs = settings["custom-eq-list"] || []
    for (var c = 0; c < customs.length; c++)
      if (customs[c] && customs[c].eqId !== undefined)
        options.push({ value: String(customs[c].eqId), label: String(customs[c].name || ("Custom " + customs[c].eqId)) })
    out.eq = { options: options, value: String(settings["eq-preset"]) }
  }

  for (var i = 0; i < OPO_SWITCHES.length; i++) {
    var sw = OPO_SWITCHES[i]
    if (model[sw.flag] && settings[sw.key] !== undefined)
      out.switches.push({ key: sw.key, label: sw.label, checked: settings[sw.key] === true })
  }

  // Bass level (-5..+5) exists only on models using the bass engine
  // commands, and only means something while dynamic bass is on.
  if (model.dynamicBass && model.dynamicBassOpo && settings["bass-level"] !== undefined && settings["dynamic-bass"] === true)
    out.bass = { value: Number(settings["bass-level"]) || 0, min: -5, max: 5 }

  if (!out.eq && out.switches.length === 0 && !out.bass) return null
  return out
}
