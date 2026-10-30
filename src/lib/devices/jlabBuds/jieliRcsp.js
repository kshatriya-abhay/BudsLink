'use strict';

// Jieli RCSP framing:
//   fe dc ba | flag | opcode | len u16 BE | payload | ef
// Commands use flag 0xC0 (0x80 = no reply wanted); a command's payload starts
// with its sequence byte. Replies use flag 0x00 and start with status, then
// the sequence byte. Pushes from the device use flag 0x80.

export const HEADER = [0xFE, 0xDC, 0xBA];
export const END = 0xEF;

export const Flag = {
    COMMAND: 0xC0,
    REPLY: 0x00,
    PUSH: 0x80,
};

export const Op = {
    AUTH_RESET: 0x06,
    GET_SYS_INFO: 0x07,
    SET_SYS_INFO: 0x08,
    SYS_INFO_PUSH: 0x09,
};

// Attributes of the "public" function (0xFF) in get/set sys info.
export const Attr = {
    EQ: 0x04,            // current preset id + 10 gains (i8)
    EQ_LIST: 0x0C,       // band count, band frequencies, then (id + gains) per preset
    VOICE_MODE: 0x0D,    // noise mode + left/right max/current
    VOICE_MODES: 0x0E,   // the modes the device has
};
export const FUNCTION_PUBLIC = 0xFF;

export function encodeFrame(flag, opcode, payload) {
    const len = payload.length;
    return Uint8Array.from([...HEADER, flag, opcode, len >> 8 & 0xFF, len & 0xFF, ...payload, END]);
}

// Splits a byte stream into RCSP frames and raw (unframed) auth messages.
// Returns {items, rest}; items are {frame: {flag, opcode, payload}} or
// {raw: Uint8Array}. Raw messages are only expected during authentication;
// with `authDone`, anything that isn't a frame is skipped.
export function parseStream(buffer, {authDone = false} = {}) {
    const items = [];
    let buf = buffer;
    while (buf.length > 0) {
        if (buf[0] === HEADER[0]) {
            if (buf.length < 3)
                break;
            if (buf[1] !== HEADER[1] || buf[2] !== HEADER[2]) {
                buf = buf.slice(1);
                continue;
            }
            if (buf.length < 7)
                break;
            const len = buf[5] << 8 | buf[6];
            if (buf.length < 8 + len)
                break;
            if (buf[7 + len] === END)
                items.push({frame: {flag: buf[3], opcode: buf[4], payload: buf.slice(7, 7 + len)}});
            buf = buf.slice(8 + len);
            continue;
        }
        if (authDone) {
            buf = buf.slice(1);
            continue;
        }
        // Auth messages travel unframed: 00/01 + 16 bytes, or 02 "pass".
        const lead = buf[0];
        const size = lead === 0x02 ? 5 : lead === 0x00 || lead === 0x01 ? 17 : 0;
        if (size === 0) {
            buf = buf.slice(1);
            continue;
        }
        if (buf.length < size)
            break;
        items.push({raw: buf.slice(0, size)});
        buf = buf.slice(size);
    }
    return {items, rest: buf};
}

// Attributes in a get/set sys info body: function byte, then repeated
// (len, type, data[len - 1]).
export function parseAttributes(body) {
    const attrs = new Map();
    let pos = 1; // skip the function byte
    while (pos < body.length) {
        const len = body[pos];
        if (len < 1 || pos + 1 + len > body.length)
            break;
        attrs.set(body[pos + 1], body.slice(pos + 2, pos + 1 + len));
        pos += 1 + len;
    }
    return attrs;
}

export function encodeAttribute(type, data) {
    return [data.length + 1, type, ...data];
}

const i8 = b => b > 127 ? b - 256 : b;

// EQ list: {freqs: [Hz], presets: Map(id -> gains[])}.
export function parseEqList(data) {
    const count = data[0];
    const freqs = [];
    for (let i = 0; i < count; i++)
        freqs.push(data[1 + i * 2] << 8 | data[2 + i * 2]);
    const presets = new Map();
    for (let pos = 1 + count * 2; pos + count < data.length + 1 && pos + 1 + count <= data.length; pos += 1 + count)
        presets.set(data[pos], Array.from(data.slice(pos + 1, pos + 1 + count), i8));
    return {freqs, presets};
}

// Current EQ: {id, gains[]}.
export function parseEq(data) {
    return {id: data[0], gains: Array.from(data.slice(1), i8)};
}
