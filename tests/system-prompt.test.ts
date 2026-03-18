import { describe, it, expect } from 'vitest';
import { getSystemPrompt } from '../server/prompts/system';

describe('System Prompt', () => {
  it('should include the season', () => {
    const prompt = getSystemPrompt('lente', ['asperges', 'spinazie']);
    expect(prompt).toContain('lente');
  });

  it('should include seasonal vegetables', () => {
    const prompt = getSystemPrompt('zomer', ['courgette', 'tomaat', 'paprika']);
    expect(prompt).toContain('courgette');
    expect(prompt).toContain('tomaat');
    expect(prompt).toContain('paprika');
  });

  it('should include nutritional guidelines', () => {
    const prompt = getSystemPrompt('winter', ['boerenkool']);
    expect(prompt).toContain('eiwit');
    expect(prompt).toContain('vis');
    expect(prompt).toContain('vezels');
    expect(prompt).toContain('ijzer');
  });

  it('should include menu structure days', () => {
    const prompt = getSystemPrompt('lente', []);
    expect(prompt).toContain('Woensdag');
    expect(prompt).toContain('Maandag');
    expect(prompt).toContain('woensdag t/m maandag');
  });

  it('should include cost index explanation', () => {
    const prompt = getSystemPrompt('lente', []);
    expect(prompt).toContain('€€€');
    expect(prompt).toContain('budget');
  });

  it('should mention JSON output requirement', () => {
    const prompt = getSystemPrompt('lente', []);
    expect(prompt).toContain('JSON');
  });
});
