import { assert, mockHost, mountWorker, test } from 'orca/testing'
import * as workerModule from './worker.ts'

test('does not launch tools for an empty workspace list', async () => {
  const host = mockHost({ results: { 'workspace.list': { workspaces: [], truncated: false }, 'workspace.readContext': null } })
  const worker = await mountWorker(workerModule, { host })
  const state = await worker.request('tools.snapshot', {})
  assert.equal(state.selection, null)
  assert.deepEqual(state.sessions, [])
  assert.deepEqual(state.jobs, [])
  assert.deepEqual(host.refusals, [])
  await worker.deactivate()
})

test('refuses remote projects and stale workspace ids before starting any process', async () => {
  const host = mockHost({ results: { 'workspace.list': { workspaces: [{ id: 'remote', kind: 'folder', name: 'Remote', path: '/not-local', branch: null, hostId: 'ssh-1' }], truncated: false } } })
  const worker = await mountWorker(workerModule, { host })
  await assert.rejects(() => worker.request('tools.task', { workspaceId: 'remote', projectPath: '.', action: 'analyze' }), /local Orca workspaces/)
  await assert.rejects(() => worker.request('tools.task', { workspaceId: 'missing', projectPath: '.', action: 'test' }), /no longer available/)
  assert.deepEqual(host.refusals, [])
  await worker.deactivate()
})

test('saves configurations and opens widget sources through editor.open', async () => {
  const { mkdtempSync, writeFileSync, mkdirSync } = await import('node:fs')
  const { tmpdir } = await import('node:os')
  const { join } = await import('node:path')
  const dir = mkdtempSync(join(tmpdir(), 'orca-flutter-'))
  writeFileSync(join(dir, 'pubspec.yaml'), 'name: demo\ndependencies:\n  flutter:\n    sdk: flutter\n')
  mkdirSync(join(dir, 'lib')); writeFileSync(join(dir, 'lib', 'main.dart'), 'void main() {}\n')
  const host = mockHost({ results: { 'workspace.list': { workspaces: [{ id: 'ws', kind: 'folder', name: 'Demo', path: dir, branch: null, hostId: null }], truncated: false }, 'workspace.readContext': null, 'editor.open': { opened: true } } })
  const worker = await mountWorker(workerModule, { host })
  const selection = { workspaceId: 'ws', projectPath: '.' }
  const options = { deviceId: '', target: 'lib/main.dart', flavor: 'staging', mode: 'release' as const, dartDefines: 'A=1', defineFile: '', extraArgs: '--no-pub' }
  await worker.request('tools.config', { ...selection, name: 'Staging', options })
  const state = await worker.request('tools.snapshot', { workspaceId: 'ws' })
  assert.deepEqual(state.configs.Staging, options)
  assert.deepEqual(state.options, options)
  await assert.rejects(() => worker.request('tools.config', { ...selection, name: 'Bad', options: { ...options, dartDefines: 'oops' } }), /KEY=VALUE/)
  await worker.request('tools.openSource', { ...selection, file: 'lib/main.dart' })
  assert.deepEqual(host.callsOf('editor.open'), [{ workspaceId: 'ws', path: 'lib/main.dart' }])
  await assert.rejects(() => worker.request('tools.openSource', { ...selection, file: '../etc/passwd.dart' }), /inside this workspace/)
  await assert.rejects(() => worker.request('tools.widgetTree', selection), /No app is running/)
  assert.deepEqual(host.refusals, [])
  await worker.deactivate()
})

