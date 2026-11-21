import type { OrcaWorkerApi } from 'orca/worker'
import { existsSync } from 'node:fs'
import { mkdir, readFile } from 'node:fs/promises'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { FlutterSession } from './flutter-session.ts'
import { capture, ManagedProcess, parseEmulators, parseToolJson, tail, type Command } from './process.ts'
import { discoverProjects, installedImages, isFvmSdk, projectAt, resolveTools, sessionKey, validateRunOptions, type ToolSettings } from './projects.ts'
import { releaseChecks } from './release.ts'
import { findTestFiles, lcovPercent, TestTree } from './tests.ts'
import { parseOutdated, pubArgs, type PubAction } from './pub.ts'
import { attachArgs, buildArgs, checkOptions, coerceBuild, coerceOptions, display, runArgs } from './args.ts'
import { branchName, defaultToggles, emptySnapshot, isLocal, taskActions, type AndroidImage, type BrightnessOverride, type BuildOptions, type DebugToggle, type DumpKind, type PlatformOverride, platformOverrides, brightnessOverrides, dumpKinds, type Device, type Emulator, type Job, type PackageInfo, type ReleaseCheck, type Project, type RunOptions, type Selection, type Session, type Snapshot, type TaskAction, type WidgetNode, type Workspace } from './types.ts'

interface DeviceCache { devices: Device[]; emulators: Emulator[]; images: AndroidImage[]; sdkVersion: string; notice: string }
const active = (session: Session) => ['starting', 'running', 'stopping'].includes(session.status)

export class FlutterTools {
  private sessions = new Map<string, FlutterSession>()
  private jobs: Job[] = []
  private processes = new Map<string, ManagedProcess>()
  private options = new Map<string, RunOptions>()
  private projectCache = new Map<string, { at: number; projects: Project[] }>()
  private releaseCache = new Map<string, { at: number; checks: ReleaseCheck[] }>()
  /** Per project path: its test tree, the run in progress and the last coverage figure. */
  private testRuns = new Map<string, { tree: TestTree; listedAt: number; process: ManagedProcess | null; coverage: number | null; startedAt: number | null; finishedAt: number | null }>()
  /** Per project path: the last `pub outdated` result. */
  private packageCache = new Map<string, { packages: PackageInfo[] | null; status: 'idle' | 'checking' | 'failed'; message: string }>()
  private devices = new Map<string, DeviceCache>()
  private pending = new Set<string>()
  private timer?: ReturnType<typeof setTimeout>
  private disposed = false
  private starting = new Set<string>()
  private reservedDevices = new Set<string>()
  private lastSelection: Selection | null = null

  constructor(private orca: OrcaWorkerApi) {}

  private changed(workspaceId: string): void {
    if (this.disposed) return
    this.pending.add(workspaceId)
    if (this.timer) return
    this.timer = setTimeout(() => {
      this.timer = undefined
      for (const workspaceId of this.pending) this.orca.panels.post('tools.changed', { workspaceId })
      this.pending.clear()
      const count = [...this.sessions.values()].filter(session => active(session.state)).length
      void this.orca.host.call('statusBar.update', { id: 'flutter', text: count ? `Flutter · ${count} running` : 'Flutter & Dart', tone: count ? 'success' : 'neutral' }).catch(() => {})
    }, 300)
  }

  private async workspaces(): Promise<Workspace[]> {
    // includeStatus is host API 1.7; older hosts may refuse the parameter.
    const result = await this.orca.host.call('workspace.list', { includeStatus: true }).catch(() => this.orca.host.call('workspace.list'))
    return result.workspaces.map(({ id, name, path, branch, hostId, project, status }) => ({ id, name, path, branch: branchName(branch) || null, hostId, project: project ?? null, lastActivityAt: status?.lastActivityAt ?? null }))
  }

  /**
   * The workspace Orca has focused: by id (host API 1.7+), else by name and branch, else the only
   * local workspace. Null when it cannot be told apart, so the panel asks instead of guessing.
   */
  private async focused(workspaces: Workspace[]): Promise<Workspace | undefined> {
    const local = workspaces.filter(isLocal)
    const context = await this.orca.host.call('workspace.readContext').catch(() => null)
    if (context?.workspaceId) {
      const byId = local.find(workspace => workspace.id === context.workspaceId || workspace.id.endsWith(`::${context.workspaceId}`))
      if (byId) return byId
    }
    if (context) {
      const byName = local.filter(workspace => workspace.name === context.displayName && (workspace.branch ?? '') === branchName(context.branch))
      if (byName.length === 1) return byName[0]
      const byBranch = context.branch ? local.filter(workspace => workspace.branch === branchName(context.branch)) : []
      if (byBranch.length === 1) return byBranch[0]
    }
    return local.length === 1 ? local[0] : undefined
  }

  private async selected(input: Selection): Promise<{ workspace: Workspace; project: Project }> {
    if (!input || typeof input.workspaceId !== 'string' || typeof input.projectPath !== 'string') throw new Error('Select a workspace and a Dart or Flutter project first.')
    const workspace = (await this.workspaces()).find(workspace => workspace.id === input.workspaceId)
    if (!workspace) throw new Error('This workspace is no longer available. Refresh the project list.')
    return { workspace, project: await projectAt(workspace, input.projectPath) }
  }

