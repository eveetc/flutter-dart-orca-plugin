import { assert, test } from 'orca/testing'
import { buildArgs, checkOptions, coerceOptions, display, parseDefines, runArgs, splitArgs } from './args.ts'
import { toWidgetNode } from './inspector.ts'
import { defaultOptions } from './types.ts'

test('splits extra arguments like a shell, without expansion', () => {
  assert.deepEqual(splitArgs(`--web-port 8080  --dart-define="A=b c" 'x y' a\\ b $HOME`), ['--web-port', '8080', '--dart-define=A=b c', 'x y', 'a b', '$HOME'])
  assert.deepEqual(splitArgs('  '), [])
  assert.deepEqual(splitArgs(`""`), [''])
  assert.throws(() => splitArgs('"open'), /unclosed quote/)
})

test('parses dart defines and rejects malformed lines', () => {
  assert.deepEqual(parseDefines('# comment\nAPI_URL=https://x.dev?a=1\n\nFLAG=\n'), ['API_URL=https://x.dev?a=1', 'FLAG='])
  assert.throws(() => parseDefines('not a define'), /KEY=VALUE/)
  assert.deepEqual(parseDefines('export A=1\n--dart-define=B=2'), ['A=1', 'B=2'])
})

test('builds run and build commands from one configuration', () => {
  const options = { ...defaultOptions, deviceId: 'demo-emulator', flavor: 'staging', mode: 'profile' as const, dartDefines: 'A=1\nB=two words', defineFile: 'config/dev.json', extraArgs: '--no-pub' }
  assert.deepEqual(runArgs(options), ['run', '--machine', '-d', 'demo-emulator', '--profile', '-t', 'lib/main.dart', '--flavor', 'staging', '--dart-define=A=1', '--dart-define=B=two words', '--dart-define-from-file=config/dev.json', '--no-pub'])
  assert.deepEqual(buildArgs({ platform: 'appbundle', mode: 'release', extraArgs: '--obfuscate --split-debug-info=build/symbols' }, options),
    ['build', 'appbundle', '--release', '-t', 'lib/main.dart', '--flavor', 'staging', '--dart-define=A=1', '--dart-define=B=two words', '--dart-define-from-file=config/dev.json', '--obfuscate', '--split-debug-info=build/symbols'])
  assert.equal(display(['build', 'apk', '--dart-define=B=two words']), `flutter build apk '--dart-define=B=two words'`)
})

test('coerces unknown stored data and validates shape', () => {
  assert.deepEqual(coerceOptions({ mode: 'turbo', target: 5, flavor: 'dev' }), { ...defaultOptions, flavor: 'dev' })
  assert.throws(() => checkOptions({ ...defaultOptions, flavor: 'a b' }), /flavor/)
  assert.throws(() => checkOptions({ ...defaultOptions, target: 'lib/a.dart\n--evil' }), /single line/)
})

test('widget tree keeps only workspace source paths', () => {
  const node = toWidgetNode({ widgetRuntimeType: 'MyApp', creationLocation: { file: 'file:///ws/lib/main.dart', line: 3 }, children: [
    { description: 'Text', textPreview: 'Hi', creationLocation: { file: 'file:///elsewhere/x.dart', line: 1 }, children: [] }
  ] }, '/ws')
  assert.deepEqual(node, { id: 'w', label: 'MyApp', file: 'lib/main.dart', line: 3, children: [{ id: 'w.0', label: 'Text "Hi"', file: null, line: 1, children: [] }] })
})

test('pub arguments and outdated parsing', async () => {
  const { parseOutdated, pubArgs } = await import('./pub.ts')
  assert.deepEqual(pubArgs('latest', 'lints', { dev: true, version: '6.0.0' }), ['add', 'dev:lints:^6.0.0'])
  assert.deepEqual(pubArgs('upgrade', ''), ['upgrade'])
  assert.deepEqual(pubArgs('upgrade-major', ''), ['upgrade', '--major-versions'])
  assert.throws(() => pubArgs('add', 'Bad;rm'), /lowercase/)
  assert.throws(() => pubArgs('latest', 'http', { version: '1.0.0; echo' }), /newer version/)
  assert.deepEqual(parseOutdated({ packages: [{ package: 'args', kind: 'transitive' }, { package: 'http', kind: 'direct', current: { version: '1.0.0' }, latest: { version: '1.2.0' }, isDiscontinued: false }] }).map(p => [p.name, p.current, p.latest]), [['http', '1.0.0', '1.2.0']])
})

