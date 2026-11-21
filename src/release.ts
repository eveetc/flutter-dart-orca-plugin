// Static release-signing checks. Reads build files only; never returns key or password values.
import { readFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import path from 'node:path'
import type { ReleaseCheck } from './types.ts'

const read = (file: string) => readFile(file, 'utf8').catch(() => null)
const stripComments = (text: string) => text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1')

/** Java .properties: key=value or key: value, # and ! comments. */
export function parseProperties(text: string): Map<string, string> {
  const map = new Map<string, string>()
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim()
    if (!line || line.startsWith('#') || line.startsWith('!')) continue
    const match = line.match(/^([^=:\s]+)\s*[=:]\s*(.*)$/)
    if (match) map.set(match[1], match[2].trim())
  }
  return map
}

/** The body of `release { … }` inside `buildTypes { … }`, brace-matched. */
function block(text: string, opener: RegExp): string | null {
  const match = opener.exec(text)
  if (!match) return null
  let depth = 0
  for (let i = match.index + match[0].length - 1; i < text.length; i++) {
    if (text[i] === '{') depth++
    else if (text[i] === '}' && --depth === 0) return text.slice(match.index + match[0].length, i)
  }
  return null
}

export async function androidSigning(projectPath: string): Promise<ReleaseCheck> {
  const check: ReleaseCheck = { platform: 'android', level: 'ok', messages: [] }
  const warn = (message: string, level: ReleaseCheck['level'] = 'warning') => { check.messages.push(message); if (level === 'error' || check.level === 'ok') check.level = level }
  const android = path.join(projectPath, 'android')
  const gradleFile = ['build.gradle.kts', 'build.gradle'].map(name => path.join(android, 'app', name)).find(existsSync)
  if (!gradleFile) { check.level = 'none'; return check }
  const gradle = stripComments((await read(gradleFile)) ?? '')
  const buildTypes = block(gradle, /buildTypes\s*\{/)
  const release = buildTypes ? block(buildTypes, /(?:getByName\(\s*"release"\s*\)|release)\s*\{/) : null
  const signing = release?.match(/signingConfig\s*=?\s*signingConfigs\s*(?:\.getByName\(\s*"(\w+)"\s*\)|\.(\w+))/)
  const config = signing?.[1] ?? signing?.[2]
  if (!config) warn('The release build type has no signingConfig, so release builds come out unsigned.', 'error')
  else if (config === 'debug') warn('Release builds are signed with the debug key. Google Play rejects them; add a release keystore.', 'error')
  if (config && config !== 'debug') {
    if (/System\.getenv|providers\.environmentVariable/.test(gradle)) check.messages.push('Signing reads environment variables; make sure they are set where you build.')
    if (gradle.includes('key.properties')) {
      const file = path.join(android, 'key.properties')
      const text = await read(file)
      if (text === null) warn('android/key.properties is missing, so release signing will fail. It is usually gitignored: in a new worktree, copy it (and the keystore) from your main checkout.', 'error')
      else {
        const props = parseProperties(text)
        const missing = ['storeFile', 'storePassword', 'keyAlias', 'keyPassword'].filter(key => !props.get(key))
        if (missing.length) warn(`android/key.properties is missing: ${missing.join(', ')}.`, 'error')
        const store = props.get('storeFile')
        // Gradle's file() in the app module resolves relative paths against android/app.
        if (store && !existsSync(path.isAbsolute(store) ? store : path.join(android, 'app', store))) warn(`The keystore named in key.properties (storeFile) does not exist.`, 'error')
      }
    }
  }
  return check
}

export async function iosSigning(projectPath: string): Promise<ReleaseCheck> {
  const pbx = await read(path.join(projectPath, 'ios', 'Runner.xcodeproj', 'project.pbxproj'))
  if (pbx === null) return { platform: 'ios', level: 'none', messages: [] }
  if (!/DEVELOPMENT_TEAM\s*=\s*"?[A-Z0-9]{6,}"?/.test(pbx)) return { platform: 'ios', level: 'warning', messages: ['No development team is set for Runner. Choose one under Signing & Capabilities in Xcode before building an .ipa.'] }
  return { platform: 'ios', level: 'ok', messages: [] }
}

export async function releaseChecks(projectPath: string): Promise<ReleaseCheck[]> {
  return Promise.all([androidSigning(projectPath), iosSigning(projectPath)])
}
