import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import { ApiError } from '../api';
import { AuthContext } from '../auth/AuthContext';
import BattlePage from '../pages/BattlePage';
import DeckPage from '../pages/DeckPage';
import FriendsPage from '../pages/FriendsPage';
import ShopPage from '../pages/ShopPage';
import TradePage from '../pages/TradePage';
import { battleResult, card, mockApi, p1Cards, player1, player2 } from './fixtures';

function renderPage(page, api, extra = {}) {
  const value = {
    api,
    me: { account: { playerId: 'player1', username: 'player1' }, player: player1 },
    refreshMe: vi.fn(async () => {}),
    ...extra,
  };
  render(
    <AuthContext.Provider value={value}>
      <MemoryRouter>{page}</MemoryRouter>
    </AuthContext.Provider>,
  );
  return value;
}

describe('Deck page', () => {
  it('shows every card field including the trade lock status', async () => {
    renderPage(<DeckPage />, mockApi({ 'GET /players/player1/cards': p1Cards }));
    const griffin = await screen.findByTestId('card-P1-04');
    expect(griffin).toHaveTextContent('Thunder Griffin');
    expect(griffin).toHaveTextContent('Legendary');
    expect(griffin).toHaveTextContent('Air');
    expect(griffin).toHaveTextContent(/ATK\s*50/);
    expect(griffin).toHaveTextContent(/DEF\s*40/);
    expect(griffin).toHaveTextContent(/XP\s*0/);
    expect(griffin).toHaveTextContent('P1-04');
    expect(griffin).toHaveTextContent('Locked in trade T-OLD');
    expect(screen.getByTestId('card-P1-01')).toHaveTextContent('Available');
    expect(screen.getByText(/4 cards, 3 available, 1 locked/)).toBeInTheDocument();
  });

  it('shows an error instead of cards when the request fails', async () => {
    const api = vi.fn(async () => { throw new ApiError(503, 'LEDGER_UNAVAILABLE', 'The Fabric network is unavailable'); });
    renderPage(<DeckPage />, api);
    expect(await screen.findByRole('alert')).toHaveTextContent('The Fabric network is unavailable');
    expect(screen.queryByTestId('card-P1-01')).not.toBeInTheDocument();
  });
});

const NO_FRIENDS = { friends: [], incoming: [], outgoing: [] };
const PLAYERS = [{ ...player1, rank: 1 }, { ...player2, rank: 2 }];
const CATALOG = [
  { cardId: 'P2-01', name: 'Moss Golem', type: 'Earth', rarity: 'Common', attack: 46, defense: 44 },
  { cardId: 'AL-S1', name: 'Tide Sprite', type: 'Water', rarity: 'Common', attack: 44, defense: 41 },
];

