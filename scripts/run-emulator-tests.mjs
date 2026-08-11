// Run the emulator-backed tests (MS-217).
//
// ⚠ NOT NAMED test-*. `node --test` claims any file called test-something and
// runs it as a test — which this is not, it is the runner. Under the old name
// (scripts/test-emulator.mjs) plain `npm test` executed it, found no Java, and
// failed the suite, while every real emulator test two directories over was
// skipping politely for want of FIRESTORE_EMULATOR_HOST.
//
// The Firestore emulator is a Java program, and a machine that has a JDK often
// has it somewhere other than the PATH — Homebrew keeps its `openjdk` keg-only,
// Windows buries it under Program Files, and Android Studio ships its own
// runtime on both and tells nobody. Rather than making every developer export
// JAVA_HOME by hand, this looks in the usual places for the platform it is on
// and puts whichever it finds on the PATH for the child process only.
//
// Everything else is `firebase emulators:exec`, which starts Firestore, sets
// FIRESTORE_EMULATOR_HOST for the command, and shuts down afterwards. The
// project id is a throwaway `demo-` one: that tells both the SDK and the
// emulator that no credentials exist, so a slip cannot write test data into the
// church's real database.

import { spawnSync, execFileSync } from 'node:child_process';
import { existsSync, readdirSync } from 'node:fs';
import path from 'node:path';

const PROJECT_ID = 'demo-mosaic-ms20';

function javaBinDir() {
    // Already on the PATH — nothing to do.
    try {
        execFileSync('java', ['-version'], { stdio: 'ignore' });
        return null;
    } catch { /* keep looking */ }

    const candidates = [];
    const windows = process.platform === 'win32';

    // JAVA_HOME, wherever it points, on either platform.
    if (process.env.JAVA_HOME) candidates.push(path.join(process.env.JAVA_HOME, 'bin'));

    if (windows) {
        // The two places a JDK lands on Windows, newest first, plus Android
        // Studio's bundled runtime — the same fair bet as on a Mac, since
        // this repo builds a Capacitor app.
        for (const base of [
            'C:\\Program Files\\Java',
            'C:\\Program Files\\Eclipse Adoptium',
            path.join(process.env.LOCALAPPDATA || '', 'Programs', 'Eclipse Adoptium'),
        ]) {
            if (!base || !existsSync(base)) continue;
            readdirSync(base).sort().reverse()
                .forEach(name => candidates.push(path.join(base, name, 'bin')));
        }
        candidates.push('C:\\Program Files\\Android\\Android Studio\\jbr\\bin');
    } else {
        // Homebrew's openjdk, any version, newest first.
        for (const base of ['/opt/homebrew/opt', '/usr/local/opt']) {
            if (!existsSync(base)) continue;
            readdirSync(base)
                .filter(name => name.startsWith('openjdk'))
                .sort()
                .reverse()
                .forEach(name => candidates.push(path.join(base, name, 'bin')));
        }

        // The runtimes a system JDK install leaves behind.
        const vms = '/Library/Java/JavaVirtualMachines';
        if (existsSync(vms)) {
            readdirSync(vms).forEach(name =>
                candidates.push(path.join(vms, name, 'Contents/Home/bin')));
        }

        candidates.push('/Applications/Android Studio.app/Contents/jbr/Contents/Home/bin');
    }

    const exe = windows ? 'java.exe' : 'java';
    const found = candidates.find(dir => existsSync(path.join(dir, exe)));
    if (!found) {
        console.error(
            'No Java runtime found, and the Firestore emulator needs one.\n' +
            'Install it with:  ' + (windows
                ? 'winget install EclipseAdoptium.Temurin.21.JDK'
                : 'brew install openjdk'));
        process.exit(1);
    }
    return found;
}

const bin = javaBinDir();
const env = Object.assign({}, process.env);
if (bin) {
    env.PATH = bin + path.delimiter + env.PATH;
    console.log('Using the Java runtime at ' + bin);
}

// ⚠ ONE FILE AT A TIME. `node --test` runs test FILES in parallel by default,
// and every suite here wipes the database between tests. Two of them running
// together wipe each other's fixtures mid-test, and the failures land in
// whichever suite was unlucky rather than the one that caused them — which is
// exactly how this was found: MS-20's suite went red the day MS-190's was added,
// having not been touched.
const inner = 'node --test --test-concurrency=1 ' +
    (process.argv[2] || 'test/emulator/*.test.js');
const result = spawnSync('npx', [
    'firebase', 'emulators:exec',
    '--only', 'firestore',
    '--project', PROJECT_ID,
    inner,
], { stdio: 'inherit', env });

process.exit(result.status === null ? 1 : result.status);
