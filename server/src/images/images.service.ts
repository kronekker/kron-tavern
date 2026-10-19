import {
  Injectable,
  Logger,
  NotFoundException,
  BadRequestException,
  ForbiddenException,
} from '@nestjs/common';
import {
  existsSync,
  mkdirSync,
  writeFileSync,
  readFileSync,
  unlinkSync,
  statSync,
} from 'node:fs';
import { resolve, join, extname } from 'node:path';
import { randomBytes } from 'node:crypto';
import { DatabaseService } from '../database/database.service.js';
import { ModelsService } from '../models/models.service.js';
import { AuthService } from '../auth/auth.service.js';
import { CryptoService } from '../auth/crypto.service.js';

export interface GeneratedImageItem {
  id: string;
  user_id: string;
  character_id?: string | null;
  character_name?: string | null;
  mode: 'text-to-image' | 'image-to-image' | 'avatar';
  prompt: string;
  model_used: string;
  file_path: string;
  image_url: string;
  reference_image_url?: string | null;
  aspect_ratio?: string | null;
  width?: number | null;
  height?: number | null;
  file_size_bytes?: number | null;
  latency_ms?: number | null;
  raw_response_json?: string | null;
  created_at: string;
  file_exists?: boolean;
}

export interface GenerateTextToImageDto {
  prompt: string;
  model?: string;
  aspectRatio?: string;
  characterId?: string;
  mode?: 'text-to-image' | 'avatar';
  extraParams?: Record<string, any>;
}

export interface GenerateImageToImageDto {
  prompt: string;
  referenceImageBase64?: string;
  referenceImageUrl?: string;
  model?: string;
  aspectRatio?: string;
  characterId?: string;
  extraParams?: Record<string, any>;
}

@Injectable()
export class ImagesService {
  private readonly logger = new Logger(ImagesService.name);
  private readonly imagesRootDir: string;

  constructor(
    private readonly dbService: DatabaseService,
    private readonly modelsService: ModelsService,
    private readonly authService: AuthService,
    private readonly cryptoService: CryptoService,
  ) {
    const isInsideServer = existsSync(resolve(process.cwd(), 'nest-cli.json'));
    const rootDir = isInsideServer ? resolve(process.cwd(), '..') : process.cwd();
    this.imagesRootDir = resolve(rootDir, 'data/images');
    this.ensureDirectories();
  }

  private get db() {
    return this.dbService.getDb();
  }

  private ensureDirectories() {
    for (const folder of ['avatars', 'studio', 'references']) {
      const dir = join(this.imagesRootDir, folder);
      if (!existsSync(dir)) {
        mkdirSync(dir, { recursive: true });
      }
    }
  }

  private resolveWiroApiKey(userId: string): string {
    const userKey = this.authService.getDecryptedWiroKey(userId);
    if (userKey) return userKey;

    // Fallback: check if any admin/user in the local DB has a configured Wiro key
    try {
      const row = this.db
        .prepare(
          'SELECT wiro_key_encrypted, openrouter_key_encrypted FROM users WHERE wiro_key_encrypted IS NOT NULL OR openrouter_key_encrypted IS NOT NULL ORDER BY is_admin DESC LIMIT 1',
        )
        .get() as any;
      if (row) {
        const enc = row.wiro_key_encrypted || row.openrouter_key_encrypted;
        if (enc) {
          let dec = this.cryptoService.decrypt(enc).trim();
          if (dec.length === 32 && /^[a-zA-Z0-9]{32}$/.test(dec)) {
            dec = dec.toLowerCase();
          }
          if (dec) return dec;
        }
      }
    } catch {}

    if (process.env.WIRO_API_KEY) {
      return process.env.WIRO_API_KEY.trim();
    }

    throw new BadRequestException(
      'No Wiro.ai API key is configured. Please add your Wiro API key in the top navigation bar (🔑 API Key) to generate images.',
    );
  }

  // --- List & Manage Stored Images ---

  listImages(
    userId: string,
    isAdmin = false,
    filters?: { mode?: string; characterId?: string },
  ): GeneratedImageItem[] {
    let sql = `
      SELECT gi.*, c.name AS character_name
      FROM generated_images gi
      LEFT JOIN characters c ON c.id = gi.character_id
      WHERE (gi.user_id = ? OR ? = 1)
    `;
    const params: any[] = [userId, isAdmin ? 1 : 0];

    if (filters?.mode && filters.mode.trim()) {
      sql += ` AND gi.mode = ?`;
      params.push(filters.mode.trim());
    }

    if (filters?.characterId && filters.characterId.trim()) {
      sql += ` AND gi.character_id = ?`;
      params.push(filters.characterId.trim());
    }

    sql += ` ORDER BY gi.created_at DESC`;

    const rows = this.db.prepare(sql).all(...params) as GeneratedImageItem[];
    return rows.map((row) => {
      const absPath = this.resolveStoredFilePath(row.file_path);
      const exists = absPath ? existsSync(absPath) : false;
      return {
        ...row,
        file_exists: exists,
      };
    });
  }

