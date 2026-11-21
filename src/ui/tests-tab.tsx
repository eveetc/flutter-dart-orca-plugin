// Tests tab: every test file, group and test in one tree, with pass/fail marks, run scopes and failure output.
import { Badge, Button, Card, CodeView, Collapsible, EmptyState, Link, Grid, IconButton, KeyValue, read, RelativeTime, Row, set, Stack, Text, Tree, type IconName, type TreeItem } from 'orca'
import type { TestNode, TestStatus } from '../types.ts'
import { actions, busy, snapshot, testSelected } from './state.ts'

const icons: Record<TestStatus, IconName> = { passed: 'check', failed: 'error', skipped: 'remove', running: 'refresh', idle: 'play' }
const kindIcon = { file: 'file', group: 'layers', test: 'play' } as const
const label: Record<TestStatus, string> = { passed: 'passed', failed: 'failed', skipped: 'skipped', running: 'running', idle: 'not run yet' }

function toItems(node: TestNode): TreeItem {
  const tests = count(node)
  return {
    key: node.key,
    label: node.name,
    icon: node.status === 'idle' ? kindIcon[node.kind] : icons[node.status],
    description: node.kind === 'test' ? label[node.status] : `${tests} test${tests === 1 ? '' : 's'} · ${label[node.status]}`,
    children: node.children.length ? node.children.map(toItems) : undefined
  }
}

const count = (node: TestNode): number => node.kind === 'test' ? 1 : node.children.reduce((sum, child) => sum + count(child), 0)

function find(nodes: TestNode[], key: string): TestNode | null {
  for (const node of nodes) {
    if (node.key === key) return node
    const hit = find(node.children, key)
    if (hit) return hit
  }
  return null
}

/** Failed tests and the files and groups that hold them, so failures are visible without digging. */
function failedPath(nodes: TestNode[]): string[] {
  return nodes.flatMap(node => node.status === 'failed' && node.kind !== 'test' ? [node.key, ...failedPath(node.children)] : [])
}

export function TestsTab() {
  const state = read(snapshot)
  const run = state.tests
  const disabled = !!read(busy)
  if (!run) return <EmptyState icon="check" title="Loading tests" />
  if (!run.tree.length) return <Stack gap="sm">
    <EmptyState icon="check" title="No tests yet" description="Add *_test.dart files under test/ or integration_test/ and they show up here." />
    <Row justify="center"><Link href="https://docs.flutter.dev/cookbook/testing/unit/introduction">Writing your first test</Link></Row>
  </Stack>
  const selected = find(run.tree, read(testSelected))
  const { passed, failed, skipped } = run.counts
  return (
    <Stack gap="md">
      <Row gap="sm" wrap align="center">
        {run.running ? <Badge tone="accent">running</Badge> : null}
        {passed ? <Badge tone="success">{`${passed} passed`}</Badge> : null}
        {failed ? <Badge tone="danger">{`${failed} failed`}</Badge> : null}
        {skipped ? <Badge>{`${skipped} skipped`}</Badge> : null}
        {run.coverage !== null ? <Badge tone="accent">{`coverage ${run.coverage}%`}</Badge> : null}
        {run.running && run.startedAt ? <Text muted size="xs">for <RelativeTime at={run.startedAt} format="duration" muted /></Text> : null}
      </Row>
      <Grid minItemWidth="xs" gap="sm">
        {run.running
          ? <Button size="sm" variant="outline" tone="danger" icon="stop" onPress={actions.cancelTests}>Stop</Button>
          : <Button size="sm" variant="solid" tone="accent" icon="play" tooltip="Everything under test/" disabled={disabled} onPress={() => actions.runTests([])}>Run all</Button>}
        <Button size="sm" variant="outline" icon="refresh" disabled={disabled || run.running || !failed} onPress={() => actions.runTests([], { failed: true })}>Run failed</Button>
        <Button size="sm" variant="outline" icon="bar-chart-3" tooltip="flutter test --coverage → coverage/lcov.info" disabled={disabled || run.running} onPress={() => actions.runTests([], { coverage: true })}>Coverage</Button>
      </Grid>
      <Tree label="Tests" items={run.tree.map(toItems)} maxHeight="lg" selected={read(testSelected)} defaultExpanded={failedPath(run.tree)}
        onSelect={({ key }) => set(testSelected, key)}
        onAction={({ key }) => { if (!run.running) void actions.runTests([key]) }} />
      <Text muted size="xs">Enter runs the selected file, group or test.</Text>
      {selected ? <Card title={selected.name} description={selected.kind === 'test' ? label[selected.status] : `${selected.kind} · ${count(selected)} tests`}>
        <Stack gap="sm">
          <KeyValue items={[{ label: 'File', value: `${selected.file}${selected.line ? `:${selected.line}` : ''}` }, ...(selected.fullName ? [{ label: 'Name', value: selected.fullName }] : [])]} />
          <Row gap="sm">
            <Button size="sm" variant="outline" icon="play" disabled={disabled || run.running} onPress={() => actions.runTests([selected.key])}>{`Run this ${selected.kind}`}</Button>
            <IconButton size="sm" variant="outline" icon="file" label="Open test file" disabled={disabled} onPress={() => actions.openTest(selected.file)} />
          </Row>
          {selected.output ? <CodeView label="Output" code={selected.output} wrap maxHeight="md" /> : null}
        </Stack>
      </Card> : null}
      {run.log.trim() ? <Collapsible title="Run output" description="The command, compile errors and anything not tied to one test.">
        <CodeView label="Test run output" code={run.log} wrap maxHeight="md" />
      </Collapsible> : null}
    </Stack>
  )
}
