import { readdir, readFile, writeFile, mkdir, access } from 'node:fs/promises'
import { constants as fsConstants } from 'node:fs'
import { join, relative } from 'node:path'
import { promptAi, type AiProvider } from './ai_client.js'
import type {
  AllSummaryEntry,
  Glossary,
  MissingSummaryEntry,
  TranslationMap,
} from './types.js'

async function pathExists(path: string): Promise<boolean> {
  try {
    await access(path, fsConstants.F_OK)
    return true
  } catch {
    return false
  }
}

async function readJsonFile<T>(path: string): Promise<T | null> {
  if (!(await pathExists(path))) {
    return null
  }
  const raw = await readFile(path, 'utf8')
  try {
    return JSON.parse(raw) as T
  } catch {
    return null
  }
}

export async function writeJsonFile(path: string, data: Record<string, unknown>): Promise<void> {
  const dir = join(path, '..')
  await mkdir(dir, { recursive: true })
  await writeFile(path, `${JSON.stringify(data, null, 2)}\n`, 'utf8')
}

export class TranslationManager {
  private glossary: Glossary = {}

  constructor(
    private readonly glossaryPath: string,
    private readonly appRoot: string
  ) {}

  async init(): Promise<void> {
    const data = await readJsonFile<Glossary>(this.glossaryPath)
    if (data && typeof data === 'object') {
      this.glossary = data
    }
  }

  buildGlossaryPrompt(targetLocale: string): string {
    const parts: string[] = []
    const neverTranslate = this.glossary.never_translate ?? []

    if (neverTranslate.length > 0) {
      const terms = neverTranslate.map((t) => `"${t}"`).join(', ')
      parts.push(
        `IMPORTANT: The following terms are brand names or technical terms and must NEVER be translated. Keep them exactly as-is in the output: ${terms}. `
      )
    }

    const specificTranslations = this.glossary.specific_translations ?? {}
    const localeOverrides: string[] = []
    for (const [term, locales] of Object.entries(specificTranslations)) {
      if (locales[targetLocale]) {
        localeOverrides.push(`"${term}" must be translated as "${locales[targetLocale]}"`)
      }
    }

    if (localeOverrides.length > 0) {
      parts.push(`Use these mandatory translations: ${localeOverrides.join('; ')}. `)
    }

    return parts.join('')
  }

  applyGlossaryOverrides(
    translations: Record<string, unknown>,
    targetLocale: string
  ): Record<string, unknown> {
    const specificTranslations = this.glossary.specific_translations ?? {}
    const result = { ...translations }

    for (const [key, value] of Object.entries(result)) {
      if (typeof value !== 'string') continue

      let next = value
      for (const [term, locales] of Object.entries(specificTranslations)) {
        if (locales[targetLocale] && next.toLowerCase().includes(term.toLowerCase())) {
          next = next.replace(new RegExp(term, 'gi'), locales[targetLocale]!)
        }
      }
      result[key] = next
    }

    return result
  }

  resolveModelName(model: string): string {
    if (model === 'claude') return 'claude-3-5-sonnet-20241022'
    if (model === 'gemini') return 'gemini-1.5-flash'
    return model
  }

  resolveProvider(model: string): AiProvider {
    const actual = this.resolveModelName(model)
    if (actual.startsWith('claude')) return 'anthropic'
    if (actual.startsWith('gemini') || actual.startsWith('gemma')) return 'gemini'
    throw new Error(`Unknown or unsupported model prefix: ${actual}`)
  }

  parseJsonResponse(content: string | null | undefined): Record<string, unknown> | null {
    if (!content) return null

    let text = content
    const fenced = text.match(/```json\s*([\s\S]*?)\s*```/)
    if (fenced?.[1]) {
      text = fenced[1]
    } else {
      text = text.trim()
    }

    try {
      return JSON.parse(text) as Record<string, unknown>
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      throw new Error(`Failed to parse JSON response: ${message}`)
    }
  }

