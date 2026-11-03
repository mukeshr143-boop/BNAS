let inventory = [
  { code: 'OOH-1042', name: 'Lake View Road', category: 'BANS', zone: 'Central', town: 'Bhopal', state: 'Madhya Pradesh', type: 'Hoarding · 30 × 20 ft', booking: 82, revenue: 185000, expenses: 112000, profit: 73000 },
  { code: 'OOH-0881', name: 'MG Road Junction', category: 'BEST', zone: 'Central', town: 'Bhopal', state: 'Madhya Pradesh', type: 'Hoarding · 40 × 20 ft', booking: 68, revenue: 240000, expenses: 156000, profit: 84000 },
  { code: 'OOH-1206', name: 'Airport Approach', category: 'Hired Inventory', zone: 'North', town: 'Indore', state: 'Madhya Pradesh', type: 'Unipole · 30 × 15 ft', booking: 54, revenue: 168000, expenses: 119000, profit: 49000 },
  { code: 'OOH-0974', name: 'Ring Road, Sector 5', category: 'BANS', zone: 'East', town: 'Indore', state: 'Madhya Pradesh', type: 'Hoarding · 30 × 20 ft', booking: 31, revenue: 98000, expenses: 106000, profit: -8000 },
  { code: 'OOH-1318', name: 'City Centre Square', category: 'BEST', zone: 'South', town: 'Jaipur', state: 'Rajasthan', type: 'Digital · 20 × 10 ft', booking: 76, revenue: 210000, expenses: 134000, profit: 76000 },
  { code: 'OOH-1159', name: 'Industrial Link Road', category: 'Hired Inventory', zone: 'West', town: 'Jaipur', state: 'Rajasthan', type: 'Hoarding · 30 × 15 ft', booking: 45, revenue: 125000, expenses: 93000, profit: 32000 },
  { code: 'OOH-1011', name: 'Riverfront Market', category: 'BANS', zone: 'South', town: 'Udaipur', state: 'Rajasthan', type: 'Hoarding · 20 × 10 ft', booking: 22, revenue: 72000, expenses: 81000, profit: -9000 },
  { code: 'OOH-0765', name: 'University Circle', category: 'BEST', zone: 'North', town: 'Bhopal', state: 'Madhya Pradesh', type: 'Unipole · 30 × 20 ft', booking: 91, revenue: 275000, expenses: 148000, profit: 127000 }
];

const workspaceCollections = [
  'inventory',
  'inventory-photos',
  'presentations',
  'landlord-bank-documents',
  'important-documents',
  'landlord-payments',
  'operations-budgets',
  'bank-master'
];

function isCloudDataActive() {
  return Boolean(window.workspaceAuthState?.authenticated && window.workspaceAuthState?.saas);
}

function inventoryDataLabel() {
  return isCloudDataActive() ? 'workspace' : 'sample';
}

function recordIdFromDataset(value) {
  return isCloudDataActive() ? String(value) : Number(value);
}

async function workspaceRequest(path, options = {}) {
  const response = await fetch(path, { credentials: 'same-origin', ...options });
  if (!response.ok) {
    let message = 'Supabase workspace request failed.';
    try {
      const result = await response.json();
      message = result.error || message;
    } catch (error) {
      if (!(error instanceof SyntaxError)) throw error;
    }
    throw new Error(message);
  }
  return response;
}

async function readWorkspaceRecords(collection, includeFiles = false) {
  const response = await workspaceRequest(`/api/data/${encodeURIComponent(collection)}`);
  const result = await response.json();
  const records = result.records || [];
  if (!includeFiles) return records;
  return Promise.all(records.map(async (record) => {
    if (!record.storagePath) return record;
    const fileUrl = `/api/files/${record.storagePath.split('/').map(encodeURIComponent).join('/')}`;
    const fileResponse = await workspaceRequest(fileUrl);
    return { ...record, blob: await fileResponse.blob() };
  }));
}

async function readWorkspaceFile(record) {
  if (!record.storagePath) return record.blob;
  const fileUrl = `/api/files/${record.storagePath.split('/').map(encodeURIComponent).join('/')}`;
  const fileResponse = await workspaceRequest(fileUrl);
  return fileResponse.blob();
}

async function saveWorkspaceRecord(collection, record) {
  const storedRecord = { ...record };
  if (!storedRecord.id) storedRecord.id = crypto.randomUUID();
  if (storedRecord.blob instanceof Blob) {
    const fileName = storedRecord.fileName || 'upload';
    const uploadUrl = `/api/files/${encodeURIComponent(collection)}/${encodeURIComponent(storedRecord.id)}?filename=${encodeURIComponent(fileName)}`;
    const fileResponse = await workspaceRequest(uploadUrl, {
      method: 'POST',
      headers: { 'Content-Type': storedRecord.blob.type || 'application/octet-stream' },
      body: storedRecord.blob
    });
    const uploadResult = await fileResponse.json();
    storedRecord.storagePath = uploadResult.storagePath;
    delete storedRecord.blob;
  }
  const response = await workspaceRequest(`/api/data/${encodeURIComponent(collection)}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(storedRecord)
  });
  const result = await response.json();
  return result.records?.[0]?.id || storedRecord.id;
}

async function saveWorkspaceRecords(collection, records) {
  const storedRecords = records.map((record) => ({
    ...record,
    id: record.id || record.code || crypto.randomUUID()
  }));
  const response = await workspaceRequest(`/api/data/${encodeURIComponent(collection)}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ records: storedRecords })
  });
  return (await response.json()).records || [];
}

async function deleteWorkspaceRecord(collection, recordId) {
  const records = await readWorkspaceRecords(collection, false);
  const record = records.find((item) => String(item.id) === String(recordId));
  if (record?.storagePath) {
    const fileUrl = `/api/files/${record.storagePath.split('/').map(encodeURIComponent).join('/')}`;
    await workspaceRequest(fileUrl, { method: 'DELETE' });
  }
  await workspaceRequest(`/api/data/${encodeURIComponent(collection)}/${encodeURIComponent(recordId)}`, {
    method: 'DELETE'
  });
}

async function readLocalRecords(storeName) {
  const database = await openPhotoDatabase();
  return new Promise((resolve, reject) => {
    const transaction = database.transaction(storeName, 'readonly');
    const request = transaction.objectStore(storeName).getAll();
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error(`Unable to read local ${storeName} records.`));
    transaction.oncomplete = () => database.close();
    transaction.onerror = () => {
      database.close();
      reject(transaction.error || new Error(`Unable to read local ${storeName} records.`));
    };
  });
}

async function initializeWorkspaceData() {
  if (!isCloudDataActive()) return;
  try {
    const tenantId = window.workspaceAuthState.tenantId;
    if (!tenantId) throw new Error('The active workspace id is missing.');
    const migrationKey = `outdoor-media-supabase-migration:${tenantId}`;
    const migrationState = JSON.parse(localStorage.getItem(migrationKey) || '{}');
    for (const collection of workspaceCollections) {
      const records = await readWorkspaceRecords(collection, false);
      if (collection === 'inventory') {
        if (migrationState[collection] === 'done') continue;
        if (records.length && migrationState[collection] !== 'pending') {
          migrationState[collection] = 'done';
          localStorage.setItem(migrationKey, JSON.stringify(migrationState));
          continue;
        }
        migrationState[collection] = 'pending';
        localStorage.setItem(migrationKey, JSON.stringify(migrationState));
        const existingIds = new Set(records.map((record) => String(record.id || record.code)));
        const missingRecords = inventory.filter((record) => !existingIds.has(String(record.code)));
        if (missingRecords.length) await saveWorkspaceRecords(collection, missingRecords);
        migrationState[collection] = 'done';
        localStorage.setItem(migrationKey, JSON.stringify(migrationState));
        continue;
      }
      if (migrationState[collection] === 'done') continue;
      if (records.length && migrationState[collection] !== 'pending') {
        migrationState[collection] = 'done';
        localStorage.setItem(migrationKey, JSON.stringify(migrationState));
        continue;
      }
      migrationState[collection] = 'pending';
      localStorage.setItem(migrationKey, JSON.stringify(migrationState));
      const initialRecords = await readLocalRecords(collection);
      if (initialRecords.length && migrationState.localImportConsent === undefined) {
        const tenantName = window.workspaceAuthState.tenantName || 'this workspace';
        migrationState.localImportConsent = window.confirm(
          `This browser has saved dashboard records and files. Import them into ${tenantName}?`
        );
        localStorage.setItem(migrationKey, JSON.stringify(migrationState));
      }
      if (initialRecords.length && !migrationState.localImportConsent) {
        migrationState[collection] = 'done';
        const showImportNotice = !migrationState.localImportNoticeShown;
        migrationState.localImportNoticeShown = true;
        localStorage.setItem(migrationKey, JSON.stringify(migrationState));
        if (showImportNotice) showToast('Existing browser records were not imported.');
        continue;
      }
      const existingIds = new Set(records.map((record) => String(record.id)));
      for (const record of initialRecords.filter((item) => !existingIds.has(String(item.id)))) {
        await saveWorkspaceRecord(collection, record);
        existingIds.add(String(record.id));
      }
      migrationState[collection] = 'done';
      localStorage.setItem(migrationKey, JSON.stringify(migrationState));
    }
    const cloudInventory = await readWorkspaceRecords('inventory', false);
    inventory = cloudInventory.length ? cloudInventory : [];
    renderOverviewTotals();
    renderZones();
    updateInventoryCounts();
    renderInventory();
    if (document.body.dataset.currentPage && document.body.dataset.currentPage !== 'dashboard') {
      setPage(document.body.dataset.currentPage);
    }
  } catch (error) {
    console.error('Unable to synchronize workspace records with Supabase.', error);
    showToast(`Supabase sync failed: ${error.message}`);
  }
}

function excelCell(value) {
  const isNumber = typeof value === 'number' && Number.isFinite(value);
  const text = isNumber ? String(value) : String(value ?? '');
  const escaped = text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;');
  return `<Cell><Data ss:Type="${isNumber ? 'Number' : 'String'}">${escaped}</Data></Cell>`;
}

