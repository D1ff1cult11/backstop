// Backstop web application - Simulation charts and live testnet integration
import { fetchSnapshot } from '../agents/posture.mjs';

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

const TX_URL = 'https://testnet.nearblocks.io/txns/';
const ACCT_URL = 'https://testnet.nearblocks.io/address/';
const ESCAPES = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ESCAPES[c]);
const shortName = (a) => a.split('.')[0];
const multiplier = (score) => (30000 - score * 250) / 10000;

function signalList(signals) {
  const items = signals.map(
    (s) => `<li class="${s.ok ? 'ok' : 'no'}">${s.ok ? '✓' : '✗'} <strong>${s.ok ? s.points : 0}/${s.points}</strong> ${esc(s.name)}</li>`
  );
  return `<ul class="signals">${items.join('')}</ul>`;
}

async function loadSweep() {
  const box = document.getElementById('sweep-stats');
  if (!box) return;
  try {
    const sw = await (await fetch('data/sweep.json')).json();
    const tile = (label, value) =>
      `<div class="stat-card"><span class="stat-label">${label} <span class="badge sim">[SIM]</span></span><span class="stat-value">${value}</span></div>`;
    box.innerHTML =
      tile(`Fraud claims approved, ${sw.seeds} seeds`, `${sw.fraud.approved} / ${sw.fraud.filed}`) +
      tile('Posture-lie claims approved', `${sw.postureLie.approved} / ${sw.postureLie.filed}`) +
      tile('Honest claims paid', `${sw.honest.approved} / ${sw.honest.filed}`) +
      tile('Lowest solvency, any day', `${(sw.minSolvencyBps / 100).toFixed(1)}%`);
  } catch {
    box.innerHTML = '<p class="fallback-msg">Run <code>npm run sweep</code> to generate the stress-test data.</p>';
  }
}

async function loadBytecode(dep) {
  const el = document.getElementById('bytecode');
  if (!el) return;
  const rows = [];
  const check = async (account, expected, name) => {
    const acct = await browserRpc.viewAccount(account);
    const ok = acct.code_hash === expected;
    rows.push(
      `<li class="${ok ? 'ok' : 'no'}">${ok ? '✓' : '✗'} <a href="${ACCT_URL}${account}" target="_blank" rel="noopener">${account}</a> runs this repo's <code>wasm/${name}.wasm</code> <span class="muted">(${esc(acct.code_hash)})</span></li>`
    );
  };
  try {
    await check(dep.pool, dep.poolCodeHash, 'pool');
    for (const a of dep.agents.filter((x) => x.wallet)) await check(a.account, dep.walletCodeHash, 'wallet');
    const keys = (await browserRpc.viewKeys(dep.pool)).keys || [];
    rows.push(
      keys.length === 0
        ? `<li class="ok">✓ ${dep.pool} has <strong>0 access keys</strong>: nobody can upgrade it or move its funds.</li>`
        : `<li class="muted">The pool account still has ${keys.length} access key(s): the deployer can upgrade it.</li>`
    );
    el.innerHTML = `<ul class="signals">${rows.join('')}</ul>`;
  } catch (err) {
    el.innerHTML = `<p class="error-msg">Could not read code hashes: ${esc(err.message)}</p>`;
  }
}

function renderRounds(dep, claims) {
  const box = document.getElementById('rounds');
  if (!box) return;
  const byId = new Map(claims.map((c) => [c.id, c]));
  const vote = (j) => (j.revealed === true ? 'approve' : j.revealed === false ? 'reject' : j.commitment ? 'no reveal' : 'no commit');
  const head = '<thead><tr><th>Claim</th><th>Claimant</th><th>Loss (NEAR)</th><th>Status</th><th>Payout (NEAR)</th><th>Jury</th><th>Evidence</th></tr></thead>';
  const sections = [...dep.rounds].reverse().map((r) => {
    const rows = r.claims
      .map((id) => byId.get(id))
      .filter(Boolean)
      .map(
        (c) => `<tr><td>#${c.id}</td><td>${shortName(c.claimant)}</td><td>${toNear(c.amount)}</td>
          <td><span class="badge status-${c.status.toLowerCase()}">${c.status}</span></td><td>${toNear(c.payout)}</td>
          <td>${c.jury.map((j) => `${shortName(j.juror)}: ${vote(j)}`).join(' · ')}</td>
          <td><a href="${TX_URL}${esc(c.loss_tx_hash)}" target="_blank" rel="noopener">loss tx</a></td></tr>`
      );
    const badge = r.outcome === 'Resolved' ? 'approved' : r.outcome.toLowerCase();
    return `<h3>Round ${r.round} <span class="badge status-${badge}">${r.outcome}</span></h3>
      <p class="round-note">${esc(r.note)}</p>
      <div class="table-wrap"><table>${head}<tbody>${rows.join('')}</tbody></table></div>`;
  });
  box.innerHTML = sections.join('') + dep.notes.map((n) => `<p class="round-note">Note: ${esc(n)}</p>`).join('');
}

