const ROOT_FOLDER_NAME = 'PasswordVaultApp';

/**
 * Helper to construct the standardized YYYYMMDD_HHMMSS timestamp.
 */
export function getTimestamp(): string {
  const now = new Date();
  const pad = (num: number) => num.toString().padStart(2, '0');
  return `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}_` +
         `${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
}

/**
 * Retrieve or create the app root folder 'PasswordVaultApp' on Google Drive.
 */
export async function getOrCreateRootFolder(accessToken: string): Promise<string> {
  // Directly return the specific Google Drive folder ID configured by the user
  return '1cr021U7ziXOvacYn3GbN5_U9B3lta2Zu';
}

interface PointerContent {
  latest_file_id: string;
  latest_version: number;
  updated_at: string;
}

/**
 * Get the latest pointer file (e.g. vault_{account}_latest.json).
 * Returns the pointer file ID and its parsed content, or null if it doesn't exist.
 */
export async function getLatestPointer(
  accessToken: string,
  folderId: string,
  accountName: string
): Promise<{ fileId: string; content: PointerContent } | null> {
  const pointerName = `vault_${accountName}_latest.json`;
  const query = `name = '${pointerName}' and '${folderId}' in parents and trashed = false`;
  const url = `https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(query)}&fields=files(id,name)`;

  const response = await fetch(url, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });

  if (!response.ok) {
    throw new Error('Failed to query latest pointer file.');
  }

  const data = await response.json();
  const files = data.files || [];

  if (files.length === 0) {
    return null;
  }

  const fileId = files[0].id;

  // Download the pointer content
  const contentResponse = await fetch(`https://www.googleapis.com/drive/v3/files/${fileId}?alt=media`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });

  if (!contentResponse.ok) {
    throw new Error('Failed to download latest pointer details.');
  }

  const content = await contentResponse.json();
  return { fileId, content };
}

/**
 * Download a vault file's content by its Google Drive file ID.
 */
export async function downloadVaultFile(accessToken: string, fileId: string): Promise<any> {
  const url = `https://www.googleapis.com/drive/v3/files/${fileId}?alt=media`;
  
  const response = await fetch(url, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });

  if (!response.ok) {
    throw new Error('Failed to download vault content.');
  }

  return await response.json();
}

/**
 * Perform a multipart upload to write a new file to Google Drive.
 */
async function uploadFileMultipart(
  accessToken: string,
  folderId: string,
  filename: string,
  content: string | object
): Promise<string> {
  const boundary = 'vault_multipart_boundary';
  const metadata = {
    name: filename,
    parents: [folderId],
  };
  
  const fileContent = typeof content === 'string' ? content : JSON.stringify(content, null, 2);

  const multipartBody = [
    `\r\n--${boundary}\r\n`,
    'Content-Type: application/json; charset=UTF-8\r\n\r\n',
    JSON.stringify(metadata),
    `\r\n--${boundary}\r\n`,
    'Content-Type: application/json; charset=UTF-8\r\n\r\n',
    fileContent,
    `\r\n--${boundary}--`
  ].join('');

  const response = await fetch('https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': `multipart/related; boundary=${boundary}`,
    },
    body: multipartBody,
  });

  if (!response.ok) {
    const errText = await response.text();
    console.error('Upload error details:', errText);
    throw new Error(`Failed to upload file "${filename}" to Google Drive.`);
  }

  const data = await response.json();
  return data.id;
}

/**
 * Update the content of an existing file (used for updating the latest pointer file).
 */
async function updateFileMedia(
  accessToken: string,
  fileId: string,
  content: string | object
): Promise<void> {
  const url = `https://www.googleapis.com/upload/drive/v3/files/${fileId}?uploadType=media`;
  const fileContent = typeof content === 'string' ? content : JSON.stringify(content, null, 2);

  const response = await fetch(url, {
    method: 'PATCH',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json; charset=UTF-8',
    },
    body: fileContent,
  });

  if (!response.ok) {
    throw new Error('Failed to update pointer file content.');
  }
}

/**
 * Save a new vault version and update/create the pointer file.
 * Returns the new version number and the new file ID.
 */
export async function saveVaultVersion(
  accessToken: string,
  folderId: string,
  accountName: string,
  vaultData: any,
  existingPointer: { fileId: string; content: PointerContent } | null
): Promise<{ version: number; fileId: string }> {
  const nextVersion = existingPointer ? existingPointer.content.latest_version + 1 : 1;
  const timestamp = getTimestamp();
  const filename = `vault_${accountName}_${timestamp}.vault`;

  // 1. Upload new encrypted versioned vault file
  const newVaultFileId = await uploadFileMultipart(accessToken, folderId, filename, vaultData);

  // 2. Update or create the pointer file pointing to the new versioned file
  const pointerContent: PointerContent = {
    latest_file_id: newVaultFileId,
    latest_version: nextVersion,
    updated_at: new Date().toISOString(),
  };

  const pointerFilename = `vault_${accountName}_latest.json`;

  if (existingPointer) {
    // Overwrite existing pointer content
    await updateFileMedia(accessToken, existingPointer.fileId, pointerContent);
  } else {
    // Create new pointer file
    await uploadFileMultipart(accessToken, folderId, pointerFilename, pointerContent);
  }

  return {
    version: nextVersion,
    fileId: newVaultFileId,
  };
}
