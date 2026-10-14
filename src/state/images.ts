// Web: keep the data URL itself; there is no app-private file store to write to.
export async function saveImage(_id: string, dataUrl: string): Promise<string> {
  return dataUrl;
}
export async function removeImage(_uri: string): Promise<void> {}
/** A saved image as a data URL, to send as a reference. On web it already is one. */
export async function imageDataUrl(uri: string): Promise<string | null> {
  return uri.startsWith('data:') ? uri : null;
}
