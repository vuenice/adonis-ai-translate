import { BaseCommand, flags } from '@adonisjs/core/ace'
import type { CommandOptions } from '@adonisjs/core/types/ace'
import { join } from 'node:path'
import { access } from 'node:fs/promises'
import { constants as fsConstants } from 'node:fs'
import { AiTranslateRuntime } from '../bindings.js'
import { TranslationManager, writeJsonFile } from '../translation_manager.js'
import type { TranslationMap } from '../types.js'

async function pathExists(path: string): Promise<boolean> {
  try {
    await access(path, fsConstants.F_OK)
    return true
  } catch {
    return false
  }
}

export default class TranslationGenerate extends BaseCommand {
  static commandName = 'translation:generate'
  static description = 'Generate missing translations using AI'
  static options: CommandOptions = {
    startApp: true,
  }

  @flags.number({ description: 'Number of keys per API request', default: 10 })
  declare batch: number

  @flags.string({ description: 'Model to use (claude, gemini, or exact model id)' })
  declare model?: string

  @flags.boolean({ description: 'Translate all keys, overwriting existing ones' })
  declare all: boolean

  @flags.array({ description: 'Only translate specific keys' })
  declare key?: string[]

  @flags.string({ description: 'Only translate for a specific language code' })
  declare lang?: string

  @flags.boolean({ description: 'Generate 3 variations per key and ask user to choose' })
  declare multiple: boolean

  @flags.string({ description: 'Domain context for the AI' })
  declare context?: string

  async run() {
    this.logger.info('Translation generation started.')

    const runtime = await this.app.container.make(AiTranslateRuntime)
    const manager = new TranslationManager(runtime.config.glossaryPath, runtime.appRoot)
    await manager.init()

    const defaultLang = runtime.config.defaultLanguage
    const langDir = runtime.config.langPath
    const baseLangFile = join(langDir, `${defaultLang}.json`)

    if (!(await pathExists(baseLangFile))) {
      this.logger.error(`Base language file ${defaultLang}.json does not exist at ${baseLangFile}.`)
      this.exitCode = 1
      return
    }

    const baseTranslations = await manager.readTranslations(baseLangFile)
    const batchSize = Math.max(1, this.batch || 10)
    const model = this.model || runtime.config.defaultModel
    const translateAll = !!this.all
    const specificKeys = this.key || []
    const multiple = !!this.multiple
    const context = this.context || null

    let langOption = this.lang || null
    if (specificKeys.length > 0 && !langOption) {
      langOption =
        (await this.prompt.ask(
          'For which language code do you want to translate these keys? (Leave empty for all available languages)'
        )) || null
      if (!langOption) langOption = null
    }

    const targetLocales = langOption
      ? [langOption]
      : await manager.getJsonLocales(langDir, defaultLang)

    for (const targetLocale of targetLocales) {
      const localePath = join(langDir, `${targetLocale}.json`)
      this.logger.info(`Processing locale: ${targetLocale}`)

      const existing = await manager.readTranslations(localePath)
      const missingKeys = manager.resolveMissingKeys(
        baseTranslations,
        existing,
        specificKeys,
        translateAll
      )

      if (Object.keys(missingKeys).length === 0) {
        this.logger.info(`No missing translations for ${targetLocale}.`)
        continue
      }

      this.logger.info(`Found ${Object.keys(missingKeys).length} missing keys for ${targetLocale}.`)
      const chunks = manager.chunkEntries(missingKeys, batchSize)

      for (let index = 0; index < chunks.length; index++) {
        this.logger.info(`Translating batch ${index + 1} of ${chunks.length}...`)
        try {
          let translated = await manager.translateChunk(
            chunks[index]!,
            targetLocale,
            model,
            defaultLang,
            multiple,
            context
          )

          if (!translated) {
            this.logger.error(`Failed to translate batch ${index + 1}. Skipping.`)
            continue
          }

          translated = manager.applyGlossaryOverrides(translated, targetLocale)

          for (const [key, value] of Object.entries(translated)) {
            if (multiple && Array.isArray(value)) {
              const options = value.map((v) => String(v))
              const selected = await this.prompt.choice(
                `Select translation for '${key}' in ${targetLocale}`,
                options
              )
              existing[key] = selected
            } else {
              existing[key] = Array.isArray(value) ? String(value[0] ?? '') : String(value)
            }
          }
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error)
          this.logger.error(`API Error: ${message}`)
        }
      }

      await writeJsonFile(localePath, manager.sortTranslations(existing as TranslationMap))
      this.logger.success(`Saved ${targetLocale}.json.`)
    }

    this.logger.success('Translation generation complete.')
  }
}