  private async settings(): Promise<ToolSettings> {
    const settings = (await this.orca.host.call('settings.get')).settings
    return {
      flutterExecutable: typeof settings.flutterExecutable === 'string' ? settings.flutterExecutable : '',
      dartExecutable: typeof settings.dartExecutable === 'string' ? settings.dartExecutable : '',
      androidSdkPath: typeof settings.androidSdkPath === 'string' ? settings.androidSdkPath : ''
    }
  }

  // Storage keys are per workspace + package, so every worktree keeps its own run settings.
  private async savedOptions(selection: Selection): Promise<RunOptions> {
    const key = sessionKey(selection.workspaceId, selection.projectPath)
    const cached = this.options.get(key)
    if (cached) return { ...cached }
    const options = coerceOptions(await this.orca.storage.get(`run:${key}`))
    this.options.set(key, options)
    return { ...options }
  }

  private async savedConfigs(selection: Selection): Promise<Record<string, RunOptions>> {
    const stored = await this.orca.storage.get(`configs:${sessionKey(selection.workspaceId, selection.projectPath)}`)
    const configs: Record<string, RunOptions> = {}
    if (stored && typeof stored === 'object' && !Array.isArray(stored)) for (const [name, value] of Object.entries(stored)) configs[name] = coerceOptions(value)
    return configs
  }

  private async savedBuild(selection: Selection): Promise<BuildOptions> {
    return coerceBuild(await this.orca.storage.get(`build:${sessionKey(selection.workspaceId, selection.projectPath)}`))
  }

  async snapshot(input: { workspaceId?: string; projectPath?: string } = {}): Promise<Snapshot> {
    const snapshot = emptySnapshot()
    snapshot.workspaces = await this.workspaces()
    const workspace = input.workspaceId ? snapshot.workspaces.find(workspace => workspace.id === input.workspaceId) : await this.focused(snapshot.workspaces)
    if (!workspace) { snapshot.notice = 'Choose the workspace containing your Dart or Flutter project.'; return snapshot }
    if (!isLocal(workspace)) { snapshot.notice = 'This version supports local workspaces. Open a local checkout for Flutter tools.'; return snapshot }
    const cached = this.projectCache.get(workspace.id)
    if (cached && Date.now() - cached.at < 60_000) snapshot.projects = cached.projects
    else {
      snapshot.projects = await discoverProjects(workspace)
      this.projectCache.set(workspace.id, { at: Date.now(), projects: snapshot.projects })
    }
    const savedPath = await this.orca.storage.get(`project:${workspace.id}`)
    const project = snapshot.projects.find(project => project.relativePath === (input.projectPath ?? savedPath)) ?? snapshot.projects[0]
    if (!project) {
      snapshot.notice = 'No Dart or Flutter project in this workspace yet (searched six levels deep, skipping hidden and build folders).'
      snapshot.creatable = { workspaceId: workspace.id, empty: !existsSync(path.join(workspace.path, 'pubspec.yaml')) }
      snapshot.jobs = this.jobs.filter(job => job.workspaceId === workspace.id).map(job => ({ ...job }))
      return snapshot
    }
    snapshot.selection = { workspaceId: workspace.id, projectPath: project.relativePath }
    this.lastSelection = snapshot.selection
    if (savedPath !== project.relativePath) await this.orca.storage.set(`project:${workspace.id}`, project.relativePath)
    snapshot.options = await this.savedOptions(snapshot.selection)
    snapshot.configs = await this.savedConfigs(snapshot.selection)
    snapshot.build = await this.savedBuild(snapshot.selection)
    const tools = resolveTools(project, workspace, await this.settings())
    if (project.kind === 'flutter') {
      const cachedRelease = this.releaseCache.get(project.path)
      if (cachedRelease && Date.now() - cachedRelease.at < 15_000) snapshot.release = cachedRelease.checks
      else { snapshot.release = await releaseChecks(project.path); this.releaseCache.set(project.path, { at: Date.now(), checks: snapshot.release }) }
    }
    snapshot.tests = await this.testSnapshot(project)
    const pub = this.packageCache.get(project.path)
    if (pub) { snapshot.packages = pub.packages; snapshot.packagesStatus = pub.status; snapshot.packagesMessage = pub.message }
    snapshot.sdkFvm = isFvmSdk(tools.flutter)
    const deviceCache = this.devices.get(tools.flutter)
    if (deviceCache) Object.assign(snapshot, deviceCache)
    else snapshot.notice = 'Refresh devices to discover connected devices, emulators and your Flutter SDK.'
    snapshot.sessions = [...this.sessions.values()].filter(session => session.state.workspaceId === workspace.id).map(session => ({ ...session.state }))
    snapshot.jobs = this.jobs.filter(job => job.workspaceId === workspace.id && job.projectPath === project.relativePath).map(job => ({ ...job }))
    return snapshot
  }

  async saveOptions(selection: Selection, options: RunOptions): Promise<void> {
    await this.selected(selection)
    const value = coerceOptions(options)
    checkOptions(value)
    const key = sessionKey(selection.workspaceId, selection.projectPath)
    await this.orca.storage.set(`run:${key}`, value)
    this.options.set(key, value)
  }

