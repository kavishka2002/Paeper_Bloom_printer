import {useEffect, useState, type ReactNode} from 'react';
import {useQuery,useQueryClient} from '@tanstack/react-query';
import {Button, Panel} from './context';
import {supportPhone} from '../../packages/shared/support';
import type {Snapshot} from '../../packages/shared/contracts';
import type {LicenseStatus} from '../../packages/licensing/license';
import './license.css';

declare global {
  interface Window {
    startupReady?: () => Promise<void>;
    offlineLicense: {
      paste: () => Promise<string>;
      support: () => Promise<void>;
      status: () => Promise<LicenseStatus>;
      copy: () => Promise<void>;
      buy: (shopName:string) => Promise<void>;
      activate: (code: string) => Promise<LicenseStatus>;
      importFile: () => Promise<LicenseStatus | null>;
    };
  }
}

const details: Record<LicenseStatus['reason'], string> = {
  trial: '48-hour trial',
  licensed: 'Licensed',
  missing: 'Your trial has ended. Activate BloomConnect to continue.',
  'not-started': 'This license is not active yet.',
  expired: 'License expired.',
  'wrong-device': 'This license belongs to a different device.',
  'wrong-product': 'This license is for a different product.',
  clock: 'The system time moved backward. Correct the Windows date and time, then try again.',
  storage: 'The Windows protected license store could not be opened or saved.',
  invalid: 'Invalid license key.',
  'invalid-signature': 'Invalid digital signature. Ask the issuer for a fresh copy of your license.',
  'website-key-missing': 'This build has no website verification key. Contact support for an updated build.',
};

function timeLeft(status: LicenseStatus) {
  const minutes = Math.floor((status.remainingMs ?? 0) / 60_000);
  if (minutes === 0) return 'Less than 1m left';
  const hours = Math.floor(minutes / 60);
  if (status.reason === 'trial' || hours < 24) return hours ? hours + 'h ' + (minutes % 60) + 'm left' : minutes + 'm left';
  return Math.floor(hours / 24) + 'd ' + (hours % 24) + 'h left';
}

const expiryFormat = new Intl.DateTimeFormat('en-LK', {
  dateStyle: 'medium', timeStyle: 'short', timeZone: 'Asia/Colombo',
});

