let stores = [];
let selectedStoreId = null;
let currentNextPageToken = null;
let totalFilesLoaded = 0;

const storeListContainer = document.getElementById('store-list');
const storeManagement = document.getElementById('store-management');
const noStoreSelected = document.getElementById('no-store-selected');
const fileInput = document.getElementById('file-input');
const dropZone = document.getElementById('drop-zone');
const nextPageBtn = document.getElementById('next-page-btn');
const paginationControls = document.getElementById('pagination-controls');
const fileCountBadge = document.getElementById('file-count');
const themeToggle = document.getElementById('theme-toggle');

document.addEventListener('DOMContentLoaded', () => {
    // Load saved theme
    const savedTheme = localStorage.getItem('theme') || 'light';
    if (savedTheme === 'dark') {
        document.body.classList.add('dark-mode');
        themeToggle.checked = false;
    } else {
        themeToggle.checked = true;
    }

    // Theme Switch Listener
    themeToggle.addEventListener('change', (e) => {
        if (e.target.checked) {
            document.body.classList.remove('dark-mode'); // Light Mode
            localStorage.setItem('theme', 'light');
        } else {
            document.body.classList.add('dark-mode'); // Dark Mode
            localStorage.setItem('theme', 'dark');
        }
    });

    fetchStores();
    setupEventListeners();
});

function setupEventListeners() {
    document.getElementById('create-store-btn').addEventListener('click', handleCreateStore);
    document.getElementById('delete-store-btn').addEventListener('click', handleDeleteStore);
    nextPageBtn.addEventListener('click', handleNextPage);
    
    dropZone.addEventListener('click', () => fileInput.click());
    fileInput.addEventListener('change', (e) => {
        if (e.target.files.length > 0) {
            uploadFile(e.target.files[0]);
        }
    });
}

async function fetchStores() {
    try {
        const response = await fetch('/api/stores');
        stores = await response.json();
        renderStoreList();
    } catch (error) {
        console.error('Fetch Stores failed:', error);
    }
}

function renderStoreList() {
    storeListContainer.innerHTML = '';
    stores.forEach(store => {
        const cleanId = store.name.split('/').pop();
        const card = document.createElement('div');
        card.className = `store-card ${selectedStoreId === cleanId ? 'selected' : ''}`;
        card.innerHTML = `
            <h3>${store.display_name}</h3>
            <p>${store.name}</p>
        `;
        card.onclick = () => selectStoreForManagement(store);
        storeListContainer.appendChild(card);
    });
}

async function handleCreateStore() {
    const name = prompt('Enter a display name for the new Knowledge Store:');
    if (!name) return;

    try {
        const res = await fetch('/api/stores', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ display_name: name })
        });
        if (res.ok) fetchStores();
    } catch (error) {
        alert('Failed to create store');
    }
}

let currentStoreDisplayName = "";

async function handleDeleteStore() {
    if (!selectedStoreId) return;
    
    const confirmation = prompt(`To delete this store, please type its display name: "${currentStoreDisplayName}"\n\nWARNING: This will permanently delete all 17+ indexed documents.`);
    
    if (confirmation !== currentStoreDisplayName) {
        if (confirmation !== null) alert("Incorrect name. Deletion cancelled.");
        return;
    }

    try {
        const res = await fetch(`/api/stores/${selectedStoreId}`, {
            method: 'DELETE'
        });
        if (res.ok) {
            selectedStoreId = null;
            storeManagement.classList.add('hidden');
            noStoreSelected.classList.remove('hidden');
            fetchStores();
        }
    } catch (error) {
        alert('Failed to delete store');
    }
}

function selectStoreForManagement(store) {
    const cleanId = store.name.split('/').pop();
    selectedStoreId = cleanId;
    currentStoreDisplayName = store.display_name;
    currentNextPageToken = null; // Reset pagination for new store
    totalFilesLoaded = 0;
    
    renderStoreList();

    noStoreSelected.classList.add('hidden');
    storeManagement.classList.remove('hidden');

    document.getElementById('selected-store-name').textContent = store.display_name;
    document.getElementById('selected-store-id').textContent = store.name;

    fetchFiles(cleanId);
}

async function fetchFiles(storeId, append = false) {
    const listEl = document.getElementById('file-list');
    
    if (!append) {
        listEl.innerHTML = '<div class="file-row">Loading files...</div>';
        totalFilesLoaded = 0;
        fileCountBadge.classList.add('hidden');
    }

    try {
        let url = `/api/stores/${storeId}/files`;
        if (currentNextPageToken) {
            url += `?pageToken=${currentNextPageToken}`;
        }

        const res = await fetch(url);
        const data = await res.json();
        
        console.log('Files API Response:', data);
        
        const files = data.documents || [];
        currentNextPageToken = data.nextPageToken;
        
        if (!append) listEl.innerHTML = '';
        
        if (files.length === 0 && !append) {
            listEl.innerHTML = '<div class="file-row">No files indexed yet.</div>';
            fileCountBadge.classList.add('hidden');
        } else {
            totalFilesLoaded += files.length;
            fileCountBadge.textContent = totalFilesLoaded;
            fileCountBadge.classList.remove('hidden');
        }

        files.forEach(file => {
            const row = document.createElement('div');
            row.className = 'file-row';
            row.innerHTML = `
                <div class="file-info">
                    <i data-lucide="file-text"></i>
                    <span>${file.display_name}</span>
                </div>
                <span class="id-badge">${file.name.split('/').pop()}</span>
            `;
            listEl.appendChild(row);
        });

        // Show/hide next page button
        if (currentNextPageToken) {
            paginationControls.classList.remove('hidden');
        } else {
            paginationControls.classList.add('hidden');
        }

        lucide.createIcons();
    } catch (error) {
        if (!append) listEl.innerHTML = '<div class="file-row text-error">Error loading files.</div>';
        console.error('Fetch files error:', error);
    }
}

function handleNextPage() {
    if (selectedStoreId && currentNextPageToken) {
        fetchFiles(selectedStoreId, true);
    }
}

async function uploadFile(file) {
    if (!selectedStoreId) return;

    const statusEl = document.getElementById('upload-status');
    const statusText = document.getElementById('status-text');
    
    statusEl.classList.remove('hidden');
    statusText.textContent = `Uploading & Indexing ${file.name}...`;

    const formData = new FormData();
    formData.append('file', file);
    formData.append('store_name', `fileSearchStores/${selectedStoreId}`);

    try {
        const res = await fetch('/api/upload', {
            method: 'POST',
            body: formData
        });
        const data = await res.json();
        
        if (res.ok) {
            statusText.textContent = 'Success!';
            setTimeout(() => {
                statusEl.classList.add('hidden');
                currentNextPageToken = null; // Reset to show fresh first page
                fetchFiles(selectedStoreId);
            }, 2000);
        } else {
            throw new Error(data.error);
        }
    } catch (error) {
        statusText.textContent = 'Error: ' + error.message;
        setTimeout(() => statusEl.classList.add('hidden'), 4000);
    }
}
