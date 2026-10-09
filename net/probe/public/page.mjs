import { runProbe } from './runner.mjs';
const el = id => document.getElementById(id);
el('endpoint').value = location.origin;
let abort, report, control = {};
const active = value => { el('inputs').disabled = value; el('start').disabled = value; for (const id of ['stop', 'reconnect', 'restore']) el(id).disabled = !value; };
el('form').onsubmit = async e => {
  e.preventDefault(); abort = new AbortController(); report = null; el('download').disabled = true; active(true);
  try {
    if (new URL(el('endpoint').value).origin !== location.origin) throw Error('请在对应节点的测试页面运行；当前页面仅测同源服务');
    report = await runProbe({ baseURL: el('endpoint').value, token: el('token').value,
      durationSeconds: Number(el('duration').value), payloadBytes: Number(el('payload').value), signal: abort.signal, control,
      metadata: { region: el('region').value, carrier: el('carrier').value, network: el('network').value,
        vpn: el('vpn').value, userAgent: navigator.userAgent, timezone: Intl.DateTimeFormat().resolvedOptions().timeZone },
      onProgress: s => { el('status').textContent = JSON.stringify(s, null, 2); } });
    el('status').textContent = `测试结束；请下载结果。\n${JSON.stringify(report.summary, null, 2)}`; el('download').disabled = false;
  } catch (e) { el('status').textContent = `测试未完成：${e.message}`; }
  finally { active(false); el('token').value = ''; }
};
el('stop').onclick = () => abort?.abort();
el('reconnect').onclick = () => control.reconnect?.();
el('restore').onclick = () => control.mark?.('network_restored_by_tester');
document.addEventListener('visibilitychange', () => control.mark?.(`visibility_${document.visibilityState}`));
for (const name of ['offline', 'online']) window.addEventListener(name, () => control.mark?.(`browser_${name}`));
el('download').onclick = () => {
  const url = URL.createObjectURL(new Blob([JSON.stringify(report, null, 2)], { type: 'application/json' }));
  const a = document.createElement('a'); a.href = url; a.download = `NET-001-${report.session}.json`; a.click(); URL.revokeObjectURL(url);
};
