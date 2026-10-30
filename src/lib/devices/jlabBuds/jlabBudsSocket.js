'use strict';
import GLib from 'gi://GLib';
import GObject from 'gi://GObject';

import {createLogger, getDeviceIdentifier} from '../logger.js';
import {SocketHandler} from '../socketByProfile.js';
import {AUTH_PASS, answerChallenge, makeChallenge} from './jieliAuth.js';
import {
    Attr, Flag, FUNCTION_PUBLIC, Op, encodeAttribute, encodeFrame,
    parseAttributes, parseEq, parseEqList, parseStream,
} from './jieliRcsp.js';

const REPLY_TIMEOUT_MS = 1500;
const AUTH_TIMEOUT_MS = 4000;

const hexBytes = b => Array.from(b, x => x.toString(16).padStart(2, '0')).join(' ');

// Jieli RCSP over SPP. On connect: authenticate (both directions), then read
// the EQ. Nothing is written to the device except the handshake and what the
// user asks for (setEq).
export const JlabBudsSocket = GObject.registerClass({
    GTypeName: 'BudsLink_JlabBudsSocket',
}, class JlabBudsSocket extends SocketHandler {
    _init(devicePath, profileManager, profile, callbacks) {
        super._init(devicePath, profileManager, profile);
        this._log = createLogger(`JlabBudsSocket-${getDeviceIdentifier(devicePath)}`);
        this._callbacks = callbacks;
        this._rx = new Uint8Array(0);
        this._seq = 0;
        this._auth = 'idle';
        this._challenge = null;
        this._queue = [];
        this._pending = null;
        this._timeouts = new Set();
        this.startSocket();
    }

    // ---- authentication ----

    postConnectInitialization() {
        this._log.info('Connected: authenticating');
        this._auth = 'await-answer';
        this._challenge = makeChallenge();
        this.sendMessage(encodeFrame(Flag.COMMAND, Op.AUTH_RESET, [this._nextSeq(), 0x01]));
        this._after(50, () => this.sendMessage(this._challenge));
        this._after(AUTH_TIMEOUT_MS, () => {
            if (this._auth !== 'done') {
                this._log.info(`Authentication timed out in state ${this._auth}`);
                this._callbacks.authFailed?.();
            }
        });
    }

    _handleAuth(msg) {
        if (this._auth === 'await-answer' && msg[0] === 0x01) {
            const want = answerChallenge(this._challenge);
            if (hexBytes(msg) !== hexBytes(want)) {
                this._log.info('Authentication failed: unexpected answer');
                this._auth = 'failed';
                this._callbacks.authFailed?.();
                return;
            }
            this.sendMessage(AUTH_PASS);
            this._auth = 'await-challenge';
        } else if (this._auth === 'await-challenge' && msg[0] === 0x00) {
            this.sendMessage(answerChallenge(msg));
            this._auth = 'await-pass';
        } else if (this._auth === 'await-pass' && msg[0] === 0x02) {
            this._auth = 'done';
            this._log.info('Authenticated');
            this._onAuthenticated();
        }
    }

    _onAuthenticated() {
        // Read-only queries.
        this._getSysInfo(1 << Attr.EQ | 1 << Attr.EQ_LIST);
    }

    // ---- commands ----

    _nextSeq() {
        this._seq = (this._seq + 1) & 0xFF;
        return this._seq;
    }

    _after(ms, fn) {
        const id = GLib.timeout_add(GLib.PRIORITY_DEFAULT, ms, () => {
            this._timeouts.delete(id);
            fn();
            return GLib.SOURCE_REMOVE;
        });
        this._timeouts.add(id);
        return id;
    }

    // One command in flight at a time; the reply carries its sequence byte.
    _queueCommand(opcode, body, label) {
        this._queue.push({opcode, body, label});
        this._pump();
    }

    _pump() {
        if (this._pending || this._queue.length === 0 || this._auth !== 'done')
            return;
        const item = this._queue.shift();
        const seq = this._nextSeq();
        this._pending = {seq, opcode: item.opcode};
        this._log.info(`Send ${item.label}`);
        this.sendMessage(encodeFrame(Flag.COMMAND, item.opcode, [seq, ...item.body]));
        this._pending.timeout = this._after(REPLY_TIMEOUT_MS, () => {
            this._log.info(`No reply to ${item.label}`);
            this._pending = null;
            this._pump();
        });
    }

    _getSysInfo(mask) {
        this._queueCommand(Op.GET_SYS_INFO,
            [FUNCTION_PUBLIC, mask >>> 24 & 0xFF, mask >>> 16 & 0xFF, mask >>> 8 & 0xFF, mask & 0xFF],
            `get sys info 0x${mask.toString(16)}`);
    }

    setEq(id, gains) {
        const data = [id, ...gains.map(g => g & 0xFF)];
        this._queueCommand(Op.SET_SYS_INFO, [FUNCTION_PUBLIC, ...encodeAttribute(Attr.EQ, data)],
            `set EQ ${id}`);
    }

    // ---- incoming ----

    processData(bytes) {
        const joined = new Uint8Array(this._rx.length + bytes.length);
        joined.set(this._rx);
        joined.set(bytes, this._rx.length);
        const {items, rest} = parseStream(joined, {authDone: this._auth === 'done'});
        this._rx = rest;
        for (const item of items) {
            if (item.raw)
                this._handleAuth(item.raw);
            else
                this._handleFrame(item.frame);
        }
    }

    _handleFrame({flag, opcode, payload}) {
        if (flag === Flag.REPLY) {
            const [status, seq] = payload;
            if (this._pending && seq === this._pending.seq) {
                GLib.source_remove(this._pending.timeout);
                this._timeouts.delete(this._pending.timeout);
                this._pending = null;
            }
            if (status === 0 && opcode === Op.GET_SYS_INFO)
                this._applyAttributes(parseAttributes(payload.slice(2)));
            else if (status !== 0)
                this._log.info(`Op 0x${opcode.toString(16)} failed, status ${status}`);
            this._pump();
        } else if (opcode === Op.SYS_INFO_PUSH) {
            this._applyAttributes(parseAttributes(payload.slice(1)));
        }
    }

    _applyAttributes(attrs) {
        if (attrs.has(Attr.EQ_LIST))
            this._callbacks.updateEqList?.(parseEqList(attrs.get(Attr.EQ_LIST)));
        if (attrs.has(Attr.EQ))
            this._callbacks.updateEq?.(parseEq(attrs.get(Attr.EQ)));
    }

    destroy() {
        for (const id of this._timeouts)
            GLib.source_remove(id);
        this._timeouts.clear();
        this._queue = [];
        this._pending = null;
        super.destroy();
    }
});
