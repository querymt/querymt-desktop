<script module lang="ts">
  export interface ImageFit {
    fitScale: number;
    width: number;
    height: number;
  }

  export function calculateImageFit(
    naturalWidth: number,
    naturalHeight: number,
    stageWidth: number,
    stageHeight: number
  ): ImageFit | null {
    if (naturalWidth <= 0 || naturalHeight <= 0 || stageWidth <= 0 || stageHeight <= 0) return null;
    const fitScale = Math.min(stageWidth / naturalWidth, stageHeight / naturalHeight, 1);
    return {
      fitScale,
      width: naturalWidth * fitScale,
      height: naturalHeight * fitScale
    };
  }
</script>

<script lang="ts">
  import { FileText, X } from '@lucide/svelte';
  import { Dialog, Tooltip } from 'bits-ui';
  import { getContext } from 'svelte';
  import type { SessionContentBlock, SessionImageBlock, SessionImageGalleryItem } from '$lib/domain/types';

  const MIN_ZOOM = 0.5;
  const MAX_ZOOM = 3;
  const ZOOM_STEP = 0.1;

  let {
    blocks,
    gallery,
    failedImageKeys,
    removable = false,
    compact = false,
    onRemove = null,
    onImageFailure = null
  }: {
    blocks: SessionContentBlock[];
    gallery?: SessionImageGalleryItem[];
    failedImageKeys?: ReadonlySet<string>;
    removable?: boolean;
    compact?: boolean;
    onRemove?: ((id: string) => void) | null;
    onImageFailure?: ((key: string) => void) | null;
  } = $props();

  const getOverlayPortalTarget = getContext<(() => HTMLElement | null) | undefined>('app-overlay-target');
  const overlayPortalTarget = $derived(getOverlayPortalTarget?.() ?? undefined);

  let localFailedImageKeys = $state<ReadonlySet<string>>(new Set());
  let selectedImageKey = $state<string | null>(null);
  let imageDialogOpen = $state(false);
  let zoom = $state(1);
  let wheelDelta = 0;
  let lastTrigger = $state<HTMLButtonElement | null>(null);
  let lightboxRoot = $state<HTMLElement | null>(null);
  let lightboxStage = $state<HTMLElement | null>(null);
  let lightboxImage = $state<HTMLImageElement | null>(null);
  let naturalWidth = $state(0);
  let naturalHeight = $state(0);
  let stageWidth = $state(0);
  let stageHeight = $state(0);
  const naturalDimensionsByKey = new Map<string, { width: number; height: number }>();

  function blockKey(block: SessionContentBlock, index: number): string {
    if (block.type === 'text') return `text-${index}`;
    return `${block.id ?? block.uri ?? block.type}-${index}`;
  }

  function localGalleryKey(block: SessionImageBlock, index: number): string {
    const identity = block.id ? `id:${block.id}` : block.uri ? `uri:${block.uri}` : `index:${index}`;
    return `local-image:${identity}`;
  }

  function fallbackName(block: Exclude<SessionContentBlock, { type: 'text' }>, index: number): string {
    if (block.name) return block.name;
    if (block.type === 'image') return `Image attachment ${index + 1}`;
    try {
      const filename = decodeURIComponent(block.uri.split('/').pop() ?? '');
      return filename || `File attachment ${index + 1}`;
    } catch {
      return `File attachment ${index + 1}`;
    }
  }

  const attachmentBlocks = $derived(blocks.filter((block) => block.type !== 'text'));
  const localGallery = $derived.by(() =>
    attachmentBlocks.flatMap((block, index): SessionImageGalleryItem[] => {
      if (block.type !== 'image' || !block.data || block.unavailable) return [];
      return [{ key: localGalleryKey(block, index), name: fallbackName(block, index), block }];
    })
  );
  const activeGallery = $derived(gallery ?? localGallery);
  const activeFailedImageKeys = $derived(failedImageKeys ?? localFailedImageKeys);
  const galleryImages = $derived(
    activeGallery.filter((item) => item.block.data && !item.block.unavailable && !activeFailedImageKeys.has(item.key))
  );
  const selectedImageIndex = $derived(galleryImages.findIndex((image) => image.key === selectedImageKey));
  const selectedImage = $derived(selectedImageIndex >= 0 ? galleryImages[selectedImageIndex] : null);
  const imageFit = $derived(calculateImageFit(naturalWidth, naturalHeight, stageWidth, stageHeight));
  const renderedWidth = $derived(imageFit ? Math.round(imageFit.width * zoom * 1000) / 1000 : null);
  const renderedHeight = $derived(imageFit ? Math.round(imageFit.height * zoom * 1000) / 1000 : null);

  function formatFileSize(size: number | undefined): string {
    if (size === undefined) return '';
    if (size < 1024) return `${size} B`;
    if (size < 1024 * 1024) return `${Math.round(size / 1024)} KB`;
    return `${(size / (1024 * 1024)).toFixed(1)} MB`;
  }

  function resetView() {
    wheelDelta = 0;
    zoom = 1;
    if (lightboxStage) {
      lightboxStage.scrollLeft = 0;
      lightboxStage.scrollTop = 0;
    }
  }

  function galleryKeyForBlock(block: SessionImageBlock, index: number): string | null {
    if (!gallery) return localGalleryKey(block, index);
    const referenceMatch = gallery.find((item) => item.block === block);
    if (referenceMatch) return referenceMatch.key;
    if (block.id) {
      const idMatches = gallery.filter((item) => item.block.id === block.id);
      if (idMatches.length === 1) return idMatches[0].key;
    }
    if (block.uri) {
      const uriMatches = gallery.filter((item) => item.block.uri === block.uri);
      if (uriMatches.length === 1) return uriMatches[0].key;
    }
    return null;
  }

  function selectImage(key: string) {
    selectedImageKey = key;
    const dimensions = naturalDimensionsByKey.get(key);
    naturalWidth = dimensions?.width ?? 0;
    naturalHeight = dimensions?.height ?? 0;
    resetView();
  }

  function openImage(event: MouseEvent, key: string | null) {
    if (!key) return;
    lastTrigger = event.currentTarget as HTMLButtonElement;
    selectImage(key);
    imageDialogOpen = true;
  }

  function dismissImage() {
    imageDialogOpen = false;
    selectedImageKey = null;
    resetView();
  }

  function handleDialogOpenChange(open: boolean) {
    imageDialogOpen = open;
    if (!open) dismissImage();
  }

  function restoreThumbnailFocus(event: Event) {
    event.preventDefault();
    lastTrigger?.focus();
  }

  function changeZoom(delta: number) {
    zoom = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, Number((zoom + delta).toFixed(2))));
  }

  function handleZoomWheel(event: WheelEvent) {
    if (!event.ctrlKey || event.deltaY === 0) return;
    event.preventDefault();
    if (wheelDelta !== 0 && Math.sign(wheelDelta) !== Math.sign(event.deltaY)) wheelDelta = 0;
    wheelDelta += event.deltaY;
    if (Math.abs(wheelDelta) < 24) return;
    changeZoom(wheelDelta < 0 ? ZOOM_STEP : -ZOOM_STEP);
    wheelDelta = 0;
  }

  function measureStage() {
    if (!lightboxStage) return;
    stageWidth = lightboxStage.clientWidth;
    stageHeight = lightboxStage.clientHeight;
  }

  $effect(() => {
    const stage = lightboxStage;
    if (!imageDialogOpen || !selectedImage || !stage) return;

    const measure = () => measureStage();
    measure();
    const frame = typeof requestAnimationFrame === 'function' ? requestAnimationFrame(measure) : null;
    const observer = typeof ResizeObserver === 'function' ? new ResizeObserver(measure) : null;
    observer?.observe(stage);
    if (!observer) window.addEventListener('resize', measure);

    return () => {
      if (frame !== null) cancelAnimationFrame(frame);
      observer?.disconnect();
      if (!observer) window.removeEventListener('resize', measure);
    };
  });

  $effect(() => {
    const key = selectedImage?.key;
    const image = lightboxImage;
    if (!imageDialogOpen || !key || !image || image.dataset.galleryKey !== key) return;
    if (image.complete && image.naturalWidth > 0 && image.naturalHeight > 0) {
      setNaturalDimensions(key, image.naturalWidth, image.naturalHeight);
    }
  });

  $effect(() => {
    const root = lightboxRoot;
    if (!imageDialogOpen || !selectedImage || !root) return;
    root.addEventListener('wheel', handleZoomWheel, { passive: false });
    return () => root.removeEventListener('wheel', handleZoomWheel);
  });

  function nextValidImageAfter(key: string): SessionImageGalleryItem | null {
    const sourceIndex = activeGallery.findIndex((image) => image.key === key);
    const candidates = galleryImages.filter((image) => image.key !== key);
    if (candidates.length === 0) return null;
    if (sourceIndex < 0) return null;
    return candidates.find((image) => activeGallery.findIndex((item) => item.key === image.key) > sourceIndex) ?? candidates[0];
  }

  $effect(() => {
    const key = selectedImageKey;
    if (!imageDialogOpen || !key || selectedImage) return;
    const nextImage = nextValidImageAfter(key);
    if (nextImage) selectImage(nextImage.key);
    else dismissImage();
  });

  function selectRelativeImage(offset: number) {
    if (galleryImages.length < 2 || selectedImageIndex < 0) return;
    selectImage(galleryImages[(selectedImageIndex + offset + galleryImages.length) % galleryImages.length].key);
  }

  function handleViewerKeydown(event: KeyboardEvent) {
    if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
    event.preventDefault();
    selectRelativeImage(event.key === 'ArrowLeft' ? -1 : 1);
  }

  function handleViewerBackdropClick(event: MouseEvent) {
    if (event.target === lightboxStage) dismissImage();
  }

  function setNaturalDimensions(key: string, width: number, height: number) {
    if (key !== selectedImageKey || width <= 0 || height <= 0) return;
    naturalDimensionsByKey.set(key, { width, height });
    naturalWidth = width;
    naturalHeight = height;
    measureStage();
  }

  function handleImageLoad(event: Event, key: string) {
    const image = event.currentTarget as HTMLImageElement;
    setNaturalDimensions(key, image.naturalWidth, image.naturalHeight);
  }

  function handleImageFailure(key: string) {
    if (activeFailedImageKeys.has(key)) return;
    const wasSelected = selectedImageKey === key;
    const nextImage = wasSelected ? nextValidImageAfter(key) : null;

    if (onImageFailure) onImageFailure(key);
    else localFailedImageKeys = new Set([...localFailedImageKeys, key]);

    if (!wasSelected) return;
    if (nextImage) selectImage(nextImage.key);
    else dismissImage();
  }
