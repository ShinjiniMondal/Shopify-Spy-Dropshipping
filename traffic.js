// traffic.js

function hashCode(str) {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash;
  }
  return Math.abs(hash);
}

function generateTrafficData(domain) {
  let seed = hashCode(domain);
  const random = () => {
    let x = Math.sin(seed++) * 10000;
    return x - Math.floor(x);
  };
  
  // Base visits between 50k and 2M
  const baseVisits = 50000 + random() * 1950000;
  
  // 6 months trend
  const trend = [];
  let current = baseVisits;
  for(let i=0; i<6; i++) {
    // -15% to +20% change
    const change = 0.85 + random() * 0.35;
    current = current * change;
    trend.push(Math.round(current));
  }
  
  const lastMonth = trend[5];
  const prevMonth = trend[4];
  const percentChange = (((lastMonth - prevMonth) / prevMonth) * 100).toFixed(2);
  
  const avgVisits = Math.round(trend.reduce((a,b) => a+b, 0) / 6);
  
  const durationSec = 60 + random() * 180;
  const mins = Math.floor(durationSec / 60);
  const secs = Math.floor(durationSec % 60).toString().padStart(2, '0');
  
  const bounceRate = (30 + random() * 40).toFixed(2);
  const pagesPerVisit = (1.5 + random() * 4).toFixed(2);
  
  const s1 = random() * 40 + 10;
  const s2 = random() * 30 + 5;
  const s3 = random() * 20 + 5;
  const s4 = random() * 10 + 2;
  const s5 = random() * 5 + 1;
  const s6 = random() * 5 + 1;
  const totalS = s1+s2+s3+s4+s5+s6;
  const sources = [
    { label: 'Search', value: Math.round((s1/totalS)*100) },
    { label: 'Direct', value: Math.round((s2/totalS)*100) },
    { label: 'Social', value: Math.round((s3/totalS)*100) },
    { label: 'Referrals', value: Math.round((s4/totalS)*100) },
    { label: 'Paid', value: Math.round((s5/totalS)*100) },
    { label: 'Mail', value: Math.round((s6/totalS)*100) }
  ].sort((a,b) => b.value - a.value);

  const soc1 = random() * 50 + 20;
  const soc2 = random() * 30 + 10;
  const soc3 = random() * 20 + 5;
  const soc4 = random() * 10 + 2;
  const soc5 = random() * 5 + 1;
  const totalSoc = soc1+soc2+soc3+soc4+soc5;
  const social = [
    { label: 'Facebook', value: Math.round((soc1/totalSoc)*100), color: '#1877F2' },
    { label: 'Instagram', value: Math.round((soc2/totalSoc)*100), color: '#E4405F' },
    { label: 'TikTok', value: Math.round((soc3/totalSoc)*100), color: '#000000' },
    { label: 'YouTube', value: Math.round((soc4/totalSoc)*100), color: '#FF0000' },
    { label: 'Reddit', value: Math.round((soc5/totalSoc)*100), color: '#FF4500' }
  ].sort((a,b) => b.value - a.value);

  const geo = [
    { country: 'United States', flag: '🇺🇸', percent: Math.round(random()*30 + 40) },
    { country: 'United Kingdom', flag: '🇬🇧', percent: Math.round(random()*10 + 5) },
    { country: 'Canada', flag: '🇨🇦', percent: Math.round(random()*8 + 2) },
    { country: 'Australia', flag: '🇦🇺', percent: Math.round(random()*5 + 1) }
  ];

  return { trend, percentChange, avgVisits, duration: `${mins}m ${secs}s`, bounceRate, pagesPerVisit, sources, social, geo };
}

function renderLineChart(containerId, dataArr, opts) {
  const container = document.getElementById(containerId);
  if (!container) return;

  // Build labelled data from raw trend array
  const months = ['Nov 25','Dec 25','Jan 26','Feb 26','Mar 26','Apr 26'];
  const labelledData = dataArr.map((v, i) => ({ label: months[i] || `M${i+1}`, value: v }));
  _renderStyledChart(container, labelledData, opts);
}

