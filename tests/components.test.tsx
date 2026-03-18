import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import StatusBadge from '../client/src/components/StatusBadge';

describe('StatusBadge', () => {
  it('should render draft status', () => {
    render(<StatusBadge status="draft" />);
    expect(screen.getByText('Concept')).toBeInTheDocument();
  });

  it('should render active status', () => {
    render(<StatusBadge status="active" />);
    expect(screen.getByText('Actief')).toBeInTheDocument();
  });

  it('should render archived status', () => {
    render(<StatusBadge status="archived" />);
    expect(screen.getByText('Archief')).toBeInTheDocument();
  });

  it('should render proposed status', () => {
    render(<StatusBadge status="proposed" />);
    expect(screen.getByText('Voorstel')).toBeInTheDocument();
  });

  it('should render approved status', () => {
    render(<StatusBadge status="approved" />);
    expect(screen.getByText('Goedgekeurd')).toBeInTheDocument();
  });

  it('should render completed status', () => {
    render(<StatusBadge status="completed" />);
    expect(screen.getByText('Klaar')).toBeInTheDocument();
  });

  it('should render unknown status as-is', () => {
    render(<StatusBadge status="unknown" />);
    expect(screen.getByText('unknown')).toBeInTheDocument();
  });
});
