import { BaseCommand, flags } from '@adonisjs/core/ace'
import type { CommandOptions } from '@adonisjs/core/types/ace'
import { join } from 'node:path'
import { access } from 'node:fs/promises'
import { constants as fsConstants } from 'node:fs'
import { AiTranslateRuntime } from '../bindings.js'
import { TranslationManager, writeJsonFile } from '../translation_manager.js'

async function pathExists(path: string): Promise<boolean> {
  try {
    await access(path, fsConstants.F_OK)
    return true
  } catch {
    return false
  }
}

export default class TranslationPrune extends BaseCommand {
  static commandName = 'translation:prune'
  static description = 'Remove stale translation keys that no longer exist in the base language file'
  static options: CommandOptions = {
    startApp: true,
  }

  @flags.string({ description: 'Prune a specific locale only' })
  declare lang?: string

  @flags.boolean({ description: 'Show what would be removed without actually removing' })
  declare dryRun: boolean

  async run() {
    const runtime = await this.app.container.make(AiTranslateRuntime)
    const manager = new TranslationManager(runtime.config.glossaryPath, runtime.appRoot)
    await manager.init()

    const defaultLang = runtime.config.defaultLanguage
    const langDir = runtime.config.langPath
    const dryRun = !!this.dryRun
    const baseLangFile = join(langDir, `${defaultLang}.json`)

    if (!(await pathExists(baseLangFile))) {
      this.logger.error(`Base language file ${defaultLang}.json does not exist.`)
      this.exitCode = 1
      return
    }

    const baseTranslations = await manager.readTranslations(baseLangFile)
    const baseKeys = new Set(Object.keys(baseTranslations))

    const targetLocales = this.lang
      ? [this.lang]
      : await manager.getJsonLocales(langDir, defaultLang)

    let totalPruned = 0

    for (const targetLocale of targetLocales) {
      const localePath = join(langDir, `${targetLocale}.json`)

      if (!(await pathExists(localePath))) {
        this.logger.warning(`Skipping ${targetLocale}: file does not exist.`)
        continue
      }

      const translations = await manager.readTranslations(localePath)
      const staleKeys = Object.keys(translations).filter((key) => !baseKeys.has(key))

      if (staleKeys.length === 0) {
        this.logger.info(`No stale keys found in ${targetLocale}.`)
        continue
      }

      this.logger.info(`${staleKeys.length} stale key(s) found in ${targetLocale}:`)
      for (const key of staleKeys) {
        this.logger.info(`  - ${key}`)
      }

      if (!dryRun) {
        for (const key of staleKeys) {
          delete translations[key]
        }
        await writeJsonFile(localePath, manager.sortTranslations(translations))
        this.logger.success(`Pruned ${targetLocale}.json.`)
      }

      totalPruned += staleKeys.length
    }

    if (dryRun && totalPruned > 0) {
      this.logger.warning(
        `Dry run complete. ${totalPruned} stale key(s) would be removed. Run without --dry-run to apply.`
      )
    } else if (totalPruned > 0) {
      this.logger.success(`Pruning complete. ${totalPruned} stale key(s) removed.`)
    } else {
      this.logger.info('No stale keys found in any locale.')
    }
  }
}