function renderMembers(dep, members) {
  const tbody = document.querySelector('#table-members tbody');
  if (!tbody) return;
  tbody.innerHTML = '';
  for (const m of members) {
    const row = document.createElement('tr');
    row.innerHTML = `<td><a href="${ACCT_URL}${m.account}" target="_blank" rel="noopener">${m.account}</a></td>
      <td>${m.declared_score}</td><td class="verified">checking…</td>
      <td>${multiplier(m.declared_score).toFixed(2)}x</td><td>${toNear(m.stake)}</td><td>${toNear(m.cover_remaining)}</td>`;
    tbody.appendChild(row);
    const cell = row.querySelector('.verified');
    fetchSnapshot(m.account, { walletCodeHash: dep.walletCodeHash, poolContract: dep.pool }, browserRpc)
      .then((snap) => {
        const ok = m.declared_score <= snap.score + 10;
        const badge = `<span class="badge ${ok ? 'status-approved' : 'status-rejected'}">${snap.score} ${ok ? 'matches' : 'does not match'}</span>`;
        cell.innerHTML = `<details><summary>${badge}</summary>${signalList(snap.signals)}</details>`;
      })
      .catch((err) => {
        cell.textContent = `error: ${err.message}`;
      });
  }
}

async function scoreAnyAccount(dep) {
  const input = document.getElementById('score-input');
  const out = document.getElementById('score-result');
  const account = input.value.trim().toLowerCase();
  if (!/^[a-z0-9._-]{2,64}$/.test(account)) {
    out.innerHTML = '<p class="error-msg">Enter a NEAR testnet account ID, for example atlas.backstop-hq.testnet</p>';
    return;
  }
  out.innerHTML = '<p class="muted">Reading keys and code from testnet…</p>';
  try {
    const snap = await fetchSnapshot(account, { walletCodeHash: dep.walletCodeHash, poolContract: dep.pool }, browserRpc);
    const base = 0.01; // base_premium_bps 100 on 1 NEAR of cover
    const quote = base * multiplier(snap.score);
    out.innerHTML = `<div class="score-card">
      <div class="score-big">${snap.score}<span>/100</span></div>
      <div><p><strong>${esc(account)}</strong> <span class="badge testnet">[TESTNET]</span></p>
      <p>Premium for 1 NEAR of cover: <strong>${quote.toFixed(4)} NEAR per epoch</strong> (${multiplier(snap.score).toFixed(2)}x).
      A plain account with a full-access key pays ${(base * 3).toFixed(4)}.</p>
      ${signalList(snap.signals)}</div></div>`;
  } catch (err) {
    out.innerHTML = `<p class="error-msg">Could not read ${esc(account)}: ${esc(err.message)}</p>`;
  }
}

async function loadTestnetData() {
  const membersTbody = document.querySelector('#table-members tbody');
  let dep;
  try {
    dep = await (await fetch('../deployments/testnet.json')).json();
  } catch {
    if (membersTbody) membersTbody.innerHTML = '<tr><td colspan="6" class="error-msg">deployments/testnet.json not found.</td></tr>';
    return;
  }

  document.getElementById('score-btn')?.addEventListener('click', () => scoreAnyAccount(dep));
  document.getElementById('score-input')?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') scoreAnyAccount(dep);
  });

  scoreAnyAccount(dep); // show the pre-filled example on load

  const refresh = async () => {
    try {
      const stats = await browserRpc.viewCall(dep.pool, 'get_pool_stats', {});
      document.getElementById('stat-members').textContent = `${stats.active_members} / ${stats.members}`;
      document.getElementById('stat-balance').textContent = `${toNear(stats.pool_balance)} NEAR`;
      document.getElementById('stat-claims').textContent = stats.claims;
      const [members, claims] = await Promise.all([
        browserRpc.viewCall(dep.pool, 'get_members', { from_index: 0, limit: 50 }),
        browserRpc.viewCall(dep.pool, 'get_claims', { from_index: 0, limit: 100 }),
      ]);
      renderMembers(dep, members);
      renderRounds(dep, claims);
      loadBytecode(dep);
    } catch (err) {
      // Offline or RPC down: fall back to the recorded snapshot, clearly labelled.
      if (membersTbody) {
        membersTbody.innerHTML = `<tr><td colspan="6" class="error-msg">Testnet RPC unreachable (${esc(err.message)}). The rounds below come from the recorded snapshot.</td></tr>`;
      }
      const recorded = dep.recordedClaims.map((c) => ({
        ...c,
        jury: c.jury.map((j) => ({ ...j, commitment: j.committed ? 'recorded' : null })),
      }));
      renderRounds(dep, recorded);
      const label = document.getElementById('rounds-label');
      if (label) label.textContent = `[TESTNET-RECORDED ${dep.recordedAt}]`;
    }
  };
  document.getElementById('btn-recompute')?.addEventListener('click', refresh);
  refresh();
}

if (typeof window !== 'undefined') {
  window.addEventListener('DOMContentLoaded', () => {
    loadSimulationData();
    loadSweep();
    loadTestnetData();
  });
}
