// Jieli RCSP (JLab) protocol tests, from bytes captured between the JLab
// app and a JBuds Lux ANC. No Bluetooth.
//
//   gjs -m omarchy/tests/jieli.test.js
import {e1, answerChallenge, makeChallenge, AUTH_PASS} from '../../src/lib/devices/jlabBuds/jieliAuth.js';
import {encodeFrame, parseStream, parseAttributes, parseEqList, parseEq, Flag, Op, Attr,
    parseVoiceMode, parseVoiceModes, encodeVoiceMode, encodeAttribute}
    from '../../src/lib/devices/jlabBuds/jieliRcsp.js';

let failures = 0;
function check(name, ok, detail = '') {
    print(`${ok ? 'ok  ' : 'FAIL'} ${name}${ok || !detail ? '' : ` -- ${detail}`}`);
    if (!ok)
        failures++;
}
const hex = s => Uint8Array.from(s.replace(/\s+/g, '').match(/../g).map(h => parseInt(h, 16)));
const out = b => Array.from(b, x => x.toString(16).padStart(2, '0')).join('');

// ---- auth ----
check('E1: app challenge -> headphones answer',
    out(e1(hex('67c6697351ff4aec29cdbaabf2fbe346'))) === '023a02126fa284879236e9da27ba0b8d');
check('E1: headphones challenge -> app answer',
    out(e1(hex('64c152a0287b64a1cdbaa6155379c64c'))) === 'b8a457e8d99b017fa51d52edd87c5b12');
check('answerChallenge adds the 01 prefix',
    out(answerChallenge(hex('0064c152a0287b64a1cdbaa6155379c64c'))) === '01b8a457e8d99b017fa51d52edd87c5b12');
const ch = makeChallenge();
check('makeChallenge is 00 + 16 random bytes', ch.length === 17 && ch[0] === 0x00);

// ---- frames ----
check('encodeFrame matches the captured auth reset',
    out(encodeFrame(Flag.COMMAND, Op.AUTH_RESET, [0x00, 0x01])) === 'fedcbac00600020001ef');

const stream = hex(`
  01 023a02126fa284879236e9da27ba0b8d
  02 70617373
  00 64c152a0287b64a1cdbaa6155379c64c
  02 70617373
  fedcba 00 08 0002 001f ef
  fedcba 80 09 000f 16ff0c0401fe000204fefe00000404 ef`);
const {items, rest} = parseStream(stream);
check('stream: raw auth messages then frames',
    items.length === 6 && !!items[0].raw && items[0].raw[0] === 1 &&
    out(items[1].raw) === out(AUTH_PASS) && items[2].raw[0] === 0 &&
    items[4].frame.opcode === 0x08 && items[5].frame.flag === Flag.PUSH && rest.length === 0,
    JSON.stringify(items.map(i => i.raw ? `raw${i.raw.length}` : `op${i.frame.opcode}`)));
const half = parseStream(stream.slice(0, stream.length - 5));
check('stream: a split frame waits for the rest', half.rest.length > 0 && half.items.length === 5);

const after = parseStream(hex('00 11 fedcba 00 08 0002 001f ef'), {authDone: true});
check('after auth: stray bytes skipped, frame kept', after.items.length === 1 && !!after.items[0].frame);

// ---- EQ ----
const reply = hex(`ff 63 0c 0a 00 1f 00 3e 00 7d 00 fa 01 f4 03 e8 07 d0 0f a0 1f 40 3e 80
  00 01 01 00 fe fd fc fc fe ff fe  01 ff 00 ff fe fe fe fe ff ff fe
  02 03 03 02 00 fe fd fd fc fd ff  03 00 08 08 04 00 00 00 00 02 02
  04 00 00 00 04 04 04 00 02 03 04  05 fe 00 00 02 02 00 00 00 04 04
  06 00 00 00 00 00 00 00 00 00 00
  0c 04 00 01 01 00 fe fd fc fc fe ff fe`);
const attrs = parseAttributes(reply);
check('attributes: EQ list and current EQ', attrs.has(Attr.EQ_LIST) && attrs.has(Attr.EQ));
const list = parseEqList(attrs.get(Attr.EQ_LIST));
check('EQ list: 10 bands, 31 Hz..16 kHz',
    list.freqs.length === 10 && list.freqs[0] === 31 && list.freqs[9] === 16000);
