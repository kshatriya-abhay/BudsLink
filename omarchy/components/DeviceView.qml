import QtQuick
import qs.Commons
import qs.Ui
import "../Model.js" as Model

// Everything the panel shows for one device: title, Controls switch,
// battery, toggle rows and the options box. Used by the panel for the
// selected device and by the demo gallery for each tile.
Column {
  id: view

  property var service: null
  property var device: null
  property var info: ({})            // {config, state, settings, model}
  property QtObject bar: null
  property bool showTitle: true
  property int lowBattery: 15
  property color foreground: Color.foreground
  property color urgent: Color.urgent
  property color dim: Qt.darker(foreground, 1.55)
  property string fontFamily: Style.font.family

  readonly property var config: info && info.config ? info.config : null
  readonly property var state: info && info.state ? info.state : null
  readonly property bool ready: !!device && device.ready && !!config && !!state
  readonly property bool controls: !!device && device.controls !== false

  readonly property var batteryRows: ready ? Model.batteryRows(config, state) : []
  readonly property var toggleRows: ready
    ? [Model.toggleRow(config, state, 1), Model.toggleRow(config, state, 2)].filter(function(r) { return !!r })
    : []
  readonly property var box: ready ? Model.optionsBox(config, state) : null

  function uiAction(action, value) {
    if (service && device) service.uiAction(device.path, action, value)
  }

  spacing: Style.space(12)

  // ---------- Title ----------
  Text {
    width: parent.width
    visible: view.showTitle && !!view.device
    text: view.device ? view.device.alias : ""
    color: view.foreground
    font.family: view.fontFamily
    font.pixelSize: Style.font.title
    font.bold: true
    // Long names ("QuietComfort Ultra Headphones (2nd Gen)") wrap to a
    // second line instead of being cut off.
    wrapMode: Text.Wrap
    maximumLineCount: 2
    elide: Text.ElideRight
  }

  Text {
    width: parent.width
    visible: !!view.device && !!view.device.model
    text: view.device && view.device.model ? view.device.model : ""
    color: view.dim
    font.family: view.fontFamily
    font.pixelSize: Style.font.caption
    elide: Text.ElideRight
  }

  // ---------- Controls switch: off = read-only ----------
  Item {
    width: parent.width
    visible: !!view.device
    height: Math.max(controlsText.implicitHeight, controlsSwitch.implicitHeight)

    Column {
      id: controlsText
      anchors.left: parent.left
      anchors.right: controlsSwitch.left
      anchors.verticalCenter: parent.verticalCenter
      Text {
        text: "Controls"
        color: view.foreground
        font.family: view.fontFamily
        font.pixelSize: Style.font.body
      }
      Text {
        visible: !view.controls
        width: parent.width
        text: "Read-only: nothing is sent to these earbuds"
        color: view.dim
        font.family: view.fontFamily
        font.pixelSize: Style.font.caption
        wrapMode: Text.WordWrap
      }
    }

    ToggleSwitch {
      id: controlsSwitch
      anchors.right: parent.right
      anchors.verticalCenter: parent.verticalCenter
      checked: view.controls
      foreground: view.foreground
      onToggled: if (view.service && view.device) view.service.setControls(view.device.path, !view.controls)
    }
  }

  // ---------- Battery ----------
  Column {
    id: batteryColumn
    width: parent.width
    spacing: Style.space(6)
    visible: view.batteryRows.length > 0

    FontMetrics {
      id: batteryFont
      font.family: view.fontFamily
      font.pixelSize: Style.font.caption
    }

    // As wide as the widest label shown ("L", "Case", "Battery"), so the
    // bar never starts on top of the text, and at least as wide as "Case",
    // so bars line up whether or not a device reports its case.
    readonly property real labelWidth: {
      var w = batteryFont.advanceWidth("Case")
      for (var i = 0; i < view.batteryRows.length; i++)
        w = Math.max(w, batteryFont.advanceWidth(view.batteryRows[i].label))
      return Math.ceil(w) + Style.space(10)
    }

    Repeater {
      model: view.batteryRows

      Item {
        required property var modelData
        width: batteryColumn.width
        height: Math.max(cellLabel.implicitHeight, cellValue.implicitHeight)
        opacity: modelData.disconnected ? 0.5 : 1.0

        Text {
          id: cellLabel
          text: modelData.label
          color: view.dim
          font.family: view.fontFamily
          font.pixelSize: Style.font.caption
          width: batteryColumn.labelWidth
          anchors.left: parent.left
          anchors.verticalCenter: parent.verticalCenter
        }

        Rectangle {
          anchors.left: cellLabel.right
          anchors.right: cellValue.left
          anchors.rightMargin: Style.space(8)
          height: Style.space(6)
          // Centre on the letters (half the cap height above the baseline),
          // not on the text box, which also holds room for descenders.
          y: Math.round(cellLabel.y + cellLabel.baselineOffset - batteryFont.capitalHeight / 2 - height / 2)
          radius: height / 2
          color: Qt.rgba(view.foreground.r, view.foreground.g, view.foreground.b, 0.15)

          Rectangle {
            width: Math.max(parent.height, parent.width * Math.max(0, Math.min(100, modelData.level)) / 100)
            height: parent.height
            radius: parent.radius
            color: modelData.level <= view.lowBattery ? view.urgent : view.foreground
            Behavior on width { NumberAnimation { duration: 160 } }
          }
        }

        Text {
          id: cellValue
          text: modelData.disconnected ? "–" : (modelData.charging ? "󰂄 " : "") + modelData.level + "%"
          color: view.foreground
          font.family: view.fontFamily
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
    model: view.toggleRows

    Column {
      required property var modelData
      width: view.width
      spacing: Style.space(8)
      enabled: view.controls
      opacity: enabled ? 1.0 : 0.5

      PanelSeparator { width: parent.width; foreground: view.foreground }
      PanelSectionHeader {
        width: parent.width
        text: modelData.title
        foreground: view.foreground
        fontFamily: view.fontFamily
      }
      ChoiceGroup {
        width: parent.width
        options: modelData.options
        value: modelData.value
        foreground: view.foreground
        fontFamily: view.fontFamily
        onChanged: function(value) { view.uiAction("toggle" + modelData.n + "State", Number(value)) }
      }
    }
  }

  // ---------- The one options box upstream shows ----------
  // Widgets are drawn in the order the config declares them, as upstream
  // does (e.g. Sony: Auto Ambient switch above its sensitivity picker).
  Column {
    width: parent.width
    spacing: Style.space(8)
    visible: !!view.box
    enabled: view.controls
    opacity: enabled ? 1.0 : 0.5

    Repeater {
      model: view.box ? view.box.order : []

      Column {
        id: boxPart
        required property string modelData
        width: view.width
        spacing: Style.space(8)

        PanelSectionHeader {
          width: parent.width
          visible: boxPart.modelData === "radio-button" && !!view.box.radio && view.box.radio.title !== ""
          text: view.box && view.box.radio ? view.box.radio.title : ""
          foreground: view.foreground
          fontFamily: view.fontFamily
        }
        ChoiceGroup {
          width: parent.width
          visible: boxPart.modelData === "radio-button"
          options: view.box && view.box.radio ? view.box.radio.options : []
          value: view.box && view.box.radio ? view.box.radio.value : ""
          foreground: view.foreground
          fontFamily: view.fontFamily
          onChanged: function(value) { view.uiAction("box" + view.box.n + "RadioButtonState", Number(value)) }
        }

        Repeater {
          model: boxPart.modelData === "check-button" && view.box ? view.box.checks : []

          Item {
            required property var modelData
            width: view.width
            height: Math.max(checkLabel.implicitHeight, checkSwitch.implicitHeight)
            Text {
              id: checkLabel
              anchors.left: parent.left
              anchors.right: checkSwitch.left
              anchors.rightMargin: Style.space(8)
              anchors.verticalCenter: parent.verticalCenter
              text: modelData.label
              color: view.foreground
              font.family: view.fontFamily
              font.pixelSize: Style.font.body
              wrapMode: Text.WordWrap
            }
            ToggleSwitch {
              id: checkSwitch
              anchors.right: parent.right
              anchors.verticalCenter: parent.verticalCenter
              checked: modelData.checked
              foreground: view.foreground
              onToggled: view.uiAction("box" + view.box.n + "CheckButton" + modelData.index + "State", modelData.checked ? 0 : 1)
            }
          }
        }

        PanelSectionHeader {
          width: parent.width
          visible: boxPart.modelData === "slider" && !!view.box.slider && view.box.slider.title !== ""
          text: view.box && view.box.slider ? view.box.slider.title : ""
          foreground: view.foreground
          fontFamily: view.fontFamily
        }
        PanelSlider {
          width: parent.width
          visible: boxPart.modelData === "slider"
          bar: view.bar
          minimum: 0
          maximum: 100
          step: 1
          integer: true
          value: view.box && view.box.slider ? view.box.slider.value : 0
          onReleased: function(value) { view.uiAction("box" + view.box.n + "SliderValue", Math.round(value)) }
        }
      }
    }
  }

  Text {
    width: parent.width
    visible: !!view.device && !view.ready
    text: "Waiting for the earbuds… If this stays, this model isn't supported yet."
    color: view.dim
    font.family: view.fontFamily
    font.pixelSize: Style.font.body
    wrapMode: Text.WordWrap
  }
}