  getImageById(id: string, userId: string, isAdmin = false): GeneratedImageItem {
    const row = this.db
      .prepare(
        `
      SELECT gi.*, c.name AS character_name
      FROM generated_images gi
      LEFT JOIN characters c ON c.id = gi.character_id
      WHERE gi.id = ?
    `,
      )
      .get(id) as GeneratedImageItem | undefined;

    if (!row) {
      throw new NotFoundException(`Generated image '${id}' not found.`);
    }

    if (row.user_id !== userId && !isAdmin) {
      throw new ForbiddenException('You do not have permission to view this image.');
    }

    const absPath = this.resolveStoredFilePath(row.file_path);
    row.file_exists = absPath ? existsSync(absPath) : false;
    return row;
  }

  deleteImage(id: string, userId: string, isAdmin = false): { deleted: boolean; id: string } {
    const row = this.getImageById(id, userId, isAdmin);

    // Delete physical file from disk if present
    const absPath = this.resolveStoredFilePath(row.file_path);
    if (absPath && existsSync(absPath)) {
      try {
        unlinkSync(absPath);
        this.logger.log(`Deleted image file from disk: ${absPath}`);
      } catch (err: any) {
        this.logger.warn(`Failed deleting image file ${absPath}: ${err.message}`);
      }
    }

    this.db.prepare('DELETE FROM generated_images WHERE id = ?').run(id);
    return { deleted: true, id };
  }

  getPhysicalFile(folder: string, filename: string): { filePath: string; mimeType: string } {
    const allowedFolders = ['avatars', 'studio', 'references'];
    const cleanFolder = folder.replace(/[^a-zA-Z0-9_-]/g, '');
    const cleanFilename = filename.replace(/[^a-zA-Z0-9._-]/g, '');

    if (!allowedFolders.includes(cleanFolder) || !cleanFilename) {
      throw new NotFoundException('Invalid image path.');
    }

    const filePath = join(this.imagesRootDir, cleanFolder, cleanFilename);
    if (!existsSync(filePath)) {
      throw new NotFoundException(`Image file '${cleanFolder}/${cleanFilename}' not found on disk.`);
    }

    const ext = extname(cleanFilename).toLowerCase();
    const mimeMap: Record<string, string> = {
      '.png': 'image/png',
      '.jpg': 'image/jpeg',
      '.jpeg': 'image/jpeg',
      '.webp': 'image/webp',
      '.gif': 'image/gif',
      '.svg': 'image/svg+xml',
    };

    return {
      filePath,
      mimeType: mimeMap[ext] || 'image/png',
    };
  }

  private resolveStoredFilePath(relativeOrAbsPath: string): string | null {
    if (!relativeOrAbsPath) return null;
    const isInsideServer = existsSync(resolve(process.cwd(), 'nest-cli.json'));
    const rootDir = isInsideServer ? resolve(process.cwd(), '..') : process.cwd();
    return resolve(rootDir, relativeOrAbsPath);
  }

  // --- Text-to-Image Generation ---

  async generateTextToImage(
    userId: string,
    dto: GenerateTextToImageDto,
  ): Promise<GeneratedImageItem> {
    if (!dto.prompt || !dto.prompt.trim()) {
      throw new BadRequestException('Image generation prompt is required.');
    }

    const apiKey = this.resolveWiroApiKey(userId);
    const activeModels = this.modelsService.getActiveModels(userId);
    const requestedModel = dto.model?.trim() || activeModels.effective.textToImageModel;
    const resolvedModel = this.modelsService.findModelByIdOrSlug(requestedModel, 'text-to-image');
    const modelSlug = resolvedModel ? resolvedModel.slug : requestedModel;

    const mode: 'text-to-image' | 'avatar' =
      dto.mode || (dto.characterId ? 'avatar' : 'text-to-image');
    const folder = mode === 'avatar' ? 'avatars' : 'studio';
    const aspectRatio = dto.aspectRatio?.trim() || '1:1';

    const startTime = Date.now();
    const { imageBuffer, mimeType, rawResponse } = await this.executeWiroImageGeneration({
      modelSlug,
      prompt: dto.prompt.trim(),
      aspectRatio,
      apiKey,
      extraParams: dto.extraParams,
    });
    const latencyMs = Date.now() - startTime;

    return this.saveGeneratedImageRecord({
      userId,
      characterId: dto.characterId || null,
      mode,
      folder,
      prompt: dto.prompt.trim(),
      modelUsed: modelSlug,
      aspectRatio,
      imageBuffer,
      mimeType,
      latencyMs,
      rawResponse,
    });
  }

