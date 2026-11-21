import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'

export interface Command { executable: string; args: string[]; cwd: string }
export interface Result { code: number; stdout: string; stderr: string }
export const OUTPUT_LIMIT = 48_000

export function tail(text: string, addition: string, limit = OUTPUT_LIMIT): string {
  const combined = text + addition
  return combined.length > limit ? combined.slice(-limit) : combined
}

/** .bat files require cmd.exe; reject shell metacharacters rather than interpolating them. */
export function spawnSpec(command: Command, platform: string = process.platform): { executable: string; args: string[]; verbatim: boolean } {
  if (platform !== 'win32' || !/\.(bat|cmd)$/i.test(command.executable)) {
    return { executable: command.executable, args: command.args, verbatim: false }
  }
  const values = [command.executable, ...command.args]
  if (values.some(value => /["\r\n&|<>^%!]/.test(value))) {
    throw new Error('Windows SDK paths and arguments cannot contain shell metacharacters. Use a simple SDK/project path.')
  }
  return { executable: 'cmd.exe', args: ['/d', '/s', '/c', `"${values.map(value => `"${value}"`).join(' ')}"`], verbatim: true }
}

export class ManagedProcess {
  readonly child: ChildProcessWithoutNullStreams
  readonly done: Promise<Result>
  private finished = false
  private stdout = ''
  private stderr = ''
  private forceTimer?: ReturnType<typeof setTimeout>

  /** `keep`: how much stdout/stderr `done` returns. Logs only need the tail; parsed JSON needs all of it. */
  constructor(command: Command, onOutput: (chunk: string, stderr: boolean) => void = () => {}, env: NodeJS.ProcessEnv = process.env, private keep = OUTPUT_LIMIT) {
    const spec = spawnSpec(command)
    this.child = spawn(spec.executable, spec.args, {
      cwd: command.cwd, env, shell: false, stdio: 'pipe', windowsHide: true,
      windowsVerbatimArguments: spec.verbatim, detached: process.platform !== 'win32'
    })
    this.child.stdout.setEncoding('utf8')
    this.child.stderr.setEncoding('utf8')
    this.child.stdout.on('data', (chunk: string) => { this.stdout = tail(this.stdout, chunk, this.keep); onOutput(chunk, false) })
    this.child.stderr.on('data', (chunk: string) => { this.stderr = tail(this.stderr, chunk, this.keep); onOutput(chunk, true) })
    this.done = new Promise((resolve, reject) => {
      this.child.once('error', error => { this.finished = true; clearTimeout(this.forceTimer); reject(error) })
      this.child.once('close', code => {
        this.finished = true
        clearTimeout(this.forceTimer)
        resolve({ code: code ?? -1, stdout: this.stdout, stderr: this.stderr })
      })
    })
  }

  write(data: string): void {
    if (this.finished || this.child.stdin.destroyed) throw new Error('The Flutter process has stopped. Run the app again.')
    this.child.stdin.write(data)
  }

  stop(): void {
    if (this.finished || this.forceTimer) return
    this.kill(false)
    this.forceTimer = setTimeout(() => this.kill(true), 2500)
    this.forceTimer.unref()
  }

  private kill(force: boolean): void {
    if (this.finished || !this.child.pid) return
    if (process.platform === 'win32') {
      const killer = spawn('taskkill.exe', ['/pid', String(this.child.pid), '/t', ...(force ? ['/f'] : [])], { stdio: 'ignore', windowsHide: true })
      killer.on('error', () => { this.child.kill() })
      killer.unref()
    } else {
      try { process.kill(-this.child.pid, force ? 'SIGKILL' : 'SIGTERM') } catch { /* already exited */ }
    }
  }
}

export async function capture(command: Command, options: { timeoutMs?: number; signal?: AbortSignal; env?: NodeJS.ProcessEnv } = {}): Promise<Result> {
  if (options.signal?.aborted) throw new Error('Command cancelled.')
  // Captured output is parsed (pub outdated --json can be hundreds of KB), so keep it whole up to 16 MB.
  const child = new ManagedProcess(command, undefined, options.env, 16_000_000)
  let timedOut = false
  const timer = setTimeout(() => { timedOut = true; child.stop() }, options.timeoutMs ?? 30_000)
  const abort = () => child.stop()
  options.signal?.addEventListener('abort', abort, { once: true })
  try {
    const result = await child.done
    if (timedOut) throw new Error('Command timed out. Check the SDK installation and try again.')
    if (options.signal?.aborted) throw new Error('Command cancelled.')
    return result
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code
    if (code === 'ENOENT') throw new Error(`Executable not found: ${command.executable}. Configure its path in Flutter & Dart plugin settings.`)
    throw error
  } finally {
    clearTimeout(timer)
    options.signal?.removeEventListener('abort', abort)
  }
}

/** Flutter prints progress around its JSON; accept only a complete JSON array/object. */
export function parseToolJson(text: string): unknown {
  const clean = text.replace(/\u001b\[[0-9;]*m/g, '').trim()
  try { return JSON.parse(clean) } catch { /* Flutter may have printed setup output first */ }
  for (let offset = 0; offset < clean.length; offset++) {
    if (clean[offset] !== '[' && clean[offset] !== '{') continue
    try { return JSON.parse(clean.slice(offset)) } catch { /* try the next opener */ }
  }
  throw new Error('The SDK did not return valid machine-readable output. Run Flutter Doctor to check the installation.')
}

/**
 * `flutter emulators` as text: newer Flutter refuses `--machine` there. Rows look like
 * `id • name • manufacturer • platform`; the header row starts with "Id".
 */
export function parseEmulators(text: string): { id: string; name: string; platform: string }[] {
  return text.split(/\r?\n/).flatMap(line => {
    const cells = line.split('•').map(cell => cell.trim())
    if (cells.length < 4 || !cells[0] || cells[0] === 'Id' || /\s/.test(cells[0])) return []
    return [{ id: cells[0], name: cells[1] || cells[0], platform: cells[cells.length - 1] }]
  })
}