function _renderStyledChart(container, data, opts = {}) {
  opts = Object.assign({ showLabels: true, height: 100 }, opts);

  // Clear & create canvas
  container.innerHTML = '';
  const canvas = document.createElement('canvas');
  container.style.position = 'relative';
  container.appendChild(canvas);

  // Tooltip element
  const tip = document.createElement('div');
  tip.style.cssText = 'position:absolute;pointer-events:none;background:#C0446B;color:#fff;font-size:11px;font-weight:600;padding:5px 10px;border-radius:8px;box-shadow:0 3px 10px rgba(0,0,0,0.18);white-space:nowrap;opacity:0;transition:opacity 0.15s;z-index:99;';
  container.appendChild(tip);

  function draw() {
    const W = container.offsetWidth || 340;
    const H = opts.height;
    canvas.width = W;
    canvas.height = H;
    canvas.style.width = '100%';
    canvas.style.height = H + 'px';
    canvas.style.display = 'block';

    const ctx = canvas.getContext('2d');
    const showLabels = opts.showLabels;
    const padL = showLabels ? 36 : 6;
    const padR = 6;
    const padT = showLabels ? 14 : 8;
    const padB = showLabels ? 32 : 8;
    const chartW = W - padL - padR;
    const chartH = H - padT - padB;
    const maxVal = Math.max(...data.map(d => d.value)) * 1.15;
    const minVal = 0;

    const xOf = i => padL + (i / (data.length - 1)) * chartW;
    const yOf = v => padT + chartH - ((v - minVal) / (maxVal - minVal)) * chartH;

    ctx.clearRect(0, 0, W, H);

    // Grid lines + y labels
    const yTicks = showLabels ? 4 : 3;
    ctx.font = '9px Inter, Arial, sans-serif';
    ctx.fillStyle = '#aaa';
    for (let i = 0; i <= yTicks; i++) {
      const v = (maxVal / yTicks) * i;
      const y = yOf(v);
      ctx.save();
      ctx.setLineDash([3, 4]);
      ctx.strokeStyle = '#e8e8e8';
      ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(padL, y); ctx.lineTo(W - padR, y); ctx.stroke();
      ctx.restore();
      if (showLabels) {
        ctx.textAlign = 'right';
        ctx.fillText(v >= 1000 ? (v/1000).toFixed(0)+'K' : Math.round(v), padL - 4, y + 3.5);
      }
    }

    // Gradient fill
    const grad = ctx.createLinearGradient(0, padT, 0, padT + chartH);
    grad.addColorStop(0, 'rgba(59,130,246,0.25)');
    grad.addColorStop(1, 'rgba(59,130,246,0.02)');
    ctx.beginPath();
    ctx.moveTo(xOf(0), yOf(data[0].value));
    for (let i = 1; i < data.length; i++) {
      const cpx = (xOf(i-1) + xOf(i)) / 2;
      ctx.bezierCurveTo(cpx, yOf(data[i-1].value), cpx, yOf(data[i].value), xOf(i), yOf(data[i].value));
    }
    ctx.lineTo(xOf(data.length-1), padT+chartH);
    ctx.lineTo(xOf(0), padT+chartH);
    ctx.closePath();
    ctx.fillStyle = grad;
    ctx.fill();

    // Line
    ctx.beginPath();
    ctx.moveTo(xOf(0), yOf(data[0].value));
    for (let i = 1; i < data.length; i++) {
      const cpx = (xOf(i-1) + xOf(i)) / 2;
      ctx.bezierCurveTo(cpx, yOf(data[i-1].value), cpx, yOf(data[i].value), xOf(i), yOf(data[i].value));
    }
    ctx.strokeStyle = '#3B82F6';
    ctx.lineWidth = 2.5;
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    ctx.stroke();

    // Dots
    data.forEach((d, i) => {
      const x = xOf(i), y = yOf(d.value);
      ctx.beginPath(); ctx.arc(x, y, 5, 0, Math.PI*2);
      ctx.fillStyle = 'rgba(59,130,246,0.18)'; ctx.fill();
      ctx.beginPath(); ctx.arc(x, y, 3, 0, Math.PI*2);
      ctx.fillStyle = '#3B82F6'; ctx.fill();
      ctx.strokeStyle = '#fff'; ctx.lineWidth = 1.5; ctx.stroke();
    });

    // X labels
    if (showLabels) {
      ctx.fillStyle = '#888';
      ctx.font = '9px Inter, Arial, sans-serif';
      ctx.textAlign = 'center';
      data.forEach((d, i) => ctx.fillText(d.label, xOf(i), H - 8));
    }

    // Store layout info for hover
    canvas._chartMeta = { xOf, yOf, data, padT, chartH };
  }

  draw();
  window.addEventListener('resize', draw, { passive: true });

  // Hover tooltip
  canvas.addEventListener('mousemove', e => {
    const meta = canvas._chartMeta;
    if (!meta) return;
    const rect = canvas.getBoundingClientRect();
    const mx = (e.clientX - rect.left) * (canvas.width / rect.width);
    let closest = null, minDist = Infinity;
    meta.data.forEach((d, i) => {
      const dx = mx - meta.xOf(i);
      if (Math.abs(dx) < minDist) { minDist = Math.abs(dx); closest = { d, i }; }
    });
    if (closest) {
      const cx = meta.xOf(closest.i);
      const cy = meta.yOf(closest.d.value);
      const scaleX = rect.width / canvas.width;
      const scaleY = rect.height / canvas.height;
      const tipX = cx * scaleX;
      const tipY = cy * scaleY;
      const label = closest.d.value >= 1000 ? (closest.d.value/1000).toFixed(2)+'K' : closest.d.value;
      tip.innerHTML = `<div style="font-size:10px;opacity:0.85;">${closest.d.label}</div><div style="font-size:13px;">${label}</div>`;
      tip.style.opacity = '1';
      tip.style.left = Math.max(0, tipX - tip.offsetWidth/2) + 'px';
      tip.style.top = Math.max(0, tipY - tip.offsetHeight - 10) + 'px';
    }
  });
  canvas.addEventListener('mouseleave', () => { tip.style.opacity = '0'; });
}

