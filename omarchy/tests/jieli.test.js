// Jieli RCSP (JLab) protocol tests, from bytes captured between the JLab
// app and a JBuds Lux ANC. No Bluetooth.
//
//   gjs -m omarchy/tests/jieli.test.js
import {e1, answerChallenge, makeChallenge, AUTH_PASS} from '../../src/lib/devices/jlabBuds/jieliAuth.js';
import {encodeFrame, parseStream, parseAttributes, parseEqList, parseEq, Flag, Op, Attr}
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

print(failures ? `\n${failures} failed` : '\nall passed');
if (failures)
    imports.system.exit(1);
