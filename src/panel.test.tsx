import { assert, mockHost, mount, test } from 'orca/testing'
import * as panel from './panel.tsx'
import { previewSnapshot, runningSession } from './fixtures.ts'

test('runs the selected workspace and keeps unsaved entrypoint edits when output arrives', async () => {
  const state = previewSnapshot()
  let runInput: unknown
  const host = mockHost({ requests: {
    'tools.snapshot': () => state,
    'tools.run': input => { runInput = input; return { ok: true } }
  } })
  const view = await mount(panel, { host })
  await view.toggle({ label: 'Advanced' })
  await view.type({ label: 'Entrypoint' }, 'lib/main_dev.dart', { replace: true })
  await view.post('tools.changed', { workspaceId: 'preview' })
  assert.equal(view.valueOf({ label: 'Entrypoint' }), 'lib/main_dev.dart')
  await view.press({ text: 'Run' })
  assert.deepEqual(runInput, { workspaceId: 'preview', projectPath: '.', options: { ...state.options, target: 'lib/main_dev.dart' } })
  assert.deepEqual(view.errors, [])
  assert.deepEqual(view.refusals, [])
  await view.unmount()
})

test('routes emulator creation to the selected installed image and shows worker errors', async () => {
  const state = previewSnapshot()
  let createInput: unknown
  const host = mockHost({ requests: {
    'tools.snapshot': () => state,
    'tools.createEmulator': input => { createInput = input; throw new Error('An emulator with that name already exists.') }
  } })
  const view = await mount(panel, { host })
  await view.select({ label: 'Flutter tools' }, 'devices')
  await view.toggle({ label: 'Create Android emulator' })
  await view.type({ label: 'Name' }, 'my_device', { replace: true })
  await view.press({ text: 'Create emulator' })
  assert.deepEqual(createInput, { workspaceId: 'preview', projectPath: '.', name: 'my_device', imageId: state.images[0].id })
  assert.ok(view.find({ text: /An emulator with that name already exists\./ }))
  assert.deepEqual(view.errors, [])
  await view.unmount()
})

test('sends reload and stop only for the selected running app', async () => {
  const state = previewSnapshot()
  state.sessions = [runningSession({ devToolsUrl: null })]
  const calls: unknown[] = []
  const view = await mount(panel, { host: mockHost({ requests: { 'tools.snapshot': () => state, 'tools.control': input => { calls.push(input); return { ok: true } } } }) })
  await view.press({ text: 'Reload' })
  await view.press({ text: 'Stop' })
  assert.deepEqual(calls, [{ workspaceId: 'preview', projectPath: '.', action: 'reload' }, { workspaceId: 'preview', projectPath: '.', action: 'stop' }])
  assert.deepEqual(view.errors, [])
  await view.unmount()
})

test('builds with the selected platform and the run configuration', async () => {
  const state = previewSnapshot()
  let buildInput: any
  const view = await mount(panel, { host: mockHost({ requests: { 'tools.snapshot': () => state, 'tools.build': input => { buildInput = input; return { ok: true } } } }) })
  await view.select({ label: 'Flutter tools' }, 'build')
  await view.select({ label: 'Platform' }, 'appbundle')
  await view.type({ label: 'Extra build arguments' }, '--obfuscate', { replace: true })
  await view.press({ text: 'Build Android App Bundle (.aab)' })
  assert.deepEqual(buildInput.build, { platform: 'appbundle', mode: 'release', extraArgs: '--obfuscate' })
  assert.deepEqual(buildInput.options, state.options)
  assert.deepEqual(view.errors, [])
  await view.unmount()
})

test('saves a named configuration with dart defines', async () => {
  const state = previewSnapshot()
  let configInput: any
  const view = await mount(panel, { host: mockHost({ requests: { 'tools.snapshot': () => state, 'tools.config': input => { configInput = input; return { ok: true } } } }) })
  await view.toggle({ label: 'Advanced' })
  await view.type({ label: 'Dart defines (KEY=VALUE per line)' }, 'API_URL=https://dev', { replace: true })
  await view.toggle({ label: 'Save configuration' })
  await view.type({ label: 'Name' }, 'Dev', { replace: true })
  await view.press({ text: 'Save' })
  assert.equal(configInput.name, 'Dev')
  assert.equal(configInput.options.dartDefines, 'API_URL=https://dev')
  assert.deepEqual(view.errors, [])
  await view.unmount()
})

