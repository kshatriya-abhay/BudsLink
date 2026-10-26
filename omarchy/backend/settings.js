// GSettings for the headless backend.
//
// Upstream's Flatpak installs a compiled schema and stores values in dconf.
// Here the schema is compiled at startup from data/ into our state folder,
// and values live in a keyfile there, so nothing touches dconf and removing
// the plugin's state is a single `rm -r`.
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';

export const SCHEMA_ID = 'io.github.maniacx.BudsLink';

function compileSchema(repoRoot, schemaDir) {
    GLib.mkdir_with_parents(schemaDir, 0o755);
    const proc = Gio.Subprocess.new(
        ['glib-compile-schemas', '--strict', `--targetdir=${schemaDir}`,
            GLib.build_filenamev([repoRoot, 'data'])],
        Gio.SubprocessFlags.STDERR_PIPE
    );
    const [, , stderr] = proc.communicate_utf8(null, null);
    if (!proc.get_successful())
        throw new Error(`glib-compile-schemas failed: ${stderr?.trim()}`);
}

export function createSettings(repoRoot, stateDir) {
    const schemaDir = GLib.build_filenamev([stateDir, 'schemas']);
    compileSchema(repoRoot, schemaDir);

    const source = Gio.SettingsSchemaSource.new_from_directory(
        schemaDir, Gio.SettingsSchemaSource.get_default(), false);
    const schema = source.lookup(SCHEMA_ID, false);
    if (!schema)
        throw new Error(`schema ${SCHEMA_ID} not found in ${schemaDir}`);

    const backend = Gio.keyfile_settings_backend_new(
        GLib.build_filenamev([stateDir, 'settings.ini']), '/', null);

    return new Gio.Settings({settings_schema: schema, backend});
}
