/**
 * Configuration for adonis-ai-translate
 */
const aiTranslateConfig = {
  defaultModel: process.env.AI_TRANSLATE_MODEL || 'claude',
  defaultLanguage: process.env.AI_TRANSLATE_DEFAULT_LANGUAGE || 'en',
  langPath: process.env.AI_TRANSLATE_LANG_PATH || undefined,
  path: process.env.AI_TRANSLATE_PATH || 'ai-translate',
  domain: process.env.AI_TRANSLATE_DOMAIN || null,
  glossaryPath: process.env.AI_TRANSLATE_GLOSSARY_PATH || undefined,
}

export default aiTranslateConfig
