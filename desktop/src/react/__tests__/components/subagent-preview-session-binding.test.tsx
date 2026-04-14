/**
 * @vitest-environment jsdom
 */

import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import { useStore } from '../../stores/index';
import { SubagentSessionPreview } from '../../components/chat/SubagentSessionPreview';
import { loadMessages } from '../../stores/session-actions';
import { dispatchStreamKey } from '../../services/stream-key-dispatcher';

vi.mock('../../stores/session-actions', async () => {
  const actual = await vi.importActual<typeof import('../../stores/session-actions')>('../../stores/session-actions');
  return {
    ...actual,
    loadMessages: vi.fn(async () => {}),
  };
});

const mockedLoadMessages = vi.mocked(loadMessages);

function makeScrollContainerRef() {
  const el = document.createElement('div');
  Object.defineProperty(el, 'scrollHeight', { configurable: true, value: 640 });
  Object.defineProperty(el, 'clientHeight', { configurable: true, value: 260 });
  Object.defineProperty(el, 'scrollTop', { configurable: true, writable: true, value: 0 });
  return { current: el };
}

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe('SubagentSessionPreview session binding', () => {
  beforeEach(() => {
    mockedLoadMessages.mockClear();
    useStore.setState({
      currentSessionPath: '/session/current',
      userName: 'USER SELF',
      userAvatarUrl: '/mock-user-avatar.png',
      agentName: 'Hanako',
      agentYuan: 'hanako',
      agents: [
        { id: 'butter', name: 'butter', yuan: 'neko', hasAvatar: false },
      ],
      chatSessions: {},
      subagentPreviewByTaskId: {
        'task-a': {
          open: true,
          sessionPath: '/session/subagent',
          loading: false,
          loadedOnce: false,
        },
      },
    } as never);
  });

  it('只按显式 subagent sessionPath 加载消息，不读取 currentSessionPath', async () => {
    render(<SubagentSessionPreview taskId="task-a" sessionPath="/session/subagent" streamStatus="running" scrollContainerRef={makeScrollContainerRef()} />);

    await waitFor(() => {
      expect(mockedLoadMessages).toHaveBeenCalledWith('/session/subagent');
    });
    expect(mockedLoadMessages).not.toHaveBeenCalledWith('/session/current');
  });

  it('sessionPath 未就绪时显示占位态，且不触发加载', () => {
    render(<SubagentSessionPreview taskId="task-a" sessionPath={null} streamStatus="running" scrollContainerRef={makeScrollContainerRef()} />);

    expect(screen.getByText('正在连接 subagent session...')).toBeTruthy();
    expect(mockedLoadMessages).not.toHaveBeenCalled();
  });

  it('已缓存的 subagent session 复用聊天正文渲染，而不是输出原始 HTML 字面量', () => {
    useStore.setState({
      chatSessions: {
        '/session/subagent': {
          items: [
            { type: 'message', data: { id: 'u-1', role: 'user', text: 'hello', textHtml: '<p>hello</p>' } },
            {
              type: 'message',
              data: {
                id: 'a-1',
                role: 'assistant',
                blocks: [{ type: 'text', html: '<p>Rendered assistant text</p>' }],
              },
            },
          ],
          hasMore: false,
          loadingMore: false,
        },
      },
    } as never);

    render(<SubagentSessionPreview taskId="task-a" sessionPath="/session/subagent" streamStatus="done" scrollContainerRef={makeScrollContainerRef()} />);

    expect(screen.getByText('hello')).toBeTruthy();
    expect(screen.getByText('Rendered assistant text')).toBeTruthy();
    expect(screen.queryByText('<p>Rendered assistant text</p>')).toBeNull();
    expect(mockedLoadMessages).not.toHaveBeenCalled();
  });

  it('subagent preview 不显示静态标题，也不把 synthetic prompt 渲染成真实用户身份', () => {
    useStore.setState({
      chatSessions: {
        '/session/subagent': {
          items: [
            {
              type: 'message',
              data: {
                id: 'u-1',
                role: 'user',
                text: 'synthetic prompt',
                textHtml: '<p>synthetic prompt</p>',
              },
            },
          ],
          hasMore: false,
          loadingMore: false,
        },
      },
    } as never);

    render(<SubagentSessionPreview taskId="task-a" sessionPath="/session/subagent" streamStatus="done" scrollContainerRef={makeScrollContainerRef()} />);

    expect(screen.getByText('synthetic prompt')).toBeTruthy();
    expect(screen.queryByText('SUBAGENT SESSION')).toBeNull();
    expect(screen.queryByText('USER SELF')).toBeNull();
    expect(screen.queryByAltText('USER SELF')).toBeNull();
  });

  it('跨 agent 的 preview 使用显式 subagent agentId，而不是回退到当前全局 agent', () => {
    useStore.setState({
      chatSessions: {
        '/session/subagent': {
          items: [
            {
              type: 'message',
              data: {
                id: 'a-1',
                role: 'assistant',
                blocks: [{ type: 'text', html: '<p>Rendered assistant text</p>' }],
              },
            },
          ],
          hasMore: false,
          loadingMore: false,
        },
      },
    } as never);

    render(
      <SubagentSessionPreview
        taskId="task-a"
        sessionPath="/session/subagent"
        agentId="butter"
        streamStatus="done"
        scrollContainerRef={makeScrollContainerRef()}
      />,
    );

    expect(screen.getByText('butter')).toBeTruthy();
    expect(screen.queryByText('Hanako')).toBeNull();
  });

  it('运行中的空壳 session 会持续重试，直到首条会话内容出现', async () => {
    vi.useFakeTimers();
    let attempts = 0;
    mockedLoadMessages.mockImplementation(async (path?: string) => {
      attempts += 1;
      if (attempts < 4) {
        useStore.setState({
          chatSessions: {
            '/session/subagent': {
              items: [],
              hasMore: false,
              loadingMore: false,
            },
          },
        } as never);
        return;
      }

      useStore.setState({
        chatSessions: {
          '/session/subagent': {
            items: [
              {
                type: 'message',
                data: {
                  id: 'a-1',
                  role: 'assistant',
                  blocks: [{ type: 'text', html: '<p>Loaded after retry</p>' }],
                },
              },
            ],
            hasMore: false,
            loadingMore: false,
          },
        },
      } as never);
      expect(path).toBe('/session/subagent');
    });

    const scrollContainerRef = makeScrollContainerRef();
    render(<SubagentSessionPreview taskId="task-a" sessionPath="/session/subagent" streamStatus="running" scrollContainerRef={scrollContainerRef} />);

    await act(async () => {});
    expect(mockedLoadMessages).toHaveBeenCalledTimes(1);

    for (let i = 0; i < 3; i += 1) {
      await act(async () => {
        await vi.advanceTimersByTimeAsync(850);
      });
    }
    await act(async () => {
      await vi.runOnlyPendingTimersAsync();
    });

    expect(mockedLoadMessages).toHaveBeenCalledTimes(4);
    expect(screen.getByText('Loaded after retry')).toBeTruthy();
  });

  it('运行中的 subagent preview 会直接消费 child session 的流式增量，而不是等落盘后才显示', async () => {
    mockedLoadMessages.mockImplementation(async () => {
      useStore.setState({
        chatSessions: {
          '/session/subagent': {
            items: [
              {
                type: 'message',
                data: {
                  id: 'u-1',
                  role: 'user',
                  text: 'synthetic prompt',
                  textHtml: '<p>synthetic prompt</p>',
                },
              },
            ],
            hasMore: false,
            loadingMore: false,
          },
        },
      } as never);
    });

    render(
      <SubagentSessionPreview
        taskId="task-a"
        sessionPath="/session/subagent"
        streamStatus="running"
        scrollContainerRef={makeScrollContainerRef()}
      />,
    );

    await act(async () => {});
    expect(screen.getByText('synthetic prompt')).toBeTruthy();

    act(() => {
      dispatchStreamKey('/session/subagent', { type: 'thinking_start', sessionPath: '/session/subagent' });
      dispatchStreamKey('/session/subagent', { type: 'thinking_delta', sessionPath: '/session/subagent', delta: '思考中' });
      dispatchStreamKey('/session/subagent', { type: 'text_delta', sessionPath: '/session/subagent', delta: '第一句' });
      dispatchStreamKey('/session/subagent', { type: 'text_delta', sessionPath: '/session/subagent', delta: ' 已经来了' });
    });

    expect(screen.getByText('第一句 已经来了')).toBeTruthy();
  });
});
