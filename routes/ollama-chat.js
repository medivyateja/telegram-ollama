const express = require('express');
const router = express.Router();
const path = require('path');
const fs = require('fs').promises;
const axios = require('axios');
const { TelegramClient } = require('telegram');
const { StringSession } = require('telegram/sessions');

// Load environment variables
require('dotenv').config();

// Constants
const KNOWLEDGE_BASE_FILE = path.join(__dirname, '..', 'public', 'data', 'knowledge-base.json');
const OLLAMA_API_URL = process.env.OLLAMA_API_URL || 'http://localhost:11434/api/generate';
const OLLAMA_MODEL = process.env.OLLAMA_MODEL || 'llama3.2:1b';

// Telegram client instance (shared with telegram-monitor.js)
let client = null;

// Store conversation states
const conversationStates = new Map();

// Global auto-respond setting
global.autoRespondAll = false; // Default to false initially

// Initialize the Telegram client (re-use the existing client if available)
async function initializeClient() {
    if (global.telegramClient) {
        client = global.telegramClient;
        return client;
    }
    
    if (client) return client;

    const apiId = parseInt(process.env.TELEGRAM_API_ID);
    const apiHash = process.env.TELEGRAM_API_HASH;
    const sessionString = process.env.TELEGRAM_SESSION;

    if (!apiId || !apiHash || !sessionString) {
        throw new Error('Telegram API credentials or session not configured');
    }

    const stringSession = new StringSession(sessionString);
    client = new TelegramClient(stringSession, apiId, apiHash, {
        connectionRetries: 5,
    });

    await client.connect();
    global.telegramClient = client;
    return client;
}

// Load knowledge base data
async function loadKnowledgeBase() {
    try {
        const data = await fs.readFile(KNOWLEDGE_BASE_FILE, 'utf8');
        return JSON.parse(data);
    } catch (error) {
        console.error('Error loading knowledge base:', error);
        return { entries: [] };
    }
}

// Find the best matching answer from knowledge base
function findAnswer(question, knowledgeBase) {
    if (!knowledgeBase || !knowledgeBase.entries || knowledgeBase.entries.length === 0) {
        return null;
    }
    
    // Normalize the question (lowercase, remove punctuation)
    const normalizedQuestion = question.toLowerCase().replace(/[^\w\s]/g, '');
    
    // First, try to find exact matches in questions
    for (const entry of knowledgeBase.entries) {
        for (const q of entry.questions) {
            if (q.toLowerCase().replace(/[^\w\s]/g, '') === normalizedQuestion) {
                return entry.answer;
            }
        }
    }
    
    // Next, check if any keywords are present
    for (const entry of knowledgeBase.entries) {
        if (entry.keywords && entry.keywords.length > 0) {
            const matchedKeywords = entry.keywords.filter(keyword => 
                normalizedQuestion.includes(keyword.toLowerCase())
            );
            
            if (matchedKeywords.length > 0) {
                return entry.answer;
            }
        }
    }
    
    // Finally, try to find partial matches
    let bestMatch = null;
    let highestMatchScore = 0;
    
    for (const entry of knowledgeBase.entries) {
        for (const q of entry.questions) {
            const words = q.toLowerCase().split(' ');
            const matchScore = words.filter(word => 
                normalizedQuestion.includes(word.toLowerCase())
            ).length / words.length;
            
            if (matchScore > 0.5 && matchScore > highestMatchScore) {
                highestMatchScore = matchScore;
                bestMatch = entry.answer;
            }
        }
    }
    
    return bestMatch;
}

