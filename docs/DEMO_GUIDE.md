# Demonstration Guide (80% evaluation)

A 10-15 minute walkthrough for presenting to your teacher. Every step works in Fabric and Local mode.
The status panel at the bottom of the sidebar shows which one is running.

Start from fresh data:

- Local mode: stop the backend, delete `backend/data/`, run `npm run start:local`.
- Fabric mode: `./scripts/fabric-network.sh down`, `up`, `deploy`, delete `backend/data/`, `npm run start:fabric`.

Open http://localhost:4000.

## 1. Mode and registration

1. Point at the status panel: **Mode: Hyperledger Fabric** (green, with channel, chaincode, peer and
   identity) or **Mode: Local demo ledger** (amber).
2. Click **Create an account** and register, e.g. `alice` / `alice1234`.
   Show the result: player ID, rating 1000, **100 coins**, the block number and transaction ID, and
   three starter cards (two Common, one Rare).
3. Click **Enter the game**. The **Dashboard** shows your cards, your coins and the latest blocks.
4. Try registering `alice` again: rejected, usernames are unique.

## 2. Card shop

1. Open **Card shop** and buy a **Standard pack** (30 coins).
2. The new card appears with its roll, the coins left (70) and its block number. The coin balance
   in the sidebar updates.
3. Click **Buy** on the **Elite pack** (150 coins): **Rejected by smart contract** because the
   balance is too low.

## 3. Friends

1. Open **Friends**, type `player1` and click **Send request**.
2. Log out and click **Continue as player1** on the login page. The **Friends** item in the
   sidebar shows a badge.
3. Open **Friends** and click **Accept**. alice now appears under **My friends**, with Battle and
   Trade buttons.

## 4. Battle with hidden opponent cards

1. Open **Battle arena** and choose **alice** (listed under Friends) or **Random opponent**.
2. The opponent's three cards show as **Hidden card**. Pick your own three cards, or click **Random pick**.
3. Click **Start battle**. The fight animation plays for about 4 seconds while the transaction is
   committed, then the result appears:
   - the opponent's cards, now revealed: the smart contract drew them from the transaction ID
   - each round's stats, bonuses, type advantage and damage
   - rating changes, XP, +20 coins for the winner, and the reward card (no reward for a draw)
4. The receipt in the corner shows the block number. Click it to open that block.

## 5. Trading and the smart contract check

1. Open **Trade market**. Choose **Send to: player2** and a card under **You give**.
2. Under **You want**, every card on the ledger is listed, without owners. Search for a card that
   belongs to someone else, e.g. one of alice's cards (`player-...-S1`).
3. Click **Send trade request**: **Rejected by smart contract: Card ... is not owned by player2**.
   Nothing is locked, and the attempt appears under **Rejected transactions** in the Ledger explorer.
4. Now pick a card player2 does own (e.g. `P2-03`) and send the request. It appears under
   **Sent requests** and both cards are locked (see **My deck**).
5. Use the **Demo player switcher** to switch to **player2**. The **Trade market** badge shows 1.
   Under **Incoming requests**, click **Accept**: the two cards change owner on the ledger.
6. Send another request and use **Decline** (as the recipient) or **Cancel** (as the sender) to
   show the locks being released.

## 6. Ledger explorer

1. Open **Ledger explorer**. Each block shows its hash, previous hash and data hash, and each
   transaction shows the function and arguments, the transaction ID, who submitted it, which
   organisations endorsed it (Org1MSP and Org2MSP in Fabric mode) and which keys it wrote.
2. Point out the blocks for `BuyCardPack`, `SendFriendRequest`, `RespondFriendRequest`, `Battle`,
   `CreateTrade` and `AcceptTrade`.
3. Click **Verify chain**: every hash is recomputed and every link checked.
4. **Rejected transactions** lists the refused trade, the failed pack purchase and any other refused
   transactions. They never reach a block, so the block height did not change.

## 7. Leaderboard and persistence

- **Leaderboard** lists all players by rating.
- Stop the backend and start it again: everything is unchanged and the demo data is not recreated.
- Fabric mode: query `GetLeaderboard` from Org2's peer with the peer CLI (`docs/FABRIC_SETUP.md`,
  step 5) to show the same data comes from the blockchain. The `RewardWinner` command in that file
  shows the peers refusing a direct reward mint.

### Optional: tamper detection in Local mode

1. Stop the backend and copy `backend/data/local-ledger.json`.
2. In the file, change any `"function"` value inside `"blocks"` (for example `"Battle"` to `"RewardWinner"`).
3. Start the backend and click **Verify chain**: it reports which block no longer matches its hash.
4. Stop the backend and restore your copy.

## Resetting

- Local: stop the backend and delete `backend/data/`.
- Fabric: `./scripts/fabric-network.sh down`, then `up` and `deploy`; delete `backend/data/auth.json`
  to remove accounts too.
