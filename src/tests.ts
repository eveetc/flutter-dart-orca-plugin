// Test overview: test files → groups → tests, built from the JSON reporter that `flutter test --machine`
// and `dart test --reporter json` print. Nodes are keyed by file and full name, so re-running one test
// updates it in place and keeps every other result.
import { readdir } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import type { TestNode, TestStatus } from './types.ts'

/** Stored form: children by key. The panel gets `TestNode`s with nested children instead. */
type Node = Omit<TestNode, 'children'> & { children: string[] }

const OUTPUT_LIMIT = 16_000
const TEST_DIRS = ['test', 'integration_test']

export const nodeKey = (file: string, fullName = '') => fullName ? `${file}::${fullName}` : file

/** `*_test.dart` files under test/ and integration_test/, project-relative with forward slashes. */
export async function findTestFiles(projectPath: string): Promise<string[]> {
  const files: string[] = []
  async function visit(relative: string, depth: number): Promise<void> {
    if (depth > 8 || files.length >= 500) return
    let entries
    try { entries = await readdir(path.join(projectPath, relative), { withFileTypes: true }) } catch { return }
    for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
      const child = path.join(relative, entry.name)
      if (entry.isDirectory() && !entry.name.startsWith('.')) await visit(child, depth + 1)
      else if (entry.isFile() && entry.name.endsWith('_test.dart')) files.push(child.split(path.sep).join('/'))
    }
  }
  for (const dir of TEST_DIRS) await visit(dir, 0)
  return files
}

/** The whole tree for one package, plus what the current run maps its numeric ids to. */
export class TestTree {
  readonly nodes = new Map<string, Node>()
  readonly roots: string[] = []
  private suites = new Map<number, string>()
  private groups = new Map<number, string>()
  private tests = new Map<number, string>()
  log = ''

  constructor(private projectPath: string) {}

  setFiles(files: string[]): void {
    for (const file of files) this.ensureFile(file)
    // Files deleted since the last listing go away unless a run is reporting on them.
    for (const key of [...this.roots]) if (!files.includes(key) && this.nodes.get(key)?.status !== 'running') this.remove(key)
  }