  /** Save (options set) or delete (options null) a named run configuration. */
  async saveConfig(selection: Selection, name: string, options: RunOptions | null): Promise<void> {
    await this.selected(selection)
    if (typeof name !== 'string' || !/^[\w .()-]{1,60}$/.test(name.trim())) throw new Error('Name configurations with up to 60 letters, numbers, spaces, dots, dashes or brackets.')
    const configs = await this.savedConfigs(selection)
    if (options === null) delete configs[name.trim()]
    else {
      const value = coerceOptions(options)
      checkOptions(value)
      if (!(name.trim() in configs) && Object.keys(configs).length >= 30) throw new Error('Delete a configuration first (30 maximum).')
      configs[name.trim()] = value
      await this.saveOptions(selection, value)
    }
    await this.orca.storage.set(`configs:${sessionKey(selection.workspaceId, selection.projectPath)}`, configs)
  }

  async refresh(selection: Selection, signal?: AbortSignal): Promise<Snapshot> {
    const { workspace, project } = await this.selected(selection)
    this.projectCache.delete(workspace.id)
    const tools = resolveTools(project, workspace, await this.settings())
    const cache: DeviceCache = { devices: [], emulators: [], images: await installedImages(tools.androidSdk), sdkVersion: '', notice: '' }
    const notices: string[] = []
    for (const command of ['devices', 'emulators', '--version'] as const) {
      try {
        // `emulators` has no --machine mode on current Flutter; it is parsed as text.
        const result = await capture({ executable: tools.flutter, args: command === 'emulators' ? ['emulators'] : [command, '--machine'], cwd: project.path }, { signal, timeoutMs: 35_000 })
        if (result.code !== 0) throw new Error(tail('', result.stderr || result.stdout, 1500).trim() || `Flutter ${command} failed.`)
        if (command === 'emulators') { cache.emulators = parseEmulators(result.stdout); continue }
        const parsed = parseToolJson(result.stdout)
        if (command === 'devices' && Array.isArray(parsed)) cache.devices = parsed.flatMap(value => {
          if (!value || typeof value !== 'object' || typeof value.id !== 'string' || typeof value.name !== 'string' || value.isSupported === false) return []
          return [{ id: value.id, name: value.name, platform: String(value.targetPlatform ?? ''), emulator: value.emulator === true }]
        })
        if (command === '--version' && parsed && typeof parsed === 'object' && 'frameworkVersion' in parsed) cache.sdkVersion = `Flutter ${parsed.frameworkVersion}`
      } catch (error) {
        if (signal?.aborted) throw error
        notices.push((error as Error).message)
        if ((error as Error).message.includes('Executable not found')) break
      }
    }
    cache.notice = [...new Set(notices)].join('\n')
    this.devices.set(tools.flutter, cache)
    this.changed(workspace.id)
    return this.snapshot(selection)
  }

  async run(selection: Selection, options: RunOptions, launch: 'run' | 'attach' = 'run'): Promise<void> {
    const key = sessionKey(selection.workspaceId, selection.projectPath)
    if (this.starting.has(key) || (this.sessions.has(key) && active(this.sessions.get(key)!.state))) throw new Error('This project already has a running app. Stop it before starting another.')
    if ([...this.sessions.values()].filter(session => active(session.state)).length >= 6) throw new Error('Stop an app before starting another session (six sessions maximum).')
    this.starting.add(key)
    let reservedDevice: string | undefined
    try {
      const { workspace, project } = await this.selected(selection)
      if (project.kind !== 'flutter') throw new Error('Run controls require a Flutter project. Analyze, format and tests also work with Dart packages.')
      const valid = await validateRunOptions(project, coerceOptions(options))
      const tools = resolveTools(project, workspace, await this.settings())
      const known = this.devices.get(tools.flutter)?.devices ?? []
      if (!known.some(device => device.id === valid.deviceId)) throw new Error('Refresh devices and select a connected device before running.')
      if (this.reservedDevices.has(valid.deviceId) || [...this.sessions.values()].some(session => active(session.state) && session.state.deviceId === valid.deviceId)) throw new Error('This device is already in use by another plugin session. Stop that app or select another device.')
      reservedDevice = valid.deviceId
      this.reservedDevices.add(reservedDevice)
      await this.saveOptions(selection, valid)
      const args = launch === 'attach' ? attachArgs(valid) : runArgs(valid)
      const mode = launch === 'attach' ? 'debug' : valid.mode
      const state: Session = { key, ...selection, projectName: project.name, deviceId: valid.deviceId, mode, launch, status: 'starting', appId: null, devToolsUrl: null, inspectable: false, toggles: { ...defaultToggles }, platform: 'default', brightness: 'default', message: launch === 'attach' ? 'Waiting for the app on the device…' : 'Starting Flutter…', logs: `$ ${display(args)}\n` }
      this.sessions.set(key, new FlutterSession({ executable: tools.flutter, args, cwd: project.path }, state, () => this.changed(workspace.id)))
      this.changed(workspace.id)
    } finally { this.starting.delete(key); if (reservedDevice) this.reservedDevices.delete(reservedDevice) }
  }