  async callAi(
    prompt: string,
    model: string,
    provider: AiProvider
  ): Promise<Record<string, unknown> | null> {
    const text = await promptAi(prompt, model, provider)
    return this.parseJsonResponse(text)
  }

  async translateChunk(
    chunk: TranslationMap,
    targetLocale: string,
    model: string,
    defaultLang: string,
    multiple = false,
    context: string | null = null
  ): Promise<Record<string, unknown> | null> {
    const glossaryInstructions = this.buildGlossaryPrompt(targetLocale)
    const contextLine = context ? `Context: ${context}\n` : ''

    let prompt: string
    if (multiple) {
      prompt =
        contextLine +
        `Translate the following JSON key-value pairs from ${defaultLang} to ${targetLocale}. ` +
        'Keep the keys exactly the same. Do not translate placeholders like :name or {value}. ' +
        glossaryInstructions +
        'Provide 3 distinct translation variations for each key. ' +
        'Return ONLY a valid JSON object where keys are the same, and the value is a JSON array of 3 strings. No markdown formatting or other text.\n\n' +
        JSON.stringify(chunk, null, 2)
    } else {
      prompt =
        contextLine +
        `Translate the following JSON key-value pairs from ${defaultLang} to ${targetLocale}. ` +
        'Keep the keys exactly the same. Do not translate placeholders like :name or {value}. ' +
        glossaryInstructions +
        'Return ONLY a valid JSON object without markdown formatting or other text.\n\n' +
        JSON.stringify(chunk, null, 2)
    }

    const actualModel = this.resolveModelName(model)
    const provider = this.resolveProvider(model)
    return this.callAi(prompt, actualModel, provider)
  }

  async findKeyContextInCode(key: string): Promise<string | null> {
    const candidateDirs = [
      join(this.appRoot, 'resources', 'views'),
      join(this.appRoot, 'app'),
      join(this.appRoot, 'resources', 'js'),
      join(this.appRoot, 'start'),
      join(this.appRoot, 'inertia'),
    ]

    const dirs: string[] = []
    for (const dir of candidateDirs) {
      if (await pathExists(dir)) dirs.push(dir)
    }
    if (dirs.length === 0) return null

    const extensions = new Set(['.ts', '.js', '.edge', '.vue', '.jsx', '.tsx', '.php'])
    const usages: string[] = []
    const appRoot = this.appRoot

    async function walk(dir: string): Promise<void> {
      if (usages.length >= 3) return
      let entries
      try {
        entries = await readdir(dir, { withFileTypes: true })
      } catch {
        return
      }

      for (const entry of entries) {
        if (usages.length >= 3) return
        const full = join(dir, entry.name)
        if (entry.isDirectory()) {
          if (entry.name === 'node_modules' || entry.name === 'dist' || entry.name === 'build') {
            continue
          }
          await walk(full)
          continue
        }
        const ext = entry.name.slice(entry.name.lastIndexOf('.'))
        if (!extensions.has(ext)) continue

        let contents: string
        try {
          contents = await readFile(full, 'utf8')
        } catch {
          continue
        }
        if (!contents.includes(key)) continue

        const lines = contents.split('\n')
        for (let i = 0; i < lines.length; i++) {
          if (!lines[i]!.includes(key)) continue
          const start = Math.max(0, i - 1)
          const end = Math.min(lines.length - 1, i + 1)
          const snippet = lines.slice(start, end + 1).join('\n')
          const filename = relative(appRoot, full)
          usages.push(`File: ${filename}\nCode snippet:\n${snippet}`)
          if (usages.length >= 3) break
        }
      }
    }

    for (const dir of dirs) {
      await walk(dir)
      if (usages.length >= 3) break
    }

    if (usages.length === 0) return null

    return (
      'This text is used in the following codebase locations (use this to understand the context of how to translate it):\n\n' +
      usages.join('\n\n---\n\n')
    )
  }

