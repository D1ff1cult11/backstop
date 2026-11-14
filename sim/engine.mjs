import { createRng } from './prng.mjs';
import { premiumPerEpoch, stakeFor, claimBond, drawJury, postureOk, resolve } from './rules.mjs';
import { STRATEGIES, createAgents } from './strategies.mjs';

export function runSim(cfg, seed = 42) {
  const prng = createRng(seed);
  const rngFn = prng.rng;
  const agents = createAgents(STRATEGIES, rngFn);
  let poolBalance = cfg.capital !== undefined ? cfg.capital : 2000;
  const initialPoolCapital = poolBalance;

  for (const agent of agents) {
    const st = stakeFor(agent.cover, cfg);
    agent.balance -= st;
    agent.stake = st;
  }

  const days = [];
  const claims = [];
  let claimSeq = 0;

  for (let day = 1; day <= cfg.days; day++) {
    let [dayPremiums, dayPayouts, daySlashes, dayApproved, dayRejected, dayVoid] = [0, 0, 0, 0, 0, 0];
    const claimsToday = [];

    // 1. Collect premiums
    for (const a of agents) {
      if (a.coverRemaining <= 0) { a.active = false; continue; }
      const prem = premiumPerEpoch(a.cover, a.declaredScore, cfg);
      if (a.balance >= prem) {
        a.balance -= prem;
        a.premiumsPaid += prem;
        poolBalance += prem;
        dayPremiums += prem;
        a.active = true;
      } else {
        a.active = false;
      }
    }

    // 2. Roll incidents & fake claims
    for (const a of agents) {
      if (!a.active) continue;
      const strat = STRATEGIES[a.type];

      if (strat.filesFakeClaims && strat.fakeDays?.includes(day)) {
        claimsToday.push({ id: ++claimSeq, day, claimantId: a.id, amount: strat.fakeAmount, isFake: true });
      } else if (strat.incidentChance > 0 && rngFn() < strat.incidentChance) {
        const actualLoss = Math.min(strat.getLoss(a), a.balance);
        if (actualLoss > 0) {
          a.balance -= actualLoss;
          a.losses += actualLoss;
          claimsToday.push({ id: ++claimSeq, day, claimantId: a.id, amount: Math.min(actualLoss, a.coverRemaining), isFake: false });
        }
      }
    }

    // 3. Process claims
    for (const claim of claimsToday) {
      const claimant = agents.find((ag) => ag.id === claim.claimantId);
      const bond = claimBond(claim.amount, cfg);
      if (claimant.stake < bond) continue;

      claimant.stake -= bond;
      claimant.bondReserved += bond;
      claim.bond = bond;

      const eligible = agents.filter((ag) => ag.id !== claimant.id && ag.active).map((ag) => ag.id);
      if (eligible.length < cfg.jury_size) {
        claimant.stake += bond;
        claimant.bondReserved -= bond;
        continue;
      }

      const jury = drawJury(eligible, cfg.jury_size, rngFn);
      claim.jury = jury;
      const votes = [];

      for (const jId of jury) {
        const juror = agents.find((ag) => ag.id === jId);
        const strat = STRATEGIES[juror.type];
        if (!strat.revealsVote) continue;
        if (strat.alwaysApprove) {
          votes.push({ juror: jId, approve: true });
        } else {
          const lossReal = !claim.isFake;
          const postureValid = postureOk(claimant.declaredScore, claimant.trueScore, cfg.posture_tolerance);
          votes.push({ juror: jId, approve: lossReal && postureValid });
        }
      }

      const outcome = resolve({ votes, juryAll: jury, amount: claim.amount, coverRemaining: claimant.coverRemaining, poolBalance, cfg });
      claim.status = outcome.status;
      claim.payout = outcome.payout;
      claims.push(claim);

      if (outcome.status === 'Approved') {
        dayApproved++;
        claimant.claimsApproved++;
        claimant.stake += bond;
        claimant.bondReserved -= bond;
        claimant.coverRemaining -= outcome.payout;
        claimant.payouts += outcome.payout;
        claimant.balance += outcome.payout;
        poolBalance -= outcome.payout;
        dayPayouts += outcome.payout;

        const rewardTotal = (outcome.payout * cfg.juror_fee_bps) / 10000;
        if (outcome.coherent.length > 0) {
          poolBalance -= rewardTotal;
          const perJuror = rewardTotal / outcome.coherent.length;
          for (const cId of outcome.coherent) {
            const jAgent = agents.find((ag) => ag.id === cId);
            jAgent.stake += perJuror;
            jAgent.jurorRewards += perJuror;
          }
        }
        for (const sId of outcome.slashed) {
          const jAgent = agents.find((ag) => ag.id === sId);
          const slash = (jAgent.stake * cfg.juror_slash_bps) / 10000;
          jAgent.stake -= slash;
          jAgent.slashes += slash;
          poolBalance += slash;
          daySlashes += slash;
        }
      } else if (outcome.status === 'Rejected') {
        dayRejected++;
        claimant.claimsRejected++;
        claimant.bondReserved -= bond;
        claimant.bondsLost += bond;

        const halfBond = bond / 2;
        poolBalance += bond - halfBond;
        if (outcome.coherent.length > 0) {
          const perJuror = halfBond / outcome.coherent.length;
          for (const cId of outcome.coherent) {
            const jAgent = agents.find((ag) => ag.id === cId);
            jAgent.stake += perJuror;
            jAgent.jurorRewards += perJuror;
          }
        } else {
          poolBalance += halfBond;
        }
        for (const sId of outcome.slashed) {
          const jAgent = agents.find((ag) => ag.id === sId);
          const slash = (jAgent.stake * cfg.juror_slash_bps) / 10000;
          jAgent.stake -= slash;
          jAgent.slashes += slash;
          poolBalance += slash;
          daySlashes += slash;
        }
      } else {
        dayVoid++;
        claimant.claimsVoid++;
        claimant.stake += bond;
        claimant.bondReserved -= bond;
        for (const sId of outcome.slashed) {
          const jAgent = agents.find((ag) => ag.id === sId);
          const slash = (jAgent.stake * cfg.juror_slash_bps) / 10000;
          jAgent.stake -= slash;
          jAgent.slashes += slash;
          poolBalance += slash;
          daySlashes += slash;
        }
      }
    }

    // 7. Day snapshot
    const activeCover = agents.filter((a) => a.active).reduce((sum, a) => sum + a.coverRemaining, 0);
    const solvencyBps = Math.floor((poolBalance * 10000) / Math.max(activeCover, 1));

    days.push({
      day,
      pool_balance: poolBalance,
      solvency_bps: solvencyBps,
      premiums: dayPremiums,
      payouts: dayPayouts,
      filed: claimsToday.length,
      approved: dayApproved,
      rejected: dayRejected,
      void: dayVoid,
      slashes: daySlashes,
    });
  }

  for (const a of agents) {
    a.net = a.payouts + a.jurorRewards - a.premiumsPaid - a.losses - a.bondsLost - a.slashes;
    a.uninsured_net = -a.losses;
  }

  const totals = {
    initialPoolCapital,
    finalPoolBalance: poolBalance,
    totalPremiums: days.reduce((sum, d) => sum + d.premiums, 0),
    totalPayouts: days.reduce((sum, d) => sum + d.payouts, 0),
    totalSlashes: days.reduce((sum, d) => sum + d.slashes, 0),
    totalFiled: days.reduce((sum, d) => sum + d.filed, 0),
    totalApproved: days.reduce((sum, d) => sum + d.approved, 0),
    totalRejected: days.reduce((sum, d) => sum + d.rejected, 0),
    totalVoid: days.reduce((sum, d) => sum + d.void, 0),
  };

  return { days, agents, claims, totals };
}
