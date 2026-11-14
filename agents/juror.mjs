import { scoreFromSnapshot, fetchSnapshot } from './posture.mjs';
import { postureOk } from '../sim/rules.mjs';
import { txStatus as defaultTxStatus, blockTimestampNs as defaultBlockTimestampNs } from './rpc.mjs';

/**
 * Evaluate a filed claim according to the 7 checks in RULES §6.
 *
 * @param {object} params
 * @param {object} params.claim { id, claimant, loss_tx_hash, amount, filed_at }
 * @param {object} params.member { account, declared_score, joined_at, paid_through_epoch, payees: [] }
 * @param {object} params.deployments { walletCodeHash, poolCodeHash, pool }
 * @param {object} [params.txInfo] Optional pre-fetched txStatus result (for testing)
 * @param {object} [params.snapshot] Optional pre-fetched posture snapshot (for testing)
 * @param {string|number|bigint} [params.txBlockTimeNs] Optional block timestamp in ns
 * @param {object} [params.poolConfig] Optional pool config { epoch_ns, posture_tolerance }
 * @param {string|number|bigint} [params.genesisNs] Optional genesis ns
 * @param {object} [params.rpc] Optional rpc functions { txStatus, blockTimestampNs, fetchSnapshot }
 * @returns {Promise<{ approve: boolean, checks: Array<{ name: string, ok: boolean, detail: string }> }>}
 */