// Process message with Ollama
async function processWithOllama(message, userId, knowledgeBase) {
    try {
        // Check if this is a new conversation
        const isNewConversation = !conversationStates.has(userId) || 
                                 Date.now() - conversationStates.get(userId).lastMessageTime > 3600000; // 1 hour timeout
        
        // Setup conversation state
        if (isNewConversation) {
            conversationStates.set(userId, {
                isNew: true,
                lastMessageTime: Date.now(),
                messages: []
            });
        } else {
            const state = conversationStates.get(userId);
            state.isNew = false;
            state.lastMessageTime = Date.now();
            conversationStates.set(userId, state);
        }
        
        // Check if we should send the welcome message
        if (isNewConversation) {
            return {
                response: `🕯💵✔️HEXA BOT TEAM WELCOMES YOU Reddy🙂
Steps to get free HEXA BOT.
1. Download robot from website/ your email/ here 👨‍🎓
http://hexafxrobot.com/wp-content/uploads/2023/09/HEXA-EA-Setup.zip
2. Install robot using the installation video provided. 
3. Get Licence key.
⭐️STEPS TO GET LICENCE KEY 
👉 Register with our partner broker using the link provided below 
(USE OF LINK IS MANDATORY)
1. T4 trade
https://go.t4trade.com/visit/?bta=35687&brand=t4trade
Account : Mt4
Type : Live floating spread
Leverage : 1:1000
Currency: USD 
Bonus : No bonus/ standard 
2. Ironfx 
https://go.ironfx.com/visit/?bta=42697&brand=ironfx
Account : Mt4
Type : Live floating spread
Leverage : 1:1000
Currency: USD 
Bonus : No bonus/ standard 
👉After registration, complete your profile verification.
👉 Deposit minimum $300 to start trading.
👉 Send screenshot on telegram to get your licence key.
✌️ HEXA is a free robot. We work on profit share model in which you have to pay us 7% of your profit. 
THAT'S IT 
You have achieved your financial freedom with HEXA🎉`,
                source: 'welcome'
            };
        }
        
        // First check if we have a direct match in the knowledge base
        const knowledgeBaseAnswer = findAnswer(message, knowledgeBase);
        
        if (knowledgeBaseAnswer) {
            return {
                response: knowledgeBaseAnswer,
                source: 'knowledge-base'
            };
        }
        
        // If no direct match, use Ollama
        // Prepare system prompt with knowledge base information
        let systemPrompt = `You are the HEXA Bot assistant. You provide information about the HEXA trading robot. Today is ${new Date().toISOString().split('T')[0]}. Do not mention that you are an AI. Here is a knowledge base to help you answer questions:`;
        
        knowledgeBase.entries.forEach(entry => {
            systemPrompt += `\n\nQuestion patterns: ${entry.questions.join(', ')}\nAnswer: ${entry.answer}`;
        });
        
        systemPrompt += `\n\nIf you don't know the answer, refer users to https://hexafxrobot.com/ for more details. Don't answer questions unrelated to HEXA trading robot.`;
        
        // Make request to Ollama API
        const response = await axios.post(OLLAMA_API_URL, {
            model: OLLAMA_MODEL,
            prompt: message,
            system: systemPrompt,
            stream: false
        });
        
        // Extract and clean the response
        let ollamaResponse = response.data.response.trim();
        
        // Check if response is unrelated and provide a default response
        if (ollamaResponse.toLowerCase().includes("i don't know") || 
            ollamaResponse.toLowerCase().includes("i am an ai") ||
            ollamaResponse.toLowerCase().includes("as an ai")) {
            ollamaResponse = "I'm made to assist with HEXA robot. For more details, please visit our website https://hexafxrobot.com/";
        }
        
        return {
            response: ollamaResponse,
            source: 'ollama'
        };
    } catch (error) {
        console.error('Error processing message with Ollama:', error);
        return {
            response: "I'm having trouble processing your request. Please try again later or visit https://hexafxrobot.com/ for more information.",
            source: 'error'
        };
    }
}

// Send response to user
async function sendResponse(userId, message) {
    try {
        const telegramClient = await initializeClient();
        await telegramClient.sendMessage(userId, { message });
        return true;
    } catch (error) {
        console.error('Error sending response:', error);
        return false;
    }
}

// Middleware to ensure user is authenticated
function ensureAuthenticated(req, res, next) {
    if (req.isAuthenticated()) {
        return next();
    }
    res.redirect('/login');
}

