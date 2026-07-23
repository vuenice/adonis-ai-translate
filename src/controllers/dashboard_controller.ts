import { join } from 'node:path'
import type { HttpContext } from '@adonisjs/core/http'
import { AiTranslateRuntime } from '../bindings.js'
import { TranslationManager, writeJsonFile } from '../translation_manager.js'
import { renderDashboardHtml } from '../dashboard_html.js'
import type { TranslationMap } from '../types.js'

async function makeManager(runtime: AiTranslateRuntime): Promise<TranslationManager> {
  const manager = new TranslationManager(runtime.config.glossaryPath, runtime.appRoot)
  await manager.init()
  return manager
}

function apiPrefix(runtime: AiTranslateRuntime): string {
  const path = runtime.config.path.replace(/^\/+|\/+$/g, '') || 'ai-translate'
  return `/${path}`
}

export default class DashboardController {
  async index(ctx: HttpContext) {
    const runtime = await ctx.containerResolver.make(AiTranslateRuntime)
    const manager = await makeManager(runtime)
    const { langPath, defaultLanguage } = runtime.config

    const missingTranslations = await manager.getMissingTranslationsSummary(
      langPath,
      defaultLanguage
    )
    const allTranslations = await manager.getAllTranslationsSummary(langPath, defaultLanguage)
    const locales = await manager.getJsonLocales(langPath, defaultLanguage)

    ctx.response.type('text/html; charset=utf-8')
    return ctx.response.send(
      renderDashboardHtml({
        missingTranslations,
        allTranslations,
        defaultLang: defaultLanguage,
        locales,
        basePath: apiPrefix(runtime),
      })
    )
  }

  async generate(ctx: HttpContext) {
    const runtime = await ctx.containerResolver.make(AiTranslateRuntime)
    const manager = await makeManager(runtime)
    const body = ctx.request.body() as {
      key?: string
      base_value?: string
      target_locale?: string
      context?: string | null
    }

    if (!body.key || body.base_value === undefined || !body.target_locale) {
      return ctx.response.badRequest({
        success: false,
        error: 'key, base_value, and target_locale are required.',
      })
    }

    const chunk: TranslationMap = { [body.key]: String(body.base_value) }
    let context = body.context || null
    if (!context) {
      context = await manager.findKeyContextInCode(body.key)
    }

    try {
      let translated = await manager.translateChunk(
        chunk,
        body.target_locale,
        runtime.config.defaultModel,
        runtime.config.defaultLanguage,
        false,
        context
      )

      if (!translated) {
        return ctx.response.internalServerError({
          success: false,
          error: 'Failed to generate translation.',
        })
      }

      translated = manager.applyGlossaryOverrides(translated, body.target_locale)
      const raw = translated[body.key] ?? Object.values(translated)[0]
      if (raw === undefined || raw === null) {
        return ctx.response.internalServerError({
          success: false,
          error: 'Translation not found in AI response.',
        })
      }

      const translation = Array.isArray(raw) ? String(raw[0] ?? '') : String(raw)
      return { success: true, translation }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      return ctx.response.internalServerError({ success: false, error: message })
    }
  }

  async generateBatch(ctx: HttpContext) {
    const runtime = await ctx.containerResolver.make(AiTranslateRuntime)
    const manager = await makeManager(runtime)
    const body = ctx.request.body() as {
      items?: Array<{ key: string; base_value: string }>
      target_locale?: string
    }

    if (!body.items?.length || !body.target_locale) {
      return ctx.response.badRequest({
        success: false,
        error: 'items and target_locale are required.',
      })
    }

    const chunk: TranslationMap = {}
    for (const item of body.items) {
      chunk[item.key] = String(item.base_value)
    }

    try {
      let translated = await manager.translateChunk(
        chunk,
        body.target_locale,
        runtime.config.defaultModel,
        runtime.config.defaultLanguage,
        false,
        null
      )

      if (!translated) {
        return ctx.response.internalServerError({
          success: false,
          error: 'Failed to generate batch translation.',
        })
      }

      translated = manager.applyGlossaryOverrides(translated, body.target_locale)
      const results: TranslationMap = {}
      const langDir = runtime.config.langPath
      const localePath = join(langDir, `${body.target_locale}.json`)
      const existing = await manager.readTranslations(localePath)

      for (const [key] of Object.entries(chunk)) {
        const raw = translated[key]
        if (raw === undefined || raw === null) continue
        const translation = Array.isArray(raw) ? String(raw[0] ?? '') : String(raw)
        results[key] = translation
        existing[key] = translation
      }

      await writeJsonFile(localePath, manager.sortTranslations(existing))

      return { success: true, translations: results }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      return ctx.response.internalServerError({ success: false, error: message })
    }
  }

  async save(ctx: HttpContext) {
    const runtime = await ctx.containerResolver.make(AiTranslateRuntime)
    const manager = await makeManager(runtime)
    const body = ctx.request.body() as {
      key?: string
      translation?: string
      target_locale?: string
    }

    if (!body.key || body.translation === undefined || !body.target_locale) {
      return ctx.response.badRequest({
        success: false,
        error: 'key, translation, and target_locale are required.',
      })
    }

    const localePath = join(runtime.config.langPath, `${body.target_locale}.json`)
    const existing = await manager.readTranslations(localePath)
    existing[body.key] = body.translation
    await writeJsonFile(localePath, manager.sortTranslations(existing))

    return { success: true }
  }
}
