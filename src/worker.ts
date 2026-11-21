// Worker entry: wires panel requests, palette commands and events to FlutterTools.
import type { OrcaWorkerApi } from 'orca/worker'
import './protocol.ts'
import { FlutterTools } from './service.ts'
import type { TaskAction } from './types.ts'

let tools: FlutterTools | undefined
const ok = { ok: true as const }

// One stray rejection (a tool exiting oddly, a socket closing) must not take the worker down and
// stop every running app with it: log it where `orca plugin logs` shows it, and carry on.
let guard: ((error: unknown) => void) | undefined

export default function activate(orca: OrcaWorkerApi): void {
  guard = error => { try { orca.log(`Unexpected error: ${error instanceof Error ? error.stack ?? error.message : String(error)}`) } catch { /* logging must not throw */ } }
  process.on('unhandledRejection', guard)
  process.on('uncaughtException', guard)
  const service = new FlutterTools(orca)
  tools = service
  const { handle } = orca.panels

  handle('tools.snapshot', input => service.snapshot(input))
  handle('tools.refresh', (input, { signal }) => service.refresh(input, signal))
  handle('tools.options', async input => { await service.saveOptions(input, input.options); return ok })
  handle('tools.config', async input => { await service.saveConfig(input, input.name, input.options); return ok })
  handle('tools.run', async input => { await service.run(input, input.options, input.attach === true ? 'attach' : 'run'); return ok })
  handle('tools.control', async input => { await service.control(input, input.action); return ok })
  handle('tools.task', async input => { await service.task(input, input.action); return ok })
  handle('tools.build', async input => { await service.build(input, input.build, input.options); return ok })
  handle('tools.cancel', async input => { await service.cancel(input, input.jobId); return ok })
  handle('tools.launchEmulator', async input => { await service.launchEmulator(input, input.emulatorId); return ok })
  handle('tools.createEmulator', async input => { await service.createEmulator(input, input.name, input.imageId); return ok })
  handle('tools.widgetTree', async input => ({ root: await service.widgetTree(input) }))
  handle('tools.toggle', async input => { await service.toggle(input, input.toggle, input.enabled); return ok })
  handle('tools.openSource', async input => { await service.openSource(input, input.file); return ok })
  handle('tools.packages', async input => { await service.checkPackages(input); return ok })
  handle('tools.pub', async input => { await service.pub(input, input.action, input.name, input.dev === true); return ok })
  handle('tools.openPubspec', async input => { await service.openPubspec(input); return ok })
  handle('tools.override', async input => { await service.override(input, input.kind, input.value); return ok })
  handle('tools.dump', async input => ({ text: await service.dump(input, input.kind) }))
  handle('tools.screenshot', async input => { await service.screenshot(input); return ok })
  handle('tools.location', async input => { await service.setLocation(input, input.deviceId, input.latitude, input.longitude); return ok })
  handle('tools.runTests', async input => { await service.runTests(input, input); return ok })
  handle('tools.cancelTests', async input => { await service.cancelTests(input); return ok })
  handle('tools.openTest', async input => { await service.openTest(input, input.file); return ok })
  handle('tools.create', async input => { await service.createProject(input.workspaceId, input); return ok })

  orca.events.on('workspace.removed', event => service.removeWorkspace(event.workspaceId))

  // Palette commands act on the focused workspace's selected package.
  const command = (id: string, action: (selection: Awaited<ReturnType<FlutterTools['paletteSelection']>>) => Promise<unknown>, done: string) =>
    orca.commands.register(id, async () => { await action(await service.paletteSelection()); return done })
  const panelHint = 'Open the Flutter & Dart panel for output.'

  command('flutter.refresh', selection => service.refresh(selection), 'Projects and devices refreshed.')
  command('flutter.run', selection => service.runSaved(selection), `Flutter app starting. ${panelHint}`)
  command('flutter.runProfile', selection => service.runSaved(selection, 'profile'), `Flutter app starting in profile mode. ${panelHint}`)
  command('flutter.runRelease', selection => service.runSaved(selection, 'release'), `Flutter app starting in release mode. ${panelHint}`)
  command('flutter.attach', selection => service.attachSaved(selection), `Attaching to the running app. ${panelHint}`)
  command('flutter.screenshot', selection => service.screenshot(selection), 'Screenshot requested; it opens when saved.')
  orca.commands.register('flutter.nextDevice', async () => `Run target: ${await service.nextDevice(await service.paletteSelection())}`)
  for (const action of ['reload', 'restart', 'stop'] as const) command(`flutter.${action}`, selection => service.control(selection, action), `Flutter ${action} requested.`)
  command('dart.test', selection => service.runTests(selection, { keys: [] }), `Tests started. ${panelHint}`)
  command('dart.testFailed', selection => service.runTests(selection, { keys: [], failed: true }), `Re-running failed tests. ${panelHint}`)
  command('dart.coverage', selection => service.runTests(selection, { keys: [], coverage: true }), `Tests with coverage started. ${panelHint}`)
  command('flutter.build', selection => service.runBuild(selection), `Build started. ${panelHint}`)
  const tasks: [string, TaskAction][] = [['dart.analyze', 'analyze'],  ['dart.format', 'format'], ['dart.fix', 'fix'], ['dart.pubGet', 'pub-get'], ['dart.pubUpgrade', 'pub-upgrade'], ['dart.codegen', 'codegen'], ['flutter.clean', 'clean'], ['flutter.genL10n', 'gen-l10n'], ['flutter.doctor', 'doctor'], ['flutter.upgrade', 'sdk-upgrade']]
  for (const [id, action] of tasks) command(id, selection => service.task(selection, action), `Task started. ${panelHint}`)
}

export async function deactivate(): Promise<void> {
  await tools?.dispose(); tools = undefined
  if (guard) { process.off('unhandledRejection', guard); process.off('uncaughtException', guard); guard = undefined }
}
