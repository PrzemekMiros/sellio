import type { Config } from '@netlify/functions';
import { AllegroOAuth } from '../lib/allegro-oauth.ts';

export default async () => {
  // Counts only: never log tokens, account data or OAuth responses.
  console.info('Allegro token maintenance', await new AllegroOAuth().maintain());
};
export const config: Config = { schedule: '0 */6 * * *' };
