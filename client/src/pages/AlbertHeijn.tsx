import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import { Link, useParams } from 'react-router-dom';
import { ArrowLeft, ExternalLink, Minus, Plus, Repeat, Search, ShoppingCart } from 'lucide-react';
import { ahApi } from '../lib/api';
import Button from '../components/Button';
import type { AhStatus, AhProduct, AhCountedProduct, AhSuggestion, AhAttempt, AhAddResult } from '../../../shared/albert-heijn';

const euro = (cents: number) => new Intl.NumberFormat('nl-NL', { style: 'currency', currency: 'EUR' }).format(cents / 100);
const inputClass = 'w-full bg-canvas border border-line rounded-xl px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-brand';
const errorMessage = (error: unknown) => error instanceof Error ? error.message : 'Er ging iets mis. Probeer opnieuw.';

function Tags({ product }: { product: AhProduct }) {
  return <>
    {product.frozen && <span className="ml-2 text-warn">diepvries</span>}
    {product.organic && <span className="ml-2 text-success">bio</span>}
  </>;
}

function Connect({ status, onDone }: { status: AhStatus; onDone: (status: AhStatus) => void }) {
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function connect(event: FormEvent) {
    event.preventDefault(); setBusy(true); setError(null);
    const value = code; setCode('');
    try { onDone(await ahApi.connect(value)); } catch (err) { setError(errorMessage(err)); } finally { setBusy(false); }
  }
  return <form onSubmit={connect} className="bg-surface rounded-3xl p-6 space-y-5">
    <div><h2 className="font-bold text-xl mb-2">Koppel Albert Heijn</h2>
      <p className="text-sm text-muted">Log eenmalig in bij AH en neem de inlogcode hieronder over. Daarna blijft je account gekoppeld. Je AH-wachtwoord blijft bij Albert Heijn.</p></div>
    <a href={status.login_url} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-2 min-h-11 text-brand font-bold">
      Open de AH-inlogpagina <ExternalLink size={16} />
    </a>
    <details className="text-sm text-muted">
      <summary className="cursor-pointer font-bold min-h-11 flex items-center">Waar vind ik de inlogcode?</summary>
      <ol className="list-decimal pl-5 space-y-2">
        <li>Doe dit eenmalig op een computer. Open de AH-inlogpagina en daarna de ontwikkelaarstools van je browser (F12 of ⌥⌘I).</li>
        <li>Kies Netwerk en schakel ‘Logboek behouden’ / ‘Preserve log’ in. Log nu in bij AH.</li>
        <li>Zoek de omleiding naar <code>appie://login-exit?code=…</code>. Soms staat die in het antwoord van <code>ingelogd.json</code>, bij <code>__N_REDIRECT</code>.</li>
        <li>Kopieer die volledige link en plak hem hieronder. De code is eenmalig; de AH-app hoeft niet te openen.</li>
      </ol>
    </details>
    <div><label htmlFor="ah-code" className="block text-sm font-bold mb-2">AH-inlogcode of inloglink</label>
      <input id="ah-code" type="password" autoComplete="off" spellCheck={false} value={code} onChange={e => setCode(e.target.value)} className={inputClass} required disabled={busy} />
    </div>
    {error && <p role="alert" className="text-sm text-danger">{error}</p>}
    <Button type="submit" block disabled={busy || !code.trim()}>{busy ? 'Koppelen…' : 'Account koppelen'}</Button>
  </form>;
}

