'use strict';

const crypto = require('crypto');
const fs = require('fs/promises');
const path = require('path');
const grpc = require('@grpc/grpc-js');
const { connect, hash, signers, StatusCode, CommitError, CommitStatusError, GatewayError } =
    require('@hyperledger/fabric-gateway');
const { common } = require('@hyperledger/fabric-protos');
const { AppError, fromChaincodeMessage } = require('../errors');
const { decodeBlock, toHex } = require('./blockDecoder');

const STATUS_NAMES = Object.fromEntries(Object.entries(StatusCode).map(([name, code]) => [code, name]));
const UNAVAILABLE_CODES = new Set([grpc.status.UNAVAILABLE, grpc.status.DEADLINE_EXCEEDED]);

async function firstFile(dir) {
    const files = (await fs.readdir(dir)).filter((name) => !name.startsWith('.'));
    if (files.length === 0) {
        throw new Error(`No files found in ${dir}`);
    }
    return path.join(dir, files.sort()[0]);
}

function waitForReady(client, timeoutMs) {
    return new Promise((resolve, reject) => {
        client.waitForReady(Date.now() + timeoutMs, (err) => (err ? reject(err) : resolve()));
    });
}

function errorText(err) {
    const parts = [err.message];
    for (const detail of err.details || []) {
        parts.push(detail.message);
    }
    return parts.join('\n');
}

// Converts gateway errors into API errors. Chaincode rule violations keep their
// own status; anything else is reported as a failure, never as a success.
function toAppError(err, fcn) {
    if (err instanceof AppError) {
        return err;
    }
    const fromChaincode = fromChaincodeMessage(errorText(err));
    if (fromChaincode) {
        return fromChaincode;
    }
    if (err instanceof CommitError) {
        const status = STATUS_NAMES[err.code] || err.code;
        return new AppError(409, 'TX_NOT_COMMITTED',
            `Transaction ${err.transactionId} was rejected by the network (${status}). Nothing was changed; please try again.`);
    }
    if (err instanceof CommitStatusError) {
        return new AppError(504, 'TX_STATUS_UNKNOWN',
            `${fcn} was submitted but its commit status could not be confirmed (${err.message}). Refresh before retrying.`);
    }
    if (err instanceof GatewayError && UNAVAILABLE_CODES.has(err.code)) {
        return new AppError(503, 'LEDGER_UNAVAILABLE', `The Fabric network is unavailable: ${err.message}`);
    }
    const reason = errorText(err).split('\n').filter(Boolean).pop() || 'unknown error';
    return new AppError(502, 'LEDGER_ERROR', `Fabric ${fcn} failed: ${reason.length > 300 ? `${reason.slice(0, 300)}...` : reason}`);
}

class FabricLedger {
    constructor({ client, gateway, contract, qscc, config }) {
        this.mode = 'fabric';
        this.client = client;
        this.gateway = gateway;
        this.contract = contract;
        this.qscc = qscc;
        this.config = config;
        this.blockCache = new Map();
    }

    static async connect(config) {
        let tlsRootCert;
        let credentials;
        let privateKey;
        try {
            tlsRootCert = await fs.readFile(config.tlsCertPath);
            credentials = await fs.readFile(await firstFile(config.certDir));
            privateKey = crypto.createPrivateKey(await fs.readFile(await firstFile(config.keyDir)));
        } catch (err) {
            throw new Error(`Fabric credentials not found (${err.message}). Is the test network running, ` +
                'and does FABRIC_CRYPTO_PATH in backend/.env point to org1.example.com?');
        }

        const client = new grpc.Client(config.peerEndpoint, grpc.credentials.createSsl(tlsRootCert), {
            'grpc.ssl_target_name_override': config.peerHostAlias,
        });
        try {
            await waitForReady(client, config.connectTimeoutMs);
        } catch (err) {
            client.close();
            throw new Error(`Cannot reach Fabric peer at ${config.peerEndpoint}: ${err.message}`);
        }

        const gateway = connect({
            client,
            identity: { mspId: config.mspId, credentials },
            signer: signers.newPrivateKeySigner(privateKey),
            hash: hash.sha256,
            evaluateOptions: () => ({ deadline: Date.now() + 10000 }),
            endorseOptions: () => ({ deadline: Date.now() + 30000 }),
            submitOptions: () => ({ deadline: Date.now() + 10000 }),
            commitStatusOptions: () => ({ deadline: Date.now() + 60000 }),
        });
        const network = gateway.getNetwork(config.channel);
        const contract = network.getContract(config.chaincode);
        // qscc is Fabric's built-in query system chaincode, used to read blocks.
        const qscc = network.getContract('qscc');
        const ledger = new FabricLedger({ client, gateway, contract, qscc, config });

        try {
            await ledger.evaluate('GetLeaderboard');
        } catch (err) {
            ledger.close();
            throw new Error(`Connected to the peer but chaincode "${config.chaincode}" on channel "${config.channel}" ` +
                `did not respond: ${err.message}`);
        }
        return ledger;
    }

    describe() {
        return {
            mode: 'fabric',
            channel: this.config.channel,
            chaincode: this.config.chaincode,
            mspId: this.config.mspId,
            peerEndpoint: this.config.peerEndpoint,
        };
    }

    async evaluate(fcn, ...args) {
        try {
            const bytes = await this.contract.evaluateTransaction(fcn, ...args.map(String));
            return JSON.parse(Buffer.from(bytes).toString('utf8'));
        } catch (err) {
            throw toAppError(err, fcn);
        }
    }

    // Endorse, submit to the orderer, then wait for the commit status. The
    // result is only returned once the peer reports the transaction as VALID.
    async submit(fcn, ...args) {
        try {
            const proposal = this.contract.newProposal(fcn, { arguments: args.map(String) });
            const transaction = await proposal.endorse();
            const submitted = await transaction.submit();
            const status = await submitted.getStatus();
            if (!status.successful) {
                const name = STATUS_NAMES[status.code] || status.code;
                throw new AppError(409, 'TX_NOT_COMMITTED',
                    `Transaction ${status.transactionId} was rejected by the network (${name}). Nothing was changed; please try again.`);
            }
            const result = JSON.parse(Buffer.from(submitted.getResult()).toString('utf8'));
            return { result, txId: status.transactionId, blockNumber: Number(status.blockNumber) };
        } catch (err) {
            throw toAppError(err, fcn);
        }
    }

    async getChainInfo() {
        try {
            const bytes = await this.qscc.evaluateTransaction('GetChainInfo', this.config.channel);
            const info = common.BlockchainInfo.deserializeBinary(bytes);
            return {
                height: Number(info.getHeight()),
                currentBlockHash: toHex(info.getCurrentblockhash_asU8()),
                previousBlockHash: toHex(info.getPreviousblockhash_asU8()),
            };
        } catch (err) {
            throw toAppError(err, 'GetChainInfo');
        }
    }

    // Committed blocks never change, so each one is fetched and decoded once.
    async getBlock(number) {
        if (!this.blockCache.has(number)) {
            try {
                const bytes = await this.qscc.evaluateTransaction('GetBlockByNumber', this.config.channel, String(number));
                this.blockCache.set(number, decodeBlock(bytes));
            } catch (err) {
                throw toAppError(err, 'GetBlockByNumber');
            }
        }
        return this.blockCache.get(number);
    }

    close() {
        this.gateway.close();
        this.client.close();
    }
}

module.exports = { FabricLedger, toAppError };
