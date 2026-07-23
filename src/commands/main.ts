import type { CommandMetaData } from '@adonisjs/core/types/ace'
import TranslationGenerate from './translation_generate.js'
import TranslationPrune from './translation_prune.js'

const commands = [
  { ctor: TranslationGenerate, filePath: './translation_generate.js' },
  { ctor: TranslationPrune, filePath: './translation_prune.js' },
]

/**
 * Ace command loader API expected by @adonisjs/core / @adonisjs/ace.
 */
export async function getMetaData(): Promise<CommandMetaData[]> {
  return commands.map(({ ctor, filePath }) => ({
    ...ctor.serialize(),
    filePath,
  }))
}

export async function getCommand(metaData: CommandMetaData) {
  const match = commands.find(({ ctor }) => ctor.commandName === metaData.commandName)
  return match?.ctor ?? null
}
