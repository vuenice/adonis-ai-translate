export type Glossary = {
  never_translate?: string[]
  specific_translations?: Record<string, Record<string, string>>
}

export type TranslationMap = Record<string, string>

export type MissingSummaryEntry = {
  base_value: string
  missing_in: string[]
}

export type AllSummaryEntry = {
  base_value: string
  translations: Record<string, string>
  missing_in: string[]
  key?: string
}

export type AiTranslateConfig = {
  defaultModel: string
  defaultLanguage: string
  langPath: string
  path: string
  domain: string | null
  glossaryPath: string
}

export type AuthCallback = (ctx: unknown) => boolean | Promise<boolean>
