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

@Component({
  selector: 'app-chat-stage',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './chat-stage.component.html',
  styleUrls: ['./chat-stage.component.scss'],
})
export class ChatStageComponent implements OnInit, OnChanges {
  private sessionsService = inject(SessionsService);
  private modelsService = inject(ModelsService);
  private authService = inject(AuthService);
  private sanitizer = inject(DomSanitizer);

  @ViewChild('messagesScroll') private messagesScrollContainer!: ElementRef<HTMLDivElement>;
  @ViewChild('chatTextarea') private chatTextareaElement!: ElementRef<HTMLTextAreaElement>;

  // Input & Output
  sessionId = input.required<string>();
  close = output<void>();
  switchSession = output<string>();
  startNewSessionRequest = output<void>();

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
    this.loadSession(this.sessionId());
    this.loadCatalogModels();
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
          this.streamingTokens.update((prev) => prev + token);
          this.scrollToBottom();
        },
      );

      // Replace optimistic message with canonical state or append complete assistant message
      this.messages.update((list) => [...list, result.message]);
      this.isStreaming.set(false);
      this.streamingTokens.set('');
      this.scrollToBottom();
    } catch (err: any) {
      console.error('Failed to stream response:', err);
      this.isStreaming.set(false);
      this.streamingTokens.set('');
      alert(err.message || 'Error occurred during generation. Please try again.');
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
          this.streamingTokens.update((prev) => prev + token);
          this.scrollToBottom();
        },
      );

      this.messages.update((list) => [...list, result.message]);
      this.isStreaming.set(false);
      this.isRerolling.set(false);
      this.streamingTokens.set('');
      this.scrollToBottom();
    } catch (err: any) {
      console.error('Reroll failed:', err);
      this.isStreaming.set(false);
      this.isRerolling.set(false);
      this.streamingTokens.set('');
      // Reload session to restore canonical state
      this.loadSession(currentSession.id);
      alert(err.message || 'Reroll failed. Session reloaded.');
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
    try {
      return JSON.parse(jsonStr);
    } catch {
      return jsonStr;
    }
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

  formatRoleplayText(content: string): SafeHtml {
    if (!content) return '';

    // Sanitize raw text to prevent XSS
    let escaped = this.sanitizer.sanitize(SecurityContext.HTML, content) || '';

    // Style actions in asterisks: *action* -> <em class="rp-action">*action*</em>
    escaped = escaped.replace(/\*([^*\n]+)\*/g, '<em class="rp-action">*$1*</em>');

    // Style spoken dialogue in quotes: "dialogue" -> <span class="rp-dialogue">"$1"</span>
    escaped = escaped.replace(/"([^"\n]+)"/g, '<span class="rp-dialogue">"$1"</span>');

    // Replace linebreaks with <br>
    escaped = escaped.replace(/\n/g, '<br>');

    return this.sanitizer.bypassSecurityTrustHtml(escaped);
  }
}
