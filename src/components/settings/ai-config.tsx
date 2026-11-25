'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import {
  Loader2,
  KeyRound,
  ExternalLink,
  CheckCircle2,
  Trash2,
  Eye,
  EyeOff,
} from 'lucide-react';
import { useAuth } from '@/hooks/use-auth';
import { canEditSettings } from '@/lib/auth/roles';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Switch } from '@/components/ui/switch';
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from '@/components/ui/card';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { SettingsPanelHead } from './settings-panel-head';
import { AiKnowledgeCard } from './ai-knowledge';
import { AI_PROVIDER_DEFAULT_MODEL } from '@/lib/ai/defaults';
import type { AiProvider } from '@/lib/ai/types';
import { createClient } from '@/lib/supabase/client';
import type { AccountMember } from '@/types';
import { fetchAccountMembers, memberLabel } from '@/lib/account/members';
import { useTranslations } from 'next-intl';
import { invalidateAiAccountStatus } from '@/lib/ai/account-status-cache';
import {
  channelLabels,
  inboxChannels,
  type InboxChannel,
} from '@/lib/social/channels';

const MASKED_KEY = '••••••••••••••••';

// Radix Select can't use an empty-string item value, so the "leave
// unassigned" choice gets a sentinel that maps to null in the payload.
const HANDOFF_QUEUE = '__queue__';

const PROVIDER_LABEL: Record<
  Exclude<AiProvider, 'openai_compatible'>,
  string
> = {
  openai: 'OpenAI',
  anthropic: 'Anthropic (Claude)',
  gemini: 'Google Gemini',
  n8n: 'External AI (n8n)',
};

const KEY_PLACEHOLDER: Record<AiProvider, string> = {
  openai: 'sk-...',
  anthropic: 'sk-ant-...',
  gemini: '',
  n8n: 'Connection secret',
  openai_compatible: 'your-api-key',
};

export function AiConfig({ onGoToTest }: { onGoToTest: () => void }) {
  const { accountId } = useAuth();
  return <AiConfigForm key={accountId} onGoToTest={onGoToTest} />;
}

