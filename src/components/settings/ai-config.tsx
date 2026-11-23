'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import {
  Loader2,
  Sparkles,
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
  gemini: 'AIza…',
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
  const [testing, setTesting] = useState(false);
  const [geminiModels, setGeminiModels] = useState<string[]>([]);
  const [connectionFeedback, setConnectionFeedback] = useState<{
    ok: boolean;
    message: string;
  } | null>(null);
  const [savedProvider, setSavedProvider] = useState<AiProvider | null>(null);
  const [removing, setRemoving] = useState(false);

  const [step, setStep] = useState(0);
  const [configured, setConfigured] = useState(false);
  const [agentName, setAgentName] = useState('');
  const [agentPurpose, setAgentPurpose] = useState('');
  const [agentLanguage, setAgentLanguage] = useState('auto');
  const [provider, setProvider] = useState<AiProvider>('gemini');
  const [model, setModel] = useState(AI_PROVIDER_DEFAULT_MODEL.gemini);
  const [baseUrl, setBaseUrl] = useState('');
  const [apiKey, setApiKey] = useState('');
  const [keyEdited, setKeyEdited] = useState(false);
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
  const [maxPerConversation, setMaxPerConversation] = useState(3);
  // Empty string = leave unassigned (shared queue).
  const [handoffAgentId, setHandoffAgentId] = useState('');
  const [members, setMembers] = useState<AccountMember[]>([]);

  // Guard keyed on the account (not a bare boolean) so an in-place
  // account switch — ownership transfer, multi-account membership —
  // refetches instead of showing the previous account's config. Mirrors
  // the loadedAccountIdRef pattern in whatsapp-config.tsx.
  const loadedAccountIdRef = useRef<string | null>(null);

  const fetchConfig = useCallback(async () => {
    setLoading(true);
    setGeminiModels([]);
    setConnectionFeedback(null);
    try {
      const res = await fetch('/api/ai/config');
      const data = await res.json();
      if (!res.ok) {
        toast.error(data.error ?? t('loadFailed'));
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
        setMaxPerConversation(data.auto_reply_max_per_conversation ?? 3);
        setHandoffAgentId(data.handoff_agent_id ?? '');
        setHasStoredKey(Boolean(data.has_key));
        setApiKey(data.has_key ? MASKED_KEY : '');
        setKeyEdited(false);
        setHasStoredEmbeddingsKey(Boolean(data.has_embeddings_key));
        setEmbeddingsKey(data.has_embeddings_key ? MASKED_KEY : '');
        setEmbeddingsKeyEdited(false);
      }
    } catch {
      toast.error(t('loadFailed'));
    } finally {
      setLoading(false);
    }
  }, [t]);

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
    setApiKey(next === savedProvider && hasStoredKey ? MASKED_KEY : '');
    setKeyEdited(false);
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

  const keyPayload = () => (keyEdited ? apiKey.trim() : undefined);

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
    auto_reply_max_per_conversation: maxPerConversation,
    handoff_agent_id: handoffAgentId || null,
  });

  const handleTest = async (discover = false) => {
    setConnectionFeedback(null);
    setTesting(true);
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
      if (res.ok && discover) {
        const models: string[] = data.models ?? [];
        setGeminiModels(models);
        if (!models.includes(model)) setModel('');
        setConnectionFeedback({
          ok: models.length > 0,
          message: t(models.length ? 'geminiModelsLoaded' : 'geminiNoModels'),
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
      setTesting(false);
    }
  };

  const handleSave = async (testAfterSave = false) => {
    if (!model.trim()) {
      setStep(1);
      toast.error(t('missingModel'));
      return;
    }
    if (
      (provider === 'openai_compatible' || provider === 'n8n') &&
      !baseUrl.trim()
    ) {
      setStep(1);
      toast.error(t('missingBaseUrl'));
      return;
    }
    if ((!configured || provider !== savedProvider) && !keyPayload()) {
      setStep(1);
      toast.error(t('missingApiKey'));
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
        await fetchConfig();
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
        setAgentName('');
        setAgentPurpose('');
        setAgentLanguage('auto');
        setGeminiModels([]);
        setConnectionFeedback(null);
        setBaseUrl('');
        setHasStoredKey(false);
        setApiKey('');
        setKeyEdited(false);
        setHasStoredEmbeddingsKey(false);
        setEmbeddingsKey('');
        setEmbeddingsKeyEdited(false);
        setIsActive(false);
        setAutoReplyEnabled(false);
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

  const disabled = !canEdit || saving || removing || testing;
  const steps = [
    'stepBasics',
    'stepConnection',
    'stepResponsibilities',
    'stepBehavior',
    'stepTest',
  ] as const;

  return (
    <div>
      <SettingsPanelHead title={t('title')} description={t('description')} />

      {!canEdit && (
        <p className="border-border bg-muted/40 text-muted-foreground mb-4 rounded-md border px-3 py-2 text-sm">
          {t('adminOnlyConfig')}
        </p>
      )}

      <nav aria-label={t('title')} className="mb-4 flex flex-wrap gap-2">
        {steps.map((label, i) => (
          <Button
            key={label}
            size="sm"
            variant={step === i ? 'secondary' : 'ghost'}
            aria-current={step === i ? 'step' : undefined}
            onClick={() => setStep(i)}
            disabled={saving || testing}
          >
            {i + 1}. {t(label)}
          </Button>
        ))}
      </nav>
      <div className="space-y-4">
        {step === 0 && (
          <Card>
            <CardHeader>
              <CardTitle className="text-base">{t('stepBasics')}</CardTitle>
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
                  onValueChange={(value) => setAgentLanguage(value ?? 'auto')}
                  disabled={disabled}
                >
                  <SelectTrigger id="agent-language">
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
        )}
        {step === 1 && (
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <Sparkles className="text-primary h-4 w-4" />{' '}
                {t('providerAndKey')}
              </CardTitle>
              <CardDescription>{t('encryptionNotice')}</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-2">
                  <Label htmlFor="ai-provider">{t('provider')}</Label>
                  <Select
                    value={provider}
                    onValueChange={(v) => handleProviderChange(v as AiProvider)}
                    disabled={disabled}
                  >
                    <SelectTrigger id="ai-provider">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="gemini">
                        {PROVIDER_LABEL.gemini}
                      </SelectItem>
                      <SelectItem value="openai">
                        {PROVIDER_LABEL.openai}
                      </SelectItem>
                      <SelectItem value="anthropic">
                        {PROVIDER_LABEL.anthropic}
                      </SelectItem>
                      <SelectItem value="n8n">{PROVIDER_LABEL.n8n}</SelectItem>
                      <SelectItem value="openai_compatible">
                        {t('providerOpenAiCompatible')}
                      </SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                {provider !== 'n8n' && (
                  <div className="space-y-2">
                    <Label htmlFor="ai-model">{t('model')}</Label>
                    <Input
                      id="ai-model"
                      value={model}
                      onChange={(e) => {
                        setModel(e.target.value);
                        setConnectionFeedback(null);
                      }}
                      placeholder={
                        provider === 'gemini'
                          ? t('geminiModelPlaceholder')
                          : AI_PROVIDER_DEFAULT_MODEL[provider]
                      }
                      disabled={disabled}
                    />
                    {provider === 'gemini' && geminiModels.length > 0 && (
                      <Select
                        value={geminiModels.includes(model) ? model : null}
                        onValueChange={(value) => {
                          if (value) setModel(value);
                          setConnectionFeedback(null);
                        }}
                        disabled={disabled || testing}
                      >
                        <SelectTrigger aria-label={t('geminiModelPlaceholder')}>
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
                    )}
                  </div>
                )}

                {(provider === 'openai_compatible' || provider === 'n8n') && (
                  <div className="space-y-2">
                    <Label htmlFor="ai-base-url">
                      {t(provider === 'n8n' ? 'n8nUrl' : 'baseUrl')}
                    </Label>
                    <Input
                      id="ai-base-url"
                      value={baseUrl}
                      onChange={(e) => setBaseUrl(e.target.value)}
                      placeholder={
                        provider === 'n8n'
                          ? 'https://your-instance.example/webhook/your-agent'
                          : 'https://api.example.com/v1'
                      }
                      disabled={disabled}
                      autoComplete="off"
                    />
                    <p className="text-muted-foreground text-xs">
                      {t(provider === 'n8n' ? 'n8nUrlHint' : 'baseUrlHint')}
                    </p>
                  </div>
                )}
              </div>

              <div className="space-y-2">
                <Label htmlFor="ai-key">
                  {t(provider === 'n8n' ? 'n8nSecret' : 'apiKey')}
                </Label>
                <div className="flex flex-wrap gap-2">
                  <div className="relative min-w-44 flex-1">
                    <Input
                      id="ai-key"
                      type={showKey ? 'text' : 'password'}
                      value={apiKey}
                      onChange={(e) => {
                        setApiKey(e.target.value);
                        setKeyEdited(true);
                        setGeminiModels([]);
                        setConnectionFeedback(null);
                      }}
                      onFocus={() => {
                        if (
                          !keyEdited &&
                          hasStoredKey &&
                          provider === savedProvider
                        ) {
                          setApiKey('');
                          setKeyEdited(true);
                        }
                      }}
                      placeholder={KEY_PLACEHOLDER[provider]}
                      disabled={disabled}
                      autoComplete="off"
                    />
                    <button
                      type="button"
                      onClick={() => setShowKey((s) => !s)}
                      className="text-muted-foreground hover:text-foreground absolute top-1/2 right-2 -translate-y-1/2"
                      aria-label={t(showKey ? 'hideApiKey' : 'showApiKey')}
                      aria-pressed={showKey}
                    >
                      {showKey ? (
                        <EyeOff className="h-4 w-4" />
                      ) : (
                        <Eye className="h-4 w-4" />
                      )}
                    </button>
                  </div>
                  {provider === 'gemini' && (
                    <Button
                      variant="outline"
                      onClick={() => void handleTest(true)}
                      disabled={disabled || testing}
                    >
                      {t('geminiLoadModels')}
                    </Button>
                  )}
                  <Button
                    variant="outline"
                    onClick={() => void handleTest()}
                    disabled={disabled || testing || !model.trim()}
                  >
                    {testing ? (
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    ) : (
                      <CheckCircle2 className="mr-2 h-4 w-4" />
                    )}
                    {t(provider === 'n8n' ? 'n8nTest' : 'testKey')}
                  </Button>
                </div>
                {provider === 'gemini' && (
                  <p className="text-muted-foreground text-xs">
                    {t('geminiSetupHint')}
                  </p>
                )}
                {provider === 'n8n' && (
                  <p className="text-muted-foreground text-xs">
                    {t('n8nSetupHint')}{' '}
                  </p>
                )}
                {connectionFeedback && (
                  <p
                    role="status"
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
        )}
        {step === 2 && (
          <Card>
            <CardHeader>
              <CardTitle className="text-base">
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
                <Label htmlFor="ai-qualified-tag">
                  {t('qualificationTag')}
                </Label>
                <Select
                  value={qualifiedTag || '__none__'}
                  onValueChange={(value) =>
                    setQualifiedTag(value === '__none__' || !value ? '' : value)
                  }
                  disabled={disabled || !criteria.trim()}
                >
                  <SelectTrigger id="ai-qualified-tag">
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
        )}
        {step === 3 && (
          <>
            <Card>
              <CardHeader>
                <CardTitle className="text-base">{t('behaviour')}</CardTitle>
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
                    className="w-20"
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="ai-handoff">{t('handoffTo')}</Label>
                  <p className="text-muted-foreground text-xs">
                    {t('handoffToDesc')}
                  </p>
                  <Select
                    value={handoffAgentId || HANDOFF_QUEUE}
                    onValueChange={(v) =>
                      setHandoffAgentId(!v || v === HANDOFF_QUEUE ? '' : v)
                    }
                    disabled={disabled}
                  >
                    <SelectTrigger id="ai-handoff">
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

            <AiKnowledgeCard
              accountId={accountId}
              canEdit={canEdit}
              hasEmbeddingsKey={
                embeddingsKeyEdited
                  ? embeddingsKey.trim().length > 0
                  : hasStoredEmbeddingsKey
              }
            />
          </>
        )}
        {step === 4 && (
          <Card>
            <CardHeader>
              <CardTitle className="text-base">{t('stepTest')}</CardTitle>
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
            </CardContent>
          </Card>
        )}

        <div className="flex flex-wrap items-center justify-between gap-2">
          <Button
            variant="outline"
            onClick={() => setStep(step - 1)}
            disabled={step === 0 || saving || testing}
          >
            {t('stepBack')}
          </Button>
          {step < steps.length - 1 && (
            <Button
              onClick={() => setStep(step + 1)}
              disabled={saving || testing}
            >
              {t('stepNext')}
            </Button>
          )}
        </div>

        {step === 4 && (
          <div className="flex flex-wrap items-center justify-between gap-2">
            {configured ? (
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
            ) : (
              <span />
            )}

            <div className="flex flex-wrap gap-2">
              <Button
                variant="outline"
                onClick={() => void handleSave(true)}
                disabled={disabled}
              >
                {t('saveAndTest')}
              </Button>
              <Button onClick={() => void handleSave()} disabled={disabled}>
                {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                {t('save')}
              </Button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