export function LicensedWorkspace({children}: {children: ReactNode}) {
  const query = useQuery({queryKey: ['offline-license'], queryFn: () => window.offlineLicense.status(), refetchInterval: 1000, retry: false});
  const license = query.data;
  const workspace = useQueryClient().getQueryData<Snapshot>(['data']);
  const [shopName, setShopName] = useState<string>();
  const purchaseShop = shopName ?? workspace?.settings?.shop ?? '';
  const [show, setShow] = useState(false);
  const [code, setCode] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
  const [openingWhatsApp, setOpeningWhatsApp] = useState(false);
  const [enteringLicense, setEnteringLicense] = useState(false);

  useEffect(() => {
    if ((license && !license.allowed) || query.isError) void window.startupReady?.().catch(() => {});
  }, [license, query.isError]);

  async function activate(importFile: boolean) {
    setBusy(true);
    setNotice('');
    try {
      const result = await (importFile ? window.offlineLicense.importFile() : window.offlineLicense.activate(code));
      if (result) {
        if (result.allowed) {setCode('');setShow(true)}
        setNotice(result.allowed ? 'License activated successfully.' : details[result.reason]);
        if (result.allowed) setEnteringLicense(false);
        await query.refetch();
      }
    } catch (error) { setNotice(error instanceof Error ? error.message : 'Activation failed.'); }
    finally { setBusy(false); }
  }

  async function openWhatsApp(purchase: boolean) {
    setOpeningWhatsApp(true);
    setNotice('');
    try {
      await (purchase ? window.offlineLicense.buy(purchaseShop) : window.offlineLicense.support());
      setNotice(purchase ? 'Review the message in WhatsApp and press Send.' : 'Support opened in WhatsApp.');
    } catch (error) {
      setNotice(error instanceof Error ? error.message.replace(/^Error invoking remote method 'bloom:license':\s*(?:Error:\s*)?/, '') : 'Could not open WhatsApp.');
    } finally { setOpeningWhatsApp(false); }
  }

  async function paste() {
    try {
      const text = await window.offlineLicense.paste();
      if (text) setCode(text);
      setNotice(text ? 'License pasted.' : 'Copy a license key first.');
    } catch { setNotice('Could not paste the license. Paste a key of up to 8,192 characters.'); }
  }

  if (!license || query.isError) return <div className="setup"><Panel><h1>BloomConnect</h1>
    {query.isError ? <><p role="alert">The licensing service is unavailable.</p><Button onClick={() => void query.refetch()}>Retry</Button></> : <p role="status">Checking license…</p>}
  </Panel></div>;

  const active = license.reason === 'licensed';
  const showForm = (!active && license.reason !== 'expired') || enteringLicense;
  if (license.allowed && !show) return <><button type="button" className="license-status-button" aria-label={active ? 'View License' : 'View trial and activation'} onClick={() => {setNotice('');setEnteringLicense(false);setShow(true)}}>
    {license.reason === 'trial' ? 'Trial' : 'License'} · {timeLeft(license)}
  </button>{children}</>;

  return <div className="setup"><Panel className="license-panel">
    <div className="license-heading">
      <h1>{active ? 'BloomConnect License' : 'BloomConnect License Activation'}</h1>
      <p className="license-state" data-active={license.allowed}>{active ? 'License Active' : details[license.reason]}</p>
    </div>
    <dl className="license-facts">
      <div><dt>Product</dt><dd>BloomConnect</dd></div>
      {license.customerName && <div><dt>Customer</dt><dd>{license.customerName}</dd></div>}
      {(active || license.activatedAt !== undefined) && <div><dt>Activation date</dt><dd>{license.activatedAt === undefined ? 'Unavailable for earlier activations' : expiryFormat.format(license.activatedAt)}</dd></div>}
      {license.expiresAt !== undefined && <div><dt>Expiry date</dt><dd>{expiryFormat.format(license.expiresAt)} (Sri Lanka time)</dd></div>}
      {(active || license.reason === 'expired') && <div><dt>Days remaining</dt><dd>{license.daysRemaining}</dd></div>}
      {license.allowed && <div><dt>Time remaining</dt><dd className="license-countdown">{timeLeft(license)}</dd></div>}
    </dl>
    <label>Device ID<input value={license.deviceId} readOnly onFocus={event => event.currentTarget.select()} /></label>
    <div className="license-actions">
      <Button className="secondary" onClick={() => void window.offlineLicense.copy().then(() => setNotice('Device ID copied.'), () => setNotice('Could not copy device ID.'))}>Copy Device ID</Button>
      <Button className="secondary" disabled={openingWhatsApp} onClick={() => void openWhatsApp(false)}>Contact Support</Button>
    </div>
    <label>Shop name for WhatsApp request<input maxLength={160} value={purchaseShop} onChange={event => setShopName(event.target.value)} /></label>
    <div className="license-actions">
      <Button className="secondary" disabled={openingWhatsApp || !purchaseShop.trim()} onClick={() => void openWhatsApp(true)}>{active || license.reason === 'expired' ? 'Renew License' : 'Buy license on WhatsApp'}</Button>
    </div>
    <p>For a replacement device, contact {supportPhone} with your new Device ID.</p>
    {!showForm && <Button onClick={() => setEnteringLicense(true)}>Enter New License</Button>}
    {showForm && <form className="license-form" onSubmit={event => {event.preventDefault();void activate(false)}}>
      <label>License Key<textarea rows={4} maxLength={8192} value={code} onChange={event => setCode(event.target.value)} spellCheck={false} /></label>
      <div className="license-actions">
        <Button type="submit" disabled={busy || !code.trim()}>Activate License</Button>
        <Button className="secondary" type="button" disabled={busy} onClick={() => void paste()}>Paste License</Button>
        <Button className="secondary" type="button" disabled={busy} onClick={() => void activate(true)}>Import license file</Button>
      </div>
    </form>}
    {license.allowed && <Button className="quiet" onClick={() => {setShow(false);setNotice('');setCode('')}}>Back to workspace</Button>}
    {notice && <p role="status">{notice}</p>}
  </Panel></div>;
}
