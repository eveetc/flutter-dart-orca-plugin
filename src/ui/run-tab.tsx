// Run tab: app controls, run configuration (device, mode, entrypoint, flavor, defines, args), saved configurations.
import { Button, Callout, Card, CodeView, Collapsible, Grid, Input, Link, RadioGroup, read, Row, Select, set, Stack, Text, Textarea } from 'orca'
import { display, runArgs } from '../args.ts'
import { buildModes, type Project, type RunOptions, type Session } from '../types.ts'
import { actions, busy, configName, options, snapshot, updateOptions } from './state.ts'

const active = (session?: Session) => !!session && ['starting', 'running', 'stopping'].includes(session.status)
const capitalize = (value: string) => value[0].toUpperCase() + value.slice(1)

/** What the collapsed Advanced section holds, so nothing set there is hidden from view. */
function advancedSummary(run: RunOptions): string {
  const defines = run.dartDefines.split('\n').filter(line => line.trim() && !line.trim().startsWith('#')).length
  const parts = [run.target !== 'lib/main.dart' ? run.target : null, run.flavor ? `flavor ${run.flavor}` : null, defines ? `${defines} define${defines === 1 ? '' : 's'}` : null, run.defineFile || null, run.extraArgs ? 'extra args' : null].filter(Boolean)
  return parts.length ? parts.join(' · ') : 'Entrypoint, flavor, dart-defines, extra flags'
}

function preview(): string {
  try { return display(runArgs(read(options))) } catch (cause) { return (cause as Error).message }
}

/** Equal-width controls, Android Studio's run toolbar order. Tooltips carry the shortcuts. */
function Controls({ session, locked }: { session?: Session; locked: boolean }) {
  const disabled = !!read(busy)
  const canReload = !disabled && session?.status === 'running' && session.mode === 'debug'
  return (
    <Grid minItemWidth="xs" gap="sm">
      <Button size="md" variant="solid" tone="accent" icon="play" tooltip="Run · Ctrl/⌘+Shift+F10" disabled={locked || !read(options).deviceId} onPress={actions.run}>Run</Button>
      <Button size="md" variant="outline" icon="zap" tooltip="Hot reload · Ctrl/⌘+\" disabled={!canReload} onPress={() => actions.control('reload')}>Reload</Button>
      <Button size="md" variant="outline" icon="refresh" tooltip="Hot restart · Ctrl/⌘+Shift+\" disabled={!canReload} onPress={() => actions.control('restart')}>Restart</Button>
      <Button size="md" variant="outline" tone="danger" icon="stop" tooltip="Stop · Ctrl/⌘+F2" disabled={disabled || !active(session)} onPress={() => actions.control('stop')}>Stop</Button>
    </Grid>
  )
}

/** Load sits with the run settings; saving and deleting are tucked away until needed. */
function ConfigurationPicker({ locked }: { locked: boolean }) {
  const state = read(snapshot)
  const names = Object.keys(state.configs).sort()
  if (!names.length) return null
  const name = read(configName)
  const load = (value: string) => { set(configName, value); set(options, { ...state.configs[value], deviceId: read(options).deviceId || state.configs[value].deviceId }) }
  return <Select label="Configuration" value={names.includes(name) ? name : ''} placeholder="Current settings (unsaved)" disabled={locked} options={names.map(value => ({ value, label: value }))} onChange={load} />
}

function ManageConfigurations({ disabled, locked }: { disabled: boolean; locked: boolean }) {
  const names = Object.keys(read(snapshot).configs)
  const name = read(configName)
  return (
    <Collapsible title="Save configuration" description="Keep these settings under a name, like Android Studio's run configurations.">
      <Stack gap="sm">
        <Input label="Name" value={name} placeholder="e.g. Staging" maxLength={60} disabled={disabled} onChange={value => set(configName, value)} />
        <Grid minItemWidth="xs" gap="sm">
          <Button size="sm" variant="outline" icon="add" disabled={disabled || !name.trim()} onPress={() => actions.saveConfig(name)}>Save</Button>
          <Button size="sm" variant="outline" icon="check" tooltip="Used by Ctrl/⌘+Shift+F10 and the palette" disabled={locked} onPress={actions.saveOptions}>Set as default</Button>
          <Button size="sm" variant="outline" tone="danger" icon="delete" disabled={disabled || !names.includes(name)} onPress={() => { void actions.deleteConfig(name); set(configName, '') }}>Delete</Button>
        </Grid>
      </Stack>
    </Collapsible>
  )
}

