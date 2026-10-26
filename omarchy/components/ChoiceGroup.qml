import QtQuick
import qs.Commons
import qs.Ui

// Pick-one-of-N chips, like the shell's ButtonGroup, but wrapping onto
// more lines when the chips don't fit the width (ButtonGroup is a single
// Row and clips, e.g. AirPods' four noise control modes).
//
// `options` is an array of {value, label}; `value` is the selected one.
Flow {
  id: root

  property var options: []
  property string value: ""
  property color foreground: Color.foreground
  property string fontFamily: Style.font.family
  // Keyboard cursor: index of the chip to highlight, -1 for none.
  property int cursorIndex: -1

  signal changed(string value)

  spacing: Style.spacing.md

  Repeater {
    model: root.options

    delegate: Button {
      required property var modelData
      required property int index
      hasCursor: index === root.cursorIndex
      text: String(modelData.label)
      selected: String(modelData.value) === root.value
      bordered: true
      foreground: root.foreground
      fontFamily: root.fontFamily
      onClicked: root.changed(String(modelData.value))
    }
  }
}