test('inspector loads the widget tree and opens source on action', async () => {
  const state = previewSnapshot()
  state.sessions = [runningSession()]
  const opened: unknown[] = []
  const root = { id: 'w', label: 'MyApp', file: 'lib/main.dart', line: 3, children: [] }
  const view = await mount(panel, { host: mockHost({ requests: { 'tools.snapshot': () => state, 'tools.widgetTree': () => ({ root }), 'tools.openSource': input => { opened.push(input); return { ok: true } } } }) })
  await view.select({ label: 'Flutter tools' }, 'inspector')
  await view.press({ text: 'Load tree' })
  await view.activateItem({ label: 'Widget tree' }, 'w')
  await view.selectItem({ label: 'Widget tree' }, 'w')
  await view.press({ text: 'Open source' })
  assert.deepEqual(opened, [{ workspaceId: 'preview', projectPath: '.', file: 'lib/main.dart' }, { workspaceId: 'preview', projectPath: '.', file: 'lib/main.dart' }])
  assert.deepEqual(view.errors, [])
  await view.unmount()
})

test('warns about missing release signing only for store release builds', async () => {
  const state = previewSnapshot()
  state.release = [{ platform: 'android', level: 'error', messages: ['android/key.properties is missing.'] }, { platform: 'ios', level: 'ok', messages: [] }]
  const view = await mount(panel, { host: mockHost({ requests: { 'tools.snapshot': () => state } }) })
  await view.select({ label: 'Flutter tools' }, 'build')
  assert.ok(view.find({ text: /key\.properties is missing/ }))
  await view.select({ label: 'Mode' }, 'debug')
  assert.equal(view.find({ text: /key\.properties is missing/ }), null)
  await view.select({ label: 'Mode' }, 'release')
  await view.select({ label: 'Platform' }, 'web')
  assert.equal(view.find({ text: /key\.properties is missing/ }), null)
  await view.unmount()
})

test('packages tab checks once on open, prompts for updates and upgrades a selected package', async () => {
  const state = previewSnapshot()
  const calls: any[] = []
  const host = mockHost({ requests: {
    'tools.snapshot': () => state,
    'tools.packages': () => { calls.push('check'); state.packages = [
      { name: 'http', kind: 'direct', current: '1.1.0', upgradable: '1.2.0', resolvable: '1.2.0', latest: '1.2.0', discontinued: false, advisory: false },
      { name: 'lints', kind: 'dev', current: '4.0.0', upgradable: '4.0.0', resolvable: '6.0.0', latest: '6.0.0', discontinued: false, advisory: false }
    ]; return { ok: true } },
    'tools.pub': input => { calls.push(input); return { ok: true } }
  } })
  const view = await mount(panel, { host })
  await view.select({ label: 'Flutter tools' }, 'packages')
  assert.ok(view.find({ text: /2 packages can be updated/ }))
  await view.selectRows({ label: 'Dependencies' }, ['lints'])
  await view.press({ text: 'Upgrade to latest' })
  await view.press({ text: 'Upgrade compatible' })
  assert.deepEqual(calls, ['check', { workspaceId: 'preview', projectPath: '.', action: 'latest', name: 'lints', dev: true }, { workspaceId: 'preview', projectPath: '.', action: 'upgrade', name: '', dev: false }])
  assert.deepEqual(view.errors, [])
  await view.unmount()
})

test('devices tab lists connected devices and picks one as run target without leaving the tab', async () => {
  const state = previewSnapshot()
  state.devices.push({ id: 'PIXEL-8-DEMO', name: 'Pixel 8', platform: 'android-arm64', emulator: false })
  const view = await mount(panel, { host: mockHost({ requests: { 'tools.snapshot': () => state } }) })
  await view.select({ label: 'Flutter tools' }, 'devices')
  assert.ok(view.find({ label: 'Pixel 8' }))
  await view.press({ label: 'Pixel 8' })
  assert.equal(view.valueOf({ label: 'Flutter tools' }), 'devices', 'stays on the Devices tab')
  assert.ok(view.find({ text: 'Run target: Pixel 8' }))
  await view.select({ label: 'Flutter tools' }, 'run')
  assert.equal(view.valueOf({ label: 'Device' }), 'PIXEL-8-DEMO')
  await view.unmount()
})

test('a focus change Orca cannot resolve keeps the current workspace instead of resetting', async () => {
  const state = previewSnapshot()
  let unresolved = false
  const view = await mount(panel, { host: mockHost({ requests: { 'tools.snapshot': input => unresolved && !input.workspaceId ? { ...state, selection: null, projects: [], notice: 'Choose the workspace containing your Dart or Flutter project.' } : state } }) })
  unresolved = true
  await view.emit('workspace.changed', { context: { branch: 'other', displayName: 'Other', terminals: [] } })
  assert.equal(view.find({ label: 'Open a Dart or Flutter project' }), null)
  assert.equal(view.valueOf({ label: 'Workspace' }), 'preview')
  assert.ok(view.find({ label: 'Flutter tools' }))
  await view.unmount()
})

