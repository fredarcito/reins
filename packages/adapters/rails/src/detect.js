import { existsSync } from 'node:fs';
import path from 'node:path';

/**
 * A Rails app: a Gemfile and config/application.rb at the repo root.
 * @param {string} repoPath
 */
export function detect(repoPath) {
  return existsSync(path.join(repoPath, 'Gemfile')) && existsSync(path.join(repoPath, 'config/application.rb'));
}
