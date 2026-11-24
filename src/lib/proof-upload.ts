import * as ImagePicker from 'expo-image-picker';
import { Platform } from 'react-native';
import { supabase } from './supabase';

export type PickedImage = { uri: string; mimeType: string; base64?: string | null; file?: File };

// Pick a payment proof from the gallery or the camera.
// Returns null if cancelled, 'denied' if the camera permission was refused.
export async function pickProof(source: 'library' | 'camera'): Promise<PickedImage | null | 'denied'> {
  if (source === 'camera') {
    const permission = await ImagePicker.requestCameraPermissionsAsync();
    if (!permission.granted) return 'denied';
  }
  const options: ImagePicker.ImagePickerOptions = { mediaTypes: ['images'], quality: 0.6, base64: true };
  const result =
    source === 'camera' ? await ImagePicker.launchCameraAsync(options) : await ImagePicker.launchImageLibraryAsync(options);
  if (result.canceled) return null;
  const asset = result.assets[0];
  return { uri: asset.uri, mimeType: asset.mimeType ?? 'image/jpeg', base64: asset.base64, file: asset.file };
}

function base64ToBytes(base64: string) {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

// Upload to the private "payment-proofs" storage, in the client's own folder.
// Returns the storage path saved in payments.proof_path.
export async function uploadProof(userId: string, reservationId: string, image: PickedImage) {
  const ext = image.mimeType.includes('png') ? 'png' : image.mimeType.includes('webp') ? 'webp' : 'jpg';
  const contentType = ext === 'jpg' ? 'image/jpeg' : image.mimeType;
  const path = `${userId}/${reservationId}/${Date.now()}.${ext}`;

  let body: File | Uint8Array | ArrayBuffer;
  if (Platform.OS === 'web' && image.file) body = image.file;
  else if (image.base64) body = base64ToBytes(image.base64);
  else body = await (await fetch(image.uri)).arrayBuffer();

  const { error } = await supabase.storage.from('payment-proofs').upload(path, body, { contentType, upsert: false });
  if (error) throw new Error(error.message);
  return path;
}
