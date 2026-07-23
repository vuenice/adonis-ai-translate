# AI Translate for AdonisJS

AI-powered translation management for AdonisJS 6 and 7. Diffs your base locale JSON (`en.json`) against target locales, translates only missing keys with Claude or Gemini, and includes a browser dashboard plus Ace commands.

## Requirements

| Requirement | Version |
|-------------|---------|
| AdonisJS | 6.x or 7.x |
| Node.js | >= 20.6 |
| npm | >= 10 |

## Installation

```bash
npm install adonis-ai-translate
node ace configure adonis-ai-translate
```

The configure command:

- Registers the provider and Ace commands in `adonisrc.ts`
- Publishes `config/ai_translate.ts`
- Adds optional env variables / validations

Then set your AI provider keys:

```env
AI_TRANSLATE_MODEL=claude
AI_TRANSLATE_DEFAULT_LANGUAGE=en
AI_TRANSLATE_PATH=ai-translate

ANTHROPIC_API_KEY=your_anthropic_api_key
GEMINI_API_KEY=your_google_api_key
```

Restart the server and open `/ai-translate`.

### Manual registration

If you prefer not to run configure:

```ts
// adonisrc.ts
providers: [
  // ...
  () => import('adonis-ai-translate/provider'),
],
commands: [
  () => import('@adonisjs/core/commands'),
  () => import('adonis-ai-translate/commands'),
],
```

## Lang files

JSON only — flat files under `resources/lang` by default:

```
resources/lang/
  en.json
  fr.json
  glossary.json   # optional
```

Example `en.json`:

```json
{
  "Welcome": "Welcome",
  "Goodbye": "Goodbye"
}
```

### Glossary

```json
{
  "never_translate": ["Brand", "API"],
  "specific_translations": {
    "Dashboard": { "fr": "Tableau de bord" }
  }
}
```

## Ace commands

### Generate missing translations

```bash
node ace translation:generate
```

| Flag | Description |
|------|-------------|
| `--batch=` | Keys per API request (default `10`) |
| `--model=` | `claude`, `gemini`, or exact model id |
| `--lang=` | Target a single locale |
| `--key=` | Specific key(s) (repeatable) |
| `--multiple` | Generate 3 variations and pick interactively |
| `--all` | Re-translate all keys |
| `--context=` | Domain context for the AI |

### Prune stale keys

```bash
node ace translation:prune
node ace translation:prune --dry-run
node ace translation:prune --lang=fr
```

## Dashboard

Default URL: `/ai-translate` (override with `AI_TRANSLATE_PATH` / config `path`).

Access is allowed outside production by default. Customize with:

```ts
import { AiTranslate } from 'adonis-ai-translate'

AiTranslate.auth(async (ctx) => {
  // return true to allow
  return true
})
```

## Dual Adonis 6 + 7 support

This package peers on `@adonisjs/core` `^6 || ^7`, resolves the router via the IoC container (not `@adonisjs/core/services/*`), and uses a duck-typed app contract so path/`file:` installs work without a duplicate core copy.

## Local development

```bash
npm install
npm run build
```

See [`example/`](./example) for a minimal Adonis 7 host using `"adonis-ai-translate": "file:.."`.

## License

MIT
