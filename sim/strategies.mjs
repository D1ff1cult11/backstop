export const STRATEGIES = {
  careful: {
    type: 'careful',
    count: 7,
    minScore: 90,
    maxScore: 100,
    declaredDelta: 0,
    incidentChance: 0.015,
    getLoss: (agent) => Math.min(0.1 * agent.cover, agent.balance),
    filesFakeClaims: false,
    honestJury: true,
    revealsVote: true,
  },
  standard: {
    type: 'standard',
    count: 4,
    minScore: 50,
    maxScore: 70,
    declaredDelta: 0,
    incidentChance: 0.03,
    getLoss: (agent) => Math.min(0.3 * agent.cover, agent.balance),
    filesFakeClaims: false,
    honestJury: true,
    revealsVote: true,
  },
  reckless: {
    type: 'reckless',
    count: 3,
    minScore: 0,
    maxScore: 20,
    declaredDelta: 0,
    incidentChance: 0.06,
    getLoss: (agent) => Math.min(0.6 * agent.cover, agent.balance),
    filesFakeClaims: false,
    honestJury: true,
    revealsVote: true,
  },
  liar: {
    type: 'liar',
    count: 2,
    minScore: 0,
    maxScore: 20,
    forcedDeclared: 90,
    incidentChance: 0.06,
    getLoss: (agent) => Math.min(0.6 * agent.cover, agent.balance),
    filesFakeClaims: false,
    honestJury: true,
    revealsVote: true,
  },
  fraudster: {
    type: 'fraudster',
    count: 2,
    minScore: 60,
    maxScore: 60,
    declaredDelta: 0,
    incidentChance: 0,
    getLoss: () => 0,
    filesFakeClaims: true,
    fakeDays: [5, 15, 25],
    fakeAmount: 50,
    honestJury: false,
    alwaysApprove: true,
    revealsVote: true,
  },
  lazy: {
    type: 'lazy',
    count: 2,
    minScore: 60,
    maxScore: 60,
    declaredDelta: 0,
    incidentChance: 0.03,
    getLoss: (agent) => Math.min(0.3 * agent.cover, agent.balance),
    filesFakeClaims: false,
    honestJury: true,
    revealsVote: false,
  },
};

export function createAgents(strategies = STRATEGIES, rngFn = Math.random) {
  const agents = [];
  let id = 1;

  for (const [key, strat] of Object.entries(strategies)) {
    for (let i = 0; i < strat.count; i++) {
      const scoreSpan = strat.maxScore - strat.minScore;
      const trueScore = Math.round(strat.minScore + (scoreSpan > 0 ? rngFn() * scoreSpan : 0));
      const declaredScore = strat.forcedDeclared !== undefined ? strat.forcedDeclared : trueScore;

      agents.push({
        id: `agent_${String(id++).padStart(2, '0')}`,
        type: key,
        trueScore,
        declaredScore,
        balance: 200,
        cover: 100,
        coverRemaining: 100,
        stake: 0,
        bondReserved: 0,
        active: true,
        premiumsPaid: 0,
        losses: 0,
        payouts: 0,
        bondsLost: 0,
        slashes: 0,
        jurorRewards: 0,
        claimsApproved: 0,
        claimsRejected: 0,
        claimsVoid: 0,
      });
    }
  }

  return agents;
}
