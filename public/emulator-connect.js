// Local emulator wiring only. Active on localhost when ?emulator=1 is present.
// Production hostnames never set MosaicUseEmulators, so this file is inert there.
//
// `?emulatorUser=` names an account LEVEL, because that is what a page is
// usually being looked at for: the same screen as an editor and as a member is
// two different screens. It was editor-or-viewer when Liturgy Orders was the
// only caller; Resources needs a member, which is a third rung, so the
// parameter now carries the level straight through rather than switching on
// the one alternative somebody happened to need first.
(function () {
    if (typeof location === 'undefined') return;
    if (location.hostname !== 'localhost' && location.hostname !== '127.0.0.1') return;
    const params = new URLSearchParams(location.search);
    if (params.get('emulator') !== '1') return;
    window.MosaicUseEmulators = true;
    const level = (params.get('emulatorUser') || 'editor').trim().toLowerCase();
    window.MosaicEmulatorCredentials = {
        email: (/^[a-z_]+$/.test(level) ? level : 'editor') + '@mosaic.emulator.test',
        password: 'mosaic-emulator-pass',
    };
}());
