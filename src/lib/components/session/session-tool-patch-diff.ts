let patchDiffModule: Promise<typeof import('./SessionToolPatchDiff.svelte')> | undefined;

export function loadSessionToolPatchDiff() {
  patchDiffModule ??= import('./SessionToolPatchDiff.svelte')
    .then(async (module) => {
      await module.prepareDiffRenderer();
      return module;
    })
    .catch((error) => {
      patchDiffModule = undefined;
      throw error;
    });
  return patchDiffModule;
}

export function preloadSessionToolPatchDiff() {
  void loadSessionToolPatchDiff().catch(() => {
    // Speculative loading must not surface errors; opening the panel can retry.
  });
}