  async control(selection: Selection, action: 'reload' | 'restart' | 'stop'): Promise<void> {
    if (!['reload', 'restart', 'stop'].includes(action)) throw new Error('Unknown app control.')
    const session = this.runningSession(selection)
    if (action !== 'stop' && session.state.mode !== 'debug') throw new Error('Hot reload and hot restart need debug mode.')
    await session.control(action)
  }

  private startJob(selection: Selection, title: string, command: Command, stdin?: string, onDone?: (passed: boolean) => void): void {
    if (this.processes.size >= 6) throw new Error('Wait for a running task to finish (six tasks maximum).')
    if (this.jobs.some(job => job.workspaceId === selection.workspaceId && job.projectPath === selection.projectPath && job.status === 'running')) throw new Error('A task is already running for this project. Wait for it or cancel it first.')
    const job: Job = { id: randomUUID(), ...selection, title, status: 'running', output: `${title}\n`, code: null, startedAt: Date.now(), finishedAt: null }
    this.jobs = [...this.jobs.filter(item => item.status === 'running'), ...this.jobs.filter(item => item.status !== 'running').slice(-10), job]
    let child: ManagedProcess
    try {
      child = new ManagedProcess(command, chunk => { job.output = tail(job.output, chunk); this.changed(selection.workspaceId) })
    } catch (error) { job.status = 'failed'; job.finishedAt = Date.now(); job.output += (error as Error).message; this.changed(selection.workspaceId); throw error }
    this.processes.set(job.id, child)
    child.child.stdin.on('error', () => child.stop())
    if (stdin) child.write(stdin)
    else child.child.stdin.end()
    const timeout = setTimeout(() => { job.output = tail(job.output, '\nTask exceeded 15 minutes and was stopped.\n'); child.stop() }, 15 * 60_000)
    void child.done.then(result => {
      job.code = result.code
      if (job.status !== 'cancelled') job.status = result.code === 0 ? 'passed' : 'failed'
      onDone?.(job.status === 'passed')
    }, error => {
      job.status = 'failed'
      job.output = tail(job.output, `\n${error.message}\nCheck executable paths in the plugin settings.\n`)
    }).finally(() => { job.finishedAt = Date.now(); clearTimeout(timeout); this.processes.delete(job.id); this.changed(selection.workspaceId) })
    this.changed(selection.workspaceId)
  }

  async task(selection: Selection, action: TaskAction): Promise<void> {
    const { workspace, project } = await this.selected(selection)
    const tools = resolveTools(project, workspace, await this.settings())
    const flutter = project.kind === 'flutter'
    const sdk = flutter ? tools.flutter : tools.dart
    const actions: Record<TaskAction, { executable: string; args: string[]; title: string; flutterOnly?: true }> = {
      analyze: { executable: sdk, args: ['analyze'], title: 'Analyze' },
      test: { executable: sdk, args: ['test'], title: 'Run tests' },
      'test-coverage': { executable: sdk, args: flutter ? ['test', '--coverage'] : ['test', '--coverage=coverage'], title: 'Tests with coverage' },
      format: { executable: tools.dart, args: ['format', '.'], title: 'Format Dart files' },
      fix: { executable: tools.dart, args: ['fix', '--apply'], title: 'Apply Dart fixes' },
      'pub-get': { executable: sdk, args: ['pub', 'get'], title: 'Get dependencies' },
      'pub-upgrade': { executable: sdk, args: ['pub', 'upgrade'], title: 'Upgrade dependencies' },
      'pub-outdated': { executable: sdk, args: ['pub', 'outdated'], title: 'Outdated dependencies' },
      codegen: { executable: tools.dart, args: ['run', 'build_runner', 'build', '--delete-conflicting-outputs'], title: 'Generate code' },
      'gen-l10n': { executable: tools.flutter, args: ['gen-l10n'], title: 'Generate localizations', flutterOnly: true },
      clean: { executable: tools.flutter, args: ['clean'], title: 'Clean build outputs', flutterOnly: true },
      doctor: { executable: tools.flutter, args: ['doctor', '-v'], title: 'Flutter Doctor' },
      'sdk-check': { executable: tools.flutter, args: ['upgrade', '--verify-only'], title: 'Check Flutter version' },
      'sdk-upgrade': { executable: tools.flutter, args: ['upgrade'], title: 'Upgrade Flutter' }
    }
    if (!taskActions.includes(action)) throw new Error('Unknown project task.')
    const { flutterOnly, ...command } = actions[action]
    if (flutterOnly && !flutter) throw new Error(`${command.title} needs a Flutter project.`)
    if (action === 'sdk-upgrade' || action === 'sdk-check') {
      if (isFvmSdk(tools.flutter)) throw new Error('This project’s Flutter SDK is managed by FVM. Change its version with `fvm use <version>` (or `fvm use stable`), then refresh.')
    }
    if (action === 'sdk-upgrade' && [...this.sessions.values()].some(session => active(session.state))) throw new Error('Stop running apps before upgrading Flutter; the upgrade replaces the SDK they run on.')
    // After an upgrade the cached version and devices are stale.
    const onDone = action === 'sdk-upgrade' ? (passed: boolean) => { if (passed) { this.devices.delete(tools.flutter); this.changed(workspace.id) } } : undefined
    this.startJob(selection, `${command.title}  ·  ${[path.basename(command.executable), ...command.args].join(' ')}`, { ...command, cwd: project.path }, undefined, onDone)
  }

