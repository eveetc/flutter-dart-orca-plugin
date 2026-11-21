// Inspector tab: the running app's widget tree (summary tree, as Android Studio shows it), jump to source, debug toggles.
import { Button, Callout, Card, CodeView, Collapsible, EmptyState, Grid, KeyValue, Link, read, Row, Select, set, Stack, Switch, Tree, type TreeItem } from 'orca'
import { brightnessOverrides, dumpKinds, platformOverrides, type DebugToggle, type DumpKind, type Session, type WidgetNode } from '../types.ts'
import { actions, busy, dumpKind, dumpText, tab, widgetRoot, widgetSelected } from './state.ts'

const toggles: [DebugToggle, string][] = [
  ['inspector', 'Select widget on device'], ['paint', 'Debug paint'], ['performance', 'Performance overlay'],
  ['slowAnimations', 'Slow animations'], ['banner', 'Debug banner']
]

function toItems(node: WidgetNode): TreeItem {
  return { key: node.id, label: node.label, description: node.file ? `${node.file}${node.line ? `:${node.line}` : ''}` : undefined, children: node.children.map(toItems) }
}

function find(node: WidgetNode | null, id: string): WidgetNode | null {
  if (!node) return null
  if (node.id === id) return node
  for (const child of node.children) { const hit = find(child, id); if (hit) return hit }
  return null
}

const devToolsPage = (url: string, page: string) => `${url}${url.includes('?') ? '&' : '?'}page=${page}`
const dumpLabels: Record<DumpKind, string> = { widgets: 'Widget tree (full)', render: 'Render tree', layers: 'Layer tree', semantics: 'Semantics tree' }

export function InspectorTab({ session }: { session?: Session }) {
  const root = read(widgetRoot)
  const selected = find(root, read(widgetSelected))
  const disabled = !!read(busy)
  if (!session || session.status !== 'running') return <Stack gap="sm">
    <EmptyState icon="layers" title="Run the app to inspect widgets" description="Start or attach to the app in debug or profile mode." />
    <Row justify="center"><Button size="sm" variant="outline" icon="play" onPress={() => set(tab, 'run')}>Go to Run</Button></Row>
  </Stack>
  if (!session.inspectable) return <Callout title="Inspector unavailable" icon="info">Release builds have no VM service. Run in debug or profile mode.</Callout>
  return (
    <Stack gap="md">
      <Card title="Widget tree" description="The widgets your project creates. Enter or Open source jumps to the code.">
        <Stack gap="sm">
          <Grid columns={2} gap="sm">
            <Button size="sm" variant="solid" tone="accent" icon="refresh" disabled={disabled} onPress={actions.widgetTree}>{root ? 'Refresh tree' : 'Load tree'}</Button>
            <Button size="sm" variant="outline" icon="download" tooltip="Phones, emulators and simulators; saved to build/screenshots/" disabled={disabled} onPress={actions.screenshot}>Screenshot</Button>
          </Grid>
          {root ? <Tree label="Widget tree" items={[toItems(root)]} defaultExpanded={[root.id]} maxHeight="lg" selected={read(widgetSelected)}
            onSelect={({ key }) => set(widgetSelected, key)}
            onAction={({ key }) => { const node = find(root, key); if (node?.file) actions.openSource(node.file) }} /> : null}
          {selected ? <Stack gap="sm">
            <KeyValue items={[{ label: 'Widget', value: selected.label }, { label: 'Source', value: selected.file ? `${selected.file}${selected.line ? `:${selected.line}` : ''}` : 'Framework / package' }, { label: 'Children', value: String(selected.children.length) }]} />
            {selected.file ? <Row><Button size="sm" variant="outline" icon="file" disabled={disabled} onPress={() => actions.openSource(selected.file!)}>Open source</Button></Row> : null}
          </Stack> : null}
        </Stack>
      </Card>
      <Card title="Debug view" description="Changes how the running app draws, without touching your code.">
        <Stack gap="sm">
          <Grid minItemWidth="sm" gap="sm">
            <Select label="Platform" value={session.platform} disabled={disabled} options={platformOverrides.map(value => ({ value, label: value === 'default' ? 'Device default' : value }))} onChange={value => actions.override('platform', value)} />
            <Select label="Brightness" value={session.brightness} disabled={disabled} options={brightnessOverrides.map(value => ({ value, label: value === 'default' ? 'Device default' : value[0].toUpperCase() + value.slice(1) }))} onChange={value => actions.override('brightness', value)} />
          </Grid>
          <Stack gap="xs">{toggles.map(([toggle, label]) =>
            <Switch label={label} checked={session.toggles[toggle]} disabled={disabled} onChange={enabled => actions.toggle(toggle, enabled)} />)}
          </Stack>
        </Stack>
      </Card>
      <Collapsible title="Text dumps" description="Widget, render, layer and semantics trees as Flutter prints them.">
        <Stack gap="sm">
          <Grid minItemWidth="sm" gap="sm">
            <Select label="Tree" value={read(dumpKind)} options={dumpKinds.map(value => ({ value, label: dumpLabels[value] }))} onChange={value => set(dumpKind, value as DumpKind)} />
            <Button size="sm" variant="outline" icon="file-text" disabled={disabled} onPress={() => actions.dump(read(dumpKind))}>Dump</Button>
          </Grid>
          {read(dumpText) ? <CodeView label={dumpLabels[read(dumpKind)]} code={read(dumpText)} maxHeight="lg" /> : null}
        </Stack>
      </Collapsible>
      {session.devToolsUrl ? <Card title="Flutter DevTools">
        <Row gap="md" wrap>
          <Link href={devToolsPage(session.devToolsUrl, 'inspector')}>Inspector</Link>
          <Link href={devToolsPage(session.devToolsUrl, 'performance')}>Performance</Link>
          <Link href={devToolsPage(session.devToolsUrl, 'cpu-profiler')}>CPU profiler</Link>
          <Link href={devToolsPage(session.devToolsUrl, 'memory')}>Memory</Link>
          <Link href={devToolsPage(session.devToolsUrl, 'network')}>Network</Link>
          <Link href={devToolsPage(session.devToolsUrl, 'logging')}>Logging</Link>
        </Row>
      </Card> : null}
    </Stack>
  )
}
