type IconProps = {
  name: string;
  size?: number;
  class?: string;
  style?: any;
};

/**
 * Reusable Icon component using SVG symbols
 * Usage: <Icon name="close" size={16} />
 */
const Icon = (props: IconProps) => {
  const size = props.size || 24;

  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      stroke-width="2"
      stroke-linecap="round"
      stroke-linejoin="round"
      class={props.class}
      style={props.style}
    >
      <use href={`#icon-${props.name}`} />
    </svg>
  );
};

/**
 * SVG Symbol Definitions
 * Include once in your app root
 */
export const IconSymbols = () => (
  <svg style={{ display: "none" }} xmlns="http://www.w3.org/2000/svg">
    {/* Close / X */}
    <symbol id="icon-close" viewBox="0 0 24 24">
      <line x1="18" y1="6" x2="6" y2="18" />
      <line x1="6" y1="6" x2="18" y2="18" />
    </symbol>

    {/* Grid View */}
    <symbol id="icon-grid" viewBox="0 0 24 24">
      <rect x="3" y="3" width="7" height="7" />
      <rect x="14" y="3" width="7" height="7" />
      <rect x="14" y="14" width="7" height="7" />
      <rect x="3" y="14" width="7" height="7" />
    </symbol>

    {/* List View */}
    <symbol id="icon-list" viewBox="0 0 24 24">
      <line x1="8" y1="6" x2="21" y2="6" />
      <line x1="8" y1="12" x2="21" y2="12" />
      <line x1="8" y1="18" x2="21" y2="18" />
      <line x1="3" y1="6" x2="3.01" y2="6" />
      <line x1="3" y1="12" x2="3.01" y2="12" />
      <line x1="3" y1="18" x2="3.01" y2="18" />
    </symbol>

    {/* Filter */}
    <symbol id="icon-filter" viewBox="0 0 24 24">
      <polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3" />
    </symbol>

    {/* Edit / Pencil */}
    <symbol id="icon-edit" viewBox="0 0 24 24">
      <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
      <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
    </symbol>

    {/* Image / Picture */}
    <symbol id="icon-image" viewBox="0 0 24 24">
      <rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
      <circle cx="8.5" cy="8.5" r="1.5" />
      <polyline points="21 15 16 10 5 21" />
    </symbol>

    {/* Trash / Delete */}
    <symbol id="icon-trash" viewBox="0 0 24 24">
      <polyline points="3 6 5 6 21 6" />
      <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
      <line x1="10" y1="11" x2="10" y2="17" />
      <line x1="14" y1="11" x2="14" y2="17" />
    </symbol>

    {/* Save / Floppy Disk */}
    <symbol id="icon-save" viewBox="0 0 24 24">
      <path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z" />
      <polyline points="17 21 17 13 7 13 7 21" />
      <polyline points="7 3 7 8 15 8" />
    </symbol>

    {/* Upload / Cloud */}
    <symbol id="icon-upload" viewBox="0 0 24 24">
      <path d="M20 16.5c1.7 0 3-1.3 3-3s-1.3-3-3-3c-.4 0-.8.1-1.2.3-.6-2.3-2.7-4-5.2-4-2 0-3.8 1.1-4.7 2.8C7.6 9.2 6.4 10 5.5 11c-1.4.9-2.3 2.5-2.3 4.2 0 2.8 2.2 5 5 5h11.8"/>
      <polyline points="16 16 12 12 8 16"/>
      <line x1="12" y1="12" x2="12" y2="21"/>
    </symbol>

    {/* Star (filled) */}
    <symbol id="icon-star" viewBox="0 0 24 24">
      <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
    </symbol>

    {/* Check / Approve */}
    <symbol id="icon-check" viewBox="0 0 24 24">
      <path d="M20 6L9 17l-5-5"/>
    </symbol>

    {/* Download */}
    <symbol id="icon-download" viewBox="0 0 24 24">
      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
      <polyline points="7 10 12 15 17 10"/>
      <line x1="12" y1="15" x2="12" y2="3"/>
    </symbol>

    {/* Fork / Branch */}
    <symbol id="icon-fork" viewBox="0 0 24 24">
      <circle cx="12" cy="18" r="3"/>
      <circle cx="6" cy="6" r="3"/>
      <circle cx="18" cy="6" r="3"/>
      <path d="M18 9v2c0 .6-.4 1-1 1H7c-.6 0-1-.4-1-1V9"/>
      <line x1="12" y1="12" x2="12" y2="15"/>
    </symbol>

    {/* Settings / Gear */}
    <symbol id="icon-settings" viewBox="0 0 24 24">
      <circle cx="12" cy="12" r="3"/>
      <path d="M12 1v6m0 6v6M5.6 5.6l4.2 4.2m4.2 4.2l4.2 4.2M1 12h6m6 0h6M5.6 18.4l4.2-4.2m4.2-4.2l4.2-4.2"/>
    </symbol>

    {/* Search */}
    <symbol id="icon-search" viewBox="0 0 24 24">
      <circle cx="11" cy="11" r="8"/>
      <line x1="21" y1="21" x2="16.65" y2="16.65"/>
    </symbol>

    {/* Arrow Down */}
    <symbol id="icon-arrow-down" viewBox="0 0 24 24">
      <line x1="12" y1="5" x2="12" y2="19"/>
      <polyline points="19 12 12 19 5 12"/>
    </symbol>

    {/* Bell / Notification */}
    <symbol id="icon-bell" viewBox="0 0 24 24">
      <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/>
      <path d="M13.73 21a2 2 0 0 1-3.46 0"/>
    </symbol>

    {/* Eye / View */}
    <symbol id="icon-eye" viewBox="0 0 24 24">
      <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/>
      <circle cx="12" cy="12" r="3"/>
    </symbol>

    {/* Folder */}
    <symbol id="icon-folder" viewBox="0 0 24 24">
      <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/>
    </symbol>

    {/* Link */}
    <symbol id="icon-link" viewBox="0 0 24 24">
      <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/>
      <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/>
    </symbol>

    {/* Blender Logo */}
    <symbol id="icon-blender" viewBox="0 0 499.77 405.98">
      <path fill="currentColor" opacity="0.05" d="M196.49,225.35c1.82-32.49,17.73-61.11,41.73-81.4,23.54-19.92,55.22-32.1,89.78-32.1S394.21,124,417.77,144c24,20.29,39.89,48.91,41.73,81.37,1.82,33.38-11.6,64.39-35.14,87.37-24,23.38-58.13,38.06-96.36,38.06s-72.43-14.68-96.41-38.06C208,289.71,194.66,258.7,196.49,225.35Z"/>
      <path fill="currentColor" opacity="0.08" d="M260.53,228.27c.93-16.67,9.1-31.36,21.41-41.77a72.65,72.65,0,0,1,92.13,0c12.3,10.41,20.47,25.1,21.41,41.75.93,17.13-6,33-18,44.83-12.31,12-29.83,19.53-49.44,19.53s-37.16-7.53-49.47-19.53C266.45,261.29,259.59,245.38,260.53,228.27Z"/>
      <path fill="currentColor" opacity="0.1" d="M153.08,262c.11,6.52,2.19,19.2,5.31,29.1a153.58,153.58,0,0,0,33.16,57.42,171.34,171.34,0,0,0,58,41.67A189.71,189.71,0,0,0,402,389.88,172.65,172.65,0,0,0,460,348a154.79,154.79,0,0,0,33.15-57.53,145.39,145.39,0,0,0,6.24-32.11,146.87,146.87,0,0,0-1-31.9,148.49,148.49,0,0,0-21.15-57.87,161.49,161.49,0,0,0-38.58-42.53l0,0L282.5,6.2c-.14-.11-.26-.22-.41-.32-10.24-7.86-27.47-7.83-38.73,0s-12.69,21.14-2.56,29.46l0,0,65.11,53-198.46.21h-.27C90.74,88.61,75,99.37,71.85,113c-3.21,13.86,7.93,25.36,25,25.42l0,.06,100.6-.19L17.9,276l-.69.51C.28,289.52-5.2,311.08,5.47,324.73c10.82,13.87,33.84,13.9,51,.08l98-80.18A152.15,152.15,0,0,0,153.08,262ZM404.82,298.2c-20.18,20.56-48.44,32.22-79,32.28s-58.89-11.5-79.07-32a93.92,93.92,0,0,1-21.58-33.78,87.69,87.69,0,0,1-5-37.74A89.11,89.11,0,0,1,231,191.39a98,98,0,0,1,24-28.55c19.62-16,44.6-24.65,70.73-24.68s51.12,8.54,70.76,24.48a97.5,97.5,0,0,1,24,28.46,89.19,89.19,0,0,1,10.86,35.52,87.81,87.81,0,0,1-5,37.72A94.33,94.33,0,0,1,404.82,298.2Z"/>
    </symbol>

    {/* Reload / Refresh */}
    <symbol id="icon-reload" viewBox="0 0 24 24">
      <polyline points="23 4 23 10 17 10"/>
      <polyline points="1 20 1 14 7 14"/>
      <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"/>
    </symbol>

    {/* X Circle (error) */}
    <symbol id="icon-x-circle" viewBox="0 0 24 24">
      <circle cx="12" cy="12" r="10"/>
      <line x1="15" y1="9" x2="9" y2="15"/>
      <line x1="9" y1="9" x2="15" y2="15"/>
    </symbol>

    {/* Shield (moderation) */}
    <symbol id="icon-shield" viewBox="0 0 24 24">
      <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>
    </symbol>

    {/* Rotate CCW (reset) */}
    <symbol id="icon-rotate-ccw" viewBox="0 0 24 24">
      <path d="M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8"/>
      <path d="M21 3v5h-5"/>
      <path d="M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16"/>
      <path d="M3 21v-5h5"/>
    </symbol>

    {/* Rotate CW (refresh) */}
    <symbol id="icon-rotate-cw" viewBox="0 0 24 24">
      <path d="M21 2v6h-6"/>
      <path d="M3 12a9 9 0 0 1 15-6.7L21 8"/>
      <path d="M3 22v-6h6"/>
      <path d="M21 12a9 9 0 0 1-15 6.7L3 16"/>
    </symbol>

    {/* Plus */}
    <symbol id="icon-plus" viewBox="0 0 24 24">
      <path d="M12 5v14m-7-7h14"/>
    </symbol>

    {/* Move (arrows) */}
    <symbol id="icon-move" viewBox="0 0 24 24">
      <path d="M5 9l-3 3 3 3M9 5l3-3 3 3M15 19l-3 3-3-3M19 9l3 3-3 3M2 12h20M12 2v20"/>
    </symbol>

    {/* User */}
    <symbol id="icon-user" viewBox="0 0 24 24">
      <circle cx="12" cy="8" r="4"/>
      <path d="M6 21v-2a4 4 0 0 1 4-4h4a4 4 0 0 1 4 4v2"/>
    </symbol>

    {/* Dice (randomize) */}
    <symbol id="icon-dice" viewBox="0 0 24 24">
      <rect x="3" y="3" width="18" height="18" rx="2" ry="2"/>
      <circle cx="8.5" cy="8.5" r="1.5"/>
      <circle cx="15.5" cy="8.5" r="1.5"/>
      <circle cx="8.5" cy="15.5" r="1.5"/>
      <circle cx="15.5" cy="15.5" r="1.5"/>
      <circle cx="12" cy="12" r="1.5"/>
    </symbol>

    {/* Rocket (release) */}
    <symbol id="icon-rocket" viewBox="0 0 24 24">
      <path d="M4.5 16.5c-1.5 1.26-2 5-2 5s3.74-.5 5-2c.71-.84.7-2.13-.09-2.91a2.18 2.18 0 0 0-2.91-.09z"/>
      <path d="M12 15l-3-3a22 22 0 0 1 2-3.95A12.88 12.88 0 0 1 22 2c0 2.72-.78 7.5-6 11a22.35 22.35 0 0 1-4 2z"/>
      <path d="M9 12H4s.55-3.03 2-4c1.62-1.08 5 0 5 0"/>
      <path d="M12 15v5s3.03-.55 4-2c1.08-1.62 0-5 0-5"/>
    </symbol>

    {/* Calendar */}
    <symbol id="icon-calendar" viewBox="0 0 24 24">
      <rect x="3" y="4" width="18" height="18" rx="2" ry="2" />
      <line x1="16" y1="2" x2="16" y2="6" />
      <line x1="8" y1="2" x2="8" y2="6" />
      <line x1="3" y1="10" x2="21" y2="10" />
    </symbol>

    {/* Git Branch */}
    <symbol id="icon-git-branch" viewBox="0 0 24 24">
      <line x1="6" y1="3" x2="6" y2="15" />
      <circle cx="18" cy="6" r="3" />
      <circle cx="6" cy="18" r="3" />
      <path d="M18 9a9 9 0 0 1-9 9" />
    </symbol>

    {/* Box / Package */}
    <symbol id="icon-box" viewBox="0 0 24 24">
      <line x1="16.5" y1="9.4" x2="7.5" y2="4.21" />
      <path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z" />
      <polyline points="3.27 6.96 12 12.01 20.73 6.96" />
      <line x1="12" y1="22.08" x2="12" y2="12" />
    </symbol>

    {/* File */}
    <symbol id="icon-file" viewBox="0 0 24 24">
      <path d="M13 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z" />
      <polyline points="13 2 13 9 20 9" />
    </symbol>
  </svg>
);

export default Icon;
