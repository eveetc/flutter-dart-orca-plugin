// Panel state and the actions every tab shares. Atoms with a name persist across panel reloads.
import { atom, plugin, read, set } from 'orca'
import '../protocol.ts'
import type { PubAction } from '../pub.ts'
import { defaultBuild, type DebugToggle, type DumpKind, defaultOptions, emptySnapshot, type BuildOptions, type RunOptions, type Selection, type Snapshot, type TaskAction, type WidgetNode } from '../types.ts'

export const snapshot = atom<Snapshot>(emptySnapshot())
/** Unsaved edits to the run configuration; reset only when the selected package changes. */
export const options = atom<RunOptions>({ ...defaultOptions })
export const build = atom<BuildOptions>({ ...defaultBuild })
export const workspaceId = atom('workspace', '')
export const tab = atom('tab', 'run', { persist: 'plugin' })
export const busy = atom('busy', '')
export const error = atom('error', '')
export const loading = atom(true)
export const configName = atom('configName', '')
export const emulatorId = atom('emulator', '')
export const emulatorName = atom('emulatorName', 'flutter_dev')
export const imageId = atom('image', '')
export const widgetRoot = atom<WidgetNode | null>(null)
export const widgetSelected = atom('')
export const confirmUpgrade = atom(false)
export const dumpKind = atom<DumpKind>('dumpKind', 'render')
export const dumpText = atom('')
export const testSelected = atom('testSelected', '')
export const locationDevice = atom('locationDevice', '')
export const latitude = atom('latitude', '47.3769')
export const longitude = atom('longitude', '8.5417')
export const create = atom('create', { name: 'my_app', org: 'com.example', template: 'app', platforms: ['android', 'ios'] as string[], here: false })
export const newPackage = atom('newPackage', '')
export const newPackageDev = atom('newPackageDev', false)
export const packageSelected = atom<string[]>([])

let signal: AbortSignal | undefined
let generation = 0
export const setSignal = (value: AbortSignal) => { signal = value }

export function applySnapshot(value: Snapshot): void {
  const previous = read(snapshot).selection
  if (!previous || previous.workspaceId !== value.selection?.workspaceId || previous.projectPath !== value.selection?.projectPath) {
    set(options, value.options); set(build, value.build); set(widgetRoot, null)
  }
  set(snapshot, value)
  if (value.selection) set(workspaceId, value.selection.workspaceId)
  if (!value.emulators.some(emulator => emulator.id === read(emulatorId))) set(emulatorId, value.emulators[0]?.id ?? '')
  if (!value.images.some(image => image.id === read(imageId))) set(imageId, value.images[0]?.id ?? '')
}

/** `follow`: a focus change. If Orca's focus cannot be resolved to a project, keep what is shown. */
export async function load(input: { workspaceId?: string; projectPath?: string } = {}, follow = false): Promise<void> {
  const current = ++generation
  try {
    const value = await plugin.request('tools.snapshot', input, { signal })
    if (follow && !value.selection && read(snapshot).selection) { set(loading, false); return }
    if (current === generation && !signal?.aborted) { applySnapshot(value); set(loading, false) }
  } catch (cause) {
    if (!signal?.aborted) { set(error, (cause as Error).message); set(loading, false) }
  }
}

export function selection(): Selection {
  const value = read(snapshot).selection
  if (!value) throw new Error('Select a project first.')
  return value
}

/** Run one action at a time, show its error, then reload the snapshot. */
export async function perform(label: string, action: () => Promise<unknown>): Promise<void> {
  if (read(busy)) return
  set(busy, label); set(error, '')
  const selected = read(snapshot).selection
  try { await action(); if (!signal?.aborted) await load(selected ?? {}) }
  catch (cause) { if (!signal?.aborted) set(error, (cause as Error).message) }
  finally { if (!signal?.aborted) set(busy, '') }
}

export const updateOptions = (patch: Partial<RunOptions>) => set(options, { ...read(options), ...patch })
export const updateBuild = (patch: Partial<BuildOptions>) => set(build, { ...read(build), ...patch })

