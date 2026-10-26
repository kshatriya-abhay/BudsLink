// Gvc (libgnome-volume-control) is bundled with the Flatpak but is not
// available on every system the device code can run on. Without it,
// MediaController stays inactive: no software auto pause/resume and no
// conversation-awareness volume fade. Everything else keeps working.
export let Gvc = null;
try {
    Gvc = (await import('gi://Gvc')).default;
} catch {
    Gvc = null;
}

let control = null;

export function getMixerControl() {
    if (!Gvc)
        return null;

    if (!control) {
        control = new Gvc.MixerControl({name: 'budslink'});
        control.open();
    }
    return control;
}
export const Volume = {getMixerControl};