describe('Trade page', () => {
  function tradeRoutes(overrides = {}) {
    let mine = [];
    return {
      'GET /players': PLAYERS,
      'GET /players/player1/cards': p1Cards,
      'GET /cards/catalog': CATALOG,
      'GET /friends': NO_FRIENDS,
      'GET /trades/mine': () => mine,
      'POST /trades': (body) => {
        mine = [{
          tradeId: 'T-NEW1', fromPlayer: 'player1', fromUsername: 'player1', offeredCardId: body.offeredCardId,
          offeredCardName: 'Ember Fox', toPlayer: 'player2', toUsername: 'player2', requestedCardId: body.requestedCardId,
          requestedCardName: 'Moss Golem', status: 'OPEN', createdAt: '2026-10-19T10:00:00.000Z',
        }];
        return { trade: mine[0], txId: 'tx1', blockNumber: 4 };
      },
      ...overrides,
    };
  }

  async function fillForm(user, wanted = 'P2-01') {
    await screen.findByRole('option', { name: 'player2' });
    await user.selectOptions(screen.getByLabelText('Send to'), 'player2');
    await user.selectOptions(screen.getByLabelText('You give'), 'P1-01');
    await user.selectOptions(screen.getByLabelText('You want'), wanted);
  }

  it('lists every other card without owners and sends a trade request', async () => {
    const user = userEvent.setup();
    const api = mockApi(tradeRoutes());
    const ctx = renderPage(<TradePage />, api);
    expect(await screen.findByRole('option', { name: /Tide Sprite \(AL-S1\)/ })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: /Thunder Griffin.*locked/ })).toBeDisabled();
    expect(api).not.toHaveBeenCalledWith('/players/player2/cards');

    await fillForm(user);
    await user.click(screen.getByRole('button', { name: 'Send trade request' }));

    expect(await screen.findByText('Trade request T-NEW1 sent to player2.')).toBeInTheDocument();
    expect(api).toHaveBeenCalledWith('/trades', { method: 'POST', body: { toPlayer: 'player2', offeredCardId: 'P1-01', requestedCardId: 'P2-01' } });
    const sent = await screen.findByTestId('sent-trades');
    expect(within(sent).getByRole('button', { name: 'Cancel' })).toBeInTheDocument();
    await waitFor(() => expect(ctx.refreshMe).toHaveBeenCalled());
  });

  it('filters the wanted cards by search text', async () => {
    const user = userEvent.setup();
    renderPage(<TradePage />, mockApi(tradeRoutes()));
    await screen.findByRole('option', { name: /Tide Sprite/ });
    await user.type(screen.getByLabelText('Search cards'), 'golem');
    expect(screen.queryByRole('option', { name: /Tide Sprite/ })).not.toBeInTheDocument();
    expect(screen.getByRole('option', { name: /Moss Golem \(P2-01\)/ })).toBeInTheDocument();
  });

  it('shows the smart contract rejection when the recipient does not own the card', async () => {
    const user = userEvent.setup();
    const api = mockApi(tradeRoutes({
      'POST /trades': () => { throw new ApiError(403, 'FORBIDDEN', 'Card Tide Sprite (AL-S1) is not owned by player2'); },
    }));
    const ctx = renderPage(<TradePage />, api);
    await fillForm(user, 'AL-S1');
    await user.click(screen.getByRole('button', { name: 'Send trade request' }));
    expect(await screen.findByRole('alert'))
      .toHaveTextContent('Rejected by smart contract: Card Tide Sprite (AL-S1) is not owned by player2');
    expect(screen.queryByText(/sent to/)).not.toBeInTheDocument();
    expect(ctx.refreshMe).not.toHaveBeenCalled();
  });

  it('lets the recipient accept or decline incoming requests', async () => {
    const incoming = {
      tradeId: 'T-IN', fromPlayer: 'player2', fromUsername: 'player2', offeredCardId: 'P2-02', offeredCardName: 'Wind Dancer',
      toPlayer: 'player1', toUsername: 'player1', requestedCardId: 'P1-02', requestedCardName: 'Frost Warden',
      status: 'OPEN', createdAt: '2026-10-19T10:00:00.000Z',
    };
    const user = userEvent.setup();
    let status = 'OPEN';
    const api = mockApi(tradeRoutes({
      'GET /trades/mine': () => [{ ...incoming, status }],
      'POST /trades/T-IN/decline': () => { status = 'DECLINED'; return { trade: { ...incoming, status }, txId: 'tx2', blockNumber: 5 }; },
    }));
    renderPage(<TradePage />, api);
    const list = await screen.findByTestId('incoming-trades');
    expect(within(list).getByText('From player2')).toBeInTheDocument();
    expect(within(list).getByRole('button', { name: 'Accept' })).toBeInTheDocument();
    await user.click(within(list).getByRole('button', { name: 'Decline' }));
    expect(await screen.findByText('Trade T-IN declined.')).toBeInTheDocument();
    expect(await screen.findByText('No incoming requests.')).toBeInTheDocument();
  });
});

describe('Battle page', () => {
  function battleRoutes(postBattle) {
    return mockApi({
      'GET /players': PLAYERS,
      'GET /players/player1/cards': p1Cards,
      'GET /battles/mine': [],
      'GET /friends': NO_FRIENDS,
      'POST /battles': postBattle,
    });
  }

  async function pickCards(user) {
    await user.selectOptions(await screen.findByLabelText('Opponent'), 'player2');
    for (const id of ['P1-01', 'P1-02', 'P1-03']) {
      await user.click(await screen.findByTestId(`card-${id}`));
    }
  }

  it('hides the opponent cards and does not allow trade-locked cards to be picked', async () => {
    const api = battleRoutes(() => battleResult());
    renderPage(<BattlePage fightMs={0} />, api);
    expect(await screen.findByTestId('card-P1-04')).toBeDisabled();
    expect(screen.getAllByText('Hidden card')).toHaveLength(3);
    expect(api).not.toHaveBeenCalledWith('/players/player2/cards');
  });

  it('random pick selects three available cards', async () => {
    const user = userEvent.setup();
    renderPage(<BattlePage fightMs={0} />, battleRoutes(() => battleResult()));
    await screen.findByTestId('card-P1-01');
    await user.click(screen.getByRole('button', { name: 'Random pick' }));
    const picked = screen.getAllByRole('button', { pressed: true });
    expect(picked).toHaveLength(3);
    expect(picked.map((el) => el.dataset.testid)).not.toContain('card-P1-04');
  });

  it('plays the fight animation and then shows the contract result', async () => {
    const user = userEvent.setup();
    const api = battleRoutes(() => ({ battle: battleResult(), txId: 'f'.repeat(64), blockNumber: 9 }));
    const ctx = renderPage(<BattlePage fightMs={300} />, api);
    await pickCards(user);
    await user.click(screen.getByRole('button', { name: 'Start battle' }));

    expect(await screen.findByTestId('battle-animation')).toHaveTextContent('Round 1');
    expect(screen.queryByTestId('battle-result')).not.toBeInTheDocument();

    const result = await screen.findByTestId('battle-result', {}, { timeout: 2000 });
    expect(screen.queryByTestId('battle-animation')).not.toBeInTheDocument();
    expect(result).toHaveTextContent('player2 wins 3 - 0');
    expect(result).toHaveTextContent('1000 → 984 (-16)');
    expect(result).toHaveTextContent('Solar Wyrm');
    expect(api).toHaveBeenCalledWith('/battles', {
      method: 'POST', body: { opponentId: 'player2', myCardIds: ['P1-01', 'P1-02', 'P1-03'] },
    });
    await waitFor(() => expect(ctx.refreshMe).toHaveBeenCalled());
  });

  it('stops the animation and shows the rejection when the battle fails', async () => {
    const user = userEvent.setup();
    const api = battleRoutes(() => {
      throw new ApiError(409, 'CONFLICT', 'player2 does not have 3 cards available for battle');
    });
    const ctx = renderPage(<BattlePage fightMs={5000} />, api);
    await pickCards(user);
    await user.click(screen.getByRole('button', { name: 'Start battle' }));
    expect(await screen.findByRole('alert'))
      .toHaveTextContent('Rejected by smart contract: player2 does not have 3 cards available for battle');
    expect(screen.queryByTestId('battle-animation')).not.toBeInTheDocument();
    expect(screen.queryByTestId('battle-result')).not.toBeInTheDocument();
    expect(ctx.refreshMe).not.toHaveBeenCalled();
  });
});