check('EQ list: presets 0..6 with signed gains',
    list.presets.size === 7 && list.presets.get(0).join(',') === '1,1,0,-2,-3,-4,-4,-2,-1,-2' &&
    list.presets.get(6).every(g => g === 0));
const cur = parseEq(attrs.get(Attr.EQ));
check('current EQ: preset 0 with its gains', cur.id === 0 && cur.gains[3] === -2);

// ---- noise control ----
const modes = parseVoiceModes(hex('03 00 4000 4000 4000 4000 01 4000 4000 4000 4000 02 4000 4000 4000 4000'));
check('voice modes: off, ANC, Be Aware with max 0x4000',
    modes.map(m => m.mode).join(',') === '0,1,2' && modes.every(m => m.leftMax === 0x4000));
const half2 = parseVoiceMode(hex('01 4000 4000 200e 200e'));
check('voice mode: ANC at about half', half2.mode === 1 && half2.leftCur === 0x200e && half2.rightCur === 0x200e);
check('set voice mode encodes like the app',
    out(encodeFrame(Flag.COMMAND, Op.SET_SYS_INFO, [0x17, 0xff, ...encodeAttribute(Attr.VOICE_MODE, encodeVoiceMode(half2))])) ===
    // as captured: fe dc ba c0 08 00 0d | 17 ff 0a 0d 01 4000 4000 200e 200e | ef
    'fedcbac008000d17ff0a0d0140004000200e200eef');

// ---- device: panel contract and what clicks send (no Bluetooth) ----
const {JlabBudsDevice} = await import('../../src/lib/devices/jlabBuds/jlabBudsDevice.js');
const dev = new JlabBudsDevice(null, '/org/bluez/hci0/dev_00_DE_00_00_FF_01', 'JLab JBuds Lux ANC', '',
    {acquireFd: async () => -1, releaseFd: async () => {}}, () => {});
const sent = [];
dev._socket = {setEq: (id, gains) => sent.push(['eq', id, gains.join(',')]), setVoiceMode: vm => sent.push(['vm', vm]), destroy() {}};
dev._updateVoiceModes(modes);
dev._updateVoiceMode(half2);
dev._updateEqList(list);
dev._updateEq(cur);
const c = dev.dataHandler.getConfig(), st = dev.dataHandler.getProps();
check('panel: noise row Off / Noise Cancelling / Be Aware, on ANC',
    [c.toggle1Button1Name, c.toggle1Button2Name, c.toggle1Button3Name].join('|') === 'Off|Noise Cancelling|Be Aware' &&
    st.toggle1Visible && st.toggle1State === 2);
check('panel: level slider (50%) then EQ picker on EQ 1',
    c.optionsBox1.join(',') === 'slider,radio-button' && c.box1SliderTitle === 'Noise cancelling level' &&
    st.box1SliderValue === 50 && c.box1RadioButton.join('|') === 'EQ 1|EQ 2|EQ 3|Custom' && st.box1RadioButtonState === 1);

dev.dataHandler.emitUIAction('toggle1State', 3);
check('click Be Aware: sends mode 2 with Be Aware\'s own stored levels',
    sent.at(-1)?.[0] === 'vm' && sent.at(-1)[1].mode === 2 && sent.at(-1)[1].leftCur === 0x4000);
dev.dataHandler.emitUIAction('box1SliderValue', 25);
check('slider 25%: sends ANC with a quarter of max',
    sent.at(-1)?.[1].mode === 1 && sent.at(-1)[1].leftCur === 0x1000 && sent.at(-1)[1].rightCur === 0x1000);
dev.dataHandler.emitUIAction('box1RadioButtonState', 4);
check('click Custom: sends preset 6 with its stored gains', sent.at(-1)?.join('|') === 'eq|6|0,0,0,0,0,0,0,0,0,0');
const before = sent.length;
dev.dataHandler.emitUIAction('toggle1State', 2);
dev.dataHandler.emitUIAction('box1RadioButtonState', 1);
check('clicking the current mode or preset sends nothing', sent.length === before);
dev._updateVoiceMode({...half2, mode: 0});
const st2 = dev.dataHandler.getProps(), c2 = dev.dataHandler.getConfig();
check('noise off: no level slider, EQ stays', c2.optionsBox1.join(',') === 'radio-button' && st2.toggle1State === 1);
dev.destroy();

print(failures ? `\n${failures} failed` : '\nall passed');
if (failures)
    imports.system.exit(1);
