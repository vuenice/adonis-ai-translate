import { join } from 'node:path'
import type { HttpContext } from '@adonisjs/core/http'
import { AiTranslate, AiTranslateRuntime } from '../bindings.js'
import type { AiTranslateConfig } from '../types.js'

interface AppContract {
  container: {
    bind(binding: any, resolver: () => any): void
    make(binding: string | any): Promise<any>
  }
  makePath(...parts: string[]): string
  inProduction: boolean
}

function resolveConfig(app: AppContract, hostConfig: Record<string, any> | null): AiTranslateConfig {
  const defaultLangPath = app.makePath('resources', 'lang')
  const defaults: AiTranslateConfig = {
    defaultModel: process.env.AI_TRANSLATE_MODEL || 'claude',
    defaultLanguage: process.env.AI_TRANSLATE_DEFAULT_LANGUAGE || 'en',
    langPath: process.env.AI_TRANSLATE_LANG_PATH || defaultLangPath,
    path: process.env.AI_TRANSLATE_PATH || 'ai-translate',
    domain: process.env.AI_TRANSLATE_DOMAIN || null,
    glossaryPath:
      process.env.AI_TRANSLATE_GLOSSARY_PATH || join(defaultLangPath, 'glossary.json'),
  }

  if (!hostConfig) {
    return defaults
  }

  const langPath = hostConfig.langPath || hostConfig.lang_path || defaults.langPath

  return {
    defaultModel: hostConfig.defaultModel ?? hostConfig.default_model ?? defaults.defaultModel,
    defaultLanguage:
      hostConfig.defaultLanguage ?? hostConfig.default_language ?? defaults.defaultLanguage,
    langPath,
    path: hostConfig.path ?? defaults.path,
    domain: hostConfig.domain ?? defaults.domain,
    glossaryPath:
      hostConfig.glossaryPath || hostConfig.glossary_path || join(langPath, 'glossary.json'),
  }
}

async function loadController() {
  const mod = await import(
    new URL('../controllers/dashboard_controller.js', import.meta.url).href
  )
  return new mod.default()
}

async function authorize(ctx: HttpContext, next: () => Promise<void>) {
  const runtime = await ctx.containerResolver.make(AiTranslateRuntime)
  const allowed = await AiTranslate.check(ctx, runtime.inProduction)
  if (!allowed) {
    return ctx.response.forbidden({
      success: false,
      error: 'Unauthorized to access AI Translate dashboard.',
    })
  }
  await next()
}

export default class AdonisAiTranslateProvider {
  constructor(protected app: AppContract) {}

  register() {
    this.app.container.bind(AiTranslateRuntime, () => {
      return new AiTranslateRuntime(
        resolveConfig(this.app, null),
        this.app.inProduction,
        this.app.makePath()
      )
    })
  }

  async boot() {
    try {
      const config = await this.app.container.make('config')
      const hostConfig = config.get('ai_translate', null) as Record<string, any> | null
      const resolved = resolveConfig(this.app, hostConfig)

      this.app.container.bind(AiTranslateRuntime, () => {
        return new AiTranslateRuntime(resolved, this.app.inProduction, this.app.makePath())
      })
    } catch {
      // Config provider may not be ready; env defaults remain.
    }
  }

  async start() {
    const router = await this.app.container.make('router')
    let runtime: AiTranslateRuntime
    try {
      runtime = await this.app.container.make(AiTranslateRuntime)
    } catch {
      runtime = new AiTranslateRuntime(
        resolveConfig(this.app, null),
        this.app.inProduction,
        this.app.makePath()
      )
    }

    const prefix = runtime.config.path.replace(/^\/+|\/+$/g, '') || 'ai-translate'

    const group = router.group(() => {
      router.get('/', async (ctx: HttpContext) => {
        const controller = await loadController()
        return controller.index(ctx)
      })
      router.post('/api/generate', async (ctx: HttpContext) => {
        const controller = await loadController()
        return controller.generate(ctx)
      })
      router.post('/api/generate-batch', async (ctx: HttpContext) => {
        const controller = await loadController()
        return controller.generateBatch(ctx)
      })
      router.post('/api/save', async (ctx: HttpContext) => {
        const controller = await loadController()
        return controller.save(ctx)
      })
    })

    group.prefix(`/${prefix}`)

    if (typeof group.use === 'function') {
      group.use([authorize])
    } else if (typeof group.middleware === 'function') {
      group.middleware([authorize])
    }

    if (runtime.config.domain && typeof group.domain === 'function') {
      group.domain(runtime.config.domain)
    }
  }
}
