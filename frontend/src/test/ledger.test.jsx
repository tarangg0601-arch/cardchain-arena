import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import { AuthContext } from '../auth/AuthContext';
import { LedgerProvider } from '../ledger/LedgerContext';
import LedgerPage from '../pages/LedgerPage';
import TradePage from '../pages/TradePage';
import { mockApi, p1Cards, player1, player2 } from './fixtures';

const FABRIC_STATUS = {
  ledger: { mode: 'fabric', channel: 'mychannel', chaincode: 'tcg', mspId: 'Org1MSP', peerEndpoint: 'localhost:7051' },
  requestedMode: 'fabric',
  fallbackReason: null,
  demoMode: true,
};

const SUMMARY = {
  network: FABRIC_STATUS.ledger, height: 6, currentBlockHash: 'aa'.repeat(32),
  counts: { total: 6, valid: 6, invalid: 0, game: 2 }, lastGameTx: null,
  stats: { players: 2, cards: 8, openTrades: 0, battles: 1 }, rejectedCount: 1,
};

const BLOCK = {
  number: 5, hash: 'aa'.repeat(32), previousHash: 'bb'.repeat(32), dataHash: 'cc'.repeat(32),
  timestamp: '2026-10-19T10:00:00.000Z', simulated: false,
  transactions: [{
    txId: 'd'.repeat(64), type: 'ENDORSER_TRANSACTION', timestamp: '2026-10-19T10:00:00.000Z',
    creator: { mspId: 'Org1MSP', name: 'User1@org1.example.com' }, validationCode: 'VALID', valid: true,
    chaincode: 'tcg', function: 'AcceptTrade', args: ['T-1', 'player2'],
    endorsers: [{ mspId: 'Org1MSP', name: 'peer0.org1.example.com' }, { mspId: 'Org2MSP', name: 'peer0.org2.example.com' }],
    writes: [{ key: 'CARD_P1-01', isDelete: false }, { key: 'CARD_P2-01', isDelete: false }, { key: 'TRADE_T-1', isDelete: false }],
  }],
};

function renderWithLedger(page, routes) {
  const api = mockApi({
    'GET /ledger/summary': SUMMARY, 'GET /me/notifications': { friendRequests: 0, tradeRequests: 0 }, ...routes,
  });
  const value = {
    api,
    status: FABRIC_STATUS,
    me: { account: { playerId: 'player1', username: 'player1' }, player: player1 },
    refreshMe: vi.fn(async () => {}),
  };
  render(
    <AuthContext.Provider value={value}>
      <MemoryRouter>
        <LedgerProvider>{page}</LedgerProvider>
      </MemoryRouter>
    </AuthContext.Provider>,
  );
  return api;
}

describe('Ledger explorer', () => {
  it('shows blocks with hashes, endorsers and written keys, and verifies the chain', async () => {
    const user = userEvent.setup();
    renderWithLedger(<LedgerPage />, {
      'GET /ledger/blocks?limit=10': { height: 6, currentBlockHash: BLOCK.hash, blocks: [BLOCK] },
      'GET /ledger/rejected': [{
        time: '2026-10-19T10:01:00.000Z', function: 'AcceptTrade', code: 'FORBIDDEN',
        message: 'Only player2 can accept trade T-2', stage: 'Rejected by the chaincode during endorsement.',
      }],
      'GET /ledger/verify': { valid: true, blocksChecked: 6, problems: [] },
    });

    const block = await screen.findByText('Block #5');
    const card = block.closest('li');
    expect(card).toHaveTextContent('AcceptTrade(T-1, player2)');
    expect(card).toHaveTextContent('VALID');
    expect(within(card).getByText('Org2MSP')).toBeInTheDocument();
    expect(card).toHaveTextContent('3 keys: CARD_P1-01, CARD_P2-01, TRADE_T-1');
    expect(card).toHaveTextContent('User1@org1.example.com (Org1MSP)');
    expect(screen.getByText('Only player2 can accept trade T-2')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Verify chain' }));
    expect(await screen.findByText(/Chain verified: all 6 blocks/)).toBeInTheDocument();
  });

  it('reports a broken chain', async () => {
    const user = userEvent.setup();
    renderWithLedger(<LedgerPage />, {
      'GET /ledger/blocks?limit=10': { height: 6, currentBlockHash: BLOCK.hash, blocks: [BLOCK] },
      'GET /ledger/rejected': [],
      'GET /ledger/verify': { valid: false, blocksChecked: 6, problems: [{ block: 2, issue: 'Previous-hash link does not match block 1' }] },
    });
    await screen.findByText('Block #5');
    await user.click(screen.getByRole('button', { name: 'Verify chain' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('block 2: Previous-hash link does not match block 1');
  });
});

describe('Transaction receipt', () => {
  it('shows the block number and transaction ID after a successful write', async () => {
    const user = userEvent.setup();
    renderWithLedger(<TradePage />, {
      'GET /players': [{ ...player1, rank: 1 }, { ...player2, rank: 2 }],
      'GET /players/player1/cards': p1Cards,
      'GET /cards/catalog': [{ cardId: 'P2-01', name: 'Moss Golem', type: 'Earth', rarity: 'Common', attack: 46, defense: 44 }],
      'GET /friends': { friends: [], incoming: [], outgoing: [] },
      'GET /trades/mine': [],
      'POST /trades': () => ({
        trade: { tradeId: 'T-AAA', status: 'OPEN' }, txId: 'e'.repeat(64), blockNumber: 7,
      }),
    });
    await screen.findByRole('option', { name: 'player2' });
    await user.selectOptions(screen.getByLabelText('Send to'), 'player2');
    await user.selectOptions(screen.getByLabelText('You give'), 'P1-01');
    await user.selectOptions(screen.getByLabelText('You want'), 'P2-01');
    await user.click(screen.getByRole('button', { name: 'Send trade request' }));

    const receipt = await screen.findByTestId('tx-receipt');
    expect(receipt).toHaveTextContent('Trade request sent');
    expect(receipt).toHaveTextContent('Committed to the channel in block #7');
    expect(receipt).toHaveTextContent(`tx ${'e'.repeat(20)}`);
  });
});