function exportExcelWorkbook(fileName, worksheets) {
  const sheetXml = worksheets.map(({ name, rows }) => {
    const sheetName = name.replace(/[\\/?*[\]:]/g, ' ').slice(0, 31) || 'Sheet';
    const rowsXml = rows.map((row) => `<Row>${row.map(excelCell).join('')}</Row>`).join('');
    return `<Worksheet ss:Name="${sheetName}"><Table>${rowsXml}</Table></Worksheet>`;
  }).join('');
  const workbook = `<?xml version="1.0"?><?mso-application progid="Excel.Sheet"?><Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet" xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet">${sheetXml}</Workbook>`;
  const blob = new Blob([workbook], { type: 'application/vnd.ms-excel;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = fileName;
  document.body.append(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function inventoryExportRows(records) {
  const headers = ['Inventory Code', 'Location', 'Category', 'Zone', 'Town', 'State', 'Media Type', 'Booking %', 'Revenue (INR)', 'Expenses (INR)', 'Profit / Loss (INR)'];
  return [headers, ...records.map((item) => [
    item.code, item.name, item.category, item.zone, item.town, item.state,
    item.type, item.booking, item.revenue, item.expenses, item.profit
  ])];
}

function exportInventoryExcel() {
  const page = document.body.dataset.currentPage;
  const config = pageConfig[page];
  if (!config) return;
  const query = document.getElementById('module-inventory-search')?.value.trim().toLowerCase() || '';
  const records = inventory.filter((item) => matchesInventoryView(item, config)
    && (!query || `${item.code} ${item.name} ${item.category} ${item.zone} ${item.town} ${item.state} ${item.type}`.toLowerCase().includes(query)));
  const worksheets = [{ name: 'Inventory Sites', rows: inventoryExportRows(records) }];

  if (config.groupBy) {
    const groups = new Map();
    records.forEach((item) => {
      const name = item[config.groupBy] || 'Unassigned';
      const group = groups.get(name) || { name, items: [], bookingTotal: 0 };
      group.items.push(item);
      group.bookingTotal += item.booking;
      groups.set(name, group);
    });
    const summaryRows = [
      [config.groupBy.toUpperCase(), 'Inventory Sites', 'Average Booking %', 'Inventory Codes'],
      ...[...groups.values()].sort((a, b) => a.name.localeCompare(b.name)).map((group) => [
        group.name, group.items.length, Math.round(group.bookingTotal / group.items.length),
        group.items.map((item) => item.code).join(', ')
      ]),
      ['Total', records.length, '', '']
    ];
    worksheets.unshift({ name: `${config.groupBy} Summary`, rows: summaryRows });
  }

  const filename = `${page}-inventory-${new Date().toISOString().slice(0, 10)}.xls`;
  try {
    exportExcelWorkbook(filename, worksheets);
    showToast(`Excel export downloaded · ${records.length} inventory sites`);
  } catch (error) {
    console.error('Unable to export inventory data.', error);
    showToast(`Excel export failed: ${error.message || 'unable to create workbook'}`);
  }
}

async function updatePhotoPresentationSelection(photoId, selectedForPresentation) {
  if (isCloudDataActive()) {
    const photo = (await readWorkspaceRecords('inventory-photos', false))
      .find((record) => String(record.id) === String(photoId));
    if (!photo) throw new Error('Photo was not found in the workspace.');
    await saveWorkspaceRecord('inventory-photos', { ...photo, selectedForPresentation });
    return;
  }
  const database = await openPhotoDatabase();
  return new Promise((resolve, reject) => {
    const transaction = database.transaction('inventory-photos', 'readwrite');
    const store = transaction.objectStore('inventory-photos');
    const request = store.get(photoId);
    request.onsuccess = () => {
      if (!request.result) {
        transaction.abort();
        return;
      }
      store.put({ ...request.result, selectedForPresentation });
    };
    request.onerror = () => transaction.abort();
    transaction.oncomplete = () => {
      database.close();
      resolve();
    };
    transaction.onerror = () => {
      database.close();
      reject(transaction.error || new Error('Unable to update photo selection.'));
    };
    transaction.onabort = () => {
      database.close();
      reject(transaction.error || new Error('Photo selection update was interrupted.'));
    };
  });
}

async function savePresentation(presentation) {
  if (isCloudDataActive()) return saveWorkspaceRecord('presentations', presentation);
  const database = await openPhotoDatabase();
  return new Promise((resolve, reject) => {
    const transaction = database.transaction('presentations', 'readwrite');
    transaction.objectStore('presentations').add(presentation);
    transaction.oncomplete = () => {
      database.close();
      resolve();
    };
    transaction.onerror = () => {
      database.close();
      reject(transaction.error || new Error('Unable to save presentation draft.'));
    };
    transaction.onabort = () => {
      database.close();
      reject(transaction.error || new Error('Presentation draft save was interrupted.'));
    };
  });
}

async function getPresentations() {
  if (isCloudDataActive()) {
    return (await readWorkspaceRecords('presentations')).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }
  const database = await openPhotoDatabase();
  return new Promise((resolve, reject) => {
    const transaction = database.transaction('presentations', 'readonly');
    const request = transaction.objectStore('presentations').getAll();
    request.onsuccess = () => resolve(request.result.sort((a, b) => b.createdAt.localeCompare(a.createdAt)));
    request.onerror = () => reject(request.error || new Error('Unable to read presentation drafts.'));
    transaction.oncomplete = () => database.close();
    transaction.onerror = () => {
      database.close();
      reject(transaction.error || new Error('Unable to read presentation drafts.'));
    };
  });
}

async function saveLandlordBankDocument(documentRecord) {
  if (isCloudDataActive()) return saveWorkspaceRecord('landlord-bank-documents', documentRecord);
  const database = await openPhotoDatabase();
  return new Promise((resolve, reject) => {
    const transaction = database.transaction('landlord-bank-documents', 'readwrite');
    transaction.objectStore('landlord-bank-documents').add(documentRecord);
    transaction.oncomplete = () => {
      database.close();
      resolve();
    };
    transaction.onerror = () => {
      database.close();
      reject(transaction.error || new Error('Unable to save landlord bank document.'));
    };
    transaction.onabort = () => {
      database.close();
      reject(transaction.error || new Error('Landlord bank document save was interrupted.'));
    };
  });
}

async function getLandlordBankDocuments() {
  if (isCloudDataActive()) {
    return (await readWorkspaceRecords('landlord-bank-documents', false)).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }
  const database = await openPhotoDatabase();
  return new Promise((resolve, reject) => {
    const transaction = database.transaction('landlord-bank-documents', 'readonly');
    const request = transaction.objectStore('landlord-bank-documents').getAll();
    request.onsuccess = () => resolve(request.result.sort((a, b) => b.createdAt.localeCompare(a.createdAt)));
    request.onerror = () => reject(request.error || new Error('Unable to read landlord bank documents.'));
    transaction.oncomplete = () => database.close();
    transaction.onerror = () => {
      database.close();
      reject(transaction.error || new Error('Unable to read landlord bank documents.'));
    };
  });
}

async function deleteLandlordBankDocument(documentId) {
  if (isCloudDataActive()) return deleteWorkspaceRecord('landlord-bank-documents', documentId);
  const database = await openPhotoDatabase();
  return new Promise((resolve, reject) => {
    const transaction = database.transaction('landlord-bank-documents', 'readwrite');
    transaction.objectStore('landlord-bank-documents').delete(documentId);
    transaction.oncomplete = () => {
      database.close();
      resolve();
    };
    transaction.onerror = () => {
      database.close();
      reject(transaction.error || new Error('Unable to remove landlord bank document.'));
    };
    transaction.onabort = () => {
      database.close();
      reject(transaction.error || new Error('Landlord bank document removal was interrupted.'));
    };
  });
}

async function saveImportantDocument(documentRecord) {
  if (isCloudDataActive()) return saveWorkspaceRecord('important-documents', documentRecord);
  const database = await openPhotoDatabase();
  return new Promise((resolve, reject) => {
    const transaction = database.transaction('important-documents', 'readwrite');
    transaction.objectStore('important-documents').add(documentRecord);
    transaction.oncomplete = () => {
      database.close();
      resolve();
    };
    transaction.onerror = () => {
      database.close();
      reject(transaction.error || new Error('Unable to save important document.'));
    };
    transaction.onabort = () => {
      database.close();
      reject(transaction.error || new Error('Important document save was interrupted.'));
    };
  });
}

async function getImportantDocuments() {
  if (isCloudDataActive()) {
    return (await readWorkspaceRecords('important-documents', false)).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }
  const database = await openPhotoDatabase();
  return new Promise((resolve, reject) => {
    const transaction = database.transaction('important-documents', 'readonly');
    const request = transaction.objectStore('important-documents').getAll();
    request.onsuccess = () => resolve(request.result.sort((a, b) => b.createdAt.localeCompare(a.createdAt)));
    request.onerror = () => reject(request.error || new Error('Unable to read important documents.'));
    transaction.oncomplete = () => database.close();
    transaction.onerror = () => {
      database.close();
      reject(transaction.error || new Error('Unable to read important documents.'));
    };
  });
}

async function deleteImportantDocument(documentId) {
  if (isCloudDataActive()) return deleteWorkspaceRecord('important-documents', documentId);
  const database = await openPhotoDatabase();
  return new Promise((resolve, reject) => {
    const transaction = database.transaction('important-documents', 'readwrite');
    transaction.objectStore('important-documents').delete(documentId);
    transaction.oncomplete = () => {
      database.close();
      resolve();
    };
    transaction.onerror = () => {
      database.close();
      reject(transaction.error || new Error('Unable to delete important document.'));
    };
    transaction.onabort = () => {
      database.close();
      reject(transaction.error || new Error('Important document deletion was interrupted.'));
    };
  });
}

async function saveLandlordPayment(payment) {
  if (isCloudDataActive()) return saveWorkspaceRecord('landlord-payments', payment);
  const database = await openPhotoDatabase();
  return new Promise((resolve, reject) => {
    const transaction = database.transaction('landlord-payments', 'readwrite');
    const request = transaction.objectStore('landlord-payments').add(payment);
    let paymentId;
    request.onsuccess = () => {
      paymentId = request.result;
    };
    transaction.oncomplete = () => {
      database.close();
      resolve(paymentId);
    };
    transaction.onerror = () => {
      database.close();
      reject(transaction.error || new Error('Unable to save landlord payment.'));
    };
    transaction.onabort = () => {
      database.close();
      reject(transaction.error || new Error('Landlord payment save was interrupted.'));
    };
  });
}

async function getLandlordPayments() {
  if (isCloudDataActive()) {
    return (await readWorkspaceRecords('landlord-payments')).sort((a, b) => b.paymentDate.localeCompare(a.paymentDate));
  }
  const database = await openPhotoDatabase();
  return new Promise((resolve, reject) => {
    const transaction = database.transaction('landlord-payments', 'readonly');
    const request = transaction.objectStore('landlord-payments').getAll();
    request.onsuccess = () => resolve(request.result.sort((a, b) => b.paymentDate.localeCompare(a.paymentDate)));
    request.onerror = () => reject(request.error || new Error('Unable to read landlord payments.'));
    transaction.oncomplete = () => database.close();
    transaction.onerror = () => {
      database.close();
      reject(transaction.error || new Error('Unable to read landlord payments.'));
    };
  });
}

async function saveOperationsBudget(budget) {
  if (isCloudDataActive()) return saveWorkspaceRecord('operations-budgets', budget);
  const database = await openPhotoDatabase();
  return new Promise((resolve, reject) => {
    const transaction = database.transaction('operations-budgets', 'readwrite');
    const request = transaction.objectStore('operations-budgets').add(budget);
    let budgetId;
    request.onsuccess = () => {
      budgetId = request.result;
    };
    transaction.oncomplete = () => {
      database.close();
      resolve(budgetId);
    };
    transaction.onerror = () => {
      database.close();
      reject(transaction.error || new Error('Unable to save operations budget.'));
    };
    transaction.onabort = () => {
      database.close();
      reject(transaction.error || new Error('Operations budget save was interrupted.'));
    };
  });
}

async function getOperationsBudgets() {
  if (isCloudDataActive()) {
    return (await readWorkspaceRecords('operations-budgets')).sort((a, b) => b.budgetDate.localeCompare(a.budgetDate));
  }
  const database = await openPhotoDatabase();
  return new Promise((resolve, reject) => {
    const transaction = database.transaction('operations-budgets', 'readonly');
    const request = transaction.objectStore('operations-budgets').getAll();
    request.onsuccess = () => resolve(request.result.sort((a, b) => b.budgetDate.localeCompare(a.budgetDate)));
    request.onerror = () => reject(request.error || new Error('Unable to read operations budgets.'));
    transaction.oncomplete = () => database.close();
    transaction.onerror = () => {
      database.close();
      reject(transaction.error || new Error('Unable to read operations budgets.'));
    };
  });
}

async function saveBankMaster(bank) {
  if (isCloudDataActive()) {
    const existing = await getBankMasterRecords();
    if (existing.some((record) => record.ifscCode === bank.ifscCode)) {
      throw new Error('A bank branch with this IFSC code already exists.');
    }
    return saveWorkspaceRecord('bank-master', bank);
  }
  const database = await openPhotoDatabase();
  return new Promise((resolve, reject) => {
    const transaction = database.transaction('bank-master', 'readwrite');
    transaction.objectStore('bank-master').add(bank);
    transaction.oncomplete = () => {
      database.close();
      resolve();
    };
    transaction.onerror = () => {
      database.close();
      if (transaction.error?.name === 'ConstraintError') {
        reject(new Error('A bank branch with this IFSC code already exists.'));
        return;
      }
      reject(transaction.error || new Error('Unable to save bank master record.'));
    };
    transaction.onabort = () => {
      database.close();
      reject(transaction.error || new Error('Bank master record save was interrupted.'));
    };
  });
}

async function getBankMasterRecords() {
  if (isCloudDataActive()) {
    return (await readWorkspaceRecords('bank-master')).sort((a, b) => a.bankName.localeCompare(b.bankName));
  }
  const database = await openPhotoDatabase();
  return new Promise((resolve, reject) => {
    const transaction = database.transaction('bank-master', 'readonly');
    const request = transaction.objectStore('bank-master').getAll();
    request.onsuccess = () => resolve(request.result.sort((a, b) => a.bankName.localeCompare(b.bankName)));
    request.onerror = () => reject(request.error || new Error('Unable to read bank master records.'));
    transaction.oncomplete = () => database.close();
    transaction.onerror = () => {
      database.close();
      reject(transaction.error || new Error('Unable to read bank master records.'));
    };
  });
}

async function deleteBankMasterRecord(bankId) {
  if (isCloudDataActive()) return deleteWorkspaceRecord('bank-master', bankId);
  const database = await openPhotoDatabase();
  return new Promise((resolve, reject) => {
    const transaction = database.transaction('bank-master', 'readwrite');
    transaction.objectStore('bank-master').delete(bankId);
    transaction.oncomplete = () => {
      database.close();
      resolve();
    };
    transaction.onerror = () => {
      database.close();
      reject(transaction.error || new Error('Unable to delete bank master record.'));
    };
    transaction.onabort = () => {
      database.close();
      reject(transaction.error || new Error('Bank master record deletion was interrupted.'));
    };
  });
}

const money = (value) => `₹${(value / 1000).toFixed(0)}k`;
const pageConfig = {
  dashboard: { group: '', eyebrow: 'OVERVIEW', title: 'Good morning, Admin ✦', subtitle: 'Here’s what’s happening across your outdoor media inventory.', action: 'New booking' },
  'inventory-home': { group: 'inventory', eyebrow: 'INVENTORY', title: 'Inventory dashboard', subtitle: 'Hoarding inventory is the base for every booking, job, and financial record.', action: 'Add inventory', inventoryDashboard: true },
  'inventory-total': { group: 'inventory', eyebrow: 'INVENTORY · BANS + BEST', title: 'Total Inventory', subtitle: 'Combined BANS and BEST inventory. Hired inventory is excluded.', action: 'Add inventory', inventoryView: true, categories: ['BANS', 'BEST'] },
  'inventory-sites': { group: 'inventory', eyebrow: 'INVENTORY', title: 'All inventory', subtitle: 'Review each media site, location, booking status, and financial outcome.', action: 'Add inventory', inventoryView: true },
  'inventory-bans': { group: 'inventory', eyebrow: 'INVENTORY · BANS', title: 'BANS inventory', subtitle: 'Review BANS inventory sites, booking status, and financial outcomes.', action: 'Add inventory', inventoryView: true, category: 'BANS' },
  'inventory-best': { group: 'inventory', eyebrow: 'INVENTORY · BEST', title: 'BEST inventory', subtitle: 'Review BEST inventory sites, booking status, and financial outcomes.', action: 'Add inventory', inventoryView: true, category: 'BEST' },
  'inventory-hired': { group: 'inventory', eyebrow: 'INVENTORY · HIRED', title: 'Hired inventory', subtitle: 'Review hired inventory sites, booking status, and financial outcomes.', action: 'Add inventory', inventoryView: true, category: 'Hired Inventory' },
  'inventory-photos': { group: 'inventory', eyebrow: 'INVENTORY · PHOTOS', title: 'Inventory photos', subtitle: 'Photos for this inventory site.', action: 'Upload photos', photoPage: true },
  'inventory-zone': { group: 'inventory', eyebrow: 'INVENTORY · LOCATION', title: 'Zone-wise inventory', subtitle: 'Review inventory and booking percentages grouped by zone.', action: 'Add inventory', groupBy: 'zone' },
  'inventory-town': { group: 'inventory', eyebrow: 'INVENTORY · LOCATION', title: 'Town-wise inventory', subtitle: 'Review each inventory site and booking status by town.', action: 'Add inventory', groupBy: 'town' },
  'inventory-state': { group: 'inventory', eyebrow: 'INVENTORY · LOCATION', title: 'State-wise inventory', subtitle: 'Review inventory coverage and booking status by state.', action: 'Add inventory', groupBy: 'state' },
  'marketing-home': { group: 'marketing', eyebrow: 'MARKETING', title: 'Marketing dashboard', subtitle: 'Prepare proposals and presentations, book available inventory, and raise purchase orders.', action: 'New booking', stats: [['Active bookings', '146'], ['Proposals in progress', '06'], ['Purchase orders', '08']], links: [['Bookings', 'bookings'], ['Make proposal', 'marketing-proposals'], ['PPT presentations', 'marketing-presentations'], ['Issue PO · Hired inventory', 'marketing-po'], ['Issue PO · Flex printing', 'marketing-po']] },
  bookings: { group: 'marketing', eyebrow: 'MARKETING · BOOKINGS', title: 'Inventory bookings', subtitle: 'Create and track customer bookings linked to specific inventory sites.', action: 'New booking', rows: [['BK-0258', 'North Star Retail · OOH-1042', '01 Oct – 30 Oct', 'Confirmed'], ['BK-0257', 'Acme Foods · OOH-0881', '05 Oct – 04 Nov', 'Awaiting PO'], ['BK-0256', 'City Motors · OOH-1206', '12 Oct – 11 Nov', 'Confirmed']] },
  'marketing-proposals': { group: 'marketing', eyebrow: 'MARKETING · PROPOSALS', title: 'Make proposal', subtitle: 'Prepare customer proposals using selected inventory sites and campaign details.', action: 'Create proposal', rows: [['PROP-0142', 'North Star Retail · OOH-1042', '01 Oct – 30 Oct', 'Draft'], ['PROP-0141', 'Acme Foods · OOH-0881', '05 Oct – 04 Nov', 'Sent for review'], ['PROP-0139', 'City Motors · OOH-1206', '12 Oct – 11 Nov', 'Approved']] },
  'marketing-presentations': { group: 'marketing', eyebrow: 'MARKETING · PRESENTATIONS', title: 'PPT presentations', subtitle: 'Build presentation drafts using photos saved under inventory records.', action: 'Create presentation', presentationPage: true },
  'marketing-po': { group: 'marketing', eyebrow: 'MARKETING · PURCHASE ORDERS', title: 'Marketing purchase orders', subtitle: 'Issue POs for hired inventory and flex printing, linked to the booking.', action: 'Create purchase order', rows: [['MPO-0108', 'Hired inventory · OOH-1206', 'BK-0256', 'Draft'], ['MPO-0107', 'Flex printing · OOH-1042', 'BK-0258', 'Pending approval']] },
  'operations-home': { group: 'operations', eyebrow: 'OPERATIONS', title: 'Operations dashboard', subtitle: 'Execute jobs according to Marketing bookings and record completion against inventory.', action: 'Create job', stats: [['Jobs to execute', '18'], ['Flex mounting', '09'], ['Hoarding erection', '06']], links: [['Flex mounting', 'flex-mounting'], ['Hoarding erection', 'hoarding-erection'], ['Landlord Payments', 'landlord-payments'], ['Budget Preparation', 'budget-preparation'], ['Issue Operations PO', 'operations-po']] },
  'flex-mounting': { group: 'operations', eyebrow: 'OPERATIONS · FLEX MOUNTING', title: 'Flex mounting jobs', subtitle: 'Track flex mounting execution for booked inventory sites.', action: 'Add mounting job', rows: [['JOB-0412', 'Lake View Road · OOH-1042', 'Flex mounting', 'Scheduled'], ['JOB-0410', 'MG Road Junction · OOH-0881', 'Flex mounting', 'In progress'], ['JOB-0408', 'Airport Approach · OOH-1206', 'Flex mounting', 'Completed']] },
  'hoarding-erection': { group: 'operations', eyebrow: 'OPERATIONS · HOARDING ERECTION', title: 'Hoarding erection jobs', subtitle: 'Plan and record erection work for booked or hired inventory.', action: 'Add erection job', rows: [['JOB-0396', 'City Centre Square · OOH-1318', 'Erection', 'Scheduled'], ['JOB-0392', 'Riverfront Market · OOH-1011', 'Erection', 'In progress']] },
  'landlord-details': { group: 'operations', eyebrow: 'OPERATIONS · LANDLORDS', title: 'Landlord Details', subtitle: 'Review landlord and lease information linked to inventory sites.', action: 'Add landlord', landlordPage: true },
  'landlord-payments': { group: 'operations', eyebrow: 'OPERATIONS · LANDLORD PAYMENTS', title: 'Landlord Payments', subtitle: 'Record and review rent and other payments made to landlords for inventory sites.', action: 'Record payment', landlordPaymentsPage: true },
  'budget-preparation': { group: 'operations', eyebrow: 'OPERATIONS · BUDGET PREPARATION', title: 'Budget Preparation', subtitle: 'Prepare and track estimated budgets for installation, repair, shifting, maintenance, and other hoarding work.', action: 'Prepare budget', budgetPreparationPage: true },
  'operations-po': { group: 'operations', eyebrow: 'OPERATIONS · PURCHASE ORDERS', title: 'Operations purchase orders', subtitle: 'Raise and track vendor POs for flex mounting, erection, and execution work.', action: 'Create purchase order', rows: [['OPO-0064', 'Flex mounting · OOH-0881', 'JOB-0410', 'Pending approval'], ['OPO-0063', 'Hoarding erection · OOH-1318', 'JOB-0396', 'Draft']] },
  'finance-home': { group: 'finance', eyebrow: 'FINANCE', title: 'Finance dashboard', subtitle: 'Track billing and inventory expenses against bookings and executed work.', action: 'Create invoice', stats: [['To be billed', '₹8.4L'], ['Invoices raised', '₹34.4L'], ['Expenses recorded', '₹28.6L']], links: [['Billing', 'billing'], ['Inventory expenses', 'expenses'], ['Receipts', 'receipts']] },
  billing: { group: 'finance', eyebrow: 'FINANCE · BILLING', title: 'Billing and invoices', subtitle: 'Create and track billing using Marketing booking and Operations execution records.', action: 'Create invoice', rows: [['INV-0258', 'North Star Retail · OOH-1042', '₹1,85,000', 'Submitted'], ['INV-0257', 'Acme Foods · OOH-0881', '₹2,40,000', 'Pending'], ['INV-0256', 'City Motors · OOH-1206', '₹1,68,000', 'Paid']] },
  expenses: { group: 'finance', eyebrow: 'FINANCE · INVENTORY COSTS', title: 'Inventory expenses', subtitle: 'Record taxes, landlord payments, transport, electricity, and other inventory costs.', action: 'Add expense', rows: [['EXP-0802', 'Landlord payment · OOH-1042', '₹42,000', 'Recorded'], ['EXP-0801', 'Transportation · OOH-0881', '₹8,500', 'Pending'], ['EXP-0798', 'Electricity · OOH-1206', '₹6,200', 'Recorded']] },
  receipts: { group: 'finance', eyebrow: 'FINANCE · RECEIPTS', title: 'Receipts', subtitle: 'Track customer payments and outstanding balances by booking and inventory.', action: 'Record receipt', rows: [['RCT-0318', 'North Star Retail · INV-0258', '₹1,00,000', 'Received'], ['RCT-0317', 'City Motors · INV-0256', '₹1,68,000', 'Received']] },
  management: { group: 'management', eyebrow: 'MANAGEMENT MIS', title: 'Management MIS', subtitle: 'Review inventory utilization and profitability by item, zone, and reporting period.', action: 'Export report', stats: [['Inventory profit', '₹14.2L'], ['Booked inventory', '59%'], ['Loss-making sites', '12']], links: [['Profit / loss by inventory', 'inventory-sites'], ['Booking by zone', 'inventory-zone'], ['Monthly finance summary', 'finance-home'], ['Important Documents', 'important-documents']] },
  'important-documents': { group: 'management', eyebrow: 'MANAGEMENT MIS · DOCUMENTS', title: 'Important Documents', subtitle: 'Store and retrieve important business documents linked to inventory.', action: 'Upload document', importantDocumentsPage: true },
  masters: { group: '', eyebrow: 'SETUP', title: 'Master records', subtitle: 'Maintain clients, jobs, workers, vendors, banks, and other business reference data.', action: 'Add master record', links: [['Clients', 'masters'], ['Workers and vendors', 'masters'], ['Jobs and services', 'masters'], ['Banks', 'bank-master']] },
  'bank-master': { group: '', eyebrow: 'SETUP · MASTER RECORDS', title: 'Bank Master', subtitle: 'Maintain bank names, branch details, and IFSC codes for reference.', action: 'Add bank', bankMasterPage: true }
};

const groupNames = { inventory: 'Inventory', marketing: 'Marketing', operations: 'Operations', finance: 'Finance', management: 'Management MIS' };
const inventoryCategories = ['BANS', 'BEST', 'Hired Inventory'];
const operationsBudgetCategories = ['Hoarding Installation', 'Repair', 'Shifting', 'Maintenance', 'Others'];
const operationsBudgetItems = [
  ['Iron materials', 'Angle'],
  ['Iron materials', 'Channel'],
  ['Iron materials', 'Joist'],
  ['Concreting materials', 'Bricks'],
  ['Concreting materials', 'Cement'],
  ['Concreting materials', 'Stone'],
  ['Concreting materials', 'Sand'],
  ['', 'Labour'],
  ['Transportation', 'Iron materials'],
  ['Transportation', 'Concreting materials'],
  ['Transportation', 'Labour'],
  ['', 'Others expense (if any)']
];
const photoCategories = ['Normal Photo', 'Paper Dated', 'Long View GPS', 'Short View GPS'];
let activePhotoInventoryCode = '';
let activePhotoCategory = photoCategories[0];
let photoObjectUrls = [];

function openPhotoDatabase() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open('outdoor-media-inventory', 8);
    request.onupgradeneeded = () => {
      const database = request.result;
      if (!database.objectStoreNames.contains('inventory-photos')) {
        database.createObjectStore('inventory-photos', { keyPath: 'id', autoIncrement: true });
      }
      if (!database.objectStoreNames.contains('presentations')) {
        database.createObjectStore('presentations', { keyPath: 'id', autoIncrement: true });
      }
      if (!database.objectStoreNames.contains('landlord-bank-documents')) {
        database.createObjectStore('landlord-bank-documents', { keyPath: 'id', autoIncrement: true });
      }
      if (!database.objectStoreNames.contains('important-documents')) {
        database.createObjectStore('important-documents', { keyPath: 'id', autoIncrement: true });
      }
      if (!database.objectStoreNames.contains('landlord-payments')) {
        database.createObjectStore('landlord-payments', { keyPath: 'id', autoIncrement: true });
      }
      const bankStore = database.objectStoreNames.contains('bank-master')
        ? request.transaction.objectStore('bank-master')
        : database.createObjectStore('bank-master', { keyPath: 'id', autoIncrement: true });
      if (!bankStore.indexNames.contains('ifscCode')) {
        bankStore.createIndex('ifscCode', 'ifscCode', { unique: true });
      }
      if (!database.objectStoreNames.contains('operations-budgets')) {
        database.createObjectStore('operations-budgets', { keyPath: 'id', autoIncrement: true });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error('Unable to open local photo storage.'));
  });
}

async function getInventoryPhotos(inventoryCode) {
  if (isCloudDataActive()) {
    return (await readWorkspaceRecords('inventory-photos', true))
      .filter((photo) => photo.inventoryCode === inventoryCode)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }
  const database = await openPhotoDatabase();
  return new Promise((resolve, reject) => {
    const transaction = database.transaction('inventory-photos', 'readonly');
    const request = transaction.objectStore('inventory-photos').getAll();
    request.onsuccess = () => resolve(request.result
      .filter((photo) => photo.inventoryCode === inventoryCode)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt)));
    request.onerror = () => reject(request.error || new Error('Unable to read inventory photos.'));
    transaction.oncomplete = () => database.close();
    transaction.onerror = () => {
      database.close();
      reject(transaction.error || new Error('Unable to read inventory photos.'));
    };
  });
}

