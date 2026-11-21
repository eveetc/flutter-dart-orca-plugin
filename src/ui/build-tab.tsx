// Build tab: signing check, then flutter build <platform> with the run configuration's entrypoint, flavor and defines.
import { Button, Callout, Card, CodeView, Input, Link, RadioGroup, read, Select, Stack, Text } from 'orca'
import { buildArgs, display } from '../args.ts'
import { buildModes, buildPlatforms, type BuildPlatform, type Project, type ReleaseCheck } from '../types.ts'
import { actions, build, busy, options, snapshot, updateBuild } from './state.ts'
import { isBuild, JobList } from './jobs.tsx'

const labels: Record<BuildPlatform, string> = { apk: 'Android APK', appbundle: 'Android App Bundle (.aab)', ipa: 'iOS archive (.ipa)', ios: 'iOS app', web: 'Web', linux: 'Linux', macos: 'macOS', windows: 'Windows' }
const signingPlatform = (platform: BuildPlatform): ReleaseCheck['platform'] | null => platform === 'apk' || platform === 'appbundle' ? 'android' : platform === 'ipa' || platform === 'ios' ? 'ios' : null
const docs = { android: 'https://docs.flutter.dev/deployment/android#sign-the-app', ios: 'https://docs.flutter.dev/deployment/ios' }

function preview(): string {
  try { return display(buildArgs(read(build), read(options))) } catch (cause) { return (cause as Error).message }
}

/** Shown before a release build for a store platform: a missing keystore is the classic surprise. */
function Signing() {
  const settings = read(build)
  const platform = signingPlatform(settings.platform)
  const check = read(snapshot).release.find(item => item.platform === platform)
  if (!platform || settings.mode !== 'release' || !check || check.level === 'none') return null
  if (check.level === 'ok') return <Callout tone="success" icon="check" title="Release signing configured">{check.messages.join(' ') || 'A release signing config and its key file were found.'}</Callout>
  return (
    <Callout tone={check.level === 'error' ? 'danger' : 'warning'} icon="warning" title={platform === 'android' ? 'Android release signing' : 'iOS signing'}>
      <Stack gap="xs">
        {check.messages.map(message => <Text size="sm">{message}</Text>)}
        <Link href={docs[platform]}>How to set up signing</Link>
      </Stack>
    </Callout>
  )
}

export function BuildTab({ project }: { project?: Project }) {
  const state = read(snapshot)
  const settings = read(build)
  const disabled = !!read(busy) || !state.selection || state.jobs.some(job => job.status === 'running')
  if (project?.kind !== 'flutter') return <Callout title="Dart package" icon="info">Builds need a Flutter project.</Callout>
  return (
    <Stack gap="md">
      <Card title="Build" description="Entrypoint, flavor and Dart defines come from the Run tab.">
        <Stack gap="sm">
          <Select label="Platform" value={settings.platform} disabled={disabled} options={buildPlatforms.map(value => ({ value, label: labels[value] }))} onChange={platform => updateBuild({ platform: platform as BuildPlatform })} />
          <RadioGroup label="Mode" orientation="horizontal" value={settings.mode} disabled={disabled} options={buildModes.map(value => ({ value, label: value[0].toUpperCase() + value.slice(1) }))} onChange={mode => updateBuild({ mode: mode as typeof settings.mode })} />
          <Input label="Extra build arguments" value={settings.extraArgs} placeholder="--obfuscate --split-debug-info=build/symbols --build-number 42" disabled={disabled} onChange={extraArgs => updateBuild({ extraArgs })} />
          <CodeView label="Command" code={preview()} wrap />
          <Button size="sm" variant="solid" tone="accent" icon="hammer" tooltip="Ctrl/⌘+Shift+F9 repeats the last build" disabled={disabled} onPress={actions.build}>{`Build ${labels[settings.platform]}`}</Button>
        </Stack>
      </Card>
      <Signing />
      <JobList filter={isBuild} empty={{ title: 'No builds yet', description: 'Outputs land in the project’s build/ folder.' }} />
    </Stack>
  )
}
