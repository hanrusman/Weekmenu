import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import type { PicnicSuggestion } from '../client/src/lib/api';

const picnicApi = {
  status: vi.fn(),
  suggestions: vi.fn(),
  searchForItem: vi.fn(),
  addToCart: vi.fn(),
  unfinished: vi.fn(),
  finishAttempt: vi.fn(),
  abandonAttempt: vi.fn(),
  logout: vi.fn(),
};
vi.mock('../client/src/lib/api', async (original) => ({
  ...(await original<typeof import('../client/src/lib/api')>()),
  picnicApi,
}));

const { default: PicnicCart } = await import('../client/src/pages/PicnicCart');

const half500 = { id: 's1', name: 'Rundergehakt', unit_quantity: '500 gram', price: 499 };
const small200 = { id: 's8', name: 'Gehakt klein', unit_quantity: '200 gram', price: 249 };

function gehakt(fields: Partial<PicnicSuggestion> = {}): PicnicSuggestion {
  return {
    item_id: 7, item_name: 'gehakt', quantity: '650 g', product_group: 'vlees', query: 'gehakt',
    product: half500, remembered: false, picked: false, previous: null, count: 2, selected: true, note: null,
    alternatives: [{ ...half500, count: 2 }, { ...small200, count: 4 }],
    ...fields,
  };
}

const renderPage = () => render(
  <MemoryRouter initialEntries={['/boodschappen/picnic/3']}>
    <Routes><Route path="/boodschappen/picnic/:menuId" element={<PicnicCart />} /></Routes>
  </MemoryRouter>,
);

const count = () => screen.getByLabelText('Aantal').textContent;

beforeEach(() => {
  vi.clearAllMocks();
  picnicApi.status.mockResolvedValue({ connected: true, awaitingCode: false, email: 'han@example.nl' });
});