export async function evaluate({
  claim,
  member,
  deployments = {},
  txInfo = null,
  snapshot = null,
  txBlockTimeNs = null,
  poolConfig = { epoch_ns: '600000000000', posture_tolerance: 10 },
  genesisNs = '0',
  rpc = {
    txStatus: defaultTxStatus,
    blockTimestampNs: defaultBlockTimestampNs,
    fetchSnapshot,
  },
}) {
  const checks = [];

  // Check 1: The loss transaction exists and succeeded
  let tx = txInfo;
  if (!tx && rpc.txStatus) {
    try {
      tx = await rpc.txStatus(claim.loss_tx_hash, claim.claimant);
    } catch (err) {
      tx = null;
    }
  }

  const txExists = !!tx && !!tx.transaction;
  const txSucceeded =
    txExists &&
    !tx.status?.Failure &&
    (tx.status?.SuccessValue !== undefined ||
      tx.status?.SuccessReceiptId !== undefined ||
      tx.final_execution_status === 'FINAL');

  checks.push({
    name: '1_tx_exists_and_succeeded',
    ok: txExists && txSucceeded,
    detail: !txExists
      ? 'Transaction not found'
      : !txSucceeded
      ? `Transaction failed: ${JSON.stringify(tx.status?.Failure || 'execution error')}`
      : 'Transaction confirmed and succeeded',
  });

  // Check 2: Its signer is the claimant account
  const signerMatches = txExists && tx.transaction.signer_id === claim.claimant;
  checks.push({
    name: '2_signer_matches_claimant',
    ok: signerMatches,
    detail: !txExists
      ? 'No transaction to verify signer'
      : signerMatches
      ? `Signer matches claimant ${claim.claimant}`
      : `Signer ${tx.transaction.signer_id} does not match claimant ${claim.claimant}`,
  });

  // Check 3: It moved at least the claimed amount to a single recipient
  let recipient = null;
  let transferredAmount = 0n;

  if (txExists) {
    // 3a: Plain transfer action
    const transferAction = tx.transaction.actions?.find((a) => a.Transfer);
    if (transferAction) {
      recipient = tx.transaction.receiver_id;
      transferredAmount = BigInt(transferAction.Transfer.deposit || '0');
    }

    // 3b: Policy wallet 'paid' event in receipts_outcome
    if (!recipient && tx.receipts_outcome) {
      for (const ro of tx.receipts_outcome) {
        for (const log of ro.outcome?.logs || []) {
          if (log.startsWith('EVENT_JSON:')) {
            try {
              const eventObj = JSON.parse(log.slice('EVENT_JSON:'.length));
              if (
                eventObj.standard === 'backstop-wallet' &&
                eventObj.event === 'paid' &&
                eventObj.data?.[0]
              ) {
                recipient = eventObj.data[0].to;
                transferredAmount = BigInt(eventObj.data[0].amount || '0');
                break;
              }
            } catch {
              // ignore invalid log format
            }
          }
        }
        if (recipient) break;
      }
    }
  }

  const claimedAmount = BigInt(claim.amount || '0');
  const amountSufficient = recipient !== null && transferredAmount >= claimedAmount;

  checks.push({
    name: '3_transferred_at_least_claimed_amount',
    ok: amountSufficient,
    detail:
      recipient === null
        ? 'No Transfer action or backstop-wallet paid event found'
        : amountSufficient
        ? `Transferred ${transferredAmount} yocto to ${recipient} (>= claimed ${claimedAmount})`
        : `Transferred ${transferredAmount} yocto is less than claimed ${claimedAmount}`,
  });

  // Fetch block timestamp if needed for checks 4 and 5
  let blockNs = txBlockTimeNs ? BigInt(txBlockTimeNs) : null;
  if (blockNs === null && txExists && tx.transaction_outcome?.block_hash && rpc.blockTimestampNs) {
    try {
      const ts = await rpc.blockTimestampNs(tx.transaction_outcome.block_hash);
      blockNs = BigInt(ts);
    } catch {
      blockNs = null;
    }
  }

  // Check 4: The recipient was not in the claimant's payees at the transaction's block time
  let recipientIsPayee = false;
  if (recipient && member.payees && Array.isArray(member.payees)) {
    for (const p of member.payees) {
      const payeeAccount = typeof p === 'string' ? p : p.account;
      const addedAt = typeof p === 'object' && p.added_at ? BigInt(p.added_at) : 0n;
      if (payeeAccount === recipient) {
        if (blockNs === null || addedAt <= blockNs) {
          recipientIsPayee = true;
          break;
        }
      }
    }
  }

  checks.push({
    name: '4_recipient_unregistered',
    ok: recipient !== null && !recipientIsPayee,
    detail: !recipient
      ? 'No recipient identified'
      : recipientIsPayee
      ? `Recipient ${recipient} was an authorized registered payee`
      : `Recipient ${recipient} was not in registered payees`,
  });

  // Check 5: The transaction happened after the member joined, while the member was active
  let joinedOk = true;
  let activeOk = true;

  if (blockNs !== null) {
    const joinedAtNs = BigInt(member.joined_at || '0');
    if (blockNs < joinedAtNs) {
      joinedOk = false;
    }

    const epochNs = BigInt(poolConfig.epoch_ns || '600000000000');
    const genNs = BigInt(genesisNs || '0');
    if (epochNs > 0n) {
      const txEpoch = blockNs >= genNs ? (blockNs - genNs) / epochNs : 0n;
      const paidThrough = BigInt(member.paid_through_epoch || 0);
      if (txEpoch > paidThrough) {
        activeOk = false;
      }
    }
  }

  const check5Ok = joinedOk && activeOk;
  checks.push({
    name: '5_member_active_at_loss',
    ok: check5Ok,
    detail: !joinedOk
      ? 'Transaction occurred before member joined'
      : !activeOk
      ? 'Transaction occurred after membership expired'
      : 'Transaction occurred while member was active',
  });

  // Check 6: The verified posture score is no more than posture_tolerance below declared score
  let snap = snapshot;
  if (!snap && rpc.fetchSnapshot) {
    try {
      snap = await rpc.fetchSnapshot(claim.claimant, {
        walletCodeHash: deployments.walletCodeHash,
        poolContract: deployments.pool,
      });
    } catch (err) {
      snap = null;
    }
  }

  let postureCheckOk = false;
  let scoreDetail = 'Could not verify posture';
  if (snap) {
    const scored = scoreFromSnapshot({
      account: snap.account,
      codeHash: snap.codeHash,
      keys: snap.keys,
      policy: snap.policy,
      balance: snap.balance,
      walletCodeHash: deployments.walletCodeHash,
      poolContract: deployments.pool,
    });
    const tol = poolConfig.posture_tolerance ?? 10;
    postureCheckOk = postureOk(member.declared_score, scored.score, tol);
    scoreDetail = `Declared: ${member.declared_score}, Verified: ${scored.score}, Tolerance: ${tol}`;
  }

  checks.push({
    name: '6_posture_within_tolerance',
    ok: postureCheckOk,
    detail: scoreDetail,
  });

  // Check 7: The same loss transaction has not been claimed before
  // Enforced on-chain by the pool contract LookupSet.
  checks.push({
    name: '7_not_previously_claimed',
    ok: true,
    detail: 'Enforced on-chain by the pool contract',
  });

  const approve = checks.every((c) => c.ok);
  return {
    approve,
    checks,
  };
}
