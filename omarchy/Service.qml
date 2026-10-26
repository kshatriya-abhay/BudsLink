import QtQuick
import Quickshell
import Quickshell.Io
import qs.Commons
import "Model.js" as Model

// Mounted once per shell session. Bar widgets are mounted once per monitor,
// and only one program can hold an earbud's control channel, so the backend
// process and everything it reports live here; every bar reads this object.
QtObject {
  id: root

  property var shell: null
  property var manifest: null

  readonly property string pluginId: "kshatriya-abhay.buds"
  readonly property string backendPath: Qt.resolvedUrl("backend/run").toString().replace(/^file:\/\//, "")

  // ---- what the backend reports ----
  property bool running: false
  property bool demo: false         // backend runs fake devices (see backend/demo.js)

  // ---- demo gallery: the panel shows a grid of devices, a page at a time ----
  property bool gallery: true
  property int galleryPage: 0
  readonly property int galleryPageSize: 6
  readonly property int galleryPages: Math.max(1, Math.ceil(selectable.length / galleryPageSize))
  readonly property var galleryDevices: selectable.slice(
    Math.min(galleryPage, galleryPages - 1) * galleryPageSize,
    Math.min(galleryPage, galleryPages - 1) * galleryPageSize + galleryPageSize)

  // Dev tooling: the open panel renders its whole content (also the part
  // scrolled out of view) to a PNG. The bar widget answers this.
  signal snapshotRequested(string path)

  function setGalleryPage(n) {
    galleryPage = Math.max(0, Math.min(galleryPages - 1, n))
  }
  property var devices: []          // [{path, address, alias, connected, family, ready, model, controls}]
  property var data: ({})           // path -> {config, state, settings, model}
  property var lastError: null      // {code, message, path?}

  // ---- selection ----
  property string manualPath: ""
  property string audioAddress: ""
  readonly property var selectable: Model.selectableDevices(devices)
  readonly property string selectedPath: Model.pickDevice(selectable, manualPath, audioAddress)
  readonly property var selected: deviceFor(selectedPath)
  readonly property var selectedData: data[selectedPath] || ({})

  function deviceFor(path) {
    for (var i = 0; i < devices.length; i++)
      if (devices[i].path === path) return devices[i]
    return null
  }

  function select(path) {
    manualPath = path
  }

  // ---- commands ----
  function send(request) {
    if (backend.running) backend.write(JSON.stringify(request) + "\n")
  }

  function uiAction(path, action, value) {
    send({ cmd: "ui-action", path: path, action: action, value: Number(value) })
  }

  function setSetting(path, key, value) {
    send({ cmd: "set", path: path, key: key, value: value })
  }

  function setControls(path, enabled) {
    send({ cmd: "controls", path: path, enabled: enabled })
  }

  // Next noise mode on the shown device (keybind, right-click on the icon).
  function cycle() {
    var d = selectedData
    var row = Model.toggleRow(d.config, d.state, 1)
    if (row && selected && selected.controls) uiAction(selectedPath, "toggle1State", Model.nextValue(row))
  }

  // Set the noise mode by name: off, transparency, anc, or any button label.
  function setMode(name) {
    var d = selectedData
    var row = Model.toggleRow(d.config, d.state, 1)
    if (!row) return false
    var want = String(name || "").toLowerCase()
    for (var i = 0; i < row.options.length; i++) {
      var label = row.options[i].label.toLowerCase()
      if (label === want || (want === "anc" && label.indexOf("cancel") >= 0)) {
        uiAction(selectedPath, "toggle1State", row.options[i].value)
        return true
      }
    }
    return false
  }

  // ---- backend events ----
  function setData(path, key, value) {
    var next = Object.assign({}, data)
    next[path] = Object.assign({}, next[path] || {})
    next[path][key] = value
    data = next
  }

  function applyLine(line) {
    var text = String(line || "").trim()
    if (text === "") return
    var e
    try {
      e = JSON.parse(text)
    } catch (err) {
      return
    }
    switch (e.t) {
    case "hello":
      running = true
      demo = e.demo === true
      break
    case "devices":
      devices = e.devices || []
      audioCheck.running = true
      break
    case "config":
    case "state":
    case "settings":
    case "model":
      setData(e.path, e.t, e[e.t])
      break
    case "error":
      lastError = { code: e.code, message: e.message }
      console.warn("omarchy-buds: " + e.code + ": " + e.message)
      break
    }
  }

  property Process backend: Process {
    command: [root.backendPath]
    running: true
    stdinEnabled: true
    stdout: SplitParser {
      onRead: function(line) { root.applyLine(line) }
    }
    // A crash (BlueZ restart, stray kill) would otherwise freeze every bar
    // on its last state.
    onExited: {
      root.running = false
      root.devices = []
      root.data = ({})
      restartTimer.restart()
    }
  }

  // Demo mode is a flag file the backend reads at start; switching it
  // restarts the backend.
  readonly property string stateDir: (Quickshell.env("XDG_STATE_HOME") || (Quickshell.env("HOME") + "/.local/state")) + "/omarchy-buds"

  function setDemo(on) {
    demoSwitch.command = on
      ? ["sh", "-c", "mkdir -p \"$1\" && touch \"$1/demo\"", "sh", stateDir]
      : ["rm", "-f", stateDir + "/demo"]
    demoSwitch.running = true
  }

  property Process demoSwitch: Process {
    onExited: {
      root.manualPath = ""
      root.backend.running = false
    }
  }

  property Timer restartTimer: Timer {
    interval: 3000
    repeat: false
    onTriggered: root.backend.running = true
  }

  // Which Bluetooth device is the current audio output, to pick the default.
  property Process audioCheck: Process {
    command: ["wpctl", "inspect", "@DEFAULT_AUDIO_SINK@"]
    stdout: StdioCollector {
      onStreamFinished: root.audioAddress = Model.audioAddressFromWpctl(this.text)
    }
  }

  property Timer audioTimer: Timer {
    interval: 10000
    repeat: true
    running: root.selectable.length > 1
    onTriggered: root.audioCheck.running = true
  }

  // One handler for the whole session, so a keybind works whichever monitor
  // is focused. Opening the popup goes through the shell.
  property IpcHandler ipc: IpcHandler {
    target: root.pluginId

    function cycle(): void { root.cycle() }
    function set(mode: string): string { return root.setMode(mode) ? "ok" : "unknown mode" }
    function select(address: string): string {
      var want = address.toUpperCase()
      for (var i = 0; i < root.selectable.length; i++) {
        if (root.selectable[i].address === want) {
          root.select(root.selectable[i].path)
          return "ok"
        }
      }
      return "not connected"
    }
    function demo(mode: string): string {
      if (mode !== "on" && mode !== "off") return "usage: demo on|off"
      root.setDemo(mode === "on")
      return "demo " + mode + ", restarting backend"
    }
    function gallery(mode: string): string {
      if (mode !== "on" && mode !== "off") return "usage: gallery on|off"
      root.gallery = mode === "on"
      return "gallery " + mode
    }
    function page(n: int): string {
      root.setGalleryPage(n - 1)
      return "page " + (root.galleryPage + 1) + "/" + root.galleryPages
    }
    // Returns the panel background colour: the PNG is transparent behind
    // the content, so flatten it onto this to see it as on screen.
    function snapshot(path: string): string {
      root.snapshotRequested(path)
      return String(Color.popups.background)
    }
    function status(): string {
      return JSON.stringify({ running: root.running, demo: root.demo,
        gallery: { on: root.gallery, page: root.galleryPage + 1, pages: root.galleryPages }, selected: root.selected, data: root.selectedData, devices: root.devices })
    }
    function open(): void { if (root.shell) root.shell.summon(root.pluginId, "{}") }
    function close(): void { if (root.shell) root.shell.hide(root.pluginId) }
    function toggle(): void { if (root.shell) root.shell.toggle(root.pluginId, "{}") }
  }
}