describe('Picnic basket page', () => {
  it('takes the pack count of the product picked instead', async () => {
    picnicApi.suggestions.mockResolvedValue({ items: [gehakt()], unfinished: [] });
    renderPage();
    expect(await screen.findByText(/Rundergehakt · 500 gram/)).toBeInTheDocument();
    expect(count()).toBe('2');

    fireEvent.click(screen.getByRole('button', { name: /Ander product/ }));
    fireEvent.click(screen.getByRole('button', { name: /Gehakt klein/ }));

    expect(screen.getByText(/Gehakt klein · 200 gram/)).toBeInTheDocument();
    expect(count()).toBe('4');
  });

  it('counts a searched product for this item too', async () => {
    picnicApi.suggestions.mockResolvedValue({ items: [gehakt({ alternatives: [] })], unfinished: [] });
    picnicApi.searchForItem.mockResolvedValue([{ id: 's9', name: 'Gehakt groot', unit_quantity: '1 kilo', price: 899, count: 1 }]);
    renderPage();
    fireEvent.click(await screen.findByRole('button', { name: /Ander product/ }));
    fireEvent.change(screen.getByLabelText('Zoek bij Picnic'), { target: { value: 'gehakt kilo' } });
    fireEvent.click(screen.getByRole('button', { name: 'Zoeken' }));
    fireEvent.click(await screen.findByRole('button', { name: /Gehakt groot/ }));

    expect(picnicApi.searchForItem).toHaveBeenCalledWith(7, 'gehakt kilo');
    expect(count()).toBe('1');
  });

  it('sends a product picked by hand as picked, a proposal as not', async () => {
    picnicApi.suggestions.mockResolvedValue({ items: [gehakt(), gehakt({ item_id: 8, item_name: 'ui' })], unfinished: [] });
    picnicApi.addToCart.mockResolvedValue({ added: 2, total_count: 6, total_price: 998 });
    renderPage();
    const [first] = await screen.findAllByRole('button', { name: /Ander product/ });
    fireEvent.click(first);
    fireEvent.click(screen.getByRole('button', { name: /Gehakt klein/ }));
    fireEvent.click(screen.getByRole('button', { name: /Zet 2 in het mandje/ }));
    await screen.findByText(/in het Picnic-mandje gezet/);
    const lines = picnicApi.addToCart.mock.calls[0][2];
    expect(lines.map((l: { item_id: number; picked: boolean }) => [l.item_id, l.picked])).toEqual([[7, true], [8, false]]);
  });

  // Review on 077f5f5: a choice changed after a failure must not go out as the old one
  it('after a failed add, has the open attempt settled instead of letting the choice change', async () => {
    picnicApi.suggestions.mockResolvedValue({ items: [gehakt()], unfinished: [] });
    picnicApi.addToCart.mockRejectedValueOnce(new Error('Picnic gaf geen duidelijk antwoord.'));
    renderPage();
    fireEvent.click(await screen.findByRole('button', { name: /Zet 1 in het mandje/ }));
    const firstId = picnicApi.addToCart.mock.calls[0][1];
    picnicApi.unfinished.mockResolvedValue([{ request_id: firstId, items: ['gehakt'] }]);
    picnicApi.finishAttempt.mockResolvedValue({ added: 1, total_count: 2, total_price: 998 });

    expect(await screen.findByText(/eerdere poging is niet afgerond/)).toHaveTextContent('gehakt');
    expect(screen.getByText(/geen duidelijk antwoord/)).toBeInTheDocument();
    // Nothing left to edit or send while it is open
    expect(screen.queryByRole('button', { name: /Ander product/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /in het mandje/ })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Afronden' }));
    await screen.findByText(/Eerdere poging afgerond/);
    expect(picnicApi.finishAttempt).toHaveBeenCalledWith(3, firstId);
    expect(picnicApi.addToCart).toHaveBeenCalledTimes(1);
  });

  it('keeps the choice after a failure that left nothing open, and sends it as a new attempt', async () => {
    picnicApi.suggestions.mockResolvedValue({ items: [gehakt()], unfinished: [] });
    picnicApi.unfinished.mockResolvedValue([]);
    picnicApi.addToCart
      .mockRejectedValueOnce(new Error('Picnic: fetch failed'))
      .mockResolvedValueOnce({ added: 1, total_count: 3, total_price: 1497 });
    renderPage();
    fireEvent.click(await screen.findByRole('button', { name: /Zet 1 in het mandje/ }));
    expect(await screen.findByText(/fetch failed/)).toBeInTheDocument();
    await waitFor(() => expect(picnicApi.unfinished).toHaveBeenCalledWith(3));

    fireEvent.click(screen.getByRole('button', { name: 'Meer' }));
    expect(count()).toBe('3');
    fireEvent.click(screen.getByRole('button', { name: /Zet 1 in het mandje/ }));
    await screen.findByText(/in het Picnic-mandje gezet/);

    const [first, second] = picnicApi.addToCart.mock.calls;
    expect(second[1]).toMatch(/^[0-9a-f]{32}$/);
    expect(second[1]).not.toBe(first[1]);
    expect(second[2]).toEqual([{ item_id: 7, product: expect.objectContaining({ id: 's1' }), count: 3, picked: false }]);
  });

  it('has an unsettled attempt finished first, before anything new goes out', async () => {
    picnicApi.suggestions
      .mockResolvedValueOnce({ items: [], unfinished: [{ request_id: 'abc12345', items: ['gehakt'] }] })
      .mockResolvedValue({ items: [gehakt({ item_name: 'ui', item_id: 8 })], unfinished: [] });
    picnicApi.finishAttempt.mockResolvedValue({ added: 1, total_count: 2, total_price: 998 });
    renderPage();
    expect(await screen.findByText(/eerdere poging is niet afgerond/)).toHaveTextContent('gehakt');
    expect(screen.queryByRole('button', { name: /in het mandje/ })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Afronden' }));
    expect(await screen.findByText(/Eerdere poging afgerond: 1 boodschap in het mandje/)).toBeInTheDocument();
    expect(picnicApi.finishAttempt).toHaveBeenCalledWith(3, 'abc12345');
    expect(await screen.findByRole('button', { name: /Zet 1 in het mandje/ })).toBeInTheDocument();
  });

  it('gives an unsettled attempt up and says what is partly in the basket', async () => {
    picnicApi.suggestions
      .mockResolvedValueOnce({ items: [], unfinished: [{ request_id: 'abc12345', items: ['gehakt'] }] })
      .mockResolvedValue({ items: [gehakt()], unfinished: [] });
    picnicApi.abandonAttempt.mockResolvedValue({ open: ['gehakt'], partly: 'Half-om-half (1 van 3)' });
    renderPage();
    fireEvent.click(await screen.findByRole('button', { name: 'Afbreken' }));
    expect(await screen.findByText(/Eerdere poging afgebroken/))
      .toHaveTextContent('Weer open op de lijst: gehakt. Let op, deels al in het mandje: Half-om-half (1 van 3).');
  });

  it('warns when the product of last time is gone', async () => {
    picnicApi.suggestions.mockResolvedValue({ items: [gehakt({ previous: 'Half-om-half' })], unfinished: [] });
    renderPage();
    const row = (await screen.findByText(/Vorige keer: Half-om-half/)).closest('div')!;
    expect(within(row).getByText(/niet meer bij Picnic/)).toBeInTheDocument();
    await waitFor(() => expect(count()).toBe('2'));
  });
});