function renderBarChart(containerId, data) {
  const container = document.getElementById(containerId);
  if (!container) return;
  
  container.innerHTML = data.map(item => `
    <div class="bar-row">
      <div class="bar-label">${item.label}</div>
      <div class="bar-track">
        <div class="bar-fill" style="width: ${item.value}%; background: var(--primary);"></div>
      </div>
      <div class="bar-value">${item.value}%</div>
    </div>
  `).join('');
}

function renderDonutChart(containerId, data) {
  const container = document.getElementById(containerId);
  if (!container) return;
  
  let currentAngle = 0;
  const cx = 50, cy = 50, r = 40;
  let paths = '';
  
  const total = data.reduce((sum, d) => sum + d.value, 0);
  
  data.forEach(item => {
    const fraction = item.value / total;
    const angle = fraction * 360;
    
    const startAngle = currentAngle * Math.PI / 180;
    const endAngle = (currentAngle + angle) * Math.PI / 180;
    
    const x1 = cx + r * Math.sin(startAngle);
    const y1 = cy - r * Math.cos(startAngle);
    const x2 = cx + r * Math.sin(endAngle);
    const y2 = cy - r * Math.cos(endAngle);
    
    const largeArc = angle > 180 ? 1 : 0;
    
    paths += `<path d="M ${cx} ${cy} L ${x1} ${y1} A ${r} ${r} 0 ${largeArc} 1 ${x2} ${y2} Z" fill="${item.color}">
                <title>${item.label}: ${item.value}%</title>
              </path>`;
    
    currentAngle += angle;
  });
  
  paths += `<circle cx="50" cy="50" r="22" fill="var(--card-bg)"/>`;
  
  const legend = data.map(item => `
    <div class="legend-item">
      <span class="legend-dot" style="background: ${item.color}"></span>
      <span class="legend-label">${item.label} (${item.value}%)</span>
    </div>
  `).join('');

  container.innerHTML = `
    <div class="donut-wrapper">
      <svg viewBox="0 0 100 100" class="donut-svg">${paths}</svg>
      <div class="donut-legend">${legend}</div>
    </div>
  `;
}

window.TrafficUtils = {
  generateTrafficData,
  renderLineChart,
  renderBarChart,
  renderDonutChart
};
window._renderStyledChart = _renderStyledChart;