  /** `flutter build <platform>` with the selected run configuration's entrypoint, flavor and defines. */
  async build(selection: Selection, build: BuildOptions, options: RunOptions): Promise<void> {
    const { workspace, project } = await this.selected(selection)
    if (project.kind !== 'flutter') throw new Error('Builds need a Flutter project.')
    const settings = coerceBuild(build)
    if (settings.extraArgs.length > 4000) throw new Error('Extra build arguments are limited to 4000 characters.')
    const valid = await validateRunOptions(project, coerceOptions(options), false)
    const args = buildArgs(settings, valid)
    await this.orca.storage.set(`build:${sessionKey(selection.workspaceId, selection.projectPath)}`, settings)
    const tools = resolveTools(project, workspace, await this.settings())
    this.startJob(selection, `Build ${settings.platform} (${settings.mode})  ·  ${display(args)}`, { executable: tools.flutter, args, cwd: project.path })
  }

  async runBuild(selection: Selection): Promise<void> { await this.build(selection, await this.savedBuild(selection), await this.savedOptions(selection)) }

  private runningSession(selection: Selection): FlutterSession {
    const session = this.sessions.get(sessionKey(selection.workspaceId, selection.projectPath))
    if (!session || !active(session.state)) throw new Error('No app is running for this project.')
    return session
  }

  async widgetTree(selection: Selection): Promise<WidgetNode | null> {
    const { workspace } = await this.selected(selection)
    return this.runningSession(selection).widgetTree(workspace.path)
  }

  async override(selection: Selection, kind: 'platform' | 'brightness', value: string): Promise<void> {
    const session = this.runningSession(selection)
    if (kind === 'platform' && platformOverrides.includes(value as PlatformOverride)) return session.platform(value as PlatformOverride)
    if (kind === 'brightness' && brightnessOverrides.includes(value as BrightnessOverride)) return session.brightness(value as BrightnessOverride)
    throw new Error('Unknown override.')
  }

  async dump(selection: Selection, kind: DumpKind): Promise<string> {
    if (!dumpKinds.includes(kind)) throw new Error('Unknown dump.')
    return this.runningSession(selection).dump(kind)
  }

  /**
   * `flutter screenshot` of the run target into build/screenshots/ (Flutter's build/ is gitignored),
   * then opened in Orca. Phones, emulators and simulators only: desktop and web have no device capture.
   */
  async screenshot(selection: Selection): Promise<void> {
    const { workspace, project } = await this.selected(selection)
    const session = this.runningSession(selection)
    const tools = resolveTools(project, workspace, await this.settings())
    const device = this.devices.get(tools.flutter)?.devices.find(item => item.id === session.state.deviceId)
    if (device && /^(web|linux|windows|darwin|macos)/.test(device.platform)) throw new Error('Screenshots work on phones, emulators and simulators. For desktop or web, use your system screenshot tool.')
    const name = `screenshot-${new Date().toISOString().replace(/[:.]/g, '-')}.png`
    const relative = path.join('build', 'screenshots', name)
    await mkdir(path.join(project.path, 'build', 'screenshots'), { recursive: true })
    const toWorkspace = path.relative(workspace.path, path.join(project.path, relative)).split(path.sep).join('/')
    this.startJob(selection, `Screenshot  ·  flutter screenshot -d ${session.state.deviceId} -o ${relative}`, { executable: tools.flutter, args: ['screenshot', '-d', session.state.deviceId, '-o', relative], cwd: project.path }, undefined,
      passed => { if (passed) void this.orca.host.call('editor.open', { workspaceId: workspace.id, path: toWorkspace }).catch(() => {}) })
  }

  /**
   * Set the GPS position of an emulator: Android emulators via `adb emu geo fix` (longitude first),
   * iOS simulators via `xcrun simctl location` (macOS). Physical devices cannot be moved this way.
   */
  async setLocation(selection: Selection, deviceId: string, latitude: number, longitude: number): Promise<void> {
    const { workspace, project } = await this.selected(selection)
    if (!Number.isFinite(latitude) || !Number.isFinite(longitude) || Math.abs(latitude) > 90 || Math.abs(longitude) > 180) throw new Error('Latitude must be between -90 and 90, longitude between -180 and 180.')
    const tools = resolveTools(project, workspace, await this.settings())
    const device = this.devices.get(tools.flutter)?.devices.find(item => item.id === deviceId)
    if (!device) throw new Error('Refresh devices and choose a connected emulator or simulator.')
    let command: Command
    if (device.platform.startsWith('android') && /^emulator-\d+$/.test(device.id)) {
      const adb = tools.androidSdk ? path.join(tools.androidSdk, 'platform-tools', process.platform === 'win32' ? 'adb.exe' : 'adb') : 'adb'
      command = { executable: existsSync(adb) ? adb : 'adb', args: ['-s', device.id, 'emu', 'geo', 'fix', String(longitude), String(latitude)], cwd: project.path }
    } else if (device.platform === 'ios' && device.emulator && process.platform === 'darwin') {
      command = { executable: 'xcrun', args: ['simctl', 'location', device.id, 'set', `${latitude},${longitude}`], cwd: project.path }
    } else throw new Error('Location can be set on Android emulators and, on a Mac, iOS simulators. Physical devices use their real GPS.')
    const result = await capture(command, { timeoutMs: 15_000 })
    if (result.code !== 0 || /KO|error/i.test(result.stdout)) throw new Error(tail('', result.stderr || result.stdout, 600).trim() || 'Setting the location failed.')
  }

