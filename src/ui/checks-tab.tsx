// Checks tab: analyze, test, format, fixes, code generation, clean, doctor.
import { Badge, Button, Callout, Card, Grid, Link, read, set, Stack, Text } from 'orca'
import type { IconName } from 'orca'
import type { Project, TaskAction } from '../types.ts'
import { actions, busy, confirmUpgrade, snapshot } from './state.ts'
import { isBuild, isPackages, JobList } from './jobs.tsx'

type Task = [TaskAction, string, IconName, string]
const groups: { title: string; description?: string; tasks: Task[] }[] = [
  { title: 'Quality', tasks: [['analyze', 'Analyze', 'search', 'dart/flutter analyze'], ['format', 'Format', 'edit', 'dart format . · Ctrl/⌘+Alt+L'], ['fix', 'Fix', 'wrench', 'dart fix --apply']] },
  { title: 'Generate & maintain', description: 'Format and Fix write files.', tasks: [['codegen', 'build_runner', 'blocks', 'dart run build_runner build'], ['gen-l10n', 'gen-l10n', 'globe', 'flutter gen-l10n'], ['clean', 'Clean', 'delete', 'flutter clean'], ['doctor', 'Doctor', 'activity', 'flutter doctor -v']] }
]
const flutterOnly = new Set<TaskAction>(['gen-l10n', 'clean'])

/** Result of the newest `flutter upgrade --verify-only`, if any. */
function sdkStatus(): { state: 'available' | 'current'; latest: string | null } | null {
  const check = [...read(snapshot).jobs].reverse().find(job => job.title.startsWith('Check Flutter version') && job.status !== 'running')
  if (!check) return null
  if (/new version of Flutter is available/i.test(check.output)) return { state: 'available', latest: check.output.match(/latest version:\s*([\w.+-]+)/i)?.[1] ?? null }
  if (/already up to date/i.test(check.output)) return { state: 'current', latest: null }
  return null
}

function SdkCard({ disabled }: { disabled: boolean }) {
  const state = read(snapshot)
  const status = sdkStatus()
  const running = state.sessions.some(session => ['starting', 'running', 'stopping'].includes(session.status))
  const version = state.sdkVersion || 'Version unknown, refresh to detect it'
  if (state.sdkFvm) return (
    <Card title="Flutter SDK" description={version}>
      <Callout tone="neutral" icon="info" title="Managed by FVM">
        <Stack gap="xs">
          <Text size="sm">Change this project’s Flutter version with `fvm use stable` or `fvm use 3.x.y` in a terminal, then refresh.</Text>
          <Link href="https://fvm.app/documentation/guides/basic-commands">FVM commands</Link>
        </Stack>
      </Callout>
    </Card>
  )
  return (
    <Card title="Flutter SDK" description={version}>
      <Stack gap="sm">
        {status?.state === 'available' ? <Badge tone="warning">{status.latest ? `Update available: ${status.latest}` : 'Update available'}</Badge> : status?.state === 'current' ? <Badge tone="success">Up to date</Badge> : null}
        {read(confirmUpgrade) ? <Callout tone="warning" icon="warning" title="Upgrade Flutter?">
          <Stack gap="sm">
            <Text size="sm">This updates the SDK itself, for every project that uses it. Afterwards, run pub get in your projects.</Text>
            <Grid columns={2} gap="sm">
              <Button size="sm" variant="solid" tone="accent" icon="download" disabled={disabled || running} tooltip={running ? 'Stop running apps first' : 'flutter upgrade'} onPress={() => { set(confirmUpgrade, false); void actions.task('sdk-upgrade') }}>Upgrade now</Button>
              <Button size="sm" variant="outline" icon="close" onPress={() => set(confirmUpgrade, false)}>Cancel</Button>
            </Grid>
          </Stack>
        </Callout> : <Grid columns={2} gap="sm">
          <Button size="sm" variant="outline" icon="search" tooltip="flutter upgrade --verify-only" disabled={disabled} onPress={() => actions.task('sdk-check')}>Check for update</Button>
          <Button size="sm" variant={status?.state === 'available' ? 'solid' : 'outline'} tone={status?.state === 'available' ? 'accent' : undefined} icon="download" tooltip={running ? 'Stop running apps first' : 'flutter upgrade'} disabled={disabled || running} onPress={() => set(confirmUpgrade, true)}>Upgrade Flutter</Button>
        </Grid>}
        {running ? <Text muted size="xs">Stop running apps to upgrade.</Text> : null}
      </Stack>
    </Card>
  )
}

export function ChecksTab({ project }: { project?: Project }) {
  const state = read(snapshot)
  const disabled = !!read(busy) || !state.selection || state.jobs.some(job => job.status === 'running')
  return (
    <Stack gap="md">
      <SdkCard disabled={disabled} />
      {groups.map(group => <Card title={group.title} description={group.description}>
        <Grid columns={group.tasks.length === 3 ? 3 : 2} gap="sm">{group.tasks.map(([action, label, icon, tooltip]) =>
          <Button size="sm" variant="outline" icon={icon} tooltip={tooltip} disabled={disabled || (flutterOnly.has(action) && project?.kind !== 'flutter')} onPress={() => actions.task(action)}>{label}</Button>)}
        </Grid>
      </Card>)}
      <JobList filter={title => !isBuild(title) && !isPackages(title)} empty={{ title: 'Ready to check your project', description: 'Results stay with this package.' }} />
    </Stack>
  )
}
