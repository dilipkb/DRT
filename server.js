const express = require('express');
const cors = require('cors');
const dotenv = require('dotenv');
const { GoogleGenAI } = require('@google/genai');
const multer = require('multer');
const path = require('path');
const fs = require('fs');

dotenv.config();

const app = express();
const port = process.env.PORT || 8000;

// Initialize Gemini
const ai = new GoogleGenAI({
  apiKey: process.env.GEMINI_API_KEY
});

// Middleware
app.use(cors());
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));
app.use(express.static('public')); // Serve frontend files from the 'public' folder

// Ensure 'uploads' directory exists
const uploadDir = 'uploads';
if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir);
}

// Multer for file handling
const upload = multer({ dest: uploadDir });

/**
 * Helper: Wait for an asynchronous operation to complete
 */
async function waitForOperation(operation) {
  let currentOp = operation;
  while (!currentOp.done) {
    console.log('Indexing in progress...');
    await new Promise(resolve => setTimeout(resolve, 3000));
    currentOp = await ai.operations.get({ operation: currentOp });
  }
  return currentOp;
}

// --- API ENDPOINTS ---

// 1. List All Knowledge Stores
app.get('/api/stores', async (req, res) => {
  try {
    let stores = [];
    let pageToken = null;

    do {
      const response = await ai.fileSearchStores.list({ 
        pageSize: 20, 
        pageToken: pageToken 
      });

      // Handle plain object response
      if (response && response.fileSearchStores) {
        response.fileSearchStores.forEach(s => {
          stores.push({
            name: s.name,
            display_name: s.displayName
          });
        });
        pageToken = response.nextPageToken;
      } 
      // Handle async iterator response (common in newer SDKs)
      else if (response && typeof response[Symbol.asyncIterator] === 'function') {
        for await (const store of response) {
          stores.push({
            name: store.name,
            display_name: store.displayName
          });
        }
        pageToken = null; // Iterator handles all pages
      } else {
        pageToken = null;
      }
    } while (pageToken);

    console.log(`Successfully retrieved ${stores.length} stores`);
    res.json(stores);
  } catch (error) {
    console.error('List Stores Error:', error);
    res.status(500).json({ error: error.message });
  }
});

// 2. Create a New Store
app.post('/api/stores', async (req, res) => {
  const { display_name } = req.body;
  try {
    const store = await ai.fileSearchStores.create({
      config: { displayName: display_name }
    });
    res.json({ name: store.name, display_name: store.displayName });
  } catch (error) {
    console.error('Create Store Error:', error);
    res.status(500).json({ error: error.message });
  }
});

// 3. Delete a Store
app.delete('/api/stores/:storeId', async (req, res) => {
  const { storeId } = req.params;
  const fullName = `fileSearchStores/${storeId}`;
  try {
    await ai.fileSearchStores.delete({
      name: fullName,
      config: { force: true }
    });
    res.json({ success: true, message: 'Store deleted' });
  } catch (error) {
    console.error('Delete Store Error:', error);
    res.status(500).json({ error: error.message });
  }
});

// 4. List Files in a Specific Store
app.get('/api/stores/:storeId/files', async (req, res) => {
  const { storeId } = req.params;
  const { pageToken } = req.query;
  
  try {
    const apiKey = process.env.GEMINI_API_KEY;
    let url = `https://generativelanguage.googleapis.com/v1beta/fileSearchStores/${storeId}/documents?key=${apiKey}&pageSize=20`;
    
    if (pageToken) {
      url += `&pageToken=${pageToken}`;
    }

    console.log(`[REST] Fetching files for: ${storeId}`);
    const apiRes = await fetch(url);
    const data = await apiRes.json();

    if (data.error) {
      throw new Error(data.error.message);
    }

    const documents = (data.documents || []).map(doc => ({
      name: doc.name,
      display_name: doc.displayName
    }));

    console.log(`[REST] Store: ${storeId} | Found: ${documents.length} | PageToken: ${data.nextPageToken ? 'Yes' : 'No'}`);
    
    res.json({
      documents: documents,
      nextPageToken: data.nextPageToken || null,
      count: documents.length
    });
  } catch (error) {
    console.error('List Files REST Error:', error);
    res.status(500).json({ error: error.message });
  }
});

