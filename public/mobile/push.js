/**
 * Phone glue for a device token. Not unit-tested: it only runs where
 * Capacitor and a real permission prompt exist (MS-257, MS-260).
 *
 * Register when permission is already granted. The operating-system prompt
 * is requested only from the explainer's Allow button. Sign-out deletes
 * this install's token document.
 */
(function (global) {
    'use strict';

    var listening = false;

    function plugins() {
        var cap = global.Capacitor;
        return (cap && cap.Plugins) || {};
    }

    function nativePush() {
        return plugins().PushNotifications || null;
    }

    function inNativeApp() {
        return !!nativePush();
    }

    function currentUid() {
        var auth = global.firebase && firebase.auth && firebase.auth();
        return (auth && auth.currentUser && auth.currentUser.uid) || null;
    }

    function tokenDoc(uid) {
        var Open = global.MosaicNotificationOpen;
        var id = Open.stableDeviceTokenId(global.localStorage, function () {
            if (global.crypto && crypto.randomUUID) return crypto.randomUUID();
            return 't-' + Date.now();
        });
        return firebase.firestore().collection('users').doc(uid)
            .collection('push_tokens').doc(id);
    }

    function writeToken(uid, value) {
        if (!uid || !value) return Promise.resolve();
        var platform = 'unknown';
        if (global.Capacitor && Capacitor.getPlatform) {
            platform = Capacitor.getPlatform();
        }
        return tokenDoc(uid).set({
            token: value,
            platform: platform,
            updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
        });
    }

    function clearToken(uid) {
        if (!uid || !global.firebase || !firebase.firestore) return Promise.resolve();
        var Open = global.MosaicNotificationOpen;
        if (!Open) return Promise.resolve();
        var id = global.localStorage.getItem(Open.TOKEN_ID_KEY);
        if (!id) return Promise.resolve();
        return firebase.firestore().collection('users').doc(uid)
            .collection('push_tokens').doc(id).delete()
            .catch(function () {});
    }

    function openUrl(url) {
        var Open = global.MosaicNotificationOpen;
        var parsed = Open
            ? Open.routeFromNotificationUrl(url || '')
            : {route: 'home', params: {}};
        if (parsed.href) {
            var href = parsed.href;
            if (href.indexOf('shell=') === -1) {
                href += (href.indexOf('?') === -1 ? '?' : '&') + 'shell=mobile';
            }
            global.location.href = href;
            return;
        }
        var nav = global.M && global.M.nav;
        if (nav) nav(parsed.route || 'home', parsed.params || {});
    }

    function listen() {
        var Push = nativePush();
        if (!Push || listening) return;
        listening = true;
        Push.addListener('registration', function (token) {
            var uid = currentUid();
            if (uid && token && token.value) writeToken(uid, token.value);
        });
        Push.addListener('registrationError', function () {});
        Push.addListener('pushNotificationActionPerformed', function (action) {
            var note = action && action.notification;
            var data = note && note.data;
            openUrl(data && (data.url || data.link));
        });
    }

    function permission() {
        var Push = nativePush();
        if (!Push) return Promise.resolve('prompt');
        return Push.checkPermissions().then(function (status) {
            return (status && status.receive) || 'prompt';
        }).catch(function () { return 'prompt'; });
    }

    // Already granted: register (and refresh) without asking again.
    function registerIfGranted() {
        var Push = nativePush();
        if (!Push || !currentUid()) return Promise.resolve();
        listen();
        return Push.checkPermissions().then(function (status) {
            if (status && status.receive === 'granted') return Push.register();
        }).catch(function () {});
    }

    // The explainer's Allow button is the only place that asks the OS.
    function allowFromExplainer() {
        var Push = nativePush();
        if (!Push) return Promise.resolve();
        listen();
        return Push.requestPermissions().then(function (status) {
            if (status && status.receive === 'granted') return Push.register();
        }).catch(function () {});
    }

    function openSystemSettings() {
        var App = plugins().App;
        if (!App || !App.openUrl) return Promise.resolve();
        // iOS opens Settings. Android's confirmation is MS-260.
        return App.openUrl({url: 'app-settings:'}).catch(function () {});
    }

    global.MosaicPush = {
        inNativeApp: inNativeApp,
        permission: permission,
        registerIfGranted: registerIfGranted,
        allowFromExplainer: allowFromExplainer,
        clearToken: clearToken,
        openSystemSettings: openSystemSettings,
    };
})(typeof window !== 'undefined' ? window : null);
