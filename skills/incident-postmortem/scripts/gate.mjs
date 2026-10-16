#!/usr/bin/env node
import { gateLabels } from './timeline.mjs';

const [folder, ...rest] = process.argv.slice(2);
let labels;
for (let i = 0; i < rest.length; i++) if (rest[i] === '--labels') labels = rest[++i];
if (!folder || !labels) {
  console.error('usage: node gate.mjs <folder> --labels <labels.json>');
  process.exit(2);
}
gateLabels(folder, labels);
