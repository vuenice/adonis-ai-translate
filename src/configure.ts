import type Configure from '@adonisjs/core/commands/configure'
import { stubsRoot } from './stubs_path.js'

/**
 * Configures the package inside a host Adonis application.
 * Run: node ace configure adonis-ai-translate
 */
export async function configure(command: Configure) {
  const codemods = await command.createCodemods()

  await codemods.updateRcFile((rcFile: {
    addProvider: (provider: string) => void
    addCommand: (command: string) => void
  }) => {
    rcFile.addProvider('adonis-ai-translate/provider')
    rcFile.addCommand('adonis-ai-translate/commands')
  })

  await codemods.defineEnvVariables({
    AI_TRANSLATE_MODEL: 'claude',
    AI_TRANSLATE_DEFAULT_LANGUAGE: 'en',
    AI_TRANSLATE_PATH: 'ai-translate',
  })

  await codemods.defineEnvValidations({
    leadingComment: 'Variables for adonis-ai-translate',
    variables: {
      AI_TRANSLATE_MODEL: 'Env.schema.string.optional()',
      AI_TRANSLATE_DEFAULT_LANGUAGE: 'Env.schema.string.optional()',
      AI_TRANSLATE_LANG_PATH: 'Env.schema.string.optional()',
      AI_TRANSLATE_PATH: 'Env.schema.string.optional()',
      AI_TRANSLATE_GLOSSARY_PATH: 'Env.schema.string.optional()',
      AI_TRANSLATE_DOMAIN: 'Env.schema.string.optional()',
      ANTHROPIC_API_KEY: 'Env.schema.string.optional()',
      GEMINI_API_KEY: 'Env.schema.string.optional()',
    },
  })

  await codemods.makeUsingStub(stubsRoot, 'config/ai_translate.stub', {})
}
