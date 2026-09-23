/**
 * Where a tapped notification goes, and the install's token document id.
 * The Capacitor calls are not exercised here.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const open = require('../public/notification-open.js');

function memory() {
    const box = {};
    return {
        getItem(key) { return Object.prototype.hasOwnProperty.call(box, key) ? box[key] : null; },
        setItem(key, value) { box[key] = String(value); },
    };
}

test('a known page becomes a shell route', () => {
    assert.deepStrictEqual(
        open.routeFromNotificationUrl('https://mosaic.example/peoples-page.html'),
        {route: 'people', params: {}});
    assert.deepStrictEqual(
        open.routeFromNotificationUrl('https://mosaic.example/service-builder.html?date=2026-06-28'),
        {route: 'serviceBuilder', params: {date: '2026-06-28'}});
});

test('a hash route is used, and an unknown URL is home', () => {
    assert.deepStrictEqual(
        open.routeFromNotificationUrl('https://mosaic.example/mobile.html#/shepherd'),
        {route: 'shepherd', params: {}});
    assert.deepStrictEqual(open.routeFromNotificationUrl(''), {route: 'home', params: {}});
    assert.deepStrictEqual(
        open.routeFromNotificationUrl('javascript:alert(1)'),
        {route: 'home', params: {}});
});

test('an Answer-link path is passed through and not minted', () => {
    assert.deepStrictEqual(
        open.routeFromNotificationUrl('https://mosaic.example/a/tok'),
        {href: '/a/tok'});
    assert.equal(open.routeFromNotificationUrl('/a/tok').href, '/a/tok');
});

test('the device token id is stable for the install', () => {
    const storage = memory();
    let n = 0;
    const first = open.stableDeviceTokenId(storage, () => 'id-' + (++n));
    const second = open.stableDeviceTokenId(storage, () => 'id-' + (++n));
    assert.equal(first, 'id-1');
    assert.equal(second, 'id-1');
});

test('the phone glue asks the OS only from the explainer Allow button', () => {
    const push = fs.readFileSync(path.join(__dirname, '../public/mobile/push.js'), 'utf8');
    const allow = push.slice(push.indexOf('function allowFromExplainer'));
    assert.match(allow, /requestPermissions/);
    assert.doesNotMatch(
        push.slice(0, push.indexOf('function allowFromExplainer')),
        /requestPermissions/);
    const app = fs.readFileSync(path.join(__dirname, '../public/mobile/app.js'), 'utf8');
    assert.doesNotMatch(app, /requestPermissions/);
    assert.match(app, /registerIfGranted/);
    const data = fs.readFileSync(path.join(__dirname, '../public/mobile/data.js'), 'utf8');
    assert.match(data, /MosaicPush[\s\S]{0,160}clearToken/);
});
