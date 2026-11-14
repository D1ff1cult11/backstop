import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { evaluate } from '../agents/juror.mjs';

const plainTx = JSON.parse(
  readFileSync(resolve('test/fixtures/plain_transfer_tx.json'), 'utf8')
);
const walletTx = JSON.parse(
  readFileSync(resolve('test/fixtures/wallet_payment_tx.json'), 'utf8')
);
const failedTx = JSON.parse(
  readFileSync(resolve('test/fixtures/failed_tx.json'), 'utf8')
);

const beaPostureSnapshot = JSON.parse(
  readFileSync(resolve('test/fixtures/wallet_no_allowlist_90.json'), 'utf8')
);
const plainPostureSnapshot = JSON.parse(
  readFileSync(resolve('test/fixtures/plain_full_access.json'), 'utf8')
);

const DEPLOYMENTS = {
  walletCodeHash: 'WALLET_HASH_TEST',
  poolCodeHash: 'EDWJAJnJgCKtRxdg1Sns1onoWvQdfepAUEdGw46F5zFa',
  pool: 'pool.testnet',
};

test('a real loss to an unregistered payee is approved', async () => {
  const claim = {
    id: 1,
    claimant: 'bea.backstop-hq.testnet',
    loss_tx_hash: 'walletTxHash123',
    amount: '200000000000000000000000', // 0.2 NEAR
    filed_at: '1000000000',
  };

  const member = {
    account: 'bea.backstop-hq.testnet',
    declared_score: 90,
    joined_at: '100',
    paid_through_epoch: 10,
    payees: [
      {
        account: 'merchant.backstop-hq.testnet',
        added_at: '100',
      },
    ],
  };

  const res = await evaluate({
    claim,
    member,
    deployments: DEPLOYMENTS,
    txInfo: walletTx,
    snapshot: beaPostureSnapshot,
    txBlockTimeNs: '500',
    poolConfig: { epoch_ns: '1000', posture_tolerance: 10 },
  });

  assert.equal(res.approve, true);
  assert.equal(res.checks.every((c) => c.ok), true);
});

test('a payment to a registered payee is rejected', async () => {
  const claim = {
    id: 2,
    claimant: 'bea.backstop-hq.testnet',
    loss_tx_hash: 'walletTxHash123',
    amount: '200000000000000000000000',
    filed_at: '1000000000',
  };

  // mallory is registered as a payee before the tx
  const member = {
    account: 'bea.backstop-hq.testnet',
    declared_score: 90,
    joined_at: '100',
    paid_through_epoch: 10,
    payees: [
      {
        account: 'mallory.backstop-hq.testnet',
        added_at: '200',
      },
    ],
  };

  const res = await evaluate({
    claim,
    member,
    deployments: DEPLOYMENTS,
    txInfo: walletTx,
    snapshot: beaPostureSnapshot,
    txBlockTimeNs: '500',
    poolConfig: { epoch_ns: '1000', posture_tolerance: 10 },
  });

  assert.equal(res.approve, false);
  const payeeCheck = res.checks.find((c) => c.name === '4_recipient_unregistered');
  assert.ok(payeeCheck);
  assert.equal(payeeCheck.ok, false);
});

test('a missing transaction is rejected', async () => {
  const claim = {
    id: 3,
    claimant: 'cato.backstop-hq.testnet',
    loss_tx_hash: 'missingTxHash',
    amount: '800000000000000000000000',
    filed_at: '1000000000',
  };

  const member = {
    account: 'cato.backstop-hq.testnet',
    declared_score: 0,
    joined_at: '100',
    paid_through_epoch: 10,
    payees: [],
  };

  const res = await evaluate({
    claim,
    member,
    deployments: DEPLOYMENTS,
    txInfo: null, // missing transaction
    snapshot: plainPostureSnapshot,
    txBlockTimeNs: '500',
    rpc: {
      txStatus: async () => null,
      blockTimestampNs: async () => '500',
      fetchSnapshot: async () => plainPostureSnapshot,
    },
  });

  assert.equal(res.approve, false);
  const txCheck = res.checks.find((c) => c.name === '1_tx_exists_and_succeeded');
  assert.ok(txCheck);
  assert.equal(txCheck.ok, false);
});

test('a failed transaction is rejected', async () => {
  const claim = {
    id: 4,
    claimant: 'atlas.backstop-hq.testnet',
    loss_tx_hash: 'failedTxHash',
    amount: '200000000000000000000000',
    filed_at: '1000000000',
  };

  const member = {
    account: 'atlas.backstop-hq.testnet',
    declared_score: 100,
    joined_at: '100',
    paid_through_epoch: 10,
    payees: [],
  };

  const res = await evaluate({
    claim,
    member,
    deployments: DEPLOYMENTS,
    txInfo: failedTx,
    snapshot: null,
    txBlockTimeNs: '500',
  });

  assert.equal(res.approve, false);
  const txCheck = res.checks.find((c) => c.name === '1_tx_exists_and_succeeded');
  assert.ok(txCheck);
  assert.equal(txCheck.ok, false);
});

test('a posture lie is rejected', async () => {
  const claim = {
    id: 5,
    claimant: 'dex.backstop-hq.testnet',
    loss_tx_hash: 'plainTxHash',
    amount: '800000000000000000000000',
    filed_at: '1000000000',
  };

  // dex declared 95, but verified score is 0
  const member = {
    account: 'dex.backstop-hq.testnet',
    declared_score: 95,
    joined_at: '100',
    paid_through_epoch: 10,
    payees: [],
  };

  const res = await evaluate({
    claim,
    member,
    deployments: DEPLOYMENTS,
    txInfo: plainTx,
    snapshot: plainPostureSnapshot, // scores 0
    txBlockTimeNs: '500',
    poolConfig: { epoch_ns: '1000', posture_tolerance: 10 },
  });

  assert.equal(res.approve, false);
  const postureCheck = res.checks.find((c) => c.name === '6_posture_within_tolerance');
  assert.ok(postureCheck);
  assert.equal(postureCheck.ok, false);
});
