// desktop/src/react/utils/screenshot.ts
import html2canvas from 'html2canvas';
import { useStore } from '../stores';
import { selectSelectedIdsBySession } from '../stores/session-selectors';

// 临时隐藏按钮、选中高亮、以及非选中消息的 CSS class
const HIDE_CLASS = 'hana-screenshotting';
let styleInjected = false;
function injectHideStyle() {
  if (styleInjected) return;
  const style = document.createElement('style');
  style.textContent = [
    `.${HIDE_CLASS} [class*="msgActions"] { display:none !important; }`,
    `.${HIDE_CLASS} [class*="messageGroupSelected"] { background:transparent !important; }`,
    `.${HIDE_CLASS} .hana-ss-hide { display:none !important; }`,
    // 截图时隐藏 loadMoreHint、typingIndicator、sessionFooter
    `.${HIDE_CLASS} [class*="loadMoreHint"] { display:none !important; }`,
    `.${HIDE_CLASS} [class*="typingIndicator"] { display:none !important; }`,
    `.${HIDE_CLASS} [class*="sessionFooter"] { display:none !important; }`,
  ].join('\n');
  document.head.appendChild(style);
  styleInjected = true;
}

/**
 * 截图指定消息并保存到文件。
 *
 * 直接对消息列表容器 (sessionMessages) 截图，
 * 把不在选中范围内的消息临时隐藏，保证截出来和 app 里看到的完全一致。
 */
