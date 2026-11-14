// Backstop web application - Simulation charts and live testnet integration
import { scoreFromSnapshot, fetchSnapshot } from '/agents/posture.mjs';

const STRATEGY_COLORS = {
  careful: '#1f9d55',
  standard: '#2f6df6',
  reckless: '#f59e0b',
  liar: '#d64545',
  fraudster: '#8b5cf6',
  lazy: '#64748b',
};

const RPC_ENDPOINTS = [
  'https://test.rpc.fastnear.com',
  'https://rpc.testnet.near.org',
];

async function browserRpcCall(method, params) {
  let lastErr;
  for (const endpoint of RPC_ENDPOINTS) {
    try {
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 'backstop-web',
          method,
          params,
        }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = await res.json();
      if (json.error) throw new Error(json.error.message || JSON.stringify(json.error));
      return json.result;
    } catch (err) {
      lastErr = err;
    }
  }
  throw lastErr || new Error('All RPC endpoints failed');
}

const browserRpc = {
  async viewCall(contract, method, args = {}) {
    const argsBase64 = btoa(unescape(encodeURIComponent(JSON.stringify(args))));
    const res = await browserRpcCall('query', {
      request_type: 'call_function',
      finality: 'final',
      account_id: contract,
      method_name: method,
      args_base64: argsBase64,
    });
    const bytes = new Uint8Array(res.result);
    return JSON.parse(new TextDecoder().decode(bytes));
  },

  async viewAccount(accountId) {
    return browserRpcCall('query', {
      request_type: 'view_account',
      finality: 'final',
      account_id: accountId,
    });
  },

  async viewKeys(accountId) {
    return browserRpcCall('query', {
      request_type: 'view_access_key_list',
      finality: 'final',
      account_id: accountId,
    });
  },
};

function toNear(yocto) {
  try {
    const val = BigInt(yocto || '0');
    return (Number(val / 10000000000000000000000n) / 100).toFixed(2);
  } catch {
    return '0.00';
  }
}

async function loadSimulationData() {
  const fallback = document.getElementById('sim-fallback');
  try {
    const res = await fetch('data/sim-run.json');
    if (!res.ok) throw new Error('data/sim-run.json not found');
    const data = await res.json();
    if (fallback) fallback.style.display = 'none';
    renderCharts(data);
  } catch (err) {
    console.warn('Simulation data unavailable:', err.message);
    if (fallback) fallback.style.display = 'block';
  }
}