async function saveInventoryPhoto(photo) {
  if (isCloudDataActive()) return saveWorkspaceRecord('inventory-photos', photo);
  const database = await openPhotoDatabase();
  return new Promise((resolve, reject) => {
    const transaction = database.transaction('inventory-photos', 'readwrite');
    transaction.objectStore('inventory-photos').add(photo);
    transaction.oncomplete = () => {
      database.close();
      resolve();
    };
    transaction.onerror = () => {
      database.close();
      reject(transaction.error || new Error('Unable to save photo.'));
    };
    transaction.onabort = () => {
      database.close();
      reject(transaction.error || new Error('Photo save was interrupted.'));
    };
  });
}

async function deleteInventoryPhoto(photoId) {
  if (isCloudDataActive()) return deleteWorkspaceRecord('inventory-photos', photoId);
  const database = await openPhotoDatabase();
  return new Promise((resolve, reject) => {
    const transaction = database.transaction('inventory-photos', 'readwrite');
    transaction.objectStore('inventory-photos').delete(photoId);
    transaction.oncomplete = () => {
      database.close();
      resolve();
    };
    transaction.onerror = () => {
      database.close();
      reject(transaction.error || new Error('Unable to delete photo.'));
    };
    transaction.onabort = () => {
      database.close();
      reject(transaction.error || new Error('Photo deletion was interrupted.'));
    };
  });
}

