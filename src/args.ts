// Pure argument builders for `flutter run` / `flutter build`. No I/O, so they are unit-tested directly.
import { buildModes, buildPlatforms, defaultBuild, defaultOptions, type BuildOptions, type BuildPlatform, type RunOptions } from './types.ts'

const LIMIT = 4000
const singleLine = /[\0\r\n]/

/** Split like a POSIX shell: whitespace separates, '…' and "…" group, \ escapes. No expansion of any kind. */
export function splitArgs(text: string): string[] {
  const args: string[] = []
  let current = ''
  let started = false
  let quote: '"' | "'" | null = null
  for (let i = 0; i < text.length; i++) {
    const char = text[i]
    if (quote) {
      if (char === quote) quote = null
      else if (char === '\\' && quote === '"' && i + 1 < text.length) current += text[++i]
      else current += char
    } else if (char === '"' || char === "'") { quote = char; started = true }
    else if (char === '\\' && i + 1 < text.length) { current += text[++i]; started = true }
    else if (/\s/.test(char)) { if (started) args.push(current); current = ''; started = false }
    else { current += char; started = true }
  }
  if (quote) throw new Error('Extra arguments have an unclosed quote.')
  if (started) args.push(current)
  return args
}

/** KEY=VALUE per line; blank lines and # comments ignored. */
export function parseDefines(text: string): string[] {
  // Accept lines pasted from a shell or a command line: export KEY=V, --dart-define=KEY=V.
  return text.split(/\r?\n/).map(line => line.trim().replace(/^export\s+/, '').replace(/^--dart-define=/, '')).filter(line => line && !line.startsWith('#')).map(line => {
    if (!/^[A-Za-z_][\w.]*=/.test(line)) throw new Error(`Dart defines need KEY=VALUE per line: "${line.slice(0, 60)}"`)
    return line
  })
}

const str = (value: unknown, fallback: string) => typeof value === 'string' ? value : fallback

/** Accept stored or panel-sent data defensively: unknown shapes fall back to defaults. */
export function coerceOptions(value: unknown): RunOptions {
  const v = value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}
  const mode = buildModes.includes(v.mode as never) ? v.mode as RunOptions['mode'] : defaultOptions.mode
  return {
    deviceId: str(v.deviceId, ''), target: str(v.target, defaultOptions.target), flavor: str(v.flavor, ''), mode,
    dartDefines: str(v.dartDefines, ''), defineFile: str(v.defineFile, ''), extraArgs: str(v.extraArgs, '')
  }
}

export function coerceBuild(value: unknown): BuildOptions {
  const v = value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}
  return {
    platform: buildPlatforms.includes(v.platform as never) ? v.platform as BuildPlatform : defaultBuild.platform,
    mode: buildModes.includes(v.mode as never) ? v.mode as BuildOptions['mode'] : defaultBuild.mode,
    extraArgs: str(v.extraArgs, '')
  }
}

/** Shape checks shared by save and run. Path checks against the disk live in projects.ts. */
export function checkOptions(options: RunOptions): void {
  for (const [name, value] of [['device', options.deviceId], ['entrypoint', options.target], ['flavor', options.flavor], ['define file', options.defineFile]] as const) {
    if (value.length > 1000 || singleLine.test(value)) throw new Error(`The ${name} must be a single line.`)
  }
  if (!/^[\w.-]{0,80}$/.test(options.flavor)) throw new Error('Use letters, numbers, dots, underscores or dashes for the flavor.')
  if (options.dartDefines.length > LIMIT || options.extraArgs.length > LIMIT) throw new Error('Dart defines and extra arguments are limited to 4000 characters.')
  parseDefines(options.dartDefines)
  splitArgs(options.extraArgs)
}

/** Flags shared by run and build: entrypoint, flavor, defines. */
function commonArgs(options: RunOptions): string[] {
  return [
    '-t', options.target,
    ...(options.flavor ? ['--flavor', options.flavor] : []),
    ...parseDefines(options.dartDefines).map(define => `--dart-define=${define}`),
    ...(options.defineFile ? [`--dart-define-from-file=${options.defineFile}`] : [])
  ]
}

export function runArgs(options: RunOptions): string[] {
  return ['run', '--machine', '-d', options.deviceId, `--${options.mode}`, ...commonArgs(options), ...splitArgs(options.extraArgs)]
}

/** `flutter attach` connects to an app already running on the device (started from Xcode, a test, another tool). */
export function attachArgs(options: RunOptions): string[] {
  return ['attach', '--machine', '-d', options.deviceId, '-t', options.target, ...(options.flavor ? ['--flavor', options.flavor] : [])]
}

export function buildArgs(build: BuildOptions, options: RunOptions): string[] {
  return ['build', build.platform, `--${build.mode}`, ...commonArgs(options), ...splitArgs(build.extraArgs)]
}

/** The command as a person would type it, for display only. */
export function display(args: string[]): string {
  return ['flutter', ...args].map(arg => /^[\w@%+=:,./-]+$/.test(arg) ? arg : `'${arg.replace(/'/g, `'\\''`)}'`).join(' ')
}
