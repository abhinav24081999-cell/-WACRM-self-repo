'use client';

import { useState, useEffect, useCallback, useId, type ReactNode } from 'react';
import { createClient } from '@/lib/supabase/client';
import { addContactTag, deleteContactTag } from '@/lib/contacts/tag-api';
import { ContactLeads } from '@/components/contacts/contact-leads';
import { useAuth } from '@/hooks/use-auth';
import { toast } from 'sonner';
import type {
  Contact,
  Tag,
  ContactNote,
  CustomField,
  MessageTemplate,
} from '@/types';
import {
  TemplatePicker,
  type TemplateSendValues,
} from '@/components/inbox/template-picker';
import {
  Sheet,
  SheetContent,
  SheetFooter,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from '@/components/ui/sheet';
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from '@/components/ui/accordion';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import {
  Phone,
  Copy,
  Check,
  ContactRound,
  LayoutGrid,
  LayoutTemplate,
  Loader2,
  Plus,
  StickyNote,
  Tag as TagIcon,
  Trash2,
  TrendingUp,
  Save,
  type LucideIcon,
} from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import { planCustomValueWrites } from '@/lib/contacts/custom-value-writes';
import { contactHandle } from '@/lib/whatsapp/wa-identity';
import { parseInternationalPhone } from '@/lib/whatsapp/phone-utils';

interface ContactDetailViewProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  contactId: string | null;
  onUpdated: () => void;
}

function ContactSection({
  value,
  title,
  icon: Icon,
  keepMounted,
  children,
}: {
  value: string;
  title: string;
  icon: LucideIcon;
  keepMounted?: boolean;
  children: ReactNode;
}) {
  return (
    <AccordionItem
      value={value}
      className="border-border bg-card-2 rounded-xl border"
    >
      <AccordionTrigger className="hover:bg-muted/50 min-h-11 items-center justify-start gap-3 px-3 py-2 text-[0.9375rem] hover:no-underline">
        <Icon
          aria-hidden="true"
          className="text-muted-foreground size-4 shrink-0"
        />
        {title}
      </AccordionTrigger>
      <AccordionContent keepMounted={keepMounted} className="px-3 pb-3">
        {children}
      </AccordionContent>
    </AccordionItem>
  );
}