function groupInventory(field) {
  const grouped = new Map();
  inventory.forEach((item) => {
    const key = item[field] || 'Unassigned';
    const group = grouped.get(key) || { name: key, items: [], bookingTotal: 0 };
    group.items.push(item);
    group.bookingTotal += item.booking;
    grouped.set(key, group);
  });
  return [...grouped.values()]
    .map((group) => ({ ...group, count: group.items.length, averageBooking: Math.round(group.bookingTotal / group.items.length) }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

function inventoryTotal(field, value) {
  return inventory.filter((item) => item[field] === value).length;
}

function matchesInventoryView(item, config) {
  if (config.category) return item.category === config.category;
  return !config.categories || config.categories.includes(item.category);
}

function totalOwnedInventory() {
  return inventoryTotal('category', 'BANS') + inventoryTotal('category', 'BEST');
}

function renderOverviewTotals() {
  const total = inventory.length;
  const averageBooking = total
    ? Math.round(inventory.reduce((sum, item) => sum + item.booking, 0) / total)
    : 0;
  const revenue = inventory.reduce((sum, item) => sum + item.revenue, 0);
  const expenses = inventory.reduce((sum, item) => sum + item.expenses, 0);
  const profit = inventory.reduce((sum, item) => sum + item.profit, 0);
  document.getElementById('overview-total-inventory').textContent = total;
  document.getElementById('overview-zone-count').textContent = `Across ${groupInventory('zone').length} zones`;
  document.getElementById('overview-average-booking').textContent = averageBooking;
  document.getElementById('overview-booking-progress').style.width = `${averageBooking}%`;
  document.getElementById('overview-revenue').textContent = (revenue / 100000).toFixed(2);
  document.getElementById('overview-profit').textContent = (profit / 100000).toFixed(2);
  document.getElementById('chart-revenue').textContent = `₹${(revenue / 100000).toFixed(2)}L`;
  document.getElementById('chart-expenses').textContent = `₹${(expenses / 100000).toFixed(2)}L`;
  document.getElementById('chart-profit').innerHTML = `₹${(profit / 100000).toFixed(2)}L`;
}

function renderInventory(rows = inventory.slice(0, 5)) {
  const body = document.getElementById('inventory-rows');
  if (!body) return;
  if (!rows.length) {
    body.innerHTML = '<tr><td class="empty-state" colspan="7">No inventory sites match your search.</td></tr>';
    return;
  }
  body.innerHTML = rows.map((item, index) => `
    <tr>
      <td><div class="inventory-name"><span class="site-thumb ${index ? `thumb-${['two','three','four','five'][(index - 1) % 4]}` : ''}">▥</span><span><strong>${item.name}</strong><small>${item.code} · ${item.type}</small></span></div></td>
      <td>${item.zone}</td>
      <td><div class="booking-cell"><span class="booking-mini"><i style="width:${item.booking}%"></i></span>${item.booking}%</div></td>
      <td>${money(item.revenue)}</td>
      <td>${money(item.expenses)}</td>
      <td class="${item.profit >= 0 ? 'table-profit' : 'table-loss'}">${item.profit >= 0 ? '+' : '−'}${money(Math.abs(item.profit))}</td>
      <td><button class="photo-action" data-photo-inventory="${item.code}">Photos</button></td>
    </tr>`).join('');
}

function renderZones() {
  const chart = document.getElementById('zone-chart');
  chart.innerHTML = groupInventory('zone').map((zone) => `
    <div class="zone-row">
      <span class="zone-name">${zone.name}</span>
      <span class="zone-track"><span style="width:${zone.averageBooking}%"></span></span>
      <span class="zone-value">${zone.averageBooking}% <small>· ${zone.count}</small></span>
    </div>`).join('');
}

function updateInventoryCounts() {
  document.querySelectorAll('[data-inventory-count]').forEach((badge) => {
    badge.textContent = inventory.length;
  });
  document.querySelectorAll('[data-category-count]').forEach((badge) => {
    const category = badge.dataset.categoryCount;
    badge.textContent = inventoryTotal('category', category);
  });
  document.querySelectorAll('[data-total-inventory-count]').forEach((badge) => {
    badge.textContent = totalOwnedInventory();
  });
}

function inventoryDashboardStats() {
  const categories = [
    { label: 'Total inventory', count: inventory.length, destination: 'inventory-sites' },
    { label: 'BANS', count: inventoryTotal('category', 'BANS'), destination: 'inventory-bans' },
    { label: 'BEST', count: inventoryTotal('category', 'BEST'), destination: 'inventory-best' },
    { label: 'Hired Inventory', count: inventoryTotal('category', 'Hired Inventory'), destination: 'inventory-hired' }
  ];
  return `<section class="module-stats inventory-count-stats" aria-label="Inventory totals">${categories.map((category) => `
    <button class="metric-card inventory-count-card" data-page="${category.destination}">
      <span class="metric-label">${category.label}</span>
      <span class="metric-value">${category.count}<span class="metric-unit"> sites</span></span>
      <span class="metric-note">Count of inventory records</span>
    </button>`).join('')}</section>`;
}

function inventoryBreakdowns() {
  const groupSpecs = [
    { title: 'Inventory category', field: 'category', rows: inventoryCategories.map((name) => ({ name, count: inventoryTotal('category', name) })), links: { BANS: 'inventory-bans', BEST: 'inventory-best', 'Hired Inventory': 'inventory-hired' } },
    { title: 'By zone', field: 'zone', rows: groupInventory('zone'), destination: 'inventory-zone' },
    { title: 'By town', field: 'town', rows: groupInventory('town'), destination: 'inventory-town' },
    { title: 'By state', field: 'state', rows: groupInventory('state'), destination: 'inventory-state' }
  ];
  return `<section class="inventory-breakdowns" aria-label="Inventory counts by category and location">${groupSpecs.map((group) => `
    <article class="panel breakdown-panel">
      <div class="panel-heading">
        <div><h2>${group.title}</h2><p>${group.rows.length} ${group.title === 'Inventory category' ? 'categories' : group.field + 's'} · ${inventory.length} total sites</p></div>
        ${group.destination ? `<button class="text-button" data-page="${group.destination}">View all <span>→</span></button>` : ''}
      </div>
      <div class="breakdown-list">${group.rows.map((row) => {
        const destination = group.links?.[row.name] || group.destination;
        const contents = `<span class="breakdown-name">${row.name}</span><strong class="breakdown-count">${row.count}</strong>`;
        return destination
          ? `<button class="breakdown-row" data-page="${destination}">${contents}<span class="breakdown-arrow">→</span></button>`
          : `<div class="breakdown-row">${contents}</div>`;
      }).join('')}</div>
      <div class="breakdown-total"><span>Total inventory</span><strong>${inventory.length}</strong></div>
    </article>`).join('')}</section>`;
}

function filterInventory() {
  const query = document.getElementById('inventory-search').value.trim().toLowerCase();
  const zone = document.getElementById('zone-filter').value;
  const matching = inventory.filter((item) => (!query || `${item.code} ${item.name} ${item.zone} ${item.type}`.toLowerCase().includes(query))
    && (zone === 'All' || item.zone === zone));
  renderInventory(matching);
  document.getElementById('table-count').textContent = query || zone !== 'All'
    ? `Showing ${matching.length} matching inventory sites`
    : `Showing ${Math.min(5, inventory.length)} of ${inventory.length} inventory sites`;
}

function showToast(message) {
  const toast = document.getElementById('toast');
  toast.textContent = message;
  toast.classList.add('show');
  window.clearTimeout(showToast.timeout);
  showToast.timeout = window.setTimeout(() => toast.classList.remove('show'), 2600);
}

function renderModulePage(page) {
  const config = pageConfig[page];
  const view = document.getElementById('module-view');
  if (!config) {
    view.innerHTML = '';
    return;
  }
  const stats = config.inventoryDashboard
    ? inventoryDashboardStats()
    : config.stats
    ? `<section class="module-stats">${config.stats.map(([label, value]) => `<article class="metric-card"><span class="metric-label">${label}</span><div class="metric-value">${value}</div><span class="metric-note">Sample period summary</span></article>`).join('')}</section>`
    : '';
  const links = config.inventoryDashboard
    ? inventoryBreakdowns()
    : config.links
    ? `<section class="panel module-shortcuts"><div class="panel-heading"><div><h2>Quick access</h2><p>Open a related ${groupNames[config.group]?.toLowerCase() || 'system'} workspace</p></div></div><div class="shortcut-grid">${config.links.map(([label, target, category]) => {
      const count = category ? inventory.filter((item) => item.category === category).length : null;
      return `<button class="shortcut-card" data-page="${target}"><span class="shortcut-icon">↗</span><strong>${label}</strong><small>${count === null ? 'Open workspace' : `${count} ${inventoryDataLabel()} inventory sites`}</small></button>`;
    }).join('')}</div></section>`
    : '';
  let table = '';
  if (config.bankMasterPage) {
    table = `<section class="panel landlord-payment-form-panel">
      <div class="panel-heading"><div><h2>Add bank</h2><p>Save a bank name with its branch and IFSC code for master data.</p></div></div>
      <form class="important-document-form bank-master-form" id="bank-master-form">
        <label><span>Bank name</span><input id="bank-master-name" type="text" maxlength="120" placeholder="Enter bank name" required></label>
        <label><span>Branch</span><input id="bank-master-branch" type="text" maxlength="120" placeholder="Enter branch name" required></label>
        <label><span>IFSC code</span><input id="bank-master-ifsc" type="text" maxlength="11" pattern="[A-Za-z]{4}0[A-Za-z0-9]{6}" title="Enter a valid 11-character IFSC code" placeholder="e.g. ABCD0123456" required></label>
        <button class="button button-primary" type="submit">Save bank</button>
      </form>
      <p class="important-document-storage-note">Bank master records are stored in this browser on this device.</p>
    </section>
    <section class="panel module-table-panel landlord-payment-list-panel">
      <div class="panel-heading"><div><h2>Bank register</h2><p>Bank master records available for reference</p></div></div>
      <div id="bank-master-list"><div class="photo-loading">Loading banks…</div></div>
    </section>`;
  } else if (config.budgetPreparationPage) {
    const inventoryOptions = inventory.map((item) => `<option value="${item.code}">${escapeHtml(item.code)} · ${escapeHtml(item.name)}</option>`).join('');
    const budgetItems = operationsBudgetItems.map(([group, label], index) => {
      const itemName = group ? `${group} — ${label}` : label;
      return `<tr data-budget-line-row>
        <td>${index + 1}</td>
        <td><input class="budget-line-name" type="text" maxlength="100" value="${escapeHtml(itemName)}" aria-label="Budget line ${index + 1} description"></td>
        <td><div class="budget-line-quantity"><input class="budget-line-quantity-value" type="number" min="0" step="0.01" value="0" aria-label="Budget line ${index + 1} quantity"><input class="budget-line-unit" type="text" maxlength="24" placeholder="Unit" aria-label="Budget line ${index + 1} unit"></div></td>
        <td><input class="budget-line-rate" type="number" min="0" step="0.01" value="0" aria-label="Budget line ${index + 1} amount per unit"></td>
        <td><output class="budget-line-amount">₹0.00</output></td>
        <td><input class="budget-line-remarks" type="text" maxlength="100" aria-label="Budget line ${index + 1} remarks"></td>
      </tr>`;
    }).join('');
    table = `<section class="panel budget-preparation-panel">
      <div class="budget-category-tabs" role="tablist" aria-label="Budget activity">
        ${operationsBudgetCategories.map((category, index) => `<button class="budget-category-tab ${index === 0 ? 'active' : ''}" type="button" role="tab" aria-selected="${index === 0}" data-budget-category="${escapeHtml(category)}">${escapeHtml(category)}</button>`).join('')}
      </div>
      <div class="panel-heading"><div><h2 id="budget-form-heading">Prepare ${operationsBudgetCategories[0]} budget</h2><p>Complete a budget / expenses details sheet for this hoarding job.</p></div></div>
      <form class="important-document-form budget-preparation-form" id="operations-budget-form">
        <input id="operations-budget-category" type="hidden" value="${operationsBudgetCategories[0]}">
        <label><span>Inventory site</span><select id="operations-budget-inventory" required><option value="">Select inventory site</option>${inventoryOptions}</select></label>
        <label><span>Location</span><input id="operations-budget-location" type="text" maxlength="180" placeholder="Select an inventory site first" required></label>
        <label><span>Size</span><input id="operations-budget-size" type="text" maxlength="100" placeholder="Hoarding size / dimensions" required></label>
        <label><span>Job details</span><input id="operations-budget-description" type="text" maxlength="180" placeholder="Describe the planned work" required></label>
        <label><span>Duration</span><input id="operations-budget-duration" type="text" maxlength="80" placeholder="e.g. 7 days / 1 month" required></label>
        <label><span>Budget date</span><input id="operations-budget-date" type="date" max="${localDateInputValue()}" value="${localDateInputValue()}" required></label>
        <label><span>Vendor / contractor <small>(optional)</small></span><input id="operations-budget-vendor" type="text" maxlength="120" placeholder="Vendor or contractor"></label>
        <div class="budget-expense-table-wrap" role="region" aria-label="Itemized budget expenses" tabindex="0">
          <table class="budget-expense-table">
            <thead><tr><th>SL NO</th><th>PARTICULARS / NATURE / SIZE</th><th>QTY / UNIT</th><th>AMOUNT / UNIT (INR)</th><th>AMOUNT (INR)</th><th>REMARKS</th></tr></thead>
            <tbody>${budgetItems}</tbody>
            <tfoot>
              <tr><th colspan="4">TOTAL</th><th><output id="operations-budget-total">₹0.00</output></th><td></td></tr>
              <tr><th colspan="4">ADVANCE TAKEN AGAINST THIS JOB (INR)</th><td colspan="2"><input id="operations-budget-advance" type="number" min="0" step="0.01" value="0" aria-label="Advance taken against this job"></td></tr>
            </tfoot>
          </table>
        </div>
        <label class="budget-preparation-notes"><span>Additional notes <small>(optional)</small></span><input id="operations-budget-notes" type="text" maxlength="250" placeholder="Additional budget notes"></label>
        <label><span>Prepared by</span><input id="operations-budget-prepared-by" type="text" maxlength="100" value="Super Admin" required></label>
        <button class="button button-primary" type="submit">Save budget</button>
      </form>
      <p class="important-document-storage-note">Budgets are estimates and are stored in this browser on this device. A saved budget can be exported as a PDF sheet.</p>
    </section>
    <section class="panel module-table-panel budget-register-panel">
      <div class="panel-heading"><div><h2 id="budget-register-heading">${operationsBudgetCategories[0]} budgets</h2><p>Saved budget estimates for the selected activity</p></div></div>
      <div id="operations-budget-list"><div class="photo-loading">Loading budgets…</div></div>
    </section>`;
  } else if (config.landlordPaymentsPage) {
    const inventoryOptions = inventory.map((item) => `<option value="${item.code}">${escapeHtml(item.code)} · ${escapeHtml(item.name)}</option>`).join('');
    table = `<section class="panel landlord-payment-form-panel">
      <div class="panel-heading"><div><h2>Record landlord payment</h2><p>Enter a payment made for an inventory site's landlord.</p></div></div>
      <form class="important-document-form landlord-payment-form" id="landlord-payment-form">
        <label><span>Inventory site</span><select id="landlord-payment-inventory" required><option value="">Select inventory site</option>${inventoryOptions}</select></label>
        <label><span>Landlord name</span><input id="landlord-payment-name" type="text" maxlength="120" placeholder="Enter landlord name" required></label>
        <label><span>Contact <small>(optional)</small></span><input id="landlord-payment-contact" type="text" maxlength="40" placeholder="Landlord contact number"></label>
        <label><span>Address <small>(optional)</small></span><input id="landlord-payment-address" type="text" maxlength="180" placeholder="Landlord address"></label>
        <label><span>GST No. <small>(optional)</small></span><input id="landlord-payment-gst" type="text" maxlength="20" placeholder="Landlord GST number"></label>
        <label><span>Amount (INR)</span><input id="landlord-payment-amount" type="number" min="0.01" step="0.01" placeholder="0.00" required></label>
        <label><span>Payment date</span><input id="landlord-payment-date" type="date" max="${localDateInputValue()}" value="${localDateInputValue()}" required></label>
        <label><span>Payment method</span><select id="landlord-payment-method" required><option value="">Select method</option><option>Bank transfer</option><option>UPI</option><option>Cheque</option><option>Cash</option><option>Other</option></select></label>
        <label><span>Transaction / reference number <small>(optional)</small></span><input id="landlord-payment-reference" type="text" maxlength="100" placeholder="Enter transaction reference"></label>
        <label><span>Bank name <small>(optional)</small></span><input id="landlord-payment-bank" type="text" maxlength="120" placeholder="Bank used for payment"></label>
        <label><span>Account number <small>(optional)</small></span><input id="landlord-payment-account" type="text" maxlength="40" placeholder="Payment account number"></label>
        <fieldset class="landlord-payment-nature">
          <legend>Nature of payment</legend>
          <label><input type="checkbox" name="landlord-payment-nature" value="Hoarding Rental"> Hoarding Rental</label>
          <label><input type="checkbox" name="landlord-payment-nature" value="Hoarding Electricity"> Hoarding Electricity</label>
          <label><input type="checkbox" name="landlord-payment-nature" value="Others"> Others</label>
        </fieldset>
        <label class="landlord-payment-notes"><span>Notes <small>(optional)</small></span><input id="landlord-payment-notes" type="text" maxlength="250" placeholder="Payment purpose or notes"></label>
        <label><span>Recorded by</span><input id="landlord-payment-recorded-by" type="text" maxlength="100" value="Super Admin" required></label>
        <button class="button button-primary" type="submit">Save payment</button>
      </form>
      <p class="important-document-storage-note">Payment records are stored in this browser on this device. A receipt records the entry and is not a bank transaction confirmation.</p>
    </section>
    <section class="panel module-table-panel landlord-payment-list-panel">
      <div class="panel-heading"><div><h2>Landlord payment history</h2><p>Payments recorded against inventory sites</p></div></div>
      <div id="landlord-payment-list"><div class="photo-loading">Loading payments…</div></div>
    </section>`;
  } else if (config.importantDocumentsPage) {
    const inventoryOptions = inventory.map((item) => `<option value="${item.code}">${escapeHtml(item.code)} · ${escapeHtml(item.name)}</option>`).join('');
    table = `<section class="panel important-document-upload-panel">
      <div class="panel-heading"><div><h2>Upload important document</h2><p>Add company, document type, expiry date, and upload a file from this computer.</p></div></div>
      <form class="important-document-form" id="important-document-form">
        <label><span>Document title</span><input id="important-document-title" name="title" type="text" maxlength="120" placeholder="Enter a document title" required></label>
        <label><span>Company</span><input id="important-document-company" name="company" type="text" maxlength="120" placeholder="Enter company name" required></label>
        <label><span>Document Type</span><select id="important-document-category" name="category" required>
          <option value="">Select document type</option><option>Agreement</option><option>Landlord bank details</option><option>Inventory document</option><option>Finance document</option><option>Tax / Government</option><option>Other</option>
        </select></label>
        <label><span>Expiry <small>(optional)</small></span><input id="important-document-expiry" name="expiryDate" type="date"></label>
        <label><span>Related inventory <small>(optional)</small></span><select id="important-document-inventory" name="inventoryCode"><option value="">No inventory link</option>${inventoryOptions}</select></label>
        <input id="important-document-file" name="file" type="file" accept=".pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.jpg,.jpeg,.png,.gif" required>
        <button class="button button-primary" type="submit">Upload document</button>
      </form>
      <p class="important-document-storage-note">Documents are saved in this browser on this device and are not shared with other users.</p>
    </section>
    <section class="panel module-table-panel important-document-list-panel">
      <div class="panel-heading"><div><h2>Important document register</h2><p>Uploaded documents for Management MIS</p></div></div>
      <div id="important-document-list"><div class="photo-loading">Loading documents…</div></div>
    </section>`;
  } else if (config.landlordPage) {
    const landlordRows = inventory.map((item) => `<tr>
      <td><strong>${item.name}</strong><br><small>${item.code}</small></td>
      <td>${item.zone}</td><td>${item.town}, ${item.state}</td>
      <td>Not provided</td><td>Not provided</td><td>Not provided</td>
      <td>Not provided</td><td>Not provided</td><td>Not provided</td>
      <td>Not provided</td><td>Not provided</td><td>Not provided</td>
      <td>Not provided</td><td>Not provided</td><td>Not provided</td>
      <td>Not provided</td><td>Not provided</td>
      <td><div class="landlord-document-cell">
        <input type="file" accept="application/pdf,image/*" hidden data-landlord-doc-upload="${item.code}">
        <button class="photo-action" type="button" data-landlord-doc-open="${item.code}">＋ Upload bank details</button>
        <div class="landlord-document-list" data-landlord-documents="${item.code}"><span class="landlord-doc-empty">No files uploaded</span></div>
      </div></td>
    </tr>`).join('');
    table = `<section class="panel module-table-panel"><div class="panel-heading"><div><h2>Landlord register</h2><p>Landlord, agreement, payment, and bank details linked to inventory sites · sample records</p></div></div><div class="table-wrap landlord-table-wrap" role="region" aria-label="Landlord details table" tabindex="0"><table class="landlord-table"><thead><tr><th>HOARDING INVENTORY</th><th>ZONE</th><th>LOCATION</th><th>LANDLORD NAME</th><th>CONTACT NUMBER 1</th><th>CONTACT NUMBER 2</th><th>AGREEMENT PERIOD / STATUS</th><th>AGREEMENT AMOUNT (INR)</th><th>HOARDING RENT PAID UP TO</th><th>PER MONTH AMOUNT (INR)</th><th>BALANCE DUE AS ON DATE (INR)</th><th>BANK NAME</th><th>ACCOUNT HOLDER NAME</th><th>ACCOUNT NUMBER</th><th>IFSC CODE</th><th>BRANCH</th><th>OTHER BANK DETAILS</th><th>BANK DETAILS DOCUMENTS</th></tr></thead><tbody>${landlordRows}</tbody></table></div><div class="table-footer"><span>Use the horizontal scrollbar to view all details. Upload a PDF or image for each inventory site's bank details. Files are stored in this browser.</span></div></section>`;
  } else if (config.presentationPage) {
    table = '<div id="presentation-content"></div>';
  } else if (config.photoPage) {
    table = '<div id="inventory-photo-content"></div>';
  } else if (config.inventoryDashboard) {
    table = `<section class="panel module-table-panel"><div class="panel-heading"><div><h2>All inventory sites</h2><p>Showing ${inventory.length} of ${inventory.length} inventory records</p></div><div class="panel-heading-actions"><button class="button button-secondary" type="button" data-export-inventory>Export Excel</button><button class="text-button" data-page="inventory-sites">View register <span>→</span></button></div></div>${inventoryTable(inventory)}</section>`;
  } else
  if (config.inventoryView) {
    const records = inventory.filter((item) => matchesInventoryView(item, config));
    const inventoryLabel = config.title === 'Total Inventory' ? 'BANS + BEST' : config.category || '';
    table = `<section class="panel module-table-panel"><div class="panel-heading"><div><h2>Inventory register</h2><p>${records.length} ${inventoryDataLabel()} ${inventoryLabel} sites · booking and financial outcome by site</p></div><div class="panel-heading-actions"><button class="button button-secondary" type="button" data-export-inventory>Export Excel</button><label class="search-box module-search"><span>⌕</span><input id="module-inventory-search" type="search" placeholder="Search inventory" aria-label="Search inventory"></label></div></div>${inventoryTable(records)}</section>`;
    view.dataset.category = config.category || '';
    view.dataset.categories = (config.categories || []).join(',');
  } else if (config.groupBy) {
    const groups = groupInventory(config.groupBy);
    table = `<section class="panel module-table-panel"><div class="panel-heading"><div><h2>${config.title.replace(' inventory', '')} summary</h2><p>Inventory count and average booking percentage by ${config.groupBy}</p></div><button class="button button-secondary" type="button" data-export-inventory>Export Excel</button></div><div class="table-wrap"><table><thead><tr><th>${config.groupBy.toUpperCase()}</th><th>INVENTORY SITES</th><th>AVERAGE BOOKING</th><th>SITES</th></tr></thead><tbody>${groups.map((group) => `<tr><td><strong class="group-title">${group.name}</strong></td><td>${group.count}</td><td><div class="booking-cell"><span class="booking-mini"><i style="width:${group.averageBooking}%"></i></span>${group.averageBooking}%</div></td><td>${group.items.map((item) => item.code).join(', ')}</td></tr>`).join('')}<tr class="table-total-row"><td><strong>Total</strong></td><td><strong>${inventory.length}</strong></td><td>—</td><td>${inventory.length} inventory sites</td></tr></tbody></table></div></section>${inventoryTablePanel(inventory, config.groupBy)}`;
  } else if (config.rows) {
    table = `<section class="panel module-table-panel"><div class="panel-heading"><div><h2>${config.title}</h2><p>Workflow records linked to their inventory sites</p></div></div><div class="table-wrap"><table><thead><tr><th>REFERENCE</th><th>INVENTORY / DETAILS</th><th>DATE / LINK</th><th>STATUS</th></tr></thead><tbody>${config.rows.map((row) => `<tr>${row.map((cell, index) => `<td>${index === row.length - 1 ? `<span class="activity-status ${statusClass(cell)}">${cell}</span>` : cell}</td>`).join('')}</tr>`).join('')}</tbody></table></div><div class="table-footer"><span>Sample records · linked to hoarding inventory</span></div></section>`;
  }
  view.innerHTML = `${stats}${links}${table}<footer class="page-footer"><span>Outdoor Media Management System</span><span>${isCloudDataActive() ? 'Shared workspace data' : 'Sample data'} · inventory-first workflow</span></footer>`;
  view.onclick = (event) => {
    const exportButton = event.target.closest('[data-export-inventory]');
    if (exportButton) exportInventoryExcel();
  };
  view.querySelectorAll('[data-page]').forEach((button) => button.addEventListener('click', () => setPage(button.dataset.page)));
  if (config.budgetPreparationPage) {
    const form = document.getElementById('operations-budget-form');
    const inventorySelect = document.getElementById('operations-budget-inventory');
    inventorySelect.addEventListener('change', () => {
      const selectedInventory = inventory.find((item) => item.code === inventorySelect.value);
      document.getElementById('operations-budget-location').value = selectedInventory
        ? `${selectedInventory.name}, ${selectedInventory.town}, ${selectedInventory.state}`
        : '';
      document.getElementById('operations-budget-size').value = selectedInventory?.type || '';
    });
    form.querySelectorAll('.budget-line-quantity-value, .budget-line-rate').forEach((input) => {
      input.addEventListener('input', updateOperationsBudgetTotals);
    });
    view.querySelectorAll('[data-budget-category]').forEach((button) => button.addEventListener('click', async () => {
      view.querySelectorAll('[data-budget-category]').forEach((tab) => {
        const selected = tab === button;
        tab.classList.toggle('active', selected);
        tab.setAttribute('aria-selected', String(selected));
      });
      document.getElementById('operations-budget-category').value = button.dataset.budgetCategory;
      document.getElementById('budget-form-heading').textContent = `Prepare ${button.dataset.budgetCategory} budget`;
      document.getElementById('budget-register-heading').textContent = `${button.dataset.budgetCategory} budgets`;
      await renderOperationsBudgetList();
    }));
    form.addEventListener('submit', async (event) => {
      event.preventDefault();
      const inventoryCode = document.getElementById('operations-budget-inventory').value;
      const description = document.getElementById('operations-budget-description').value.trim();
      const location = document.getElementById('operations-budget-location').value.trim();
      const size = document.getElementById('operations-budget-size').value.trim();
      const duration = document.getElementById('operations-budget-duration').value.trim();
      const lineItems = [...form.querySelectorAll('[data-budget-line-row]')].map((row, index) => {
        const quantity = Number(row.querySelector('.budget-line-quantity-value').value);
        const rate = Number(row.querySelector('.budget-line-rate').value);
        return {
          serialNumber: index + 1,
          description: row.querySelector('.budget-line-name').value.trim(),
          quantity,
          unit: row.querySelector('.budget-line-unit').value.trim(),
          rate,
          amount: quantity * rate,
          remarks: row.querySelector('.budget-line-remarks').value.trim()
        };
      });
      const amount = lineItems.reduce((sum, line) => sum + line.amount, 0);
      const advance = Number(document.getElementById('operations-budget-advance').value);
      const budgetDate = document.getElementById('operations-budget-date').value;
      if (!inventoryCode || !location || !size || !description || !duration || !budgetDate || !lineItems.some((line) => line.quantity > 0 && line.rate > 0) || !Number.isFinite(advance) || advance < 0 || advance > amount) {
        showToast('Enter job details and at least one expense line. Advance must not exceed the budget total.');
        return;
      }
      if (budgetDate > localDateInputValue()) {
        showToast('Budget date cannot be in the future.');
        return;
      }
      try {
        const selectedInventory = inventory.find((item) => item.code === inventoryCode);
        const budget = {
          category: document.getElementById('operations-budget-category').value,
          inventoryCode,
          inventoryName: selectedInventory?.name || '',
          location,
          size,
          description,
          duration,
          lineItems: lineItems.filter((line) => line.quantity > 0 || line.rate > 0 || line.remarks),
          amount,
          advance,
          budgetDate,
          vendor: document.getElementById('operations-budget-vendor').value.trim(),
          notes: document.getElementById('operations-budget-notes').value.trim(),
          preparedBy: document.getElementById('operations-budget-prepared-by').value.trim(),
          createdAt: new Date().toISOString()
        };
        budget.id = await saveOperationsBudget(budget);
        form.reset();
        document.getElementById('operations-budget-category').value = view.querySelector('[data-budget-category].active').dataset.budgetCategory;
        document.getElementById('operations-budget-date').value = localDateInputValue();
        document.getElementById('operations-budget-advance').value = '0';
        document.getElementById('operations-budget-prepared-by').value = 'Super Admin';
        updateOperationsBudgetTotals();
        showToast('Operations budget saved.');
        await renderOperationsBudgetList();
      } catch (error) {
        console.error('Unable to save operations budget.', error);
        showToast(`Budget could not be saved: ${error.message || 'browser storage unavailable'}`);
      }
    });
    renderOperationsBudgetList();
    return;
  }
  if (config.bankMasterPage) {
    const form = document.getElementById('bank-master-form');
    form.addEventListener('submit', async (event) => {
      event.preventDefault();
      const bankName = document.getElementById('bank-master-name').value.trim();
      const branch = document.getElementById('bank-master-branch').value.trim();
      const ifscCode = document.getElementById('bank-master-ifsc').value.trim().toUpperCase();
      if (!bankName || !branch || !/^[A-Z]{4}0[A-Z0-9]{6}$/.test(ifscCode)) {
        showToast('Enter a bank name, branch, and valid 11-character IFSC code.');
        return;
      }
      try {
        const existingBanks = await getBankMasterRecords();
        if (existingBanks.some((bank) => bank.ifscCode === ifscCode)) {
          showToast('A bank branch with this IFSC code already exists.');
          return;
        }
        await saveBankMaster({ bankName, branch, ifscCode, createdAt: new Date().toISOString() });
        form.reset();
        showToast('Bank master record saved.');
        await renderBankMasterList();
      } catch (error) {
        console.error('Unable to save bank master record.', error);
        showToast(`Bank could not be saved: ${error.message || 'browser storage unavailable'}`);
      }
    });
    renderBankMasterList();
    return;
  }
  if (config.landlordPaymentsPage) {
    const form = document.getElementById('landlord-payment-form');
    form.addEventListener('submit', async (event) => {
      event.preventDefault();
      const inventoryCode = document.getElementById('landlord-payment-inventory').value;
      const landlordName = document.getElementById('landlord-payment-name').value.trim();
      const amount = Number(document.getElementById('landlord-payment-amount').value);
      const paymentDate = document.getElementById('landlord-payment-date').value;
      const paymentMethod = document.getElementById('landlord-payment-method').value;
      const natureOfPayment = [...document.querySelectorAll('[name="landlord-payment-nature"]:checked')]
        .map((input) => input.value);
      if (!inventoryCode || !landlordName || !Number.isFinite(amount) || amount <= 0 || !paymentDate || !paymentMethod || !natureOfPayment.length) {
        showToast('Enter the inventory, landlord, valid amount, date, method, and nature of payment.');
        return;
      }
      if (paymentDate > localDateInputValue()) {
        showToast('Payment date cannot be in the future.');
        return;
      }
      try {
        const selectedInventory = inventory.find((item) => item.code === inventoryCode);
        const payment = {
          inventoryCode,
          inventoryName: selectedInventory?.name || '',
          landlordName,
          landlordContact: document.getElementById('landlord-payment-contact').value.trim(),
          landlordAddress: document.getElementById('landlord-payment-address').value.trim(),
          landlordGst: document.getElementById('landlord-payment-gst').value.trim(),
          hoardingDetails: selectedInventory?.type || '',
          amount,
          paymentDate,
          paymentMethod,
          reference: document.getElementById('landlord-payment-reference').value.trim(),
          bankName: document.getElementById('landlord-payment-bank').value.trim(),
          accountNumber: document.getElementById('landlord-payment-account').value.trim(),
          natureOfPayment,
          notes: document.getElementById('landlord-payment-notes').value.trim(),
          recordedBy: document.getElementById('landlord-payment-recorded-by').value.trim(),
          status: 'Recorded',
          createdAt: new Date().toISOString()
        };
        payment.id = await saveLandlordPayment(payment);
        form.reset();
        document.getElementById('landlord-payment-date').value = localDateInputValue();
        showToast('Landlord payment recorded.');
        await renderLandlordPaymentList();
        downloadLandlordPaymentReceipt(payment);
      } catch (error) {
        console.error('Unable to record landlord payment.', error);
        showToast(`Payment could not be saved: ${error.message || 'browser storage unavailable'}`);
      }
    });
    renderLandlordPaymentList();
    return;
  }
  if (config.importantDocumentsPage) {
    const form = document.getElementById('important-document-form');
    form.addEventListener('submit', async (event) => {
      event.preventDefault();
      const title = document.getElementById('important-document-title').value.trim();
      const company = document.getElementById('important-document-company').value.trim();
      const category = document.getElementById('important-document-category').value;
      const expiryDate = document.getElementById('important-document-expiry').value;
      const inventoryCode = document.getElementById('important-document-inventory').value;
      const fileInput = document.getElementById('important-document-file');
      const file = fileInput.files[0];
      if (!title || !company || !category || !file) {
        showToast('Enter a title and company, choose a document type, and select a file.');
        return;
      }
      try {
        await saveImportantDocument({
          title,
          company,
          category,
          documentType: category,
          expiryDate,
          inventoryCode,
          fileName: file.name,
          mimeType: file.type || 'application/octet-stream',
          size: file.size,
          createdAt: new Date().toISOString(),
          blob: file
        });
        form.reset();
        showToast('Important document uploaded.');
        await renderImportantDocumentList();
      } catch (error) {
        console.error('Unable to upload important document.', error);
        showToast(`Document upload failed: ${error.message || 'browser storage unavailable'}`);
      }
    });
    renderImportantDocumentList();
    return;
  }
  if (config.landlordPage) {
    view.querySelectorAll('[data-landlord-doc-open]').forEach((button) => button.addEventListener('click', () => {
      view.querySelector(`[data-landlord-doc-upload="${button.dataset.landlordDocOpen}"]`)?.click();
    }));
    view.querySelectorAll('[data-landlord-doc-upload]').forEach((input) => input.addEventListener('change', async () => {
      const files = [...input.files];
      if (!files.length) return;
      if (files.some((file) => file.type !== 'application/pdf' && !file.type.startsWith('image/'))) {
        showToast('Choose PDF or image files for bank details.');
        input.value = '';
        return;
      }
      try {
        for (const file of files) {
          await saveLandlordBankDocument({
            inventoryCode: input.dataset.landlordDocUpload,
            fileName: file.name,
            mimeType: file.type,
            createdAt: new Date().toISOString(),
            blob: file
          });
        }
        showToast(`${files.length} bank document${files.length === 1 ? '' : 's'} uploaded.`);
        await renderLandlordBankDocuments(view);
      } catch (error) {
        console.error('Unable to upload landlord bank documents.', error);
        showToast(`Bank document upload failed: ${error.message || 'browser storage unavailable'}`);
      } finally {
        input.value = '';
      }
    }));
    renderLandlordBankDocuments(view);
    return;
  }
  if (config.presentationPage) {
    renderPresentationPage();
    return;
  }
  if (config.photoPage) {
    renderPhotoPage();
    return;
  }
  const search = document.getElementById('module-inventory-search');
  if (search) search.addEventListener('input', () => {
    const query = search.value.trim().toLowerCase();
    const category = view.dataset.category;
    const filtered = inventory.filter((item) => (!category || item.category === category)
      && (!view.dataset.categories || view.dataset.categories.split(',').includes(item.category))
      && `${item.code} ${item.name} ${item.category} ${item.zone} ${item.town} ${item.state} ${item.type}`.toLowerCase().includes(query));
    const panel = view.querySelector('.module-table-panel');
    panel.innerHTML = `<div class="panel-heading"><div><h2>Inventory register</h2><p>${filtered.length} matching ${inventoryDataLabel()} sites</p></div><div class="panel-heading-actions"><button class="button button-secondary" type="button" data-export-inventory>Export Excel</button><label class="search-box module-search"><span>⌕</span><input id="module-inventory-search" type="search" placeholder="Search inventory" aria-label="Search inventory" value="${search.value.replaceAll('"', '&quot;')}"></label></div></div>${inventoryTable(filtered)}`;
    const nextSearch = document.getElementById('module-inventory-search');
    nextSearch.focus();
    nextSearch.setSelectionRange(query.length, query.length);
    nextSearch.addEventListener('input', () => {
      const value = nextSearch.value.trim().toLowerCase();
      const nextFiltered = inventory.filter((item) => (!category || item.category === category)
        && (!view.dataset.categories || view.dataset.categories.split(',').includes(item.category))
        && `${item.code} ${item.name} ${item.category} ${item.zone} ${item.town} ${item.state} ${item.type}`.toLowerCase().includes(value));
      panel.querySelector('tbody').innerHTML = inventoryRows(nextFiltered);
      panel.querySelector('.panel-heading p').textContent = `${nextFiltered.length} matching ${inventoryDataLabel()} sites`;
    });
  });
}

async function renderLandlordBankDocuments(view) {
  try {
    const documents = await getLandlordBankDocuments();
    if (!view.isConnected || document.body.dataset.currentPage !== 'landlord-details') return;
    view.querySelectorAll('[data-landlord-documents]').forEach((container) => {
      const siteDocuments = documents.filter((record) => record.inventoryCode === container.dataset.landlordDocuments);
      container.innerHTML = siteDocuments.length
        ? siteDocuments.map((record) => `<div class="landlord-document-item">
            <button type="button" class="landlord-document-download" data-download-landlord-doc="${record.id}">${escapeHtml(record.fileName)}</button>
            <button type="button" class="landlord-document-remove" aria-label="Remove ${escapeHtml(record.fileName)}" data-remove-landlord-doc="${record.id}">Remove</button>
          </div>`).join('')
        : '<span class="landlord-doc-empty">No files uploaded</span>';
    });
    view.querySelectorAll('[data-download-landlord-doc]').forEach((button) => button.addEventListener('click', async () => {
      try {
        const documentRecord = documents.find((record) => String(record.id) === button.dataset.downloadLandlordDoc);
        if (!documentRecord) return;
        const url = URL.createObjectURL(await readWorkspaceFile(documentRecord));
        const link = document.createElement('a');
        link.href = url;
        link.download = documentRecord.fileName;
        document.body.append(link);
        link.click();
        link.remove();
        window.setTimeout(() => URL.revokeObjectURL(url), 1000);
      } catch (error) {
        console.error('Unable to download landlord bank document.', error);
        showToast(`Bank document download failed: ${error.message || 'browser storage unavailable'}`);
      }
    }));
    view.querySelectorAll('[data-remove-landlord-doc]').forEach((button) => button.addEventListener('click', async () => {
      try {
        await deleteLandlordBankDocument(recordIdFromDataset(button.dataset.removeLandlordDoc));
        showToast('Bank document removed.');
        await renderLandlordBankDocuments(view);
      } catch (error) {
        console.error('Unable to remove landlord bank document.', error);
        showToast(`Bank document removal failed: ${error.message || 'browser storage unavailable'}`);
      }
    }));
  } catch (error) {
    console.error('Unable to load landlord bank documents.', error);
    const lists = view.querySelectorAll('[data-landlord-documents]');
    lists.forEach((container) => {
      container.innerHTML = '<span class="landlord-doc-error">Unable to load documents</span>';
    });
  }
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (character) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;'
  })[character]);
}

