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
  readonly property bool controls: !!device && device.controls !== false

  readonly property var batteryRows: ready ? Model.batteryRows(config, state) : []
  readonly property int level: ready ? Model.barLevel(config, state) : -1
  readonly property var toggle1: ready ? Model.toggleRow(config, state, 1) : null
  readonly property var toggle2: ready ? Model.toggleRow(config, state, 2) : null
  readonly property var box: ready ? Model.optionsBox(config, state) : null

  // ---- settings (this widget's shell.json entry) ----
  readonly property bool showPercent: setting("showPercent", true) !== false
  readonly property bool hideWhenDisconnected: setting("hideWhenDisconnected", true) !== false
  readonly property int lowBattery: Number(setting("lowBattery", 15))

  readonly property bool hidden: hideWhenDisconnected && selectable.length === 0 && !opened
  visible: !hidden
  implicitWidth: hidden ? 0 : button.implicitWidth
  implicitHeight: button.implicitHeight

  readonly property color foreground: bar ? bar.foreground : Color.foreground
  readonly property color urgent: bar ? bar.urgent : Color.urgent
  readonly property color dim: Qt.darker(foreground, 1.55)
  readonly property string fontFamily: bar ? bar.fontFamily : Style.font.family

  function uiAction(action, value) {
    if (service && device) service.uiAction(device.path, action, value)
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
    contentWidth: panel.fittedContentWidth(Style.space(340))
    contentHeight: panel.fittedContentHeight(column.implicitHeight, Style.space(640))

    PanelKeyCatcher {
      id: keyCatcher
      anchors.fill: parent
      onCloseRequested: root.close()
      onTabRequested: function(direction) { root.switchPanel(direction) }
      onTextKey: function(t) {
        if ((t === "m" || t === "M") && root.service) root.service.cycle()
      }

      Column {
        id: column
        anchors.fill: parent
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

        // ---------- Device: dropdown when there is a choice ----------
        Dropdown {
          width: parent.width
          visible: root.selectable.length > 1
          showLabel: false
          options: root.selectable.map(function(d) { return { value: d.path, label: d.alias } })
          value: root.device ? root.device.path : ""
          foreground: root.foreground
          fontFamily: root.fontFamily
          onChanged: function(value) { if (root.service) root.service.select(value) }
        }

        Text {
          width: parent.width
          visible: root.selectable.length === 1
          text: root.device ? root.device.alias : ""
          color: root.foreground
          font.family: root.fontFamily
          font.pixelSize: Style.font.title
          font.bold: true
          elide: Text.ElideRight
        }

        Text {
          width: parent.width
          visible: !!root.device && !!root.device.model
          text: root.device && root.device.model ? root.device.model : ""
          color: root.dim
          font.family: root.fontFamily
          font.pixelSize: Style.font.caption
          elide: Text.ElideRight
        }

        // ---------- Controls switch: off = read-only ----------
        Item {
          width: parent.width
          visible: !!root.device
          height: Math.max(controlsLabel.implicitHeight, controlsSwitch.implicitHeight)

          Column {
            anchors.left: parent.left
            anchors.right: controlsSwitch.left
            anchors.verticalCenter: parent.verticalCenter
            Text {
              id: controlsLabel
              text: "Controls"
              color: root.foreground
              font.family: root.fontFamily
              font.pixelSize: Style.font.body
            }
            Text {
              visible: !root.controls
              text: "Read-only: nothing is sent to these earbuds"
              color: root.dim
              font.family: root.fontFamily
              font.pixelSize: Style.font.caption
            }
          }

          ToggleSwitch {
            id: controlsSwitch
            anchors.right: parent.right
            anchors.verticalCenter: parent.verticalCenter
            checked: root.controls
            foreground: root.foreground
            onToggled: if (root.service && root.device) root.service.setControls(root.device.path, !root.controls)
          }
        }

        // ---------- Battery ----------
        Column {
          width: parent.width
          spacing: Style.space(6)
          visible: root.batteryRows.length > 0

          Repeater {
            model: root.batteryRows

            Item {
              required property var modelData
              width: column.width
              height: Style.space(16)
              opacity: modelData.disconnected ? 0.5 : 1.0

              Text {
                id: cellLabel
                text: modelData.label
                color: root.dim
                font.family: root.fontFamily
                font.pixelSize: Style.font.caption
                width: Style.space(40)
                anchors.left: parent.left
                anchors.verticalCenter: parent.verticalCenter
              }

              Rectangle {
                anchors.left: cellLabel.right
                anchors.right: cellValue.left
                anchors.rightMargin: Style.space(8)
                anchors.verticalCenter: parent.verticalCenter
                height: Style.space(6)
                radius: height / 2
                color: Qt.rgba(root.foreground.r, root.foreground.g, root.foreground.b, 0.15)

                Rectangle {
                  width: Math.max(parent.height, parent.width * Math.max(0, Math.min(100, modelData.level)) / 100)
                  height: parent.height
                  radius: parent.radius
                  color: modelData.level <= root.lowBattery ? root.urgent : root.foreground
                  Behavior on width { NumberAnimation { duration: 160 } }
                }
              }

              Text {
                id: cellValue
                text: modelData.disconnected ? "–" : (modelData.charging ? "󰂄 " : "") + modelData.level + "%"
                color: root.foreground
                font.family: root.fontFamily
                font.pixelSize: Style.font.caption
                horizontalAlignment: Text.AlignRight
                width: Style.space(52)
                anchors.right: parent.right
                anchors.verticalCenter: parent.verticalCenter
              }
            }
          }
        }

        // ---------- Toggle rows (noise control, …) ----------
        Repeater {
          model: [root.toggle1, root.toggle2].filter(function(r) { return !!r })

          Column {
            required property var modelData
            width: column.width
            spacing: Style.space(8)
            enabled: root.controls
            opacity: enabled ? 1.0 : 0.5

            PanelSeparator { width: parent.width; foreground: root.foreground }
            PanelSectionHeader {
              width: parent.width
              text: modelData.title
              foreground: root.foreground
              fontFamily: root.fontFamily
            }
            ChoiceGroup {
              width: parent.width
              options: modelData.options
              value: modelData.value
              foreground: root.foreground
              fontFamily: root.fontFamily
              onChanged: function(value) { root.uiAction("toggle" + modelData.n + "State", Number(value)) }
            }
          }
        }

        // ---------- The one options box upstream shows ----------
        // Widgets are drawn in the order the config declares them, as
        // upstream does (e.g. Sony: Auto Ambient switch above its
        // sensitivity picker).
        Column {
          width: parent.width
          spacing: Style.space(8)
          visible: !!root.box
          enabled: root.controls
          opacity: enabled ? 1.0 : 0.5

          Repeater {
            model: root.box ? root.box.order : []

            Column {
              id: boxPart
              required property string modelData
              width: column.width
              spacing: Style.space(8)

              // radio-button: optional title + choice chips
              PanelSectionHeader {
                width: parent.width
                visible: boxPart.modelData === "radio-button" && !!root.box.radio && root.box.radio.title !== ""
                text: root.box && root.box.radio ? root.box.radio.title : ""
                foreground: root.foreground
                fontFamily: root.fontFamily
              }
              ChoiceGroup {
                width: parent.width
                visible: boxPart.modelData === "radio-button"
                options: root.box && root.box.radio ? root.box.radio.options : []
                value: root.box && root.box.radio ? root.box.radio.value : ""
                foreground: root.foreground
                fontFamily: root.fontFamily
                onChanged: function(value) { root.uiAction("box" + root.box.n + "RadioButtonState", Number(value)) }
              }

              // check-button: one switch row per checkbox
              Repeater {
                model: boxPart.modelData === "check-button" && root.box ? root.box.checks : []

                Item {
                  required property var modelData
                  width: column.width
                  height: Math.max(checkLabel.implicitHeight, checkSwitch.implicitHeight)
                  Text {
                    id: checkLabel
                    text: modelData.label
                    color: root.foreground
                    font.family: root.fontFamily
                    font.pixelSize: Style.font.body
                    anchors.left: parent.left
                    anchors.verticalCenter: parent.verticalCenter
                  }
                  ToggleSwitch {
                    id: checkSwitch
                    anchors.right: parent.right
                    anchors.verticalCenter: parent.verticalCenter
                    checked: modelData.checked
                    foreground: root.foreground
                    onToggled: root.uiAction("box" + root.box.n + "CheckButton" + modelData.index + "State", modelData.checked ? 0 : 1)
                  }
                }
              }

              // slider: optional title + slider
              PanelSectionHeader {
                width: parent.width
                visible: boxPart.modelData === "slider" && !!root.box.slider && root.box.slider.title !== ""
                text: root.box && root.box.slider ? root.box.slider.title : ""
                foreground: root.foreground
                fontFamily: root.fontFamily
              }
              PanelSlider {
                width: parent.width
                visible: boxPart.modelData === "slider"
                bar: root.bar
                minimum: 0
                maximum: 100
                step: 1
                integer: true
                value: root.box && root.box.slider ? root.box.slider.value : 0
                onReleased: function(value) { root.uiAction("box" + root.box.n + "SliderValue", Math.round(value)) }
              }
            }
          }
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
          visible: !!root.device && !root.ready
          text: "Waiting for the earbuds… If this stays, this model isn't supported yet."
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
