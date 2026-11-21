// Request/response contract between panel and worker. Types only.
import type { PubAction } from './pub.ts'
import type { BuildOptions, DebugToggle, DumpKind, RunOptions, Selection, Snapshot, TaskAction, WidgetNode } from './types.ts'
export {}

type Ok = { ok: true }

declare module 'orca' {
  interface PluginRequests {
    'tools.snapshot': { input: { workspaceId?: string; projectPath?: string }; output: Snapshot }
    'tools.refresh': { input: Selection; output: Snapshot }
    'tools.options': { input: Selection & { options: RunOptions }; output: Ok }
    'tools.config': { input: Selection & { name: string; options: RunOptions | null }; output: Ok }
    'tools.run': { input: Selection & { options: RunOptions; attach?: boolean }; output: Ok }
    'tools.control': { input: Selection & { action: 'reload' | 'restart' | 'stop' }; output: Ok }
    'tools.task': { input: Selection & { action: TaskAction }; output: Ok }
    'tools.build': { input: Selection & { build: BuildOptions; options: RunOptions }; output: Ok }
    'tools.cancel': { input: Selection & { jobId: string }; output: Ok }
    'tools.launchEmulator': { input: Selection & { emulatorId: string }; output: Ok }
    'tools.createEmulator': { input: Selection & { name: string; imageId: string }; output: Ok }
    'tools.widgetTree': { input: Selection; output: { root: WidgetNode | null } }
    'tools.toggle': { input: Selection & { toggle: DebugToggle; enabled: boolean }; output: Ok }
    'tools.openSource': { input: Selection & { file: string }; output: Ok }
    'tools.packages': { input: Selection; output: Ok }
    'tools.pub': { input: Selection & { action: PubAction; name: string; dev?: boolean }; output: Ok }
    'tools.openPubspec': { input: Selection; output: Ok }
    'tools.override': { input: Selection & { kind: 'platform' | 'brightness'; value: string }; output: Ok }
    'tools.dump': { input: Selection & { kind: DumpKind }; output: { text: string } }
    'tools.screenshot': { input: Selection; output: Ok }
    'tools.location': { input: Selection & { deviceId: string; latitude: number; longitude: number }; output: Ok }
    'tools.runTests': { input: Selection & { keys: string[]; failed?: boolean; coverage?: boolean }; output: Ok }
    'tools.cancelTests': { input: Selection; output: Ok }
    'tools.openTest': { input: Selection & { file: string }; output: Ok }
    'tools.create': { input: { workspaceId: string; name: string; org: string; template: string; platforms: string[]; here: boolean }; output: Ok }
  }
  interface PluginPanelEvents { 'tools.changed': { workspaceId: string } }
}
