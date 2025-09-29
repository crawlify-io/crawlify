const fs = require('node:fs');
const path = require('node:path');

let loaded = false;

function loadEnv() {
  if (loaded) {
    return;
  }

  loaded = true;

  const envPath = path.resolve(__dirname, '../../.env');
  let contents;

  try {
    contents = fs.readFileSync(envPath, 'utf8');
  } catch (error) {
    return;
  }

  const lines = contents.split(/\r?\n/);

  for (const line of lines) {
    const trimmed = line.trim();

    if (!trimmed || trimmed.startsWith('#')) {
      continue;
    }

    const equalsIndex = trimmed.indexOf('=');

    if (equalsIndex === -1) {
      continue;
    }

    const key = trimmed.slice(0, equalsIndex).trim();

    if (!key || process.env[key] !== undefined) {
      continue;
    }

    let value = trimmed.slice(equalsIndex + 1).trim();

    if (
      (value.startsWith('"') && value.endsWith('"') && value.length >= 2) ||
      (value.startsWith("'") && value.endsWith("'") && value.length >= 2)
    ) {
      value = value.slice(1, -1);
    }

    process.env[key] = value;
  }
}

module.exports = {
  loadEnv,
};
