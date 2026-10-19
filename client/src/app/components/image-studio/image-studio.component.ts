import { Component, OnInit, inject, signal, computed, output } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ImagesService, GeneratedImageItem } from '../../services/images.service';
import { ModelsService, ModelSummary } from '../../services/models.service';
import { AuthService } from '../../services/auth.service';
import { ModelPickerTableComponent } from '../model-picker-table/model-picker-table.component';

@Component({
  selector: 'app-image-studio',
  standalone: true,
  imports: [CommonModule, FormsModule, ModelPickerTableComponent],
  templateUrl: './image-studio.component.html',
  styleUrls: ['./image-studio.component.scss'],
})
export class ImageStudioComponent implements OnInit {
  imagesService = inject(ImagesService);
  modelsService = inject(ModelsService);
  authService = inject(AuthService);

  close = output<void>();

  // Active generation mode
  activeMode = signal<'text-to-image' | 'image-to-image'>('text-to-image');

  // Models state
  t2iModels = signal<ModelSummary[]>([]);
  i2iModels = signal<ModelSummary[]>([]);
  selectedT2IModel = signal<string>('');
  selectedI2IModel = signal<string>('');
  showModelPicker = signal<boolean>(false);

  // Generation Inputs
  promptText = signal<string>('');
  aspectRatio = signal<string>('1:1');
  seedInput = signal<string>('');

  // Dynamic Model Schema Parameters (from Wiro Tool/Detail)
  modelRatioOptions = signal<{ value: string; text: string }[]>([
    { value: '1:1', text: '1:1 Square' },
    { value: '3:4', text: '3:4 Portrait' },
    { value: '4:3', text: '4:3 Landscape' },
    { value: '16:9', text: '16:9 Widescreen' },
    { value: '9:16', text: '9:16 Vertical' },
  ]);
  modelExtraSchemaParams = signal<any[]>([]);
  extraParamValues = signal<Record<string, string>>({});

  // I2I Reference Image State
  referenceImageBase64 = signal<string | null>(null);
  referenceImageName = signal<string>('');
  referenceImageUrl = signal<string>('');
  showReferenceGalleryPicker = signal<boolean>(false);

  // Execution & Status State
  generating = signal<boolean>(false);
  elapsedSeconds = signal<number>(0);
  private timerHandle: any = null;
  notification = signal<{ type: 'success' | 'error' | 'info'; message: string } | null>(null);

  // Backend Image Store / Gallery State
  images = signal<GeneratedImageItem[]>([]);
  loadingGallery = signal<boolean>(false);
  galleryFilter = signal<'all' | 'text-to-image' | 'image-to-image' | 'avatar'>('all');
  selectedImage = signal<GeneratedImageItem | null>(null);
  showRawDebugJson = signal<boolean>(false);

  // Computed helpers
  currentModeModels = computed(() =>
    this.activeMode() === 'text-to-image' ? this.t2iModels() : this.i2iModels(),
  );

  currentSelectedModelSlug = computed(() =>
    this.activeMode() === 'text-to-image' ? this.selectedT2IModel() : this.selectedI2IModel(),
  );

  resolvedCurrentModel = computed(() => {
    const slug = this.currentSelectedModelSlug();
    const list = this.currentModeModels();
    if (!slug) return list[0] || null;
    const target = slug.trim().toLowerCase();
    return (
      list.find(
        (m) =>
          m.slug.toLowerCase() === target ||
          m.id.toLowerCase() === target ||
          m.title.toLowerCase() === target,
      ) || null
    );
  });

  filteredGallery = computed(() => {
    const filter = this.galleryFilter();
    const all = this.images();
    if (filter === 'all') return all;
    return all.filter((img) => img.mode === filter);
  });

  formattedRawJson = computed(() => {
    const sel = this.selectedImage();
    if (!sel?.raw_response_json) return '';
    try {
      return JSON.stringify(JSON.parse(sel.raw_response_json), null, 2);
    } catch {
      return sel.raw_response_json;
    }
  });

  ngOnInit() {
    this.loadModels();
    this.loadGallery();
  }

  private schemaSyncCounter = 0;

  loadModels() {
    this.modelsService.getCatalog('text-to-image').subscribe({
      next: (res) => {
        this.t2iModels.set(res.models || []);
        if (this.selectedT2IModel()) {
          this.syncSelectedModelSchema();
        }
      },
    });
    this.modelsService.getCatalog('image-to-image').subscribe({
      next: (res) => {
        this.i2iModels.set(res.models || []);
        if (this.selectedI2IModel()) {
          this.syncSelectedModelSchema();
        }
      },
    });
    this.modelsService.getActiveDefaults().subscribe({
      next: (active) => {
        if (!this.selectedT2IModel()) {
          this.selectedT2IModel.set(active.effective.textToImageModel);
        }
        if (!this.selectedI2IModel()) {
          this.selectedI2IModel.set(active.effective.imageToImageModel);
        }
        this.syncSelectedModelSchema();
      },
    });
  }