test('release signing checks never expose secrets', async () => {
  const { mkdtempSync, writeFileSync, mkdirSync } = await import('node:fs')
  const { tmpdir } = await import('node:os')
  const { join } = await import('node:path')
  const { androidSigning } = await import('./release.ts')
  const make = (gradle: string, props?: string, keystore = false) => {
    const dir = mkdtempSync(join(tmpdir(), 'orca-sign-'))
    mkdirSync(join(dir, 'android', 'app'), { recursive: true })
    writeFileSync(join(dir, 'android', 'app', 'build.gradle.kts'), gradle)
    if (props !== undefined) writeFileSync(join(dir, 'android', 'key.properties'), props)
    if (keystore) writeFileSync(join(dir, 'android', 'app', 'upload.jks'), 'x')
    return dir
  }
  const debug = 'android { buildTypes { release { signingConfig = signingConfigs.getByName("debug") } } }'
  const proper = 'val p = rootProject.file("key.properties")\nandroid { signingConfigs { create("release") {} }\n buildTypes { release { signingConfig = signingConfigs.getByName("release") } } }'
  assert.equal((await androidSigning(make(debug))).level, 'error')
  assert.match((await androidSigning(make(proper))).messages.join(), /key\.properties is missing/)
  const partial = await androidSigning(make(proper, 'storePassword=example-only-password\nstoreFile=upload.jks'))
  assert.match(partial.messages.join(), /keyAlias, keyPassword/)
  assert.ok(!JSON.stringify(partial).includes('example-only-password'))
  assert.equal((await androidSigning(make(proper, 'storePassword=a\nkeyPassword=b\nkeyAlias=upload\nstoreFile=upload.jks', true))).level, 'ok')
  assert.equal((await androidSigning(make('android { buildTypes { release { // signingConfig = signingConfigs.getByName("release")\n } } }'))).level, 'error')
})

test('FVM SDK paths are recognised', async () => {
  const { isFvmSdk } = await import('./projects.ts')
  assert.equal(isFvmSdk('/repo/.fvm/flutter_sdk/bin/flutter'), true)
  assert.equal(isFvmSdk('/opt/fvm/versions/3.24.0/bin/flutter'), true)
  assert.equal(isFvmSdk('C:\\\\repo\\\\.fvm\\\\flutter_sdk\\\\bin\\\\flutter.bat'), true)
  assert.equal(isFvmSdk('/opt/flutter/bin/flutter'), false)
  assert.equal(isFvmSdk('flutter'), false)
})

test('captured output is kept whole for parsing, even when large', async () => {
  const { capture, parseToolJson } = await import('./process.ts')
  const script = 'console.log(JSON.stringify({ packages: Array.from({ length: 3000 }, (_, i) => ({ package: "p" + i, kind: "direct" })) }))'
  const result = await capture({ executable: process.execPath, args: ['-e', script], cwd: process.cwd() })
  assert.ok(result.stdout.length > 48_000)
  assert.equal((parseToolJson(result.stdout) as { packages: unknown[] }).packages.length, 3000)
})

test('parses flutter emulators text output', async () => {
  const { parseEmulators } = await import('./process.ts')
  const text = '3 available emulators:\n\nId                  • Name                • Manufacturer • Platform\n\nphone_api_36        • Phone API 36        • Google       • android\napple_ios_simulator • iOS Simulator       • Apple        • ios\n\nTo run an emulator, run \'flutter emulators --launch <emulator id>\'.\n'
  assert.deepEqual(parseEmulators(text), [{ id: 'phone_api_36', name: 'Phone API 36', platform: 'android' }, { id: 'apple_ios_simulator', name: 'iOS Simulator', platform: 'ios' }])
  assert.deepEqual(parseEmulators('No emulators available.'), [])
})

