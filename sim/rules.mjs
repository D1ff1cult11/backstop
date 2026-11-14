export function multiplierBps(score) {
  return Math.max(0, 30000 - 250 * score);
}

export function premiumPerEpoch(cover, score, cfg) {
  const mult = multiplierBps(score);
  return (cover * cfg.base_premium_bps * mult) / 10000 / 10000;
}

export function stakeFor(cover, cfg) {
  return (cover * cfg.min_stake_bps) / 10000;
}

export function claimBond(amount, cfg) {
  const pct = (amount * cfg.claim_bond_bps) / 10000;
  return Math.max(pct, cfg.min_claim_bond);
}

export function drawJury(eligible, size, randFn = Math.random) {
  const pool = [...eligible];
  for (let i = pool.length - 1; i > 0; i--) {
    const j = Math.floor(randFn() * (i + 1));
    [pool[i], pool[j]] = [pool[j], pool[i]];
  }
  return pool.slice(0, size);
}

export function postureOk(declared, verified, tol = 10) {
  return declared <= verified + tol;
}

export function resolve({ votes, juryAll, amount, coverRemaining, poolBalance, cfg }) {
  let approvals = 0;
  let rejections = 0;
  const revealedMap = new Map();

  for (const v of votes) {
    revealedMap.set(v.juror, v.approve);
    if (v.approve === true) approvals++;
    else if (v.approve === false) rejections++;
  }

  const revealed = approvals + rejections;
  const quorum = Math.ceil(cfg.jury_size / 2);

  if (revealed < quorum) {
    const slashed = juryAll.filter((j) => !revealedMap.has(j));
    return {
      status: 'Void',
      payout: 0,
      coherent: [],
      slashed,
    };
  }

  if (approvals > rejections) {
    const cap1 = (amount * (10000 - cfg.deductible_bps)) / 10000;
    const cap2 = coverRemaining;
    const cap3 = (poolBalance * cfg.max_payout_bps) / 10000;
    const payout = Math.min(cap1, cap2, cap3);

    const coherent = juryAll.filter((j) => revealedMap.get(j) === true);
    const slashed = juryAll.filter((j) => revealedMap.get(j) !== true);

    return {
      status: 'Approved',
      payout,
      coherent,
      slashed,
    };
  }

  const coherent = juryAll.filter((j) => revealedMap.get(j) === false);
  const slashed = juryAll.filter((j) => revealedMap.get(j) !== false);

  return {
    status: 'Rejected',
    payout: 0,
    coherent,
    slashed,
  };
}
