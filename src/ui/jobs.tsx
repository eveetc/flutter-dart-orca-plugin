// Output cards for tasks and builds of the selected package.
import { Badge, Callout, Card, CodeView, EmptyState, IconButton, read, RelativeTime, Row, Stack, Text } from 'orca'
import { actions, busy, snapshot } from './state.ts'

const duration = (ms: number) => { const s = Math.round(ms / 1000); return s < 60 ? `${s}s` : `${Math.floor(s / 60)}m ${s % 60}s` }
/** Flutter prints "✓ Built build/app/outputs/…/app-release.aab (21.3MB)" when a build succeeds. */
const builtFile = (output: string) => output.match(/Built (build\/\S+)(?: \(([^)]+)\))?/)

const tones = { passed: 'success', failed: 'danger', running: 'accent', cancelled: 'neutral' } as const

export function JobList({ filter, empty }: { filter: (title: string) => boolean; empty: { title: string; description: string } }) {
  const jobs = read(snapshot).jobs.filter(job => filter(job.title))
  if (!jobs.length) return <EmptyState icon="check" title={empty.title} description={empty.description} />
  return <Stack gap="sm">{[...jobs].reverse().map(job => {
    const [title, command] = job.title.split('  ·  ')
    return <Card>
      <Stack gap="sm">
        <Row gap="sm" justify="between" align="center">
          <Row gap="sm" align="center"><Badge tone={tones[job.status]}>{job.status}</Badge><Text weight="semibold" size="sm" truncate>{title}</Text></Row>
          {job.status === 'running' ? <IconButton size="sm" variant="outline" icon="close" label="Cancel task" disabled={!!read(busy)} onPress={() => actions.cancel(job.id)} /> : null}
        </Row>
        <Row gap="sm" align="center">
          {job.status === 'running' ? <Text muted size="xs">running for <RelativeTime at={job.startedAt} format="duration" muted /></Text>
            : job.finishedAt ? <Text muted size="xs">{`${job.status === 'passed' ? 'finished' : job.status} in ${duration(job.finishedAt - job.startedAt)}`}</Text> : null}
          {command ? <Text muted size="xs" truncate>{command}</Text> : null}
        </Row>
        {job.status === 'passed' && builtFile(job.output) ? <Callout tone="success" icon="check" title="Build ready">{`${builtFile(job.output)![1]}${builtFile(job.output)![2] ? ` · ${builtFile(job.output)![2]}` : ''}`}</Callout> : null}
        <CodeView label={`${title} output`} code={job.output.split('\n').slice(1).join('\n') || '…'} wrap maxHeight="md" />
      </Stack>
    </Card>
  })}</Stack>
}

export const isBuild = (title: string) => title.startsWith('Build ')
export const isPackages = (title: string) => title.startsWith('Packages')
