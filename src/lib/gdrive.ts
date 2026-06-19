/**
 * Retrieve or create the app root folder on Google Drive.
 * For this application, we use Google Drive's hidden 'appDataFolder'.
 */
export async function getOrCreateRootFolder(accessToken: string): Promise<string> {
  return 'appDataFolder';
}

/**
/**
 * Rename a file on Google Drive.
 */
export async function renameVaultFile(
  accessToken: string,
  fileId: string,
  newFilename: string
): Promise<void> {
  const url = `https://www.googleapis.com/drive/v3/files/${fileId}`;
  const response = await fetch(url, {
    method: 'PATCH',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ name: newFilename }),
  });

  if (!response.ok) {
    throw new Error('Failed to rename vault file on Google Drive.');
  }
}

/**
 * Get the vault file (e.g. bigkuanvault_{account}.vault).
 * Returns the file ID if it exists, or null if it doesn't.
 * Automatically handles migration from legacy bigcanvault_{account}.vault filenames.
 */
export async function getVaultFile(
  accessToken: string,
  folderId: string, // 'appDataFolder'
  accountName: string
): Promise<string | null> {
  const newFilename = `bigkuanvault_${accountName}.vault`;
  const oldFilename = `bigcanvault_${accountName}.vault`;

  // Query Google Drive for either the new or old filename
  const query = `(name = '${newFilename}' or name = '${oldFilename}') and '${folderId}' in parents and trashed = false`;
  const url = `https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(query)}&spaces=appDataFolder&fields=files(id,name)`;

  const response = await fetch(url, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });

  if (!response.ok) {
    throw new Error('Failed to query vault file.');
  }

  const data = await response.json();
  const files = data.files || [];

  if (files.length === 0) {
    return null;
  }

  const foundFile = files[0];
  if (foundFile.name === oldFilename) {
    // Transparently rename the file on Google Drive to match the new naming rules
    try {
      await renameVaultFile(accessToken, foundFile.id, newFilename);
      console.log(`Transparently migrated ${oldFilename} to ${newFilename} on Google Drive.`);
    } catch (err) {
      console.error('Failed to automatically migrate legacy vault filename:', err);
    }
  }

  return foundFile.id;
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
 * Update the content of an existing file (used to update the vault content).
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
    throw new Error('Failed to update vault file content.');
  }
}

/**
 * Save the vault file (either updates existing or creates new).
 * Returns the file ID.
 */
export async function saveVaultFile(
  accessToken: string,
  folderId: string,
  accountName: string,
  vaultData: any,
  existingFileId: string | null
): Promise<string> {
  const filename = `bigkuanvault_${accountName}.vault`;

  if (existingFileId) {
    // Overwrite existing file content
    await updateFileMedia(accessToken, existingFileId, vaultData);
    return existingFileId;
  } else {
    // Create new file in appDataFolder
    return await uploadFileMultipart(accessToken, folderId, filename, vaultData);
  }
}

/**
 * Delete a vault file by its ID.
 */
export async function deleteVaultFile(accessToken: string, fileId: string): Promise<void> {
  const url = `https://www.googleapis.com/drive/v3/files/${fileId}`;
  
  const response = await fetch(url, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${accessToken}` },
  });

  if (!response.ok) {
    throw new Error('Failed to delete vault file from Google Drive.');
  }
}