  syncSelectedModelSchema() {
    const model = this.resolvedCurrentModel();
    if (!model) return;

    const reqId = ++this.schemaSyncCounter;
    const targetSlug = `${model.slugowner}/${model.slugproject}`.toLowerCase();

    // Clear stale parameters immediately when switching models
    this.modelExtraSchemaParams.set([]);
    this.extraParamValues.set({});

    this.modelsService.getModelDetail(model.slugowner, model.slugproject).subscribe({
      next: (res) => {
        // Ignore stale responses if the user or default loader switched models in the meantime
        const currentModel = this.resolvedCurrentModel();
        const currentSlug = currentModel
          ? `${currentModel.slugowner}/${currentModel.slugproject}`.toLowerCase()
          : '';
        if (reqId !== this.schemaSyncCounter || currentSlug !== targetSlug) {
          return;
        }

        const rawParams = Array.isArray(res?.detail?.parameters) ? res.detail.parameters : [];
        const flat: any[] = rawParams.flatMap((g: any) =>
          Array.isArray(g?.items) ? g.items : [g],
        );

        const defaultRatioOpts = [
          { value: '1:1', text: '1:1 Square' },
          { value: '3:4', text: '3:4 Portrait' },
          { value: '4:3', text: '4:3 Landscape' },
          { value: '16:9', text: '16:9 Widescreen' },
          { value: '9:16', text: '9:16 Vertical' },
        ];

        const ratioParam = flat.find(
          (p) => p?.id === 'ratio' || p?.id === 'aspectRatio' || p?.id === 'aspect_ratio',
        );
        if (ratioParam && Array.isArray(ratioParam.options) && ratioParam.options.length > 0) {
          const opts = ratioParam.options.map((o: any) => ({
            value: String(o.value ?? o),
            text: String(o.text ?? o.value ?? o),
          }));
          this.modelRatioOptions.set(opts);
          if (!opts.some((o: any) => o.value === this.aspectRatio())) {
            const defRatio = String(ratioParam.defaultvalue || opts[0].value);
            this.aspectRatio.set(defRatio);
          }
        } else {
          this.modelRatioOptions.set(defaultRatioOpts);
        }

        const extraParams: any[] = [];
        const defaultsMap: Record<string, string> = {};

        for (const p of flat) {
          const id = String(p?.id || '').trim();
          if (!id) continue;
          const pType = String(p.type || p.fieldtype || '').toLowerCase();
          if (
            id.toLowerCase() === 'prompt' ||
            id.toLowerCase() === 'seed' ||
            id === 'ratio' ||
            id === 'aspectRatio' ||
            id === 'aspect_ratio' ||
            pType === 'combinefileinput' ||
            pType === 'file' ||
            pType === 'image' ||
            /^input(image|video|audio|document)/i.test(id)
          ) {
            continue;
          }

          const defVal =
            p.defaultvalue !== undefined && p.defaultvalue !== null && typeof p.defaultvalue !== 'object'
              ? String(p.defaultvalue)
              : Array.isArray(p.options) && p.options.length > 0
                ? String(p.options[0].value ?? p.options[0])
                : '';

          extraParams.push(p);
          defaultsMap[id] = defVal;
        }

        this.modelExtraSchemaParams.set(extraParams);
        this.extraParamValues.set(defaultsMap);
      },
      error: () => {
        if (reqId !== this.schemaSyncCounter) return;
        this.modelExtraSchemaParams.set([]);
        this.extraParamValues.set({});
      },
    });
  }

  updateExtraParam(paramId: string, value: string) {
    this.extraParamValues.update((prev) => ({
      ...prev,
      [paramId]: value,
    }));
  }

  loadGallery() {
    if (!this.authService.isAuthenticated()) return;
    this.loadingGallery.set(true);
    this.imagesService.listImages().subscribe({
      next: (list) => {
        this.images.set(list);
        this.loadingGallery.set(false);
        if (!this.selectedImage() && list.length > 0) {
          this.selectedImage.set(list[0]);
        }
      },
      error: (err) => {
        this.loadingGallery.set(false);
        this.notification.set({
          type: 'error',
          message: `Failed loading image store: ${err.message}`,
        });
      },
    });
  }

  switchMode(mode: 'text-to-image' | 'image-to-image') {
    this.activeMode.set(mode);
    this.showModelPicker.set(false);
    this.syncSelectedModelSchema();
  }

  onSelectModel(slug: string) {
    if (this.activeMode() === 'text-to-image') {
      this.selectedT2IModel.set(slug);
    } else {
      this.selectedI2IModel.set(slug);
    }
    this.showModelPicker.set(false);
    this.syncSelectedModelSchema();
  }

  onFileSelected(event: Event) {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    if (!file) return;
    this.readReferenceFile(file);
  }