async function renderPhotoPage() {
  const host = document.getElementById('inventory-photo-content');
  const item = inventory.find((record) => record.code === activePhotoInventoryCode);
  if (!host || !item) return;

  photoObjectUrls.forEach((url) => URL.revokeObjectURL(url));
  photoObjectUrls = [];

  const categoryTabs = photoCategories.map((category) => `
    <button class="photo-tab ${category === activePhotoCategory ? 'active' : ''}"
      type="button" role="tab" aria-selected="${category === activePhotoCategory}"
      data-photo-category="${escapeHtml(category)}">${escapeHtml(category)}</button>`).join('');
  host.innerHTML = `
    <div class="photo-page-heading">
      <button class="text-button photo-back" type="button" data-photo-back>← Back to inventory</button>
      <div class="photo-site-heading"><span class="site-thumb">▥</span><div><h2>${escapeHtml(item.name)}</h2><p>${escapeHtml(item.code)} · ${escapeHtml(item.category)} · ${escapeHtml(item.zone)}, ${escapeHtml(item.town)}</p></div></div>
    </div>
    <section class="panel photo-panel">
      <div class="photo-tabs" role="tablist" aria-label="Inventory photo categories">${categoryTabs}</div>
      <div class="photo-upload-area">
        <div class="photo-upload-controls">
          <input id="photo-upload" type="file" accept="image/*" multiple hidden>
          <label class="button button-primary photo-upload-button" for="photo-upload">＋ Upload photos from computer</label>
        </div>
      </div>
      <div class="photo-gallery" id="photo-gallery" aria-live="polite"><div class="photo-loading">Loading saved photos…</div></div>
    </section>`;

  document.getElementById('page-title').textContent = `${item.code} · ${item.name}`;
  document.getElementById('page-subtitle').textContent = 'Photos for this inventory site.';
  document.getElementById('breadcrumb-current').textContent = 'Inventory photos';
  host.querySelector('[data-photo-back]').addEventListener('click', () => setPage('inventory-sites'));
  host.querySelectorAll('[data-photo-category]').forEach((tab) => tab.addEventListener('click', () => {
    activePhotoCategory = tab.dataset.photoCategory;
    renderPhotoPage();
  }));
  const uploadInput = document.getElementById('photo-upload');
  uploadInput.addEventListener('change', async () => {
    const files = [...uploadInput.files];
    if (!files.length) return;
    if (files.some((file) => !file.type.startsWith('image/'))) {
      showToast('Choose image files to upload.');
      uploadInput.value = '';
      return;
    }
    try {
      for (const file of files) {
        await saveInventoryPhoto({
          inventoryCode: item.code,
          category: activePhotoCategory,
          selectedForPresentation: false,
          fileName: file.name,
          mimeType: file.type,
          createdAt: new Date().toISOString(),
          blob: file
        });
      }
      showToast(`${files.length} photo${files.length === 1 ? '' : 's'} saved.`);
      await renderPhotoPage();
    } catch (error) {
      console.error('Unable to save inventory photo.', error);
      showToast(`Photo upload failed: ${error.message || 'storage unavailable'}`);
    } finally {
      uploadInput.value = '';
    }
  });
  await refreshPhotoGallery(item.code);
}

