const express = require('express');
const router = express.Router();
const path = require('path');
const fs = require('fs').promises;

// Data directory for storing knowledge base data
const DATA_DIR = path.join(__dirname, '..', 'public', 'data');
const KNOWLEDGE_BASE_FILE = path.join(DATA_DIR, 'knowledge-base.json');

// Ensure data directory exists
async function ensureDataDirectory() {
    try {
        await fs.mkdir(DATA_DIR, { recursive: true });
    } catch (error) {
        console.error('Error creating data directory:', error);
    }
}

// Load knowledge base data
async function loadKnowledgeBase() {
    try {
        await ensureDataDirectory();
        
        try {
            const data = await fs.readFile(KNOWLEDGE_BASE_FILE, 'utf8');
            return JSON.parse(data);
        } catch (error) {
            // If file doesn't exist or has invalid JSON, return empty array
            if (error.code === 'ENOENT' || error instanceof SyntaxError) {
                return { entries: [] };
            }
            throw error;
        }
    } catch (error) {
        console.error('Error loading knowledge base:', error);
        return { entries: [] };
    }
}

// Save knowledge base data
async function saveKnowledgeBase(data) {
    try {
        await ensureDataDirectory();
        await fs.writeFile(KNOWLEDGE_BASE_FILE, JSON.stringify(data, null, 2), 'utf8');
    } catch (error) {
        console.error('Error saving knowledge base:', error);
        throw error;
    }
}

// Middleware to ensure user is authenticated
function ensureAuthenticated(req, res, next) {
    if (req.isAuthenticated()) {
        return next();
    }
    res.redirect('/login');
}

// Routes for knowledge base management
router.get('/', ensureAuthenticated, async (req, res) => {
    try {
        const knowledgeBase = await loadKnowledgeBase();
        
        res.render('knowledge-base', {
            title: 'Knowledge Base',
            entries: knowledgeBase.entries
        });
    } catch (error) {
        console.error('Error loading knowledge base page:', error);
        req.flash('error', 'Error loading knowledge base: ' + error.message);
        res.redirect('/');
    }
});

// Add new entry
router.post('/add', ensureAuthenticated, async (req, res) => {
    try {
        const { answer, questions, keywords } = req.body;
        
        if (!answer || !questions) {
            req.flash('error', 'Answer and at least one question are required');
            return res.redirect('/knowledge-base');
        }
        
        // Parse questions into array
        const questionsArray = questions.split('\n')
            .map(q => q.trim())
            .filter(q => q.length > 0);
        
        // Parse keywords into array if provided
        const keywordsArray = keywords ? keywords.split(',')
            .map(k => k.trim())
            .filter(k => k.length > 0) : [];
        
        const knowledgeBase = await loadKnowledgeBase();
        
        // Create new entry with a unique ID
        const newEntry = {
            id: Date.now().toString(),
            answer,
            questions: questionsArray,
            keywords: keywordsArray,
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString()
        };
        
        knowledgeBase.entries.push(newEntry);
        await saveKnowledgeBase(knowledgeBase);
        
        req.flash('success', 'Knowledge base entry added successfully');
        res.redirect('/knowledge-base');
    } catch (error) {
        console.error('Error adding knowledge base entry:', error);
        req.flash('error', 'Error adding entry: ' + error.message);
        res.redirect('/knowledge-base');
    }
});

// Edit entry form
router.get('/edit/:id', ensureAuthenticated, async (req, res) => {
    try {
        const { id } = req.params;
        const knowledgeBase = await loadKnowledgeBase();
        
        const entry = knowledgeBase.entries.find(e => e.id === id);
        
        if (!entry) {
            req.flash('error', 'Entry not found');
            return res.redirect('/knowledge-base');
        }
        
        res.render('knowledge-base-edit', {
            title: 'Edit Knowledge Base Entry',
            entry
        });
    } catch (error) {
        console.error('Error loading edit page:', error);
        req.flash('error', 'Error loading edit page: ' + error.message);
        res.redirect('/knowledge-base');
    }
});

// Update entry
router.post('/update/:id', ensureAuthenticated, async (req, res) => {
    try {
        const { id } = req.params;
        const { answer, questions, keywords } = req.body;
        
        if (!answer || !questions) {
            req.flash('error', 'Answer and at least one question are required');
            return res.redirect(`/knowledge-base/edit/${id}`);
        }
        
        // Parse questions into array
        const questionsArray = questions.split('\n')
            .map(q => q.trim())
            .filter(q => q.length > 0);
        
        // Parse keywords into array if provided
        const keywordsArray = keywords ? keywords.split(',')
            .map(k => k.trim())
            .filter(k => k.length > 0) : [];
        
        const knowledgeBase = await loadKnowledgeBase();
        const entryIndex = knowledgeBase.entries.findIndex(e => e.id === id);
        
        if (entryIndex === -1) {
            req.flash('error', 'Entry not found');
            return res.redirect('/knowledge-base');
        }
        
        // Update entry
        knowledgeBase.entries[entryIndex] = {
            ...knowledgeBase.entries[entryIndex],
            answer,
            questions: questionsArray,
            keywords: keywordsArray,
            updatedAt: new Date().toISOString()
        };
        
        await saveKnowledgeBase(knowledgeBase);
        
        req.flash('success', 'Knowledge base entry updated successfully');
        res.redirect('/knowledge-base');
    } catch (error) {
        console.error('Error updating knowledge base entry:', error);
        req.flash('error', 'Error updating entry: ' + error.message);
        res.redirect('/knowledge-base');
    }
});

// Delete entry
router.post('/delete/:id', ensureAuthenticated, async (req, res) => {
    try {
        const { id } = req.params;
        const knowledgeBase = await loadKnowledgeBase();
        
        const entryIndex = knowledgeBase.entries.findIndex(e => e.id === id);
        
        if (entryIndex === -1) {
            req.flash('error', 'Entry not found');
            return res.redirect('/knowledge-base');
        }
        
        // Remove entry
        knowledgeBase.entries.splice(entryIndex, 1);
        await saveKnowledgeBase(knowledgeBase);
        
        req.flash('success', 'Knowledge base entry deleted successfully');
        res.redirect('/knowledge-base');
    } catch (error) {
        console.error('Error deleting knowledge base entry:', error);
        req.flash('error', 'Error deleting entry: ' + error.message);
        res.redirect('/knowledge-base');
    }
});

module.exports = router;