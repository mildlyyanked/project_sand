import { describe, expect, it } from 'vitest';
import { DEFAULT_IMAGE_BACKEND, imageRequest, parseImageResponse } from '../images';

describe('image backends', () => {
  it('builds an OpenAI-shaped request and strips trailing slashes', () => {
    const r = imageRequest({ ...DEFAULT_IMAGE_BACKEND, kind: 'openai', baseUrl: 'https://host/v1/', model: 'flux', size: 768 }, 'a lamp');
    expect(r.url).toBe('https://host/v1/images/generations');
    expect(r.body).toMatchObject({ prompt: 'a lamp', model: 'flux', size: '768x768', response_format: 'b64_json' });
    expect(r.body).not.toHaveProperty('negative_prompt');
  });
  it('builds a txt2img request with optional steps and checkpoint', () => {
    const r = imageRequest({ ...DEFAULT_IMAGE_BACKEND, kind: 'a1111', baseUrl: 'http://pc:7860', negativePrompt: 'text', steps: 25, model: 'dream.safetensors' }, 'a lamp');
    expect(r.url).toBe('http://pc:7860/sdapi/v1/txt2img');
    expect(r.body).toMatchObject({ prompt: 'a lamp', negative_prompt: 'text', steps: 25, width: 1024, override_settings: { sd_model_checkpoint: 'dream.safetensors' } });
  });
  it('reads both response shapes and surfaces server errors', () => {
    expect(parseImageResponse('a1111', { images: ['AAAA'] })).toBe('data:image/png;base64,AAAA');
    expect(parseImageResponse('openai', { data: [{ b64_json: 'BBBB' }] })).toBe('data:image/png;base64,BBBB');
    expect(parseImageResponse('openai', { data: [{ url: 'https://x/y.png' }] })).toBe('https://x/y.png');
    expect(() => parseImageResponse('openai', { error: { message: 'nope' } })).toThrow('nope');
    expect(() => parseImageResponse('a1111', { detail: 'Not Found' })).toThrow('Not Found');
  });
});
