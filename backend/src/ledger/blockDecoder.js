'use strict';

const crypto = require('crypto');
const { common, ledger: ledgerProtos, msp, peer } = require('@hyperledger/fabric-protos');
const { StatusCode } = require('@hyperledger/fabric-gateway');

// Turns raw Fabric blocks (from the qscc system chaincode) into plain objects
// for the ledger explorer, and recomputes the hashes Fabric stores in each block.

const STATUS_NAMES = Object.fromEntries(Object.entries(StatusCode).map(([name, code]) => [code, name]));
const TRANSACTIONS_FILTER = 2; // index of the validation codes in block metadata
const ENDORSER_TRANSACTION = 3;
const CONFIG = 1;

const toHex = (bytes) => Buffer.from(bytes || []).toString('hex');
const sha256 = (data) => crypto.createHash('sha256').update(data).digest();

// DER length and element helpers for the block header hash.
function derLength(length) {
    if (length < 0x80) {
        return Buffer.from([length]);
    }
    const bytes = [];
    for (let n = length; n > 0; n = Math.floor(n / 256)) {
        bytes.unshift(n & 0xff);
    }
    return Buffer.from([0x80 | bytes.length, ...bytes]);
}

function derElement(tag, content) {
    return Buffer.concat([Buffer.from([tag]), derLength(content.length), content]);
}

function derInteger(value) {
    let hex = BigInt(value).toString(16);
    if (hex.length % 2) {
        hex = `0${hex}`;
    }
    let bytes = Buffer.from(hex, 'hex');
    if (bytes[0] & 0x80) {
        bytes = Buffer.concat([Buffer.from([0]), bytes]);
    }
    return derElement(0x02, bytes);
}

// Fabric hashes the ASN.1 DER encoding of (number, previousHash, dataHash).
function blockHeaderHash(number, previousHash, dataHash) {
    const body = Buffer.concat([
        derInteger(number),
        derElement(0x04, Buffer.from(previousHash || [])),
        derElement(0x04, Buffer.from(dataHash || [])),
    ]);
    return sha256(derElement(0x30, body)).toString('hex');
}

// Fabric's data hash is SHA-256 over all transaction envelopes joined together.
function blockDataHash(envelopes) {
    return sha256(Buffer.concat(envelopes.map((e) => Buffer.from(e)))).toString('hex');
}

const nameCache = new Map();
function identity(serializedBytes) {
    const id = msp.SerializedIdentity.deserializeBinary(serializedBytes);
    const pem = Buffer.from(id.getIdBytes_asU8()).toString('utf8');
    if (!nameCache.has(pem)) {
        let name = 'unknown';
        try {
            const cn = new crypto.X509Certificate(pem).subject.split('\n').find((line) => line.startsWith('CN='));
            name = cn ? cn.slice(3) : name;
        } catch {
            name = 'unknown';
        }
        nameCache.set(pem, name);
    }
    return { mspId: id.getMspid(), name: nameCache.get(pem) };
}

function timestampIso(ts) {
    if (!ts) {
        return null;
    }
    return new Date(ts.getSeconds() * 1000 + Math.floor(ts.getNanos() / 1e6)).toISOString();
}

function decodeEndorserTransaction(payloadData) {
    const tx = peer.Transaction.deserializeBinary(payloadData);
    const action = tx.getActionsList()[0];
    const actionPayload = peer.ChaincodeActionPayload.deserializeBinary(action.getPayload_asU8());

    const proposalPayload = peer.ChaincodeProposalPayload.deserializeBinary(actionPayload.getChaincodeProposalPayload_asU8());
    const invocation = peer.ChaincodeInvocationSpec.deserializeBinary(proposalPayload.getInput_asU8());
    const spec = invocation.getChaincodeSpec();
    // System chaincode arguments (e.g. _lifecycle) are protobuf bytes, not text.
    const rawArgs = spec.getInput().getArgsList_asU8().map((a) => {
        const text = Buffer.from(a).toString('utf8');
        return /^[\x20-\x7e\s]*$/.test(text) ? text : `<${a.length} bytes>`;
    });

    const endorsedAction = actionPayload.getAction();
    const endorsers = endorsedAction.getEndorsementsList().map((e) => identity(e.getEndorser_asU8()));

    const responsePayload = peer.ProposalResponsePayload.deserializeBinary(endorsedAction.getProposalResponsePayload_asU8());
    const chaincodeAction = peer.ChaincodeAction.deserializeBinary(responsePayload.getExtension_asU8());
    const chaincode = spec.getChaincodeId().getName();
    const writes = [];
    const rwset = ledgerProtos.rwset.TxReadWriteSet.deserializeBinary(chaincodeAction.getResults_asU8());
    for (const ns of rwset.getNsRwsetList()) {
        if (ns.getNamespace() !== chaincode) {
            continue;
        }
        const kv = ledgerProtos.rwset.kvrwset.KVRWSet.deserializeBinary(ns.getRwset_asU8());
        for (const write of kv.getWritesList()) {
            writes.push({ key: write.getKey(), isDelete: write.getIsDelete() });
        }
    }

    return {
        chaincode,
        function: String(rawArgs[0] || '').split(':').pop(),
        args: rawArgs.slice(1),
        endorsers,
        writes,
    };
}

function decodeBlock(bytes) {
    const block = common.Block.deserializeBinary(bytes);
    const header = block.getHeader();
    const envelopes = block.getData().getDataList_asU8();
    const filter = block.getMetadata().getMetadataList_asU8()[TRANSACTIONS_FILTER] || new Uint8Array();
    const number = Number(header.getNumber());

    const transactions = envelopes.map((envBytes, index) => {
        const envelope = common.Envelope.deserializeBinary(envBytes);
        const payload = common.Payload.deserializeBinary(envelope.getPayload_asU8());
        const channelHeader = common.ChannelHeader.deserializeBinary(payload.getHeader().getChannelHeader_asU8());
        const signatureHeader = common.SignatureHeader.deserializeBinary(payload.getHeader().getSignatureHeader_asU8());
        const code = filter.length > index ? filter[index] : 0;
        const type = channelHeader.getType();
        const base = {
            txId: channelHeader.getTxId() || null,
            type: type === ENDORSER_TRANSACTION ? 'ENDORSER_TRANSACTION' : type === CONFIG ? 'CONFIG' : `TYPE_${type}`,
            timestamp: timestampIso(channelHeader.getTimestamp()),
            creator: identity(signatureHeader.getCreator_asU8()),
            validationCode: STATUS_NAMES[code] || String(code),
            valid: code === 0,
            chaincode: null,
            function: type === CONFIG ? 'Channel configuration' : null,
            args: [],
            endorsers: [],
            writes: [],
        };
        if (type === ENDORSER_TRANSACTION) {
            try {
                Object.assign(base, decodeEndorserTransaction(payload.getData_asU8()));
            } catch {
                base.function = 'Undecodable transaction';
            }
        }
        return base;
    });

    const dataHash = toHex(header.getDataHash_asU8());
    const previousHash = toHex(header.getPreviousHash_asU8());
    const hash = blockHeaderHash(number, header.getPreviousHash_asU8(), header.getDataHash_asU8());
    return {
        number,
        hash,
        computedHash: hash,
        previousHash,
        dataHash,
        computedDataHash: blockDataHash(envelopes),
        timestamp: transactions.length ? transactions[0].timestamp : null,
        simulated: false,
        transactions,
    };
}

module.exports = { decodeBlock, blockHeaderHash, blockDataHash, toHex };
