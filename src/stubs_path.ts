import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

/**
 * Path to the root of stubs directory. Keep it as relative path from
 * the compiled output (dist/) back to package stubs/.
 */
export const stubsRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'stubs')
