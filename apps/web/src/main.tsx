import React from 'react';
import { createRoot } from 'react-dom/client';
import './style.css';

const API = 'http://127.0.0.1:8787';

type FilePayload = { name: string; data: string };

async function encodeFile(file: File): Promise<FilePayload> {
  const bytes = new Uint8Array(await file.arrayBuffer());
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return { name: file.name, data: btoa(binary) };
}

function password(): string {
  const bytes = new Uint8Array(18);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('');
}

function download(data: string, name: string, type: string): void {
  const link = document.createElement('a');
  link.href = URL.createObjectURL(new Blob([Uint8Array.from(atob(data), char => char.charCodeAt(0))], { type }));
  link.download = name;
  link.click();
  URL.revokeObjectURL(link.href);
}

function App() {
  const [main, setMain] = React.useState<FilePayload>();
  const [decoy, setDecoy] = React.useState<FilePayload>();
  const [mainPassword, setMainPassword] = React.useState(password);
  const [decoyPassword, setDecoyPassword] = React.useState(password);
  const [container, setContainer] = React.useState('');
  const [recoverPassword, setRecoverPassword] = React.useState('');
  const [recoveredName, setRecoveredName] = React.useState('recovered-file');
  const [status, setStatus] = React.useState('');

  async function encrypt(event: React.FormEvent) {
    event.preventDefault();
    if (!main || !decoy) return setStatus('Choose both files first.');
    setStatus('Encrypting locally...');
    try {
      const response = await fetch(`${API}/api/container/encrypt`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ main, decoy, mainPassword, decoyPassword, containerSize: 64 * 1024 * 1024, slotSize: 1024 * 1024 }) });
      const result = await response.json() as { container?: string; error?: string };
      if (!response.ok || !result.container) throw new Error(result.error ?? 'Encryption failed.');
      setContainer(result.container);
      download(result.container, 'vault.pd', 'application/octet-stream');
      setStatus('Encrypted. Store the generated passwords separately.');
    } catch (error) { setStatus(error instanceof Error ? error.message : 'Encryption failed.'); }
  }

  async function recover(event: React.FormEvent) {
    event.preventDefault();
    if (!container || !recoverPassword) return setStatus('Load a .pd file and enter its password.');
    setStatus('Recovering locally...');
    try {
      const response = await fetch(`${API}/api/container/recover`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ container, password: recoverPassword }) });
      const result = await response.json() as { data?: string; filename?: string; error?: string };
      if (!response.ok || !result.data) throw new Error('Unable to recover payload.');
      download(result.data, result.filename || recoveredName || 'recovered-file', 'application/octet-stream');
      setStatus('Payload recovered.');
    } catch (error) { setStatus(error instanceof Error ? error.message : 'Unable to recover payload.'); }
  }

  async function loadContainer(file: File) {
    const payload = await encodeFile(file);
    setContainer(payload.data);
    setRecoveredName(file.name.replace(/\.pd$/i, '') || 'recovered-file');
    setStatus('Container loaded.');
  }

  return <main>
    <p className="eyebrow">LOCAL / EXPERIMENTAL</p>
    <h1>Plausible<br /><em>Deniability</em></h1>
    <p className="lede">Put two independently recoverable files behind two generated passwords.</p>
    <div className="grid">
      <form onSubmit={encrypt}><h2>01 / Encrypt</h2><FileInput label="Main file" onChange={file => file && encodeFile(file).then(setMain)} /><FileInput label="Decoy file" onChange={file => file && encodeFile(file).then(setDecoy)} /><PasswordRow label="Main password" value={mainPassword} onChange={setMainPassword} regenerate={() => setMainPassword(password())} /><PasswordRow label="Decoy password" value={decoyPassword} onChange={setDecoyPassword} regenerate={() => setDecoyPassword(password())} /><button type="submit">Create vault.pd</button></form>
      <form onSubmit={recover}><h2>02 / Recover</h2><FileInput label="Existing .pd" onChange={file => file && loadContainer(file)} /><label>Password<input type="password" value={recoverPassword} onChange={event => setRecoverPassword(event.target.value)} placeholder="Paste a generated password" /></label><label>Output name<input value={recoveredName} onChange={event => setRecoveredName(event.target.value)} /></label><button type="submit">Recover file</button></form>
    </div>
    {status && <p className="status">{status}</p>}
    <small>Passwords stay in this browser session and are never stored by the API. Recovery failures remain generic.</small>
  </main>;
}

function FileInput({ label, onChange }: { label: string; onChange: (file?: File) => void }) { return <label>{label}<input type="file" onChange={event => onChange(event.target.files?.[0])} /></label>; }
function PasswordRow({ label, value, onChange, regenerate }: { label: string; value: string; onChange: (value: string) => void; regenerate: () => void }) { return <label>{label}<span className="password-row"><input value={value} onChange={event => onChange(event.target.value)} /><button type="button" className="quiet" onClick={regenerate} title="Generate another password">↻</button></span></label>; }

createRoot(document.getElementById('root')!).render(<React.StrictMode><App /></React.StrictMode>);
