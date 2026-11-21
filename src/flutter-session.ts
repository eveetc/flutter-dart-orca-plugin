import { ManagedProcess, tail, type Command } from './process.ts'
import { loopbackWsUri, VmService } from './inspector.ts'
import type { BrightnessOverride, DebugToggle, DumpKind, PlatformOverride, Session, WidgetNode } from './types.ts'

interface Pending { resolve: (value: unknown) => void; reject: (error: Error) => void; timer: ReturnType<typeof setTimeout> }

/** The published Flutter machine protocol: no keyboard input into unrelated terminals. */
export class FlutterSession {
  readonly process: ManagedProcess
  private buffer = ''
  private nextId = 1
  private pending = new Map<number, Pending>()
  private stoppedByUser = false
  private vm: VmService | null = null

  constructor(command: Command, readonly state: Session, private changed: () => void) {
    this.process = new ManagedProcess(command, (chunk, stderr) => {
      if (stderr) { this.log(chunk); return }
      this.buffer += chunk
      if (this.buffer.length > 1_000_000) { this.log(this.buffer.slice(-48_000)); this.buffer = '' }
      let newline
      while ((newline = this.buffer.indexOf('\n')) !== -1) {
        const line = this.buffer.slice(0, newline).trim()
        this.buffer = this.buffer.slice(newline + 1)
        this.line(line)
      }
    })
    this.process.child.stdin.on('error', () => this.process.stop())
    void this.process.done.then(result => {
      this.vm?.close(); this.vm = null; this.state.inspectable = false
      if (this.buffer) this.line(this.buffer.trim())
      if (this.state.status !== 'failed') this.state.status = this.stoppedByUser || result.code === 0 ? 'stopped' : 'failed'
      this.state.message = this.state.status === 'failed' ? `Flutter exited with code ${result.code}. See output below.` : 'App stopped.'
      this.rejectPending(new Error('Flutter stopped before answering the request.'))
      this.changed()
    }, error => {
      this.state.status = 'failed'
      this.state.message = `Could not start Flutter: ${error.message}`
      this.log(this.state.message)
      this.rejectPending(error)
    })
  }

  private log(text: string): void { this.state.logs = tail(this.state.logs, text); this.changed() }

  private line(line: string): void {
    if (!line) return
    let messages: unknown
    try { messages = JSON.parse(line) } catch { this.log(`${line}\n`); return }
    if (!Array.isArray(messages)) { this.log(`${line}\n`); return }
    for (const value of messages) {
      if (!value || typeof value !== 'object') continue
      const message = value as Record<string, unknown>
      if (typeof message.id === 'number' && this.pending.has(message.id)) {
        const pending = this.pending.get(message.id)!
        clearTimeout(pending.timer); this.pending.delete(message.id)
        if (message.error) pending.reject(new Error(`Flutter request failed: ${JSON.stringify(message.error)}`))
        else pending.resolve(message.result)
      }
      const params = message.params && typeof message.params === 'object' ? message.params as Record<string, unknown> : {}
      switch (message.event) {
        case 'app.start': if (typeof params.appId === 'string') this.state.appId = params.appId; break
        case 'app.debugPort': {
          const uri = loopbackWsUri(params.wsUri)
          if (uri) { this.vm?.close(); this.vm = new VmService(uri); this.state.inspectable = true }
          break
        }
        case 'app.started': this.state.status = 'running'; this.state.message = 'App running. Hot reload is ready.'; break
        case 'app.stop': this.state.status = 'stopping'; this.state.message = 'App stopped; waiting for Flutter to exit.'; break
        case 'app.log': if (typeof params.log === 'string') this.log(`${params.log}\n`); break
        case 'app.progress': if (typeof params.message === 'string' && params.finished !== true) this.state.message = params.message; break
        case 'app.devTools': {
          if (typeof params.uri === 'string') {
            try {
              const url = new URL(params.uri)
              if (['http:', 'https:'].includes(url.protocol) && ['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname)) this.state.devToolsUrl = url.href
            } catch { /* malformed tool output */ }
          }
          break
        }
        case 'daemon.logMessage': case 'daemon.log': if (typeof params.message === 'string' || typeof params.log === 'string') this.log(`${params.message ?? params.log}\n`); break
      }
      this.changed()
    }
  }

  private request(method: string, params: Record<string, unknown>, timeoutMs = 60_000): Promise<unknown> {
    const id = this.nextId++
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { this.pending.delete(id); reject(new Error('Flutter did not answer in time. Check the app output.')) }, timeoutMs)
      this.pending.set(id, { resolve, reject, timer })
      try { this.process.write(`${JSON.stringify([{ id, method, params }])}\n`) }
      catch (error) { clearTimeout(timer); this.pending.delete(id); reject(error) }
    })
  }

  async control(action: 'reload' | 'restart' | 'stop'): Promise<void> {
    if (action === 'stop') {
      this.stoppedByUser = true
      this.state.status = 'stopping'; this.state.message = 'Stopping app…'; this.changed()
      try {
        if (this.state.appId) await this.request('app.stop', { appId: this.state.appId }, 5000)
      } finally { this.process.stop() }
      return
    }
    if (this.state.status !== 'running' || !this.state.appId) throw new Error('Wait until Flutter has started the app before reloading.')
    const result = await this.request('app.restart', { appId: this.state.appId, fullRestart: action === 'restart', pause: false, reason: 'manual' })
    if (result && typeof result === 'object' && 'code' in result && result.code !== 0) throw new Error('message' in result ? String(result.message) : 'Flutter reload failed.')
    this.state.message = action === 'restart' ? 'Hot restart finished.' : 'Hot reload finished.'
    this.changed()
  }

  private inspector(): VmService {
    if (!this.vm || this.state.status !== 'running') throw new Error('Run the app in debug or profile mode to inspect widgets.')
    return this.vm
  }

  widgetTree(root: string): Promise<WidgetNode | null> { return this.inspector().widgetTree(root) }

  async toggle(toggle: DebugToggle, enabled: boolean): Promise<void> {
    await this.inspector().toggle(toggle, enabled)
    this.state.toggles = { ...this.state.toggles, [toggle]: enabled }
    this.changed()
  }

  async platform(value: PlatformOverride): Promise<void> {
    await this.inspector().platform(value)
    this.state.platform = value; this.changed()
  }

  async brightness(value: BrightnessOverride): Promise<void> {
    await this.inspector().brightness(value)
    this.state.brightness = value; this.changed()
  }

  dump(kind: DumpKind): Promise<string> { return this.inspector().dump(kind) }

  /** For `flutter screenshot --type=rasterizer`, which works on every platform. */
  vmServiceHttpUri(): string { return this.inspector().httpUri }

  dispose(): void { this.vm?.close(); this.stoppedByUser = true; this.rejectPending(new Error('Plugin stopped.')); this.process.stop() }
  private rejectPending(error: Error): void {
    for (const pending of this.pending.values()) { clearTimeout(pending.timer); pending.reject(error) }
    this.pending.clear()
  }
}