test('build cards show duration and the built file on success; errors can be dismissed', async () => {
  const state = previewSnapshot()
  state.jobs = [{ id: 'b1', workspaceId: 'preview', projectPath: '.', title: 'Build appbundle (release)  ·  flutter build appbundle --release', status: 'passed', code: 0, startedAt: 0, finishedAt: 83_000, output: 'Build\nRunning Gradle task...\n✓ Built build/app/outputs/bundle/release/app-release.aab (21.3MB)\n' }]
  const view = await mount(panel, { host: mockHost({ requests: { 'tools.snapshot': () => state, 'tools.run': () => { throw new Error('Refresh devices first.') } } }) })
  await view.select({ label: 'Flutter tools' }, 'build')
  assert.ok(view.find({ text: /finished in 1m 23s/ }))
  assert.ok(view.find({ text: /app-release\.aab · 21\.3MB/ }))
  await view.select({ label: 'Flutter tools' }, 'run')
  await view.press({ text: 'Run' })
  assert.ok(view.find({ text: /Refresh devices first/ }))
  await view.press({ text: 'Dismiss' })
  assert.equal(view.find({ text: /Refresh devices first/ }), null)
  await view.unmount()
})

test('Flutter SDK upgrade: check, confirm, refuse while running, FVM guidance', async () => {
  const state = previewSnapshot()
  state.sdkVersion = 'Flutter 3.41.0'
  state.jobs = [{ id: 'c1', workspaceId: 'preview', projectPath: '.', title: 'Check Flutter version  ·  flutter upgrade --verify-only', status: 'passed', code: 0, startedAt: 0, finishedAt: 4000, output: 'x\nA new version of Flutter is available on channel stable\n\nThe latest version: 3.50.1 (revision ae9b586f34)\n' }]
  const tasks: unknown[] = []
  const view = await mount(panel, { host: mockHost({ requests: { 'tools.snapshot': () => state, 'tools.task': input => { tasks.push(input.action); return { ok: true } } } }) })
  await view.select({ label: 'Flutter tools' }, 'checks')
  assert.ok(view.find({ text: 'Update available: 3.50.1' }))
  await view.press({ text: 'Upgrade Flutter' })
  assert.deepEqual(tasks, [], 'first press only asks')
  await view.press({ text: 'Upgrade now' })
  assert.deepEqual(tasks, ['sdk-upgrade'])
  await view.unmount()

  state.sessions = [runningSession()]
  const busyView = await mount(panel, { host: mockHost({ requests: { 'tools.snapshot': () => state } }) })
  await busyView.select({ label: 'Flutter tools' }, 'checks')
  assert.equal(busyView.find({ text: 'Upgrade Flutter' })?.disabled, true)
  await busyView.unmount()

  const fvm = { ...previewSnapshot(), sdkFvm: true }
  const fvmView = await mount(panel, { host: mockHost({ requests: { 'tools.snapshot': () => fvm } }) })
  await fvmView.select({ label: 'Flutter tools' }, 'checks')
  assert.ok(fvmView.find({ text: /Managed by FVM/ }))
  assert.equal(fvmView.find({ text: 'Upgrade Flutter' }), null)
  await fvmView.unmount()
})

test('inspector: platform and brightness overrides, text dumps, screenshot', async () => {
  const state = previewSnapshot()
  state.sessions = [runningSession()]
  const calls: unknown[] = []
  const view = await mount(panel, { host: mockHost({ requests: {
    'tools.snapshot': () => state,
    'tools.override': input => { calls.push([input.kind, input.value]); return { ok: true } },
    'tools.dump': input => { calls.push(['dump', input.kind]); return { text: 'RenderView#1\n └child: RenderSemanticsAnnotations' } },
    'tools.screenshot': () => { calls.push('screenshot'); return { ok: true } }
  } }) })
  await view.select({ label: 'Flutter tools' }, 'inspector')
  await view.select({ label: 'Platform' }, 'iOS')
  await view.select({ label: 'Brightness' }, 'dark')
  await view.toggle({ label: 'Text dumps' })
  await view.press({ text: 'Dump' })
  await view.press({ text: 'Screenshot' })
  assert.deepEqual(calls, [['platform', 'iOS'], ['brightness', 'dark'], ['dump', 'render'], 'screenshot'])
  assert.ok(view.find({ text: /RenderSemanticsAnnotations/ }))
  assert.deepEqual(view.errors, [])
  await view.unmount()
})