test('finds the focused local workspace and its nested Flutter app like a real monorepo', async () => {
  const { mkdtempSync, writeFileSync, mkdirSync } = await import('node:fs')
  const { tmpdir } = await import('node:os')
  const { join } = await import('node:path')
  const pkg = (dir: string, name: string, flutter: boolean, app: boolean) => {
    mkdirSync(join(dir, 'lib'), { recursive: true })
    writeFileSync(join(dir, 'pubspec.yaml'), `name: ${name}\n${flutter ? 'dependencies:\n  flutter:\n    sdk: flutter\n' : ''}`)
    if (app) writeFileSync(join(dir, 'lib', 'main.dart'), 'void main() {}\n')
  }
  const root = mkdtempSync(join(tmpdir(), 'orca-mono-'))
  for (let i = 0; i < 40; i++) mkdirSync(join(root, 'aaa-docs', `section-${i}`, 'deep'), { recursive: true }) // wide noise before apps/
  pkg(join(root, 'apps', 'mobile', 'packages', 'maplibre_ios'), 'maplibre_ios', false, false)
  pkg(join(root, 'apps', 'mobile', 'packages', 'tracelet'), 'tracelet', true, false)
  pkg(join(root, 'apps', 'mobile'), 'mapapp', true, true)
  pkg(join(root, '.claude', 'worktrees', 'copy', 'apps', 'mobile'), 'hidden_copy', true, true)
  const other = mkdtempSync(join(tmpdir(), 'orca-other-'))
  const rows = [
    { id: 'repo::' + root, kind: 'worktree', name: 'MapApp', path: root, branch: 'refs/heads/feat/x', hostId: 'local', project: 'MapApp' },
    { id: 'repo::' + other, kind: 'worktree', name: 'MapApp', path: other, branch: '', hostId: 'local', project: 'MapApp' }
  ]
  for (const context of [{ workspaceId: 'repo::' + root, branch: 'feat/x', displayName: 'whatever', terminals: [] }, { branch: 'feat/x', displayName: 'MapApp', terminals: [] }]) {
    const host = mockHost({ results: { 'workspace.list': { workspaces: rows, truncated: false }, 'workspace.readContext': context } })
    const worker = await mountWorker(workerModule, { host })
    const state = await worker.request('tools.snapshot', {})
    assert.deepEqual(state.selection, { workspaceId: 'repo::' + root, projectPath: 'apps/mobile' })
    assert.deepEqual(state.projects.map(project => project.relativePath), ['apps/mobile', 'apps/mobile/packages/tracelet', 'apps/mobile/packages/maplibre_ios'])
    assert.equal(state.workspaces[0].branch, 'feat/x')
    assert.deepEqual(host.refusals, [])
    await worker.deactivate()
  }
})

test('location, create and overrides validate before running anything', async () => {
  const { mkdtempSync } = await import('node:fs')
  const { tmpdir } = await import('node:os')
  const { join } = await import('node:path')
  const dir = mkdtempSync(join(tmpdir(), 'orca-empty-'))
  const host = mockHost({ results: { 'workspace.list': { workspaces: [{ id: 'ws', kind: 'folder', name: 'Empty', path: dir, branch: null, hostId: 'local' }], truncated: false }, 'workspace.readContext': null } })
  const worker = await mountWorker(workerModule, { host })
  const state = await worker.request('tools.snapshot', { workspaceId: 'ws' })
  assert.deepEqual(state.creatable, { workspaceId: 'ws', empty: true })
  const base = { workspaceId: 'ws', org: 'com.example', template: 'app', platforms: ['android'], here: false }
  await assert.rejects(() => worker.request('tools.create', { ...base, name: 'Bad Name' }), /lowercase/)
  await assert.rejects(() => worker.request('tools.create', { ...base, name: 'ok_app', org: 'example' }), /reverse domain/)
  await assert.rejects(() => worker.request('tools.create', { ...base, name: 'ok_app', platforms: ['android; rm -rf /'] }), /Unknown platform/)
  await assert.rejects(() => worker.request('tools.create', { ...base, name: 'ok_app', template: '--evil' }), /Unknown project template/)
  await worker.deactivate()
})

test('attach arguments', async () => {
  const { attachArgs } = await import('./args.ts')
  assert.deepEqual(attachArgs({ deviceId: 'demo-emulator', target: 'lib/main.dart', flavor: 'dev', mode: 'release', dartDefines: '', defineFile: '', extraArgs: '' }), ['attach', '--machine', '-d', 'demo-emulator', '-t', 'lib/main.dart', '--flavor', 'dev'])
})
