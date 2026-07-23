import type { AiTranslateConfig, AuthCallback } from './types.js'

/** Host-app runtime resolved from the IoC container (avoids duplicate `@adonisjs/core` with `file:` installs). */
export class AiTranslateRuntime {
  constructor(
    public readonly config: AiTranslateConfig,
    public readonly inProduction: boolean,
    public readonly appRoot: string
  ) {}
}

/**
 * Auth gate for the dashboard (Horizon/Telescope style).
 * Default: allow only when the host app is not in production.
 */
export class AiTranslate {
  static authUsing: AuthCallback | null = null

  static auth(callback: AuthCallback): typeof AiTranslate {
    this.authUsing = callback
    return this
  }

  static async check(ctx: unknown, inProduction: boolean): Promise<boolean> {
    if (this.authUsing) {
      return await this.authUsing(ctx)
    }
    return !inProduction
  }
}