test('attach sends the run configuration with attach: true', async () => {
  const state = previewSnapshot()
  let input: any
  const view = await mount(panel, { host: mockHost({ requests: { 'tools.snapshot': () => state, 'tools.run': value => { input = value; return { ok: true } } } }) })
  await view.press({ text: 'Attach' })
  assert.equal(input.attach, true)
  assert.equal(input.options.deviceId, 'demo-emulator')
  await view.unmount()
})

test('devices: location for emulators, with presets and range checks', async () => {
  const state = previewSnapshot()
  let sent: any
  const view = await mount(panel, { host: mockHost({ requests: { 'tools.snapshot': () => state, 'tools.location': input => { sent = input; return { ok: true } } } }) })
  await view.select({ label: 'Flutter tools' }, 'devices')
  await view.select({ label: 'Place' }, 'Tokyo')
  await view.press({ text: 'Set location' })
  assert.deepEqual([sent.deviceId, sent.latitude, sent.longitude], ['demo-emulator', 35.6762, 139.6503])
  await view.type({ label: 'Latitude' }, '123', { replace: true })
  assert.equal(view.find({ text: 'Set location' })?.disabled, true)
  await view.unmount()
})

test('a workspace without a project offers flutter create', async () => {
  const state = { ...previewSnapshot(), selection: null, projects: [], creatable: { workspaceId: 'preview', empty: true }, notice: 'No Dart or Flutter project in this workspace yet.' }
  let sent: any
  const view = await mount(panel, { host: mockHost({ requests: { 'tools.snapshot': () => state, 'tools.create': input => { sent = input; return { ok: true } } } }) })
  await view.type({ label: 'Project name' }, 'Shop_App', { replace: true })
  await view.toggle({ label: 'Web' })
  await view.press({ text: 'Create shop_app/' })
  assert.deepEqual(sent, { workspaceId: 'preview', name: 'shop_app', org: 'com.example', template: 'app', platforms: ['android', 'ios', 'web'], here: false })
  await view.type({ label: 'Project name' }, '1bad', { replace: true })
  assert.equal(view.find({ text: 'Create 1bad/' })?.disabled, true)
  await view.unmount()
})

test('tests tab: tree with results, run scopes and failure output', async () => {
  const state = previewSnapshot()
  const failing = { key: 'test/a_test.dart::math fails', name: 'fails', kind: 'test' as const, file: 'test/a_test.dart', fullName: 'math fails', line: 6, status: 'failed' as const, output: 'Expected: <3>\n  Actual: <2>', children: [] }
  const group = { key: 'test/a_test.dart::math', name: 'math', kind: 'group' as const, file: 'test/a_test.dart', fullName: 'math', line: 4, status: 'failed' as const, output: '', children: [failing] }
  state.tests = { tree: [{ key: 'test/a_test.dart', name: 'a_test.dart', kind: 'file', file: 'test/a_test.dart', fullName: '', line: null, status: 'failed', output: '', children: [group] }], counts: { idle: 0, running: 0, passed: 3, failed: 1, skipped: 0 }, running: false, log: '$ flutter test --machine\n', coverage: 81.5, startedAt: 0, finishedAt: 1000 }
  const runs: unknown[] = []
  const view = await mount(panel, { host: mockHost({ requests: { 'tools.snapshot': () => state, 'tools.runTests': input => { runs.push({ keys: input.keys, failed: input.failed, coverage: input.coverage }); return { ok: true } } } }) })
  await view.select({ label: 'Flutter tools' }, 'tests')
  assert.ok(view.find({ text: '1 failed' }) && view.find({ text: 'coverage 81.5%' }))
  assert.deepEqual(view.expandedOf({ label: 'Tests' }), ['test/a_test.dart', 'test/a_test.dart::math'], 'failures are expanded')
  await view.selectItem({ label: 'Tests' }, 'test/a_test.dart::math fails')
  assert.ok(view.find({ text: /Actual: <2>/ }))
  await view.press({ text: 'Run this test' })
  await view.press({ text: 'Run failed' })
  await view.activateItem({ label: 'Tests' }, 'test/a_test.dart')
  assert.deepEqual(runs, [{ keys: ['test/a_test.dart::math fails'], failed: undefined, coverage: undefined }, { keys: [], failed: true, coverage: undefined }, { keys: ['test/a_test.dart'], failed: undefined, coverage: undefined }])
  assert.deepEqual(view.errors, [])
  await view.unmount()
})
