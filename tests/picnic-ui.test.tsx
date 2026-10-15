import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import type { PicnicSuggestion } from '../client/src/lib/api';

const picnicApi = {
  status: vi.fn(),
  suggestions: vi.fn(),
  searchForItem: vi.fn(),
  addToCart: vi.fn(),
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
    item_id: 7, item_name: 'gehakt', quantity: '650 g', product_group: 'vlees',
    product: half500, remembered: false, previous: null, count: 2, selected: true,
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
    picnicApi.suggestions.mockResolvedValue([gehakt()]);
    renderPage();
    expect(await screen.findByText(/Rundergehakt · 500 gram/)).toBeInTheDocument();
    expect(count()).toBe('2');

    fireEvent.click(screen.getByRole('button', { name: /Ander product/ }));
    fireEvent.click(screen.getByRole('button', { name: /Gehakt klein/ }));

    expect(screen.getByText(/Gehakt klein · 200 gram/)).toBeInTheDocument();
    expect(count()).toBe('4');
  });

  it('counts a searched product for this item too', async () => {
    picnicApi.suggestions.mockResolvedValue([gehakt({ alternatives: [] })]);
    picnicApi.searchForItem.mockResolvedValue([{ id: 's9', name: 'Gehakt groot', unit_quantity: '1 kilo', price: 899, count: 1 }]);
    renderPage();
    fireEvent.click(await screen.findByRole('button', { name: /Ander product/ }));
    fireEvent.change(screen.getByLabelText('Zoek bij Picnic'), { target: { value: 'gehakt kilo' } });
    fireEvent.click(screen.getByRole('button', { name: 'Zoeken' }));
    fireEvent.click(await screen.findByRole('button', { name: /Gehakt groot/ }));

    expect(picnicApi.searchForItem).toHaveBeenCalledWith(7, 'gehakt kilo');
    expect(count()).toBe('1');
  });

  it('sends a retry with the same request id', async () => {
    picnicApi.suggestions.mockResolvedValue([gehakt()]);
    picnicApi.addToCart
      .mockRejectedValueOnce(new Error('Picnic gaf geen duidelijk antwoord.'))
      .mockResolvedValueOnce({ added: 1, total_count: 2, total_price: 998, missing: [] });
    renderPage();
    const add = await screen.findByRole('button', { name: /Zet 1 in het mandje/ });
    fireEvent.click(add);
    expect(await screen.findByText(/geen duidelijk antwoord/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /Zet 1 in het mandje/ }));
    await screen.findByText(/in het Picnic-mandje gezet/);

    const [first, second] = picnicApi.addToCart.mock.calls;
    expect(first[1]).toMatch(/^[0-9a-f]{32}$/);
    expect(second[1]).toBe(first[1]);
  });

  it('names what did not make it into the basket', async () => {
    picnicApi.suggestions.mockResolvedValue([gehakt()]);
    picnicApi.addToCart.mockResolvedValue({ added: 0, total_count: 0, total_price: 0, missing: ['gehakt'] });
    renderPage();
    fireEvent.click(await screen.findByRole('button', { name: /Zet 1 in het mandje/ }));
    expect(await screen.findByText(/Niet in het mandje gekomen: gehakt/)).toBeInTheDocument();
  });

  it('warns when the product of last time is gone', async () => {
    picnicApi.suggestions.mockResolvedValue([gehakt({ previous: 'Half-om-half' })]);
    renderPage();
    const row = (await screen.findByText(/Vorige keer: Half-om-half/)).closest('div')!;
    expect(within(row).getByText(/niet meer bij Picnic/)).toBeInTheDocument();
    await waitFor(() => expect(count()).toBe('2'));
  });
});