export const actions = {
  run: () => perform('Starting app', () => plugin.request('tools.run', { ...selection(), options: read(options) }, { signal })),
  saveOptions: () => perform('Saving settings', () => plugin.request('tools.options', { ...selection(), options: read(options) }, { signal })),
  saveConfig: (name: string) => perform('Saving configuration', () => plugin.request('tools.config', { ...selection(), name, options: read(options) }, { signal })),
  deleteConfig: (name: string) => perform('Deleting configuration', () => plugin.request('tools.config', { ...selection(), name, options: null }, { signal })),
  control: (action: 'reload' | 'restart' | 'stop') => perform(action === 'stop' ? 'Stopping app' : 'Reloading app', () => plugin.request('tools.control', { ...selection(), action }, { signal, timeoutMs: 90_000 })),
  task: (action: TaskAction) => perform('Starting task', () => plugin.request('tools.task', { ...selection(), action }, { signal })),
  build: () => perform('Starting build', () => plugin.request('tools.build', { ...selection(), build: read(build), options: read(options) }, { signal })),
  cancel: (jobId: string) => perform('Cancelling task', () => plugin.request('tools.cancel', { ...selection(), jobId }, { signal })),
  refresh: () => perform('Refreshing devices', async () => applySnapshot(await plugin.request('tools.refresh', selection(), { signal, timeoutMs: 120_000 }))),
  launchEmulator: () => perform('Launching emulator', () => plugin.request('tools.launchEmulator', { ...selection(), emulatorId: read(emulatorId) }, { signal })),
  createEmulator: () => perform('Creating emulator', () => plugin.request('tools.createEmulator', { ...selection(), name: read(emulatorName), imageId: read(imageId) }, { signal })),
  widgetTree: () => perform('Reading widget tree', async () => set(widgetRoot, (await plugin.request('tools.widgetTree', selection(), { signal, timeoutMs: 60_000 })).root)),
  toggle: (toggle: DebugToggle, enabled: boolean) => perform('Updating debug option', () => plugin.request('tools.toggle', { ...selection(), toggle, enabled }, { signal })),
  openSource: (file: string) => perform('Opening source', () => plugin.request('tools.openSource', { ...selection(), file }, { signal })),
  checkPackages: () => perform('Checking packages', () => plugin.request('tools.packages', selection(), { signal })),
  pub: (action: PubAction, name = '', dev = false) => perform('Updating packages', () => plugin.request('tools.pub', { ...selection(), action, name, dev }, { signal })),
  openPubspec: () => perform('Opening pubspec.yaml', () => plugin.request('tools.openPubspec', selection(), { signal })),
  /** Pick a connected device as the run target; stays on the current tab. */
  useDevice: (deviceId: string) => updateOptions({ deviceId }),
  dismissError: () => set(error, ''),
  runTests: (keys: string[], scope: { failed?: boolean; coverage?: boolean } = {}) => perform('Starting tests', () => plugin.request('tools.runTests', { ...selection(), keys, ...scope }, { signal })),
  cancelTests: () => perform('Stopping tests', () => plugin.request('tools.cancelTests', selection(), { signal })),
  openTest: (file: string) => perform('Opening test', () => plugin.request('tools.openTest', { ...selection(), file }, { signal })),
  attach: () => perform('Attaching to the app', () => plugin.request('tools.run', { ...selection(), options: read(options), attach: true }, { signal })),
  override: (kind: 'platform' | 'brightness', value: string) => perform('Updating the app', () => plugin.request('tools.override', { ...selection(), kind, value }, { signal })),
  dump: (kind: DumpKind) => perform('Dumping tree', async () => set(dumpText, (await plugin.request('tools.dump', { ...selection(), kind }, { signal, timeoutMs: 60_000 })).text)),
  screenshot: () => perform('Taking screenshot', () => plugin.request('tools.screenshot', selection(), { signal })),
  setLocation: () => perform('Setting location', () => plugin.request('tools.location', { ...selection(), deviceId: read(locationDevice), latitude: Number(read(latitude)), longitude: Number(read(longitude)) }, { signal })),
  createProject: (workspaceId: string) => perform('Creating project', () => plugin.request('tools.create', { workspaceId, ...read(create) }, { signal }))
}