  resolveMissingKeys(
    baseTranslations: TranslationMap,
    existingTranslations: TranslationMap,
    specificKeys: string[] = [],
    translateAll = false
  ): TranslationMap {
    const missingKeys: TranslationMap = {}

    if (specificKeys.length > 0) {
      for (const key of specificKeys) {
        if (baseTranslations[key] !== undefined) {
          if (existingTranslations[key] === undefined || translateAll) {
            missingKeys[key] = baseTranslations[key]!
          }
        }
      }
    } else {
      for (const [key, value] of Object.entries(baseTranslations)) {
        if (translateAll || existingTranslations[key] === undefined) {
          missingKeys[key] = value
        }
      }
    }

    return missingKeys
  }

  async getJsonLocales(langDir: string, defaultLang: string): Promise<string[]> {
    if (!(await pathExists(langDir))) return []

    const files = await readdir(langDir)
    return files
      .filter(
        (file) =>
          file.endsWith('.json') &&
          file !== `${defaultLang}.json` &&
          !file.startsWith('php_') &&
          file !== 'glossary.json'
      )
      .map((file) => file.replace(/\.json$/, ''))
  }

  async readTranslations(path: string): Promise<TranslationMap> {
    const data = await readJsonFile<Record<string, unknown>>(path)
    if (!data || typeof data !== 'object') return {}

    const result: TranslationMap = {}
    for (const [key, value] of Object.entries(data)) {
      result[key] = typeof value === 'string' ? value : JSON.stringify(value)
    }
    return result
  }

  async getMissingTranslationsSummary(
    langDir: string,
    defaultLang: string
  ): Promise<Record<string, MissingSummaryEntry>> {
    const baseLangFile = join(langDir, `${defaultLang}.json`)
    const baseTranslations = await this.readTranslations(baseLangFile)
    if (Object.keys(baseTranslations).length === 0 && !(await pathExists(baseLangFile))) {
      return {}
    }

    const locales = await this.getJsonLocales(langDir, defaultLang)
    const summary: Record<string, MissingSummaryEntry> = {}

    for (const locale of locales) {
      const localePath = join(langDir, `${locale}.json`)
      const existing = await this.readTranslations(localePath)
      const missingKeys = this.resolveMissingKeys(baseTranslations, existing)

      for (const [key, value] of Object.entries(missingKeys)) {
        if (!summary[key]) {
          summary[key] = { base_value: value, missing_in: [] }
        }
        summary[key]!.missing_in.push(locale)
      }
    }

    return summary
  }

  async getAllTranslationsSummary(
    langDir: string,
    defaultLang: string
  ): Promise<Record<string, AllSummaryEntry>> {
    const baseLangFile = join(langDir, `${defaultLang}.json`)
    if (!(await pathExists(baseLangFile))) return {}

    const baseTranslations = await this.readTranslations(baseLangFile)
    const locales = await this.getJsonLocales(langDir, defaultLang)
    const summary: Record<string, AllSummaryEntry> = {}

    for (const [key, value] of Object.entries(baseTranslations)) {
      summary[key] = {
        base_value: value,
        translations: {},
        missing_in: [],
      }
    }

    for (const locale of locales) {
      const localePath = join(langDir, `${locale}.json`)
      const existing = await this.readTranslations(localePath)

      for (const key of Object.keys(baseTranslations)) {
        const entry = summary[key]!
        if (existing[key] !== undefined) {
          entry.translations[locale] = existing[key]!
        } else {
          entry.missing_in.push(locale)
        }
      }
    }

    return summary
  }

  chunkEntries(map: TranslationMap, size: number): TranslationMap[] {
    const entries = Object.entries(map)
    const chunks: TranslationMap[] = []
    for (let i = 0; i < entries.length; i += size) {
      chunks.push(Object.fromEntries(entries.slice(i, i + size)))
    }
    return chunks
  }

  sortTranslations(map: TranslationMap): TranslationMap {
    return Object.fromEntries(Object.entries(map).sort(([a], [b]) => a.localeCompare(b)))
  }
}
