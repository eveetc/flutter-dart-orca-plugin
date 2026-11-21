import { defineCheck } from 'orca/testing'
import { emptySnapshot } from './types.ts'
import { previewSnapshot, runningSession } from './fixtures.ts'

const ready = previewSnapshot()
const running = { ...ready, sessions: [runningSession()] }
const tree = { root: { id: 'w', label: 'MyApp', file: 'lib/main.dart', line: 12, children: [{ id: 'w.0', label: 'HomePage', file: 'lib/home.dart', line: 8, children: [{ id: 'w.0.0', label: 'Text "Hello"', file: 'lib/home.dart', line: 20, children: [] }] }] } }

export default defineCheck({
  empty: { requests: { 'tools.snapshot': () => emptySnapshot() } },
  ready: { requests: { 'tools.snapshot': () => ready } },
  running: { requests: { 'tools.snapshot': () => running } },
  inspector: { requests: { 'tools.snapshot': () => running, 'tools.widgetTree': () => tree }, persisted: { plugin: { tab: 'inspector' } } },
  build: { requests: { 'tools.snapshot': () => ready }, persisted: { plugin: { tab: 'build' } } },
  devices: { requests: { 'tools.snapshot': () => ready }, persisted: { plugin: { tab: 'devices' } } },
  checks: { requests: { 'tools.snapshot': () => ({ ...ready, jobs: [{ id: 'job-1', workspaceId: 'preview', projectPath: '.', title: 'Analyze  ·  flutter analyze', status: 'passed' as const, code: 0, startedAt: 0, finishedAt: 42_000, output: 'Analyzing my_flutter_app…\nNo issues found!' }] }) }, persisted: { plugin: { tab: 'checks' } } },
  packages: { requests: { 'tools.snapshot': () => ({ ...ready, packages: [
    { name: 'http', kind: 'direct' as const, current: '1.2.0', upgradable: '1.2.2', resolvable: '1.2.2', latest: '1.2.2', discontinued: false, advisory: false },
    { name: 'provider', kind: 'direct' as const, current: '6.1.2', upgradable: '6.1.2', resolvable: '6.1.2', latest: '6.1.2', discontinued: false, advisory: false },
    { name: 'go_router', kind: 'direct' as const, current: '14.2.0', upgradable: '14.8.1', resolvable: '16.0.0', latest: '16.0.0', discontinued: false, advisory: false },
    { name: 'flutter_lints', kind: 'dev' as const, current: '5.0.0', upgradable: '5.0.0', resolvable: '6.0.0', latest: '6.0.0', discontinued: false, advisory: false }
  ] }) }, persisted: { plugin: { tab: 'packages' } } },
  signing: { requests: { 'tools.snapshot': () => ({ ...ready, release: [{ platform: 'android' as const, level: 'error' as const, messages: ['android/key.properties is missing, so release signing will fail. It is usually gitignored: in a new worktree, copy it (and the keystore) from your main checkout.'] }] }) }, persisted: { plugin: { tab: 'build' } } },
  tests: { requests: { 'tools.snapshot': () => ({ ...ready, tests: { running: false, log: '', coverage: 87.2, startedAt: 0, finishedAt: 9000, counts: { idle: 0, running: 0, passed: 5, failed: 1, skipped: 1 }, tree: [
    { key: 'test/cart_test.dart', name: 'cart_test.dart', kind: 'file' as const, file: 'test/cart_test.dart', fullName: '', line: null, status: 'failed' as const, output: '', children: [
      { key: 'test/cart_test.dart::Cart', name: 'Cart', kind: 'group' as const, file: 'test/cart_test.dart', fullName: 'Cart', line: 6, status: 'failed' as const, output: '', children: [
        { key: 'test/cart_test.dart::Cart adds items', name: 'adds items', kind: 'test' as const, file: 'test/cart_test.dart', fullName: 'Cart adds items', line: 7, status: 'passed' as const, output: '', children: [] },
        { key: 'test/cart_test.dart::Cart applies discount', name: 'applies discount', kind: 'test' as const, file: 'test/cart_test.dart', fullName: 'Cart applies discount', line: 14, status: 'failed' as const, output: 'Expected: <90.0>\n  Actual: <100.0>', children: [] },
        { key: 'test/cart_test.dart::Cart empties', name: 'empties', kind: 'test' as const, file: 'test/cart_test.dart', fullName: 'Cart empties', line: 21, status: 'skipped' as const, output: '', children: [] }] }] },
    { key: 'test/widget_test.dart', name: 'widget_test.dart', kind: 'file' as const, file: 'test/widget_test.dart', fullName: '', line: null, status: 'passed' as const, output: '', children: [
      { key: 'test/widget_test.dart::Counter increments', name: 'Counter increments', kind: 'test' as const, file: 'test/widget_test.dart', fullName: 'Counter increments', line: 14, status: 'passed' as const, output: '', children: [] }] }] } }) }, persisted: { plugin: { tab: 'tests' } } },
  dartPackage: { requests: { 'tools.snapshot': () => ({ ...ready, projects: [{ ...ready.projects[0], kind: 'dart' as const }] }) } }
})