async function refreshPhotoGallery(inventoryCode) {
  const gallery = document.getElementById('photo-gallery');
  if (!gallery) return;
  try {
    const photos = await getInventoryPhotos(inventoryCode);
    const categoryPhotos = photos.filter((photo) => photo.category === activePhotoCategory);
    if (!categoryPhotos.length) {
      gallery.innerHTML = `<div class="photo-empty"><span>▧</span><strong>No photos in ${escapeHtml(activePhotoCategory)}.</strong></div>`;
      return;
    }
    gallery.innerHTML = categoryPhotos.map((photo) => {
      const url = URL.createObjectURL(photo.blob);
      photoObjectUrls.push(url);
      return `<article class="photo-card">
        <img src="${url}" alt="${escapeHtml(photo.fileName)}">
        <div class="photo-card-info"><strong title="${escapeHtml(photo.fileName)}">${escapeHtml(photo.fileName)}</strong>
          <button type="button" class="ppt-photo-toggle ${photo.selectedForPresentation ? 'selected' : ''}" aria-pressed="${Boolean(photo.selectedForPresentation)}" data-ppt-photo="${photo.id}">${photo.selectedForPresentation ? '✓ Added to PPT library' : '+ Use in PPT'}</button>
          <button type="button" class="photo-delete" data-delete-photo="${photo.id}">Remove photo</button>
        </div>
      </article>`;
    }).join('');
    gallery.querySelectorAll('[data-ppt-photo]').forEach((button) => button.addEventListener('click', async () => {
      try {
        const selected = button.getAttribute('aria-pressed') !== 'true';
        await updatePhotoPresentationSelection(recordIdFromDataset(button.dataset.pptPhoto), selected);
        showToast(selected ? 'Photo added to PPT library.' : 'Photo removed from PPT library.');
        await renderPhotoPage();
      } catch (error) {
        console.error('Unable to update PPT photo selection.', error);
        showToast(`Unable to update PPT library: ${error.message || 'storage unavailable'}`);
      }
    }));
    gallery.querySelectorAll('[data-delete-photo]').forEach((button) => button.addEventListener('click', async () => {
      try {
        await deleteInventoryPhoto(recordIdFromDataset(button.dataset.deletePhoto));
        showToast('Photo removed.');
        await renderPhotoPage();
      } catch (error) {
        console.error('Unable to remove inventory photo.', error);
        showToast(`Photo removal failed: ${error.message || 'storage unavailable'}`);
      }
    }));
  } catch (error) {
    console.error('Unable to load inventory photos.', error);
    gallery.innerHTML = '<div class="photo-error">Unable to load saved photos. Check browser storage permissions and try again.</div>';
  }
}

async function renderPresentationPage() {
  const host = document.getElementById('presentation-content');
  if (!host) return;
  photoObjectUrls.forEach((url) => URL.revokeObjectURL(url));
  photoObjectUrls = [];

  host.innerHTML = `
    <section class="panel ppt-builder">
      <div class="panel-heading"><div><h2>Build a presentation draft</h2><p>Select photos from inventory photo categories to use in a customer PPT presentation.</p></div></div>
      <label class="ppt-title-label" for="ppt-title">Presentation title</label>
      <input class="ppt-title-input" id="ppt-title" type="text" maxlength="100" placeholder="e.g. North Star Retail — Bhopal outdoor media">
      <div class="ppt-photo-grid" id="ppt-photo-grid"><div class="photo-loading">Loading inventory photo library…</div></div>
      <div class="ppt-builder-footer"><span id="ppt-selection-count">0 photos selected</span><div class="ppt-builder-actions"><button class="button button-secondary" id="export-ppt-photos" type="button" disabled>Export selected to Excel</button><button class="button button-primary" id="create-ppt-draft" type="button" disabled>Create presentation draft</button></div></div>
    </section>
    <section class="panel ppt-drafts-panel">
      <div class="panel-heading"><div><h2>Presentation drafts</h2><p>Drafts are saved in this browser.</p></div></div>
      <div class="ppt-drafts" id="ppt-drafts"><div class="photo-loading">Loading presentation drafts…</div></div>
    </section>`;

  try {
    const allPhotos = await readAllInventoryPhotos();
    const grid = document.getElementById('ppt-photo-grid');
    if (!allPhotos.length) {
      grid.innerHTML = '<div class="photo-empty"><span>▧</span><strong>No inventory photos yet</strong><p>Upload photos from an inventory record to add them to the PPT library.</p></div>';
    } else {
      grid.innerHTML = allPhotos.map((photo) => {
        const item = inventory.find((record) => record.code === photo.inventoryCode);
        const url = URL.createObjectURL(photo.blob);
        photoObjectUrls.push(url);
        return `<label class="ppt-photo-option">
          <input type="checkbox" data-ppt-select="${photo.id}" ${photo.selectedForPresentation ? 'checked' : ''}>
          <img src="${url}" alt="${escapeHtml(photo.fileName)}">
          <span class="ppt-photo-meta"><strong>${escapeHtml(item?.name || photo.inventoryCode)}</strong><small>${escapeHtml(photo.inventoryCode)} · ${escapeHtml(photo.category)}</small></span>
        </label>`;
      }).join('');
    }

    grid.querySelectorAll('[data-ppt-select]').forEach((checkbox) => checkbox.addEventListener('change', async () => {
      try {
        await updatePhotoPresentationSelection(recordIdFromDataset(checkbox.dataset.pptSelect), checkbox.checked);
        updatePptSelectionState();
      } catch (error) {
        console.error('Unable to update PPT photo selection.', error);
        checkbox.checked = !checkbox.checked;
        showToast(`Unable to update PPT selection: ${error.message || 'storage unavailable'}`);
      }
    }));
    document.getElementById('create-ppt-draft').addEventListener('click', createPptDraft);
    document.getElementById('export-ppt-photos').addEventListener('click', exportSelectedPresentationPhotos);
    updatePptSelectionState();
    await renderPptDrafts(allPhotos);
  } catch (error) {
    console.error('Unable to load presentation photo library.', error);
    host.querySelector('#ppt-photo-grid').innerHTML = '<div class="photo-error">Unable to load the presentation workspace. Check browser storage permissions and try again.</div>';
    host.querySelector('#ppt-drafts').innerHTML = '';
  }
}

async function readAllInventoryPhotos() {
  if (isCloudDataActive()) {
    return (await readWorkspaceRecords('inventory-photos', true)).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }
  const database = await openPhotoDatabase();
  return new Promise((resolve, reject) => {
    const transaction = database.transaction('inventory-photos', 'readonly');
    const request = transaction.objectStore('inventory-photos').getAll();
    request.onsuccess = () => resolve(request.result.sort((a, b) => b.createdAt.localeCompare(a.createdAt)));
    request.onerror = () => reject(request.error || new Error('Unable to read inventory photo library.'));
    transaction.oncomplete = () => database.close();
    transaction.onerror = () => {
      database.close();
      reject(transaction.error || new Error('Unable to read inventory photo library.'));
    };
  });
}

function updatePptSelectionState() {
  const selectedCount = document.querySelectorAll('#ppt-photo-grid [data-ppt-select]:checked').length;
  const count = document.getElementById('ppt-selection-count');
  const createButton = document.getElementById('create-ppt-draft');
  const exportButton = document.getElementById('export-ppt-photos');
  const title = document.getElementById('ppt-title');
  if (count) count.textContent = `${selectedCount} photo${selectedCount === 1 ? '' : 's'} selected`;
  if (createButton) createButton.disabled = selectedCount === 0 || !title.value.trim();
  if (exportButton) exportButton.disabled = selectedCount === 0;
  if (title && !title.dataset.bound) {
    title.dataset.bound = 'true';
    title.addEventListener('input', updatePptSelectionState);
  }
}

async function exportSelectedPresentationPhotos() {
  const selectedIds = new Set([...document.querySelectorAll('#ppt-photo-grid [data-ppt-select]:checked')]
    .map((checkbox) => recordIdFromDataset(checkbox.dataset.pptSelect)));
  if (!selectedIds.size) return;
  try {
    const photos = (await readAllInventoryPhotos()).filter((photo) => selectedIds.has(recordIdFromDataset(photo.id)));
    const rows = [
      ['Inventory Code', 'Inventory Location', 'Photo Category', 'Photo File', 'MIME Type', 'Added to PPT Library', 'Uploaded At'],
      ...photos.map((photo) => {
        const item = inventory.find((record) => record.code === photo.inventoryCode);
        return [
          photo.inventoryCode, item?.name || '', photo.category, photo.fileName,
          photo.mimeType, photo.selectedForPresentation ? 'Yes' : 'No', photo.createdAt
        ];
      })
    ];
    const title = document.getElementById('ppt-title')?.value.trim() || 'selected-photos';
    const safeTitle = title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'selected-photos';
    exportExcelWorkbook(`${safeTitle}-ppt-photos.xls`, [{ name: 'PPT Photos', rows }]);
    showToast(`Excel export downloaded · ${photos.length} photos`);
  } catch (error) {
    console.error('Unable to export selected presentation photos.', error);
    showToast(`Excel export failed: ${error.message || 'unable to read photo library'}`);
  }
}

async function renderImportantDocumentList() {
  const container = document.getElementById('important-document-list');
  if (!container) return;
  try {
    const documents = await getImportantDocuments();
    if (!container.isConnected || document.body.dataset.currentPage !== 'important-documents') return;
    if (!documents.length) {
      container.innerHTML = '<div class="drafts-empty">No important documents uploaded yet.</div>';
      return;
    }
    container.innerHTML = `<div class="table-wrap"><table class="important-document-table">
      <thead><tr><th>COMPANY</th><th>DOCUMENT TYPE</th><th>EXPIRY</th><th>STATUS</th><th>TITLE</th><th>RELATED INVENTORY</th><th>FILE NAME</th><th>UPLOADED</th><th>SIZE</th><th>ACTIONS</th></tr></thead>
      <tbody>${documents.map((record) => {
        const linkedItem = inventory.find((item) => item.code === record.inventoryCode);
        const documentStatus = importantDocumentStatus(record.expiryDate);
        const size = record.size < 1024 * 1024
          ? `${Math.max(1, Math.round(record.size / 1024))} KB`
          : `${(record.size / (1024 * 1024)).toFixed(1)} MB`;
        return `<tr>
          <td>${escapeHtml(record.company || 'Not provided')}</td>
          <td>${escapeHtml(record.documentType || record.category || 'Not provided')}</td>
          <td>${record.expiryDate ? escapeHtml(new Date(`${record.expiryDate}T00:00:00`).toLocaleDateString()) : '—'}</td>
          <td><span class="activity-status ${statusClass(documentStatus)}">${documentStatus}</span></td>
          <td><strong>${escapeHtml(record.title)}</strong></td>
          <td>${linkedItem ? `${escapeHtml(linkedItem.code)} · ${escapeHtml(linkedItem.name)}` : '—'}</td>
          <td>${escapeHtml(record.fileName)}</td>
          <td>${escapeHtml(new Date(record.createdAt).toLocaleDateString())}</td>
          <td>${size}</td>
          <td><div class="important-document-actions"><button class="text-button" type="button" data-download-important-document="${record.id}">Download</button><button class="landlord-document-remove" type="button" data-delete-important-document="${record.id}">Delete</button></div></td>
        </tr>`;
      }).join('')}</tbody></table></div>`;
    container.querySelectorAll('[data-download-important-document]').forEach((button) => button.addEventListener('click', async () => {
      try {
        const record = documents.find((item) => String(item.id) === button.dataset.downloadImportantDocument);
        if (!record) return;
        const url = URL.createObjectURL(await readWorkspaceFile(record));
        const link = document.createElement('a');
        link.href = url;
        link.download = record.fileName;
        document.body.append(link);
        link.click();
        link.remove();
        window.setTimeout(() => URL.revokeObjectURL(url), 1000);
      } catch (error) {
        console.error('Unable to download important document.', error);
        showToast(`Document download failed: ${error.message || 'storage unavailable'}`);
      }
    }));
    container.querySelectorAll('[data-delete-important-document]').forEach((button) => button.addEventListener('click', async () => {
      try {
        await deleteImportantDocument(recordIdFromDataset(button.dataset.deleteImportantDocument));
        showToast('Important document deleted.');
        await renderImportantDocumentList();
      } catch (error) {
        console.error('Unable to delete important document.', error);
        showToast(`Document deletion failed: ${error.message || 'browser storage unavailable'}`);
      }
    }));
  } catch (error) {
    console.error('Unable to load important documents.', error);
    container.innerHTML = '<div class="photo-error">Unable to load important documents. Check browser storage permissions and try again.</div>';
  }
}

