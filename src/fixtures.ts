import { defaultOptions, defaultToggles, emptySnapshot, type Session, type Snapshot } from './types.ts'

/** Deterministic preview data. Never used by the running worker. */
export function previewSnapshot(): Snapshot {
  return {
    ...emptySnapshot(),
    workspaces: [{ id: 'preview', name: 'My Flutter app', path: '/preview', branch: 'feature/profile', hostId: 'local', project: 'my_flutter_app', lastActivityAt: null }],
    projects: [{ path: '/preview', relativePath: '.', name: 'my_flutter_app', kind: 'flutter', app: true }],
    selection: { workspaceId: 'preview', projectPath: '.' },
    options: { ...defaultOptions, deviceId: 'demo-emulator' },
    configs: { Staging: { ...defaultOptions, deviceId: 'demo-emulator', flavor: 'staging', dartDefines: 'API_URL=https://staging.example.com' } },
    sdkVersion: 'Flutter · local SDK',
    devices: [{ id: 'demo-emulator', name: 'Pixel emulator', platform: 'android-x64', emulator: true }],
    emulators: [{ id: 'flutter_dev', name: 'Flutter development', platform: 'android' }],
    images: [{ id: 'system-images;android-36;google_apis;x86_64', label: 'Android 36 · Google APIs · x86_64' }]
  }
}

export function runningSession(patch: Partial<Session> = {}): Session {
  return { key: 'preview', workspaceId: 'preview', projectPath: '.', projectName: 'my_flutter_app', deviceId: 'demo-emulator', mode: 'debug', status: 'running', appId: 'app-1', devToolsUrl: 'http://127.0.0.1:9100/?uri=ws://127.0.0.1:41000/ws', inspectable: true, toggles: { ...defaultToggles }, platform: 'default', brightness: 'default', launch: 'run', message: 'App running. Hot reload is ready.', logs: 'Launching lib/main.dart on Pixel emulator…\nFlutter is running.\n', ...patch }
}
