// Talks to a running app's Dart VM service (the same service DevTools uses) for the widget tree and
// debug toggles. Only loopback URIs reported by `flutter run --machine` are accepted.
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import { inside } from './projects.ts'
import type { BrightnessOverride, DebugToggle, DumpKind, PlatformOverride, WidgetNode } from './types.ts'

const GROUP = 'orca-flutter-tools'
const MAX_NODES = 3000

/** Service extensions behind each toggle. `inspector` is "select widget mode" on the device. */
const toggleExtensions: Record<DebugToggle, string> = {
  inspector: 'ext.flutter.inspector.show',
  paint: 'ext.flutter.debugPaint',
  performance: 'ext.flutter.showPerformanceOverlay',
  banner: 'ext.flutter.debugAllowBanner',
  slowAnimations: 'ext.flutter.timeDilation'
}

export function loopbackWsUri(value: unknown): string | null {
  if (typeof value !== 'string') return null
  try {
    const url = new URL(value)
    return ['ws:', 'wss:'].includes(url.protocol) && ['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname) ? url.href : null
  } catch { return null }
}

export class VmService {
  private socket: WebSocket | null = null
  private opening: Promise<WebSocket> | null = null
  private nextId = 1
  private pending = new Map<number, { resolve: (value: any) => void; reject: (error: Error) => void }>()
  private isolateId: string | null = null

  constructor(private uri: string) {}

  private open(): Promise<WebSocket> {
    if (this.socket?.readyState === WebSocket.OPEN) return Promise.resolve(this.socket)
    this.opening ??= new Promise<WebSocket>((resolve, reject) => {
      const socket = new WebSocket(this.uri)
      const timer = setTimeout(() => { socket.close(); reject(new Error('The app’s VM service did not answer. Is the app still running?')) }, 10_000)
      socket.onopen = () => { clearTimeout(timer); this.socket = socket; resolve(socket) }
      socket.onerror = () => { clearTimeout(timer); reject(new Error('Could not connect to the app’s VM service.')) }
      socket.onclose = () => { this.socket = null; this.isolateId = null; this.fail(new Error('The app’s VM service closed.')) }
      socket.onmessage = event => {
        let message: any
        try { message = JSON.parse(String(event.data)) } catch { return }
        const pending = typeof message?.id === 'number' ? this.pending.get(message.id) : undefined
        if (!pending) return
        this.pending.delete(message.id)
        if (message.error) pending.reject(new Error(message.error.message ?? 'VM service request failed.'))
        else pending.resolve(message.result)
      }
    }).finally(() => { this.opening = null })
    return this.opening
  }

  private async call(method: string, params: Record<string, unknown> = {}): Promise<any> {
    const socket = await this.open()
    const id = this.nextId++
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { this.pending.delete(id); reject(new Error('The app did not answer in time.')) }, 20_000)
      this.pending.set(id, { resolve: value => { clearTimeout(timer); resolve(value) }, reject: error => { clearTimeout(timer); reject(error) } })
      socket.send(JSON.stringify({ jsonrpc: '2.0', id, method, params }))
    })
  }

  /** The Flutter UI isolate: the first one that registered the inspector extensions. */
  private async isolate(): Promise<string> {
    if (this.isolateId) return this.isolateId
    const vm = await this.call('getVM')
    for (const ref of vm?.isolates ?? []) {
      const isolate = await this.call('getIsolate', { isolateId: ref.id })
      if (isolate?.extensionRPCs?.includes('ext.flutter.inspector.getRootWidgetTree')) return (this.isolateId = ref.id)
    }
    throw new Error('The widget inspector is only available for debug and profile builds of a Flutter app.')
  }

  private async extension(method: string, params: Record<string, string> = {}): Promise<any> {
    return this.call(method, { isolateId: await this.isolate(), ...params })
  }

  /** The summary tree: widgets created by your project, as Android Studio's inspector shows by default. */
  async widgetTree(root: string): Promise<WidgetNode | null> {
    await this.extension('ext.flutter.inspector.disposeGroup', { objectGroup: GROUP }).catch(() => {})
    const result = await this.extension('ext.flutter.inspector.getRootWidgetTree', { groupName: GROUP, isSummaryTree: 'true', withPreviews: 'true', fullDetails: 'true' })
    return toWidgetNode(result?.result ?? result, root)
  }

  async toggle(toggle: DebugToggle, enabled: boolean): Promise<void> {
    const method = toggleExtensions[toggle]
    const value = toggle === 'slowAnimations' ? (enabled ? '5.0' : '1.0') : String(enabled)
    await this.extension(method, toggle === 'slowAnimations' ? { timeDilation: value } : { enabled: value })
  }

  async platform(value: PlatformOverride): Promise<void> {
    await this.extension('ext.flutter.platformOverride', { value })
  }

  async brightness(value: BrightnessOverride): Promise<void> {
    await this.extension('ext.flutter.brightnessOverride', { value: value === 'default' ? 'default' : `Brightness.${value}` })
  }

  /** The text dumps Flutter prints for debugDumpApp / RenderTree / LayerTree / SemanticsTree. */
  async dump(kind: DumpKind): Promise<string> {
    const method = { widgets: 'ext.flutter.debugDumpApp', render: 'ext.flutter.debugDumpRenderTree', layers: 'ext.flutter.debugDumpLayerTree', semantics: 'ext.flutter.debugDumpSemanticsTreeInTraversalOrder' }[kind]
    const result = await this.extension(method)
    const text = typeof result?.data === 'string' ? result.data : ''
    return text.length > 400_000 ? `${text.slice(0, 400_000)}\n… (cut at 400 KB)` : text || 'Flutter returned an empty dump.'
  }

  /** The VM service's HTTP address, which `flutter screenshot --vm-service-url` takes. */
  get httpUri(): string { return this.uri.replace(/^ws/, 'http').replace(/ws\/?$/, '') }

  close(): void { this.socket?.close(); this.fail(new Error('Inspector closed.')) }
  private fail(error: Error): void { for (const pending of this.pending.values()) pending.reject(error); this.pending.clear() }
}

/** Convert inspector JSON into small plain nodes. Paths outside the workspace are dropped. */
export function toWidgetNode(raw: any, root: string): WidgetNode | null {
  let count = 0
  const visit = (node: any, key: string): WidgetNode | null => {
    if (!node || typeof node !== 'object' || ++count > MAX_NODES) return null
    const location = node.creationLocation
    let file: string | null = null
    if (typeof location?.file === 'string') {
      try {
        const absolute = location.file.startsWith('file:') ? fileURLToPath(location.file) : location.file
        if (path.isAbsolute(absolute) && inside(root, absolute)) file = path.relative(root, absolute).split(path.sep).join('/')
      } catch { /* not a file URI */ }
    }
    const name = String(node.widgetRuntimeType ?? node.description ?? 'Widget')
    const preview = typeof node.textPreview === 'string' ? ` "${node.textPreview.slice(0, 40)}"` : ''
    const children = Array.isArray(node.children) ? node.children.map((child: unknown, i: number) => visit(child, `${key}.${i}`)).filter(Boolean) as WidgetNode[] : []
    return { id: key, label: `${name}${preview}`, file, line: typeof location?.line === 'number' ? location.line : null, children }
  }
  return visit(raw, 'w')
}