function AiConfigForm({ onGoToTest }: { onGoToTest: () => void }) {
  const { accountId, accountRole, profileLoading } = useAuth();
  const canEdit = accountRole ? canEditSettings(accountRole) : false;
  const t = useTranslations('Settings.aiConfig');

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState<'models' | 'connection' | null>(null);
  const [loadError, setLoadError] = useState('');
  const [geminiModels, setGeminiModels] = useState<string[]>([]);
  const [connectionFeedback, setConnectionFeedback] = useState<{
    ok: boolean;
    message: string;
  } | null>(null);
  const [savedProvider, setSavedProvider] = useState<AiProvider | null>(null);
  const [removing, setRemoving] = useState(false);

  const [configured, setConfigured] = useState(false);
  const [agentName, setAgentName] = useState('');
  const [agentPurpose, setAgentPurpose] = useState('');
  const [agentLanguage, setAgentLanguage] = useState('auto');
  const [provider, setProvider] = useState<AiProvider>('gemini');
  const [model, setModel] = useState(AI_PROVIDER_DEFAULT_MODEL.gemini);
  const [baseUrl, setBaseUrl] = useState('');
  const [apiKey, setApiKey] = useState('');
  const [showKey, setShowKey] = useState(false);
  const [hasStoredKey, setHasStoredKey] = useState(false);
  const [embeddingsKey, setEmbeddingsKey] = useState('');
  const [embeddingsKeyEdited, setEmbeddingsKeyEdited] = useState(false);
  const [hasStoredEmbeddingsKey, setHasStoredEmbeddingsKey] = useState(false);
  const [systemPrompt, setSystemPrompt] = useState('');
  const [criteria, setCriteria] = useState('');
  const [applyQualified, setApplyQualified] = useState(false);
  const [qualifiedTag, setQualifiedTag] = useState('');
  const [tags, setTags] = useState<{ id: string; name: string }[]>([]);
  const [isActive, setIsActive] = useState(false);
  const [autoReplyEnabled, setAutoReplyEnabled] = useState(false);
  const [autoReplyChannels, setAutoReplyChannels] = useState<InboxChannel[]>([
    'whatsapp',
  ]);
  const [maxPerConversation, setMaxPerConversation] = useState(3);
  // Empty string = leave unassigned (shared queue).
  const [handoffAgentId, setHandoffAgentId] = useState('');
  const [members, setMembers] = useState<AccountMember[]>([]);

  // Guard keyed on the account (not a bare boolean) so an in-place
  // account switch — ownership transfer, multi-account membership —
  // refetches instead of showing the previous account's config. Mirrors
  // the loadedAccountIdRef pattern in whatsapp-config.tsx.
  const loadedAccountIdRef = useRef<string | null>(null);

  const fetchConfig = useCallback(
    async (initial = true) => {
      if (initial) setLoading(true);
      setLoadError('');
      try {
        const res = await fetch('/api/ai/config');
        const data = await res.json();
        if (!res.ok) {
          setLoadError(data.error ?? t('loadFailed'));
          return;
        }
        if (data.configured) {
          setConfigured(true);
          setProvider(data.provider);
          setSavedProvider(data.provider);
          setAgentName(data.agent_name ?? '');
          setAgentPurpose(data.agent_purpose ?? '');
          setAgentLanguage(data.agent_language ?? 'auto');
          setModel(data.model);
          setBaseUrl(data.base_url ?? '');
          setSystemPrompt(data.system_prompt ?? '');
          setCriteria(data.qualification_criteria ?? '');
          setApplyQualified(Boolean(data.apply_qualified_status));
          setQualifiedTag(data.qualified_tag_id ?? '');
          setIsActive(data.is_active);
          setAutoReplyEnabled(data.auto_reply_enabled);
          setAutoReplyChannels(data.auto_reply_channels ?? ['whatsapp']);
          setMaxPerConversation(data.auto_reply_max_per_conversation ?? 3);
          setHandoffAgentId(data.handoff_agent_id ?? '');
          setHasStoredKey(Boolean(data.has_key));
          setApiKey('');
          setShowKey(false);
          setHasStoredEmbeddingsKey(Boolean(data.has_embeddings_key));
          setEmbeddingsKey(data.has_embeddings_key ? MASKED_KEY : '');
          setEmbeddingsKeyEdited(false);
        }
      } catch {
        setLoadError(t('loadFailed'));
      } finally {
        setLoading(false);
      }
    },
    [t]
  );

  useEffect(() => {
    if (!accountId || loadedAccountIdRef.current === accountId) return;
    loadedAccountIdRef.current = accountId;
    void fetchConfig();
    // Members populate the handoff-target picker. Best-effort — on an
    // older deployment without the endpoint the picker just shows the
    // queue option.
    void fetchAccountMembers().then(setMembers);
    void createClient()
      .from('tags')
      .select('id, name')
      .eq('account_id', accountId)
      .order('name')
      .then(({ data }) => setTags(data ?? []));
  }, [accountId, fetchConfig]);

  // Swap the model default when the provider changes, unless the user
  // typed a custom model.
  const handleProviderChange = (next: AiProvider) => {
    setProvider(next);
    setGeminiModels([]);
    setConnectionFeedback(null);
    setApiKey('');
    setShowKey(false);
    const isDefaultModel =
      model === AI_PROVIDER_DEFAULT_MODEL.openai ||
      model === AI_PROVIDER_DEFAULT_MODEL.anthropic ||
      model === AI_PROVIDER_DEFAULT_MODEL.openai_compatible ||
      model.trim() === '';
    if (
      isDefaultModel ||
      next === 'gemini' ||
      provider === 'gemini' ||
      next === 'n8n' ||
      provider === 'n8n'
    ) {
      setModel(AI_PROVIDER_DEFAULT_MODEL[next]);
    }
  };

  const usesStoredKey =
    hasStoredKey && provider === savedProvider && !apiKey.trim();
  const keyPayload = () => apiKey.trim() || undefined;

  // undefined = leave unchanged; '' typed = null (clear); text = set.
  const embeddingsKeyPayload = () =>
    embeddingsKeyEdited ? embeddingsKey.trim() || null : undefined;

  const buildBody = () => ({
    provider,
    agent_name: agentName,
    agent_purpose: agentPurpose,
    agent_language: agentLanguage,
    model: model.trim(),
    base_url:
      provider === 'openai_compatible' || provider === 'n8n'
        ? baseUrl.trim()
        : null,
    api_key: keyPayload(),
    embeddings_api_key: embeddingsKeyPayload(),
    system_prompt: systemPrompt.trim() || null,
    qualification_criteria: criteria.trim() || null,
    apply_qualified_status: Boolean(criteria.trim()) && applyQualified,
    qualified_tag_id: criteria.trim() ? qualifiedTag || null : null,
    is_active: isActive,
    auto_reply_enabled: autoReplyEnabled,
    auto_reply_channels: autoReplyChannels,
    auto_reply_max_per_conversation: maxPerConversation,
    handoff_agent_id: handoffAgentId || null,
  });

  const handleTest = async (discover = false) => {
    setConnectionFeedback(null);
    setTesting(discover ? 'models' : 'connection');
    try {
      const res = await fetch('/api/ai/test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          provider,
          model: model.trim(),
          base_url:
            provider === 'openai_compatible' || provider === 'n8n'
              ? baseUrl.trim()
              : null,
          api_key: keyPayload(),
          discover_models: discover,
        }),
      });
      const data = await res.json();
      if (provider === 'gemini' && Array.isArray(data.models)) {
        const models: string[] = data.models;
        const messageKey = res.ok
          ? 'geminiModelsLoaded'
          : 'geminiReplacementModels';
        setGeminiModels(models);
        if (!models.includes(model)) setModel('');
        setConnectionFeedback({
          ok: res.ok && models.length > 0,
          message: t(models.length ? messageKey : 'geminiNoModels'),
        });
      } else {
        setConnectionFeedback({
          ok: res.ok,
          message: res.ok
            ? t('testSuccess')
            : (data.error ?? t('testRejected')),
        });
      }
    } catch {
      setConnectionFeedback({ ok: false, message: t('testNetworkError') });
    } finally {
      setTesting(null);
    }
  };

  const handleSave = async (testAfterSave = false) => {
    if (!model.trim()) {
      document.getElementById('ai-model')?.focus();
      setConnectionFeedback({ ok: false, message: t('missingModel') });
      return;
    }
    if (
      (provider === 'openai_compatible' || provider === 'n8n') &&
      !baseUrl.trim()
    ) {
      document.getElementById('ai-base-url')?.focus();
      setConnectionFeedback({ ok: false, message: t('missingBaseUrl') });
      return;
    }
    if (!usesStoredKey && !keyPayload()) {
      document.getElementById('ai-key')?.focus();
      setConnectionFeedback({ ok: false, message: t('missingApiKey') });
      return;
    }
    setSaving(true);
    try {
      const res = await fetch('/api/ai/config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(buildBody()),
      });
      const data = await res.json();
      if (res.ok) {
        invalidateAiAccountStatus();
        toast.success(t('saveSuccess'));
        await fetchConfig(false);
        if (testAfterSave) onGoToTest();
      } else {
        toast.error(data.error ?? t('saveFailed'));
      }
    } catch {
      toast.error(t('saveFailed'));
    } finally {
      setSaving(false);
    }
  };

  const handleRemove = async () => {
    setRemoving(true);
    try {
      const res = await fetch('/api/ai/config', { method: 'DELETE' });
      if (res.ok) {
        invalidateAiAccountStatus();
        toast.success(t('removeSuccess'));
        setConfigured(false);
        setSavedProvider(null);
        setProvider('gemini');
        setModel(AI_PROVIDER_DEFAULT_MODEL.gemini);
        setMaxPerConversation(3);
        setAgentName('');
        setAgentPurpose('');
        setAgentLanguage('auto');
        setGeminiModels([]);
        setConnectionFeedback(null);
        setBaseUrl('');
        setHasStoredKey(false);
        setApiKey('');
        setShowKey(false);
        setHasStoredEmbeddingsKey(false);
        setEmbeddingsKey('');
        setEmbeddingsKeyEdited(false);
        setIsActive(false);
        setAutoReplyEnabled(false);
        setAutoReplyChannels(['whatsapp']);
        setSystemPrompt('');
        setCriteria('');
        setApplyQualified(false);
        setQualifiedTag('');
        setHandoffAgentId('');
      } else {
        const data = await res.json();
        toast.error(data.error ?? t('removeFailed'));
      }
    } catch {
      toast.error(t('removeFailed'));
    } finally {
      setRemoving(false);
    }
  };

  if (loading || profileLoading) {
    return (
      <div className="text-muted-foreground flex items-center justify-center py-16">
        <Loader2 className="mr-2 h-4 w-4 animate-spin" /> {t('loading')}
      </div>
    );
  }

  if (loadError) {
    return (
      <div className="max-w-6xl">
        <SettingsPanelHead title={t('title')} />
        <Card>
          <CardContent className="space-y-3">
            <p role="alert" className="text-destructive">
              {loadError}
            </p>
            <Button variant="outline" onClick={() => void fetchConfig()}>
              {t('retry')}
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  const disabled = !canEdit || saving || removing || testing !== null;
  const canTestKey = usesStoredKey || Boolean(apiKey.trim());
  const providerLabels = {
    ...PROVIDER_LABEL,
    openai_compatible: t('providerOpenAiCompatible'),
  };

  return (
    <div className="max-w-6xl">
      <SettingsPanelHead title={t('title')} description={t('description')} />

      {!canEdit && (
        <p className="border-border bg-muted/40 text-muted-foreground mb-4 rounded-md border px-3 py-2 text-sm">
          {t('adminOnlyConfig')}
        </p>
      )}

      <div className="grid min-w-0 items-start gap-4 lg:grid-cols-2">
        <Card className="min-w-0 lg:col-span-2">
          <CardHeader>
            <div className="flex flex-wrap items-center justify-between gap-x-4">
              <CardTitle
                role="heading"
                aria-level={3}
                className="flex items-center gap-2"
              >
                <KeyRound className="text-primary size-4" aria-hidden="true" />
                {t('providerAndKey')}
              </CardTitle>
              {provider === 'gemini' && (
                <a
                  href="https://aistudio.google.com/apikey"
                  target="_blank"
                  rel="noreferrer"
                  className="text-primary inline-flex min-h-9 items-center gap-1.5 text-sm font-medium underline-offset-4 hover:underline"
                >
                  {t('getGeminiKey')}
                  <ExternalLink
                    className="size-3.5 shrink-0"
                    aria-hidden="true"
                  />
                </a>
              )}
            </div>
            <CardDescription>{t('encryptionNotice')}</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="min-w-0 space-y-2">
                <Label htmlFor="ai-provider">{t('provider')}</Label>
                <Select
                  value={provider}
                  items={providerLabels}
                  onValueChange={(value) => {
                    if (value) handleProviderChange(value as AiProvider);
                  }}
                  disabled={disabled}
                >
                  <SelectTrigger id="ai-provider" className="min-h-11 w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {Object.entries(providerLabels).map(([id, label]) => (
                      <SelectItem key={id} value={id}>
                        {label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="min-w-0 space-y-2">
                <Label htmlFor="ai-key">
                  {t(
                    provider === 'gemini'
                      ? 'geminiApiKey'
                      : provider === 'n8n'
                        ? 'n8nSecret'
                        : 'apiKey'
                  )}
                </Label>
                <div className="relative">
                  <Input
                    id="ai-key"
                    type={showKey ? 'text' : 'password'}
                    value={apiKey}
                    onChange={(event) => {
                      setApiKey(event.target.value);
                      setGeminiModels([]);
                      setConnectionFeedback(null);
                    }}
                    placeholder={
                      usesStoredKey
                        ? t('savedKeyPlaceholder')
                        : provider === 'gemini'
                          ? t('geminiKeyPlaceholder')
                          : KEY_PLACEHOLDER[provider]
                    }
                    disabled={disabled}
                    autoComplete="off"
                    className="h-11 pr-12"
                  />
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    onClick={() => setShowKey((visible) => !visible)}
                    disabled={disabled || !apiKey}
                    className="absolute top-0 right-0 size-11"
                    aria-label={t('showApiKey')}
                    aria-pressed={showKey}
                  >
                    {showKey ? (
                      <EyeOff aria-hidden="true" />
                    ) : (
                      <Eye aria-hidden="true" />
                    )}
                  </Button>
                </div>
              </div>
              {(provider === 'openai_compatible' || provider === 'n8n') && (
                <div className="min-w-0 space-y-2">
                  <Label htmlFor="ai-base-url">
                    {t(provider === 'n8n' ? 'n8nUrl' : 'baseUrl')}
                  </Label>
                  <Input
                    id="ai-base-url"
                    value={baseUrl}
                    onChange={(event) => {
                      setBaseUrl(event.target.value);
                      setConnectionFeedback(null);
                    }}
                    placeholder={
                      provider === 'n8n'
                        ? 'https://your-instance.example/webhook/your-agent'
                        : 'https://api.example.com/v1'
                    }
                    disabled={disabled}
                    autoComplete="off"
                    className="h-11"
                  />
                  <p className="text-muted-foreground text-xs">
                    {t(provider === 'n8n' ? 'n8nUrlHint' : 'baseUrlHint')}
                  </p>
                </div>
              )}
              {provider !== 'n8n' && (
                <div className="min-w-0 space-y-2">
                  <Label htmlFor="ai-model">{t('model')}</Label>
                  <div className="flex flex-wrap items-center gap-2">
                    {provider === 'gemini' && geminiModels.length > 0 ? (
                      <Select
                        value={model || null}
                        items={geminiModels.map((id) => ({
                          value: id,
                          label: id,
                        }))}
                        onValueChange={(value) => {
                          setModel(value ?? '');
                          setConnectionFeedback(null);
                        }}
                        disabled={disabled}
                      >
                        <SelectTrigger
                          id="ai-model"
                          className="min-h-11 min-w-0 flex-1"
                        >
                          <SelectValue
                            placeholder={t('geminiModelPlaceholder')}
                          />
                        </SelectTrigger>
                        <SelectContent>
                          {geminiModels.map((id) => (
                            <SelectItem key={id} value={id}>
                              {id}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    ) : (
                      <Input
                        id="ai-model"
                        value={model}
                        onChange={(event) => {
                          setModel(event.target.value);
                          setConnectionFeedback(null);
                        }}
                        placeholder={
                          provider === 'gemini'
                            ? t('geminiModelPlaceholder')
                            : AI_PROVIDER_DEFAULT_MODEL[provider]
                        }
                        disabled={disabled}
                        className="h-11 min-w-36 flex-1"
                      />
                    )}
                    {provider === 'gemini' && (
                      <Button
                        variant="outline"
                        className="min-h-11 justify-start"
                        onClick={() => void handleTest(true)}
                        disabled={disabled || !canTestKey}
                      >
                        {testing === 'models' && (
                          <Loader2
                            className="animate-spin"
                            aria-hidden="true"
                          />
                        )}
                        {t('geminiLoadModels')}
                      </Button>
                    )}
                  </div>
                </div>
              )}
              <div className="min-w-0 space-y-2 sm:col-span-2">
                {provider === 'gemini' && (
                  <p className="text-muted-foreground text-sm">
                    {t('geminiSetupHint')}
                  </p>
                )}
                {provider === 'n8n' && (
                  <p className="text-muted-foreground text-sm">
                    {t('n8nSetupHint')}
                  </p>
                )}
                <div className="flex flex-wrap items-center gap-3">
                  <Button
                    variant="outline"
                    className="min-h-11"
                    onClick={() => void handleTest()}
                    disabled={disabled || !canTestKey || !model.trim()}
                  >
                    {testing === 'connection' ? (
                      <Loader2 className="animate-spin" aria-hidden="true" />
                    ) : (
                      <CheckCircle2 aria-hidden="true" />
                    )}
                    {t(provider === 'n8n' ? 'n8nTest' : 'testKey')}
                  </Button>
                  <div role="status">
                    {connectionFeedback && (
                      <p
                        className={
                          connectionFeedback.ok
                            ? 'text-muted-foreground text-sm'
                            : 'text-destructive text-sm'
                        }
                      >
                        {connectionFeedback.message}
                      </p>
                    )}
                  </div>
                </div>
              </div>
            </div>

            <details className="space-y-2">
              <summary className="cursor-pointer text-sm font-medium">
                {t('advanced')}
              </summary>
              <Label htmlFor="ai-embeddings-key">
                {t('embeddingsKey')}{' '}
                <span className="text-muted-foreground font-normal">
                  {t('optionalSemanticSearch')}
                </span>
              </Label>
              <Input
                id="ai-embeddings-key"
                type="password"
                value={embeddingsKey}
                onChange={(e) => {
                  setEmbeddingsKey(e.target.value);
                  setEmbeddingsKeyEdited(true);
                }}
                onFocus={() => {
                  if (!embeddingsKeyEdited && hasStoredEmbeddingsKey) {
                    setEmbeddingsKey('');
                    setEmbeddingsKeyEdited(true);
                  }
                }}
                placeholder="sk-... (OpenAI)"
                disabled={disabled}
                autoComplete="off"
              />
              <p className="text-muted-foreground text-xs">
                {t('embeddingsHint', {
                  sameKeyText: provider === 'openai' ? t('sameKeyText') : '',
                })}
              </p>
            </details>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle role="heading" aria-level={3}>
              {t('stepBasics')}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="agent-name">{t('agentName')}</Label>
              <Input
                id="agent-name"
                maxLength={80}
                value={agentName}
                onChange={(event) => setAgentName(event.target.value)}
                disabled={disabled}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="agent-purpose">{t('agentPurpose')}</Label>
              <Input
                id="agent-purpose"
                maxLength={240}
                value={agentPurpose}
                onChange={(event) => setAgentPurpose(event.target.value)}
                disabled={disabled}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="agent-language">{t('agentLanguage')}</Label>
              <Select
                value={agentLanguage}
                items={{
                  auto: t('matchCustomerLanguage'),
                  English: 'English',
                  Hindi: 'Hindi',
                  Hinglish: 'Hinglish',
                }}
                onValueChange={(value) => setAgentLanguage(value ?? 'auto')}
                disabled={disabled}
              >
                <SelectTrigger id="agent-language" className="min-h-11 w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="auto">
                    {t('matchCustomerLanguage')}
                  </SelectItem>
                  <SelectItem value="English">English</SelectItem>
                  <SelectItem value="Hindi">Hindi</SelectItem>
                  <SelectItem value="Hinglish">Hinglish</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle role="heading" aria-level={3}>
              {t('qualificationTitle')}
            </CardTitle>
            <CardDescription>{t('qualificationDescription')}</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="ai-qualification-criteria">
                {t('qualificationCriteria')}
              </Label>
              <Textarea
                id="ai-qualification-criteria"
                rows={4}
                maxLength={4000}
                value={criteria}
                onChange={(event) => setCriteria(event.target.value)}
                disabled={disabled}
                placeholder={t('qualificationPlaceholder')}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="ai-qualified-tag">{t('qualificationTag')}</Label>
              <Select
                value={qualifiedTag || '__none__'}
                items={[
                  { value: '__none__', label: t('qualificationNoTag') },
                  ...tags.map((tag) => ({ value: tag.id, label: tag.name })),
                ]}
                onValueChange={(value) =>
                  setQualifiedTag(value === '__none__' || !value ? '' : value)
                }
                disabled={disabled || !criteria.trim()}
              >
                <SelectTrigger
                  id="ai-qualified-tag"
                  className="min-h-11 w-full"
                >
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__none__">
                    {t('qualificationNoTag')}
                  </SelectItem>
                  {tags.map((tag) => (
                    <SelectItem key={tag.id} value={tag.id}>
                      {tag.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <label className="flex min-h-9 items-start gap-2 text-sm">
              <input
                type="checkbox"
                className="accent-primary mt-0.5 size-4"
                checked={applyQualified}
                disabled={disabled || !criteria.trim()}
                onChange={(event) => setApplyQualified(event.target.checked)}
              />
              {t('qualificationAutoApply')}
            </label>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle role="heading" aria-level={3}>
              {t('behaviour')}
            </CardTitle>
            <CardDescription>{t('behaviourDesc')}</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="ai-prompt">{t('businessContext')}</Label>
              <Textarea
                id="ai-prompt"
                value={systemPrompt}
                onChange={(e) => setSystemPrompt(e.target.value)}
                placeholder={t('promptPlaceholder')}
                rows={5}
                disabled={disabled}
              />
            </div>

            <div className="flex items-center justify-between gap-4">
              <div>
                <Label htmlFor="ai-max">{t('maxAutoReplies')}</Label>
                <p className="text-muted-foreground text-xs">
                  {t('maxAutoRepliesDesc')}
                </p>
              </div>
              <Input
                id="ai-max"
                type="number"
                min={1}
                max={20}
                value={maxPerConversation}
                onChange={(e) =>
                  setMaxPerConversation(
                    Math.min(20, Math.max(1, Number(e.target.value) || 1))
                  )
                }
                disabled={disabled}
                className="h-11 w-20 shrink-0"
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="ai-handoff">{t('handoffTo')}</Label>
              <p className="text-muted-foreground text-xs">
                {t('handoffToDesc')}
              </p>
              <Select
                value={handoffAgentId || HANDOFF_QUEUE}
                items={[
                  { value: HANDOFF_QUEUE, label: t('handoffQueue') },
                  ...members.map((member) => ({
                    value: member.user_id,
                    label: memberLabel(member),
                  })),
                ]}
                onValueChange={(v) =>
                  setHandoffAgentId(!v || v === HANDOFF_QUEUE ? '' : v)
                }
                disabled={disabled}
              >
                <SelectTrigger id="ai-handoff" className="min-h-11 w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={HANDOFF_QUEUE}>
                    {t('handoffQueue')}
                  </SelectItem>
                  {members.map((m) => (
                    <SelectItem key={m.user_id} value={m.user_id}>
                      {memberLabel(m)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle role="heading" aria-level={3}>
              {t('activationTitle')}
            </CardTitle>
            <CardDescription>{t('activationHint')}</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="border-border flex items-center justify-between gap-4 rounded-md border p-3">
              <div>
                <p className="text-foreground text-sm font-medium">
                  {t('enableAssistant')}
                </p>
                <p className="text-muted-foreground text-xs">
                  {t('enableAssistantDesc')}
                </p>
              </div>
              <Switch
                aria-label={t('enableAssistant')}
                checked={isActive}
                onCheckedChange={setIsActive}
                disabled={disabled}
              />
            </div>

            <div className="border-border flex items-center justify-between gap-4 rounded-md border p-3">
              <div>
                <p className="text-foreground text-sm font-medium">
                  {t('autoReply')}
                </p>
                <p className="text-muted-foreground text-xs">
                  {t('autoReplyDesc')}
                </p>
              </div>
              <Switch
                aria-label={t('autoReply')}
                checked={autoReplyEnabled}
                onCheckedChange={setAutoReplyEnabled}
                disabled={disabled || !isActive}
              />
            </div>
            {autoReplyEnabled && (
              <fieldset
                className="border-border rounded-md border px-3 pb-2"
                disabled={disabled || !isActive}
              >
                <legend className="px-1 text-sm font-medium">
                  {t('autoReplyChannels')}
                </legend>
                <div className="flex flex-wrap gap-x-4">
                  {inboxChannels.map((channel) => (
                    <label
                      key={channel}
                      className="flex min-h-11 items-center gap-2 text-sm"
                    >
                      <input
                        type="checkbox"
                        className="accent-primary"
                        checked={autoReplyChannels.includes(channel)}
                        onChange={(event) =>
                          setAutoReplyChannels((channels) =>
                            event.target.checked
                              ? [...channels, channel]
                              : channels.filter((item) => item !== channel)
                          )
                        }
                      />
                      {channelLabels[channel]}
                    </label>
                  ))}
                </div>
              </fieldset>
            )}
          </CardContent>
        </Card>
        <div className="min-w-0 lg:col-span-2">
          <AiKnowledgeCard
            accountId={accountId}
            canEdit={canEdit}
            hasEmbeddingsKey={
              embeddingsKeyEdited
                ? embeddingsKey.trim().length > 0
                : hasStoredEmbeddingsKey
            }
          />
        </div>
        <div className="flex flex-wrap items-center justify-between gap-3 border-t pt-4 lg:col-span-2">
          {configured && (
            <Button
              variant="ghost"
              onClick={handleRemove}
              disabled={disabled}
              className="text-destructive hover:text-destructive"
            >
              {removing ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <Trash2 className="mr-2 h-4 w-4" />
              )}
              {t('remove')}
            </Button>
          )}

          <div className="ml-auto flex flex-wrap gap-2">
            <Button
              variant="outline"
              onClick={() => void handleSave(true)}
              disabled={disabled}
            >
              {t('saveAndTest')}
            </Button>
            <Button onClick={() => void handleSave()} disabled={disabled}>
              {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              {t(saving ? 'saving' : 'save')}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
