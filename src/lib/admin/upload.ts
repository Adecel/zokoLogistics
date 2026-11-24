import { Platform } from 'react-native';
import { pickProof, type PickedImage } from '../proof-upload';
import { supabase } from '../supabase';

// Pick an image from the computer / phone gallery (null if cancelled)
export async function pickImage(): Promise<PickedImage | null> {
  const result = await pickProof('library');
  return result === 'denied' ? null : result;
}

function base64ToBytes(base64: string) {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

const PUBLIC_BUCKET = 'vehicle-photos';

// Upload to the public "vehicle-photos" storage (vehicles and driver photos).
// folder: e.g. "models/<id>" or "drivers/<id>". Returns the public URL.
export async function uploadPublicImage(folder: string, image: PickedImage) {
  const ext = image.mimeType.includes('png') ? 'png' : image.mimeType.includes('webp') ? 'webp' : 'jpg';
  const contentType = ext === 'jpg' ? 'image/jpeg' : image.mimeType;
  const path = `${folder}/${Date.now()}.${ext}`;

  let body: File | Uint8Array | ArrayBuffer;
  if (Platform.OS === 'web' && image.file) body = image.file;
  else if (image.base64) body = base64ToBytes(image.base64);
  else body = await (await fetch(image.uri)).arrayBuffer();

  const { error } = await supabase.storage.from(PUBLIC_BUCKET).upload(path, body, { contentType, upsert: false });
  if (error) throw error;
  return supabase.storage.from(PUBLIC_BUCKET).getPublicUrl(path).data.publicUrl;
}

// Remove a file from the public storage using its public URL (ignores other URLs)
export async function removePublicImage(url: string) {
  const marker = `/object/public/${PUBLIC_BUCKET}/`;
  const i = url.indexOf(marker);
  if (i === -1) return;
  await supabase.storage.from(PUBLIC_BUCKET).remove([decodeURIComponent(url.slice(i + marker.length))]);
}
