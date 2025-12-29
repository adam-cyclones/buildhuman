/**
 * Type definitions for Moderation view
 */

export interface Submission {
  id: string;
  asset_name: string;
  asset_description?: string;
  asset_type: string;
  asset_category: string;
  author: string;
  file_size?: number;
  license: string;
  version: string;
  status: string;
  submitted_at: string;
  ai_moderation_result?: string;
}

export interface ModerationPanelProps {
  apiKey: string;
}
