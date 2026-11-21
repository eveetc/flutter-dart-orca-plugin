// Shared between worker and panel. Plain data only: everything here crosses plugin.request.

export interface Workspace {
  id: string
  name: string
  path: string
  branch: string | null
  hostId: string | null
  /** Project (repository or folder) name, for grouping in the picker. */
  project: string | null
  lastActivityAt: number | null
}

/** `workspace.list` gives local rows `hostId: 'local'` (host API 1.7+) or null (older hosts, project-group folders). */
export const isLocal = (workspace: Pick<Workspace, 'hostId'>) => workspace.hostId === null || workspace.hostId === 'local'

/** Orca reports branches as refs/heads/x in some places and x in others. */
export const branchName = (branch: string | null | undefined) => (branch ?? '').replace(/^refs\/heads\//, '')

export interface Project {
  path: string
  relativePath: string
  name: string
  kind: 'flutter' | 'dart'
  /** Has lib/main.dart, so it can be run. */
  app: boolean
}

export interface Selection { workspaceId: string; projectPath: string }

export type BuildMode = 'debug' | 'profile' | 'release'
export const buildModes: readonly BuildMode[] = ['debug', 'profile', 'release']

/** One run configuration, like Android Studio's: everything `flutter run` needs besides the project. */
export type RunOptions = {
  deviceId: string
  target: string
  flavor: string
  mode: BuildMode
  /** One KEY=VALUE per line, passed as --dart-define. */
  dartDefines: string
  /** Optional JSON/.env file in the project, passed as --dart-define-from-file. */
  defineFile: string
  /** Extra flags split like a shell would (quotes respected), never run through a shell. */
  extraArgs: string
}

export const buildPlatforms = ['apk', 'appbundle', 'ipa', 'ios', 'web', 'linux', 'macos', 'windows'] as const
export type BuildPlatform = typeof buildPlatforms[number]
export type BuildOptions = { platform: BuildPlatform; mode: BuildMode; extraArgs: string }

export interface Device { id: string; name: string; platform: string; emulator: boolean }
export interface Emulator { id: string; name: string; platform: string }
export interface AndroidImage { id: string; label: string }

export type DebugToggle = 'inspector' | 'paint' | 'performance' | 'banner' | 'slowAnimations'
/** Overrides the running app's look, like DevTools and Android Studio's Flutter toolbar. */
export const platformOverrides = ['default', 'android', 'iOS', 'macOS', 'windows', 'linux', 'fuchsia'] as const
export type PlatformOverride = typeof platformOverrides[number]
export const brightnessOverrides = ['default', 'light', 'dark'] as const
export type BrightnessOverride = typeof brightnessOverrides[number]
export const dumpKinds = ['widgets', 'render', 'layers', 'semantics'] as const
export type DumpKind = typeof dumpKinds[number]

export const defaultToggles: Record<DebugToggle, boolean> = { inspector: false, paint: false, performance: false, banner: true, slowAnimations: false }

export interface Session {
  key: string
  workspaceId: string
  projectPath: string
  projectName: string
  deviceId: string
  mode: BuildMode
  status: 'starting' | 'running' | 'stopping' | 'stopped' | 'failed'
  appId: string | null
  devToolsUrl: string | null
  /** True once the VM service is known, so the widget inspector can connect. */
  inspectable: boolean
  toggles: Record<DebugToggle, boolean>
  platform: PlatformOverride
  brightness: BrightnessOverride
  /** How the session started: `run` launches the app, `attach` connects to one already running. */
  launch: 'run' | 'attach'
  message: string
  logs: string
}

export const taskActions = ['analyze', 'test', 'format', 'fix', 'pub-get', 'pub-upgrade', 'pub-outdated', 'codegen', 'gen-l10n', 'clean', 'doctor', 'sdk-check', 'sdk-upgrade', 'test-coverage'] as const
export type TaskAction = typeof taskActions[number]

export interface Job {
  id: string
  workspaceId: string
  projectPath: string
  title: string
  status: 'running' | 'passed' | 'failed' | 'cancelled'
  output: string
  code: number | null
  startedAt: number
  finishedAt: number | null
}

export interface WidgetNode {
  id: string
  label: string
  /** Workspace-relative source path, when the widget was created in this workspace. */
  file: string | null
  line: number | null
  children: WidgetNode[]
}


/** Static signing check per platform. `none`: the platform folder does not exist. */
export interface ReleaseCheck { platform: 'android' | 'ios'; level: 'ok' | 'warning' | 'error' | 'none'; messages: string[] }

export interface PackageInfo {
  name: string
  kind: 'direct' | 'dev'
  current: string | null
  upgradable: string | null
  resolvable: string | null
  latest: string | null
  discontinued: boolean
  advisory: boolean
}

export type TestStatus = 'idle' | 'running' | 'passed' | 'failed' | 'skipped'
export interface TestNode {
  key: string
  name: string
  kind: 'file' | 'group' | 'test'
  /** Project-relative test file. */
  file: string
  /** Full test or group name, as `--plain-name` matches it. Empty for files. */
  fullName: string
  line: number | null
  status: TestStatus
  /** Errors, stack traces and prints from the last run. */
  output: string
  children: TestNode[]
}
export interface TestRun {
  tree: TestNode[]
  counts: Record<TestStatus, number>
  running: boolean
  /** Output that belongs to no test, such as compile errors. */
  log: string
  coverage: number | null
  startedAt: number | null
  finishedAt: number | null
}

export interface Snapshot {
  workspaces: Workspace[]
  projects: Project[]
  selection: Selection | null
  options: RunOptions
  /** Saved run configurations for the selected project, by name. */
  configs: Record<string, RunOptions>
  build: BuildOptions
  devices: Device[]
  emulators: Emulator[]
  images: AndroidImage[]
  sessions: Session[]
  jobs: Job[]
  sdkVersion: string
  /** The SDK comes from FVM (.fvm/flutter_sdk or fvm/versions); its version is changed with `fvm use`. */
  sdkFvm: boolean
  notice: string
  /** Signing checks for the selected Flutter project. */
  release: ReleaseCheck[]
  /** Direct and dev dependencies from the last `pub outdated`; null until checked. */
  packages: PackageInfo[] | null
  packagesStatus: 'idle' | 'checking' | 'failed'
  packagesMessage: string
  /** Set when the chosen workspace has no project yet, so the panel can offer to create one. */
  creatable: { workspaceId: string; empty: boolean } | null
  /** Test overview for the selected package; null until listed. */
  tests: TestRun | null
}

export const defaultOptions: RunOptions = { deviceId: '', target: 'lib/main.dart', flavor: '', mode: 'debug', dartDefines: '', defineFile: '', extraArgs: '' }
export const defaultBuild: BuildOptions = { platform: 'apk', mode: 'release', extraArgs: '' }

export function emptySnapshot(): Snapshot {
  return { workspaces: [], projects: [], selection: null, options: { ...defaultOptions }, configs: {}, build: { ...defaultBuild }, devices: [], emulators: [], images: [], sessions: [], jobs: [], sdkVersion: '', sdkFvm: false, notice: '', release: [], packages: null, packagesStatus: 'idle', packagesMessage: '', creatable: null, tests: null }
}
