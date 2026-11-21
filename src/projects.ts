import { readdir, readFile, realpath, stat } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { homedir } from 'node:os'
import path from 'node:path'
import { isLocal, type AndroidImage, type Project, type RunOptions, type Workspace } from './types.ts'
import { checkOptions } from './args.ts'

// Directories that never hold a package worth running, and are often huge.
const skip = new Set(['build', 'node_modules', 'Pods', 'ephemeral', 'vendor', 'dist', 'out', 'target', 'coverage', 'DerivedData', 'third_party'])
const MAX_DEPTH = 6
const MAX_DIRS = 6000

export function inside(root: string, candidate: string): boolean {
  const relative = path.relative(root, candidate)
  return relative === '' || (!path.isAbsolute(relative) && relative !== '..' && !relative.startsWith(`..${path.sep}`))
}

export async function projectAt(workspace: Workspace, relativePath: string): Promise<Project> {
  if (!isLocal(workspace)) throw new Error('Flutter tools currently run on local Orca workspaces. Open a local checkout to continue.')
  if (typeof relativePath !== 'string' || path.isAbsolute(relativePath) || relativePath.includes('\0')) throw new Error('Choose a project inside this workspace.')
  const root = await realpath(workspace.path)
  const candidate = await realpath(path.resolve(root, relativePath))
  if (!inside(root, candidate)) throw new Error('The project must stay inside the selected workspace.')
  const pubspec = path.join(candidate, 'pubspec.yaml')
  if ((await stat(pubspec)).size > 128_000) throw new Error('pubspec.yaml is too large to inspect.')
  const text = (await readFile(pubspec, 'utf8')).replace(/^\s*#.*$/gm, '')
  const name = text.match(/^name:\s*['"]?([a-zA-Z0-9_]+)/m)?.[1] ?? path.basename(candidate)
  const kind = /^\s+sdk:\s*flutter\s*(?:#.*)?$/m.test(text) ? 'flutter' : 'dart'
  return { path: candidate, relativePath: path.relative(root, candidate).split(path.sep).join('/') || '.', name, kind, app: existsSync(path.join(candidate, 'lib', 'main.dart')) }
}

/**
 * Breadth-first, so shallow packages win the caps and a monorepo's app (apps/mobile, packages/app…)
 * is found however wide the tree. Hidden and build directories are skipped.
 */
export async function discoverProjects(workspace: Workspace): Promise<Project[]> {
  if (!isLocal(workspace)) return []
  const found: Project[] = []
  let level = ['.']
  let visited = 0
  for (let depth = 0; level.length && depth <= MAX_DEPTH && visited < MAX_DIRS && found.length < 50; depth++) {
    const batch = level.slice(0, MAX_DIRS - visited)
    visited += batch.length
    const next: string[] = []
    // One directory level at a time, read in parallel; results keep their sorted order.
    const listings = await Promise.all(batch.map(relative => readdir(path.join(workspace.path, relative), { withFileTypes: true }).catch(() => [])))
    for (const [index, entries] of listings.entries()) {
      const relative = batch[index]
      if (entries.some(entry => entry.name === 'pubspec.yaml' && entry.isFile())) {
        try { found.push(await projectAt(workspace, relative)) } catch { /* unreadable/outside workspace */ }
      }
      for (const entry of entries.sort((x, y) => x.name.localeCompare(y.name))) {
        if (entry.isDirectory() && !entry.name.startsWith('.') && !skip.has(entry.name)) next.push(path.join(relative, entry.name))
      }
    }
    level = next
  }
  return found.sort((x, y) => rank(y) - rank(x) || x.relativePath.split('/').length - y.relativePath.split('/').length || x.relativePath.localeCompare(y.relativePath))
}

/** Flutter apps first (they have something to run), then Flutter packages, then Dart packages. */
function rank(project: Project): number {
  return (project.kind === 'flutter' ? 2 : 0) + (project.app ? 1 : 0)
}

export interface ToolSettings { flutterExecutable?: string; dartExecutable?: string; androidSdkPath?: string }
export interface Toolchain { flutter: string; dart: string; androidSdk: string | null }

function executableSetting(value: unknown): string {
  if (typeof value !== 'string') return ''
  const trimmed = value.trim()
  if (/[\0\r\n]/.test(trimmed)) throw new Error('SDK executable paths must be a single path.')
  return trimmed
}

export function resolveTools(project: Project, workspace: Workspace, settings: ToolSettings, env: NodeJS.ProcessEnv = process.env): Toolchain {
  const suffix = process.platform === 'win32' ? '.bat' : ''
  let flutter = executableSetting(settings.flutterExecutable)
  if (!flutter) {
    let current = project.path
    while (inside(workspace.path, current)) {
      const fvm = path.join(current, '.fvm', 'flutter_sdk', 'bin', `flutter${suffix}`)
      if (existsSync(fvm)) { flutter = fvm; break }
      const parent = path.dirname(current)
      if (parent === current) break
      current = parent
    }
  }
  flutter ||= `flutter${suffix}`
  let dart = executableSetting(settings.dartExecutable)
  if (!dart && (path.isAbsolute(flutter) || flutter.includes(path.sep))) {
    const sibling = path.join(path.dirname(flutter), `dart${suffix}`)
    if (existsSync(sibling)) dart = sibling
  }
  dart ||= `dart${suffix}`
  const sdkCandidates = [settings.androidSdkPath, env.ANDROID_HOME, env.ANDROID_SDK_ROOT,
    path.join(homedir(), 'Android', 'Sdk'), path.join(homedir(), 'Library', 'Android', 'sdk'),
    env.LOCALAPPDATA ? path.join(env.LOCALAPPDATA, 'Android', 'Sdk') : '']
  const androidSdk = sdkCandidates.find(value => typeof value === 'string' && value.trim() !== '' && existsSync(path.join(value, 'system-images'))) ?? null
  return { flutter, dart, androidSdk }
}

/** FVM keeps SDKs in .fvm/flutter_sdk (a link) or ~/fvm/versions; `flutter upgrade` there would break FVM's copy. */
export function isFvmSdk(flutter: string): boolean {
  return /[\\/](\.fvm|fvm[\\/]versions)[\\/]/.test(flutter)
}

export async function installedImages(sdk: string | null): Promise<AndroidImage[]> {
  if (!sdk) return []
  const images: AndroidImage[] = []
  const root = path.join(sdk, 'system-images')
  try {
    for (const api of await readdir(root, { withFileTypes: true })) {
      if (!api.isDirectory() || !/^android-[\w.-]+$/.test(api.name)) continue
      for (const tag of await readdir(path.join(root, api.name), { withFileTypes: true })) {
        if (!tag.isDirectory() || !/^[\w.-]+$/.test(tag.name)) continue
        for (const abi of await readdir(path.join(root, api.name, tag.name), { withFileTypes: true })) {
          if (!abi.isDirectory() || !/^[\w.-]+$/.test(abi.name)) continue
          if (!existsSync(path.join(root, api.name, tag.name, abi.name, 'system.img'))) continue
          images.push({ id: `system-images;${api.name};${tag.name};${abi.name}`, label: `${api.name} · ${tag.name} · ${abi.name}` })
        }
      }
    }
  } catch { return [] }
  return images.sort((a, b) => b.id.localeCompare(a.id, undefined, { numeric: true }))
}

async function projectFile(project: Project, relative: string, label: string): Promise<string> {
  if (path.isAbsolute(relative) || relative.includes('\0')) throw new Error(`The ${label} must be a relative path in this project.`)
  const file = await realpath(path.resolve(project.path, relative)).catch(() => { throw new Error(`${label[0].toUpperCase()}${label.slice(1)} not found: ${relative}`) })
  if (!inside(project.path, file) || !(await stat(file)).isFile()) throw new Error(`The ${label} must be a file inside the selected project.`)
  return path.relative(project.path, file).split(path.sep).join('/')
}

/** Shape checks plus disk checks: entrypoint and define file must be files inside the project. */
export async function validateRunOptions(project: Project, options: RunOptions, needsDevice = true): Promise<RunOptions> {
  checkOptions(options)
  if (needsDevice && !options.deviceId) throw new Error('Select a connected device first.')
  if (!options.target.endsWith('.dart')) throw new Error('The entrypoint must be a .dart file.')
  return {
    ...options,
    target: await projectFile(project, options.target, 'entrypoint'),
    defineFile: options.defineFile ? await projectFile(project, options.defineFile, 'define file') : ''
  }
}

export function sessionKey(workspaceId: string, projectPath: string): string {
  return JSON.stringify([workspaceId, projectPath])
}
