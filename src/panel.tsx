// Panel entry: header, workspace/package pickers and the tab shell. Each tab lives in src/ui/.
import { Badge, Button, Callout, EmptyState, Heading, IconButton, on, plugin, read, Row, Select, set, Spinner, Stack, Tab, Tabs, Text, type PanelContext } from 'orca'
import { hasUpdate } from './pub.ts'
import './protocol.ts'
import { isLocal, type Workspace } from './types.ts'
import { actions, busy, error, load, loading, setSignal, snapshot, tab, workspaceId } from './ui/state.ts'
import { RunTab } from './ui/run-tab.tsx'
import { BuildTab } from './ui/build-tab.tsx'
import { ChecksTab } from './ui/checks-tab.tsx'
import { DevicesTab } from './ui/devices-tab.tsx'
import { InspectorTab } from './ui/inspector-tab.tsx'
import { PackagesTab } from './ui/packages-tab.tsx'
import { CreateProject } from './ui/create-project.tsx'
import { TestsTab } from './ui/tests-tab.tsx'

export function setup(ctx: PanelContext): void {
  setSignal(ctx.signal)
  ctx.subscriptions.push(plugin.on('tools.changed', ({ workspaceId }) => {
    const current = read(snapshot).selection
    if (current && current.workspaceId === workspaceId) void load(current)
  }))
  // Follow Orca's focus; if the focused workspace cannot be identified, keep the current one.
  ctx.subscriptions.push(on('workspace.changed', () => { void load({}, true) }))
  void load()
}

const workspaceLabel = (workspace: Workspace) =>
  [workspace.project && workspace.project !== workspace.name ? workspace.project : null, workspace.name, workspace.branch].filter(Boolean).join(' · ')

/** Most recently active first, then by project and name. */
function pickerOrder(workspaces: Workspace[]): Workspace[] {
  return [...workspaces].sort((a, b) => (b.lastActivityAt ?? 0) - (a.lastActivityAt ?? 0) || workspaceLabel(a).localeCompare(workspaceLabel(b)))
}

/** Opening Packages the first time runs `pub outdated` in the background. */
function openTab(value: string): void {
  set(tab, value)
  const state = read(snapshot)
  if (value === 'packages' && state.selection && state.packages === null && state.packagesStatus === 'idle') void actions.checkPackages()
}

export default function Panel() {
  const state = read(snapshot)
  const selected = state.selection
  const project = state.projects.find(project => project.relativePath === selected?.projectPath)
  const session = state.sessions.find(session => session.projectPath === selected?.projectPath)
  const running = session && ['starting', 'running', 'stopping'].includes(session.status)
  const updates = (state.packages ?? []).filter(hasUpdate).length
  return (
    <Stack gap="md">
      <Row justify="between">
        <Heading>Flutter &amp; Dart</Heading>
        <Row gap="sm" align="center">
          <Badge tone={read(busy) ? 'accent' : running ? 'success' : 'neutral'}>{read(busy) ? `${read(busy)}…` : running ? `${session.status} · ${session.mode}` : 'Idle'}</Badge>
          <IconButton size="sm" variant="ghost" icon="refresh" label="Refresh projects and devices" disabled={!!read(busy) || !selected} onPress={actions.refresh} />
        </Row>
      </Row>
      <Text muted size="xs">{state.sdkVersion || 'Refresh to detect your Flutter SDK.'}</Text>
      {read(error) ? <Callout tone="danger" icon="error" title="Action failed">
        <Stack gap="xs">
          <Text size="sm">{read(error)}</Text>
          <Row><Button size="sm" variant="outline" icon="close" onPress={actions.dismissError}>Dismiss</Button></Row>
        </Stack>
      </Callout> : null}
      {read(loading) ? <Spinner label="Finding Dart and Flutter projects" /> : null}
      <Select label="Workspace" value={read(workspaceId)} placeholder="Choose workspace" disabled={!!read(busy)} options={pickerOrder(state.workspaces.filter(isLocal)).map(workspace => ({ value: workspace.id, label: workspaceLabel(workspace) }))} onChange={id => { set(workspaceId, id); void load({ workspaceId: id }) }} />
      {state.projects.length ? <Select label="Package" value={selected?.projectPath ?? ''} disabled={!!read(busy)} options={state.projects.map(project => ({ value: project.relativePath, label: `${project.name} · ${project.relativePath}` }))} onChange={projectPath => void load({ workspaceId: read(workspaceId), projectPath })} /> : null}
      {!selected && !read(loading) ? <EmptyState icon="folder" title="Open a Dart or Flutter project" description={state.notice} /> : null}
      {!selected && state.creatable ? <CreateProject workspaceId={state.creatable.workspaceId} /> : null}
      {selected ? <Stack gap="md">
        <Row gap="sm" wrap>
          <Badge tone="accent">{project?.kind === 'flutter' ? (project.app ? 'Flutter app' : 'Flutter package') : 'Dart package'}</Badge>
          {state.devices.length ? <Badge>{`${state.devices.length} device${state.devices.length === 1 ? '' : 's'}`}</Badge> : null}
          {updates ? <Badge tone="warning">{`${updates} update${updates === 1 ? '' : 's'}`}</Badge> : null}
        </Row>
        {state.notice ? <Callout tone="neutral">{state.notice}</Callout> : null}
        <Tabs label="Flutter tools" value={read(tab)} onChange={openTab}>
          <Tab value="run" label="Run" icon="play"><RunTab project={project} session={session} /></Tab>
          <Tab value="inspector" label="Inspector" icon="layers"><InspectorTab session={session} /></Tab>
          <Tab value="tests" label="Tests" icon="check"><TestsTab /></Tab>
          <Tab value="checks" label="Checks" icon="wrench"><ChecksTab project={project} /></Tab>
          <Tab value="packages" label="Packages" icon="package"><PackagesTab /></Tab>
          <Tab value="build" label="Build" icon="hammer"><BuildTab project={project} /></Tab>
          <Tab value="devices" label="Devices" icon="blocks"><DevicesTab /></Tab>
        </Tabs>
      </Stack> : null}
    </Stack>
  )
}
