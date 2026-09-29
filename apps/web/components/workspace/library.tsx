'use client';
import { PageHeading } from '@/components/ui/page-heading';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState, type FormEvent } from 'react';
import { apiRequest, type Conversation, type SavedPrompt } from '@/lib/api';
import { useFeedback } from '@/components/ui/feedback-modal';
import { Modal } from '@/components/ui/modal';
import { ResourceState } from '@/components/ui/resource-state';
import { useWorkspaceResource } from './use-workspace-resource';

export function Conversations() {
  const [query, setQuery] = useState('');
  const resource = useWorkspaceResource<Conversation[]>(
    `/workspace/conversations?q=${encodeURIComponent(query)}`,
    200,
  );
  const { alert, confirm } = useFeedback();
  const [editing, setEditing] = useState<Conversation>();
  const [title, setTitle] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  async function change(item: Conversation, remove = false) {
    if (busy || (!remove && !title.trim())) return;
    if (
      remove &&
      !(await confirm({
        title: 'Delete conversation?',
        message:
          'This removes the conversation and its attached files. This action cannot be undone.',
        confirmLabel: 'Delete conversation',
        destructive: true,
      }))
    )
      return;
    setBusy(true);
    setError('');
    try {
      await apiRequest(`/workspace/conversations/${item.id}`, {
        accessToken: resource.accessToken!,
        method: remove ? 'DELETE' : 'PATCH',
        ...(remove ? {} : { body: JSON.stringify({ title: title.trim() }) }),
      });
      setEditing(undefined);
      resource.refresh();
      alert({
        tone: 'success',
        title: remove ? 'Conversation deleted' : 'Conversation renamed',
        message: remove
          ? 'The conversation and its files were removed.'
          : 'Your conversation title was updated.',
      });
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="content-page">
      <PageHeading
        title="Conversations"
        description="Pick up where you left off."
      >
        <Link href="/chat" className="primary-button">
          Start a chat
        </Link>
      </PageHeading>
      <div className="list-toolbar">
        <input
          type="search"
          aria-label="Search conversations"
          placeholder="Search conversations"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        {query && <button onClick={() => setQuery('')}>Clear search</button>}
      </div>
      {error && !editing && (
        <p className="error-banner" role="alert">
          {error}
        </p>
      )}
      <ResourceState
        {...resource}
        empty={!resource.data?.length}
        onRetry={resource.refresh}
      >
        <h2>{query ? 'No matching conversations' : 'No conversations yet'}</h2>
        <p>
          {query
            ? 'Try a different search or clear the filter.'
            : 'Start a chat and it will appear here automatically.'}
        </p>
      </ResourceState>
      {!resource.loading &&
        resource.data?.map((item) => (
          <div className="row library-item" key={item.id}>
            <div>
              <Link href={`/chat?id=${item.id}`}>
                <strong>{item.title}</strong>
              </Link>
              {item.updatedAt && (
                <p className="muted">
                  Updated {new Date(item.updatedAt).toLocaleDateString()}
                </p>
              )}
            </div>
            <div className="row-actions">
              <button
                disabled={busy}
                onClick={() => {
                  setError('');
                  setTitle(item.title);
                  setEditing(item);
                }}
              >
                Rename
              </button>
              <button disabled={busy} onClick={() => void change(item, true)}>
                Delete
              </button>
            </div>
          </div>
        ))}
      <Modal
        open={Boolean(editing)}
        title="Rename conversation"
        description="Choose a name that will be easy to find later."
        onClose={() => {
          if (!busy) setEditing(undefined);
        }}
      >
        <form
          className="editor-form"
          onSubmit={(e) => {
            e.preventDefault();
            if (editing) void change(editing);
          }}
        >
          <label>
            Conversation name
            <input
              required
              maxLength={160}
              value={title}
              disabled={busy}
              onChange={(e) => setTitle(e.target.value)}
            />
          </label>
          {error && (
            <p className="error-banner" role="alert">
              {error}
            </p>
          )}
          <div className="form-actions">
            <button
              type="button"
              className="secondary-button"
              disabled={busy}
              onClick={() => setEditing(undefined)}
            >
              Cancel
            </button>
            <button className="primary-button" disabled={busy || !title.trim()}>
              {busy ? 'Saving…' : 'Save name'}
            </button>
          </div>
        </form>
      </Modal>
    </div>
  );
}

export function SavedPrompts() {
  const resource = useWorkspaceResource<SavedPrompt[]>(
    '/workspace/saved-prompts',
  );
  const { alert, confirm } = useFeedback();
  const router = useRouter();
  const [query, setQuery] = useState('');
  const [editing, setEditing] = useState<SavedPrompt | 'new'>();
  const [title, setTitle] = useState('');
  const [content, setContent] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  function edit(item: SavedPrompt | 'new') {
    setError('');
    setTitle(item === 'new' ? '' : item.title);
    setContent(item === 'new' ? '' : item.content);
    setEditing(item);
  }
  async function save(e: FormEvent) {
    e.preventDefault();
    if (!editing || busy || !title.trim() || !content.trim()) return;
    setBusy(true);
    setError('');
    try {
      await apiRequest(
        `/workspace/saved-prompts${editing === 'new' ? '' : `/${editing.id}`}`,
        {
          accessToken: resource.accessToken!,
          method: editing === 'new' ? 'POST' : 'PATCH',
          body: JSON.stringify({ title: title.trim(), content }),
        },
      );
      setEditing(undefined);
      resource.refresh();
      alert({
        tone: 'success',
        title: editing === 'new' ? 'Prompt saved' : 'Prompt updated',
        message: 'Your prompt is ready to use in chat.',
      });
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function remove(item: SavedPrompt) {
    if (
      busy ||
      !(await confirm({
        title: 'Delete saved prompt?',
        message: `Remove “${item.title}” from your library?`,
        confirmLabel: 'Delete prompt',
        destructive: true,
      }))
    )
      return;
    setBusy(true);
    setError('');
    try {
      await apiRequest(`/workspace/saved-prompts/${item.id}`, {
        accessToken: resource.accessToken!,
        method: 'DELETE',
      });
      resource.refresh();
      alert({
        tone: 'success',
        title: 'Prompt deleted',
        message: 'The saved prompt was removed from your library.',
      });
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  const items =
    resource.data?.filter((item) =>
      `${item.title} ${item.content}`
        .toLowerCase()
        .includes(query.toLowerCase()),
    ) ?? [];
  return (
    <div className="content-page">
      <PageHeading
        title="Saved Prompts"
        description="Reusable instructions, private to you."
      >
        <button className="primary-button" onClick={() => edit('new')}>
          New prompt
        </button>
      </PageHeading>
      <div className="list-toolbar">
        <input
          type="search"
          aria-label="Search saved prompts"
          placeholder="Search names or instructions"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        {query && <button onClick={() => setQuery('')}>Clear search</button>}
      </div>
      {error && !editing && (
        <p className="error-banner" role="alert">
          {error}
        </p>
      )}
      <ResourceState
        {...resource}
        empty={!items.length}
        onRetry={resource.refresh}
      >
        <h2>{query ? 'No matching prompts' : 'Save your first prompt'}</h2>
        <p>
          {query
            ? 'Try a different search or clear the filter.'
            : 'Save instructions you use often, then insert them into any new chat.'}
        </p>
      </ResourceState>
      {!resource.loading &&
        items.map((item) => (
          <article className="row library-item" key={item.id}>
            <div>
              <h2>{item.title}</h2>
              <p className="muted prompt-preview">
                {item.content.length > 240
                  ? `${item.content.slice(0, 240)}…`
                  : item.content}
              </p>
            </div>
            <div className="row-actions">
              <button
                className="secondary-button"
                onClick={() => {
                  sessionStorage.setItem('nextfi-insert-prompt', item.content);
                  router.push('/chat');
                }}
              >
                Insert into chat
              </button>
              <button disabled={busy} onClick={() => edit(item)}>
                Edit
              </button>
              <button disabled={busy} onClick={() => void remove(item)}>
                Delete
              </button>
            </div>
          </article>
        ))}
      <Modal
        open={Boolean(editing)}
        title={editing === 'new' ? 'New prompt' : 'Edit prompt'}
        description="Give your instructions a recognizable name."
        onClose={() => {
          if (!busy) setEditing(undefined);
        }}
      >
        <form className="editor-form" onSubmit={save}>
          <label>
            Name
            <input
              required
              maxLength={160}
              value={title}
              disabled={busy}
              onChange={(e) => setTitle(e.target.value)}
            />
          </label>
          <label>
            Instructions
            <textarea
              required
              rows={7}
              value={content}
              disabled={busy}
              onChange={(e) => setContent(e.target.value)}
            />
          </label>
          {error && (
            <p className="error-banner" role="alert">
              {error}
            </p>
          )}
          <div className="form-actions">
            <button
              type="button"
              className="secondary-button"
              disabled={busy}
              onClick={() => setEditing(undefined)}
            >
              Cancel
            </button>
            <button
              className="primary-button"
              disabled={busy || !title.trim() || !content.trim()}
            >
              {busy
                ? 'Saving…'
                : editing === 'new'
                  ? 'Save prompt'
                  : 'Save changes'}
            </button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
