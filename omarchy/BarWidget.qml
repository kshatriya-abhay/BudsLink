import QtQuick
import QtQuick.Controls
import Quickshell
import qs.Commons
import qs.Ui
import "Model.js" as Model
import "components"

// Bar icon + popup. Mounted once per monitor; all state lives in Service.qml.
Panel {
  id: root
  moduleName: "kshatriya-abhay.buds"
  ipcTarget: "kshatriya-abhay.buds"
  manageIpc: false

  readonly property var service: bar && bar.shell ? bar.shell.serviceFor(moduleName) : null
  readonly property bool running: !!service && service.running
  readonly property var selectable: service ? service.selectable : []
  readonly property var device: service ? service.selected : null
  readonly property var info: service ? service.selectedData : ({})
  readonly property var config: info.config || null
  readonly property var state: info.state || null
  readonly property bool ready: !!device && device.ready && !!config && !!state

  readonly property int level: ready ? Model.barLevel(config, state) : -1
  readonly property var toggle1: ready ? Model.toggleRow(config, state, 1) : null

  // Demo gallery: a 3x2 grid of devices, a page at a time.
  readonly property bool galleryMode: !!service && service.demo && service.gallery
  readonly property int galleryColumns: 3
  readonly property real tileGap: Style.space(24)
  // Tiles share the width the panel actually gets (it can be narrower than
  // asked for on small screens).
  readonly property real tileWidth: Math.floor((column.width - tileGap * (galleryColumns - 1)) / galleryColumns)

  // ---- settings (this widget's shell.json entry) ----
  readonly property bool showPercent: setting("showPercent", true) !== false
  readonly property bool hideWhenDisconnected: setting("hideWhenDisconnected", true) !== false
  readonly property int lowBattery: Number(setting("lowBattery", 15))
  // Feature switches the user doesn't want offered, for every device.
  // An empty selection shows them all.
  readonly property var hiddenFeatures: {
    var v = setting("hiddenFeatures", ["auto-answer", "dual-connection"])
    return Array.isArray(v) ? v : []
  }

  readonly property bool hidden: hideWhenDisconnected && selectable.length === 0 && !opened
  visible: !hidden
  implicitWidth: hidden ? 0 : button.implicitWidth
  implicitHeight: button.implicitHeight

  readonly property color foreground: bar ? bar.foreground : Color.foreground
  readonly property color urgent: bar ? bar.urgent : Color.urgent
  readonly property color dim: Qt.darker(foreground, 1.55)
  readonly property string fontFamily: bar ? bar.fontFamily : Style.font.family

  // Dev tooling (IPC `snapshot <file>`): render the open panel's whole
  // content to a PNG, including what is scrolled out of view.
  Connections {
    target: root.service
    function onSnapshotRequested(path) {
      if (root.opened) column.grabToImage(function(result) { result.saveToFile(path) })
    }
  }

  // ---- keyboard navigation (single view) ----
  // One cursor over the device dropdown (when there is a choice) followed
  // by the device view's rows. up/down move it, left/right walk chips or
  // nudge a slider, Enter/space activates.
  readonly property bool hasDropdown: !galleryMode && selectable.length > 1
  readonly property int rowOffset: hasDropdown ? 1 : 0
  readonly property int navCount: rowOffset + singleView.focusRows.length
  property int navIndex: 0

  function navTo(i) {
    navIndex = Math.max(0, Math.min(navCount - 1, i))
    singleView.focusRow(navIndex - rowOffset)
  }

  // Start on the noise control row when there is one, else the first row.
  function navToDefault() {
    var rows = singleView.focusRows
    for (var i = 0; i < rows.length; i++)
      if (rows[i].type === "choice") { navTo(i + rowOffset); return }
    navTo(0)
  }

  onOpenedChanged: if (opened) navToDefault()
  onGalleryModeChanged: if (opened && !galleryMode) navToDefault()
  // Rows come and go (device switched, mode changed): keep the cursor in range.
  onNavCountChanged: if (opened && !galleryMode) navTo(navIndex)

  function turnPage(delta) {
    if (service && galleryMode) service.setGalleryPage(service.galleryPage + delta)
  }

  WidgetButton {
    id: button
    anchors.fill: parent
    bar: root.bar
    text: {
      var glyph = root.device ? "󰋋" : "󰟎"
      return root.showPercent && root.level >= 0 ? glyph + " " + root.level + "%" : glyph
    }
    dimmed: !root.device
    active: root.level >= 0 && root.level <= root.lowBattery
    fixedWidth: root.bar && root.bar.vertical ? Style.bar.statusSlot : -1
    tooltipText: root.device
      ? root.device.alias + (root.toggle1 ? " · " + Model.activeLabel(root.toggle1) : "")
      : "No earbuds connected"
    onPressed: function(b) {
      if (b === Qt.RightButton || b === Qt.MiddleButton) { if (root.service) root.service.cycle() }
      else root.toggle()
    }
  }

  KeyboardPanel {
    id: panel
    anchorItem: button
    owner: root
    bar: root.bar
    open: root.opened
    focusTarget: keyCatcher
    contentWidth: panel.fittedContentWidth(root.galleryMode
      ? Style.space(320) * root.galleryColumns + root.tileGap * (root.galleryColumns - 1)
      : Style.space(340))
    contentHeight: panel.fittedContentHeight(column.implicitHeight, Style.space(root.galleryMode ? 1400 : 640))

    PanelKeyCatcher {
      id: keyCatcher
      anchors.fill: parent
      onCloseRequested: root.close()
      onTabRequested: function(direction) { root.switchPanel(direction) }
      onMoveRequested: function(dx, dy) {
        if (root.galleryMode) {
          if (dx !== 0) root.turnPage(dx)
          else if (dy !== 0) flick.contentY = Math.max(0, Math.min(flick.contentHeight - flick.height, flick.contentY + dy * Style.space(60)))
          return
        }
        if (dy !== 0) root.navTo(root.navIndex + dy)
        else if (dx !== 0 && root.navIndex >= root.rowOffset) singleView.moveSideways(dx)
      }
      onActivateRequested: {
        if (root.galleryMode) return
        if (root.hasDropdown && root.navIndex === 0) deviceDropdown.open()
        else singleView.activate()
      }
      onTextKey: function(t) {
        if ((t === "m" || t === "M") && root.service && !root.galleryMode) root.service.cycle()
      }

      // Scrolls when the content is taller than the screen allows.
      Flickable {
        id: flick
        anchors.fill: parent
        contentWidth: width
        contentHeight: column.implicitHeight
        clip: true
        boundsBehavior: Flickable.StopAtBounds
        ScrollBar.vertical: ScrollBar { policy: flick.contentHeight > flick.height ? ScrollBar.AsNeeded : ScrollBar.AlwaysOff }

        Column {
          id: column
          width: flick.width
          spacing: Style.space(12)

          Text {
            width: parent.width
            visible: !!root.service && root.service.demo
            text: "Demo mode: every model BudsLink knows, with fake data. Nothing is sent to any device. Turn off with: omarchy-shell kshatriya-abhay.buds demo off"
            color: root.urgent
            font.family: root.fontFamily
            font.pixelSize: Style.font.caption
            wrapMode: Text.WordWrap
          }

          // ---------- Demo gallery ----------
          Item {
            width: parent.width
            visible: root.galleryMode
            height: pager.implicitHeight

            Row {
              id: pager
              spacing: Style.space(8)
              anchors.left: parent.left

              Button {
                text: "◀"
                bordered: true
                foreground: root.foreground
                fontFamily: root.fontFamily
                enabled: !!root.service && root.service.galleryPage > 0
                onClicked: root.turnPage(-1)
              }
              Button {
                text: "▶"
                bordered: true
                foreground: root.foreground
                fontFamily: root.fontFamily
                enabled: !!root.service && root.service.galleryPage < root.service.galleryPages - 1
                onClicked: root.turnPage(1)
              }
              Text {
                anchors.verticalCenter: parent.verticalCenter
                text: root.service
                  ? "Page " + (root.service.galleryPage + 1) + " of " + root.service.galleryPages
                    + "  ·  ←/→ to turn  ·  " + root.selectable.length + " models"
                  : ""
                color: root.dim
                font.family: root.fontFamily
                font.pixelSize: Style.font.caption
              }
            }

            Button {
              anchors.right: parent.right
              text: "Single view"
              bordered: true
              foreground: root.foreground
              fontFamily: root.fontFamily
              onClicked: if (root.service) root.service.gallery = false
            }
          }

          Grid {
            visible: root.galleryMode
            columns: root.galleryColumns
            columnSpacing: root.tileGap
            rowSpacing: root.tileGap

            Repeater {
              model: root.galleryMode && root.service ? root.service.galleryDevices : []

              Rectangle {
                required property var modelData
                width: root.tileWidth
                height: tile.implicitHeight + Style.space(24)
                color: "transparent"
                radius: Style.space(6)
                border.width: 1
                border.color: Qt.rgba(root.foreground.r, root.foreground.g, root.foreground.b, 0.2)

                DeviceView {
                  id: tile
                  x: Style.space(12)
                  y: Style.space(12)
                  width: parent.width - Style.space(24)
                  service: root.service
                  device: modelData
                  info: root.service && root.service.data[modelData.path] ? root.service.data[modelData.path] : ({})
                  bar: root.bar
                  lowBattery: root.lowBattery
                  hiddenFeatures: root.hiddenFeatures
                  foreground: root.foreground
                  urgent: root.urgent
                  dim: root.dim
                  fontFamily: root.fontFamily
                }
              }
            }
          }

          // ---------- Single device: dropdown when there is a choice ----------
          Button {
            visible: !!root.service && root.service.demo && !root.galleryMode
            text: "Gallery view"
            bordered: true
            foreground: root.foreground
            fontFamily: root.fontFamily
            onClicked: if (root.service) root.service.gallery = true
          }

          Dropdown {
            id: deviceDropdown
            width: parent.width
            visible: root.hasDropdown
            hasCursor: root.hasDropdown && root.navIndex === 0
            showLabel: false
            options: root.selectable.map(function(d) { return { value: d.path, label: d.alias } })
            value: root.device ? root.device.path : ""
            foreground: root.foreground
            fontFamily: root.fontFamily
            onChanged: function(value) { if (root.service) root.service.select(value) }
          }

          DeviceView {
            id: singleView
            width: parent.width
            visible: !root.galleryMode
            showTitle: root.selectable.length === 1
            service: root.service
            device: root.device
            info: root.info
            bar: root.bar
            lowBattery: root.lowBattery
            hiddenFeatures: root.hiddenFeatures
            foreground: root.foreground
            urgent: root.urgent
            dim: root.dim
            fontFamily: root.fontFamily
          }

          // ---------- Empty and error states ----------
          Text {
            width: parent.width
            visible: !root.running
            text: "The Omarchy Buds backend is not running. It needs /usr/bin/gjs (package gjs)."
            color: root.dim
            font.family: root.fontFamily
            font.pixelSize: Style.font.body
            wrapMode: Text.WordWrap
          }

          Text {
            width: parent.width
            visible: root.running && root.selectable.length === 0
            text: "No supported earbuds connected."
            color: root.dim
            font.family: root.fontFamily
            font.pixelSize: Style.font.body
            wrapMode: Text.WordWrap
          }

          Text {
            width: parent.width
            visible: !!root.service && !!root.service.lastError && root.service.lastError.code === "profile-conflict"
            text: "Another app (for example the BudsLink Flatpak) is using this earbud's control channel. Close it, then restart the shell."
            color: root.urgent
            font.family: root.fontFamily
            font.pixelSize: Style.font.body
            wrapMode: Text.WordWrap
          }
        }
      }
    }
  }
}
