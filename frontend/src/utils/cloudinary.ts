/** Cloudinary delivery URL helpers (client-side transforms for lists/thumbnails). */

export type CloudinaryThumbSize = { w: number; h: number };

const DEFAULT_THUMB: CloudinaryThumbSize = { w: 480, h: 360 };

/**
 * Returns a transformed Cloudinary URL for grid/list thumbnails.
 * Non-Cloudinary URLs are returned unchanged.
 */
export function cloudinaryThumbnail(
  url: string | null | undefined,
  size: CloudinaryThumbSize = DEFAULT_THUMB
): string {
  const u = (url ?? "").trim();
  if (!u) return "";
  if (!u.includes("res.cloudinary.com") || !u.includes("/upload/")) return u;
  if (/\/upload\/[^/]*w_\d+/.test(u)) return u;
  const transform = `w_${size.w},h_${size.h},c_fill,q_auto,f_auto`;
  return u.replace("/upload/", `/upload/${transform}/`);
}

/** Full-resolution URL for lightbox / download links. */
export function cloudinaryFull(url: string | null | undefined): string {
  return (url ?? "").trim();
}