// 5. Upload and Index a File (Directly into a Store)
app.post('/api/upload', upload.single('file'), async (req, res) => {
  const { store_name } = req.body;
  const file = req.file;

  if (!file) return res.status(400).json({ error: 'No file provided' });
  if (!store_name) return res.status(400).json({ error: 'No store selected' });

  try {
    console.log(`Processing upload: ${file.originalname} -> ${store_name}`);
    
    // Step: Upload to File Search Store (Includes chunking and indexing)
    let operation = await ai.fileSearchStores.uploadToFileSearchStore({
      file: file.path,
      fileSearchStoreName: store_name,
      config: {
        displayName: file.originalname,
        // Optional: Custom chunking config can be added here
      }
    });

    // Wait for the long-running operation to finish
    await waitForOperation(operation);

    // Clean up local temp file
    fs.unlinkSync(file.path);

    res.json({ success: true, message: 'File indexed successfully' });
  } catch (error) {
    console.error('Upload Error:', error);
    // Cleanup on error
    if (file && fs.existsSync(file.path)) fs.unlinkSync(file.path);
    res.status(500).json({ error: error.message });
  }
});

// 6. Chat with Retrieval Augmented Generation (RAG)
// 6. Chat with Retrieval Augmented Generation (RAG) + Multimodal
// Updated to handle 'multipart/form-data' for optional file uploads
app.post('/api/chat', upload.array('files', 5), async (req, res) => {
  const prompt = req.body.prompt;
  const model_name = req.body.model_name || "gemini-2.5-flash";
  const files = req.files;

  if (!prompt && (!files || files.length === 0)) {
    return res.status(400).json({ error: 'Missing prompt or file' });
  }

  try {
    // 1. Prepare Content Parts
    let contentParts = [];
    
    // Add text prompt if exists
    if (prompt) {
        contentParts.push({ text: prompt });
    }

    // Add files content if exists
    if (files && files.length > 0) {
        const filePromises = files.map(async (file) => {
            const mimeType = file.mimetype;
            const filePath = file.path;
            
            try {
                // Read file asynchronously
                const fileBuffer = await fs.promises.readFile(filePath);
                const base64Data = fileBuffer.toString('base64');
                
                // Clean up temp file immediately
                await fs.promises.unlink(filePath);

                return {
                    inlineData: {
                        data: base64Data,
                        mimeType: mimeType
                    }
                };
            } catch (err) {
                console.error(`Error reading file ${file.originalname}:`, err);
                return null;
            }
        });

        const processedFiles = await Promise.all(filePromises);
        // Filter out any failed reads
        processedFiles.forEach(part => {
             if (part) contentParts.push(part);
        });
    }

    // 2. Resolve Stores for RAG (Smart Routing)
    let stores = [];
    let pageToken = null;
    do {
      // Use raw fetch for robust store listing (reusing the logic we fixed)
      const apiKey = process.env.GEMINI_API_KEY;
      const storesRes = await fetch(`https://generativelanguage.googleapis.com/v1beta/fileSearchStores?key=${apiKey}&pageSize=20&pageToken=${pageToken || ''}`);
      const storesData = await storesRes.json();
      
      if (storesData.fileSearchStores) {
        storesData.fileSearchStores.forEach(s => stores.push(s.name));
        pageToken = storesData.nextPageToken;
      } else {
        pageToken = null;
      }
    } while (pageToken);

    // 3. Generate Content
    console.log(`[CHAT] Processing request. Stores: ${stores.length} | Multimodal Files: ${files ? files.length : 0}`);

    const response = await ai.models.generateContent({
      model: model_name,
      contents: [{ role: 'user', parts: contentParts }],
      config: {
        systemInstruction: `You are a Brutally Honest Technical/Functional Consultant for Infor M3.

RULES:
1. You must answer the user's ticket using ONLY the provided Context Documents from Knowledge Stores AND any attached images/files.
2. If an image is provided, analyze it deeply for error codes, UI configurations, or architectural diagrams.
3. If the Context Documents do not cover the issue, state clearly: "The provided documentation does not cover this issue." Do NOT make up a solution.
4. Be direct. Do not apologize. Give the solution steps immediately.`,
        tools: [
          {
            fileSearch: {
              fileSearchStoreNames: stores // Automatically use all found stores
            }
          }
        ]
      }
    });

    res.json({ response: response.text });
  } catch (error) {
    console.error('Chat Error Details:', error);
    // Cleanup any remaining files on error
    if (req.files) {
        req.files.forEach(f => {
            if (fs.existsSync(f.path)) fs.unlinkSync(f.path);
        });
    }
    if (error.status === 429) {
      return res.status(429).json({ error: "Rate limit reached. Please wait a moment." });
    }
    res.status(500).json({ error: error.message });
  }
});

// Serve admin portal on hidden path
app.get('/admin6754', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'admin6754.html'));
});

// START SERVER
app.listen(port, () => {
  console.log('-------------------------------------------');
  console.log(`DRT Unified Server started on port ${port}`);
  console.log(`Local link: http://localhost:${port}`);
  console.log('-------------------------------------------');
});