  onFileDropped(event: DragEvent) {
    event.preventDefault();
    const file = event.dataTransfer?.files?.[0];
    if (file && file.type.startsWith('image/')) {
      this.readReferenceFile(file);
    }
  }

  private readReferenceFile(file: File) {
    const reader = new FileReader();
    reader.onload = () => {
      this.referenceImageBase64.set(reader.result as string);
      this.referenceImageName.set(file.name);
      this.referenceImageUrl.set('');
    };
    reader.readAsDataURL(file);
  }

  clearReferenceImage() {
    this.referenceImageBase64.set(null);
    this.referenceImageName.set('');
    this.referenceImageUrl.set('');
  }

  useStoredImageAsReference(img: GeneratedImageItem) {
    this.activeMode.set('image-to-image');
    this.referenceImageBase64.set(null);
    this.referenceImageName.set(`Stored: ${img.id}`);
    this.referenceImageUrl.set(img.image_url);
    this.showReferenceGalleryPicker.set(false);
    this.syncSelectedModelSchema();
    this.notification.set({
      type: 'info',
      message: `Loaded '${img.id}' as reference image for Image-to-Image generation.`,
    });
  }

  runGeneration() {
    const prompt = this.promptText().trim();
    if (!prompt) {
      this.notification.set({
        type: 'error',
        message: 'Please enter a prompt or description first.',
      });
      return;
    }

    if (
      this.activeMode() === 'image-to-image' &&
      !this.referenceImageBase64() &&
      !this.referenceImageUrl().trim()
    ) {
      this.notification.set({
        type: 'error',
        message: 'Please upload a reference image or pick one from the Saved Store for Image-to-Image.',
      });
      return;
    }

    this.generating.set(true);
    this.elapsedSeconds.set(0);
    this.notification.set(null);
    if (this.timerHandle) clearInterval(this.timerHandle);
    this.timerHandle = setInterval(() => {
      this.elapsedSeconds.update((s) => s + 1);
    }, 1000);

    const extraParams: Record<string, any> = {
      ...this.extraParamValues(),
    };
    if (this.seedInput().trim()) {
      extraParams['seed'] = this.seedInput().trim();
    }

    if (this.activeMode() === 'text-to-image') {
      this.imagesService
        .generateTextToImage({
          prompt,
          model: this.selectedT2IModel() || undefined,
          aspectRatio: this.aspectRatio(),
          mode: 'text-to-image',
          extraParams,
        })
        .subscribe({
          next: (created) => this.handleGenerationSuccess(created),
          error: (err) => this.handleGenerationError(err),
        });
    } else {
      this.imagesService
        .generateImageToImage({
          prompt,
          referenceImageBase64: this.referenceImageBase64() || undefined,
          referenceImageUrl: this.referenceImageUrl().trim() || undefined,
          model: this.selectedI2IModel() || undefined,
          aspectRatio: this.aspectRatio(),
          extraParams,
        })
        .subscribe({
          next: (created) => this.handleGenerationSuccess(created),
          error: (err) => this.handleGenerationError(err),
        });
    }
  }

  private handleGenerationSuccess(created: GeneratedImageItem) {
    this.generating.set(false);
    if (this.timerHandle) {
      clearInterval(this.timerHandle);
      this.timerHandle = null;
    }
    this.images.update((list) => [created, ...list]);
    this.selectedImage.set(created);
    this.notification.set({
      type: 'success',
      message: `Image generated in ${((created.latency_ms || 0) / 1000).toFixed(1)}s and saved to ${created.file_path}!`,
    });
  }

  private handleGenerationError(err: any) {
    this.generating.set(false);
    if (this.timerHandle) {
      clearInterval(this.timerHandle);
      this.timerHandle = null;
    }
    this.notification.set({
      type: 'error',
      message: err.error?.message || `Generation failed: ${err.message}`,
    });
  }

  deleteImage(img: GeneratedImageItem, event?: Event) {
    if (event) event.stopPropagation();
    if (!confirm(`Delete image '${img.id}' permanently from the server store?`)) {
      return;
    }

    this.imagesService.deleteImage(img.id).subscribe({
      next: () => {
        const remaining = this.images().filter((i) => i.id !== img.id);
        this.images.set(remaining);
        if (this.selectedImage()?.id === img.id) {
          this.selectedImage.set(remaining[0] || null);
        }
        this.notification.set({
          type: 'info',
          message: `Deleted ${img.id} from disk and database.`,
        });
      },
      error: (err) => {
        this.notification.set({
          type: 'error',
          message: err.error?.message || `Failed to delete image: ${err.message}`,
        });
      },
    });
  }

  copyImageUrl(url: string) {
    navigator.clipboard?.writeText(window.location.origin + url);
    this.notification.set({
      type: 'info',
      message: `Copied image URL to clipboard: ${url}`,
    });
  }

  formatBytes(bytes?: number | null): string {
    if (!bytes) return '—';
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1048576) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / 1048576).toFixed(2)} MB`;
  }
}