  /** `flutter create` (or `dart create`) into a new folder of the workspace, then selects it. */
  async createProject(workspaceId: string, input: { name: string; org: string; template: string; platforms: string[]; here: boolean }): Promise<void> {
    const workspace = (await this.workspaces()).find(item => item.id === workspaceId)
    if (!workspace || !isLocal(workspace)) throw new Error('Choose a local workspace to create the project in.')
    const { name, org, template, platforms, here } = input ?? ({} as never)
    if (typeof name !== 'string' || !/^[a-z][a-z0-9_]{0,63}$/.test(name)) throw new Error('Project names use lowercase letters, digits and underscores, starting with a letter (e.g. my_app).')
    if (typeof org !== 'string' || !/^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)+$/.test(org)) throw new Error('Organization is a reverse domain such as com.example.')
    if (!['app', 'package', 'plugin', 'module', 'skeleton'].includes(template)) throw new Error('Unknown project template.')
    const allowed = ['android', 'ios', 'web', 'linux', 'macos', 'windows']
    if (!Array.isArray(platforms) || !platforms.every(item => allowed.includes(item))) throw new Error('Unknown platform.')
    const target = here ? '.' : name
    if (!here && existsSync(path.join(workspace.path, name))) throw new Error(`A folder named ${name} already exists in this workspace.`)
    if (here && existsSync(path.join(workspace.path, 'pubspec.yaml'))) throw new Error('This workspace already has a pubspec.yaml at its root.')
    const placeholder: Project = { path: workspace.path, relativePath: target, name, kind: 'flutter', app: false }
    const tools = resolveTools(placeholder, workspace, await this.settings())
    const args = ['create', '--project-name', name, '--org', org, '--template', template, ...(platforms.length && ['app', 'plugin'].includes(template) ? ['--platforms', platforms.join(',')] : []), target]
    const selection = { workspaceId, projectPath: target }
    this.startJob(selection, `Create project  ·  flutter ${args.join(' ')}`, { executable: tools.flutter, args, cwd: workspace.path }, undefined, passed => {
      if (!passed) return
      this.projectCache.delete(workspaceId)
      void this.orca.storage.set(`project:${workspaceId}`, target).catch(() => {}).finally(() => this.changed(workspaceId))
    })
  }

  async toggle(selection: Selection, toggle: DebugToggle, enabled: boolean): Promise<void> {
    if (!Object.hasOwn(defaultToggles, toggle) || typeof enabled !== 'boolean') throw new Error('Unknown debug option.')
    await this.runningSession(selection).toggle(toggle, enabled)
  }

  /** Open a widget's source in Orca's editor. Paths come from the inspector, re-checked here. */
  async openSource(selection: Selection, file: string): Promise<void> {
    const { workspace } = await this.selected(selection)
    if (typeof file !== 'string' || path.isAbsolute(file) || file.split('/').includes('..') || !file.endsWith('.dart')) throw new Error('Only Dart files inside this workspace can be opened.')
    await this.orca.host.call('editor.open', { workspaceId: workspace.id, path: file })
  }

  /** Run `pub outdated --json` in the background; the result arrives through tools.changed. */
  async checkPackages(selection: Selection): Promise<void> {
    const { workspace, project } = await this.selected(selection)
    if (this.packageCache.get(project.path)?.status === 'checking') return
    const tools = resolveTools(project, workspace, await this.settings())
    const entry = { packages: this.packageCache.get(project.path)?.packages ?? null, status: 'checking' as const, message: '' }
    this.packageCache.set(project.path, entry)
    this.changed(workspace.id)
    const executable = project.kind === 'flutter' ? tools.flutter : tools.dart
    void capture({ executable, args: ['pub', 'outdated', '--json', '--show-all'], cwd: project.path }, { timeoutMs: 180_000 })
      .then(result => {
        if (result.code !== 0) throw new Error(tail('', result.stderr || result.stdout, 1500).trim() || 'pub outdated failed. Run pub get first.')
        this.packageCache.set(project.path, { packages: parseOutdated(parseToolJson(result.stdout)), status: 'idle', message: '' })
      })
      .catch(error => this.packageCache.set(project.path, { packages: entry.packages, status: 'failed', message: (error as Error).message }))
      .finally(() => this.changed(workspace.id))
  }

  /** pub add / remove / upgrade as a task; re-checks packages when it succeeds. */
  async pub(selection: Selection, action: PubAction, name: string, dev: boolean): Promise<void> {
    const { workspace, project } = await this.selected(selection)
    if (!['add', 'remove', 'upgrade', 'upgrade-major', 'latest'].includes(action) || typeof name !== 'string') throw new Error('Unknown package action.')
    const latest = this.packageCache.get(project.path)?.packages?.find(pkg => pkg.name === name.trim().toLowerCase())?.latest ?? null
    const args = ['pub', ...pubArgs(action, name.trim().toLowerCase(), { dev, version: latest })]
    const tools = resolveTools(project, workspace, await this.settings())
    const executable = project.kind === 'flutter' ? tools.flutter : tools.dart
    this.startJob(selection, `Packages  ·  ${[path.basename(executable), ...args].join(' ')}`, { executable, args, cwd: project.path }, undefined, passed => { if (passed) void this.checkPackages(selection).catch(() => {}) })
  }

  async openPubspec(selection: Selection): Promise<void> {
    const { workspace, project } = await this.selected(selection)
    const file = project.relativePath === '.' ? 'pubspec.yaml' : `${project.relativePath}/pubspec.yaml`
    await this.orca.host.call('editor.open', { workspaceId: workspace.id, path: file })
  }

  private async testRun(project: Project) {
    let run = this.testRuns.get(project.path)
    if (!run) { run = { tree: new TestTree(project.path), listedAt: 0, process: null, coverage: null, startedAt: null, finishedAt: null }; this.testRuns.set(project.path, run) }
    // Re-list files now and then (cheap readdir), never during a run.
    if (!run.process && Date.now() - run.listedAt > 10_000) { run.tree.setFiles(await findTestFiles(project.path)); run.listedAt = Date.now() }
    return run
  }

  private async testSnapshot(project: Project): Promise<Snapshot['tests']> {
    const run = await this.testRun(project)
    return { tree: run.tree.snapshot(), counts: run.tree.counts(), running: !!run.process, log: run.tree.log, coverage: run.coverage, startedAt: run.startedAt, finishedAt: run.finishedAt }
  }

  /**
   * Runs tests and streams results into the tree. `keys` empty = everything under test/; one key = that
   * file, group or test; `failed` = the failed tests only. `--plain-name` filters across all files given,
   * so a scope is either whole files or named tests, never both.
   */
  async runTests(selection: Selection, scope: { keys: string[]; failed?: boolean; coverage?: boolean }): Promise<void> {
    const { workspace, project } = await this.selected(selection)
    const run = await this.testRun(project)
    if (run.process) throw new Error('Tests are already running for this package.')
    const keys = Array.isArray(scope?.keys) ? scope.keys.filter(key => typeof key === 'string') : []
    const nodes = scope.failed ? run.tree.failed() : keys.map(key => run.tree.nodes.get(key))
    if (nodes.some(node => !node)) throw new Error('That test is no longer listed. Refresh the test list.')
    if (scope.failed && !nodes.length) throw new Error('No failed tests to run again.')
    const files = [...new Set(nodes.map(node => node!.file))]
    const names = nodes.filter(node => node!.kind !== 'file').map(node => node!.fullName)
    if (names.length && nodes.some(node => node!.kind === 'file')) throw new Error('Run either whole files or named tests, not both.')
    const tools = resolveTools(project, workspace, await this.settings())
    const flutter = project.kind === 'flutter'
    const args = [...(flutter ? ['test', '--machine'] : ['test', '--reporter', 'json'])]
    if (scope.coverage) args.push(flutter ? '--coverage' : '--coverage=coverage')
    if (files.some(file => file.startsWith('integration_test/'))) {
      const { deviceId } = await this.savedOptions(selection)
      if (!deviceId) throw new Error('Integration tests run on a device. Choose one in the Run tab first.')
      args.push('-d', deviceId)
    }
    for (const name of names) args.push('--plain-name', name)
    args.push(...files)
    run.tree.start(nodes.length ? nodes.map(node => node!.key) : [])
    run.tree.addLog(`$ ${[path.basename(flutter ? tools.flutter : tools.dart), ...args].join(' ')}\n`)
    run.startedAt = Date.now(); run.finishedAt = null
    let buffer = ''
    const child = new ManagedProcess({ executable: flutter ? tools.flutter : tools.dart, args, cwd: project.path }, (chunk, stderr) => {
      if (stderr) { run.tree.addLog(chunk); this.changed(workspace.id); return }
      buffer += chunk
      let newline
      while ((newline = buffer.indexOf('\n')) !== -1) {
        const line = buffer.slice(0, newline).trim()
        buffer = buffer.slice(newline + 1)
        if (line.startsWith('{')) { try { run.tree.apply(JSON.parse(line)) } catch { run.tree.addLog(`${line}\n`) } }
        else if (line && !line.startsWith('[{')) run.tree.addLog(`${line}\n`) // [{…}] lines are daemon chatter
      }
      this.changed(workspace.id)
    })
    run.process = child
    child.child.stdin.end()
    void child.done.catch(error => { run.tree.addLog(`${(error as Error).message}\nCheck the SDK paths in the plugin settings.\n`) }).finally(async () => {
      run.tree.finish(); run.process = null; run.finishedAt = Date.now()
      if (scope.coverage) run.coverage = lcovPercent(await readFile(path.join(project.path, 'coverage', 'lcov.info'), 'utf8').catch(() => ''))
      this.changed(workspace.id)
    })
    this.changed(workspace.id)
  }

  async cancelTests(selection: Selection): Promise<void> {
    const { project } = await this.selected(selection)
    this.testRuns.get(project.path)?.process?.stop()
  }

  async openTest(selection: Selection, file: string): Promise<void> {
    const { workspace, project } = await this.selected(selection)
    if (typeof file !== 'string' || !file.endsWith('_test.dart') || path.isAbsolute(file) || file.split('/').includes('..')) throw new Error('Only test files in this package can be opened.')
    await this.orca.host.call('editor.open', { workspaceId: workspace.id, path: path.relative(workspace.path, path.join(project.path, file)).split(path.sep).join('/') })
  }

  async cancel(selection: Selection, jobId: string): Promise<void> {
    const job = this.jobs.find(job => job.id === jobId && job.workspaceId === selection.workspaceId && job.projectPath === selection.projectPath)
    if (!job || job.status !== 'running') throw new Error('This task is no longer running.')
    job.status = 'cancelled'
    this.processes.get(job.id)?.stop()
    this.changed(selection.workspaceId)
  }

  async launchEmulator(selection: Selection, emulatorId: string): Promise<void> {
    const { workspace, project } = await this.selected(selection)
    const tools = resolveTools(project, workspace, await this.settings())
    if (!this.devices.get(tools.flutter)?.emulators.some(emulator => emulator.id === emulatorId)) throw new Error('Refresh devices and select an available emulator.')
    this.startJob(selection, 'Launch emulator', { executable: tools.flutter, args: ['emulators', '--launch', emulatorId], cwd: project.path })
  }

  async createEmulator(selection: Selection, name: string, imageId: string): Promise<void> {
    if (typeof name !== 'string' || !/^[A-Za-z][A-Za-z0-9_-]{0,49}$/.test(name)) throw new Error('Emulator names must start with a letter and contain up to 50 letters, numbers, underscores or dashes.')
    const { workspace, project } = await this.selected(selection)
    const tools = resolveTools(project, workspace, await this.settings())
    const images = await installedImages(tools.androidSdk)
    if (!tools.androidSdk || !images.some(image => image.id === imageId)) throw new Error('Choose an installed Android system image. Install images and review SDK licenses in Android Studio first.')
    const suffix = process.platform === 'win32' ? '.bat' : ''
    const avdmanager = path.join(tools.androidSdk, 'cmdline-tools', 'latest', 'bin', `avdmanager${suffix}`)
    if (!existsSync(avdmanager)) throw new Error('Android command-line tools (latest) are missing. Install them with Android Studio SDK Manager.')
    // No --force, SDK downloads, sdkmanager --licenses, or SDK license acceptance.
    this.startJob(selection, `Create emulator ${name}`, { executable: avdmanager, args: ['create', 'avd', '--name', name, '--package', imageId], cwd: project.path }, 'no\n')
  }

  async paletteSelection(): Promise<Selection> {
    const workspace = await this.focused(await this.workspaces())
    if (!workspace) throw new Error('Focus a workspace with a Dart or Flutter project, or pick it in the Flutter & Dart panel.')
    const selected = this.lastSelection?.workspaceId === workspace.id ? this.lastSelection : (await this.snapshot({ workspaceId: workspace.id })).selection
    if (!selected) throw new Error('No Dart or Flutter project was found in the focused workspace.')
    return selected
  }

  async runSaved(selection: Selection, mode?: RunOptions['mode']): Promise<void> {
    const options = await this.savedOptions(selection)
    await this.run(selection, mode ? { ...options, mode } : options)
  }

  async attachSaved(selection: Selection): Promise<void> { await this.run(selection, await this.savedOptions(selection), 'attach') }

  /** Palette "next device": cycles the saved run target through connected devices. */
  async nextDevice(selection: Selection): Promise<string> {
    const { workspace, project } = await this.selected(selection)
    const devices = this.devices.get(resolveTools(project, workspace, await this.settings()).flutter)?.devices ?? []
    if (!devices.length) throw new Error('No devices known yet. Refresh devices first.')
    const options = await this.savedOptions(selection)
    const next = devices[(devices.findIndex(device => device.id === options.deviceId) + 1) % devices.length]
    await this.saveOptions(selection, { ...options, deviceId: next.id })
    this.changed(workspace.id)
    return next.name
  }

  removeWorkspace(workspaceId: string): void {
    for (const [key, session] of this.sessions) if (session.state.workspaceId === workspaceId) { session.dispose(); this.sessions.delete(key) }
    for (const job of this.jobs) if (job.workspaceId === workspaceId && job.status === 'running') { job.status = 'cancelled'; this.processes.get(job.id)?.stop() }
    this.projectCache.delete(workspaceId)
  }

  async dispose(): Promise<void> {
    this.disposed = true
    for (const run of this.testRuns.values()) run.process?.stop()
    clearTimeout(this.timer)
    for (const session of this.sessions.values()) session.dispose()
    for (const child of this.processes.values()) child.stop()
    await Promise.allSettled([...this.sessions.values()].map(session => session.process.done).concat([...this.processes.values()].map(child => child.done)))
  }
}
