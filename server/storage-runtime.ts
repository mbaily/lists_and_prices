// This dependency must evaluate before y-websocket: upstream captures YPERSISTENCE
// at import time, including when it is imported by task-documents/persistence.
import { ensureStorageDirectories, resolveStoragePaths } from './storage-paths.ts';

export const storagePaths = resolveStoragePaths();
ensureStorageDirectories(storagePaths);
if (storagePaths.yjsDirectory) process.env.YPERSISTENCE = storagePaths.yjsDirectory;
