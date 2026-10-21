// Classic pages share one global scope. Third-party script tags and the
// `window.*` bridges between our own scripts are not annotated. An index
// signature keeps `window.RolesCore` type-checkable without pretending each
// bridge is a typed export. `firebase` is the vendored compat SDK.
interface Window {
    [key: string]: any;
}

declare const firebase: any;
declare const Alpine: any;
declare const Capacitor: any;
