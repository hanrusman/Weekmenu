import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';

const DIR = path.join(process.cwd(), 'client', 'public', 'icons', 'meals');

describe('Stock meal illustrations', () => {
  it('have a webp next to every PNG (npm run icons)', () => {
    const files = fs.readdirSync(DIR);
    const missing = files.filter((f) => f.endsWith('.png') && !files.includes(f.replace(/\.png$/, '.webp')));
    expect(missing).toEqual([]);
  });
});
