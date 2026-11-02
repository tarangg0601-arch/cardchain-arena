export const short = (hash, length = 10) => (hash ? `${hash.slice(0, length)}...` : '-');

export function formatTime(iso) {
  return iso ? new Date(iso).toLocaleString() : '-';
}

// Readable one-line description of a transaction for the explorer.
export function describeTx(tx) {
  if (!tx.function) return tx.type;
  // Fabric's own system chaincodes (e.g. _lifecycle) take binary arguments.
  if (tx.chaincode && tx.chaincode.startsWith('_')) return `${tx.function} (${tx.chaincode})`;
  const args = tx.args || [];
  switch (tx.function) {
    case 'Battle': {
      const list = (json) => {
        try { return JSON.parse(json).join(', '); } catch { return json; }
      };
      return args[3]
        ? `Battle(${args[0]} [${list(args[1])}] vs ${args[2]} [${list(args[3])}])`
        : `Battle(${args[0]} [${list(args[1])}] vs ${args[2]})`;
    }
    default:
      return `${tx.function}(${args.join(', ')})`;
  }
}

export const FUNCTION_LABELS = {
  InitLedger: 'Demo data created',
  RegisterPlayer: 'Player registered',
  Battle: 'Battle recorded',
  CreateTrade: 'Trade offer created',
  AcceptTrade: 'Trade accepted',
  CancelTrade: 'Trade cancelled',
};