function renderCharts(sim) {
  if (typeof Chart === 'undefined') {
    console.error('Chart.js not loaded');
    return;
  }

  // 1. Solvency over 30 days
  const ctxSolv = document.getElementById('chart-solvency')?.getContext('2d');
  if (ctxSolv) {
    new Chart(ctxSolv, {
      type: 'line',
      data: {
        labels: sim.days.map((d) => `Day ${d.day}`),
        datasets: [
          {
            label: 'Solvency %',
            data: sim.days.map((d) => (d.solvency_bps / 100).toFixed(1)),
            borderColor: '#2f6df6',
            backgroundColor: 'rgba(47, 109, 246, 0.1)',
            fill: true,
            tension: 0.2,
          },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        scales: {
          y: {
            title: { display: true, text: 'Solvency %' },
            beginAtZero: true,
          },
        },
      },
    });
  }

  // 2. Premium vs Posture Score (Scatter)
  const ctxScatter = document.getElementById('chart-scatter')?.getContext('2d');
  if (ctxScatter) {
    const stratGroups = {};
    for (const a of sim.agents) {
      if (!stratGroups[a.type]) stratGroups[a.type] = [];
      const avgPrem = a.premiumsPaid / (sim.days.length || 30);
      stratGroups[a.type].push({ x: a.declaredScore, y: avgPrem });
    }

    const datasets = Object.keys(stratGroups).map((type) => ({
      label: type,
      data: stratGroups[type],
      backgroundColor: STRATEGY_COLORS[type] || '#2f6df6',
      pointRadius: 6,
    }));

    new Chart(ctxScatter, {
      type: 'scatter',
      data: { datasets },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        scales: {
          x: { title: { display: true, text: 'Declared Posture Score' }, min: 0, max: 100 },
          y: { title: { display: true, text: 'Avg Premium / Day' }, beginAtZero: true },
        },
      },
    });
  }

  // 3. Claims Approved and Rejected by Strategy (Stacked Bar)
  const ctxClaims = document.getElementById('chart-claims')?.getContext('2d');
  if (ctxClaims) {
    const stratNames = ['careful', 'standard', 'reckless', 'liar', 'fraudster', 'lazy'];
    const approvedData = [];
    const rejectedData = [];

    for (const name of stratNames) {
      const group = sim.agents.filter((a) => a.type === name);
      approvedData.push(group.reduce((s, a) => s + (a.claimsApproved || 0), 0));
      rejectedData.push(group.reduce((s, a) => s + (a.claimsRejected || 0), 0));
    }

    new Chart(ctxClaims, {
      type: 'bar',
      data: {
        labels: stratNames,
        datasets: [
          { label: 'Approved', data: approvedData, backgroundColor: '#1f9d55' },
          { label: 'Rejected', data: rejectedData, backgroundColor: '#d64545' },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        scales: {
          x: { stacked: true },
          y: { stacked: true, title: { display: true, text: 'Number of Claims' }, beginAtZero: true },
        },
      },
    });
  }

  // 4. Insured vs Uninsured Net Position (Grouped Bar)
  const ctxNet = document.getElementById('chart-net')?.getContext('2d');
  if (ctxNet) {
    const stratNames = ['careful', 'standard', 'reckless', 'liar', 'fraudster', 'lazy'];
    const insuredNet = [];
    const uninsuredNet = [];

    for (const name of stratNames) {
      const group = sim.agents.filter((a) => a.type === name);
      const avgIns = group.length > 0 ? group.reduce((s, a) => s + a.net, 0) / group.length : 0;
      const avgUnins = group.length > 0 ? group.reduce((s, a) => s + a.uninsured_net, 0) / group.length : 0;
      insuredNet.push(parseFloat(avgIns.toFixed(2)));
      uninsuredNet.push(parseFloat(avgUnins.toFixed(2)));
    }

    new Chart(ctxNet, {
      type: 'bar',
      data: {
        labels: stratNames,
        datasets: [
          { label: 'Insured Net', data: insuredNet, backgroundColor: '#2f6df6' },
          { label: 'Uninsured Net', data: uninsuredNet, backgroundColor: '#8a8f98' },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        scales: {
          y: { title: { display: true, text: 'Net Position (Units)' } },
        },
      },
    });
  }
}

async function loadTestnetData() {
  const membersTbody = document.querySelector('#table-members tbody');
  const claimsTbody = document.querySelector('#table-claims tbody');

  let dep = null;
  try {
    const depRes = await fetch('/deployments/testnet.json');
    if (depRes.ok) {
      dep = await depRes.json();
    }
  } catch {}

  const poolContract = dep?.pool || 'pool.backstop-hq.testnet';
  const walletCodeHash = dep?.walletCodeHash || '3xM3YDs44aRso3b3hVo5KVdRKCatqkUMFwnpxBTXtFYW';

  try {
    // 1. Pool stats
    const stats = await browserRpc.viewCall(poolContract, 'get_pool_stats', {});
    const statMembers = document.getElementById('stat-members');
    const statBal = document.getElementById('stat-balance');
    const statClaims = document.getElementById('stat-claims');

    if (statMembers) statMembers.textContent = `${stats.active_members} / ${stats.members}`;
    if (statBal) statBal.textContent = `${toNear(stats.pool_balance)} NEAR`;
    if (statClaims) statClaims.textContent = stats.claims;

    // 2. Members table
    const members = await browserRpc.viewCall(poolContract, 'get_members', { from_index: 0, limit: 20 });
    if (membersTbody) {
      membersTbody.innerHTML = '';
      for (const m of members) {
        const row = document.createElement('tr');
        row.innerHTML = `
          <td><strong>${m.account}</strong></td>
          <td>${m.declared_score}</td>
          <td id="score-${m.account.replace(/\./g, '_')}">
            <button class="verify-btn" data-account="${m.account}">Audit Posture</button>
          </td>
          <td>${((30000 - m.declared_score * 250) / 10000).toFixed(2)}x</td>
          <td>${toNear(m.stake)} NEAR</td>
          <td>${toNear(m.cover_remaining)} NEAR</td>
        `;
        membersTbody.appendChild(row);

        // Pre-fetch live posture in background
        fetchSnapshot(m.account, { walletCodeHash, poolContract }, browserRpc)
          .then((snap) => {
            const el = document.getElementById(`score-${m.account.replace(/\./g, '_')}`);
            if (!el) return;
            const diff = Math.abs(m.declared_score - snap.score);
            const badgeClass = diff <= 10 ? 'status-approved' : 'status-rejected';
            const label = diff <= 10 ? `${snap.score} (Valid)` : `${snap.score} (Liar!)`;
            el.innerHTML = `
              <span class="badge ${badgeClass}" title="${snap.signals.map((s) => `${s.name}: ${s.ok ? '✓' : '✗'} (${s.detail})`).join('\n')}">
                ${label}
              </span>
            `;
          })
          .catch(() => {});
      }
    }

    // 3. Claims table
    const claims = await browserRpc.viewCall(poolContract, 'get_claims', { from_index: 0, limit: 30 });
    if (claimsTbody) {
      claimsTbody.innerHTML = '';
      const recentClaims = claims.slice(-10).reverse();
      for (const c of recentClaims) {
        const row = document.createElement('tr');
        let statusBadge = `<span class="badge status-${(c.status || '').toLowerCase()}">${c.status}</span>`;
        const juryStr = c.jury
          .map((j) => {
            const name = j.juror.split('.')[0];
            const rev = j.revealed === null ? '–' : (j.revealed ? '✓' : '✗');
            return `${name}:${rev}`;
          })
          .join(' ');

        const txLink = dep?.txs?.find((t) => t.label === `loss_tx_${c.claimant.split('.')[0]}_round`)?.hash;
        const txCell = txLink
          ? `<a href="https://testnet.nearblocks.io/txns/${txLink}" target="_blank" rel="noopener">Link</a>`
          : '–';

        row.innerHTML = `
          <td>#${c.id}</td>
          <td>${c.claimant.split('.')[0]}</td>
          <td>${toNear(c.amount)} NEAR</td>
          <td><code>${juryStr}</code></td>
          <td>${statusBadge}</td>
          <td>${toNear(c.payout)} NEAR</td>
          <td>${txCell}</td>
        `;
        claimsTbody.appendChild(row);
      }
    }
  } catch (err) {
    console.warn('Could not load testnet data:', err.message);
    if (membersTbody) {
      membersTbody.innerHTML = `<tr><td colspan="6" class="error-msg">RPC read error: ${err.message}. Ensure internet connection.</td></tr>`;
    }
  }
}

// Initialise dashboard
if (typeof window !== 'undefined') {
  window.addEventListener('DOMContentLoaded', () => {
    loadSimulationData();
    loadTestnetData();
  });
}