function ProductPicker({ row, onPick }: { row: AhSuggestion; onPick: (p: AhCountedProduct) => void }) {
  const [query, setQuery] = useState(row.query);
  const [results, setResults] = useState(row.alternatives);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function search(event: FormEvent) {
    event.preventDefault(); setBusy(true); setError(null);
    try { setResults(await ahApi.search(row.item_id, query.trim())); } catch (err) { setError(errorMessage(err)); } finally { setBusy(false); }
  }
  return <div className="mt-3 space-y-2">
    <form onSubmit={search} className="flex gap-2">
      <input aria-label={`Zoek bij AH voor ${row.item_name}`} className={inputClass} value={query} maxLength={100} onChange={e => setQuery(e.target.value)} />
      <Button type="submit" variant="secondary" disabled={busy || !query.trim()} aria-label="Zoeken"><Search size={18} /></Button>
    </form>
    {error && <p role="alert" className="text-sm text-danger">{error}</p>}
    {busy ? <p role="status" className="text-sm text-muted">Producten zoeken…</p> : <ul className="divide-y divide-line-soft">
      {results.map(p => <li key={p.id}>
        <button type="button" onClick={() => onPick(p)} className="w-full min-h-12 text-left rounded-xl p-2 hover:bg-raised focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand">
          <span className="block text-sm font-bold">{p.name}<Tags product={p} /></span>
          <span className="text-xs text-muted">{p.unit_quantity}{p.price !== null ? ` · ${euro(p.price)}` : ''} · {p.count} verpakking{p.count === 1 ? '' : 'en'}</span>
        </button>
      </li>)}
      {!results.length && <li className="text-sm text-muted py-3">Niets gevonden. Probeer een andere zoekterm.</li>}
    </ul>}
  </div>;
}

function SuggestionRow({ row, onChange }: { row: AhSuggestion; onChange: (row: AhSuggestion) => void }) {
  const [open, setOpen] = useState(false);
  const p = row.product;
  return <div className="py-4">
    <div className="flex gap-3 items-start">
      <label className="min-h-11 flex items-start pt-1 cursor-pointer">
        <input type="checkbox" checked={row.selected} disabled={!p} aria-label={`${row.item_name} meenemen`} onChange={e => onChange({ ...row, selected: e.target.checked })} className="w-5 h-5 accent-brand" />
      </label>
      <div className="flex-1 min-w-0">
        <div className="font-medium">{row.item_name} <span className="text-muted text-sm">{row.quantity}</span></div>
        {p ? <p className="text-xs text-muted mt-1">{p.name} · {p.unit_quantity}{p.price !== null ? ` · ${euro(p.price)}` : ''}<Tags product={p} />{row.remembered && <span className="ml-1 italic">vorige keer</span>}</p>
          : <p className="text-xs text-danger">Geen product gevonden</p>}
        {row.note && <p className="text-xs text-muted italic mt-1">{row.note}</p>}
        <button type="button" onClick={() => setOpen(!open)} className="flex items-center gap-2 min-h-11 text-xs font-bold text-brand">
          <Repeat size={14} /> {open ? 'Sluiten' : p ? 'Ander product' : 'Zoek product'}
        </button>
      </div>
    </div>
    {p && <div className="flex items-center justify-end gap-2">
      <span className="text-xs text-muted mr-1">Verpakkingen</span>
      <Button variant="ghost" aria-label={`Minder ${row.item_name}`} disabled={row.count <= 1} onClick={() => onChange({ ...row, count: row.count - 1 })}><Minus size={16} /></Button>
      <span className="font-bold tabular-nums" aria-label={`Aantal ${row.item_name}`}>{row.count}</span>
      <Button variant="ghost" aria-label={`Meer ${row.item_name}`} disabled={row.count >= 50} onClick={() => onChange({ ...row, count: row.count + 1 })}><Plus size={16} /></Button>
    </div>}
    {open && <ProductPicker row={row} onPick={({ count, ...product }) => {
      onChange({ ...row, product, count, selected: true, picked: true, remembered: false, note: null }); setOpen(false);
    }} />}
  </div>;
}

