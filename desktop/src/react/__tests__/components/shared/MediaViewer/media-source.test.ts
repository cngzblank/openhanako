/**
 * @vitest-environment jsdom
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { loadMediaSource } from '../../../../components/shared/MediaViewer/media-source';
import type { FileRef } from '../../../../types/file-ref';

describe('loadMediaSource', () => {
  beforeEach(() => {
    (window as any).platform = {
      readFileBase64: vi.fn(async (p: string) => `BASE64_OF_${p}`),
      getFileUrl: vi.fn((p: string) => `file:///MOCK${p}`),
    };
  });
  afterEach(() => { delete (window as any).platform; });

  it('image: source=desk 走 readFileBase64 → data url', async () => {
    const ref: FileRef = { id: '1', kind: 'image', source: 'desk', name: 'a.png', path: '/a.png', ext: 'png' };
    const src = await loadMediaSource(ref);
    expect(src.url).toBe('data:image/png;base64,BASE64_OF_/a.png');
  });

  it('svg 推断 mime 为 image/svg+xml', async () => {
    const ref: FileRef = { id: '1', kind: 'svg', source: 'desk', name: 'a.svg', path: '/a.svg', ext: 'svg' };
    const src = await loadMediaSource(ref);
    expect(src.url).toBe('data:image/svg+xml;base64,BASE64_OF_/a.svg');
  });

  it('session-block-screenshot: 直接用 inlineData', async () => {
    const ref: FileRef = {
      id: '1', kind: 'image', source: 'session-block-screenshot',
      name: 's.png', path: '',
      inlineData: { base64: 'ABC', mimeType: 'image/png' },
    };
    const src = await loadMediaSource(ref);
    expect(src.url).toBe('data:image/png;base64,ABC');
    expect((window as any).platform.readFileBase64).not.toHaveBeenCalled();
  });

  it('video: 走 platform.getFileUrl（不手拼 file://）', async () => {
    const ref: FileRef = { id: '1', kind: 'video', source: 'desk', name: 'a.mp4', path: '/a.mp4', ext: 'mp4' };
    const src = await loadMediaSource(ref);
    expect((window as any).platform.getFileUrl).toHaveBeenCalledWith('/a.mp4');
    expect(src.url).toBe('file:///MOCK/a.mp4');
    // 没调 readFileBase64（视频不 base64）
    expect((window as any).platform.readFileBase64).not.toHaveBeenCalled();
  });

  it('platform 缺失 → 抛错', async () => {
    delete (window as any).platform;
    const ref: FileRef = { id: '1', kind: 'image', source: 'desk', name: 'a.png', path: '/a.png', ext: 'png' };
    await expect(loadMediaSource(ref)).rejects.toThrow(/platform/i);
  });

  it('video + platform.getFileUrl 缺失 → 抛错', async () => {
    (window as any).platform = { readFileBase64: vi.fn() }; // 故意缺 getFileUrl
    const ref: FileRef = { id: '1', kind: 'video', source: 'desk', name: 'a.mp4', path: '/a.mp4', ext: 'mp4' };
    await expect(loadMediaSource(ref)).rejects.toThrow(/getFileUrl/i);
  });

  it('image 读取失败 → 抛错携带 path', async () => {
    (window as any).platform.readFileBase64 = vi.fn(async () => null);
    const ref: FileRef = { id: '1', kind: 'image', source: 'desk', name: 'a.png', path: '/a.png', ext: 'png' };
    await expect(loadMediaSource(ref)).rejects.toThrow(/a\.png/);
  });
});
