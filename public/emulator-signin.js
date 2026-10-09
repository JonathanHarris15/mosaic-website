// Signs into the Auth emulator when emulator-connect.js armed the session.
(function () {
    if (!window.MosaicEmulatorCredentials || typeof auth === 'undefined') return;

    window.MosaicEmulatorSignIn = async function () {
        if (auth.currentUser && !auth.currentUser.isAnonymous) return auth.currentUser;
        const spec = window.MosaicEmulatorCredentials;
        try {
            const cred = await auth.signInWithEmailAndPassword(spec.email, spec.password);
            return cred.user;
        } catch (e) {
            console.error('Emulator sign-in failed', e);
            throw e;
        }
    };
}());
