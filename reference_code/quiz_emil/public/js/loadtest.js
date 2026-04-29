(() => {
  const $ = (id) => document.getElementById(id);
  let pollTimer = null;

  $('startBtn').onclick = async () => {
    const pin = $('pin').value.trim();
    const count = Number($('count').value);
    const spreadMs = Number($('spreadMs').value);
    if (!pin) return showNotice('Indtast host-PIN', 'bad');

    try {
      const res = await fetch('/api/loadtest', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pin, count, spreadMs }),
      });
      const data = await res.json();
      if (!res.ok || !data.ok) {
        return showNotice(data.error || 'Kunne ikke starte loadtest', 'bad');
      }
      sessionStorage.setItem('loadtestPin', pin);
      showNotice(data.message || 'Loadtest startet', 'good');
      startPolling();
    } catch (e) {
      showNotice(e.message || 'Netværksfejl', 'bad');
    }
  };

  function startPolling() {
    if (pollTimer) clearInterval(pollTimer);
    refreshStatus();
    pollTimer = setInterval(refreshStatus, 2000);
  }

  async function refreshStatus() {
    const pin = $('pin').value.trim() || sessionStorage.getItem('loadtestPin');
    if (!pin) return;
    try {
      const res = await fetch(`/api/loadtest/status?pin=${encodeURIComponent(pin)}`);
      const data = await res.json();
      if (!res.ok || !data.ok) return;
      $('stRunning').textContent = data.running ? 'Ja' : 'Nej';
      $('stTarget').textContent = data.target || '—';
      $('stMode').textContent = data.mode || '—';
      $('stTotal').textContent = data.total ?? '—';
      $('stConnected').textContent = data.connected ?? '—';
      $('stIdentified').textContent = data.identified ?? '—';
      $('stSubmitAcks').textContent = data.submitAcks ?? '—';
      $('stErrors').textContent = data.errors ?? '—';
      $('stPhase').textContent = data.latestPhase ?? '—';
      $('stGuestCount').textContent = data.latestGuestCount ?? '—';
      if (!data.running && pollTimer) {
        clearInterval(pollTimer);
        pollTimer = null;
      }
    } catch {}
  }

  function showNotice(msg, kind) {
    const n = $('notice');
    n.textContent = msg;
    n.className = 'notice ' + (kind || '');
    n.style.display = '';
    clearTimeout(showNotice._t);
    showNotice._t = setTimeout(() => { n.style.display = 'none'; }, 4000);
  }

  const savedPin = sessionStorage.getItem('loadtestPin');
  if (savedPin) {
    $('pin').value = savedPin;
    startPolling();
  }
})();