export async function takeScreenshot(targetMessageId: string, sessionPath: string): Promise<void> {
  const state = useStore.getState();
  const ids = selectSelectedIdsBySession(state, sessionPath);
  const messageIds = ids.length > 0 ? ids : [targetMessageId];

  // 1. 收集选中的 DOM 节点
  const selectedNodes = new Set<HTMLElement>();
  for (const id of messageIds) {
    const el = document.querySelector(`[data-message-id="${id}"]`) as HTMLElement | null;
    if (el) selectedNodes.add(el);
  }
  if (selectedNodes.size === 0) return;

  // 2. 找到消息列表容器 (sessionMessages)
  const firstNode = selectedNodes.values().next().value!;
  const container = firstNode.closest('[class*="sessionMessages"]') as HTMLElement | null;
  if (!container) return;

  // 3. 判断是否混合角色
  const roles = new Set<string>();
  const session = state.chatSessions[sessionPath];
  if (session) {
    for (const item of session.items) {
      if (item.type !== 'message') continue;
      if (messageIds.includes(item.data.id)) roles.add(item.data.role);
    }
  }
  const isMixed = roles.size > 1;

  // 4. 临时隐藏：非选中消息 + 按钮 + 选中高亮
  injectHideStyle();
  document.body.classList.add(HIDE_CLASS);

  const hiddenElements: HTMLElement[] = [];
  const hiddenAvatars: HTMLElement[] = [];

  // 遍历容器的直接子元素，隐藏不在选中范围内的
  for (const child of Array.from(container.children) as HTMLElement[]) {
    const msgId = child.getAttribute('data-message-id');
    if (msgId && !messageIds.includes(msgId)) {
      child.classList.add('hana-ss-hide');
      hiddenElements.push(child);
    }
  }

  // 单方消息时隐藏头像行
  if (!isMixed) {
    for (const node of selectedNodes) {
      const avatarRow = node.querySelector('[class*="avatarRow"]') as HTMLElement | null;
      if (avatarRow && avatarRow.style.display !== 'none') {
        avatarRow.style.display = 'none';
        hiddenAvatars.push(avatarRow);
      }
    }
  }

  // 临时移除容器的 max-width 限制，让截图宽度由内容决定
  const origMaxWidth = container.style.maxWidth;
  // 不改 max-width，保持原始布局

  try {
    // 5. 对容器执行一次 html2canvas
    const scale = 2;
    const canvas = await html2canvas(container, {
      backgroundColor: null,
      useCORS: true,
      allowTaint: true,
      scale,
    });

    // 6. 加水印：在 canvas 底部追加
    const WATERMARK_H = 40 * scale;
    const PADDING_BOTTOM = 12 * scale;

    const final = document.createElement('canvas');
    final.width = canvas.width;
    final.height = canvas.height + WATERMARK_H;
    const ctx = final.getContext('2d')!;

    // 背景
    const bgColor = getComputedStyle(document.documentElement).getPropertyValue('--bg').trim() || '#faf8f5';
    ctx.fillStyle = bgColor;
    ctx.fillRect(0, 0, final.width, final.height);

    // 绘制截图内容
    ctx.drawImage(canvas, 0, 0);

    // 水印：圆形 logo + 宋体文字（居中）
    ctx.globalAlpha = 0.5;
    const serifFont = getComputedStyle(document.documentElement).getPropertyValue('--font-serif').trim() || 'serif';
    const wmY = canvas.height + WATERMARK_H / 2;
    const logoSize = 20 * scale;
    const gap = 8 * scale;

    ctx.font = `${12 * scale}px ${serifFont}`;
    const textW = ctx.measureText('OpenHanako').width;

    const logoImg = new Image();
    logoImg.crossOrigin = 'anonymous';
    const baseUrl = document.baseURI.replace(/\/[^/]*$/, '/');
    await new Promise<void>((resolve) => {
      logoImg.onload = () => resolve();
      logoImg.onerror = () => resolve();
      logoImg.src = `${baseUrl}assets/Hanako.png`;
    });

    const hasLogo = logoImg.naturalWidth > 0;
    const totalW = hasLogo ? logoSize + gap + textW : textW;
    const startX = (final.width - totalW) / 2;

    if (hasLogo) {
      ctx.save();
      ctx.beginPath();
      ctx.arc(startX + logoSize / 2, wmY, logoSize / 2, 0, Math.PI * 2);
      ctx.closePath();
      ctx.clip();
      ctx.drawImage(logoImg, startX, wmY - logoSize / 2, logoSize, logoSize);
      ctx.restore();
    }

    ctx.font = `${12 * scale}px ${serifFont}`;
    ctx.fillStyle = '#999';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    const textX = hasLogo ? startX + logoSize + gap : startX;
    ctx.fillText('OpenHanako', textX, wmY);
    ctx.globalAlpha = 1;

    // 7. 导出 & 保存
    const blob = await new Promise<Blob | null>((resolve) => final.toBlob(resolve, 'image/png'));
    if (!blob) throw new Error('canvas.toBlob returned null');

    const base64 = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve((reader.result as string).split(',')[1]);
      reader.onerror = () => reject(reader.error);
      reader.readAsDataURL(blob);
    });

    const homeFolder = state.homeFolder;
    const t = window.t ?? ((p: string) => p);
    let dir: string;
    if (homeFolder) {
      dir = `${homeFolder}/截图`;
    } else {
      dir = '~/Desktop/截图';
    }

    const now = new Date();
    const pad = (n: number) => String(n).padStart(2, '0');
    const timestamp = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
    const filePath = `${dir}/hanako-${timestamp}.png`;

    const hana = (window as any).hana;
    if (!hana?.writeFileBinary) {
      state.addToast(t('common.screenshotFailed'), 'error');
      return;
    }

    const ok = await hana.writeFileBinary(filePath, base64);
    if (ok) {
      state.addToast(t('common.screenshotSaved').replace('{path}', filePath), 'success', 4000);
    } else {
      state.addToast(`${t('common.screenshotFailed')}: write failed → ${filePath}`, 'error', 8000);
    }
  } catch (err: any) {
    console.error('[screenshot]', err);
    const t = window.t ?? ((p: string) => p);
    const detail = err?.message || String(err);
    state.addToast(`${t('common.screenshotFailed')}: ${detail}`, 'error', 8000);
  } finally {
    // 恢复所有临时隐藏
    document.body.classList.remove(HIDE_CLASS);
    for (const el of hiddenElements) el.classList.remove('hana-ss-hide');
    for (const el of hiddenAvatars) el.style.display = '';
  }
}