  // --- Image-to-Image Generation ---

  async generateImageToImage(
    userId: string,
    dto: GenerateImageToImageDto,
  ): Promise<GeneratedImageItem> {
    if (!dto.prompt || !dto.prompt.trim()) {
      throw new BadRequestException('Prompt / edit description is required for Image-to-Image generation.');
    }
    if (!dto.referenceImageBase64 && !dto.referenceImageUrl) {
      throw new BadRequestException(
        'A reference image (upload or existing image URL) is required for Image-to-Image generation.',
      );
    }

    const apiKey = this.resolveWiroApiKey(userId);
    const activeModels = this.modelsService.getActiveModels(userId);
    const requestedModel = dto.model?.trim() || activeModels.effective.imageToImageModel;
    const resolvedModel = this.modelsService.findModelByIdOrSlug(requestedModel, 'image-to-image');
    const modelSlug = resolvedModel ? resolvedModel.slug : requestedModel;

    // Resolve reference image buffer + persisted reference URL
    let refBuffer: Buffer | undefined;
    let refMimeType = 'image/png';
    let refFilename = 'reference.png';
    let persistedRefUrl = dto.referenceImageUrl?.trim() || null;

    if (dto.referenceImageBase64 && dto.referenceImageBase64.trim()) {
      const parsed = this.parseBase64DataUrl(dto.referenceImageBase64.trim());
      refBuffer = parsed.buffer;
      refMimeType = parsed.mimeType;
      const ext = this.extensionFromMime(refMimeType);
      const refId = `ref_${randomBytes(10).toString('hex')}`;
      refFilename = `${refId}${ext}`;
      const refAbsPath = join(this.imagesRootDir, 'references', refFilename);
      writeFileSync(refAbsPath, refBuffer);
      persistedRefUrl = `/api/images/file/references/${refFilename}`;
    } else if (persistedRefUrl) {
      // Check if referenceImageUrl is a local /api/images/file/:folder/:filename path
      const localMatch = persistedRefUrl.match(/\/api\/images\/file\/([a-zA-Z0-9_-]+)\/([a-zA-Z0-9._-]+)/);
      if (localMatch) {
        const physical = this.getPhysicalFile(localMatch[1], localMatch[2]);
        refBuffer = readFileSync(physical.filePath);
        refMimeType = physical.mimeType;
        refFilename = localMatch[2];
      } else if (persistedRefUrl.startsWith('data:image/')) {
        const parsed = this.parseBase64DataUrl(persistedRefUrl);
        refBuffer = parsed.buffer;
        refMimeType = parsed.mimeType;
      }
    }

    const aspectRatio = dto.aspectRatio?.trim() || '1:1';
    const startTime = Date.now();
    const { imageBuffer, mimeType, rawResponse } = await this.executeWiroImageGeneration({
      modelSlug,
      prompt: dto.prompt.trim(),
      aspectRatio,
      apiKey,
      referenceBuffer: refBuffer,
      referenceMimeType: refMimeType,
      referenceFilename: refFilename,
      referenceRemoteUrl: !refBuffer && persistedRefUrl ? persistedRefUrl : undefined,
      extraParams: dto.extraParams,
    });
    const latencyMs = Date.now() - startTime;

    return this.saveGeneratedImageRecord({
      userId,
      characterId: dto.characterId || null,
      mode: 'image-to-image',
      folder: 'studio',
      prompt: dto.prompt.trim(),
      modelUsed: modelSlug,
      aspectRatio,
      referenceImageUrl: persistedRefUrl,
      imageBuffer,
      mimeType,
      latencyMs,
      rawResponse,
    });
  }

  // --- Core Wiro Image Task Runner ---

