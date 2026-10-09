// Local emulator wiring only. Active on localhost when ?emulator=1 is present.
// Production hostnames never set MosaicUseEmulators, so this file is inert there.
(function () {
    if (typeof location === 'undefined') return;
    if (location.hostname !== 'localhost' && location.hostname !== '127.0.0.1') return;
    const params = new URLSearchParams(location.search);
    if (params.get('emulator') !== '1') return;
    window.MosaicUseEmulators = true;
    const role = params.get('emulatorUser') === 'viewer' ? 'viewer' : 'editor';
    window.MosaicEmulatorCredentials = {
        email: role + '@ms716.emulator.test',
        password: 'ms716-emulator-pass',
    };
}());
