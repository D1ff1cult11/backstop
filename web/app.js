// Backstop web application - Simulation charts and live testnet integration

const STRATEGY_COLORS = {
  careful: '#1f9d55',
  standard: '#2f6df6',
  reckless: '#f59e0b',
  liar: '#d64545',
  fraudster: '#8b5cf6',
  lazy: '#64748b',
};

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

// Initialise dashboard
if (typeof window !== 'undefined') {
  window.addEventListener('DOMContentLoaded', () => {
    loadSimulationData();
  });
}