  private ensureFile(file: string): Node {
    let node = this.nodes.get(file)
    if (!node) {
      node = { key: file, name: file.replace(/^test\//, ''), kind: 'file', file, fullName: '', line: null, status: 'idle', output: '', children: [] }
      this.nodes.set(file, node)
      this.roots.push(file)
      this.roots.sort()
    }
    return node
  }

  private remove(key: string): void {
    const node = this.nodes.get(key)
    if (!node) return
    for (const child of node.children) this.remove(child)
    this.nodes.delete(key)
    const index = this.roots.indexOf(key)
    if (index >= 0) this.roots.splice(index, 1)
  }

  private child(parent: Node, node: Node): Node {
    const existing = this.nodes.get(node.key)
    if (existing) return existing
    this.nodes.set(node.key, node)
    parent.children.push(node.key)
    return node
  }

  /** Marks the part of the tree a run covers; ids from a previous run no longer apply. */
  start(scope: string[]): void {
    this.suites.clear(); this.groups.clear(); this.tests.clear(); this.log = ''
    const mark = (key: string) => {
      const node = this.nodes.get(key)
      if (!node) return
      if (node.kind === 'test') { node.status = 'running'; node.output = '' }
      node.children.forEach(mark)
    }
    ;(scope.length ? scope : this.roots).forEach(mark)
  }

  /** Tests still `running` when the process ends were not reported (renamed, removed, compile error). */
  finish(): void {
    for (const node of this.nodes.values()) if (node.kind === 'test' && node.status === 'running') node.status = 'idle'
  }

  private relative(file: string): string {
    const absolute = file.startsWith('file:') ? fileURLToPath(file) : file
    return path.isAbsolute(absolute) ? path.relative(this.projectPath, absolute).split(path.sep).join('/') : absolute
  }

  apply(event: any): void {
    if (!event || typeof event !== 'object') return
    switch (event.type) {
      case 'suite': {
        if (typeof event.suite?.path !== 'string') return
        const file = this.relative(event.suite.path)
        this.suites.set(event.suite.id, file)
        this.ensureFile(file)
        return
      }
      case 'group': {
        const group = event.group
        const file = this.suites.get(group?.suiteID)
        if (!file || !group.name) return // the unnamed root group of each file
        const parent = this.nodes.get((group.parentID != null && this.groups.get(group.parentID)) || file)
        if (!parent) return
        const node = this.child(parent, { key: nodeKey(file, group.name), name: strip(group.name, parent.fullName), kind: 'group', file, fullName: group.name, line: group.line ?? null, status: 'idle', output: '', children: [] })
        this.groups.set(group.id, node.key)
        return
      }
      case 'testStart': {
        const test = event.test
        const file = this.suites.get(test?.suiteID)
        if (!file || !Array.isArray(test.groupIDs) || (!test.groupIDs.length && String(test.name).startsWith('loading '))) return
        const groupKey = [...test.groupIDs].reverse().map((id: number) => this.groups.get(id)).find(Boolean)
        const parent = this.nodes.get(groupKey || file)
        if (!parent) return
        // Widget tests report flutter_test's line; root_line is the line in your test file.
        const line = test.root_line ?? test.line ?? null
        const node = this.child(parent, { key: nodeKey(file, test.name), name: strip(test.name, parent.fullName), kind: 'test', file, fullName: test.name, line, status: 'running', output: '', children: [] })
        node.status = 'running'; node.output = ''; node.line = line
        this.tests.set(test.id, node.key)
        return
      }
      case 'print': case 'error': {
        const node = this.nodes.get(this.tests.get(event.testID) ?? '')
        const text = event.type === 'print' ? `${event.message}\n` : `${event.error}\n${event.stackTrace ?? ''}\n`
        if (node) node.output = (node.output + text).slice(-OUTPUT_LIMIT)
        else this.addLog(text)
        return
      }
      case 'testDone': {
        const node = this.nodes.get(this.tests.get(event.testID) ?? '')
        if (!node) return
        node.status = event.skipped ? 'skipped' : event.result === 'success' ? 'passed' : 'failed'
        return
      }
    }
  }

  addLog(text: string): void { this.log = (this.log + text).slice(-OUTPUT_LIMIT) }

  status(key: string): TestStatus {
    const node = this.nodes.get(key)
    if (!node) return 'idle'
    if (node.kind === 'test') return node.status
    const statuses = node.children.map(child => this.status(child))
    if (statuses.includes('running')) return 'running'
    if (statuses.includes('failed')) return 'failed'
    if (statuses.length && statuses.every(status => status === 'skipped')) return 'skipped'
    if (statuses.length && statuses.every(status => status === 'passed' || status === 'skipped')) return 'passed'
    return 'idle'
  }

  /** A JSON copy for the panel, with group and file statuses rolled up from their tests. */
  snapshot(): TestNode[] {
    const copy = (key: string): TestNode => {
      const node = this.nodes.get(key)!
      return { ...node, status: this.status(key), children: node.children.map(copy) }
    }
    return this.roots.map(copy)
  }

  failed(): Node[] { return [...this.nodes.values()].filter(node => node.kind === 'test' && node.status === 'failed') }

  counts(): Record<TestStatus, number> {
    const counts: Record<TestStatus, number> = { idle: 0, running: 0, passed: 0, failed: 0, skipped: 0 }
    for (const node of this.nodes.values()) if (node.kind === 'test') counts[node.status]++
    return counts
  }
}

/** "math nested multiplies" under group "math nested" shows as "multiplies". */
function strip(name: string, parent: string): string {
  return parent && name.startsWith(`${parent} `) ? name.slice(parent.length + 1) : name
}

/** Line and hit totals from an lcov file, as a percentage. */
export function lcovPercent(text: string): number | null {
  let found = 0, hit = 0
  for (const line of text.split('\n')) {
    if (line.startsWith('LF:')) found += Number(line.slice(3)) || 0
    else if (line.startsWith('LH:')) hit += Number(line.slice(3)) || 0
  }
  return found ? Math.round((hit / found) * 1000) / 10 : null
}