  private async executeWiroImageGeneration(options: {
    modelSlug: string;
    prompt: string;
    aspectRatio: string;
    apiKey: string;
    referenceBuffer?: Buffer;
    referenceMimeType?: string;
    referenceFilename?: string;
    referenceRemoteUrl?: string;
    extraParams?: Record<string, any>;
  }): Promise<{ imageBuffer: Buffer; mimeType: string; rawResponse: any }> {
    const summary = this.modelsService.findModelByIdOrSlug(options.modelSlug);
    const [rawOwner, rawProject] = options.modelSlug.includes('/')
      ? options.modelSlug.split('/')
      : ['google', options.modelSlug];
    const slugowner = summary?.slugowner || rawOwner;
    const slugproject = summary?.slugproject || rawProject;

    // 1. Inspect model detail schema to populate required parameters and parameter names
    let modelParameters: any[] = [];
    const extractFlatParameters = (rawParams: any): any[] => {
      if (!Array.isArray(rawParams)) return [];
      return rawParams.flatMap((group: any) =>
        Array.isArray(group?.items) ? group.items : [group],
      );
    };

    let cleanSlugOwner = slugowner;
    let cleanSlugProject = slugproject;

    try {
      let detailResp = await this.modelsService.getOrFetchDetail(
        slugowner,
        slugproject,
        false,
        options.apiKey,
      );
      modelParameters = extractFlatParameters(detailResp?.detail?.parameters);

      // If cached detail had no parameters, force-refresh from Wiro Tool/Detail API
      if (modelParameters.length === 0) {
        detailResp = await this.modelsService.getOrFetchDetail(
          slugowner,
          slugproject,
          true,
          options.apiKey,
        );
        modelParameters = extractFlatParameters(detailResp?.detail?.parameters);
      }

      if (detailResp?.detail?.cleanslugowner) {
        cleanSlugOwner = String(detailResp.detail.cleanslugowner).trim();
      }
      if (detailResp?.detail?.cleanslugproject) {
        cleanSlugProject = String(detailResp.detail.cleanslugproject).trim();
      }
    } catch (err: any) {
      this.logger.warn(
        `Could not load parameter schema for ${slugowner}/${slugproject}: ${err.message}`,
      );
    }

    // 2. Build parameter dictionary based on flattened schema items
    const textFields: Record<string, string> = {};
    let fileInputFieldName = 'inputImage';
    const schemaParamValidOptions = new Map<string, string[]>();
    const schemaParamIds = new Set<string>();

    if (modelParameters.length > 0) {
      for (const p of modelParameters) {
        const paramId = String(p?.id || '').trim();
        if (!paramId) continue;

        const fieldType = String(p.type || p.fieldtype || '').toLowerCase();
        if (
          fieldType === 'combinefileinput' ||
          fieldType === 'file' ||
          fieldType === 'image' ||
          fieldType === 'multifile' ||
          /^input(image|video|audio|document)/i.test(paramId)
        ) {
          if (/image/i.test(paramId) && paramId.toLowerCase() !== 'inputimagelast') {
            fileInputFieldName = paramId;
          }
          continue;
        }

        schemaParamIds.add(paramId);

        if (paramId.toLowerCase() === 'prompt') {
          textFields[paramId] = options.prompt;
          continue;
        }

        const rawOpts = Array.isArray(p.options)
          ? p.options
          : Array.isArray(p.values)
            ? p.values
            : [];
        const validValues = rawOpts
          .map((v: any) => String(v?.value ?? v ?? '').trim())
          .filter(Boolean);

        if (validValues.length > 0) {
          schemaParamValidOptions.set(paramId, validValues);
        }

        if (paramId === 'ratio' || paramId === 'aspectRatio' || paramId === 'aspect_ratio') {
          if (validValues.length === 0 || validValues.includes(options.aspectRatio)) {
            textFields[paramId] = options.aspectRatio;
          } else if (
            p.defaultvalue !== undefined &&
            p.defaultvalue !== null &&
            String(p.defaultvalue).trim() !== ''
          ) {
            textFields[paramId] = String(p.defaultvalue).trim();
          } else if (validValues.length > 0) {
            textFields[paramId] = validValues[0];
          }
          continue;
        }

        // Populate default value for required or standard config parameters
        if (
          p.defaultvalue !== undefined &&
          p.defaultvalue !== null &&
          typeof p.defaultvalue !== 'object' &&
          String(p.defaultvalue).trim() !== ''
        ) {
          textFields[paramId] = String(p.defaultvalue).trim();
        } else if (
          p.value !== undefined &&
          p.value !== null &&
          typeof p.value !== 'object' &&
          String(p.value).trim() !== ''
        ) {
          textFields[paramId] = String(p.value).trim();
        } else if (p.required && validValues.length > 0) {
          textFields[paramId] = validValues[0];
        }
      }
    }

    // Ensure prompt is always present
    if (!Object.keys(textFields).some((k) => k.toLowerCase() === 'prompt')) {
      textFields['prompt'] = options.prompt;
    }

    // Apply any explicit extraParams from caller, validating against model schema when available
    if (options.extraParams && typeof options.extraParams === 'object') {
      for (const [k, v] of Object.entries(options.extraParams)) {
        if (v === undefined || v === null) continue;
        const valStr = String(v).trim();
        if (!valStr) continue;

        // If we know the model's parameter schema, ignore parameters that belong to a different model
        if (schemaParamIds.size > 0 && !schemaParamIds.has(k) && k !== 'seed') {
          this.logger.debug(
            `[Wiro Image Param Filter] Ignoring extraParam '${k}' as it is not in ${slugowner}/${slugproject} schema`,
          );
          continue;
        }

        // If the parameter has an enumerated list of valid options, match case-insensitively
        const validOpts = schemaParamValidOptions.get(k);
        if (validOpts && validOpts.length > 0) {
          const exactMatch = validOpts.find((opt) => opt === valStr);
          if (exactMatch) {
            textFields[k] = exactMatch;
          } else {
            const ciMatch = validOpts.find((opt) => opt.toLowerCase() === valStr.toLowerCase());
            if (ciMatch) {
              textFields[k] = ciMatch;
            } else {
              this.logger.warn(
                `[Wiro Image Param Filter] Value '${valStr}' for '${k}' is not in [${validOpts.join(', ')}]; keeping default '${textFields[k] || validOpts[0]}'`,
              );
              if (!textFields[k]) {
                textFields[k] = validOpts[0];
              }
            }
          }
        } else {
          textFields[k] = valStr;
        }
      }
    }

    const encodedOwner = encodeURIComponent(cleanSlugOwner);
    const encodedProject = encodeURIComponent(cleanSlugProject);
    const runUrl = `https://api.wiro.ai/v1/Run/${encodedOwner}/${encodedProject}`;
    const cleanKey = options.apiKey.trim();

    const sendRunRequest = async (fields: Record<string, string>) => {
      this.logger.log(
        `[Wiro Image Run] POST ${runUrl} | params=${JSON.stringify(fields)} | hasReferenceBuffer=${Boolean(options.referenceBuffer)}`,
      );

      let response: Response;
      if (options.referenceBuffer) {
        const formData = new FormData();
        for (const [k, v] of Object.entries(fields)) {
          formData.append(k, v);
        }
        const blob = new Blob([new Uint8Array(options.referenceBuffer)], {
          type: options.referenceMimeType || 'image/png',
        });
        formData.append(
          fileInputFieldName,
          blob,
          options.referenceFilename || 'reference.png',
        );

        response = await fetch(runUrl, {
          method: 'POST',
          headers: {
            'x-api-key': cleanKey,
          },
          body: formData,
        });
      } else {
        const jsonBody: Record<string, any> = { ...fields };
        if (options.referenceRemoteUrl) {
          jsonBody[fileInputFieldName] = options.referenceRemoteUrl;
        }
        response = await fetch(runUrl, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-api-key': cleanKey,
          },
          body: JSON.stringify(jsonBody),
        });
      }

