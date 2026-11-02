import { useAuth } from '../auth/AuthContext';
import { useLedger } from '../ledger/LedgerContext';

// Shows which ledger the backend is using. Always visible, so nobody mistakes
// the local demonstration ledger for the Fabric network.
export default function NetworkStatus({ showHeight = true }) {
  const { status, statusError } = useAuth();
  const { summary } = useLedger();

  if (statusError) {
    return (
      <div className="network-status net-down" data-testid="ledger-mode">
        <div className="net-title"><span className="net-dot" />Backend unreachable</div>
        <p>{statusError}</p>
      </div>
    );
  }
  if (!status) {
    return <div className="network-status"><div className="net-title"><span className="net-dot" />Connecting...</div></div>;
  }

  const { ledger, fallbackReason } = status;
  const fabric = ledger.mode === 'fabric';
  return (
    <div className={`network-status ${fabric ? 'net-fabric' : 'net-local'}`} data-testid="ledger-mode">
      <div className="net-title">
        <span className="net-dot" />
        {fabric ? 'Mode: Hyperledger Fabric' : 'Mode: Local demo ledger'}
      </div>
      {fabric ? (
        <dl className="net-facts">
          <dt>Channel</dt><dd>{ledger.channel}</dd>
          <dt>Chaincode</dt><dd>{ledger.chaincode}</dd>
          <dt>Peer</dt><dd>{ledger.peerEndpoint}</dd>
          <dt>Identity</dt><dd>{ledger.mspId}</dd>
          {showHeight && summary && <><dt>Block height</dt><dd>{summary.height}</dd></>}
        </dl>
      ) : (
        <dl className="net-facts">
          <dt>Storage</dt><dd>{ledger.localLedgerFile}</dd>
          {fallbackReason && <><dt>Fabric</dt><dd title={fallbackReason}>Offline</dd></>}
          {showHeight && summary && <><dt>Local blocks</dt><dd>{summary.height}</dd></>}
        </dl>
      )}
    </div>
  );
}