function importantDocumentStatus(expiryDate) {
  if (!expiryDate) return 'No expiry';
  const expiry = new Date(`${expiryDate}T00:00:00`);
  if (Number.isNaN(expiry.getTime())) return 'Invalid expiry';
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  if (expiry < today) return 'Expired';
  const daysUntilExpiry = Math.ceil((expiry - today) / 86400000);
  return daysUntilExpiry <= 30 ? 'Expiring soon' : 'Active';
}

function localDateInputValue() {
  const date = new Date();
  const offset = date.getTimezoneOffset() * 60000;
  return new Date(date.getTime() - offset).toISOString().slice(0, 10);
}

function formatBudgetAmount(amount) {
  return new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 2 }).format(Number(amount) || 0);
}

function updateOperationsBudgetTotals() {
  const form = document.getElementById('operations-budget-form');
  if (!form) return;
  let total = 0;
  form.querySelectorAll('[data-budget-line-row]').forEach((row) => {
    const quantity = Number(row.querySelector('.budget-line-quantity-value').value) || 0;
    const rate = Number(row.querySelector('.budget-line-rate').value) || 0;
    const amount = quantity * rate;
    total += amount;
    row.querySelector('.budget-line-amount').textContent = formatBudgetAmount(amount);
  });
  document.getElementById('operations-budget-total').textContent = formatBudgetAmount(total);
}

function operationsBudgetPdf(budget) {
  const commands = [];
  const left = 32;
  const right = 580;
  const columns = [left, 61, 316, 378, 445, 505, right];
  let y = 754;
  const addText = (text, x, baseline, size = 8, bold = false, align = 'left') => {
    const safeText = pdfSafeText(text);
    const adjustment = align === 'center' ? safeText.length * size * 0.25 : align === 'right' ? safeText.length * size * 0.5 : 0;
    commands.push(`BT /${bold ? 'F2' : 'F1'} ${size} Tf ${Math.max(left + 2, x - adjustment)} ${baseline} Td (${safeText}) Tj ET`);
  };
  const addRule = (x1, y1, x2, y2, width = 0.5) => {
    commands.push(`${width} w ${x1} ${y1} m ${x2} ${y2} l S`);
  };
  const addCellText = (text, x, baseline, maxLength, size = 7, bold = false) => {
    const trimmed = String(text || '—').replace(/\s+/g, ' ');
    const value = trimmed.length > maxLength ? `${trimmed.slice(0, maxLength - 1)}…` : trimmed;
    addText(value, x + 3, baseline, size, bold);
  };

  commands.push('0 G');
  addRule(left, y + 10, right, y + 10, 1.2);
  addText('HOARDING INSTALLATION / REPAIR / SHIFTING / MAINTENANCE ETC.', 306, y - 5, 10, true, 'center');
  y -= 20;
  addText(`${String(budget.category || 'BUDGET').toUpperCase()} - BUDGET / EXPENSES DETAILS`, 306, y, 12, true, 'center');
  y -= 14;
  addRule(left, y, right, y, 1);
  y -= 20;
  const detailRows = [
    [`LOCATION: ${budget.location || budget.inventoryName || budget.inventoryCode}`, `SIZE: ${budget.size || '—'}`],
    [`JOB DETAILS: ${budget.description || '—'}`, `DURATION: ${budget.duration || '—'}`],
    [`INVENTORY: ${budget.inventoryCode} · ${budget.category}`, `BUDGET DATE: ${new Date(`${budget.budgetDate}T00:00:00`).toLocaleDateString('en-IN')}`]
  ];
  detailRows.forEach((detail) => {
    addCellText(detail[0], left, y, 59, 8, true);
    addCellText(detail[1], 340, y, 42, 8, true);
    addRule(left, y - 6, right, y - 6, 0.35);
    y -= 20;
  });
  y -= 4;

  const headerTop = y + 8;
  const headerBottom = y - 28;
  addRule(left, headerTop, right, headerTop, 1);
  addRule(left, headerBottom, right, headerBottom, 1);
  columns.forEach((x) => addRule(x, headerTop, x, headerBottom, 0.4));
  addText('SL', (columns[0] + columns[1]) / 2, y - 8, 7, true, 'center');
  addText('PARTICULARS / NATURE / SIZE', (columns[1] + columns[2]) / 2, y - 8, 7, true, 'center');
  addText('QTY / UNIT', (columns[2] + columns[3]) / 2, y - 8, 7, true, 'center');
  addText('RATE (INR)', (columns[3] + columns[4]) / 2, y - 8, 7, true, 'center');
  addText('AMOUNT (INR)', (columns[4] + columns[5]) / 2, y - 8, 7, true, 'center');
  addText('REMARKS', (columns[5] + columns[6]) / 2, y - 8, 7, true, 'center');
  addText('PER UNIT', (columns[3] + columns[4]) / 2, y - 19, 6, false, 'center');
  y -= 28;

  const lineItems = budget.lineItems?.length ? budget.lineItems : [{
    serialNumber: 1,
    description: budget.description || 'Budget estimate',
    quantity: 1,
    unit: 'Job',
    rate: Number(budget.amount) || 0,
    amount: Number(budget.amount) || 0,
    remarks: budget.vendor || ''
  }];
  lineItems.forEach((line, index) => {
    const rowTop = y + 7;
    const rowBottom = y - 9;
    columns.forEach((x) => addRule(x, rowTop, x, rowBottom, 0.3));
    addRule(left, rowBottom, right, rowBottom, 0.3);
    addCellText(line.serialNumber || index + 1, columns[0], y - 2, 4, 7);
    addCellText(line.description, columns[1], y - 2, 39, 7);
    addCellText(`${line.quantity || 0} ${line.unit || ''}`.trim(), columns[2], y - 2, 9, 7);
    addCellText(formatBudgetAmount(line.rate || 0).replace(/^₹/, ''), columns[3], y - 2, 10, 7);
    addCellText(formatBudgetAmount(line.amount || 0).replace(/^₹/, ''), columns[4], y - 2, 10, 7);
    addCellText(line.remarks, columns[5], y - 2, 12, 7);
    y -= 16;
  });
  y -= 3;
  addRule(columns[3], y + 6, right, y + 6, 0.8);
  addText('TOTAL', columns[3] + 4, y - 6, 9, true);
  addText(formatBudgetAmount(budget.amount).replace(/^₹/, 'INR '), columns[4] + 4, y - 6, 8, true);
  y -= 18;
  addRule(columns[3], y + 7, right, y + 7, 0.5);
  addText('ADVANCE TAKEN AGAINST THIS JOB', columns[0] + 3, y - 7, 8, true);
  addText(formatBudgetAmount(budget.advance || 0).replace(/^₹/, 'INR '), columns[4] + 4, y - 7, 8, true);
  y -= 21;
  addRule(left, y + 5, right, y + 5, 1);
  addText(`VENDOR / CONTRACTOR: ${budget.vendor || '—'}`, left + 3, y - 8, 8);
  addText(`PREPARED BY: ${budget.preparedBy || 'Super Admin'}`, 335, y - 8, 8);
  y -= 23;
  if (budget.notes) addCellText(`NOTES: ${budget.notes}`, left + 3, y, 100, 8);
  addText('SIGNED BY: __________________________', right - 160, 30, 8, true);

  const stream = commands.join('\n');
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R /F2 6 0 R >> >> /Contents 5 0 R >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
    `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold >>'
  ];
  let pdf = '%PDF-1.4\n';
  const offsets = [0];
  objects.forEach((object, index) => {
    offsets.push(pdf.length);
    pdf += `${index + 1} 0 obj\n${object}\nendobj\n`;
  });
  const xrefOffset = pdf.length;
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  offsets.slice(1).forEach((offset) => {
    pdf += `${String(offset).padStart(10, '0')} 00000 n \n`;
  });
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF`;
  return pdf;
}

