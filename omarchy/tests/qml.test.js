// Checks on the plugin's QML files.   node omarchy/tests/qml.test.js
// Every Text element renders plain text. Qt's default (AutoText) treats
// strings that look like HTML as rich text, and device names come from the
// device itself: a name with an <img> tag would make the shell fetch that URL.
const fs = require('fs')
const path = require('path')

const root = path.join(__dirname, '..')
const files = []
const walk = dir => {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name)
    if (e.isDirectory()) { if (e.name !== 'tests') walk(p) } else if (e.name.endsWith('.qml')) files.push(p)
  }
}
walk(root)

let failed = 0
for (const file of files) {
  const lines = fs.readFileSync(file, 'utf8').split('\n')
  lines.forEach((line, i) => {
    if (!/^\s*Text\s*\{\s*$/.test(line)) return
    // Find the matching closing brace and look for textFormat inside.
    let depth = 0, j = i, body = ''
    for (; j < lines.length; j++) {
      depth += (lines[j].match(/\{/g) || []).length - (lines[j].match(/\}/g) || []).length
      body += lines[j] + '\n'
      if (depth === 0) break
    }
    if (!/textFormat:\s*Text\.PlainText/.test(body)) {
      failed++
      console.log(`FAIL ${path.relative(root, file)}:${i + 1} Text without textFormat: Text.PlainText`)
    }
  })
}
console.log(failed ? `${failed} failed` : `ok   all Text elements in ${files.length} QML files are plain text`)
process.exit(failed ? 1 : 0)
