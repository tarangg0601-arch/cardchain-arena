'use strict';

const crypto = require('crypto');
const { promisify } = require('util');

const scrypt = promisify(crypto.scrypt);
const KEY_LENGTH = 64;

async function hashPassword(password) {
    const salt = crypto.randomBytes(16).toString('hex');
    const derived = await scrypt(password, salt, KEY_LENGTH);
    return `scrypt$${salt}$${derived.toString('hex')}`;
}

async function verifyPassword(password, stored) {
    const [scheme, salt, expectedHex] = String(stored).split('$');
    if (scheme !== 'scrypt' || !salt || !expectedHex) {
        return false;
    }
    const expected = Buffer.from(expectedHex, 'hex');
    const derived = await scrypt(password, salt, expected.length);
    return crypto.timingSafeEqual(derived, expected);
}

module.exports = { hashPassword, verifyPassword };
