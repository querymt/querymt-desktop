import { invoke } from '@tauri-apps/api/core';

export interface ProfileTemplateInfo {
  id: string;
  name: string;
  description: string;
  tags: string[];
  enabled: boolean;
  userPath?: string;
}

export interface ManagedProfileInfo {
  id: string;
  name: string;
  description?: string | null;
  tags: string[];
  userPath: string;
}

export async function listProfileTemplates(): Promise<ProfileTemplateInfo[]> {
  return invoke<ProfileTemplateInfo[]>('querymt_profile_templates');
}

export async function listManagedProfiles(): Promise<ManagedProfileInfo[]> {
  return invoke<ManagedProfileInfo[]>('querymt_profiles_list');
}

export async function enableProfileTemplate(profileId: string): Promise<ProfileTemplateInfo> {
  return invoke<ProfileTemplateInfo>('querymt_profile_enable_template', {
    request: { profileId }
  });
}
