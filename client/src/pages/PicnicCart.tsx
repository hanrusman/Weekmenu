import { Link, useParams } from 'react-router-dom';
import { FormEvent, useCallback, useEffect, useRef, useState } from 'react';
import { ArrowLeft, Minus, Plus, Search, ShoppingCart, Repeat } from 'lucide-react';
import { picnicApi, PicnicAddResult, PicnicCountedProduct, PicnicStatus, PicnicSuggestion } from '../lib/api';
import Button from '../components/Button';

const inputClass = 'w-full p-3 border border-line rounded-2xl text-sm bg-sunken focus:outline-none focus:ring-2 focus:ring-warmth-400';
const labelClass = 'block text-xs font-bold tracking-wide text-accent mb-2 uppercase';

const euro = (cents: number) =>
  (cents / 100).toLocaleString('nl-NL', { style: 'currency', currency: 'EUR' });

type Row = PicnicSuggestion & { open: boolean };

/** Random id; getRandomValues also works over plain http (randomUUID does not). */
function newRequestId(): string {
  return Array.from(crypto.getRandomValues(new Uint8Array(16)), (b) => b.toString(16).padStart(2, '0')).join('');
}

function Connect({ status, onDone }: { status: PicnicStatus; onDone: (s: PicnicStatus) => void }) {
  const [email, setEmail] = useState(status.email ?? '');
  const [password, setPassword] = useState('');
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [resent, setResent] = useState(false);

  async function run(fn: () => Promise<void>) {
    setBusy(true);
    setError(null);
    try {
      await fn();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const login = (e: FormEvent) => {
    e.preventDefault();
    run(async () => {
      await picnicApi.login(email, password);
      setPassword('');
      onDone(await picnicApi.status());
    });
  };

  const verify = (e: FormEvent) => {
    e.preventDefault();
    run(async () => onDone(await picnicApi.verify(code)));
  };

  if (status.awaitingCode) {
    return (
      <form onSubmit={verify} className="bg-surface rounded-3xl p-6 space-y-4">
        <p className="text-sm">Picnic heeft een sms met een code gestuurd naar het nummer van {status.email ?? 'je account'}.</p>
        <div>
          <label className={labelClass} htmlFor="picnic-code">Code uit de sms</label>
          <input id="picnic-code" inputMode="numeric" autoComplete="one-time-code" value={code}
            onChange={(e) => setCode(e.target.value)} required className={inputClass} />
        </div>
        {error && <div className="p-3 rounded-xl bg-danger-soft text-sm text-danger">{error}</div>}
        <Button type="submit" block size="lg" disabled={busy || !code}>{busy ? 'Bezig...' : 'Bevestigen'}</Button>
        <div className="flex justify-between text-xs font-bold">
          <button type="button" className="text-brand hover:text-brand-hover disabled:opacity-50" disabled={busy}
            onClick={() => run(async () => { await picnicApi.resend(); setResent(true); })}>
            {resent ? 'Nieuwe code verstuurd' : 'Stuur een nieuwe code'}
          </button>
          <button type="button" className="text-muted hover:text-ink" disabled={busy}
            onClick={() => run(async () => onDone(await picnicApi.logout()))}>
            Opnieuw beginnen
          </button>
        </div>
      </form>
    );
  }

  return (
    <form onSubmit={login} className="bg-surface rounded-3xl p-6 space-y-4">
      <p className="text-sm">
        Koppel eenmalig het Picnic-account van het gezin. Je wachtwoord gaat alleen naar Picnic en wordt niet bewaard;
        de app onthoudt alleen de sleutel die Picnic teruggeeft.
      </p>
      <div>
        <label className={labelClass} htmlFor="picnic-email">Picnic e-mail</label>
        <input id="picnic-email" type="email" autoComplete="username" value={email}
          onChange={(e) => setEmail(e.target.value)} required className={inputClass} />
      </div>
      <div>
        <label className={labelClass} htmlFor="picnic-password">Picnic wachtwoord</label>
        <input id="picnic-password" type="password" autoComplete="current-password" value={password}
          onChange={(e) => setPassword(e.target.value)} required className={inputClass} />
      </div>
      {error && <div className="p-3 rounded-xl bg-danger-soft text-sm text-danger">{error}</div>}
      <Button type="submit" block size="lg" disabled={busy || !email || !password}>{busy ? 'Bezig...' : 'Koppelen'}</Button>
    </form>
  );
}

function ProductPicker({ row, onPick }: { row: Row; onPick: (p: PicnicCountedProduct) => void }) {
  const [query, setQuery] = useState(row.item_name);
  const [results, setResults] = useState<PicnicCountedProduct[]>(row.alternatives);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function search(e?: FormEvent) {
    e?.preventDefault();
    if (!query.trim()) return;
    setBusy(true);
    setError(null);
    try {
      setResults(await picnicApi.searchForItem(row.item_id, query.trim()));
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mt-3 space-y-2">
      <form onSubmit={search} className="flex gap-2">
        <input aria-label="Zoek bij Picnic" value={query} onChange={(e) => setQuery(e.target.value)} className={inputClass} />
        <Button type="submit" variant="secondary" disabled={busy} aria-label="Zoeken"><Search size={16} /></Button>
      </form>
      {error && <div className="text-xs text-danger">{error}</div>}
      {busy && <div className="text-xs text-muted">Zoeken...</div>}
      {!busy && results.length === 0 && <div className="text-xs text-muted">Niets gevonden — probeer een ander woord.</div>}
      <ul className="divide-y divide-line-soft">
        {results.map((p) => (
          <li key={p.id}>
            <button type="button" onClick={() => onPick(p)}
              className={`w-full text-left py-2 px-2 rounded-xl text-sm hover:bg-raised flex justify-between gap-3 ${p.id === row.product?.id ? 'font-bold' : ''}`}>
              <span className="min-w-0">{p.name} <span className="text-muted">{p.unit_quantity}</span></span>
              {p.price !== null && <span className="shrink-0 text-muted">{euro(p.price)}</span>}
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

function SuggestionRow({ row, onChange }: { row: Row; onChange: (r: Row) => void }) {
  const { product } = row;
  return (
    <div className="py-3">
      <div className="flex items-start gap-3">
        <input type="checkbox" checked={row.selected} disabled={!product} aria-label={`${row.item_name} meenemen`}
          onChange={(e) => onChange({ ...row, selected: e.target.checked })}
          className="w-5 h-5 mt-0.5 shrink-0 rounded-lg accent-brand cursor-pointer" />
        <div className="flex-1 min-w-0">
          <div className={row.selected ? '' : 'text-faint'}>
            {row.item_name}
            {row.quantity && <span className="text-sm text-muted ml-1">({row.quantity})</span>}
          </div>
          {product ? (
            <div className="text-xs text-muted">
              {product.name} · {product.unit_quantity}
              {product.price !== null && <> · {euro(product.price)}</>}
              {row.remembered && <span className="ml-1 italic">vorige keer</span>}
            </div>
          ) : (
            <div className="text-xs text-danger">Geen product gevonden</div>
          )}
          {row.previous && (
            <div className="text-xs text-danger">Vorige keer: {row.previous} — niet meer bij Picnic, kijk de vervanger na</div>
          )}
          <button type="button" onClick={() => onChange({ ...row, open: !row.open })}
            className="mt-1 flex items-center gap-1 text-xs font-bold text-brand hover:text-brand-hover">
            <Repeat size={12} /> {row.open ? 'Sluiten' : product ? 'Ander product' : 'Zoek product'}
          </button>
        </div>
        {product && (
          <div className="flex items-center gap-1 shrink-0">
            <Button variant="ghost" size="sm" aria-label="Minder" disabled={row.count <= 1}
              onClick={() => onChange({ ...row, count: row.count - 1 })}><Minus size={14} /></Button>
            <span className="w-6 text-center font-bold tabular-nums" aria-label="Aantal">{row.count}</span>
            <Button variant="ghost" size="sm" aria-label="Meer" disabled={row.count >= 50}
              onClick={() => onChange({ ...row, count: row.count + 1 })}><Plus size={14} /></Button>
          </div>
        )}
      </div>
      {row.open && (
        <ProductPicker row={row}
          onPick={({ count, ...p }) => onChange({ ...row, product: p, count, remembered: false, previous: null, selected: true, open: false })} />
      )}
    </div>
  );
}

export default function PicnicCart() {
  const menuId = Number(useParams().menuId);
  const [status, setStatus] = useState<PicnicStatus | null>(null);
  const [rows, setRows] = useState<Row[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [done, setDone] = useState<PicnicAddResult | null>(null);
  // One id per batch of suggestions: a retry sends the same one, so the server never adds twice
  const requestId = useRef('');

  useEffect(() => {
    picnicApi.status().then(setStatus).catch((err) => setError((err as Error).message));
  }, []);

  const loadSuggestions = useCallback(async () => {
    setRows(null);
    setError(null);
    try {
      setRows((await picnicApi.suggestions(menuId)).map((s) => ({ ...s, open: false })));
      requestId.current = newRequestId();
    } catch (err) {
      setError((err as Error).message);
      // The key may have run out: show the login again
      setStatus(await picnicApi.status().catch(() => null));
    }
  }, [menuId]);

  useEffect(() => {
    if (status?.connected && !done) loadSuggestions();
  }, [status?.connected, done, loadSuggestions]);

  const chosen = (rows ?? []).filter((r) => r.selected && r.product);
  const estimate = chosen.reduce((sum, r) => sum + (r.product!.price ?? 0) * r.count, 0);

  async function handleAdd() {
    setAdding(true);
    setError(null);
    try {
      setDone(await picnicApi.addToCart(menuId, requestId.current,
        chosen.map((r) => ({ item_id: r.item_id, product: r.product!, count: r.count }))));
    } catch (err) {
      setError((err as Error).message);
      setStatus(await picnicApi.status().catch(() => null));
    } finally {
      setAdding(false);
    }
  }

  async function handleDisconnect() {
    setStatus(await picnicApi.logout());
    setRows(null);
  }

  return (
    <div className="p-4 md:p-8 max-w-2xl mx-auto pt-8 md:pt-12 pb-32">
      <Link to="/boodschappen" className="flex items-center gap-2 text-muted text-sm hover:text-ink transition-colors mb-6">
        <ArrowLeft size={16} /> boodschappen
      </Link>
      <h1 className="text-3xl md:text-4xl font-bold tracking-tight mb-6">Naar Picnic</h1>

      {error && (
        <div className="bg-danger-soft text-danger p-3 rounded-2xl mb-4 text-sm">
          {error}
          <button onClick={() => setError(null)} className="ml-2 font-bold">x</button>
        </div>
      )}

      {!status && !error && <div className="text-center text-4xl animate-cook py-12">🛒</div>}

      {status && !status.connected && <Connect status={status} onDone={setStatus} />}

      {status?.connected && done && (
        <div className="bg-surface rounded-3xl p-6 space-y-4 text-center">
          <div className="text-4xl">🧺</div>
          <p className="font-bold">{done.added} {done.added === 1 ? 'boodschap' : 'boodschappen'} in het Picnic-mandje gezet</p>
          <p className="text-sm text-muted">
            Het mandje heeft nu {done.total_count} artikelen voor {euro(done.total_price)}.
            Bezorgmoment kiezen en bestellen doe je in de Picnic-app.
          </p>
          {done.missing.length > 0 && (
            <p className="text-sm text-danger">
              Niet in het mandje gekomen: {done.missing.join(', ')}. Die staan nog open op de lijst.
            </p>
          )}
          <Link to="/boodschappen" className="inline-block text-sm font-bold text-brand hover:text-brand-hover">
            Terug naar de boodschappenlijst
          </Link>
        </div>
      )}

      {status?.connected && !done && (
        <div className="space-y-6">
          {rows === null && !error && (
            <p className="text-center text-muted py-8"><span className="inline-block animate-cook mr-2">🔎</span>Producten zoeken bij Picnic...</p>
          )}
          {rows && rows.length === 0 && (
            <p className="text-center text-muted py-8">Alles staat al afgevinkt — niets meer om te bestellen.</p>
          )}
          {rows && rows.length > 0 && (
            <>
              <p className="text-sm text-muted">
                Kijk de producten na. Kruiden en olie in lepels, en wat volgens de voorraadcheck in huis is, staan uit.
                Wat je toevoegt wordt afgevinkt op de lijst en volgende week weer voorgesteld.
              </p>
              <div className="bg-surface rounded-3xl px-5 divide-y divide-line-soft shadow-[0_4px_20px_rgba(0,0,0,0.03)]">
                {rows.map((row) => (
                  <SuggestionRow key={row.item_id} row={row}
                    onChange={(next) => setRows((prev) => prev!.map((r) => (r.item_id === next.item_id ? next : r)))} />
                ))}
              </div>
              <Button block size="lg" onClick={handleAdd} disabled={adding || chosen.length === 0}>
                <ShoppingCart size={18} />
                {adding ? 'Bezig...' : `Zet ${chosen.length} in het mandje${estimate ? ` · ${euro(estimate)}` : ''}`}
              </Button>
            </>
          )}
          <div className="text-center">
            <button onClick={handleDisconnect} className="text-xs font-bold text-muted hover:text-ink">
              Picnic ontkoppelen{status.email ? ` (${status.email})` : ''}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