export function RunTab({ project, session }: { project?: Project; session?: Session }) {
  const state = read(snapshot)
  const run = read(options)
  const disabled = !!read(busy) || !state.selection
  const locked = disabled || active(session)
  if (project?.kind !== 'flutter') return <Callout title="Dart package" icon="info">Use Checks and Packages for this package. Run, Build and Inspector need a Flutter project.</Callout>
  return (
    <Stack gap="md">
      <Controls session={session} locked={locked} />
      {!active(session) ? <Row gap="sm" align="center" justify="between">
        <Text muted size="xs">App already running on the device (from Xcode, a test or another tool)?</Text>
        <Button size="sm" variant="outline" icon="link" tooltip="flutter attach: hot reload and the inspector for an app you did not start here" disabled={locked || !run.deviceId} onPress={actions.attach}>Attach</Button>
      </Row> : null}
      {session ? <Card title={`${session.projectName} · ${session.mode}`} description={session.message}>
        <Stack gap="sm">
          {session.devToolsUrl && active(session) ? <Link href={session.devToolsUrl}>Open Flutter DevTools</Link> : null}
          <CodeView label="App output" code={session.logs || 'Flutter output will appear here.'} wrap maxHeight="md" />
        </Stack>
      </Card> : null}
      <Card title="Run settings">
        <Stack gap="sm">
          <ConfigurationPicker locked={locked} />
          <Select label="Device" value={run.deviceId} placeholder={state.devices.length ? 'Select a device' : 'Refresh to find devices'} disabled={locked} options={state.devices.map(device => ({ value: device.id, label: `${device.name} · ${device.platform}` }))} onChange={deviceId => updateOptions({ deviceId })} />
          <RadioGroup label="Mode" orientation="horizontal" value={run.mode} disabled={locked} options={buildModes.map(value => ({ value, label: capitalize(value) }))} onChange={mode => updateOptions({ mode: mode as typeof run.mode })} />
          <Collapsible title="Advanced" description={advancedSummary(run)}>
            <Stack gap="sm">
              <Grid minItemWidth="sm" gap="sm">
                <Input label="Entrypoint" value={run.target} placeholder="lib/main.dart" disabled={locked} onChange={target => updateOptions({ target })} />
                <Input label="Flavor" value={run.flavor} placeholder="optional" disabled={locked} onChange={flavor => updateOptions({ flavor })} />
              </Grid>
              <Textarea label="Dart defines (KEY=VALUE per line)" rows={4} value={run.dartDefines} placeholder={'API_URL=https://staging.example.com\nFEATURE_X=true'} disabled={locked} onChange={dartDefines => updateOptions({ dartDefines })} />
              <Input label="Define file" value={run.defineFile} placeholder="config/dev.json" disabled={locked} onChange={defineFile => updateOptions({ defineFile })} />
              <Input label="Extra arguments" value={run.extraArgs} placeholder="--web-port 8080 --no-pub" disabled={locked} onChange={extraArgs => updateOptions({ extraArgs })} />
              <CodeView label="Command" code={preview()} wrap />
            </Stack>
          </Collapsible>
          <ManageConfigurations disabled={disabled} locked={locked} />
        </Stack>
      </Card>
      {state.sessions.filter(other => other.projectPath !== state.selection?.projectPath && active(other)).map(other => <Text muted size="xs">{`${other.projectName} is also running on ${other.deviceId}.`}</Text>)}
    </Stack>
  )
}
