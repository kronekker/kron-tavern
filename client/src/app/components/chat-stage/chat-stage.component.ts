import {
  Component,
  OnInit,
  OnChanges,
  SimpleChanges,
  inject,
  signal,
  computed,
  input,
  output,
  ElementRef,
  ViewChild,
  SecurityContext,
  NgZone,
  ChangeDetectorRef,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { DomSanitizer, SafeHtml } from '@angular/platform-browser';
import {
  SessionsService,
  SessionItem,
  ChatMessageItem,
  CompressionItem,
  TurnTraceItem,
} from '../../services/sessions.service';
import { AuthService } from '../../services/auth.service';
import { ModelsService, ModelSummary } from '../../services/models.service';
import { ImagesService, GeneratedImageItem } from '../../services/images.service';
import { MemoriesService, EpisodicMemoryItem } from '../../services/memories.service';
import { ModelPickerTableComponent } from '../model-picker-table/model-picker-table.component';

@Component({
  selector: 'app-chat-stage',
  standalone: true,
  imports: [CommonModule, FormsModule, ModelPickerTableComponent],
  templateUrl: './chat-stage.component.html',
  styleUrls: ['./chat-stage.component.scss'],
})
export class ChatStageComponent implements OnInit, OnChanges {
  private sessionsService = inject(SessionsService);
  private modelsService = inject(ModelsService);
  private imagesService = inject(ImagesService);
  private memoriesService = inject(MemoriesService);
  private authService = inject(AuthService);
  private sanitizer = inject(DomSanitizer);
  private ngZone = inject(NgZone);
  private cdr = inject(ChangeDetectorRef);

  @ViewChild('messagesScroll') private messagesScrollContainer!: ElementRef<HTMLDivElement>;
  @ViewChild('chatTextarea') private chatTextareaElement!: ElementRef<HTMLTextAreaElement>;

  // Input & Output
  sessionId = input.required<string>();
  isAppNavbarCollapsed = input<boolean>(false);
  toggleAppNavbar = output<void>();
  setAppNavbarCollapsed = output<boolean>();
  close = output<void>();
  switchSession = output<string>();
  startNewSessionRequest = output<void>();
  openSessionsModal = output<void>();

  // Collapsible Stage Header State (for mobile & compact chat real estate)
  isStageHeaderCollapsed = signal<boolean>(false);

  // Main Session State
  loading = signal<boolean>(true);
  error = signal<string | null>(null);
  session = signal<SessionItem | null>(null);
  character = signal<any | null>(null);
  persona = signal<any | null>(null);
  messages = signal<ChatMessageItem[]>([]);
  activeCompression = signal<CompressionItem | null>(null);

  // Streaming State
  isStreaming = signal<boolean>(false);
  streamingTokens = signal<string>('');

  // User input & reply wizard
  userInput = signal<string>('');
  isSuggestingReply = signal<boolean>(false);

  // Inline Message Editing
  editingMessageId = signal<string | null>(null);
  editMessageText = signal<string>('');
  isSavingEdit = signal<boolean>(false);

  // Rewind Dialog State
  rewindTargetMessage = signal<ChatMessageItem | null>(null);
  isRewinding = signal<boolean>(false);

  // Reroll Dialog & Guidance State
  showRerollModal = signal<boolean>(false);
  rerollSuggestion = signal<string>('');
  isRerolling = signal<boolean>(false);

  // Turn Inspector State
  showInspectorModal = signal<boolean>(false);
  inspectingTrace = signal<TurnTraceItem | null>(null);
  inspectingTab = signal<'metrics' | 'lore' | 'memories' | 'raw_prompt' | 'raw_response'>('metrics');
  rawPayloadViewMode = signal<'formatted' | 'json'>('formatted');

  // Compression Editor / Creator Modal
  showCompressionModal = signal<boolean>(false);
  compressionBoundaryMessageId = signal<string | null>(null);
  customSummaryInput = signal<string>('');
  isCompressing = signal<boolean>(false);

  // Active Compression Edit Modal
  showEditActiveCompressionModal = signal<boolean>(false);
  editActiveCompressionText = signal<string>('');

  // Model Triad Switcher Modal
  showModelConfigModal = signal<boolean>(false);
  editChatModel = signal<string>('');
  editTextToImageModel = signal<string>('');
  editImageToImageModel = signal<string>('');
  chatModelsList = signal<ModelSummary[]>([]);
  textToImageModelsList = signal<ModelSummary[]>([]);
  imageToImageModelsList = signal<ModelSummary[]>([]);
  isSavingModels = signal<boolean>(false);

  // Session Background Image Modal
  showBackgroundModal = signal<boolean>(false);
  storeImagesList = signal<GeneratedImageItem[]>([]);
  loadingStoreImages = signal<boolean>(false);
  backgroundFilter = signal<'all' | 'avatar' | 'text-to-image' | 'image-to-image'>('all');
  isSavingBackground = signal<boolean>(false);

  filteredStoreImages = computed(() => {
    const f = this.backgroundFilter();
    const list = this.storeImagesList();
    if (f === 'all') return list;
    return list.filter((img) => img.mode === f);
  });

  activeBackgroundUrl = computed(() => {
    return this.session()?.background_image_url || null;
  });

  // Episodic Memories Manager Modal
  showMemoriesModal = signal<boolean>(false);
  episodicMemoriesList = signal<EpisodicMemoryItem[]>([]);
  loadingMemories = signal<boolean>(false);
  extractingMemories = signal<boolean>(false);
  memoriesFilterScope = signal<'all' | 'session' | 'user'>('all');
  newMemoryText = signal<string>('');
  newMemoryImportance = signal<number>(6);
  newMemoryScope = signal<'session' | 'user'>('session');
  isCreatingMemory = signal<boolean>(false);
  editingMemoryId = signal<string | null>(null);
  editingMemoryText = signal<string>('');
  editingMemoryImportance = signal<number>(6);

  filteredEpisodicMemories = computed(() => {
    const scope = this.memoriesFilterScope();
    const list = this.episodicMemoriesList();
    if (scope === 'all') return list;
    return list.filter((m) => m.scope === scope);
  });

  // Sessions Drawer (Switcher)
  showSessionsDrawer = signal<boolean>(false);
  userSessionsList = signal<SessionItem[]>([]);
  loadingSessionsList = signal<boolean>(false);

  // Computed Token Counter & Info
  messageCount = computed(() => this.messages().length);
  latestMessage = computed(() => {
    const list = this.messages();
    return list.length > 0 ? list[list.length - 1] : null;
  });

  ngOnInit() {
    if (typeof window !== 'undefined' && window.innerWidth <= 768) {
      this.isStageHeaderCollapsed.set(true);
      this.setAppNavbarCollapsed.emit(true);
    }
    this.loadSession(this.sessionId());
    this.loadCatalogModels();
  }

  collapseTopToolbars() {
    this.isStageHeaderCollapsed.set(true);
    this.setAppNavbarCollapsed.emit(true);
  }

  restoreStageToolbar() {
    this.isStageHeaderCollapsed.set(false);
  }

  restoreAllToolbars() {
    this.isStageHeaderCollapsed.set(false);
    this.setAppNavbarCollapsed.emit(false);
  }

  ngOnChanges(changes: SimpleChanges) {
    if (changes['sessionId'] && !changes['sessionId'].firstChange) {
      this.loadSession(this.sessionId());
    }
  }

  loadSession(id: string) {
    this.loading.set(true);
    this.error.set(null);

    this.sessionsService.get(id).subscribe({
      next: (res) => {
        this.session.set(res.session);
        this.character.set(res.character);
        this.persona.set(res.persona);
        this.messages.set(res.messages || []);
        this.activeCompression.set(res.compression || null);
        this.loading.set(false);
        this.scrollToBottom();
      },
      error: (err) => {
        this.error.set(err.error?.message || 'Failed to load session details.');
        this.loading.set(false);
      },
    });
  }

  loadCatalogModels() {
    this.modelsService.getCatalog('chat').subscribe({
      next: (res) => this.chatModelsList.set(res.models || []),
    });
    this.modelsService.getCatalog('text-to-image').subscribe({
      next: (res) => this.textToImageModelsList.set(res.models || []),
    });
    this.modelsService.getCatalog('image-to-image').subscribe({
      next: (res) => this.imageToImageModelsList.set(res.models || []),
    });
  }

  // --- Sending Message & Streaming Response ---

  async sendMessage() {
    const text = this.userInput().trim();
    if (!text || this.isStreaming()) return;

    const currentSession = this.session();
    const currentPersona = this.persona();
    if (!currentSession) return;

    // Optimistically add user message to timeline
    const tempUserMsgId = `temp_${Date.now()}`;
    const userMsg: ChatMessageItem = {
      id: tempUserMsgId,
      session_id: currentSession.id,
      sender_type: 'user',
      sender_id: currentPersona?.id,
      sender_name: currentPersona?.name || 'You',
      sender_avatar: currentPersona?.avatar_url,
      content: text,
      is_canonical: 1,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };

    this.messages.update((list) => [...list, userMsg]);
    this.userInput.set('');
    this.isStreaming.set(true);
    this.streamingTokens.set('');
    this.scrollToBottom();

    try {
      const result = await this.sessionsService.sendMessageStream(
        currentSession.id,
        text,
        (token: string) => {
          this.ngZone.run(() => {
            this.streamingTokens.update((prev) => prev + token);
            this.cdr.detectChanges();
            this.scrollToBottom();
          });
        },
      );

      this.ngZone.run(() => {
        // Replace optimistic message with canonical state or append complete assistant message
        this.messages.update((list) => [...list, result.message]);
        this.isStreaming.set(false);
        this.streamingTokens.set('');
        this.cdr.detectChanges();
        this.scrollToBottom();
      });
    } catch (err: any) {
      this.ngZone.run(() => {
        console.error('Failed to stream response:', err);
        this.isStreaming.set(false);
        this.streamingTokens.set('');
        this.cdr.detectChanges();
        alert(err.message || 'Error occurred during generation. Please try again.');
      });
    }
  }

  // --- Auto-Generate User Reply Wizard ---

  suggestReply() {
    const currentSession = this.session();
    if (!currentSession || this.isSuggestingReply() || this.isStreaming()) return;

    this.isSuggestingReply.set(true);
    this.sessionsService.suggestReply(currentSession.id).subscribe({
      next: (res) => {
        this.userInput.set(res.suggestedText);
        this.isSuggestingReply.set(false);
        // Focus textarea so user can review/edit immediately
        setTimeout(() => {
          if (this.chatTextareaElement?.nativeElement) {
            this.chatTextareaElement.nativeElement.focus();
          }
        }, 50);
      },
      error: (err) => {
        console.error('Reply suggestion error:', err);
        this.isSuggestingReply.set(false);
        alert(err.error?.message || 'Could not auto-generate reply suggestion.');
      },
    });
  }

  // --- Reroll Latest Turn ---

  openRerollModal() {
    this.rerollSuggestion.set('');
    this.showRerollModal.set(true);
  }

  async executeReroll(useSuggestion = false) {
    const currentSession = this.session();
    if (!currentSession || this.isStreaming() || this.isRerolling()) return;

    const directive = useSuggestion ? this.rerollSuggestion().trim() : undefined;
    this.showRerollModal.set(false);
    this.isRerolling.set(true);
    this.isStreaming.set(true);
    this.streamingTokens.set('');

    // Remove latest character turn from UI temporarily while streaming new one
    this.messages.update((list) => {
      const last = list[list.length - 1];
      if (last && last.sender_type === 'character') {
        return list.slice(0, -1);
      }
      return list;
    });
    this.scrollToBottom();

    try {
      const result = await this.sessionsService.rerollStream(
        currentSession.id,
        directive,
        (token: string) => {
          this.ngZone.run(() => {
            this.streamingTokens.update((prev) => prev + token);
            this.cdr.detectChanges();
            this.scrollToBottom();
          });
        },
      );

      this.ngZone.run(() => {
        this.messages.update((list) => [...list, result.message]);
        this.isStreaming.set(false);
        this.isRerolling.set(false);
        this.streamingTokens.set('');
        this.cdr.detectChanges();
        this.scrollToBottom();
      });
    } catch (err: any) {
      this.ngZone.run(() => {
        console.error('Reroll failed:', err);
        this.isStreaming.set(false);
        this.isRerolling.set(false);
        this.streamingTokens.set('');
        this.cdr.detectChanges();
        // Reload session to restore canonical state
        this.loadSession(currentSession.id);
        alert(err.message || 'Reroll failed. Session reloaded.');
      });
    }
  }

  // --- Inline Message Editing ---

  startEditMessage(msg: ChatMessageItem) {
    this.editingMessageId.set(msg.id);
    this.editMessageText.set(msg.content);
  }

  cancelEditMessage() {
    this.editingMessageId.set(null);
    this.editMessageText.set('');
  }

  saveEditMessage(msgId: string) {
    const currentSession = this.session();
    const newContent = this.editMessageText().trim();
    if (!currentSession || !newContent || this.isSavingEdit()) return;

    this.isSavingEdit.set(true);
    this.sessionsService.editMessage(currentSession.id, msgId, newContent).subscribe({
      next: (updated) => {
        this.messages.update((list) =>
          list.map((m) => (m.id === msgId ? { ...m, content: updated.content, updated_at: updated.updated_at } : m)),
        );
        this.editingMessageId.set(null);
        this.isSavingEdit.set(false);
      },
      error: (err) => {
        this.isSavingEdit.set(false);
        alert(err.error?.message || 'Failed to save message edit.');
      },
    });
  }

  // --- Rewind Session Timeline ---

  promptRewind(msg: ChatMessageItem) {
    this.rewindTargetMessage.set(msg);
  }

  cancelRewind() {
    this.rewindTargetMessage.set(null);
  }

  executeRewind() {
    const target = this.rewindTargetMessage();
    const currentSession = this.session();
    if (!target || !currentSession || this.isRewinding()) return;

    this.isRewinding.set(true);
    this.sessionsService.rewind(currentSession.id, target.id).subscribe({
      next: () => {
        this.isRewinding.set(false);
        this.rewindTargetMessage.set(null);
        this.loadSession(currentSession.id);
      },
      error: (err) => {
        this.isRewinding.set(false);
        alert(err.error?.message || 'Failed to rewind session.');
      },
    });
  }

  // --- Context Compression Management ---

  openCompressModal(boundaryMsgId?: string) {
    // If not specified, select message roughly at midpoint of history
    const msgs = this.messages();
    const fallbackId = boundaryMsgId || (msgs.length > 2 ? msgs[Math.floor(msgs.length / 2)].id : msgs[0]?.id);
    this.compressionBoundaryMessageId.set(fallbackId || null);
    this.customSummaryInput.set('');
    this.showCompressionModal.set(true);
  }

  executeCompress() {
    const currentSession = this.session();
    const boundaryId = this.compressionBoundaryMessageId();
    if (!currentSession || !boundaryId || this.isCompressing()) return;

    this.isCompressing.set(true);
    this.sessionsService
      .compress(currentSession.id, boundaryId, this.customSummaryInput().trim() || undefined)
      .subscribe({
        next: (compression) => {
          this.activeCompression.set(compression);
          this.showCompressionModal.set(false);
          this.isCompressing.set(false);
        },
        error: (err) => {
          this.isCompressing.set(false);
          alert(err.error?.message || 'Failed to create context compression.');
        },
      });
  }

  openEditActiveCompression() {
    const comp = this.activeCompression();
    if (!comp) return;
    this.editActiveCompressionText.set(comp.summary_text);
    this.showEditActiveCompressionModal.set(true);
  }

  saveActiveCompression() {
    const comp = this.activeCompression();
    const currentSession = this.session();
    const text = this.editActiveCompressionText().trim();
    if (!comp || !currentSession || !text) return;

    this.sessionsService.updateCompression(currentSession.id, comp.id, text).subscribe({
      next: (updated) => {
        this.activeCompression.set(updated);
        this.showEditActiveCompressionModal.set(false);
      },
      error: (err) => {
        alert(err.error?.message || 'Failed to update compression narrative.');
      },
    });
  }

  // --- Turn Inspector ---

  inspectTurn(msg: ChatMessageItem) {
    if (msg.trace) {
      this.inspectingTrace.set(msg.trace);
      this.inspectingTab.set('metrics');
      this.showInspectorModal.set(true);
    } else {
      const currentSession = this.session();
      if (!currentSession) return;
      this.sessionsService.getTrace(currentSession.id, msg.id).subscribe({
        next: (trace) => {
          if (trace) {
            this.inspectingTrace.set(trace);
            this.inspectingTab.set('metrics');
            this.showInspectorModal.set(true);
          } else {
            alert('No trace recorded for this turn (turn may be a system greeting or legacy message).');
          }
        },
        error: () => {
          alert('Could not retrieve turn trace.');
        },
      });
    }
  }

  closeInspector() {
    this.showInspectorModal.set(false);
    this.inspectingTrace.set(null);
  }

  parseJsonSafely(jsonStr: string | null | undefined): any {
    if (!jsonStr) return null;
    if (typeof jsonStr === 'object') return jsonStr;
    try {
      return JSON.parse(jsonStr);
    } catch {
      return jsonStr;
    }
  }

  formatJsonPretty(jsonStr: string | null | undefined, expandNewlines = true): string {
    if (!jsonStr) return '';
    const parsed = this.parseJsonSafely(jsonStr);
    if (typeof parsed === 'string') {
      return parsed;
    }
    const pretty = JSON.stringify(parsed, null, 2);
    if (!expandNewlines) {
      return pretty;
    }
    // Expand escaped \n and \" inside JSON string values so multi-line prompts/responses are easy to read
    return pretty.replace(/^(\s*"[^"]+":\s*")((?:[^"\\]|\\.)*)("(?:\s*,)?)$/gm, (_match, prefix, body, suffix) => {
      if (!body.includes('\\n')) {
        return `${prefix}${body}${suffix}`;
      }
      const indentMatch = prefix.match(/^(\s*)/);
      const childIndent = (indentMatch ? indentMatch[1] : '') + '  ';
      const unescaped = body
        .replace(/\\r\\n/g, '\n')
        .replace(/\\n/g, '\n' + childIndent)
        .replace(/\\"/g, '"')
        .replace(/\\t/g, '  ');
      return `${prefix}\n${childIndent}${unescaped}\n${indentMatch ? indentMatch[1] : ''}${suffix}`;
    });
  }

  // --- Session Model Configuration Modal ---

  openModelConfigModal() {
    const s = this.session();
    if (!s) return;
    this.editChatModel.set(s.chat_model);
    this.editTextToImageModel.set(s.text_to_image_model);
    this.editImageToImageModel.set(s.image_to_image_model);
    this.showModelConfigModal.set(true);
  }

  saveSessionModels() {
    const s = this.session();
    if (!s || this.isSavingModels()) return;

    this.isSavingModels.set(true);
    this.sessionsService
      .updateModels(s.id, {
        chatModel: this.editChatModel().trim(),
        textToImageModel: this.editTextToImageModel().trim(),
        imageToImageModel: this.editImageToImageModel().trim(),
      })
      .subscribe({
        next: (updatedSession) => {
          this.session.set(updatedSession);
          this.showModelConfigModal.set(false);
          this.isSavingModels.set(false);
        },
        error: (err) => {
          this.isSavingModels.set(false);
          alert(err.error?.message || 'Failed to update session models.');
        },
      });
  }

  // --- Session Background Picker Modal ---

  openBackgroundModal() {
    this.showBackgroundModal.set(true);
    this.loadingStoreImages.set(true);
    this.imagesService.listImages().subscribe({
      next: (list) => {
        this.storeImagesList.set(list || []);
        this.loadingStoreImages.set(false);
      },
      error: () => {
        this.loadingStoreImages.set(false);
      },
    });
  }

  selectBackgroundImage(imageUrl: string | null) {
    const s = this.session();
    if (!s || this.isSavingBackground()) return;

    this.isSavingBackground.set(true);
    this.sessionsService.updateBackground(s.id, imageUrl).subscribe({
      next: (updatedSession) => {
        this.session.set(updatedSession);
        this.isSavingBackground.set(false);
        this.showBackgroundModal.set(false);
      },
      error: (err) => {
        this.isSavingBackground.set(false);
        alert(err.error?.message || 'Failed to update session background.');
      },
    });
  }

  // --- Tier 2 Episodic Memories Manager Modal ---

  openMemoriesModal() {
    this.showMemoriesModal.set(true);
    this.loadEpisodicMemories();
  }

  loadEpisodicMemories() {
    const s = this.session();
    if (!s) return;
    this.loadingMemories.set(true);
    this.memoriesService.list({ sessionId: s.id }).subscribe({
      next: (list) => {
        this.episodicMemoriesList.set(list || []);
        this.loadingMemories.set(false);
      },
      error: () => {
        this.loadingMemories.set(false);
      },
    });
  }

  triggerExtractMemories() {
    const s = this.session();
    if (!s || this.extractingMemories()) return;

    this.extractingMemories.set(true);
    this.memoriesService.extractFromSession(s.id, 8).subscribe({
      next: () => {
        this.extractingMemories.set(false);
        this.loadEpisodicMemories();
      },
      error: (err) => {
        this.extractingMemories.set(false);
        alert(err.error?.message || 'Failed to extract episodic memories.');
      },
    });
  }

  createManualMemory() {
    const s = this.session();
    const text = this.newMemoryText().trim();
    if (!s || !text || this.isCreatingMemory()) return;

    this.isCreatingMemory.set(true);
    this.memoriesService
      .create({
        sessionId: s.id,
        characterId: s.character_id,
        memoryText: text,
        scope: this.newMemoryScope(),
        importance: this.newMemoryImportance(),
      })
      .subscribe({
        next: () => {
          this.newMemoryText.set('');
          this.newMemoryImportance.set(6);
          this.isCreatingMemory.set(false);
          this.loadEpisodicMemories();
        },
        error: (err) => {
          this.isCreatingMemory.set(false);
          alert(err.error?.message || 'Failed to create memory.');
        },
      });
  }

  toggleMemoryScope(mem: EpisodicMemoryItem) {
    const targetScope: 'session' | 'user' = mem.scope === 'user' ? 'session' : 'user';
    this.memoriesService.update(mem.id, { scope: targetScope }).subscribe({
      next: (updated) => {
        this.episodicMemoriesList.update((list) =>
          list.map((m) => (m.id === mem.id ? updated : m)),
        );
      },
      error: (err) => {
        alert(err.error?.message || 'Failed to update memory scope.');
      },
    });
  }

  startEditMemory(mem: EpisodicMemoryItem) {
    this.editingMemoryId.set(mem.id);
    this.editingMemoryText.set(mem.memory_text);
    this.editingMemoryImportance.set(mem.importance || 6);
  }

  cancelEditMemory() {
    this.editingMemoryId.set(null);
    this.editingMemoryText.set('');
  }

  saveEditMemory(memId: string) {
    const text = this.editingMemoryText().trim();
    if (!text) return;

    this.memoriesService
      .update(memId, {
        memoryText: text,
        importance: this.editingMemoryImportance(),
      })
      .subscribe({
        next: (updated) => {
          this.episodicMemoriesList.update((list) =>
            list.map((m) => (m.id === memId ? updated : m)),
          );
          this.editingMemoryId.set(null);
        },
        error: (err) => {
          alert(err.error?.message || 'Failed to update memory.');
        },
      });
  }

  deleteEpisodicMemory(memId: string) {
    if (!confirm('Delete this episodic memory and its vector embedding?')) return;
    this.memoriesService.delete(memId).subscribe({
      next: () => {
        this.episodicMemoriesList.update((list) => list.filter((m) => m.id !== memId));
      },
      error: (err) => {
        alert(err.error?.message || 'Failed to delete memory.');
      },
    });
  }

  // --- Session Switcher Drawer ---

  openSessionsDrawer() {
    this.showSessionsDrawer.set(true);
    this.loadingSessionsList.set(true);
    this.sessionsService.list().subscribe({
      next: (list) => {
        this.userSessionsList.set(list);
        this.loadingSessionsList.set(false);
      },
      error: () => {
        this.loadingSessionsList.set(false);
      },
    });
  }

  selectSessionFromDrawer(id: string) {
    this.showSessionsDrawer.set(false);
    if (id !== this.sessionId()) {
      this.switchSession.emit(id);
    }
  }

  deleteSession(id: string, event: Event) {
    event.stopPropagation();
    if (!confirm('Are you sure you want to delete this chat session? History cannot be restored.')) return;

    this.sessionsService.delete(id).subscribe({
      next: () => {
        this.userSessionsList.update((list) => list.filter((s) => s.id !== id));
        if (id === this.sessionId()) {
          this.close.emit();
        }
      },
      error: (err) => {
        alert(err.error?.message || 'Failed to delete session.');
      },
    });
  }

  // --- Helpers & UI Formatting ---

  onTextareaKeyDown(e: KeyboardEvent) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      this.sendMessage();
    }
  }

  scrollToBottom() {
    setTimeout(() => {
      if (this.messagesScrollContainer?.nativeElement) {
        const el = this.messagesScrollContainer.nativeElement;
        el.scrollTop = el.scrollHeight;
      }
    }, 20);
  }

  formatRoleplayText(content: string, isStreaming = false): SafeHtml {
    if (!content) return '';

    // 1. Sanitize raw text to prevent XSS while preserving quotes and formatting characters
    const escaped = content
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');

    // 2. Split by newline so each line break becomes a distinct span with vertical spacing
    const rawLines = escaped.split(/\r?\n/);
    const htmlLines: string[] = [];

    for (let i = 0; i < rawLines.length; i++) {
      let line = rawLines[i];
      const isLastLine = i === rawLines.length - 1;

      if (!line.trim()) {
        const spacerCursor = isStreaming && isLastLine ? '<span class="streaming-cursor">▌</span>' : '&nbsp;';
        htmlLines.push(`<span class="rp-line rp-line-spacer">${spacerCursor}</span>`);
        continue;
      }

      // 1. Temporarily replace dialogue quotes with placeholders so HTML class attributes are not matched
      line = line.replace(/(?:“|")([^“”"\n]+?)(?:”|")/g, '___RP_D_START___$1___RP_D_END___');

      // 2. Bold and italic formatting tags
      line = line.replace(/\*\*\*([^*\n]+?)\*\*\*/g, '<strong class="rp-bold"><em class="rp-action">$1</em></strong>');
      line = line.replace(/\*\*([^*\n]+?)\*\*/g, '<strong class="rp-bold">$1</strong>');
      line = line.replace(/\*([^*\n]+?)\*/g, '<em class="rp-action">$1</em>');

      // 3. Restore dialogue spans
      line = line.replace(/___RP_D_START___/g, '<span class="rp-dialogue">"');
      line = line.replace(/___RP_D_END___/g, '"</span>');

      // Append blinking cursor if streaming on the active last line
      const cursorHtml = isStreaming && isLastLine ? '<span class="streaming-cursor">▌</span>' : '';

      htmlLines.push(`<span class="rp-line">${line}${cursorHtml}</span>`);
    }

    return this.sanitizer.bypassSecurityTrustHtml(htmlLines.join(''));
  }
}
