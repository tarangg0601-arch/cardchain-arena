import { useCallback, useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext';
import Alert from '../components/Alert';
import Icon from '../components/Icon';
import PageHeader from '../components/PageHeader';
import { useLedger } from '../ledger/LedgerContext';
import { describeTx, formatTime, short } from '../ledger/format';

function Hash({ label, value }) {
  return (
    <div className="hash-row">
      <span className="hash-label">{label}</span>
      <code title={value}>{value ? short(value, 16) : 'none (genesis)'}</code>
    </div>
  );
}

function Transaction({ tx }) {
  const writes = tx.writes || [];
  return (
    <div className="tx">
      <div className="tx-top">
        <span className={`badge ${tx.valid ? 'ok' : 'bad'}`}>{tx.validationCode}</span>
        <span className="tx-call">{tx.type === 'CONFIG' ? 'Channel configuration (genesis)' : describeTx(tx)}</span>
      </div>
      <dl className="tx-facts">
        {tx.txId && <><dt>Tx ID</dt><dd><code title={tx.txId}>{short(tx.txId, 24)}</code></dd></>}
        {tx.chaincode && <><dt>Chaincode</dt><dd>{tx.chaincode}</dd></>}
        {tx.creator?.mspId && <><dt>Submitted by</dt><dd>{tx.creator.name} ({tx.creator.mspId})</dd></>}
        {tx.endorsers?.length > 0 && (
          <><dt>Endorsed by</dt><dd className="chips">{tx.endorsers.map((e) => (
            <span key={`${e.mspId}${e.name}`} className="chip static" title={e.name}>{e.mspId}</span>
          ))}</dd></>
        )}
        {writes.length > 0 && (
          <><dt>Wrote keys</dt><dd>
            <details className="writes">
              <summary>{writes.length} key{writes.length > 1 ? 's' : ''}: {writes.slice(0, 3).map((w) => w.key).join(', ')}{writes.length > 3 ? ', ...' : ''}</summary>
              <div className="chips">{writes.map((w) => <span key={w.key} className="chip static mono">{w.key}</span>)}</div>
            </details>
          </dd></>
        )}
      </dl>
    </div>
  );
}

function Block({ block, highlighted }) {
  return (
    <li className={highlighted ? 'block highlighted' : 'block'} id={`block-${block.number}`}>
      <div className="block-head">
        <h3>Block #{block.number}</h3>
        <span className="muted small">{formatTime(block.timestamp)}{block.simulated ? ' (simulated)' : ''}</span>
      </div>
      <div className="hashes">
        <Hash label="Hash" value={block.hash} />
        <Hash label="Previous" value={block.previousHash} />
        <Hash label="Data" value={block.dataHash} />
      </div>
      {block.transactions.length === 0 ? (
        <p className="muted small">Genesis block</p>
      ) : (
        block.transactions.map((tx, i) => <Transaction key={tx.txId || i} tx={tx} />)
      )}
    </li>
  );
}

export default function LedgerPage() {
  const { api, status } = useAuth();
  const { summary } = useLedger();
  const [params] = useSearchParams();
  const target = params.get('block') === null ? null : Number(params.get('block'));
  const [page, setPage] = useState(null);
  const [blocks, setBlocks] = useState([]);
  const [rejected, setRejected] = useState([]);
  const [verify, setVerify] = useState(null);
  const [verifying, setVerifying] = useState(false);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    setError('');
    try {
      const first = await api('/ledger/blocks?limit=10');
      let list = first.blocks;
      if (target !== null && Number.isInteger(target) && !list.some((b) => b.number === target) && target < first.height) {
        const around = await api(`/ledger/blocks?before=${target + 1}&limit=5`);
        list = [...list, ...around.blocks.filter((b) => b.number < list[list.length - 1].number)];
      }
      setPage(first);
      setBlocks(list);
      setRejected(await api('/ledger/rejected'));
    } catch (err) {
      setError(err.message);
    }
  }, [api, target]);

  useEffect(() => {
    load();
  }, [load, summary?.height]);

  useEffect(() => {
    if (target !== null) {
      document.getElementById(`block-${target}`)?.scrollIntoView?.({ block: 'center' });
    }
  }, [target, blocks.length]);

  async function loadOlder() {
    const oldest = blocks[blocks.length - 1];
    if (!oldest || oldest.number === 0) return;
    try {
      const older = await api(`/ledger/blocks?before=${oldest.number}&limit=10`);
      setBlocks((current) => [...current, ...older.blocks]);
    } catch (err) {
      setError(err.message);
    }
  }

  async function runVerify() {
    setVerifying(true);
    setVerify(null);
    try {
      setVerify(await api('/ledger/verify'));
    } catch (err) {
      setError(err.message);
    } finally {
      setVerifying(false);
    }
  }

  const fabric = status?.ledger.mode === 'fabric';
  const oldest = blocks[blocks.length - 1];

  return (
    <div className="page">
      <PageHeader
        title="Ledger explorer"
        actions={<button type="button" className="ghost" onClick={load}><Icon name="refresh" size={16} />Refresh</button>}
      />
      <Alert kind="error">{error}</Alert>

      <section className="panel chain-info">
        <div className="chain-facts">
          <div><span className="stat-label">{fabric ? 'Block height' : 'Local blocks'}</span><span className="stat-value">{page?.height ?? '-'}</span></div>
          <div className="grow"><span className="stat-label">Latest block hash</span><code className="wrap">{page?.currentBlockHash || '-'}</code></div>
          {summary && (
            <div><span className="stat-label">Valid / invalid tx</span><span className="stat-value">{summary.counts.valid} / {summary.counts.invalid}</span></div>
          )}
        </div>
        <div className="verify">
          <button type="button" className="primary" onClick={runVerify} disabled={verifying}>
            <Icon name="shield" size={16} />{verifying ? 'Verifying...' : 'Verify chain'}
          </button>
        </div>
        {verify && (
          <Alert kind={verify.valid ? 'success' : 'error'}>
            {verify.valid
              ? `Chain verified: all ${verify.blocksChecked} blocks match their hashes and link correctly.`
              : `Chain verification failed: ${verify.problems.map((p) => `block ${p.block}: ${p.issue}`).join('; ')}`}
          </Alert>
        )}
      </section>

      <div className="ledger-layout">
        <section>
          <ol className="chain" aria-label="Blocks, newest first">
            {blocks.map((block) => <Block key={block.number} block={block} highlighted={block.number === target} />)}
          </ol>
          {oldest && oldest.number > 0 && (
            <button type="button" className="ghost wide" onClick={loadOlder}>Load older blocks</button>
          )}
        </section>

        <aside>
          <section className="panel">
            <h2>Rejected transactions</h2>
            {rejected.length === 0 ? (
              <div className="empty small">No rejected transactions.</div>
            ) : (
              <ul className="rejected-list">
                {rejected.map((r) => (
                  <li key={`${r.time}${r.function}`}>
                    <div className="tx-top"><span className="badge bad">{r.code}</span><strong>{r.function}</strong></div>
                    <p>{r.message}</p>
                    <p className="muted small">{formatTime(r.time)}</p>
                  </li>
                ))}
              </ul>
            )}
          </section>

        </aside>
      </div>
    </div>
  );
}