function Page({ menuId }: { menuId: number }) {
  const [status, setStatus] = useState<AhStatus | null>(null);
  const [rows, setRows] = useState<AhSuggestion[] | null>(null);
  const [unfinished, setUnfinished] = useState<AhAttempt[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<AhAddResult | null>(null);
  const requestId = useRef('');
  const [uncertain, setUncertain] = useState(false);

  useEffect(() => { ahApi.status().then(setStatus).catch(e => setError(errorMessage(e))); }, []);
  const load = useCallback(async () => {
    setRows(null); setError(null);
    try {
      const data = await ahApi.suggestions(menuId);
      setRows(data.items); setUnfinished(data.unfinished); setUncertain(false);
      requestId.current = crypto.randomUUID();
    } catch (err) {
      setError(errorMessage(err));
      setStatus(await ahApi.status().catch(() => null));
    }
  }, [menuId]);
  useEffect(() => { if (status?.connected) void load(); }, [status?.connected, load]);

  async function recover() {
    // If this read fails, do not let a changed selection go out as a retry.
    setUncertain(true);
    try {
      const pending = await ahApi.unfinished();
      setUnfinished(pending);
      if (!pending.length) {
        // A lost HTTP response can hide a completed write. Refresh checked items
        // before issuing a new request ID or allowing the selection to change.
        const data = await ahApi.suggestions(menuId);
        setRows(data.items); setUnfinished(data.unfinished);
        requestId.current = crypto.randomUUID();
      }
      setUncertain(false);
    }
    catch { /* A visible reload action remains; the server also holds unfinished attempts. */ }
    setStatus(await ahApi.status().catch(() => null));
  }
  const chosen = (rows ?? []).filter(r => r.selected && r.product);
  const estimate = chosen.reduce((sum, r) => sum + (r.product!.price ?? 0) * r.count, 0);
  async function add() {
    setBusy(true); setError(null);
    try { setDone(await ahApi.add(menuId, requestId.current, chosen.map(r => ({ item_id: r.item_id, product: r.product!, count: r.count, picked: r.picked })))); }
    catch (err) { setError(errorMessage(err)); await recover(); }
    finally { setBusy(false); }
  }
  async function settle(attempt: AhAttempt, action: 'finish' | 'abandon') {
    setBusy(true); setError(null);
    try {
      const result = await ahApi.settle(attempt, action);
      setNotice(`${result.warning ? result.warning + ' ' : ''}${result.added} boodschappen bevestigd in het AH-winkelmandje.${action === 'abandon' ? ' De overige boodschappen blijven open.' : ''}${result.partly?.length ? ` Al gedeeltelijk in het AH-winkelmandje: ${result.partly.join('; ')}. Pas de aantallen hieronder aan voordat je opnieuw toevoegt.` : ''}`);
      await load();
    } catch (err) { setError(errorMessage(err)); await recover(); }
    finally { setBusy(false); }
  }
  async function disconnect() {
    setBusy(true);
    try { setStatus(await ahApi.logout()); setRows(null); } catch (err) { setError(errorMessage(err)); } finally { setBusy(false); }
  }
  return <div className="p-4 md:p-8 max-w-2xl mx-auto pt-8 md:pt-12 pb-32">
    <Link to="/boodschappen" className="flex items-center gap-2 text-muted text-sm min-h-11 mb-4"><ArrowLeft size={16} /> Boodschappen</Link>
    <h1 className="text-3xl md:text-4xl font-bold tracking-tight mb-3">Naar Albert Heijn</h1>
    <p className="text-sm text-muted mb-6">Kies je producten voor het AH-winkelmandje. Een bezorgmoment kiezen, betalen en bestellen doe je zelf in de AH-app. Weekmenu plaatst geen bestelling.</p>
    {error && <div role="alert" className="bg-danger-soft text-danger p-4 rounded-2xl mb-4 text-sm">{error}</div>}
    {notice && <p role="status" className="bg-surface border border-line-soft p-4 rounded-2xl mb-4 text-sm">{notice}</p>}
    {!status && !error && <p role="status" className="text-muted py-8">Koppeling laden…</p>}
    {!status && error && <Button onClick={() => ahApi.status().then(s => { setStatus(s); setError(null); }).catch(e => setError(errorMessage(e)))}>Opnieuw proberen</Button>}
    {status && !status.connected && <Connect status={status} onDone={setStatus} />}
    {status?.connected && (done ? <div className="bg-surface rounded-3xl p-6 text-center space-y-4">
      <ShoppingCart size={32} className="mx-auto text-brand" />
      <h2 className="font-bold text-xl">{done.added} boodschappen in je AH-winkelmandje gezet</h2>
      <p className="text-sm text-muted">De bevestigde boodschappen zijn afgevinkt in Weekmenu. Controleer je winkelmandje en rond je bestelling af bij AH.</p>
      <a href="https://www.ah.nl/bestellen" target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-2 min-h-11 font-bold text-brand">Open mijn AH-winkelmandje <ExternalLink size={16} /></a>
    </div> : <div className="space-y-5">
      {unfinished.map(attempt => <div key={attempt.request_id} className="bg-surface rounded-3xl p-6 space-y-4">
        <p className="text-sm">Een eerdere AH-poging is nog niet afgerond: <b>{attempt.items.join(', ')}</b>. Afronden controleert eerst wat al in het mandje staat. Bij afbreken blijven alleen bevestigde boodschappen afgevinkt.</p>
        <div className="flex flex-wrap gap-3"><Button disabled={busy} onClick={() => settle(attempt, 'finish')}>Afronden</Button>
          <Button variant="secondary" disabled={busy} onClick={() => settle(attempt, 'abandon')}>Afbreken</Button></div>
      </div>)}
      {uncertain && <p className="text-sm text-muted">De eerdere poging kon nog niet worden gecontroleerd. Laad de voorstellen opnieuw.</p>}
      {!unfinished.length && !uncertain && rows && rows.length > 0 && <>
        <p className="text-sm text-muted">Vers, huismerk, volkoren en bio wegen mee. Voorraad en boodschappen voor de bakker, kaasboer of visboer staan uit. Kijk producten en aantallen na.</p>
        <fieldset disabled={busy} className="bg-surface rounded-3xl px-5 divide-y divide-line-soft disabled:opacity-60">
          <legend className="sr-only">Productvoorstellen van Albert Heijn</legend>
          {rows.map(row => <SuggestionRow key={row.item_id} row={row} onChange={next => setRows(old => old!.map(r => r.item_id === next.item_id ? next : r))} />)}
        </fieldset>
        <Button block size="lg" disabled={busy || !chosen.length} onClick={add}><ShoppingCart size={18} />
          {busy ? 'Toevoegen…' : `Zet ${chosen.length} in mijn AH-winkelmandje${estimate ? ` · circa ${euro(estimate)}` : ''}`}</Button>
        {chosen.some(r => r.product?.price === null) && <p className="text-xs text-muted">De schatting bevat niet alle prijzen.</p>}
      </>}
      {!unfinished.length && !uncertain && rows?.length === 0 && <p className="py-8 text-center text-muted">Alles staat afgevinkt. Er zijn geen open boodschappen voor deze week.</p>}
      {!rows && !error && <p role="status" className="text-muted py-8">Producten zoeken bij Albert Heijn…</p>}
      {(error || uncertain) && <Button variant="secondary" disabled={busy} onClick={load}>Voorstellen opnieuw laden</Button>}
      <button className="text-xs text-muted font-bold min-h-11" disabled={busy || unfinished.length > 0 || uncertain} onClick={disconnect}>Albert Heijn ontkoppelen</button>
    </div>)}
  </div>;
}

export default function AlbertHeijn() {
  const menuId = Number(useParams().menuId);
  if (!Number.isInteger(menuId) || menuId <= 0) return <p className="p-8">Ongeldige week. <Link to="/boodschappen">Terug naar boodschappen</Link></p>;
  return <Page key={menuId} menuId={menuId} />;
}
