#!/usr/bin/env node
import { emitPostmortem } from './timeline.mjs';

const [folder, ...rest] = process.argv.slice(2);
let labels;
for (let i = 0; i < rest.length; i++) if (rest[i] === '--labels') labels = rest[++i];
if (!folder || !labels) {
  console.error('usage: node emit.mjs <folder> --labels <labels.json>');
  process.exit(2);
}
emitPostmortem(folder, labels);