export function ContactDetailView({
  open,
  onOpenChange,
  contactId,
  onUpdated,
}: ContactDetailViewProps) {
  const t = useTranslations('Contacts.detailView');
  const clipboardText = useTranslations('Inbox.actions');
  const locale = useLocale();
  const detailsFormId = useId();
  const supabase = createClient();
  const { accountId } = useAuth();

  const [contact, setContact] = useState<Contact | null>(null);
  const [loading, setLoading] = useState(false);
  const [copiedPhone, setCopiedPhone] = useState(false);

  // Send template — lets the business initiate (or re-open) a conversation
  // with this contact by sending an approved template. The send route
  // find-or-creates the conversation, so no inbound message is required.
  const [templatePickerOpen, setTemplatePickerOpen] = useState(false);
  const [sendingTemplate, setSendingTemplate] = useState(false);

  // Details
  const [editName, setEditName] = useState('');
  const [editPhone, setEditPhone] = useState('');
  const [editEmail, setEditEmail] = useState('');
  const [editCompany, setEditCompany] = useState('');
  const [savingDetails, setSavingDetails] = useState(false);

  // Tags
  const [allTags, setAllTags] = useState<Tag[]>([]);
  const [contactTagIds, setContactTagIds] = useState<string[]>([]);
  const [savingTags, setSavingTags] = useState(false);

  // Notes
  const [notes, setNotes] = useState<ContactNote[]>([]);
  const [newNote, setNewNote] = useState('');
  const [savingNote, setSavingNote] = useState(false);
  const [loadingNotes, setLoadingNotes] = useState(false);

  // Custom fields
  const [customFields, setCustomFields] = useState<CustomField[]>([]);
  const [customValues, setCustomValues] = useState<Record<string, string>>({});
  const [savingCustom, setSavingCustom] = useState(false);
  const [loadingCustom, setLoadingCustom] = useState(false);

  const fetchContact = useCallback(async () => {
    if (!contactId) return;
    setLoading(true);

    const { data } = await supabase
      .from('contacts')
      .select('*')
      .eq('id', contactId)
      .single();

    if (data) {
      setContact(data);
      setEditName(data.name ?? '');
      setEditPhone(data.phone);
      setEditEmail(data.email ?? '');
      setEditCompany(data.company ?? '');
    }
    setLoading(false);
  }, [contactId, supabase]);

  const fetchTags = useCallback(async () => {
    if (!contactId) return;

    const [tagsRes, contactTagsRes] = await Promise.all([
      supabase.from('tags').select('*').order('name'),
      supabase
        .from('contact_tags')
        .select('tag_id')
        .eq('contact_id', contactId),
    ]);

    if (tagsRes.data) setAllTags(tagsRes.data);
    if (contactTagsRes.data) {
      setContactTagIds(contactTagsRes.data.map((ct) => ct.tag_id));
    }
  }, [contactId, supabase]);

  const fetchNotes = useCallback(async () => {
    if (!contactId) return;
    setLoadingNotes(true);

    const { data } = await supabase
      .from('contact_notes')
      .select('*')
      .eq('contact_id', contactId)
      .order('created_at', { ascending: false });

    if (data) setNotes(data);
    setLoadingNotes(false);
  }, [contactId, supabase]);

  const fetchCustomFields = useCallback(async () => {
    if (!contactId) return;
    setLoadingCustom(true);

    const [fieldsRes, valuesRes] = await Promise.all([
      supabase.from('custom_fields').select('*').order('field_name'),
      supabase
        .from('contact_custom_values')
        .select('*')
        .eq('contact_id', contactId),
    ]);

    if (fieldsRes.data) setCustomFields(fieldsRes.data);
    if (valuesRes.data) {
      const map: Record<string, string> = {};
      valuesRes.data.forEach((v) => {
        map[v.custom_field_id] = v.value ?? '';
      });
      setCustomValues(map);
    }
    setLoadingCustom(false);
  }, [contactId, supabase]);

  useEffect(() => {
    if (open && contactId) {
      fetchContact();
      fetchTags();
      fetchNotes();
      fetchCustomFields();
    }
  }, [open, contactId, fetchContact, fetchTags, fetchNotes, fetchCustomFields]);

  async function copyPhone() {
    if (!contact) return;
    try {
      await navigator.clipboard.writeText(contactHandle(contact));
      setCopiedPhone(true);
      setTimeout(() => setCopiedPhone(false), 2000);
    } catch {
      toast.error(clipboardText('copyFailed'));
    }
  }

  async function saveDetails() {
    if (!contactId || !editPhone.trim()) {
      toast.error(t('toastPhoneRequired'));
      return;
    }

    // Same rule as the create form: a changed number must start with `+`
    // and a country code (issue #586). Unchanged numbers — including the
    // digits-only form the inbound webhook stores — are left alone so a
    // name/email edit is never blocked by the phone field.
    const phoneChanged = editPhone.trim() !== (contact?.phone ?? '');
    if (phoneChanged && !parseInternationalPhone(editPhone)) {
      toast.error(t('toastPhoneNeedsCountryCode'));
      return;
    }

    setSavingDetails(true);
    const { error } = await supabase
      .from('contacts')
      .update({
        name: editName.trim() || null,
        phone: editPhone.trim(),
        email: editEmail.trim() || null,
        company: editCompany.trim() || null,
        updated_at: new Date().toISOString(),
      })
      .eq('id', contactId);

    if (error) {
      toast.error(t('toastUpdateFailed'));
    } else {
      toast.success(t('toastUpdated'));
      fetchContact();
      onUpdated();
    }
    setSavingDetails(false);
  }

  async function toggleTag(tagId: string) {
    if (!contactId) return;
    setSavingTags(true);

    const isSelected = contactTagIds.includes(tagId);

    try {
      if (isSelected) {
        await deleteContactTag(contactId, tagId);
        setContactTagIds((prev) => prev.filter((id) => id !== tagId));
      } else {
        await addContactTag(contactId, tagId);
        setContactTagIds((prev) => [...prev, tagId]);
      }
      onUpdated();
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : t('toastUpdateFailed')
      );
    }
    setSavingTags(false);
  }

  async function addNote() {
    if (!contactId || !newNote.trim()) return;
    setSavingNote(true);

    const {
      data: { session },
    } = await supabase.auth.getSession();
    const user = session?.user;
    if (!user || !accountId) {
      toast.error(t('toastNotAuthenticated'));
      setSavingNote(false);
      return;
    }

    const { error } = await supabase.from('contact_notes').insert({
      contact_id: contactId,
      account_id: accountId,
      user_id: user.id,
      note_text: newNote.trim(),
    });

    if (error) {
      toast.error(t('toastNoteAddFailed'));
    } else {
      setNewNote('');
      fetchNotes();
      toast.success(t('toastNoteAdded'));
    }
    setSavingNote(false);
  }

  async function deleteNote(noteId: string) {
    const { error } = await supabase
      .from('contact_notes')
      .delete()
      .eq('id', noteId);

    if (error) {
      toast.error(t('toastNoteDeleteFailed'));
    } else {
      setNotes((prev) => prev.filter((n) => n.id !== noteId));
      toast.success(t('toastNoteDeleted'));
    }
  }

  async function saveCustomFields() {
    if (!contactId) return;
    setSavingCustom(true);

    try {
      const { upserts, clearedFieldIds } = planCustomValueWrites(
        contactId,
        customValues
      );

      if (upserts.length > 0) {
        const { error } = await supabase
          .from('contact_custom_values')
          .upsert(upserts, { onConflict: 'contact_id,custom_field_id' });
        if (error) throw error;
      }

      if (clearedFieldIds.length > 0) {
        const { error } = await supabase
          .from('contact_custom_values')
          .delete()
          .eq('contact_id', contactId)
          .in('custom_field_id', clearedFieldIds);
        if (error) throw error;
      }

      toast.success(t('toastCustomFieldsSaved'));
    } catch {
      toast.error(t('toastCustomFieldsFailed'));
    }
    setSavingCustom(false);
  }

  async function handleSendTemplate(
    template: MessageTemplate,
    values: TemplateSendValues
  ) {
    if (!contactId) return;
    setSendingTemplate(true);
    try {
      const res = await fetch('/api/whatsapp/send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          // No conversation_id — the route find-or-creates one for this
          // contact, mirroring the inbox template-send payload otherwise.
          contact_id: contactId,
          message_type: 'template',
          template_name: template.name,
          template_language: template.language,
          template_message_params: {
            body: values.body,
            headerText: values.headerText,
            buttonParams: values.buttonParams,
          },
          template_params: values.body,
        }),
      });

      const payload = await res.json().catch(() => ({}));
      if (!res.ok) {
        const reason = payload?.error || `HTTP ${res.status}`;
        toast.error(t('toastTemplateFailed', { reason }));
        return;
      }

      toast.success(t('toastTemplateSent', { name: template.name }));
    } catch (err) {
      const reason = err instanceof Error ? err.message : t('networkError');
      toast.error(t('toastTemplateFailed', { reason }));
    } finally {
      setSendingTemplate(false);
    }
  }

  function getInitials(name?: string | null) {
    if (!name) return '?';
    return name
      .split(' ')
      .map((w) => w[0])
      .join('')
      .toUpperCase()
      .slice(0, 2);
  }

  const handle = contact ? contactHandle(contact) : '';
  const contactName = contact?.name || handle || t('unnamed');

  return (
    <>
      <Sheet open={open} onOpenChange={onOpenChange}>
        <SheetContent
          side="right"
          className="border-border bg-sidebar gap-0 p-0 data-[side=right]:w-full motion-reduce:transition-none data-[side=right]:sm:max-w-[23rem]"
        >
          {loading || !contact || contact.id !== contactId ? (
            <div className="flex flex-1 items-center justify-center">
              <SheetTitle className="sr-only">
                {t('contactDetailsDesc')}
              </SheetTitle>
              <Loader2
                aria-hidden="true"
                className="text-primary size-6 animate-spin"
              />
            </div>
          ) : (
            <>
              <SheetHeader className="border-border shrink-0 gap-2.5 border-b px-4 py-3">
                <div className="flex items-start gap-3 pr-8">
                  <Avatar className="border-primary/20 size-12 shrink-0 border">
                    <AvatarFallback className="bg-primary-soft-2 text-foreground text-sm font-semibold">
                      {getInitials(contactName)}
                    </AvatarFallback>
                  </Avatar>
                  <div className="min-w-0 space-y-0.5">
                    <SheetTitle className="text-lg leading-tight font-semibold [overflow-wrap:anywhere]">
                      {contactName}
                    </SheetTitle>
                    <SheetDescription className="text-xs">
                      {t('contactDetailsDesc')}
                    </SheetDescription>
                    {handle && (
                      <button
                        type="button"
                        onClick={copyPhone}
                        aria-label={`${clipboardText(copiedPhone ? 'copied' : 'copyText')}: ${handle}`}
                        className="text-muted-foreground hover:text-foreground focus-visible:outline-ring flex min-h-6 max-w-full cursor-pointer items-center gap-1.5 rounded-sm text-left text-xs focus-visible:outline-2"
                      >
                        {contact.phone && (
                          <Phone
                            aria-hidden="true"
                            className="size-3 shrink-0"
                          />
                        )}
                        <span className="[overflow-wrap:anywhere]">
                          {handle}
                        </span>
                        {copiedPhone ? (
                          <Check
                            aria-hidden="true"
                            className="size-3 shrink-0"
                          />
                        ) : (
                          <Copy
                            aria-hidden="true"
                            className="size-3 shrink-0"
                          />
                        )}
                      </button>
                    )}
                  </div>
                </div>
                <Button
                  onClick={() => setTemplatePickerOpen(true)}
                  disabled={sendingTemplate}
                  className="hover:bg-primary-hover h-9 w-fit"
                >
                  {sendingTemplate ? (
                    <Loader2 className="animate-spin" />
                  ) : (
                    <LayoutTemplate />
                  )}
                  {t('sendTemplateBtn')}
                </Button>
              </SheetHeader>

              <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 py-2.5">
                <Accordion
                  key={contact.id}
                  defaultValue={['details']}
                  multiple
                  className="gap-1.5 motion-reduce:[&_[data-slot=accordion-content]]:animate-none"
                >
                  <ContactSection
                    value="details"
                    title={t('tabs.details')}
                    icon={ContactRound}
                    keepMounted
                  >
                    <form
                      id={detailsFormId}
                      noValidate
                      onSubmit={(event) => {
                        event.preventDefault();
                        if (!savingDetails) void saveDetails();
                      }}
                      className="space-y-1.5"
                    >
                      <div className="grid gap-1">
                        <Label
                          htmlFor={`${detailsFormId}-name`}
                          className="text-muted-foreground text-[0.8125rem]"
                        >
                          {t('name')}
                        </Label>
                        <Input
                          id={`${detailsFormId}-name`}
                          autoComplete="name"
                          value={editName}
                          onChange={(e) => setEditName(e.target.value)}
                          className="bg-background/30 h-9 md:h-8.5"
                        />
                      </div>
                      <div className="grid gap-1">
                        <Label
                          htmlFor={`${detailsFormId}-phone`}
                          className="text-muted-foreground text-[0.8125rem]"
                        >
                          {t('phone')}{' '}
                          <span
                            aria-hidden="true"
                            className="text-red-500 dark:text-red-400"
                          >
                            *
                          </span>
                        </Label>
                        <Input
                          id={`${detailsFormId}-phone`}
                          type="tel"
                          autoComplete="tel"
                          aria-required="true"
                          value={editPhone}
                          onChange={(e) => setEditPhone(e.target.value)}
                          className="bg-background/30 h-9 md:h-8.5"
                        />
                      </div>
                      <div className="grid gap-1">
                        <Label
                          htmlFor={`${detailsFormId}-email`}
                          className="text-muted-foreground text-[0.8125rem]"
                        >
                          {t('email')}
                        </Label>
                        <Input
                          id={`${detailsFormId}-email`}
                          type="email"
                          autoComplete="email"
                          value={editEmail}
                          onChange={(e) => setEditEmail(e.target.value)}
                          className="bg-background/30 h-9 md:h-8.5"
                        />
                      </div>
                      <div className="grid gap-1">
                        <Label
                          htmlFor={`${detailsFormId}-company`}
                          className="text-muted-foreground text-[0.8125rem]"
                        >
                          {t('company')}
                        </Label>
                        <Input
                          id={`${detailsFormId}-company`}
                          autoComplete="organization"
                          value={editCompany}
                          onChange={(e) => setEditCompany(e.target.value)}
                          className="bg-background/30 h-9 md:h-8.5"
                        />
                      </div>
                    </form>
                  </ContactSection>

                  <ContactSection
                    value="leads"
                    title={t('tabs.leads')}
                    icon={TrendingUp}
                  >
                    {accountId && (
                      <ContactLeads
                        accountId={accountId}
                        contactId={contact.id}
                      />
                    )}
                  </ContactSection>

                  <ContactSection
                    value="tags"
                    title={t('tabs.tags')}
                    icon={TagIcon}
                  >
                    {allTags.length === 0 ? (
                      <p className="text-muted-foreground text-sm">
                        {t('tagsTab.noTagsAvailable')}
                      </p>
                    ) : (
                      <div className="space-y-2">
                        <p className="text-muted-foreground text-xs">
                          {t('tagsTab.clickTagDesc')}
                        </p>
                        <div className="flex flex-wrap gap-2">
                          {allTags.map((tag) => {
                            const selected = contactTagIds.includes(tag.id);
                            return (
                              <button
                                key={tag.id}
                                type="button"
                                aria-pressed={selected}
                                onClick={() => toggleTag(tag.id)}
                                disabled={savingTags}
                                className={`text-foreground focus-visible:outline-ring inline-flex min-h-7 max-w-full cursor-pointer items-center gap-1 rounded-full border px-2.5 py-1 text-left text-xs font-medium focus-visible:outline-2 disabled:cursor-wait ${selected ? 'border-primary' : 'border-border hover:border-primary/60'}`}
                                style={{ backgroundColor: tag.color + '20' }}
                              >
                                {selected && (
                                  <Check
                                    aria-hidden="true"
                                    className="size-3 shrink-0"
                                  />
                                )}
                                <span
                                  className="size-2 shrink-0 rounded-full"
                                  style={{ backgroundColor: tag.color }}
                                />
                                <span className="[overflow-wrap:anywhere]">
                                  {tag.name}
                                </span>
                              </button>
                            );
                          })}
                        </div>
                      </div>
                    )}
                  </ContactSection>

                  <ContactSection
                    value="notes"
                    title={t('tabs.notes')}
                    icon={StickyNote}
                  >
                    <div className="space-y-2">
                      <Textarea
                        aria-label={t('notesTab.placeholder')}
                        value={newNote}
                        onChange={(e) => setNewNote(e.target.value)}
                        placeholder={t('notesTab.placeholder')}
                        className="bg-background/30 min-h-20"
                      />
                      <Button
                        onClick={addNote}
                        disabled={!newNote.trim() || savingNote}
                        size="sm"
                      >
                        {savingNote ? (
                          <Loader2 className="animate-spin" />
                        ) : (
                          <Plus />
                        )}
                        {t('notesTab.save')}
                      </Button>
                    </div>
                    <div className="mt-3 space-y-2">
                      {loadingNotes ? (
                        <Loader2 className="text-muted-foreground mx-auto my-4 size-5 animate-spin" />
                      ) : notes.length === 0 ? (
                        <p className="text-muted-foreground text-sm">
                          {t('notesTab.noNotes')}
                        </p>
                      ) : (
                        notes.map((note) => (
                          <div
                            key={note.id}
                            className="border-border/70 bg-background/30 rounded-lg border p-3"
                          >
                            <div className="flex items-start justify-between gap-2">
                              <p className="min-w-0 flex-1 text-sm [overflow-wrap:anywhere] whitespace-pre-wrap">
                                {note.note_text}
                              </p>
                              <Button
                                onClick={() => deleteNote(note.id)}
                                aria-label={t('actions.delete')}
                                variant="ghost"
                                size="icon-sm"
                                className="text-muted-foreground hover:text-destructive"
                              >
                                <Trash2 aria-hidden="true" />
                              </Button>
                            </div>
                            <p className="text-muted-foreground mt-1.5 text-xs">
                              {new Date(note.created_at).toLocaleDateString(
                                locale,
                                {
                                  month: 'short',
                                  day: 'numeric',
                                  year: 'numeric',
                                  hour: '2-digit',
                                  minute: '2-digit',
                                }
                              )}
                            </p>
                          </div>
                        ))
                      )}
                    </div>
                  </ContactSection>

                  <ContactSection
                    value="custom"
                    title={t('tabs.custom')}
                    icon={LayoutGrid}
                  >
                    {loadingCustom ? (
                      <Loader2 className="text-muted-foreground mx-auto my-4 size-5 animate-spin" />
                    ) : customFields.length === 0 ? (
                      <p className="text-muted-foreground text-sm">
                        {t('noCustomFields')}
                      </p>
                    ) : (
                      <div className="space-y-2.5">
                        {customFields.map((field) => (
                          <div key={field.id} className="space-y-1.5">
                            <Label
                              htmlFor={`${detailsFormId}-${field.id}`}
                              className="text-muted-foreground text-[0.8125rem] capitalize"
                            >
                              {field.field_name}
                            </Label>
                            <Input
                              id={`${detailsFormId}-${field.id}`}
                              value={customValues[field.id] ?? ''}
                              onChange={(e) =>
                                setCustomValues((prev) => ({
                                  ...prev,
                                  [field.id]: e.target.value,
                                }))
                              }
                              placeholder={t('enterCustomField', {
                                name: field.field_name,
                              })}
                              className="bg-background/30 h-9"
                            />
                          </div>
                        ))}
                        <Button
                          onClick={saveCustomFields}
                          disabled={savingCustom}
                          variant="outline"
                          size="sm"
                        >
                          {savingCustom ? (
                            <Loader2 className="animate-spin" />
                          ) : (
                            <Save />
                          )}
                          {t('saveCustomFieldsBtn')}
                        </Button>
                      </div>
                    )}
                  </ContactSection>
                </Accordion>
              </div>

              <SheetFooter className="border-border shrink-0 border-t px-4 py-2 pb-[max(0.5rem,env(safe-area-inset-bottom))]">
                <Button
                  type="submit"
                  form={detailsFormId}
                  disabled={savingDetails}
                  className="from-primary to-primary-hover h-11 w-full bg-linear-to-r hover:brightness-110"
                >
                  {savingDetails ? (
                    <Loader2 className="animate-spin" />
                  ) : (
                    <Save />
                  )}
                  {t('saveChangesBtn')}
                </Button>
              </SheetFooter>
            </>
          )}
        </SheetContent>
      </Sheet>
      <TemplatePicker
        open={templatePickerOpen}
        onOpenChange={setTemplatePickerOpen}
        onSelect={handleSendTemplate}
      />
    </>
  );
}
