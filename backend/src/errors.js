'use strict';

class AppError extends Error {
    constructor(status, code, message) {
        super(message);
        this.name = 'AppError';
        this.status = status;
        this.code = code;
    }
}

// Chaincode errors look like "[NOT_FOUND] Player x does not exist". The same
// tag survives both the local ledger and a Fabric endorsement error, so both
// modes map to the same HTTP status.
const CHAINCODE_STATUS = {
    INVALID_ARGUMENT: 400,
    FORBIDDEN: 403,
    NOT_FOUND: 404,
    CONFLICT: 409,
};

function fromChaincodeMessage(text) {
    const match = /\[(INVALID_ARGUMENT|FORBIDDEN|NOT_FOUND|CONFLICT)\]\s*([^\n]+)/.exec(text || '');
    if (!match) {
        return null;
    }
    return new AppError(CHAINCODE_STATUS[match[1]], match[1], match[2].trim());
}

module.exports = { AppError, fromChaincodeMessage };