describe('Card shop', () => {
  const PACKS = [
    { packId: 'standard', name: 'Standard pack', price: 30, odds: { Common: 70, Rare: 24, Epic: 5, Legendary: 1 } },
    { packId: 'elite', name: 'Elite pack', price: 150, odds: { Common: 0, Rare: 0, Epic: 70, Legendary: 30 } },
  ];

  it('buys a pack and shows the new card', async () => {
    const user = userEvent.setup();
    const api = mockApi({
      'GET /shop/packs': PACKS,
      'POST /shop/buy': (body) => ({
        card: card('PK-ABC', 'player1', { name: 'Coral Serpent', type: 'Water', rarity: 'Rare', origin: 'PACK' }),
        pack: PACKS.find((p) => p.packId === body.packId), roll: 80, coins: 70, txId: 'a'.repeat(64), blockNumber: 6,
      }),
    });
    const ctx = renderPage(<ShopPage />, api, { me: { account: { playerId: 'player1' }, player: { ...player1, coins: 100 } } });
    expect(await screen.findByText('Elite pack')).toBeInTheDocument();
    expect(screen.queryByText(/Common/, { selector: '.pack-elite span' })).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Buy for 30' }));
    const result = await screen.findByTestId('pack-result');
    expect(result).toHaveTextContent('You got Coral Serpent');
    expect(result).toHaveTextContent('70');
    expect(ctx.refreshMe).toHaveBeenCalled();
  });

  it('shows the contract rejection when coins are not enough', async () => {
    const user = userEvent.setup();
    renderPage(<ShopPage />, mockApi({
      'GET /shop/packs': PACKS,
      'POST /shop/buy': () => { throw new ApiError(409, 'CONFLICT', 'Elite pack costs 150 coins but player1 has 100'); },
    }), { me: { account: { playerId: 'player1' }, player: { ...player1, coins: 100 } } });
    await user.click(await screen.findByRole('button', { name: 'Buy for 150' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Rejected by smart contract: Elite pack costs 150 coins but player1 has 100');
    expect(screen.queryByTestId('pack-result')).not.toBeInTheDocument();
  });
});

describe('Friends page', () => {
  it('sends a request by username and accepts an incoming one', async () => {
    const user = userEvent.setup();
    let state = {
      friends: [],
      incoming: [{ requestId: 'F-1', fromPlayer: 'player2', fromUsername: 'player2', toPlayer: 'player1', toUsername: 'player1', status: 'PENDING' }],
      outgoing: [],
    };
    const api = mockApi({
      'GET /friends': () => state,
      'GET /players': PLAYERS,
      'POST /friends/requests': (body) => ({ request: { requestId: 'F-2', toUsername: body.username }, txId: 'b'.repeat(64), blockNumber: 3 }),
      'POST /friends/requests/F-1/accept': () => {
        state = { friends: [{ ...player2 }], incoming: [], outgoing: [] };
        return { request: { status: 'ACCEPTED' }, txId: 'c'.repeat(64), blockNumber: 4 };
      },
    });
    renderPage(<FriendsPage />, api);

    await user.type(await screen.findByLabelText('Friend username'), 'alice');
    await user.click(screen.getByRole('button', { name: 'Send request' }));
    expect(await screen.findByText('Friend request sent to alice.')).toBeInTheDocument();
    expect(api).toHaveBeenCalledWith('/friends/requests', { method: 'POST', body: { username: 'alice' } });

    const requests = screen.getByTestId('friend-requests');
    await user.click(within(requests).getByRole('button', { name: 'Accept' }));
    expect(await screen.findByText('You and player2 are now friends.')).toBeInTheDocument();
    const list = await screen.findByTestId('friend-list');
    expect(within(list).getByText('player2')).toBeInTheDocument();
    expect(within(list).getByRole('link', { name: 'Battle' })).toHaveAttribute('href', '/battle?opponent=player2');
  });
});
