// Packages tab: dependencies from pub outdated, update prompts, add/remove, pub.dev, edit pubspec.yaml.
import { Button, Callout, Card, Checkbox, Grid, Input, Link, read, Row, set, Stack, Table, Text } from 'orca'
import { hasUpdate } from '../pub.ts'
import type { PackageInfo } from '../types.ts'
import { actions, busy, newPackage, newPackageDev, packageSelected, snapshot } from './state.ts'
import { isPackages, JobList } from './jobs.tsx'

function status(pkg: PackageInfo): string {
  if (pkg.discontinued) return 'discontinued'
  if (pkg.advisory) return 'security advisory'
  if (!hasUpdate(pkg)) return 'up to date'
  return pkg.upgradable && pkg.upgradable !== pkg.current ? 'update' : 'major update'
}

function Selected({ pkg, disabled }: { pkg: PackageInfo; disabled: boolean }) {
  const compatible = !!pkg.upgradable && pkg.upgradable !== pkg.current
  return (
    <Card title={pkg.name} description={`${pkg.kind === 'dev' ? 'dev dependency' : 'dependency'} · ${pkg.current ?? 'not resolved'}${pkg.latest ? ` · latest ${pkg.latest}` : ''}`}>
      <Stack gap="sm">
        <Grid minItemWidth="xs" gap="sm">
          <Button size="sm" variant="outline" icon="upload" tooltip={`pub upgrade ${pkg.name}`} disabled={disabled || !compatible} onPress={() => actions.pub('upgrade', pkg.name)}>Upgrade</Button>
          <Button size="sm" variant="outline" icon="rocket" tooltip={`pub add ${pkg.name}:^${pkg.latest} (changes the constraint)`} disabled={disabled || !hasUpdate(pkg)} onPress={() => actions.pub('latest', pkg.name, pkg.kind === 'dev')}>Upgrade to latest</Button>
          <Button size="sm" variant="outline" tone="danger" icon="delete" tooltip={`pub remove ${pkg.name}`} disabled={disabled} onPress={() => { void actions.pub('remove', pkg.name); set(packageSelected, []) }}>Remove</Button>
        </Grid>
        <Row gap="md" wrap>
          <Link href={`https://pub.dev/packages/${pkg.name}`}>pub.dev page</Link>
          <Link href={`https://pub.dev/packages/${pkg.name}/changelog`}>Changelog</Link>
        </Row>
      </Stack>
    </Card>
  )
}

export function PackagesTab() {
  const state = read(snapshot)
  const disabled = !!read(busy) || !state.selection || state.jobs.some(job => job.status === 'running')
  const packages = state.packages ?? []
  const outdated = packages.filter(hasUpdate)
  const compatible = outdated.filter(pkg => pkg.upgradable && pkg.upgradable !== pkg.current)
  const flagged = packages.filter(pkg => pkg.discontinued || pkg.advisory)
  const selected = packages.find(pkg => pkg.name === read(packageSelected)[0])
  const checking = state.packagesStatus === 'checking'
  const name = read(newPackage).trim()
  return (
    <Stack gap="md">
      <Grid columns={2} gap="sm">
        <Button size="sm" variant="solid" tone="accent" icon="refresh" disabled={disabled || checking} onPress={actions.checkPackages}>{state.packages ? 'Check again' : 'Check for updates'}</Button>
        <Button size="sm" variant="outline" icon="edit" tooltip="Open in Orca's editor" disabled={!!read(busy) || !state.selection} onPress={actions.openPubspec}>Edit pubspec.yaml</Button>
      </Grid>
      {state.packagesStatus === 'failed' ? <Callout tone="danger" icon="error" title="pub outdated failed">{state.packagesMessage}</Callout> : null}
      {flagged.length ? <Callout tone="danger" icon="warning" title="Needs attention">{flagged.map(pkg => `${pkg.name} (${status(pkg)})`).join(', ')}</Callout> : null}
      {outdated.length ? <Callout tone="warning" icon="info" title={`${outdated.length} package${outdated.length === 1 ? '' : 's'} can be updated`}>
        <Stack gap="sm">
          <Text size="sm">{compatible.length ? `${compatible.length} within your version constraints; the rest need a constraint change (major update).` : 'All need a constraint change (major update).'}</Text>
          <Grid columns={2} gap="sm">
            <Button size="sm" variant="outline" icon="upload" tooltip="pub upgrade" disabled={disabled || !compatible.length} onPress={() => actions.pub('upgrade')}>Upgrade compatible</Button>
            <Button size="sm" variant="outline" icon="rocket" tooltip="pub upgrade --major-versions" disabled={disabled} onPress={() => actions.pub('upgrade-major')}>Upgrade all majors</Button>
          </Grid>
        </Stack>
      </Callout> : state.packages && !checking ? <Callout tone="success" icon="check">All dependencies are up to date.</Callout> : null}
      {state.packages || checking ? <Table label="Dependencies" maxHeight="lg" loading={checking} selectionMode="single" selected={read(packageSelected)} onSelectionChange={({ keys }) => set(packageSelected, keys)} emptyText="No dependencies"
        columns={[{ key: 'name', label: 'Package', minWidth: 'sm' }, { key: 'current', label: 'Current', width: 'sm' }, { key: 'latest', label: 'Latest', width: 'sm', hideBelow: 'sm' }, { key: 'status', label: 'Status', width: 'md', hideBelow: 'md' }]}
        rows={packages.map(pkg => ({ key: pkg.name, cells: { name: pkg.kind === 'dev' ? `${pkg.name} (dev)` : pkg.name, current: pkg.current ?? '–', latest: pkg.latest ?? '–', status: status(pkg) } }))} /> : null}
      {selected ? <Selected pkg={selected} disabled={disabled} /> : state.packages ? <Text muted size="xs">Select a package to upgrade, remove or open it on pub.dev.</Text> : null}
      <Card title="Add a package">
        <Stack gap="sm">
          <Input label="Package name" value={read(newPackage)} placeholder="e.g. http" maxLength={64} disabled={disabled} onChange={value => set(newPackage, value)} />
          <Checkbox label="Dev dependency" checked={read(newPackageDev)} disabled={disabled} onChange={value => set(newPackageDev, value)} />
          <Button size="sm" variant="outline" icon="add" disabled={disabled || !name} onPress={() => { void actions.pub('add', name, read(newPackageDev)); set(newPackage, '') }}>{name ? `Add ${name.toLowerCase()}` : 'Add'}</Button>
          {name ? <Link href={`https://pub.dev/packages?q=${encodeURIComponent(name)}`}>Search pub.dev for “{name}”</Link> : <Link href="https://pub.dev">Browse pub.dev</Link>}
        </Stack>
      </Card>
      <JobList filter={isPackages} empty={{ title: 'No package changes yet', description: 'Upgrades and additions run pub in this package.' }} />
    </Stack>
  )
}