function downloadOperationsBudgetPdf(budget) {
  try {
    const safeCategory = String(budget.category || 'budget').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
    const url = URL.createObjectURL(new Blob([operationsBudgetPdf(budget)], { type: 'application/pdf' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = `hoarding-budget-${safeCategory}-${String(budget.id).padStart(4, '0')}.pdf`;
    document.body.append(link);
    link.click();
    link.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    showToast('Budget PDF exported.');
  } catch (error) {
    console.error('Unable to export operations budget.', error);
    showToast(`Budget PDF export failed: ${error.message || 'unable to create PDF'}`);
  }
}

async function renderOperationsBudgetList() {
  const container = document.getElementById('operations-budget-list');
  if (!container) return;
  try {
    const category = document.getElementById('operations-budget-category')?.value || operationsBudgetCategories[0];
    const budgets = (await getOperationsBudgets()).filter((budget) => budget.category === category);
    if (!container.isConnected || document.body.dataset.currentPage !== 'budget-preparation') return;
    if (!budgets.length) {
      container.innerHTML = `<div class="drafts-empty">No ${escapeHtml(category.toLowerCase())} budgets prepared yet.</div>`;
      return;
    }
    const total = budgets.reduce((sum, budget) => sum + Number(budget.amount || 0), 0);
    container.innerHTML = `<p class="landlord-payment-total">${budgets.length} budget${budgets.length === 1 ? '' : 's'} · Total estimated ${formatBudgetAmount(total)}</p>
      <div class="table-wrap landlord-payment-register"><table>
        <thead><tr><th>BUDGET DATE</th><th>INVENTORY SITE</th><th>JOB DETAILS</th><th>DURATION</th><th>ADVANCE (INR)</th><th>BALANCE (INR)</th><th>TOTAL (INR)</th><th>ACTIONS</th></tr></thead>
        <tbody>${budgets.map((budget) => {
          const item = inventory.find((record) => record.code === budget.inventoryCode);
          return `<tr>
            <td>${escapeHtml(new Date(`${budget.budgetDate}T00:00:00`).toLocaleDateString('en-IN'))}</td>
            <td><strong>${escapeHtml(budget.inventoryCode)}</strong><br><small>${escapeHtml(budget.location || item?.name || budget.inventoryName || '')}</small></td>
            <td>${escapeHtml(budget.description)}</td>
            <td>${escapeHtml(budget.duration || '—')}</td>
            <td>${formatBudgetAmount(budget.advance || 0)}</td>
            <td>${formatBudgetAmount(Math.max(0, Number(budget.amount || 0) - Number(budget.advance || 0)))}</td>
            <td><strong>${formatBudgetAmount(Number(budget.amount))}</strong></td>
            <td><button class="text-button landlord-receipt-export" type="button" data-export-operations-budget="${budget.id}">Export PDF</button></td>
          </tr>`;
        }).join('')}</tbody></table></div>`;
    container.querySelectorAll('[data-export-operations-budget]').forEach((button) => button.addEventListener('click', () => {
      const budget = budgets.find((record) => String(record.id) === button.dataset.exportOperationsBudget);
      if (budget) downloadOperationsBudgetPdf(budget);
    }));
  } catch (error) {
    console.error('Unable to load operations budgets.', error);
    container.innerHTML = '<div class="photo-error">Unable to load budgets. Check browser storage permissions and try again.</div>';
  }
}

async function renderLandlordPaymentList() {
  const container = document.getElementById('landlord-payment-list');
  if (!container) return;
  try {
    const payments = await getLandlordPayments();
    if (!container.isConnected || document.body.dataset.currentPage !== 'landlord-payments') return;
    if (!payments.length) {
      container.innerHTML = '<div class="drafts-empty">No landlord payments recorded yet.</div>';
      return;
    }
    const total = payments.reduce((sum, payment) => sum + Number(payment.amount || 0), 0);
    const currency = new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 2 });
    container.innerHTML = `<p class="landlord-payment-total">${payments.length} payment${payments.length === 1 ? '' : 's'} recorded · Total ${currency.format(total)}</p>
      <div class="table-wrap landlord-payment-register"><table>
        <thead><tr><th>INVENTORY SITE</th><th>LANDLORD</th><th>PAYMENT DATE</th><th>METHOD</th><th>REFERENCE</th><th>NOTES</th><th>AMOUNT (INR)</th><th>STATUS</th><th>RECEIPT</th></tr></thead>
        <tbody>${payments.map((payment) => {
          const item = inventory.find((record) => record.code === payment.inventoryCode);
          const paymentDate = new Date(`${payment.paymentDate}T00:00:00`).toLocaleDateString();
          return `<tr>
            <td><strong>${escapeHtml(payment.inventoryCode)}</strong><br><small>${escapeHtml(item?.name || payment.inventoryName || '')}</small></td>
            <td>${escapeHtml(payment.landlordName)}</td>
            <td>${escapeHtml(paymentDate)}</td>
            <td>${escapeHtml(payment.paymentMethod)}</td>
            <td>${escapeHtml(payment.reference || '—')}</td>
            <td>${escapeHtml(payment.notes || '—')}</td>
            <td><strong>${currency.format(Number(payment.amount))}</strong></td>
            <td><span class="activity-status status-done">${escapeHtml(payment.status || 'Recorded')}</span></td>
            <td><button class="text-button landlord-receipt-export" type="button" data-export-landlord-receipt="${payment.id}">Export PDF</button></td>
          </tr>`;
        }).join('')}</tbody>
      </table></div>`;
    container.querySelectorAll('[data-export-landlord-receipt]').forEach((button) => button.addEventListener('click', () => {
      const payment = payments.find((record) => String(record.id) === button.dataset.exportLandlordReceipt);
      if (payment) downloadLandlordPaymentReceipt(payment);
    }));
  } catch (error) {
    console.error('Unable to load landlord payment history.', error);
    container.innerHTML = '<div class="photo-error">Unable to load landlord payments. Check browser storage permissions and try again.</div>';
  }
}

function pdfSafeText(value) {
  return String(value ?? '')
    .normalize('NFKD')
    .replace(/[^\x20-\x7E]/g, '?')
    .replace(/\\/g, '\\\\')
    .replace(/\(/g, '\\(')
    .replace(/\)/g, '\\)');
}

function amountInWordsINR(amount) {
  const ones = ['', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine'];
  const teens = ['Ten', 'Eleven', 'Twelve', 'Thirteen', 'Fourteen', 'Fifteen', 'Sixteen', 'Seventeen', 'Eighteen', 'Nineteen'];
  const tens = ['', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety'];
  const underThousand = (value) => {
    const words = [];
    if (value >= 100) {
      words.push(ones[Math.floor(value / 100)], 'Hundred');
      value %= 100;
    }
    if (value >= 20) {
      words.push(tens[Math.floor(value / 10)]);
      value %= 10;
    } else if (value >= 10) {
      words.push(teens[value - 10]);
      value = 0;
    }
    if (value > 0) words.push(ones[value]);
    return words.join(' ');
  };
  const rupees = Math.floor(Number(amount));
  const paise = Math.round((Number(amount) - rupees) * 100);
  if (!Number.isSafeInteger(rupees) || rupees < 0) return 'Amount not available';
  const groups = [
    [Math.floor(rupees / 10000000), 'Crore'],
    [Math.floor((rupees % 10000000) / 100000), 'Lakh'],
    [Math.floor((rupees % 100000) / 1000), 'Thousand'],
    [rupees % 1000, '']
  ];
  const words = groups
    .filter(([value]) => value > 0)
    .map(([value, unit]) => `${underThousand(value)}${unit ? ` ${unit}` : ''}`);
  const rupeeWords = words.join(' ') || 'Zero';
  const paiseWords = paise ? ` and ${underThousand(paise)} Paise` : '';
  return `${rupeeWords}${paiseWords} Rupees Only`;
}

function landlordPaymentReceiptPdf(payment) {
  const item = inventory.find((record) => record.code === payment.inventoryCode);
  const categoryCode = item?.category === 'BANS' ? 'BANS' : (item?.category || 'MEDIA').replace(/[^A-Z0-9]/gi, '').toUpperCase();
  const receiptYear = new Date(payment.createdAt || Date.now()).getFullYear();
  const receiptNumber = `LANDLORD/${categoryCode}-MR-${receiptYear}-${String(payment.id).padStart(4, '0')}`;
  const currency = new Intl.NumberFormat('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const paymentDate = new Date(`${payment.paymentDate}T00:00:00`).toLocaleDateString('en-IN');
  const issuedDate = new Date(payment.createdAt || Date.now()).toLocaleDateString('en-IN');
  const commands = [];
  const left = 38;
  const right = 574;
  let y = 756;
  const addText = (text, x, baseline, size = 10, bold = false, italic = false) => {
    const font = bold ? 'F2' : italic ? 'F3' : 'F1';
    commands.push(`BT /${font} ${size} Tf ${x} ${baseline} Td (${pdfSafeText(text)}) Tj ET`);
  };
  const addRule = (x1, y1, x2, y2, width = 0.6) => {
    commands.push(`${width} w ${x1} ${y1} m ${x2} ${y2} l S`);
  };
  const addWrappedText = (text, x, baseline, size, maxCharacters, bold = false) => {
    const lines = [];
    let remaining = String(text || '—');
    while (remaining.length > maxCharacters) {
      let splitAt = remaining.lastIndexOf(' ', maxCharacters);
      if (splitAt < 1) splitAt = maxCharacters;
      lines.push(remaining.slice(0, splitAt));
      remaining = remaining.slice(splitAt).trimStart();
    }
    lines.push(remaining);
    lines.forEach((line, index) => addText(line, x, baseline - index * 12, size, bold));
    return lines.length;
  };
  const section = (title) => {
    y -= 3;
    addRule(left, y, right, y, 1.1);
    y -= 18;
    addText(title, left + 3, y, 11, true);
    y -= 8;
  };
  const row = (label, value, options = {}) => {
    const labelWidth = options.labelWidth || 182;
    const textSize = options.size || 10;
    const lines = addWrappedText(value || '—', left + labelWidth + 8, y, textSize, options.maxCharacters || 66, Boolean(options.valueBold));
    const rowHeight = Math.max(options.height || 23, lines * 13 + 8);
    addText(label, left + 3, y, textSize, true);
    addRule(left, y - rowHeight + 8, right, y - rowHeight + 8, 0.35);
    y -= rowHeight;
  };

  commands.push('0.78 G');
  addRule(left, y + 11, right, y + 11, 1.2);
  addText('LANDLORD MONEY RECEIPT', 139, y - 7, 17, true);
  y -= 25;
  addRule(left, y + 10, right, y + 10, 1);
  row('Receipt No:', receiptNumber, { labelWidth: 250, maxCharacters: 55 });
  row('Receipt Date:', issuedDate, { labelWidth: 250 });
  row('Payment Date:', paymentDate, { labelWidth: 250 });
  y -= 3;
  addRule(left, y, right, y, 1);
  y -= 19;
  addText('WE APPRECIATE YOUR ONGOING ASSOCIATION', 117, y, 12, true, true);
  y -= 20;

  section('LANDLORD DETAILS');
  row('Landlord Name:', payment.landlordName);
  row('Contact:', payment.landlordContact);
  row('Address:', payment.landlordAddress);
  row('GST No:', payment.landlordGst);

  section('HOARDING DETAILS (ASSETS)');
  row('Inventory / Size / Type:', `${payment.inventoryCode} - ${item?.name || payment.inventoryName || ''} · ${payment.hoardingDetails || item?.type || ''}`, { maxCharacters: 62 });

  addRule(left, y + 7, right, y + 7, 1);
  addText('Amount Paid:', left + 26, y - 10, 11, true);
  addText(`INR ${currency.format(Number(payment.amount))}`, left + 255, y - 10, 12, true);
  y -= 27;
  addText('Amount in Words:', left + 26, y - 1, 10, true, true);
  addWrappedText(amountInWordsINR(payment.amount), left + 153, y - 1, 10, 62, false);
  y -= 23;
  addRule(left, y + 6, right, y + 6, 1);
  y -= 19;

  section('NATURE OF PAYMENT');
  const nature = payment.natureOfPayment?.length ? payment.natureOfPayment : ['Not specified'];
  nature.forEach((kind, index) => {
    addText(String(index + 1), left + 225, y, 10);
    addWrappedText(kind === 'Others' && payment.notes ? `OTHERS - ${payment.notes}` : kind.toUpperCase(), left + 245, y, 10, 50);
    y -= 21;
  });
  y -= 4;

  section('PAYMENT DETAILS');
  row('Payment Method:', payment.paymentMethod);
  row('Reference Number:', payment.reference);
  row('Bank Name:', payment.bankName);
  row('Account Number:', payment.accountNumber);
  row('Notes:', payment.notes);
  row('Recorded By:', payment.recordedBy || 'Super Admin');
  y -= 3;
  addRule(left, y, right, y, 1);
  y -= 17;
  addWrappedText('This receipt records the payment entry in the system and is not a bank transaction confirmation.', left + 3, y, 8, 95);
  const stream = commands.join('\n');
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R /F2 6 0 R /F3 7 0 R >> >> /Contents 5 0 R >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
    `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Oblique >>'
  ];
  let pdf = '%PDF-1.4\n';
  const offsets = [0];
  objects.forEach((object, index) => {
    offsets.push(pdf.length);
    pdf += `${index + 1} 0 obj\n${object}\nendobj\n`;
  });
  const xrefOffset = pdf.length;
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  offsets.slice(1).forEach((offset) => {
    pdf += `${String(offset).padStart(10, '0')} 00000 n \n`;
  });
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF`;
  return pdf;
}

function downloadLandlordPaymentReceipt(payment) {
  try {
    const receipt = landlordPaymentReceiptPdf(payment);
    const blob = new Blob([receipt], { type: 'application/pdf' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `landlord-payment-receipt-LP-${String(payment.id).padStart(6, '0')}.pdf`;
    document.body.append(link);
    link.click();
    link.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    showToast('Payment receipt PDF exported.');
  } catch (error) {
    console.error('Unable to export landlord payment receipt.', error);
    showToast(`Receipt PDF export failed: ${error.message || 'unable to create PDF'}`);
  }
}

async function renderBankMasterList() {
  const container = document.getElementById('bank-master-list');
  if (!container) return;
  try {
    const banks = await getBankMasterRecords();
    if (!container.isConnected || document.body.dataset.currentPage !== 'bank-master') return;
    if (!banks.length) {
      container.innerHTML = '<div class="drafts-empty">No banks added yet.</div>';
      return;
    }
    container.innerHTML = `<div class="table-wrap landlord-payment-register"><table>
      <thead><tr><th>BANK NAME</th><th>BRANCH</th><th>IFSC CODE</th><th>ACTIONS</th></tr></thead>
      <tbody>${banks.map((bank) => `<tr>
        <td><strong>${escapeHtml(bank.bankName)}</strong></td>
        <td>${escapeHtml(bank.branch)}</td>
        <td>${escapeHtml(bank.ifscCode)}</td>
        <td><button class="landlord-document-remove" type="button" data-delete-bank="${bank.id}">Delete</button></td>
      </tr>`).join('')}</tbody></table></div>`;
    container.querySelectorAll('[data-delete-bank]').forEach((button) => button.addEventListener('click', async () => {
      try {
        await deleteBankMasterRecord(recordIdFromDataset(button.dataset.deleteBank));
        showToast('Bank master record deleted.');
        await renderBankMasterList();
      } catch (error) {
        console.error('Unable to delete bank master record.', error);
        showToast(`Bank deletion failed: ${error.message || 'browser storage unavailable'}`);
      }
    }));
  } catch (error) {
    console.error('Unable to load bank master records.', error);
    container.innerHTML = '<div class="photo-error">Unable to load banks. Check browser storage permissions and try again.</div>';
  }
}

async function createPptDraft() {
  const title = document.getElementById('ppt-title').value.trim();
  const photoIds = [...document.querySelectorAll('#ppt-photo-grid [data-ppt-select]:checked')]
    .map((checkbox) => recordIdFromDataset(checkbox.dataset.pptSelect));
  if (!title || !photoIds.length) return;
  try {
    await savePresentation({ title, photoIds, createdAt: new Date().toISOString() });
    showToast('Presentation draft saved.');
    await renderPresentationPage();
  } catch (error) {
    console.error('Unable to save presentation draft.', error);
    showToast(`Unable to save presentation: ${error.message || 'storage unavailable'}`);
  }
}

async function renderPptDrafts(photos) {
  const container = document.getElementById('ppt-drafts');
  if (!container) return;
  const drafts = await getPresentations();
  if (!drafts.length) {
    container.innerHTML = '<div class="drafts-empty">No presentation drafts have been created.</div>';
    return;
  }
  container.innerHTML = drafts.map((draft) => {
    const slidePhotos = draft.photoIds.map((id) => photos.find((photo) => String(photo.id) === String(id))).filter(Boolean);
    const slideMarkup = slidePhotos.map((photo) => {
      const item = inventory.find((record) => record.code === photo.inventoryCode);
      const url = URL.createObjectURL(photo.blob);
      photoObjectUrls.push(url);
      return `<div class="ppt-draft-slide"><img src="${url}" alt="${escapeHtml(photo.fileName)}"><span>${escapeHtml(item?.name || photo.inventoryCode)} · ${escapeHtml(photo.category)}</span></div>`;
    }).join('');
    return `<article class="ppt-draft"><div class="ppt-draft-heading"><div><strong>${escapeHtml(draft.title)}</strong><small>${slidePhotos.length} slides · ${new Date(draft.createdAt).toLocaleDateString()}</small></div><span class="activity-status status-review">Draft</span></div><div class="ppt-draft-slides">${slideMarkup || '<span class="drafts-empty">Selected source photos are no longer available.</span>'}</div></article>`;
  }).join('');
}

function statusClass(status) {
  const value = status.toLowerCase();
  if (value.includes('expired') || value.includes('invalid')) return 'status-expired';
  if (value.includes('expiring')) return 'status-review';
  if (value === 'active' || value === 'no expiry') return 'status-done';
  if (value.includes('paid') || value.includes('completed') || value.includes('received')) return 'status-done';
  if (value.includes('pending') || value.includes('draft') || value.includes('scheduled')) return 'status-review';
  return 'status-booked';
}

function inventoryRows(rows) {
  if (!rows.length) return '<tr><td colspan="8" class="empty-state">No inventory sites match your search.</td></tr>';
  return rows.map((item) => `<tr><td><strong>${item.name}</strong><br><small>${item.code} · ${item.type}</small></td><td>${item.category}</td><td>${item.zone}</td><td>${item.town}</td><td>${item.state}</td><td>${item.booking}%</td><td>${money(item.revenue)}</td><td class="${item.profit >= 0 ? 'table-profit' : 'table-loss'}">${item.profit >= 0 ? '+' : '−'}${money(Math.abs(item.profit))}</td><td><button class="photo-action" data-photo-inventory="${item.code}">Photos</button></td></tr>`).join('');
}

function inventoryTable(rows) {
  return `<div class="table-wrap"><table><thead><tr><th>INVENTORY</th><th>CATEGORY</th><th>ZONE</th><th>TOWN</th><th>STATE</th><th>BOOKING</th><th>REVENUE</th><th>PROFIT / LOSS</th><th>PHOTOS</th></tr></thead><tbody>${inventoryRows(rows)}</tbody></table></div>`;
}

function inventoryTablePanel(rows, groupBy) {
  return `<section class="panel module-table-panel"><div class="panel-heading"><div><h2>Inventory sites</h2><p>Sites grouped by ${groupBy}</p></div></div>${inventoryTable(rows)}</section>`;
}

function setPage(page) {
  const config = pageConfig[page] || pageConfig.dashboard;
  document.body.dataset.currentPage = page;
  document.querySelectorAll('.nav-item').forEach((item) => {
    item.classList.toggle('active', item.dataset.page === page);
    if (item.dataset.page === page) item.classList.add('nav-child');
  });
  if (config.group) {
    const activeGroup = document.querySelector(`.nav-group[data-group="${config.group}"]`);
    activeGroup.classList.add('expanded');
    activeGroup.classList.add('active-group');
    activeGroup.querySelector('.nav-group-toggle').setAttribute('aria-expanded', 'true');
  }
  document.querySelectorAll('.nav-group').forEach((group) => {
    if (group.dataset.group !== config.group) group.classList.remove('active-group');
  });
  document.getElementById('breadcrumb-current').textContent = config.title.replace(' ✦', '');
  document.getElementById('page-eyebrow').textContent = config.eyebrow;
  document.getElementById('page-title').textContent = config.title;
  document.getElementById('page-subtitle').textContent = config.subtitle;
  document.getElementById('dashboard-view').hidden = page !== 'dashboard';
  document.getElementById('module-view').hidden = page === 'dashboard';
  document.getElementById('primary-action').innerHTML = `<span>＋</span> ${config.action || 'New'}`;
  renderModulePage(page);
  document.getElementById('sidebar').classList.remove('mobile-open');
  document.querySelectorAll('.nav-item.active').forEach((item) => {
    if (item.dataset.page !== page) item.classList.remove('active');
  });
  if (page !== 'dashboard') showToast(`${config.title.replace(' ✦', '')} · ${inventoryDataLabel()} data`);
}

document.querySelectorAll('.nav-item').forEach((item) => {
  item.addEventListener('click', () => setPage(item.dataset.page));
});
document.querySelectorAll('.nav-group-toggle').forEach((button) => {
  button.addEventListener('click', () => {
    const group = button.closest('.nav-group');
    const expanded = group.classList.toggle('expanded');
    button.setAttribute('aria-expanded', String(expanded));
    if (expanded) {
      document.querySelectorAll('.nav-group').forEach((otherGroup) => {
        if (otherGroup !== group) {
          otherGroup.classList.remove('expanded');
          otherGroup.querySelector('.nav-group-toggle').setAttribute('aria-expanded', 'false');
        }
      });
    }
  });
});
document.querySelectorAll('[data-link]').forEach((item) => {
  item.addEventListener('click', () => setPage(item.dataset.link));
});
document.addEventListener('click', (event) => {
  const photoButton = event.target.closest('[data-photo-inventory]');
  if (!photoButton) return;
  activePhotoInventoryCode = photoButton.dataset.photoInventory;
  activePhotoCategory = photoCategories[0];
  setPage('inventory-photos');
});
document.getElementById('inventory-search').addEventListener('input', (event) => {
  filterInventory();
});
document.getElementById('zone-filter').addEventListener('change', filterInventory);
document.getElementById('primary-action').addEventListener('click', () => {
  if (document.body.dataset.currentPage === 'budget-preparation') {
    document.getElementById('operations-budget-inventory')?.focus();
    return;
  }
  if (document.body.dataset.currentPage === 'bank-master') {
    document.getElementById('bank-master-name')?.focus();
    return;
  }
  if (document.body.dataset.currentPage === 'landlord-payments') {
    document.getElementById('landlord-payment-inventory')?.focus();
    return;
  }
  if (document.body.dataset.currentPage === 'inventory-photos') {
    document.getElementById('photo-upload')?.click();
    return;
  }
  if (document.body.dataset.currentPage === 'important-documents') {
    document.getElementById('important-document-title')?.focus();
    return;
  }
  if (document.body.dataset.currentPage === 'marketing-presentations') {
    document.getElementById('ppt-title')?.focus();
    return;
  }
  const active = document.querySelector('.nav-item.active');
  const page = active?.dataset.page || 'dashboard';
  if (page === 'dashboard' || page === 'marketing-home') {
    setPage('bookings');
    showToast('Booking workspace opened · sample prototype');
  } else {
    showToast(`${pageConfig[page].action} · sample prototype`);
  }
});
document.getElementById('mobile-menu').addEventListener('click', () => {
  document.getElementById('sidebar').classList.toggle('mobile-open');
});

renderInventory();
renderZones();
updateInventoryCounts();
renderOverviewTotals();
window.addEventListener('workspace-authenticated', initializeWorkspaceData);
if (isCloudDataActive()) initializeWorkspaceData();
