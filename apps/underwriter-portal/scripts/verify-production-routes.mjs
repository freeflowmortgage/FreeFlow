import { readFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';

const manifestPath = path.resolve(process.cwd(), '.next/server/pages-manifest.json');
const forbiddenRoute = /(?:^|\/)(?:[^/]+\.test|__tests__|fixtures?|debug)(?:\/|$)/i;

let manifest;
try {
  manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
} catch (error) {
  console.error(`Unable to read the Next.js pages manifest at ${manifestPath}.`);
  throw error;
}

const routes = Object.keys(manifest);
const forbidden = routes.filter((route) => forbiddenRoute.test(route));

if (forbidden.length > 0) {
  console.error('Production route manifest contains test, fixture, or debug routes:');
  for (const route of forbidden) console.error(`- ${route}`);
  process.exitCode = 1;
} else {
  console.log(`Verified ${routes.length} production routes; no test, fixture, or debug routes found.`);
}