</script>

<div class:session-attachments-compact={compact} class="session-attachments" aria-label="Attachments">
  {#each attachmentBlocks as block, index (blockKey(block, index))}
    {@const key = blockKey(block, index)}
    {@const galleryKey = block.type === 'image' ? galleryKeyForBlock(block, index) : null}
    {@const failureKey = galleryKey ?? key}
    {@const name = galleryKey ? activeGallery.find((item) => item.key === galleryKey)?.name ?? fallbackName(block, index) : fallbackName(block, index)}
    {#if block.type === 'image'}
      {@const source = `data:${block.mimeType};base64,${block.data}`}
      <figure class="session-image-preview">
        {#if block.data && !block.unavailable && galleryKey && !activeFailedImageKeys.has(failureKey)}
          <Tooltip.Provider delayDuration={250} skipDelayDuration={80}>
            <Tooltip.Root disableHoverableContent>
              <Tooltip.Trigger
                class="session-image-trigger"
                type="button"
                aria-label={`Open ${name}`}
                title={name}
                onclick={(event) => openImage(event, galleryKey)}
              >
                <img
                  class="session-image-thumbnail"
                  src={source}
                  alt={name}
                  onerror={() => handleImageFailure(failureKey)}
                />
              </Tooltip.Trigger>
              <Tooltip.Portal>
                <Tooltip.Content class="app-tooltip-content" sideOffset={6}>{name}</Tooltip.Content>
              </Tooltip.Portal>
            </Tooltip.Root>
          </Tooltip.Provider>
        {:else}
          <div class="session-attachment-fallback" role="status">
            <FileText size={20} />
            <span>{name}</span>
            <small>{block.mimeType || 'Image preview unavailable'}</small>
          </div>
        {/if}
        {#if removable && block.id}
          <button
            class="session-attachment-remove"
            type="button"
            aria-label={`Remove ${name}`}
            onclick={(event) => {
              event.stopPropagation();
              onRemove?.(block.id!);
            }}
          >
            <X size={14} />
          </button>
        {/if}
      </figure>
    {:else}
      <div class="session-file-card">
        <FileText size={18} aria-hidden="true" />
        <span class="session-file-card-copy">
          <strong>{name}</strong>
          <small>{[block.mimeType, formatFileSize(block.size)].filter(Boolean).join(' · ') || 'Attached file'}</small>
        </span>
        {#if removable && block.id}
          <button class="session-attachment-remove" type="button" aria-label={`Remove ${name}`} onclick={() => onRemove?.(block.id!)}>
            <X size={14} />
          </button>
        {/if}
      </div>
    {/if}
  {/each}
</div>

{#if selectedImage}
  <Dialog.Root open={imageDialogOpen} onOpenChange={handleDialogOpenChange}>
    <Dialog.Portal to={overlayPortalTarget}>
      <Dialog.Overlay class="session-image-lightbox-backdrop" onclick={dismissImage} />
      <Dialog.Content
        bind:ref={lightboxRoot}
        class="session-image-lightbox"
        data-blocking-overlay="true"
        onCloseAutoFocus={restoreThumbnailFocus}
        onkeydown={handleViewerKeydown}
        onclick={handleViewerBackdropClick}
      >
        <Dialog.Title class="session-image-lightbox-filename" title={selectedImage.name}>{selectedImage.name}</Dialog.Title>
        <Dialog.Description class="sr-only">Image preview. Use Control plus the mouse wheel to zoom and the left and right arrow keys to navigate.</Dialog.Description>

        <div
          bind:this={lightboxStage}
          class:session-image-lightbox-scroll-zoomed={zoom > 1}
          class="session-image-lightbox-scroll"
          data-testid="image-lightbox-stage"
        >
          <div
            class:session-image-lightbox-canvas-measured={imageFit !== null}
            class="session-image-lightbox-canvas"
            data-testid="image-lightbox-canvas"
            style:width={renderedWidth === null ? undefined : `${renderedWidth}px`}
            style:height={renderedHeight === null ? undefined : `${renderedHeight}px`}
          >
            {#key selectedImage.key}
              <img
                bind:this={lightboxImage}
                class:session-image-lightbox-image-fit={zoom <= 1}
                class="session-image-lightbox-image"
                data-gallery-key={selectedImage.key}
                src={`data:${selectedImage.block.mimeType};base64,${selectedImage.block.data}`}
                alt={selectedImage.name}
                style:width={renderedWidth === null ? undefined : `${renderedWidth}px`}
                style:height={renderedHeight === null ? undefined : `${renderedHeight}px`}
                onload={(event) => handleImageLoad(event, selectedImage.key)}
                onerror={() => handleImageFailure(selectedImage.key)}
              />
            {/key}
          </div>
        </div>

        <button
          class="session-image-lightbox-close"
          type="button"
          aria-label="Close image preview"
          title="Close image preview"
          onclick={dismissImage}
        >
          <X size={18} aria-hidden="true" />
        </button>
        <output class="session-image-lightbox-zoom" aria-label="Zoom level">{Math.round(zoom * 100)}%</output>
      </Dialog.Content>
    </Dialog.Portal>
  </Dialog.Root>
{/if}
