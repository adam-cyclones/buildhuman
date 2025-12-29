/**
 * Shared Asset types for the application
 */

export interface Asset {
  id: string;
  name: string;
  description?: string;
  type: string;
  category: string;
  author: string;
  rating: number;
  rating_count: number;
  license: string;
  publish_date: string;
  downloads: number;
  file_size?: number;
  version: string;
  required: boolean;
  thumbnail_url?: string;
}
