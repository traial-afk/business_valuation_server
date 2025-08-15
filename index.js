import express from 'express';
import dotenv from 'dotenv';
import cors from 'cors';
import formidable from 'formidable';
import fetch from 'node-fetch';
import fs from 'fs';
import { FormData } from 'formdata-node';
import { fileFromPath } from 'formdata-node/file-from-path';
dotenv.config();

const app = express();
// CORS configuration
const corsOptions = {
  origin: process.env.ALLOWED_ORIGIN || 'http://localhost:4321',
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'Origin', 'Accept'],
  credentials: true,
  optionsSuccessStatus: 200
};

app.use(cors(corsOptions));
app.options('*', cors(corsOptions));

app.post('/request', (req, res) => {
  // Extract the authorization header from the incoming request
  const authHeader = req.headers.authorization;
  
  const form = formidable({ multiples: true });
  
  form.parse(req, async (err, fields, files) => {
    if (err) {
      console.error('Form parsing error:', err);
      return res.status(400).json({ error: 'Invalid form data' });
    }
    
    try {
      // Create FormData object
      const formData = new FormData();
      
      // 1. Handle form fields - add them as a single JSON object
      const formFields = {};
      for (const [key, value] of Object.entries(fields)) {
        formFields[key] = Array.isArray(value) ? value[0] : value;
      }
      
      // Add the JSON object as a single field
      formData.append('formData', JSON.stringify(formFields));
      
      // 2. Handle files - process all files in the array
      for (const [key, fileValue] of Object.entries(files)) {
        // Handle both single file and multiple files case
        const fileArray = Array.isArray(fileValue) ? fileValue : [fileValue];
        
        // Process each file in the array
        for (let i = 0; i < fileArray.length; i++) {
          const file = fileArray[i];
          
          // Store file metadata separately
          const fileMetadata = {
            originalName: file.originalFilename || `file-${i}`,
            mimeType: file.mimetype || 'application/octet-stream',
            size: file.size,
            fieldName: key,
            index: i
          };
          
          // Add file metadata as a separate field
          formData.append('fileMetadata', JSON.stringify(fileMetadata));
          
          // Add the actual file with a consistent field name
          const fileObject = await fileFromPath(file.filepath, {
            type: file.mimetype || 'application/octet-stream',
            filename: file.originalFilename || `file-${i}`
          });
          formData.append('binaryFile', fileObject);
        }
      }
      
      // Set up timeout with AbortController
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 300000); // 5 minutes timeout
      
      try {
        // Forward to n8n webhook with authorization header
        const response = await fetch(process.env.N8N_WEBHOOK_URL, {
          method: 'POST',
          headers: {
            // Forward the Authorization header if it exists
            ...(authHeader && { 'Authorization': authHeader })
          },
          body: formData,
          signal: controller.signal // Use the AbortController's signal
        });
        
        clearTimeout(timeoutId); // Clear the timeout if request completes
        
        if (response.ok) {
          const result = await response.json();
          res.json(result);
        } else {
          const errorText = await response.text();
          console.error(`N8N webhook error (${response.status}):`, errorText);
          res.status(response.status).json({ 
            error: `N8N webhook error: ${response.status}`,
            details: errorText
          });
        }
      } catch (error) {
        clearTimeout(timeoutId); // Clear the timeout on error
        
        if (error.name === 'AbortError') {
          console.error('Request timed out after 5 minutes');
          res.status(504).json({ 
            error: 'Gateway Timeout', 
            message: 'The request took too long to process. Your data may still be processing.' 
          });
        } else {
          console.error('Error forwarding request to n8n:', error);
          res.status(500).json({ 
            error: 'Failed to process request', 
            message: error.message 
          });
        }
      }
    } catch (err) {
      console.error('Error processing form data:', err);
      res.status(500).json({ error: 'Failed to process form data', message: err.message });
    }
  });
});

app.get('/', (req, res) => {
  res.send('Server is running');
});

const PORT = process.env.PORT || 8080;
app.listen(PORT, () => {
  console.log(`Server is running on http://localhost:${PORT}`);
});
