// Omarchy Buds backend: runs BudsLink's device code headless and speaks
// JSON lines on stdin/stdout (see the design note, "Bridge protocol").
//
// Start it through ./run, which points XDG_STATE_HOME at our own state
// folder before GLib caches it.
//
//   run [--detect-only] [--verbose]
//
// --detect-only  identify device families but never connect to a device
// --verbose      enable upstream's runtime log ($STATE/log/runtime.log)
import Gio from 'gi://Gio';
import GioUnix from 'gi://GioUnix';
import GLib from 'gi://GLib';
import GLibUnix from 'gi://GLibUnix';

import {createSettings} from './settings.js';
import {Host} from './host.js';
import {initLogger} from '../../src/lib/devices/logger.js';

// Upstream's device code awaits these; app.js sets them up the same way.
Gio._promisify(Gio, 'bus_get');
Gio._promisify(Gio.DBusProxy, 'new');
Gio._promisify(Gio.DBusProxy, 'new_for_bus');
Gio._promisify(Gio.DBusProxy.prototype, 'call');
Gio._promisify(Gio.DBusConnection.prototype, 'call');
Gio._promisify(Gio.InputStream.prototype, 'read_bytes_async');
Gio._promisify(Gio.OutputStream.prototype, 'write_all_async');
Gio._promisify(Gio.DataInputStream.prototype, 'read_line_async');

const PROTO = 1;
const args = new Set(ARGV);
const detectOnly = args.has('--detect-only');
const verbose = args.has('--verbose');

const repoRoot = GLib.path_get_dirname(GLib.path_get_dirname(
    GLib.path_get_dirname(Gio.File.new_for_uri(import.meta.url).get_path())));
const stateDir = GLib.get_user_state_dir();

const stdout = new GioUnix.OutputStream({fd: 1, close_fd: false});
function emit(obj) {
    stdout.write_all(`${JSON.stringify(obj)}\n`, null);
    stdout.flush(null);
}

function budslinkVersion() {
    try {
        const [, bytes] = GLib.file_get_contents(GLib.build_filenamev([repoRoot, 'meson.build']));
        return /version:\s*'([^']+)'/.exec(new TextDecoder().decode(bytes))?.[1] ?? null;
    } catch {
        return null;
    }
}

const loop = new GLib.MainLoop(null, false);
let host = null;

function quit() {
    host?.destroy();
    loop.quit();
}

// stdin closing means the shell (or whoever started us) went away.
function readStdin() {
    const input = new Gio.DataInputStream({
        base_stream: new GioUnix.InputStream({fd: 0, close_fd: false}),
    });
    const next = () => input.read_line_async(GLib.PRIORITY_DEFAULT, null, (stream, res) => {
        let line;
        try {
            [line] = stream.read_line_finish_utf8(res);
        } catch {
            line = null;
        }
        if (line === null) {
            quit();
            return;
        }
        handleCommand(line.trim());
        next();
    });
    next();
}

function handleCommand(line) {
    if (!line)
        return;
    let cmd;
    try {
        cmd = JSON.parse(line);
    } catch {
        emit({t: 'error', code: 'bad-json', message: line.slice(0, 200)});
        return;
    }
    switch (cmd.cmd) {
        case 'resync':
            host?.sync();
            break;
        default:
            emit({t: 'error', code: 'unknown-command', message: String(cmd.cmd)});
    }
}

function publicDevice(d) {
    return {
        path: d.path, address: d.address, alias: d.alias, connected: d.connected,
        family: d.family, pending: d.pending, ready: Boolean(d.dataHandler),
    };
}

async function main() {
    const settings = createSettings(repoRoot, stateDir);
    settings.set_boolean('logging-enabled', verbose);
    initLogger(settings);

    emit({t: 'hello', proto: PROTO, budslink: budslinkVersion(), detectOnly});

    host = new Host({settings, extPath: repoRoot, detectOnly});
    host.connect('devices-changed', (_h, list) => emit({t: 'devices', devices: list.map(publicDevice)}));
    host.connect('notification', (_h, id, shown) => {
        if (shown)
            emit({t: 'error', code: 'profile-conflict', message: id});
    });
    await host.start();
}

GLibUnix.signal_add(GLib.PRIORITY_DEFAULT, 15, () => {
    quit();
    return GLib.SOURCE_REMOVE;
});
GLibUnix.signal_add(GLib.PRIORITY_DEFAULT, 2, () => {
    quit();
    return GLib.SOURCE_REMOVE;
});

readStdin();
main().catch(e => {
    emit({t: 'error', code: 'fatal', message: String(e?.stack ?? e)});
    quit();
});
// runAsync, not run: a blocking run() at module top level stalls promise jobs,
// so upstream's awaits would never resume.
await loop.runAsync();
