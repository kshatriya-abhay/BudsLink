'use strict';
import Gio from 'gi://Gio';

// Jieli RCSP authentication.
//
// Both sides send `00` + 16 random bytes and expect `01` + E1(random) back,
// then confirm with `02 "pass"`. E1 is the Bluetooth authentication
// function (SAFER+ Ar, then Ar' with the offset key), keyed with a fixed key
// and a fixed "address" from Jieli's SDK. Checked against challenge/response
// pairs captured from the JLab app.

const KEY = Uint8Array.of(0x06, 0x77, 0x5f, 0x87, 0x91, 0x8d, 0xd4, 0x23,
    0x00, 0x5d, 0xf1, 0xd8, 0xcf, 0x0c, 0x14, 0x2b);
const ADDR = Uint8Array.of(0x11, 0x22, 0x33, 0x33, 0x22, 0x11);

export const AUTH_PASS = Uint8Array.of(0x02, 0x70, 0x61, 0x73, 0x73); // 02 "pass"

// ---- SAFER+ ----

// e(x) = 45^x mod 257 (256 -> 0), l = its inverse.
const EXP = new Uint8Array(256);
const LOG = new Uint8Array(256);
{
    let v = 1;
    for (let i = 0; i < 256; i++) {
        EXP[i] = v === 256 ? 0 : v;
        LOG[EXP[i]] = i;
        v = v * 45 % 257;
    }
}

const modPow = (base, exp, mod) => {
    let r = 1, b = base % mod, e = exp;
    while (e > 0) {
        if (e & 1)
            r = r * b % mod;
        b = b * b % mod;
        e >>= 1;
    }
    return r;
};

// Bias vectors B2..B17: B_p[i] = (45^(45^(17p + i + 1) mod 257) mod 257) mod 256.
const BIAS = [];
for (let p = 2; p <= 17; p++) {
    const row = new Uint8Array(16);
    for (let i = 0; i < 16; i++) {
        const v = modPow(45, modPow(45, 17 * p + i + 1, 257), 257);
        row[i] = v === 256 ? 0 : v;
    }
    BIAS.push(row);
}

// Pseudo-Hadamard mixing matrix of SAFER+.
const MIX = [
    [2, 1, 1, 1, 4, 2, 1, 1, 2, 2, 4, 2, 4, 4, 16, 8],
    [2, 1, 1, 1, 4, 2, 1, 1, 1, 1, 2, 1, 2, 2, 8, 4],
    [1, 1, 4, 2, 2, 2, 4, 2, 16, 8, 4, 4, 2, 1, 1, 1],
    [1, 1, 4, 2, 1, 1, 2, 1, 8, 4, 2, 2, 2, 1, 1, 1],
    [16, 8, 2, 2, 4, 2, 4, 4, 1, 1, 4, 2, 1, 1, 2, 1],
    [8, 4, 1, 1, 2, 1, 2, 2, 1, 1, 4, 2, 1, 1, 2, 1],
    [2, 2, 4, 2, 4, 4, 16, 8, 2, 1, 1, 1, 4, 2, 1, 1],
    [1, 1, 2, 1, 2, 2, 8, 4, 2, 1, 1, 1, 4, 2, 1, 1],
    [4, 2, 4, 4, 16, 8, 2, 2, 1, 1, 2, 1, 1, 1, 4, 2],
    [2, 1, 2, 2, 8, 4, 1, 1, 1, 1, 2, 1, 1, 1, 4, 2],
    [4, 4, 16, 8, 1, 1, 2, 1, 4, 2, 1, 1, 4, 2, 2, 2],
    [2, 2, 8, 4, 1, 1, 2, 1, 4, 2, 1, 1, 2, 1, 1, 1],
    [1, 1, 2, 1, 1, 1, 4, 2, 4, 4, 16, 8, 2, 2, 4, 2],
    [1, 1, 2, 1, 1, 1, 4, 2, 2, 2, 8, 4, 1, 1, 2, 1],
    [4, 2, 1, 1, 2, 1, 1, 1, 4, 2, 2, 2, 16, 8, 4, 4],
    [4, 2, 1, 1, 2, 1, 1, 1, 2, 1, 1, 1, 8, 4, 2, 2],
];

// Byte positions that use XOR (others use addition mod 256) on key mixing.
const XOR_POS = new Set([0, 3, 4, 7, 8, 11, 12, 15]);

function keySchedule(key) {
    const reg = [...key, key.reduce((a, b) => a ^ b, 0)];
    const keys = [Uint8Array.from(key)];
    for (let p = 1; p <= 16; p++) {
        for (let i = 0; i < 17; i++)
            reg[i] = (reg[i] << 3 | reg[i] >> 5) & 0xFF;
        const k = new Uint8Array(16);
        for (let i = 0; i < 16; i++)
            k[i] = reg[(p + i) % 17] + BIAS[p - 1][i] & 0xFF;
        keys.push(k);
    }
    return keys;
}

// Ar (prime = false) and Ar' (prime = true: the input is added back in
// before round 3).
function ar(input, keys, prime) {
    const x = Uint8Array.from(input);
    for (let r = 0; r < 8; r++) {
        if (prime && r === 2) {
            for (let i = 0; i < 16; i++)
                x[i] = XOR_POS.has(i) ? x[i] ^ input[i] : x[i] + input[i] & 0xFF;
        }
        const k1 = keys[2 * r], k2 = keys[2 * r + 1];
        for (let i = 0; i < 16; i++) {
            const v = XOR_POS.has(i) ? x[i] ^ k1[i] : x[i] + k1[i] & 0xFF;
            x[i] = XOR_POS.has(i) ? EXP[v] : LOG[v];
            x[i] = XOR_POS.has(i) ? x[i] + k2[i] & 0xFF : x[i] ^ k2[i];
        }
        const y = Uint8Array.from(x);
        for (let i = 0; i < 16; i++) {
            let s = 0;
            for (let j = 0; j < 16; j++)
                s += MIX[i][j] * y[j];
            x[i] = s & 0xFF;
        }
    }
    const k = keys[16];
    for (let i = 0; i < 16; i++)
        x[i] = XOR_POS.has(i) ? x[i] ^ k[i] : x[i] + k[i] & 0xFF;
    return x;
}

const OFFSET = [233, 229, 223, 193, 179, 167, 149, 131];

// K~: the offset key Ar' uses in E1.
function offsetKey(k) {
    const o = new Uint8Array(16);
    for (let i = 0; i < 16; i++) {
        const add = i < 8 ? i % 2 === 0 : i % 2 === 1;
        o[i] = add ? k[i] + OFFSET[i % 8] & 0xFF : k[i] ^ OFFSET[i % 8];
    }
    return o;
}

export function e1(rand, key = KEY, addr = ADDR) {
    const first = ar(rand, keySchedule(key), false);
    const x = new Uint8Array(16);
    for (let i = 0; i < 16; i++)
        x[i] = (first[i] ^ rand[i]) + addr[i % 6] & 0xFF;
    return ar(x, keySchedule(offsetKey(key)), true);
}

// `00` + 16 random bytes.
export function makeChallenge() {
    const rand = Gio.File.new_for_path('/dev/urandom').read(null).read_bytes(16, null).toArray();
    return Uint8Array.from([0x00, ...rand]);
}

// Answer to a `00` + random challenge: `01` + E1(random).
export function answerChallenge(challenge) {
    return Uint8Array.from([0x01, ...e1(challenge.slice(1, 17))]);
}
