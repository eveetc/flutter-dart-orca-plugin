// Shown when the chosen workspace has no Dart or Flutter project: `flutter create` with the usual choices.
import { Button, Card, Checkbox, Grid, Input, RadioGroup, read, set, Stack, Text } from 'orca'
import { actions, busy, create, snapshot } from './state.ts'
import { JobList } from './jobs.tsx'

const platforms = ['android', 'ios', 'web', 'linux', 'macos', 'windows']
const templates = [{ value: 'app', label: 'App' }, { value: 'package', label: 'Package' }, { value: 'plugin', label: 'Plugin' }, { value: 'module', label: 'Module' }]

export function CreateProject({ workspaceId }: { workspaceId: string }) {
  const form = read(create)
  const update = (patch: Partial<typeof form>) => set(create, { ...form, ...patch })
  const empty = read(snapshot).creatable?.empty ?? false
  const nameOk = /^[a-z][a-z0-9_]{0,63}$/.test(form.name)
  const orgOk = /^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)+$/.test(form.org)
  const running = read(snapshot).jobs.some(job => job.status === 'running')
  const withPlatforms = form.template === 'app' || form.template === 'plugin'
  return (
    <Stack gap="md">
      <Card title="Create a Flutter project" description="Runs flutter create in this workspace, then opens the project here.">
        <Stack gap="sm">
          <Grid minItemWidth="sm" gap="sm">
            <Input label="Project name" value={form.name} placeholder="my_app" maxLength={64} invalid={!nameOk} onChange={name => update({ name: name.trim().toLowerCase() })} />
            <Input label="Organization" value={form.org} placeholder="com.example" maxLength={100} invalid={!orgOk} onChange={org => update({ org: org.trim().toLowerCase() })} />
          </Grid>
          <RadioGroup label="Template" orientation="horizontal" value={form.template} options={templates} onChange={template => update({ template })} />
          {withPlatforms ? <Stack gap="xs">
            <Text size="sm" weight="medium">Platforms</Text>
            <Grid columns={3} gap="xs">{platforms.map(platform =>
              <Checkbox label={platform === 'ios' ? 'iOS' : platform === 'macos' ? 'macOS' : platform[0].toUpperCase() + platform.slice(1)} checked={form.platforms.includes(platform)} onChange={on => update({ platforms: on ? [...form.platforms, platform] : form.platforms.filter(item => item !== platform) })} />)}
            </Grid>
          </Stack> : null}
          {empty ? <Checkbox label="Create in the workspace root instead of a new folder" checked={form.here} onChange={here => update({ here })} /> : null}
          {!nameOk ? <Text size="xs" tone="danger">Lowercase letters, digits and underscores, starting with a letter.</Text> : !orgOk ? <Text size="xs" tone="danger">A reverse domain such as com.example.</Text> : null}
          <Button size="sm" variant="solid" tone="accent" icon="add" disabled={!!read(busy) || running || !nameOk || !orgOk || (withPlatforms && !form.platforms.length)} onPress={() => actions.createProject(workspaceId)}>{form.here ? `Create ${form.name} here` : `Create ${form.name}/`}</Button>
        </Stack>
      </Card>
      <JobList filter={title => title.startsWith('Create project')} empty={{ title: 'Nothing created yet', description: 'Progress shows here.' }} />
    </Stack>
  )
}
