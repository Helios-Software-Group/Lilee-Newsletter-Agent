/**
 * Load a prompt template from the prompts/ directory.
 *
 * Reads the .md file, strips the YAML-style header (everything before the
 * first "---" separator and the separator line itself), and returns the
 * remaining body with optional {{variable}} interpolation.
 */

import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const PROMPTS_DIR = join(__dirname, '..', '..', 'prompts');

export function loadPrompt(
  name: string,
  variables: Record<string, string> = {},
): string {
  const raw = readFileSync(join(PROMPTS_DIR, `${name}.md`), 'utf-8');

  // Strip everything up to and including the first "---" line after the title
  // The prompt body starts after "## Prompt" or "## System Prompt"
  const promptMatch = raw.match(/^##\s+(?:System )?Prompt\s*\n([\s\S]+)$/m);
  let body = promptMatch ? promptMatch[1].trim() : raw;

  // Interpolate {{variables}}
  for (const [key, value] of Object.entries(variables)) {
    body = body.replace(new RegExp(`\\{\\{${key}\\}\\}`, 'g'), value);
  }

  return body;
}
