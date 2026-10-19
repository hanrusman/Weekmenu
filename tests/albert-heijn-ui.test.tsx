import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import type { AhSuggestion } from '../shared/albert-heijn';

const ahApi = vi.hoisted(() => ({ status: vi.fn(), connect: vi.fn(), logout: vi.fn(), suggestions: vi.fn(), search: vi.fn(), unfinished: vi.fn(), add: vi.fn(), settle: vi.fn() }));
vi.mock('../client/src/lib/api', () => ({ ahApi }));
import AlbertHeijn from '../client/src/pages/AlbertHeijn';
const product = { id: '123', name: 'AH Rundergehakt', unit_quantity: '500 g', price: 499, frozen: false, organic: false, house_brand: true };
const alternative = { ...product, id: '456', name: 'AH Gehakt klein', unit_quantity: '200 g', count: 4 };
const row = (): AhSuggestion => ({ item_id: 7, item_name: 'gehakt', quantity: '650 g', product_group: 'vlees', query: 'gehakt', product, count: 2, selected: true, picked: false, remembered: false, note: null, alternatives: [alternative] });
const connected = { connected: true, login_url: 'https://login.ah.nl/login' };
const renderPage = () => render(<MemoryRouter initialEntries={['/boodschappen/albert-heijn/3']}><Routes><Route path="/boodschappen/albert-heijn/:menuId" element={<AlbertHeijn />} /></Routes></MemoryRouter>);
beforeEach(() => {
  vi.resetAllMocks();
  ahApi.status.mockResolvedValue(connected);
  ahApi.suggestions.mockResolvedValue({ items: [row()], unfinished: [] });
  ahApi.unfinished.mockResolvedValue([]);
});

describe('Albert Heijn page', () => {
  it('connects with a one-time code and clears the sensitive field', async () => {
    ahApi.status.mockResolvedValue({ ...connected, connected: false });
    ahApi.connect.mockRejectedValue(new Error('Code verlopen'));
    renderPage();
    const input = await screen.findByLabelText('AH-inlogcode of inloglink');
    expect(screen.getByRole('link', { name: /Open de AH-inlogpagina/ })).toHaveAttribute('href', connected.login_url);
    fireEvent.change(input, { target: { value: 'appie://login-exit?code=secret-code' } });
    fireEvent.click(screen.getByRole('button', { name: 'Account koppelen' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Code verlopen');
    expect(ahApi.connect).toHaveBeenCalledWith('appie://login-exit?code=secret-code');
    expect(input).toHaveValue('');
  });
  it('uses the selected product pack count and marks it as picked', async () => {
    ahApi.add.mockResolvedValue({ added: 1 });
    renderPage();
    fireEvent.click(await screen.findByRole('button', { name: 'Ander product' }));
    fireEvent.click(screen.getByRole('button', { name: /AH Gehakt klein/ }));
    expect(screen.getByLabelText('Aantal gehakt')).toHaveTextContent('4');
    fireEvent.click(screen.getByRole('button', { name: 'Meer gehakt' }));
    fireEvent.click(screen.getByRole('button', { name: /Zet 1 op mijn AH-lijst/ }));
    expect(await screen.findByRole('heading', { name: /1 boodschappen op je AH-lijst gezet/ })).toBeInTheDocument();
    expect(ahApi.add).toHaveBeenCalledWith(3, expect.any(String), [{ item_id: 7, product: expect.objectContaining({ id: '456' }), count: 5, picked: true }]);
    expect(screen.getByRole('link', { name: /Open mijn AH-lijst/ })).toHaveAttribute('href', 'https://www.ah.nl/mijnlijst');
  });
  it('leaves unsuitable suggestions off and prevents an empty add', async () => {
    ahApi.suggestions.mockResolvedValue({ items: [{ ...row(), selected: false, note: 'vers of diepvries onbekend, kijk even na' }], unfinished: [] });
    renderPage();
    expect(await screen.findByRole('checkbox')).not.toBeChecked();
    expect(screen.getByRole('button', { name: /Zet 0 op mijn AH-lijst/ })).toBeDisabled();
    expect(screen.getByText(/vers of diepvries onbekend/)).toBeInTheDocument();
  });
  it('searches alternatives for the original shopping item', async () => {
    ahApi.search.mockResolvedValue([alternative]);
    renderPage();
    fireEvent.click(await screen.findByRole('button', { name: 'Ander product' }));
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'biologisch gehakt' } });
    fireEvent.click(screen.getByRole('button', { name: 'Zoeken' }));
    await waitFor(() => expect(ahApi.search).toHaveBeenCalledWith(7, 'biologisch gehakt'));
    expect(await screen.findByRole('button', { name: /AH Gehakt klein/ })).toBeInTheDocument();
  });
  it('locks editing after a failed add and settles the existing attempt', async () => {
    const attempt = { request_id: 'previous-123', menu_id: 2, items: ['ui'] };
    ahApi.add.mockRejectedValue(new Error('Geen duidelijk antwoord'));
    ahApi.unfinished.mockResolvedValue([attempt]);
    ahApi.settle.mockResolvedValue({ added: 1 });
    renderPage();
    fireEvent.click(await screen.findByRole('button', { name: /Zet 1 op mijn AH-lijst/ }));
    fireEvent.click(await screen.findByRole('button', { name: 'Afronden' }));
    await screen.findByText('1 boodschappen bevestigd op de AH-lijst.');
    expect(ahApi.settle).toHaveBeenCalledWith(attempt, 'finish');
    expect(ahApi.add).toHaveBeenCalledTimes(1);
  });
  it('keeps editing blocked if the previous attempt cannot be read', async () => {
    ahApi.add.mockRejectedValue(new Error('Netwerkfout'));
    ahApi.unfinished.mockRejectedValue(new Error('Netwerkfout'));
    renderPage();
    fireEvent.click(await screen.findByRole('button', { name: /Zet 1 op mijn AH-lijst/ }));
    await screen.findByText(/eerdere poging kon nog niet worden gecontroleerd/);
    expect(screen.queryByRole('checkbox')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Albert Heijn ontkoppelen' })).toBeDisabled();
  });
  it('reloads checked items after a lost success response before another add', async () => {
    ahApi.add.mockRejectedValue(new Error('Verbinding verbroken'));
    ahApi.suggestions.mockResolvedValueOnce({ items: [row()], unfinished: [] }).mockResolvedValue({ items: [], unfinished: [] });
    renderPage();
    fireEvent.click(await screen.findByRole('button', { name: /Zet 1 op mijn AH-lijst/ }));
    await screen.findByText(/Alles staat afgevinkt/);
    expect(screen.queryByRole('checkbox')).not.toBeInTheDocument();
    expect(ahApi.add).toHaveBeenCalledTimes(1);
  });
  it('reports confirmed items when abandoning a partial attempt', async () => {
    const attempt = { request_id: 'previous-123', menu_id: 3, items: ['gehakt'] };
    ahApi.suggestions.mockResolvedValueOnce({ items: [], unfinished: [attempt] }).mockResolvedValue({ items: [row()], unfinished: [] });
    ahApi.settle.mockResolvedValue({ added: 0 });
    renderPage();
    fireEvent.click(await screen.findByRole('button', { name: 'Afbreken' }));
    await screen.findByText(/0 boodschappen bevestigd.*overige boodschappen blijven open/);
    expect(ahApi.settle).toHaveBeenCalledWith(attempt, 'abandon');
  });
});
