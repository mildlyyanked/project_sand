import { Directory, File, Paths } from 'expo-file-system';

/** Persist a data URL image under the app's documents and return its file URI. */
export async function saveImage(id: string, dataUrl: string): Promise<string> {
  const m = /^data:(image\/[a-z0-9.+-]+);base64,(.*)$/i.exec(dataUrl);
  if (!m) throw new Error('The image model returned something that is not an image.');
  const ext = m[1]!.includes('jpeg') || m[1]!.includes('jpg') ? 'jpg' : m[1]!.includes('webp') ? 'webp' : 'png';
  const dir = new Directory(Paths.document, 'illustrations');
  if (!dir.exists) dir.create({ intermediates: true, idempotent: true });
  const file = new File(dir, `${id}.${ext}`);
  file.write(m[2]!, { encoding: 'base64' });
  return file.uri;
}

export async function removeImage(uri: string): Promise<void> {
  try {
    const f = new File(uri);
    if (f.exists) f.delete();
  } catch {}
}
