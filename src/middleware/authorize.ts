import type { HttpContext } from '@adonisjs/core/http'
import { AiTranslate, AiTranslateRuntime } from '../bindings.js'

/**
 * Restricts dashboard + API routes using AiTranslate.auth() / default non-production gate.
 */
export default class AuthorizeMiddleware {
  async handle(ctx: HttpContext, next: () => Promise<void>) {
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
}