test('test tree: groups, statuses, roll-up and re-running one test', async () => {
  const { TestTree, lcovPercent } = await import('./tests.ts')
  const tree = new TestTree('/proj')
  tree.setFiles(['test/math_test.dart', 'test/widget_test.dart'])
  tree.start([])
  const events = [
    { type: 'suite', suite: { id: 0, path: '/proj/test/math_test.dart' } },
    { type: 'testStart', test: { id: 1, name: 'loading /proj/test/math_test.dart', suiteID: 0, groupIDs: [] } },
    { type: 'testDone', testID: 1, result: 'success', hidden: true },
    { type: 'group', group: { id: 4, suiteID: 0, parentID: null, name: '' } },
    { type: 'group', group: { id: 5, suiteID: 0, parentID: 4, name: 'math', line: 4 } },
    { type: 'testStart', test: { id: 6, name: 'math adds', suiteID: 0, groupIDs: [4, 5], line: 5 } },
    { type: 'testDone', testID: 6, result: 'success', skipped: false },
    { type: 'testStart', test: { id: 9, name: 'math fails', suiteID: 0, groupIDs: [4, 5], line: 6 } },
    { type: 'error', testID: 9, error: 'Expected: <3>\n  Actual: <2>', stackTrace: 'math_test.dart 6' },
    { type: 'testDone', testID: 9, result: 'failure' },
    { type: 'group', group: { id: 10, suiteID: 0, parentID: 5, name: 'math nested', line: 7 } },
    { type: 'testStart', test: { id: 12, name: 'math nested skipped one', suiteID: 0, groupIDs: [4, 5, 10], line: 9 } },
    { type: 'testDone', testID: 12, result: 'success', skipped: true },
    { type: 'suite', suite: { id: 2, path: '/proj/test/widget_test.dart' } },
    { type: 'group', group: { id: 7, suiteID: 2, parentID: null, name: '' } },
    { type: 'testStart', test: { id: 8, name: 'Counter increments', suiteID: 2, groupIDs: [7], line: 174, root_line: 14 } },
    { type: 'print', testID: 8, message: 'hello' },
    { type: 'testDone', testID: 8, result: 'success' }
  ]
  events.forEach(event => tree.apply(event))
  tree.finish()
  const [math, widget] = tree.snapshot()
  assert.equal(math.status, 'failed')
  assert.deepEqual(math.children.map(node => [node.name, node.kind, node.status]), [['math', 'group', 'failed']])
  assert.deepEqual(math.children[0].children.map(node => [node.name, node.status, node.line]), [['adds', 'passed', 5], ['fails', 'failed', 6], ['nested', 'skipped', 7]])
  assert.match(math.children[0].children[1].output, /Expected: <3>/)
  assert.deepEqual([widget.status, widget.children[0].line, widget.children[0].output], ['passed', 14, 'hello\n'])
  assert.deepEqual(tree.counts(), { idle: 0, running: 0, passed: 2, failed: 1, skipped: 1 })
  // Re-run only the failing test: it passes now, the others keep their results.
  tree.start(['test/math_test.dart::math fails'])
  ;[{ type: 'suite', suite: { id: 0, path: '/proj/test/math_test.dart' } }, { type: 'group', group: { id: 3, suiteID: 0, parentID: null, name: '' } }, { type: 'group', group: { id: 4, suiteID: 0, parentID: 3, name: 'math' } },
    { type: 'testStart', test: { id: 5, name: 'math fails', suiteID: 0, groupIDs: [3, 4], line: 6 } }, { type: 'testDone', testID: 5, result: 'success' }].forEach(event => tree.apply(event))
  tree.finish()
  assert.deepEqual(tree.counts(), { idle: 0, running: 0, passed: 3, failed: 0, skipped: 1 })
  assert.equal(tree.snapshot()[0].status, 'passed')
  assert.equal(lcovPercent('SF:a\nLF:10\nLH:7\nend_of_record\nSF:b\nLF:10\nLH:9\n'), 80)
})