      if (!response.ok) {
        const errText = await response.text();
        this.logger.error(`[Wiro Image Run Error] POST ${runUrl} -> Status ${response.status}: ${errText}`);
        throw new BadRequestException(`Wiro API error (${response.status}): ${errText}`);
      }

      return response.json();
    };

    let runData = await sendRunRequest(textFields);

    // If Wiro reports missing required parameters or invalid option values, auto-fix and retry once
    if (!runData.result && Array.isArray(runData.errors) && runData.errors.length > 0) {
      const fallbackMap: Record<string, string> = {
        resolution: '1k',
        ratio: options.aspectRatio || '1:1',
        aspectRatio: options.aspectRatio || '1:1',
        promptExtend: 'false',
        watermark: 'false',
        size: '1K',
        samples: '1',
        outputFormat: 'png',
        safetySetting: 'OFF',
      };
      let updatedFields = false;
      for (const errObj of runData.errors) {
        const msg = String(errObj?.message || '');
        const reqMatch = msg.match(/Request parameter \[([^\]]+)\] required/i);
        if (reqMatch && reqMatch[1]) {
          const missingParam = reqMatch[1].trim();
          if (textFields[missingParam] === undefined) {
            textFields[missingParam] = fallbackMap[missingParam] || '1';
            updatedFields = true;
          }
        }
        const enumMatch = msg.match(/Request parameter \[([^\]]+)\] must be one of:\s*(.+)$/i);
        if (enumMatch && enumMatch[1] && enumMatch[2]) {
          const paramName = enumMatch[1].trim();
          const allowedChoices = enumMatch[2]
            .split(',')
            .map((s) => s.trim())
            .filter(Boolean);
          if (allowedChoices.length > 0) {
            const currentVal = String(textFields[paramName] || '');
            const ciChoice = allowedChoices.find(
              (c) => c.toLowerCase() === currentVal.toLowerCase(),
            );
            textFields[paramName] = ciChoice || allowedChoices[0];
            updatedFields = true;
          }
        }
      }
      if (updatedFields) {
        this.logger.log(
          `[Wiro Image Run Retry] Retrying with auto-corrected parameters: ${JSON.stringify(textFields)}`,
        );
        runData = await sendRunRequest(textFields);
      }
    }

    if (!runData.result && runData.errors?.length) {
      const errMsgs = runData.errors.map((e: any) => e.message || JSON.stringify(e)).join(', ');
      throw new BadRequestException(`Wiro execution error: ${errMsgs}`);
    }

    // Check if output image was returned immediately
    const immediateUrl = this.extractOutputImageUrl(runData);
    if (immediateUrl) {
      const downloaded = await this.downloadRemoteOrDataImage(immediateUrl);
      return { ...downloaded, rawResponse: runData };
    }

    const socketToken =
      runData.socketaccesstoken || runData.tasklist?.[0]?.socketaccesstoken;
    const taskId = runData.taskid || runData.tasklist?.[0]?.id;

    if (!socketToken && !taskId) {
      throw new BadRequestException(
        `Wiro did not return a task ID or socket token. Raw response: ${JSON.stringify(runData)}`,
      );
    }

    // Wait for completion via WebSocket + Task/Detail polling
    const completedTaskData = await this.waitForWiroImageTask(
      String(taskId || ''),
      String(socketToken || ''),
      cleanKey,
    );

    const outputImageUrl = this.extractOutputImageUrl(completedTaskData);
    if (!outputImageUrl) {
      throw new BadRequestException(
        `Wiro task ${taskId} finished, but no output image URL was found in response: ${JSON.stringify(completedTaskData)}`,
      );
    }

    const downloaded = await this.downloadRemoteOrDataImage(outputImageUrl);
    return {
      ...downloaded,
      rawResponse: completedTaskData,
    };
  }

  private async waitForWiroImageTask(
    taskId: string,
    socketToken: string,
    apiKey: string,
  ): Promise<any> {
    return new Promise<any>((resolveTask, rejectTask) => {
      let settled = false;
      let ws: WebSocket | null = null;
      let pollInterval: ReturnType<typeof setInterval> | null = null;

      const cleanup = () => {
        settled = true;
        if (pollInterval) clearInterval(pollInterval);
        if (timeoutTimer) clearTimeout(timeoutTimer);
        if (ws) {
          try {
            ws.close();
          } catch {}
        }
      };

      const timeoutTimer = setTimeout(() => {
        if (!settled) {
          cleanup();
          rejectTask(new Error(`Wiro image generation timed out after 180s (Task ${taskId}).`));
        }
      }, 180000);

      const checkTaskDetailViaHttp = async (): Promise<boolean> => {
        if (settled) return true;
        try {
          const bodyPayload: Record<string, string> = {};
          if (taskId) bodyPayload.taskid = taskId;
          else if (socketToken) bodyPayload.tasktoken = socketToken;

          const detailRes = await fetch('https://api.wiro.ai/v1/Task/Detail', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'x-api-key': apiKey,
            },
            body: JSON.stringify(bodyPayload),
          });

          if (!detailRes.ok) return false;
          const detailData = await detailRes.json();
          const task = detailData?.tasklist?.[0];
          if (!task) return false;

          const status = String(task.status || '').toLowerCase();
          const foundUrl = this.extractOutputImageUrl(detailData);
          if (foundUrl || status === 'task_postprocess_end' || status === 'completed') {
            if (foundUrl) {
              cleanup();
              resolveTask(detailData);
              return true;
            }
          }

          if (status === 'task_cancel' || status === 'cancelled' || status === 'failed' || status === 'error') {
            cleanup();
            rejectTask(
              new Error(
                `Wiro task ${taskId} failed with status '${task.status}': ${task.debugerror || task.debugoutput || ''}`,
              ),
            );
            return true;
          }
        } catch (err: any) {
          this.logger.debug(`[Wiro Poll] Task ${taskId} poll check error: ${err.message}`);
        }
        return false;
      };

      // Poll HTTP Task/Detail every 3.5 seconds as a rock-solid companion to WebSocket
      pollInterval = setInterval(() => {
        void checkTaskDetailViaHttp();
      }, 3500);

      if (socketToken) {
        try {
          ws = new WebSocket('wss://socket.wiro.ai/v1');
          ws.onopen = () => {
            this.logger.log(`[Wiro Image WS Open] Subscribing to task ${taskId}`);
            ws?.send(
              JSON.stringify({
                type: 'task_info',
                tasktoken: socketToken,
              }),
            );
          };

          ws.onmessage = async (event: MessageEvent) => {
            if (settled) return;
            try {
              const raw =
                typeof event.data === 'string' ? event.data : event.data?.toString?.();
              if (!raw) return;
              const data = JSON.parse(raw);

              if (data.type === 'task_postprocess_end' || data.type === 'task_output_end') {
                this.logger.log(`[Wiro Image WS] Task ${taskId} received ${data.type}`);
                const directUrl = this.extractOutputImageUrl(data);
                if (directUrl) {
                  cleanup();
                  resolveTask(data);
                  return;
                }
                // Fetch canonical Task/Detail to get CDN URLs
                const resolvedViaHttp = await checkTaskDetailViaHttp();
                if (!resolvedViaHttp && !settled) {
                  // Wait 1s and retry Task/Detail once more
                  setTimeout(() => void checkTaskDetailViaHttp(), 1000);
                }
              } else if (data.type === 'task_cancel') {
                cleanup();
                rejectTask(new Error(`Wiro image task ${taskId} was cancelled.`));
              }
            } catch {}
          };

          ws.onerror = (err: any) => {
            this.logger.warn(
              `[Wiro Image WS Warning] Task ${taskId} WS error (continuing via HTTP poll): ${err.message || err}`,
            );
          };
        } catch (err: any) {
          this.logger.warn(`Failed opening Wiro WebSocket (using HTTP poll): ${err.message}`);
        }
      }
    });
  }

  private extractOutputImageUrl(data: any): string | null {
    if (!data) return null;

    const inspectOutputsArray = (outputs: any[]): string | null => {
      for (const item of outputs) {
        if (!item) continue;
        if (typeof item === 'string' && (item.startsWith('http') || item.startsWith('data:image/'))) {
          return item;
        }
        if (typeof item === 'object') {
          for (const key of ['url', 'file', 'image', 'src', 'downloadUrl', 'content']) {
            const val = item[key];
            if (
              typeof val === 'string' &&
              (val.startsWith('http://') ||
                val.startsWith('https://') ||
                val.startsWith('data:image/'))
            ) {
              return val;
            }
          }
        }
      }
      return null;
    };

    // 1. Check tasklist[0].outputs
    if (Array.isArray(data.tasklist) && data.tasklist.length > 0) {
      for (const task of data.tasklist) {
        if (Array.isArray(task.outputs)) {
          const found = inspectOutputsArray(task.outputs);
          if (found) return found;
        }
      }
    }

    // 2. Check data.outputs
    if (Array.isArray(data.outputs)) {
      const found = inspectOutputsArray(data.outputs);
      if (found) return found;
    }

    // 3. Check WebSocket data.message array
    if (Array.isArray(data.message)) {
      const found = inspectOutputsArray(data.message);
      if (found) return found;
    } else if (data.message && typeof data.message === 'object') {
      if (Array.isArray(data.message.outputs)) {
        const found = inspectOutputsArray(data.message.outputs);
        if (found) return found;
      }
      const single = inspectOutputsArray([data.message]);
      if (single) return single;
    }

    return null;
  }

  private async downloadRemoteOrDataImage(
    urlOrData: string,
  ): Promise<{ imageBuffer: Buffer; mimeType: string }> {
    if (urlOrData.startsWith('data:image/')) {
      const parsed = this.parseBase64DataUrl(urlOrData);
      return { imageBuffer: parsed.buffer, mimeType: parsed.mimeType };
    }

    this.logger.log(`Downloading generated image from: ${urlOrData}`);
    const res = await fetch(urlOrData);
    if (!res.ok) {
      throw new BadRequestException(
        `Failed to download generated image from Wiro CDN (${res.status}).`,
      );
    }

    const contentType = res.headers.get('content-type') || 'image/png';
    const arrayBuffer = await res.arrayBuffer();
    const imageBuffer = Buffer.from(arrayBuffer);

    const detectedMime = this.detectMimeTypeFromBuffer(imageBuffer, contentType, urlOrData);
    return {
      imageBuffer,
      mimeType: detectedMime,
    };
  }

  private saveGeneratedImageRecord(params: {
    userId: string;
    characterId?: string | null;
    mode: 'text-to-image' | 'image-to-image' | 'avatar';
    folder: 'avatars' | 'studio';
    prompt: string;
    modelUsed: string;
    aspectRatio?: string | null;
    referenceImageUrl?: string | null;
    imageBuffer: Buffer;
    mimeType: string;
    latencyMs: number;
    rawResponse: any;
  }): GeneratedImageItem {
    const id = `img_${randomBytes(12).toString('hex')}`;
    const ext = this.extensionFromMime(params.mimeType);
    const filename = `${id}${ext}`;
    const absFilePath = join(this.imagesRootDir, params.folder, filename);
    const relativeFilePath = `data/images/${params.folder}/${filename}`;
    const imageUrl = `/api/images/file/${params.folder}/${filename}`;

    writeFileSync(absFilePath, params.imageBuffer);
    const fileSizeBytes = statSync(absFilePath).size;
    const dimensions = this.extractImageDimensions(params.imageBuffer);
    const now = new Date().toISOString();

    const rawResponseStr = params.rawResponse ? JSON.stringify(params.rawResponse) : null;

    this.db
      .prepare(
        `
      INSERT INTO generated_images (
        id, user_id, character_id, mode, prompt, model_used,
        file_path, image_url, reference_image_url, aspect_ratio,
        width, height, file_size_bytes, latency_ms, raw_response_json, created_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `,
      )
      .run(
        id,
        params.userId,
        params.characterId || null,
        params.mode,
        params.prompt,
        params.modelUsed,
        relativeFilePath,
        imageUrl,
        params.referenceImageUrl || null,
        params.aspectRatio || null,
        dimensions?.width || null,
        dimensions?.height || null,
        fileSizeBytes,
        params.latencyMs,
        rawResponseStr,
        now,
      );

    return this.getImageById(id, params.userId, true);
  }

  // --- Binary & Image Header Utilities ---

  private parseBase64DataUrl(dataUrl: string): { buffer: Buffer; mimeType: string } {
    const match = dataUrl.match(/^data:(image\/[a-zA-Z0-9+.-]+);base64,(.+)$/);
    if (match) {
      return {
        mimeType: match[1].toLowerCase(),
        buffer: Buffer.from(match[2], 'base64'),
      };
    }
    return {
      mimeType: 'image/png',
      buffer: Buffer.from(dataUrl, 'base64'),
    };
  }

  private detectMimeTypeFromBuffer(
    buf: Buffer,
    fallbackContentType: string,
    urlHint?: string,
  ): string {
    if (buf.length >= 8 && buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) {
      return 'image/png';
    }
    if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) {
      return 'image/jpeg';
    }
    if (
      buf.length >= 12 &&
      buf.toString('ascii', 0, 4) === 'RIFF' &&
      buf.toString('ascii', 8, 12) === 'WEBP'
    ) {
      return 'image/webp';
    }
    if (buf.length >= 6 && buf.toString('ascii', 0, 3) === 'GIF') {
      return 'image/gif';
    }
    if (urlHint) {
      if (/\.webp(\?|$)/i.test(urlHint)) return 'image/webp';
      if (/\.jpe?g(\?|$)/i.test(urlHint)) return 'image/jpeg';
      if (/\.png(\?|$)/i.test(urlHint)) return 'image/png';
    }
    if (fallbackContentType.includes('jpeg') || fallbackContentType.includes('jpg')) {
      return 'image/jpeg';
    }
    if (fallbackContentType.includes('webp')) {
      return 'image/webp';
    }
    return 'image/png';
  }

  private extensionFromMime(mimeType: string): string {
    if (mimeType.includes('jpeg') || mimeType.includes('jpg')) return '.jpg';
    if (mimeType.includes('webp')) return '.webp';
    if (mimeType.includes('gif')) return '.gif';
    if (mimeType.includes('svg')) return '.svg';
    return '.png';
  }

  private extractImageDimensions(buf: Buffer): { width: number; height: number } | null {
    try {
      // PNG
      if (buf.length >= 24 && buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) {
        const width = buf.readUInt32BE(16);
        const height = buf.readUInt32BE(20);
        return { width, height };
      }

      // JPEG
      if (buf.length >= 4 && buf[0] === 0xff && buf[1] === 0xd8) {
        let offset = 2;
        while (offset + 9 < buf.length) {
          if (buf[offset] !== 0xff) {
            offset++;
            continue;
          }
          const marker = buf[offset + 1];
          if (
            marker === 0xc0 ||
            marker === 0xc1 ||
            marker === 0xc2 ||
            marker === 0xc3
          ) {
            const height = buf.readUInt16BE(offset + 5);
            const width = buf.readUInt16BE(offset + 7);
            return { width, height };
          }
          const segLen = buf.readUInt16BE(offset + 2);
          if (segLen < 2) break;
          offset += 2 + segLen;
        }
      }

      // WebP
      if (
        buf.length >= 30 &&
        buf.toString('ascii', 0, 4) === 'RIFF' &&
        buf.toString('ascii', 8, 12) === 'WEBP'
      ) {
        const chunkType = buf.toString('ascii', 12, 16);
        if (chunkType === 'VP8 ') {
          const width = buf.readUInt16LE(26) & 0x3fff;
          const height = buf.readUInt16LE(28) & 0x3fff;
          return { width, height };
        }
        if (chunkType === 'VP8L') {
          const bits = buf.readUInt32LE(21);
          const width = (bits & 0x3fff) + 1;
          const height = ((bits >> 14) & 0x3fff) + 1;
          return { width, height };
        }
        if (chunkType === 'VP8X') {
          const width = 1 + (buf[24] | (buf[25] << 8) | (buf[26] << 16));
          const height = 1 + (buf[27] | (buf[28] << 8) | (buf[29] << 16));
          return { width, height };
        }
      }
    } catch {}
    return null;
  }
}