// Routes for Ollama chat management
router.get('/', ensureAuthenticated, async (req, res) => {
    try {
        res.render('ollama-chat', {
            title: 'Ollama Chat',
            conversationStates: Array.from(conversationStates.entries()),
            autoRespondAll: global.autoRespondAll || false
        });
    } catch (error) {
        console.error('Error loading ollama chat page:', error);
        req.flash('error', 'Error loading ollama chat: ' + error.message);
        res.redirect('/');
    }
});

// API endpoint to manually send a test message
router.post('/send', ensureAuthenticated, async (req, res) => {
    try {
        const { userId, message } = req.body;
        
        if (!userId || !message) {
            return res.status(400).json({ success: false, error: 'User ID and message are required' });
        }
        
        const knowledgeBase = await loadKnowledgeBase();
        const processedResponse = await processWithOllama(message, userId, knowledgeBase);
        
        const sent = await sendResponse(userId, processedResponse.response);
        
        return res.json({ 
            success: sent, 
            response: processedResponse.response,
            source: processedResponse.source
        });
    } catch (error) {
        console.error('Error sending test message:', error);
        return res.status(500).json({ success: false, error: error.message });
    }
});

// Global auto-respond routes
router.post('/auto-respond/all/enable', ensureAuthenticated, (req, res) => {
    global.autoRespondAll = true;
    req.flash('success', 'Auto-respond enabled for all users');
    res.redirect('/ollama-chat');
});

router.post('/auto-respond/all/disable', ensureAuthenticated, (req, res) => {
    global.autoRespondAll = false;
    req.flash('success', 'Auto-respond disabled for all users');
    res.redirect('/ollama-chat');
});

// Enable auto-respond for a user
router.post('/auto-respond/enable', ensureAuthenticated, async (req, res) => {
    try {
        const { userId } = req.body;
        
        if (!userId) {
            req.flash('error', 'User ID is required');
            return res.redirect('/ollama-chat');
        }
        
        // Store user ID in auto-respond list
        // This would ideally be stored in a database or persistent storage
        if (!global.autoRespondUsers) {
            global.autoRespondUsers = new Set();
        }
        
        global.autoRespondUsers.add(userId);
        
        req.flash('success', `Auto-respond enabled for user ${userId}`);
        res.redirect('/ollama-chat');
    } catch (error) {
        console.error('Error enabling auto-respond:', error);
        req.flash('error', 'Error enabling auto-respond: ' + error.message);
        res.redirect('/ollama-chat');
    }
});

// Disable auto-respond for a user
router.post('/auto-respond/disable', ensureAuthenticated, async (req, res) => {
    try {
        const { userId } = req.body;
        
        if (!userId) {
            req.flash('error', 'User ID is required');
            return res.redirect('/ollama-chat');
        }
        
        // Remove user ID from auto-respond list
        if (global.autoRespondUsers) {
            global.autoRespondUsers.delete(userId);
        }
        
        req.flash('success', `Auto-respond disabled for user ${userId}`);
        res.redirect('/ollama-chat');
    } catch (error) {
        console.error('Error disabling auto-respond:', error);
        req.flash('error', 'Error disabling auto-respond: ' + error.message);
        res.redirect('/ollama-chat');
    }
});

// Handler function for new messages from monitor
// This should be called from telegram-monitor.js
async function handleNewMessage(sender, message) {
    try {
        // Check if auto-respond is enabled globally or for this specific user
        if (global.autoRespondAll || 
            (global.autoRespondUsers && global.autoRespondUsers.has(sender.id.toString()))) {
            
            const knowledgeBase = await loadKnowledgeBase();
            const processedResponse = await processWithOllama(message.text || "", sender.id.toString(), knowledgeBase);
            
            await sendResponse(sender.id, processedResponse.response);
            
            console.log(`Auto-responded to ${sender.id} (${sender.firstName || ''} ${sender.lastName || ''}), Source: ${processedResponse.source}`);
        }
    } catch (error) {
        console.error('Error in auto-respond handler:', error);
    }
}

module.exports = { router, handleNewMessage };