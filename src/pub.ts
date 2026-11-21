// pub commands for the Packages tab: parse `pub outdated --json`, build add/remove/upgrade args.
import type { PackageInfo } from './types.ts'

export type PubAction = 'add' | 'remove' | 'upgrade' | 'upgrade-major' | 'latest'

const NAME = /^[a-z_][a-z0-9_]{0,63}$/
const VERSION = /^\d+\.\d+\.\d+(?:[-+][\w.-]+)?$/

export function parseOutdated(json: unknown): PackageInfo[] {
  const list = json && typeof json === 'object' && Array.isArray((json as { packages?: unknown }).packages) ? (json as { packages: any[] }).packages : []
  const version = (value: any) => typeof value?.version === 'string' ? value.version : null
  return list.flatMap(item => {
    if (typeof item?.package !== 'string' || !['direct', 'dev'].includes(item.kind)) return []
    // SDK packages (flutter, flutter_test…) report 0.0.0 and have nothing to upgrade.
    if (item.current?.version === '0.0.0' && item.latest?.version === '0.0.0') return []
    return [{ name: item.package, kind: item.kind, current: version(item.current), upgradable: version(item.upgradable), resolvable: version(item.resolvable), latest: version(item.latest), discontinued: item.isDiscontinued === true, advisory: item.isCurrentAffectedByAdvisory === true }]
  }).sort((a, b) => (a.kind === b.kind ? 0 : a.kind === 'direct' ? -1 : 1) || a.name.localeCompare(b.name))
}

/** Arguments after `pub`. `latest` rewrites the constraint to ^latest, like `pub add name:^x`. */
export function pubArgs(action: PubAction, name: string, options: { dev?: boolean; version?: string | null } = {}): string[] {
  if (action === 'upgrade' && !name) return ['upgrade']
  if (action === 'upgrade-major' && !name) return ['upgrade', '--major-versions']
  if (!NAME.test(name)) throw new Error('Package names use lowercase letters, digits and underscores.')
  const dev = options.dev ? 'dev:' : ''
  switch (action) {
    case 'add': return ['add', `${dev}${name}`]
    case 'remove': return ['remove', name]
    case 'upgrade': return ['upgrade', name]
    case 'upgrade-major': return ['upgrade', '--major-versions', name]
    case 'latest':
      if (!options.version || !VERSION.test(options.version)) throw new Error('No newer version is known for this package. Check for updates first.')
      return ['add', `${dev}${name}:^${options.version}`]
  }
}

export const hasUpdate = (pkg: PackageInfo) => !!pkg.current && !!pkg.latest && pkg.current !== pkg.latest
