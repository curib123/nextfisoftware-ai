'use client';
import { useEffect, useEffectEvent, useRef, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { useAuth } from '@/components/providers/auth-provider';
import {
  apiRequest,
  getApiBaseUrl,
  type Model,
  type Message,
  type Conversation,
  type ChatFile,
  type SavedPrompt,
  type Usage,
} from '@/lib/api';
import { GeneratedImage } from './generated-image';
import type { Project } from './projects';
import { BrandMark } from '@/components/brand/brand-mark';
import {
  ModelSourceBadge,
  ProviderIcon,
  providerNames,
} from '@/components/brand/provider-icon';
import { useSiteSettings } from '@/components/providers/site-settings-provider';
import { Icon } from '@/components/ui/icon';
import { Modal } from '@/components/ui/modal';
import { starterTasks } from '@/components/brand/landing';
import type { Preferences } from './preferences';

function availableCapabilities(model?: Model) {
  if (!model) return [];
  return model.capabilities.filter(
    (capability) => model.capabilityStates?.[capability] !== 'UNAVAILABLE',
  );
}
export function Chat() {
  const { accessToken, user } = useAuth();
  const { settings } = useSiteSettings();
  const router = useRouter();
  const params = useSearchParams();
  const id = params.get('id');
  const newChat = params.get('new');
  const requestedModel = params.get('model');
  const [catalog, setCatalog] = useState<Model[] | null>(null);
  const [catalogError, setCatalogError] = useState(false);
  const [availabilityAttempt, setAvailabilityAttempt] = useState(0);
  const [selectionNotice, setSelectionNotice] = useState('');
  const [projects, setProjects] = useState<Project[]>([]);
  const [projectId, setProjectId] = useState(params.get('project') ?? '');
  const [preferences, setPreferences] = useState<Preferences>();
  const createdNavigation = useRef<string | null>(null);
  const modelChosenByUser = useRef(false);
  const [selectedFiles, setSelectedFiles] = useState<string[]>([]);
  const [feature, setFeature] = useState<'chat' | 'image_generation'>('chat');
  const [preferByok, setPreferByok] = useState(false);
  const [models, setModels] = useState<Model[]>([]);
  const [selected, setSelected] = useState('AUTO');
  const [messages, setMessages] = useState<Message[]>([]);
  const [files, setFiles] = useState<ChatFile[]>([]);
  const [optionsOpen, setOptionsOpen] = useState(false);
  const [prompts, setPrompts] = useState<SavedPrompt[]>([]);
  const [usage, setUsage] = useState<Usage>();
  const [text, setText] = useState('');
  const [title, setTitle] = useState('New conversation');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const abort = useRef<AbortController | null>(null);
  const viewVersion = useRef(0);
  const previousView = useRef<string | null>(null);
  const loadConversation = useEffectEvent((conversationId: string) =>
    apiRequest<Conversation & { messages: Message[]; attachments: ChatFile[] }>(
      `/workspace/conversations/${conversationId}`,
      { accessToken: accessToken! },
    ),
  );
  const bottom = useRef<HTMLDivElement>(null);
  const upload = useRef<HTMLInputElement>(null);
  const composer = useRef<HTMLTextAreaElement>(null);
  const modelPicker = useRef<HTMLDetailsElement>(null);
  const selectedWorkspaceModel =
    selected === 'AUTO'
      ? undefined
      : models.find((model) => model.id === selected);
  const useByok = Boolean(
    selectedWorkspaceModel?.byokAvailable &&
      (preferByok || selectedWorkspaceModel.planAvailable !== true),
  );
  const allowance = useByok
    ? usage?.byokAllowance
    : usage?.allowances.find((a) => a.bucket === selected);
  const chatAvailable =
    catalog !== null &&
    !catalogError &&
    (selected === 'AUTO'
      ? catalog.some(
          (model) => model.available !== false && model.autoAvailable !== false,
        )
      : Boolean(selectedWorkspaceModel));
  const allowanceExhausted =
    allowance?.dailyRemaining === 0 ||
    allowance?.monthlyRemaining === 0 ||
    (!useByok && usage?.credits?.remaining === 0);
  const creditPrice = useByok
    ? 0
    : allowance?.creditCosts
      ? allowance.creditCosts[feature]
      : 1;
  const canAfford = (price: number | null) =>
    useByok ||
    (price !== null && (!usage?.credits || usage.credits.remaining >= price));
  const selectedCapabilities = availableCapabilities(selectedWorkspaceModel);
  const acceptsPdf =
    selected === 'AUTO' || selectedCapabilities.includes('files');
  const acceptsImage =
    selected === 'AUTO' || selectedCapabilities.includes('vision');
  const acceptsFile = (mime: string) =>
    mime === 'application/pdf'
      ? acceptsPdf
      : mime.startsWith('image/')
        ? acceptsImage
        : mime === 'text/plain';
  const attachmentsValid =
    selectedFiles.length <= (allowance?.maxFiles ?? 0) &&
    files
      .filter((file) => selectedFiles.includes(file.id))
      .every((file) => acceptsFile(file.mimeType));
  const canSend =
    chatAvailable &&
    Boolean(allowance) &&
    !allowanceExhausted &&
    canAfford(creditPrice) &&
    attachmentsValid;
  const canAttach = Boolean(accessToken && allowance?.maxFiles);
  const canGenerateImage =
    allowance?.allowedFeatures?.includes('image_generation') &&
    (!allowance.creditCosts ||
      allowance.creditCosts.image_generation !== null) &&
    (selected === 'AUTO' ||
      availableCapabilities(
        models.find((model) => model.id === selected),
      ).includes('image_generation'));
  const activeProject = projects.find((project) => project.id === projectId);
  const selectableModelIds = new Set(models.map((model) => model.id));
  const visibleModels = (catalog ?? []).filter(
    (model) => model.enabled !== false && !model.maintenance,
  );
  const visibleProviders = [...new Set(visibleModels.map((model) => model.provider))];
  const selectedModel = selectedWorkspaceModel;
  const autoLabel =
    usage?.plan?.toLowerCase() === 'free'
      ? 'Auto · Free AI'
      : 'Auto · Recommended';

  function closeModelPicker() {
    modelPicker.current?.removeAttribute('open');
  }

  function chooseModel(modelId: string) {
    modelChosenByUser.current = true;
    setSelectionNotice('');
    setSelected(modelId);
    setPreferByok(false);
    setFeature('chat');
    closeModelPicker();
  }

  function openUpgrade(model: Model) {
    closeModelPicker();
    router.push(
      `/billing?unlockModel=${encodeURIComponent(model.displayName)}&modelId=${encodeURIComponent(model.id)}`,
    );
  }
  useEffect(() => {
    const controller = new AbortController();
    void apiRequest<Model[]>('/catalog/models', { signal: controller.signal })
      .then((data) => {
        setCatalog(data);
        setCatalogError(false);
      })
      .catch(() => {
        if (!controller.signal.aborted) setCatalogError(true);
      });
    return () => controller.abort();
  }, [availabilityAttempt]);
  async function refresh() {
    if (!accessToken) return;
    const options = { accessToken };
    const [m, u, p] = await Promise.all([
      apiRequest<Model[]>('/workspace/models', options),
      apiRequest<Usage>('/workspace/usage', options),
      apiRequest<SavedPrompt[]>('/workspace/saved-prompts', options),
    ]);
    setModels(m);
    setUsage(u);
    setPrompts(p);
  }
  useEffect(() => {
    if (!accessToken) return;
    void apiRequest<Project[]>('/workspace/projects', { accessToken })
      .then(setProjects)
      .catch((e) => setError(e.message));
    // Hydrate the workspace from the authenticated API.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void refresh().catch((e) => setError(e.message));
    void apiRequest<Preferences>('/workspace/preferences', { accessToken })
      .then(setPreferences)
      .catch((e) => setError(e.message));
  }, [accessToken, availabilityAttempt]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (createdNavigation.current === id && id) {
      createdNavigation.current = null;
      return;
    }
    viewVersion.current += 1;
    abort.current?.abort();
    abort.current = null;
    // A route change starts a separate conversation, including a second New Chat click.
    setBusy(false);
    const view = `${user?.id ?? ''}:${id ?? ''}:${newChat ?? ''}`;
    if (previousView.current !== view) {
      setText('');
      previousView.current = view;
    }
    setFeature('chat');
    setOptionsOpen(false);
    setSelectionNotice('');
    const inserted = sessionStorage.getItem('vrompt-insert-prompt');
    // Synchronize a prompt handed off through browser session storage.
    if (inserted) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setText(inserted);
      sessionStorage.removeItem('vrompt-insert-prompt');
    }
    let current = true;
    modelChosenByUser.current = false;
    setError('');
    setSelected('AUTO');
    setMessages([]);
    setFiles([]);
    setSelectedFiles([]);
    if (!id) {
      setProjectId(params.get('project') ?? '');
      setTitle('New conversation');
      return;
    }
    if (!user) return;
    void loadConversation(id)
      .then((c) => {
        if (current) {
          setMessages(c.messages);
          setFiles(c.attachments);
          setSelectedFiles([]);
          setProjectId(c.projectId ?? '');
          setTitle(c.title);
        }
      })
      .catch((e) => {
        if (current) setError(e.message);
      });
    return () => {
      current = false;
    };
  }, [id, newChat, user?.id]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    // A direct model link is an explicit selection; otherwise every new chat is Auto.
    if (
      !id &&
      !createdNavigation.current &&
      !modelChosenByUser.current &&
      preferences &&
      catalog
    ) {
      setSelected(
        requestedModel === 'AUTO'
          ? 'AUTO'
          : models.some((model) => model.id === requestedModel)
            ? requestedModel!
            : 'AUTO',
      );
      if (
        requestedModel &&
        requestedModel !== 'AUTO' &&
        !models.some((model) => model.id === requestedModel)
      ) {
        const requested = catalog.find((model) => model.id === requestedModel);
        // The notice mirrors a URL model request after catalog data arrives.
        // eslint-disable-next-line react-hooks/set-state-in-effect
        setSelectionNotice(
          requested?.available === false
            ? `${requested.displayName} is temporarily unavailable. You can keep your draft and try again later.`
            : 'This model is not included in your current allowance. Start with Auto or compare upgrade options.',
        );
      } else setSelectionNotice('');
    }
  }, [id, newChat, preferences, models, requestedModel, catalog]);
  useEffect(() => {
    if (messages.length) bottom.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);
  useEffect(() => {
    const element = composer.current;
    if (!element) return;
    element.style.height = 'auto';
    element.style.height = `${Math.min(Math.max(element.scrollHeight, 72), 220)}px`;
  }, [text]);
  useEffect(() => () => abort.current?.abort(), []);
  async function ensureConversation() {
    if (id) return id;
    const version = viewVersion.current;
    const c = await apiRequest<Conversation>('/workspace/conversations', {
      accessToken: accessToken!,
      method: 'POST',
      body: JSON.stringify({
        title: text.trim().slice(0, 80) || 'New conversation',
        projectId: projectId || null,
      }),
    });
    if (version !== viewVersion.current)
      throw new DOMException('Conversation changed', 'AbortError');
    createdNavigation.current = c.id;
    setTitle(c.title);
    router.replace(`/chat?id=${c.id}`);
    return c.id;
  }
  async function send(regenerate?: Message) {
    const requestFeature = regenerate
      ? regenerate.artifacts?.length
        ? 'image_generation'
        : 'chat'
      : feature;
    const requestCredits = allowance?.creditCosts
      ? allowance.creditCosts[requestFeature]
      : 1;
    if (
      abort.current ||
      !accessToken ||
      busy ||
      !chatAvailable ||
      !allowance ||
      allowanceExhausted ||
      !attachmentsValid ||
      !canAfford(requestCredits) ||
      (!text.trim() && !regenerate)
    )
      return;
    const version = viewVersion.current;
    setBusy(true);
    setError('');
    const content = regenerate ? 'Regenerate' : text.trim();
    const controller = new AbortController();
    abort.current = controller;
    let conversationId = id;
    try {
      conversationId = await ensureConversation();
      if (controller.signal.aborted) return;
      const response = await fetch(
        `${getApiBaseUrl()}/workspace/conversations/${conversationId}/messages`,
        {
          method: 'POST',
          credentials: 'include',
          headers: {
            Authorization: `Bearer ${accessToken}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            requestId: crypto.randomUUID(),
            content,
            attachmentIds: selectedFiles,
            feature: requestFeature,
            maxCredits: requestCredits,
            mode: useByok
              ? 'BYOK'
              : selected === 'AUTO'
                ? 'AUTO'
                : 'MANUAL',
            ...(selected !== 'AUTO' ? { modelId: selected } : {}),
            ...(regenerate ? { regenerateMessageId: regenerate.id } : {}),
          }),
          signal: controller.signal,
        },
      );
      if (!response.ok) {
        if (response.status === 401 && accessToken)
          window.dispatchEvent(
            new CustomEvent('vrompt:session-expired', { detail: accessToken }),
          );
        const body = await response.json();
        throw new Error(body.message ?? 'Unable to send message.');
      }
      if (!response.body) throw new Error('Streaming is unavailable.');
      setText('');
      setMessages((previous) => [
        ...previous,
        ...(!regenerate
          ? [{ id: 'sending-user', role: 'user', content, status: 'SUCCEEDED' }]
          : []),
        { id: 'streaming', role: 'assistant', content: '', status: 'RESERVED' },
      ]);
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      let completed = false;
      while (true) {
        const { value, done } = await reader.read();
        if (version !== viewVersion.current) return;
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        let boundary: number;
        while ((boundary = buffer.indexOf('\n\n')) >= 0) {
          const frame = buffer.slice(0, boundary);
          buffer = buffer.slice(boundary + 2);
          if (!frame.startsWith('data: ')) continue;
          const event = JSON.parse(frame.slice(6));
          if (event.type === 'artifact')
            setMessages((old) =>
              old.map((m) =>
                m.id === 'streaming'
                  ? {
                      ...m,
                      artifacts: [...(m.artifacts ?? []), event.artifact],
                    }
                  : m,
              ),
            );
          if (event.type === 'delta')
            setMessages((old) =>
              old.map((m) =>
                m.id === 'streaming'
                  ? { ...m, content: m.content + event.text }
                  : m,
              ),
            );
          if (event.type === 'model')
            setMessages((old) =>
              old.map((m) =>
                m.id === 'streaming'
                  ? { ...m, modelName: event.model, routingMode: event.mode }
                  : m,
              ),
            );
          if (event.type === 'error') setError(event.message);
          if (event.type === 'done') {
            completed = true;
            setUsage(event.usage);
            setMessages((old) =>
              old.map((m) =>
                m.id === 'streaming'
                  ? { ...m, status: event.status, id: event.messageId ?? m.id }
                  : m,
              ),
            );
          }
        }
      }
      if (!completed)
        throw new Error(
          'The connection ended before the response finished. Please retry.',
        );
    } catch (e) {
      if (version !== viewVersion.current) return;
      if (!(e instanceof DOMException && e.name === 'AbortError')) {
        const message =
          e instanceof Error ? e.message : 'Unable to send message.';
        setError(message);
      }
    } finally {
      if (version !== viewVersion.current) return;
      setBusy(false);
      abort.current = null;
      if (conversationId) {
        const c = await apiRequest<{
          messages: Message[];
          attachments: ChatFile[];
        }>(`/workspace/conversations/${conversationId}`, {
          accessToken: accessToken ?? undefined,
        }).catch(() => null);
        if (c && version === viewVersion.current) {
          setMessages(c.messages);
          setFiles(c.attachments);
        }
      }
      void refresh().catch(() => {});
    }
  }
  async function attach(file?: File) {
    if (!file || !accessToken || busy || !canAttach) return;
    setError('');
    if (selectedFiles.length >= (allowance?.maxFiles ?? 0)) {
      setError('Deselect a file before attaching another to this message.');
      return;
    }
    if (file.size > (allowance?.maxFileBytes ?? 0)) {
      setError('This file exceeds the selected plan’s file size limit.');
      return;
    }
    const uploadMime = /\.(txt|md|csv)$/i.test(file.name)
      ? 'text/plain'
      : file.type;
    if (!acceptsFile(uploadMime)) {
      setError(
        'This model does not support that file type. Choose Auto or a compatible model.',
      );
      return;
    }
    try {
      const conversationId = await ensureConversation();
      const body = new FormData();
      body.set('file', new File([file], file.name, { type: uploadMime }));
      const added = await apiRequest<ChatFile>(
        `/workspace/conversations/${conversationId}/files`,
        { accessToken, method: 'POST', body },
      );
      setFiles((old) => [...old.filter((f) => f.id !== added.id), added]);
      setSelectedFiles((old) => [...old, added.id]);
    } catch (e) {
      const message = e instanceof Error ? e.message : 'Upload failed.';
      setError(message);
    }
  }
  return (
    <div className="chat-page" data-empty={messages.length === 0}>
      {id && (
        <header className="chat-conversation-header">
          <h1>{title}</h1>
        </header>
      )}
      {selectionNotice && (
        <div className="service-notice">
          <div>
            <p>{selectionNotice}</p>
            <Link
              href={
                requestedModel && requestedModel !== 'AUTO'
                  ? `/billing?unlockModel=${encodeURIComponent(catalog?.find((model) => model.id === requestedModel)?.displayName ?? 'this model')}&modelId=${encodeURIComponent(requestedModel)}`
                  : '/billing'
              }
              className="text-link"
            >
              Compare plans <Icon name="arrow" />
            </Link>
          </div>
        </div>
      )}
      {(catalogError || (catalog !== null && !chatAvailable)) && (
        <div className="service-notice" role="status">
          <Icon name="chat" />
          <div>
            <strong>AI chat is temporarily unavailable.</strong>
            <p>
              You can write your next prompt, explore your workspace, and try
              again later. No credits are used while chat is unavailable.
            </p>
            <button
              className="text-link"
              onClick={() => setAvailabilityAttempt((value) => value + 1)}
            >
              Check availability
            </button>
          </div>
        </div>
      )}
      <div className="chat-scroll">
        {!messages.length ? (
          <section className="chat-intro" aria-labelledby="chat-greeting">
            <BrandMark className="chat-intro-mark" />
            <h1 id="chat-greeting">
              {user
                ? `Hello, ${preferences?.displayName || user.username}.`
                : 'How can I help?'}
            </h1>
            <p>Ask a question or start with an idea.</p>
            <div className="chat-starters" aria-label="Prompt suggestions">
              {starterTasks.map((task) => (
                <button
                  key={task.key}
                  title={task.detail}
                  onClick={() => {
                    setText(
                      String(
                        settings[`workspace.${task.key}Prompt`] ||
                          `Help me ${task.title.toLowerCase()}.`,
                      ),
                    );
                    composer.current?.focus();
                  }}
                >
                  <Icon name={task.icon} />
                  <span>{task.title}</span>
                </button>
              ))}
            </div>
          </section>
        ) : (
          <>
            {messages.map((m) => (
              <article className={`message ${m.role}`} key={m.id}>
                <p className="message-label">
                  {m.role === 'user'
                    ? 'You'
                    : `${m.routingMode === 'MANUAL' ? '' : 'Auto · '}${m.modelName ?? 'Nextfi Software'}`}
                </p>
                <pre>
                  {m.content ||
                    (m.artifacts?.length
                      ? ''
                      : m.status === 'RESERVED'
                        ? 'Thinking…'
                        : 'No response completed.')}
                </pre>
                {m.role === 'user' && (
                  <button
                    disabled={busy}
                    onClick={() => {
                      setText(m.content);
                      composer.current?.focus();
                    }}
                  >
                    Edit as new message
                  </button>
                )}
                {m.artifacts?.map((a) => (
                  <GeneratedImage key={a.id} file={a} />
                ))}
                {m.role === 'assistant' && m.status !== 'RESERVED' && (
                  <div className="message-actions">
                    {m.content && (
                      <button
                        onClick={() =>
                          void navigator.clipboard
                            .writeText(m.content)
                            .catch(() =>
                              setError(
                                'Clipboard unavailable. Select the response text to copy it.',
                              ),
                            )
                        }
                      >
                        Copy response
                      </button>
                    )}
                    <button
                      aria-label={
                        m.status === 'SUCCEEDED'
                          ? 'Regenerate'
                          : 'Retry response'
                      }
                      disabled={
                        busy ||
                        !accessToken ||
                        !chatAvailable ||
                        !allowance ||
                        allowanceExhausted ||
                        !canAfford(
                          allowance.creditCosts
                            ? allowance.creditCosts[
                                m.artifacts?.length
                                  ? 'image_generation'
                                  : 'chat'
                              ]
                            : 1,
                        )
                      }
                      title={
                        allowance?.creditCosts
                          ? `Retry: ${allowance.creditCosts[m.artifacts?.length ? 'image_generation' : 'chat'] ?? 'unavailable'} credits`
                          : undefined
                      }
                      onClick={() => void send(m)}
                    >
                      {m.status === 'SUCCEEDED'
                        ? 'Regenerate'
                        : 'Retry response'}
                      {allowance?.creditCosts &&
                        ` · ${allowance.creditCosts[m.artifacts?.length ? 'image_generation' : 'chat'] ?? 'Unavailable'} credits`}
                    </button>
                    {!['SUCCEEDED', 'RESERVED'].includes(m.status) && (
                      <span>{m.status.toLowerCase()}</span>
                    )}
                  </div>
                )}
              </article>
            ))}
          </>
        )}
        <div ref={bottom} />
      </div>
      <div className="composer-wrap">
        {!attachmentsValid && (
          <p role="alert">
            Deselect incompatible or excess files before sending, or choose a
            model that supports them.
          </p>
        )}
        {error && (
          <div className="error-banner" role="alert">
            {error}{' '}
            {selected !== 'AUTO' && (
              <button
                onClick={() => {
                  modelChosenByUser.current = true;
                  setSelected('AUTO');
                  setFeature('chat');
                  setError('');
                }}
              >
                Switch to Auto
              </button>
            )}
          </div>
        )}
        {(feature === 'image_generation' || activeProject) && (
          <div className="composer-context">
            {feature === 'image_generation' && (
              <span>
                <Icon name="cube" /> Generate image
              </span>
            )}
            {activeProject && (
              <span>
                <Icon name="folder" /> {activeProject.name}
              </span>
            )}
          </div>
        )}
        <div
          className="composer"
          onDragOver={(e) => e.preventDefault()}
          onDrop={(e) => {
            e.preventDefault();
            void attach(e.dataTransfer.files[0]);
          }}
        >
          {files.map((f) => (
            <span className="file-chip" key={f.id}>
              <input
                type="checkbox"
                aria-label={`Include ${f.name}`}
                checked={selectedFiles.includes(f.id)}
                disabled={
                  busy ||
                  (!selectedFiles.includes(f.id) &&
                    (selectedFiles.length >= (allowance?.maxFiles ?? 0) ||
                      !acceptsFile(f.mimeType)))
                }
                onChange={(e) =>
                  setSelectedFiles((old) =>
                    e.target.checked
                      ? [...old, f.id]
                      : old.filter((x) => x !== f.id),
                  )
                }
              />
              {f.name}
              <button
                aria-label={`Remove ${f.name}`}
                disabled={busy}
                onClick={() =>
                  void apiRequest(`/workspace/files/${f.id}`, {
                    accessToken: accessToken!,
                    method: 'DELETE',
                  })
                    .then(() => {
                      setFiles((old) => old.filter((x) => x.id !== f.id));
                      setSelectedFiles((old) => old.filter((x) => x !== f.id));
                    })
                    .catch((e) => setError(e.message))
                }
              >
                ×
              </button>
            </span>
          ))}
          <textarea
            ref={composer}
            className="composer-input"
            rows={1}
            aria-label="Message"
            aria-describedby="composer-status"
            placeholder={
              feature === 'image_generation'
                ? 'Describe the image you want to create…'
                : 'Message Nextfi Software…'
            }
            value={text}
            disabled={busy}
            onChange={(e) => setText(e.target.value)}
            onPaste={(e) => {
              const image = [...e.clipboardData.items]
                .find(
                  (item) =>
                    item.kind === 'file' && item.type.startsWith('image/'),
                )
                ?.getAsFile();
              if (image && canAttach) {
                e.preventDefault();
                void attach(image);
              }
            }}
            onKeyDown={(e) => {
              if (
                e.key === 'Enter' &&
                preferences?.sendOnEnter !== false &&
                !e.shiftKey &&
                !e.nativeEvent.isComposing
              ) {
                e.preventDefault();
                void send();
              }
            }}
          />
          <div className="composer-controls">
            <details className="composer-model-picker" ref={modelPicker}>
              <summary
                className="composer-model"
                aria-label="Choose AI model"
                aria-disabled={busy}
                onClick={(event) => {
                  if (busy) event.preventDefault();
                }}
              >
                <span className="composer-model-current">
                  {selected === 'AUTO' ? (
                    <>
                      <ProviderIcon provider="auto" />
                      <span>
                        <strong>{autoLabel}</strong>
                        <small>
                          {usage?.plan?.toLowerCase() === 'free'
                            ? 'Verified free endpoints + best-fit routing'
                            : 'Nextfi Software chooses an eligible model'}
                        </small>
                      </span>
                    </>
                  ) : (
                    <>
                      <ProviderIcon provider={selectedModel?.provider ?? 'auto'} />
                      <span>
                        <strong>{selectedModel?.displayName ?? 'Choose model'}</strong>
                        {selectedModel && (
                          <ModelSourceBadge
                            provider={selectedModel.provider}
                            source={selectedModel.source}
                          />
                        )}
                        <small>
                          {useByok
                            ? 'Using your API key · 0 Nextfi Software credits'
                            : selectedModel?.creditCosts?.chat != null
                              ? `${selectedModel.creditCosts.chat} ${selectedModel.creditCosts.chat === 1 ? 'credit' : 'credits'} per response`
                              : 'Included in your plan'}
                        </small>
                      </span>
                    </>
                  )}
                </span>
                <Icon name="chevronDown" className="composer-model-chevron" />
              </summary>

              <div className="composer-model-menu" role="listbox" aria-label="AI models">
                <button
                  type="button"
                  role="option"
                  aria-selected={selected === 'AUTO'}
                  className={`composer-model-option ${selected === 'AUTO' ? 'is-selected' : ''}`}
                  onClick={() => chooseModel('AUTO')}
                >
                  <ProviderIcon provider="auto" />
                  <span className="composer-model-option-copy">
                    <strong>{autoLabel}</strong>
                    <small>
                      {usage?.plan?.toLowerCase() === 'free'
                        ? 'Included · all verified free endpoints'
                        : 'Recommended · cost-aware routing'}
                    </small>
                  </span>
                  {selected === 'AUTO' && <Icon name="check" />}
                </button>

                {visibleProviders.map((provider) => (
                  <div className="composer-model-provider" key={provider}>
                    <p>{providerNames[provider.toLowerCase()] ?? provider}</p>
                    {visibleModels
                      .filter((model) => model.provider === provider)
                      .map((model) => {
                        const allowedModel = models.find(
                          (item) => item.id === model.id,
                        );
                        const selectable = selectableModelIds.has(model.id);
                        const byokOnly = Boolean(
                          allowedModel?.byokAvailable &&
                            allowedModel.planAvailable !== true,
                        );
                        const unavailable =
                          model.available === false && !allowedModel?.byokAvailable;
                        const includedFreeEndpoint = Boolean(
                          usage?.plan?.toLowerCase() === 'free' &&
                            allowedModel?.freeEndpoint &&
                            allowedModel.planAvailable &&
                            !unavailable,
                        );
                        const locked =
                          !selectable && !includedFreeEndpoint && !unavailable;
                        return (
                          <button
                            type="button"
                            role="option"
                            aria-selected={selected === model.id}
                            className={[
                              'composer-model-option',
                              selected === model.id ? 'is-selected' : '',
                              locked ? 'is-locked' : '',
                              unavailable ? 'is-unavailable' : '',
                            ]
                              .filter(Boolean)
                              .join(' ')}
                            key={model.id}
                            disabled={busy || unavailable}
                            onClick={() => {
                              if (locked) openUpgrade(model);
                              else chooseModel(model.id);
                            }}
                            aria-label={
                              locked
                                ? `${model.displayName}. Locked. View upgrade options.`
                                : unavailable
                                  ? `${model.displayName}. Temporarily unavailable.`
                                  : includedFreeEndpoint
                                    ? `${model.displayName}. Included in the Free plan.`
                                    : model.displayName
                            }
                          >
                            <ProviderIcon provider={model.provider} />
                            <span className="composer-model-option-copy">
                              <strong>{model.displayName}</strong>
                              <ModelSourceBadge
                                provider={model.provider}
                                source={model.source}
                              />
                              <small>
                                {locked
                                  ? 'Upgrade to unlock'
                                  : unavailable
                                    ? 'Temporarily unavailable'
                                    : byokOnly
                                      ? 'Using your API key · 0 Nextfi Software credits'
                                      : includedFreeEndpoint
                                        ? 'Verified free endpoint · Included in Free'
                                          : allowedModel?.creditCosts?.chat != null
                                            ? `${allowedModel.creditCosts.chat} ${allowedModel.creditCosts.chat === 1 ? 'credit' : 'credits'} per response`
                                            : 'Included in your plan'}
                              </small>
                            </span>
                            {locked ? (
                              <span className="model-lock-badge">
                                <Icon name="lock" /> Upgrade
                              </span>
                            ) : byokOnly ? (
                              <span className="model-included-badge">
                                <Icon name="check" /> Your API
                              </span>
                            ) : includedFreeEndpoint ? (
                              <span className="model-included-badge">
                                <Icon name="check" /> Free
                              </span>
                            ) : selected === model.id ? (
                              <Icon name="check" />
                            ) : unavailable ? (
                              <span className="model-unavailable-badge">Unavailable</span>
                            ) : null}
                          </button>
                        );
                      })}
                  </div>
                ))}
              </div>
            </details>
            {selected !== 'AUTO' &&
              selectedWorkspaceModel?.byokAvailable &&
              selectedWorkspaceModel.planAvailable === true && (
                <button
                  type="button"
                  className={`composer-byok-toggle ${useByok ? 'is-active' : ''}`}
                  disabled={busy}
                  onClick={() => setPreferByok((value) => !value)}
                  title={
                    useByok
                      ? 'Switch back to the Nextfi Software plan allowance'
                      : 'Use your connected provider API key for this model'
                  }
                >
                  {useByok ? 'Using my API' : 'Use my API'}
                </button>
              )}
            <div className="composer-actions">
              <input
                type="file"
                hidden
                ref={upload}
                accept={[
                  '.txt',
                  '.md',
                  '.csv',
                  ...(acceptsPdf ? ['.pdf'] : []),
                  ...(acceptsImage ? ['.png', '.jpg', '.jpeg'] : []),
                ].join(',')}
                onChange={(e) => {
                  void attach(e.target.files?.[0]);
                  e.target.value = '';
                }}
              />
              {canAttach && (
                <button
                  className="composer-attach"
                  aria-label="Attach a file"
                  title={`Attach up to ${allowance?.maxFiles} file(s) per message, ${Math.floor((allowance?.maxFileBytes ?? 0) / 1_000_000)} MB each`}
                  disabled={busy}
                  onClick={() => upload.current?.click()}
                >
                  <Icon name="attach" />
                </button>
              )}
              {accessToken && (
                <button
                  className="composer-options-button"
                  aria-label="Chat options"
                  aria-haspopup="dialog"
                  disabled={busy}
                  onClick={() => setOptionsOpen(true)}
                >
                  <Icon name="settings" /> <span>Options</span>
                </button>
              )}
              {busy ? (
                <button
                  className="secondary-button"
                  onClick={() => abort.current?.abort()}
                >
                  Stop
                </button>
              ) : (
                <button
                  className="primary-button"
                  disabled={!canSend || !text.trim()}
                  onClick={() => void send()}
                >
                  Send <Icon name="arrow" />
                </button>
              )}
            </div>
          </div>
        </div>
        <div className="composer-footer" id="composer-status">
          <span>
            {catalog === null && !catalogError
              ? 'Loading models…'
              : allowanceExhausted
                ? 'You’ve reached your usage limit.'
                : usage && !allowance
                  ? 'This model isn’t included in your plan.'
                  : allowance
                    ? creditPrice === null
                      ? 'Pricing for this task is not available yet.'
                      : !canAfford(creditPrice)
                        ? `This response needs ${creditPrice} credits. You have ${usage?.credits?.remaining ?? 0}.`
                        : `${creditPrice} ${creditPrice === 1 ? 'credit' : 'credits'} per response · ${allowance.dailyRemaining} ${allowance.dailyRemaining === 1 ? 'message' : 'messages'} left today`
                    : 'Checking your allowance…'}
            {accessToken && <Link href="/usage">View usage</Link>}
            {usage?.credits && (
              <span className="composer-credit-balance">
                {usage.credits.remaining}{' '}
                {usage.credits.remaining === 1 ? 'credit' : 'credits'} left this
                month
              </span>
            )}
          </span>
          <span className="composer-keyboard-hint">
            {preferences?.sendOnEnter === false
              ? 'Use Send to submit'
              : 'Enter to send · Shift + Enter for a new line'}
          </span>
        </div>
      </div>
      <Modal
        open={optionsOpen}
        onClose={() => setOptionsOpen(false)}
        title="Chat options"
        description="Choose a task, organize this chat, or reuse a saved prompt."
        className="chat-options-dialog"
      >
        <div className="chat-option-fields">
          <p className="muted">
            {canAttach
              ? `Select up to ${allowance?.maxFiles} file(s) per message, up to ${Math.floor((allowance?.maxFileBytes ?? 0) / 1_000_000)} MB each. `
              : 'File uploads are unavailable on this selection. '}
            Images require a compatible model.{' '}
            <Link href="/docs">File and storage limits</Link>
          </p>
          <label>
            Task
            <select
              aria-label="Choose task"
              value={feature}
              disabled={busy}
              onChange={(e) =>
                setFeature(e.target.value as 'chat' | 'image_generation')
              }
            >
              <option value="chat">Chat</option>
              <option value="image_generation" disabled={!canGenerateImage}>
                Generate image
              </option>
            </select>
            {!canGenerateImage && (
              <small>
                Image generation is unavailable for this model or plan.
              </small>
            )}
            {canGenerateImage && (
              <small>
                One image per response, up to 10 MB. The displayed image credit
                price applies.
              </small>
            )}
          </label>
          <label>
            Project
            <select
              value={projectId}
              disabled={busy}
              onChange={async (e) => {
                const next = e.target.value;
                try {
                  if (id)
                    await apiRequest(`/workspace/conversations/${id}`, {
                      accessToken: accessToken!,
                      method: 'PATCH',
                      body: JSON.stringify({ projectId: next || null }),
                    });
                  setProjectId(next);
                } catch (e) {
                  setError((e as Error).message);
                  setOptionsOpen(false);
                }
              }}
            >
              <option value="">Personal workspace</option>
              {projects
                .filter(
                  (project) => !project.archived || project.id === projectId,
                )
                .map((project) => (
                  <option
                    key={project.id}
                    value={project.id}
                    disabled={project.archived}
                  >
                    {project.name}
                    {project.archived ? ' (archived)' : ''}
                  </option>
                ))}
            </select>
          </label>
          <label>
            Saved prompt
            <select
              aria-label="Insert saved prompt"
              value=""
              disabled={!prompts.length || busy}
              onChange={(e) => {
                const prompt = prompts.find(
                  (prompt) => prompt.id === e.target.value,
                );
                if (!prompt) return;
                setText((old) => `${old}${old ? '\n' : ''}${prompt.content}`);
                setOptionsOpen(false);
                requestAnimationFrame(() => composer.current?.focus());
              }}
            >
              <option value="">
                {prompts.length
                  ? 'Choose a saved prompt'
                  : 'No saved prompts yet'}
              </option>
              {prompts.map((prompt) => (
                <option key={prompt.id} value={prompt.id}>
                  {prompt.title}
                </option>
              ))}
            </select>
            {!prompts.length && (
              <Link href="/saved-prompts">Create a saved prompt</Link>
            )}
          </label>
        </div>
      </Modal>
    </div>
  );
}
