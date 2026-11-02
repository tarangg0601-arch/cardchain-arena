'use strict';

const fs = require('fs/promises');
const path = require('path');

async function readJson(file) {
    let text;
    try {
        text = await fs.readFile(file, 'utf8');
    } catch (err) {
        if (err.code === 'ENOENT') {
            return null;
        }
        throw err;
    }
    try {
        return JSON.parse(text);
    } catch (err) {
        // Never silently replace a damaged data file; that would wipe progress.
        throw new Error(`${file} is not valid JSON (${err.message}). Fix or remove the file and restart.`);
    }
}

// Write to a temporary file first and rename it, so a crash mid-write
// cannot leave a half-written data file behind.
async function writeJson(file, data) {
    await fs.mkdir(path.dirname(file), { recursive: true });
    const tmp = `${file}.${process.pid}.tmp`;
    await fs.writeFile(tmp, `${JSON.stringify(data, null, 2)}\n`, 'utf8');
    await fs.rename(tmp, file);
}

module.exports = { readJson, writeJson };
